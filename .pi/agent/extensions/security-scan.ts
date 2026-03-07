/**
 * Security Scan Extension
 *
 * Provides a `/security-scan` command that runs static security checks:
 * - Regex-based secret detection (zero dependencies, always runs)
 * - Semgrep SAST (requires: pip install semgrep)
 * - Dependency vulnerability audit (requires per-ecosystem audit tools)
 *
 * This is a static analysis complement to `/security-review`, which is LLM-powered.
 * The scan results are injected into the agent context so the agent can act on them.
 *
 * Usage:
 * - `/security-scan`                — scan git-changed files (secrets + semgrep + deps)
 * - `/security-scan all`            — scan entire project
 * - `/security-scan secrets`        — regex secret detection only
 * - `/security-scan semgrep`        — Semgrep SAST only
 * - `/security-scan deps`           — dependency audit only
 * - `/security-scan folder src lib` — scan specific paths
 *
 * Semgrep suppression: add `# nosemgrep: rule-id` inline to suppress a finding.
 * Semgrep and audit tools degrade gracefully when not installed.
 */

import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@mariozechner/pi-coding-agent";
import { promises as fs } from "node:fs";
import path from "node:path";
import { tokenizeSpaceSeparated } from "./_shared/review-utils.js";

// ─── Types ────────────────────────────────────────────────────────────────────

type ScanScope =
  | { type: "gitChanged" }
  | { type: "all" }
  | { type: "folder"; paths: string[] };

type ScanMode = {
  secrets: boolean;
  semgrep: boolean;
  deps: boolean;
  scope: ScanScope;
};

type SecretFinding = {
  file: string;
  line: number;
  pattern: string;
  match: string;
};

type SemgrepFinding = {
  ruleId: string;
  file: string;
  line: number;
  message: string;
  severity: string;
};

type DepFinding = {
  name: string;
  version: string;
  severity: string;
  description: string;
  advisory?: string;
};

type ScanResults = {
  scannedFiles: string[];
  secrets: SecretFinding[];
  semgrep: SemgrepFinding[];
  deps: DepFinding[];
  semgrepSkipped?: string;
  depsSkipped?: string;
  depsManager?: string;
};

// ─── Secret patterns ──────────────────────────────────────────────────────────

// Ported from aegis_sentinel S001 rule + common additions.
// Each entry: [displayName, regex]
const SECRET_PATTERNS: Array<[string, RegExp]> = [
  ["AWS Access Key ID", /\bAKIA[0-9A-Z]{16}\b/],
  [
    "AWS Secret Access Key",
    /(?:aws[_\-. ]?secret[_\-. ]?(?:access[_\-. ]?)?key)\s*[=:]\s*["']?[A-Za-z0-9/+=]{40}/i,
  ],
  ["PEM Private Key", /-----BEGIN\s+(?:[A-Z]+ )?PRIVATE KEY-----/],
  [
    "Secret assignment",
    /(?:password|passwd|secret|api[_\-.]?key|auth[_\-.]?token|access[_\-.]?token|private[_\-.]?key|client[_\-.]?secret)\s*[=:]\s*["'](?!\s*\{\{)[^"'\s]{8,}/i,
  ],
  [
    "Connection string with credentials",
    /(?:postgres|postgresql|mysql|mongodb|redis|amqp):\/\/[^:@\s"']+:[^@\s"']+@/i,
  ],
];

// Skip binary and generated file types
const SKIP_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".svg",
  ".ico",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".otf",
  ".pdf",
  ".zip",
  ".tar",
  ".gz",
  ".7z",
  ".bin",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".map",
  ".lock",
  ".snap",
]);

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  "out",
  "__pycache__",
  ".venv",
  "venv",
  "target",
  ".cargo",
  "coverage",
  ".nyc_output",
]);

// ─── File collection ──────────────────────────────────────────────────────────

async function getGitChangedFiles(
  pi: ExtensionAPI,
  cwd: string,
): Promise<string[]> {
  const names: string[] = [];

  // Working-tree changes vs HEAD (modified tracked files)
  const { stdout: diffOut, code: diffCode } = await pi.exec("git", [
    "diff",
    "--name-only",
    "--diff-filter=d",
    "HEAD",
  ]);
  if (diffCode === 0 && diffOut.trim()) {
    names.push(...diffOut.trim().split("\n").filter(Boolean));
  }

  // Staged-only changes vs HEAD (index differs from HEAD, working tree may match HEAD)
  const { stdout: cachedOut, code: cachedCode } = await pi.exec("git", [
    "diff",
    "--cached",
    "--name-only",
    "--diff-filter=d",
    "HEAD",
  ]);
  if (cachedCode === 0 && cachedOut.trim()) {
    names.push(...cachedOut.trim().split("\n").filter(Boolean));
  }

  // Untracked files (new files not yet staged)
  const { stdout: untrackedOut, code: untrackedCode } = await pi.exec("git", [
    "ls-files",
    "--others",
    "--exclude-standard",
  ]);
  if (untrackedCode === 0 && untrackedOut.trim()) {
    names.push(...untrackedOut.trim().split("\n").filter(Boolean));
  }

  return [...new Set(names)].map((f) => path.resolve(cwd, f));
}

async function getAllTrackedFiles(
  pi: ExtensionAPI,
  cwd: string,
): Promise<string[]> {
  const { stdout, code } = await pi.exec("git", ["ls-files"]);
  if (code === 0 && stdout.trim()) {
    return stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((f) => path.resolve(cwd, f));
  }
  // Not a git repo — walk filesystem
  return walkDir(cwd);
}

async function getFolderFiles(paths: string[], cwd: string): Promise<string[]> {
  const files: string[] = [];
  for (const p of paths) {
    const resolved = path.resolve(cwd, p);
    // Reject paths that escape the working directory (CWE-22)
    if (resolved !== cwd && !resolved.startsWith(cwd + path.sep)) continue;
    const stat = await fs.stat(resolved).catch(() => null);
    if (!stat) continue;
    if (stat.isFile()) {
      files.push(resolved);
    } else if (stat.isDirectory()) {
      files.push(...(await walkDir(resolved)));
    }
  }
  return files;
}

async function walkDir(dir: string): Promise<string[]> {
  const results: string[] = [];
  let entries: import("fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await walkDir(fullPath)));
    } else if (entry.isFile()) {
      results.push(fullPath);
    }
  }
  return results;
}

function isScannable(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  if (SKIP_EXTENSIONS.has(ext)) return false;
  const parts = filePath.split(path.sep);
  return !parts.some((part) => SKIP_DIRS.has(part));
}

// ─── Secret scanner ───────────────────────────────────────────────────────────

async function scanSecrets(
  files: string[],
  cwd: string,
): Promise<SecretFinding[]> {
  const findings: SecretFinding[] = [];

  for (const filePath of files) {
    if (!isScannable(filePath)) continue;

    let content: string;
    try {
      content = await fs.readFile(filePath, "utf8");
    } catch {
      // Binary or unreadable
      continue;
    }

    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      for (const [patternName, regex] of SECRET_PATTERNS) {
        const match = line.match(regex);
        if (match) {
          findings.push({
            file: path.relative(cwd, filePath),
            line: i + 1,
            pattern: patternName,
            match: redactMatch(match[0]!),
          });
        }
      }
    }
  }

  return findings;
}

// Redact most of the match to avoid capturing real secrets in session history.
// Secrets ≤20 chars are fully redacted; longer ones show 3 chars each end (CWE-312).
function redactMatch(raw: string): string {
  if (raw.length <= 20) return "***";
  return raw.slice(0, 3) + "***" + raw.slice(-3);
}

// ─── Semgrep scanner ──────────────────────────────────────────────────────────

async function scanSemgrep(
  pi: ExtensionAPI,
  files: string[],
  scope: ScanScope,
  cwd: string,
): Promise<{ findings: SemgrepFinding[]; skipped?: string }> {
  const { code: whichCode } = await pi.exec("which", ["semgrep"]);
  if (whichCode !== 0) {
    return {
      findings: [],
      skipped: "semgrep not installed (run: pip install semgrep)",
    };
  }

  // For full-project scans pass the directory; for targeted scans pass files.
  // This avoids hitting command-line length limits with large file lists.
  const targets = scope.type === "all" ? [cwd] : files.filter(isScannable);

  if (targets.length === 0) {
    return { findings: [] };
  }

  const { stdout, stderr, code } = await pi.exec("semgrep", [
    "--json",
    "--config",
    "p/secrets",
    "--config",
    "p/owasp-top-ten",
    "--no-rewrite-rule-ids",
    "--quiet",
    ...targets,
  ]);

  // semgrep exits 0 (clean), 1 (findings), 2+ (error)
  if (code >= 2) {
    return {
      findings: [],
      skipped: `semgrep exited with code ${code} — check semgrep installation or run manually for details`,
    };
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return {
      findings: [],
      skipped:
        "failed to parse semgrep JSON output — run semgrep manually for details",
    };
  }

  const results = (parsed.results as unknown[]) ?? [];
  const findings: SemgrepFinding[] = results.map((r: unknown) => {
    const result = r as Record<string, unknown>;
    const extra = (result.extra ?? {}) as Record<string, unknown>;
    const start = (result.start ?? {}) as Record<string, unknown>;
    return {
      ruleId: (result.check_id as string) ?? "unknown",
      file: path.relative(cwd, (result.path as string) ?? ""),
      line: (start.line as number) ?? 0,
      message: (extra.message as string) ?? "",
      severity: normalizeSemgrepSeverity((extra.severity as string) ?? ""),
    };
  });

  return { findings };
}

function normalizeSemgrepSeverity(sev: string): string {
  switch (sev.toUpperCase()) {
    case "ERROR":
      return "High";
    case "WARNING":
      return "Medium";
    case "INFO":
      return "Low";
    default:
      return sev || "Unknown";
  }
}

// ─── Dependency scanner ───────────────────────────────────────────────────────

type PackageManager = "npm" | "pnpm" | "yarn" | "pip" | "cargo" | "go";

async function detectPackageManager(
  cwd: string,
): Promise<PackageManager | null> {
  // Order matters: more specific lockfiles first
  const checks: [string, PackageManager][] = [
    ["pnpm-lock.yaml", "pnpm"],
    ["yarn.lock", "yarn"],
    ["package-lock.json", "npm"],
    ["package.json", "npm"],
    ["Cargo.lock", "cargo"],
    ["go.sum", "go"],
    ["requirements.txt", "pip"],
    ["pyproject.toml", "pip"],
  ];
  for (const [file, manager] of checks) {
    const exists = await fs.stat(path.join(cwd, file)).catch(() => null);
    if (exists) return manager;
  }
  return null;
}

async function scanDeps(
  pi: ExtensionAPI,
  cwd: string,
): Promise<{ findings: DepFinding[]; manager?: string; skipped?: string }> {
  const manager = await detectPackageManager(cwd);
  if (!manager) {
    return { findings: [], skipped: "no supported package manager detected" };
  }
  switch (manager) {
    case "npm":
      return runNpmAudit(pi);
    case "pnpm":
      return runPnpmAudit(pi);
    case "yarn":
      return runYarnAudit(pi);
    case "pip":
      return runPipAudit(pi);
    case "cargo":
      return runCargoAudit(pi);
    case "go":
      return runGovulncheck(pi);
  }
}

async function runNpmAudit(
  pi: ExtensionAPI,
): Promise<{ findings: DepFinding[]; manager: string; skipped?: string }> {
  const { stdout, code } = await pi.exec("npm", ["audit", "--json"]);
  if (code > 1) {
    return { findings: [], manager: "npm", skipped: "npm audit failed" };
  }
  try {
    const data = JSON.parse(stdout) as Record<string, unknown>;
    const vulns = (data.vulnerabilities ?? {}) as Record<
      string,
      Record<string, unknown>
    >;
    const findings: DepFinding[] = Object.entries(vulns).flatMap(
      ([name, v]) => {
        const vias = ((v.via as unknown[]) ?? []).filter(
          (via): via is Record<string, unknown> => typeof via === "object",
        );
        return vias.map((via) => ({
          name,
          version: (v.range as string) ?? "unknown",
          severity: (via.severity as string) ?? "unknown",
          description: (via.title as string) ?? (via.url as string) ?? "",
          advisory: via.url as string | undefined,
        }));
      },
    );
    // Deduplicate by (name, advisory URL) — npm reports the same advisory once
    // per dependent package that pulls in the vulnerable version.
    const seen = new Set<string>();
    const deduped = findings.filter((f) => {
      const key = `${f.name}::${f.advisory ?? f.description}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return { findings: deduped, manager: "npm" };
  } catch {
    return {
      findings: [],
      manager: "npm",
      skipped: "failed to parse npm audit output",
    };
  }
}

async function runPnpmAudit(
  pi: ExtensionAPI,
): Promise<{ findings: DepFinding[]; manager: string; skipped?: string }> {
  const { stdout, code } = await pi.exec("pnpm", ["audit", "--json"]);
  if (code > 1) {
    return { findings: [], manager: "pnpm", skipped: "pnpm audit failed" };
  }
  try {
    const data = JSON.parse(stdout) as Record<string, unknown>;
    const advisories = (data.advisories ?? {}) as Record<
      string,
      Record<string, unknown>
    >;
    const findings: DepFinding[] = Object.values(advisories).map((a) => {
      const firstFinding = ((a.findings as unknown[])?.[0] ?? {}) as Record<
        string,
        unknown
      >;
      return {
        name: (a.module_name as string) ?? "unknown",
        version: (firstFinding.version as string) ?? "unknown",
        severity: (a.severity as string) ?? "unknown",
        description: (a.title as string) ?? "",
        advisory: a.url as string | undefined,
      };
    });
    return { findings, manager: "pnpm" };
  } catch {
    return {
      findings: [],
      manager: "pnpm",
      skipped: "failed to parse pnpm audit output",
    };
  }
}

async function runYarnAudit(
  pi: ExtensionAPI,
): Promise<{ findings: DepFinding[]; manager: string; skipped?: string }> {
  const { stdout, code } = await pi.exec("yarn", ["audit", "--json"]);
  if (code > 1) {
    return { findings: [], manager: "yarn", skipped: "yarn audit failed" };
  }
  const findings: DepFinding[] = [];
  try {
    for (const line of stdout.trim().split("\n")) {
      if (!line.trim()) continue;
      const obj = JSON.parse(line) as Record<string, unknown>;
      if (obj.type === "auditAdvisory") {
        const data = (obj.data ?? {}) as Record<string, unknown>;
        const a = (data.advisory ?? {}) as Record<string, unknown>;
        const firstFinding = ((a.findings as unknown[])?.[0] ?? {}) as Record<
          string,
          unknown
        >;
        findings.push({
          name: (a.module_name as string) ?? "unknown",
          version: (firstFinding.version as string) ?? "unknown",
          severity: (a.severity as string) ?? "unknown",
          description: (a.title as string) ?? "",
          advisory: a.url as string | undefined,
        });
      }
    }
    return { findings, manager: "yarn" };
  } catch {
    return {
      findings: [],
      manager: "yarn",
      skipped: "failed to parse yarn audit output",
    };
  }
}

async function runPipAudit(
  pi: ExtensionAPI,
): Promise<{ findings: DepFinding[]; manager: string; skipped?: string }> {
  const { code: whichCode } = await pi.exec("which", ["pip-audit"]);
  if (whichCode !== 0) {
    return {
      findings: [],
      manager: "pip",
      skipped: "pip-audit not installed (run: pip install pip-audit)",
    };
  }
  const { stdout, code } = await pi.exec("pip-audit", ["--format=json"]);
  if (code > 1) {
    return { findings: [], manager: "pip", skipped: "pip-audit failed" };
  }
  try {
    const data = JSON.parse(stdout) as Record<string, unknown>;
    const deps = (data.dependencies as unknown[]) ?? [];
    const findings: DepFinding[] = deps.flatMap((dep) => {
      const d = dep as Record<string, unknown>;
      const vulns = (d.vulns as unknown[]) ?? [];
      return vulns.map((vuln) => {
        const v = vuln as Record<string, unknown>;
        const fixVersions = (v.fix_versions as unknown[]) ?? [];
        return {
          name: (d.name as string) ?? "unknown",
          version: (d.version as string) ?? "unknown",
          severity: fixVersions.length > 0 ? "High" : "Medium",
          description: (v.description as string) ?? (v.id as string) ?? "",
          advisory: v.id ? `https://osv.dev/vulnerability/${v.id}` : undefined,
        };
      });
    });
    return { findings, manager: "pip" };
  } catch {
    return {
      findings: [],
      manager: "pip",
      skipped: "failed to parse pip-audit output",
    };
  }
}

async function runCargoAudit(
  pi: ExtensionAPI,
): Promise<{ findings: DepFinding[]; manager: string; skipped?: string }> {
  const { code: whichCode } = await pi.exec("which", ["cargo-audit"]);
  if (whichCode !== 0) {
    return {
      findings: [],
      manager: "cargo",
      skipped: "cargo-audit not installed (run: cargo install cargo-audit)",
    };
  }
  const { stdout, code } = await pi.exec("cargo", ["audit", "--json"]);
  if (code > 1) {
    return { findings: [], manager: "cargo", skipped: "cargo audit failed" };
  }
  try {
    const data = JSON.parse(stdout) as Record<string, unknown>;
    const vulnList = (data.vulnerabilities as Record<string, unknown>)?.list;
    const vulns = (vulnList as unknown[]) ?? [];
    const findings: DepFinding[] = vulns.map((v) => {
      const vuln = v as Record<string, unknown>;
      const pkg = (vuln.package ?? {}) as Record<string, unknown>;
      const advisory = (vuln.advisory ?? {}) as Record<string, unknown>;
      const cvss = (advisory.cvss ?? {}) as Record<string, unknown>;
      return {
        name: (pkg.name as string) ?? "unknown",
        version: (pkg.version as string) ?? "unknown",
        severity: cvss.score
          ? severityFromCvss(cvss.score as number)
          : "Unknown",
        description:
          (advisory.title as string) ?? (advisory.id as string) ?? "",
        advisory: advisory.url as string | undefined,
      };
    });
    return { findings, manager: "cargo" };
  } catch {
    return {
      findings: [],
      manager: "cargo",
      skipped: "failed to parse cargo audit output",
    };
  }
}

async function runGovulncheck(
  pi: ExtensionAPI,
): Promise<{ findings: DepFinding[]; manager: string; skipped?: string }> {
  const { code: whichCode } = await pi.exec("which", ["govulncheck"]);
  if (whichCode !== 0) {
    return {
      findings: [],
      manager: "go",
      skipped:
        "govulncheck not installed (run: go install golang.org/x/vuln/cmd/govulncheck@latest)",
    };
  }
  const { stdout, code } = await pi.exec("govulncheck", ["-json", "./..."]);
  if (code > 1) {
    return {
      findings: [],
      manager: "go",
      skipped: "govulncheck failed",
    };
  }
  const findings: DepFinding[] = [];
  try {
    for (const line of stdout.trim().split("\n")) {
      if (!line.trim()) continue;
      const obj = JSON.parse(line) as Record<string, unknown>;
      if (obj.osv) {
        const osv = obj.osv as Record<string, unknown>;
        findings.push({
          name: (osv.id as string) ?? "unknown",
          version: "unknown",
          severity: "High",
          description: (osv.summary as string) ?? (osv.details as string) ?? "",
          advisory: osv.id
            ? `https://osv.dev/vulnerability/${osv.id}`
            : undefined,
        });
      }
    }
    return { findings, manager: "go" };
  } catch {
    return {
      findings: [],
      manager: "go",
      skipped: "failed to parse govulncheck output",
    };
  }
}

function severityFromCvss(score: number): string {
  if (score >= 9.0) return "Critical";
  if (score >= 7.0) return "High";
  if (score >= 4.0) return "Medium";
  return "Low";
}

// ─── Output formatter ─────────────────────────────────────────────────────────

const SEVERITY_ORDER = ["Critical", "High", "Medium", "Low", "Unknown"];

function groupBySeverity<T>(
  items: T[],
  getSeverity: (item: T) => string,
): Array<[string, T[]]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const raw = getSeverity(item);
    const key =
      SEVERITY_ORDER.find((s) => s.toLowerCase() === raw.toLowerCase()) ??
      "Unknown";
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(item);
  }
  return SEVERITY_ORDER.filter((sev) => map.has(sev)).map((sev) => [
    sev,
    map.get(sev)!,
  ]);
}

function formatResults(results: ScanResults, mode: ScanMode): string {
  const lines: string[] = [];
  const totalFindings =
    results.secrets.length + results.semgrep.length + results.deps.length;

  const scopeDesc =
    mode.scope.type === "gitChanged"
      ? "git-changed files"
      : mode.scope.type === "all"
        ? "all project files"
        : `paths: ${(mode.scope as Extract<ScanScope, { type: "folder" }>).paths.join(", ")}`;

  lines.push("# Security Scan Results");
  lines.push("");
  lines.push(
    `**Scope:** ${scopeDesc} — ${results.scannedFiles.length} file${results.scannedFiles.length !== 1 ? "s" : ""} scanned`,
  );
  for (const f of results.scannedFiles) {
    lines.push(`  - ${f}`);
  }
  lines.push("");

  // ── Secrets ──
  if (mode.secrets) {
    lines.push("## Secret Detection");
    if (results.secrets.length === 0) {
      lines.push("No secrets detected.");
    } else {
      lines.push(
        `${results.secrets.length} potential secret${results.secrets.length !== 1 ? "s" : ""} found:`,
      );
      lines.push("");
      for (const f of results.secrets) {
        lines.push(`- **${f.pattern}** — \`${f.file}:${f.line}\``);
        lines.push(`  Partial match: \`${f.match}\``);
      }
    }
    lines.push("");
  }

  // ── Semgrep ──
  if (mode.semgrep) {
    lines.push("## Semgrep SAST");
    if (results.semgrepSkipped) {
      lines.push(`Skipped: ${results.semgrepSkipped}`);
    } else if (results.semgrep.length === 0) {
      lines.push("No findings.");
    } else {
      lines.push(
        `${results.semgrep.length} finding${results.semgrep.length !== 1 ? "s" : ""}:`,
      );
      lines.push("");
      for (const [sev, items] of groupBySeverity(
        results.semgrep,
        (f) => f.severity,
      )) {
        lines.push(`### ${sev}`);
        for (const f of items) {
          lines.push(`- **${f.ruleId}** — \`${f.file}:${f.line}\``);
          lines.push(`  ${f.message}`);
        }
      }
    }
    lines.push("");
  }

  // ── Deps ──
  if (mode.deps) {
    lines.push("## Dependency Audit");
    if (results.depsSkipped) {
      lines.push(`Skipped: ${results.depsSkipped}`);
    } else {
      if (results.depsManager) {
        lines.push(`Package manager: ${results.depsManager}`);
        lines.push("");
      }
      if (results.deps.length === 0) {
        lines.push("No known vulnerabilities.");
      } else {
        lines.push(
          `${results.deps.length} vulnerable dependenc${results.deps.length !== 1 ? "ies" : "y"}:`,
        );
        lines.push("");
        for (const [sev, items] of groupBySeverity(
          results.deps,
          (f) => f.severity,
        )) {
          lines.push(`### ${sev}`);
          for (const f of items) {
            const advisory = f.advisory ? ` — ${f.advisory}` : "";
            lines.push(
              `- **${f.name}** (${f.version}): ${f.description}${advisory}`,
            );
          }
        }
      }
    }
    lines.push("");
  }

  // ── Summary ──
  lines.push("---");
  if (totalFindings === 0) {
    lines.push("**No issues detected.**");
    lines.push("");
    lines.push(
      "Consider also running `/security-review` for a deeper LLM-powered analysis.",
    );
  } else {
    const parts: string[] = [];
    if (results.secrets.length > 0)
      parts.push(
        `${results.secrets.length} secret${results.secrets.length !== 1 ? "s" : ""}`,
      );
    if (results.semgrep.length > 0)
      parts.push(`${results.semgrep.length} SAST`);
    if (results.deps.length > 0)
      parts.push(
        `${results.deps.length} dep vuln${results.deps.length !== 1 ? "s" : ""}`,
      );
    lines.push(`**Total findings: ${totalFindings}** (${parts.join(", ")})`);
    lines.push("");
    lines.push(
      "Review the findings above and remediate as appropriate. Consider also running `/security-review` for a deeper LLM-powered analysis of the same target.",
    );
  }

  return lines.join("\n");
}

// ─── Pre-flight entry point ───────────────────────────────────────────────────

/**
 * Runs all three scans (secrets, semgrep, deps) for a given scope and returns
 * a formatted string suitable for embedding in a review prompt as grounding context.
 * Exported for use by `/security-review` as a pre-flight step.
 */
export async function runPreflightScan(
  pi: ExtensionAPI,
  scope: ScanScope,
  cwd: string,
): Promise<string> {
  let files: string[];
  switch (scope.type) {
    case "gitChanged": {
      files = await getGitChangedFiles(pi, cwd);
      if (files.length === 0) files = await getAllTrackedFiles(pi, cwd);
      break;
    }
    case "all": {
      files = await getAllTrackedFiles(pi, cwd);
      break;
    }
    case "folder": {
      files = await getFolderFiles(scope.paths, cwd);
      break;
    }
  }

  const mode: ScanMode = { secrets: true, semgrep: true, deps: true, scope };
  const results: ScanResults = {
    scannedFiles: files.map((f) => path.relative(cwd, f)),
    secrets: [],
    semgrep: [],
    deps: [],
  };

  results.secrets = await scanSecrets(files, cwd);

  const { findings: semgrepFindings, skipped: semgrepSkipped } =
    await scanSemgrep(pi, files, scope, cwd);
  results.semgrep = semgrepFindings;
  results.semgrepSkipped = semgrepSkipped;

  const {
    findings: depFindings,
    manager,
    skipped: depsSkipped,
  } = await scanDeps(pi, cwd);
  results.deps = depFindings;
  results.depsManager = manager;
  results.depsSkipped = depsSkipped;

  return formatPreflightReport(results, mode);
}

export type { ScanScope };

function formatPreflightReport(results: ScanResults, mode: ScanMode): string {
  const lines: string[] = [];
  const totalFindings =
    results.secrets.length + results.semgrep.length + results.deps.length;

  const scopeDesc =
    mode.scope.type === "gitChanged"
      ? "git-changed files"
      : mode.scope.type === "all"
        ? "all project files"
        : `paths: ${(mode.scope as Extract<ScanScope, { type: "folder" }>).paths.join(", ")}`;

  lines.push(
    `**Scope:** ${scopeDesc} — ${results.scannedFiles.length} file${results.scannedFiles.length !== 1 ? "s" : ""} scanned`,
  );
  for (const f of results.scannedFiles) {
    lines.push(`  - ${f}`);
  }
  lines.push("");

  // Secrets
  if (results.secrets.length === 0) {
    lines.push("**Secret Detection:** No secrets detected.");
  } else {
    lines.push(
      `**Secret Detection:** ${results.secrets.length} potential secret${results.secrets.length !== 1 ? "s" : ""} found:`,
    );
    for (const f of results.secrets) {
      lines.push(
        `- **${f.pattern}** — \`${f.file}:${f.line}\` (partial match: \`${f.match}\`)`,
      );
    }
  }
  lines.push("");

  // Semgrep
  if (results.semgrepSkipped) {
    lines.push(`**Semgrep SAST:** Skipped — ${results.semgrepSkipped}`);
  } else if (results.semgrep.length === 0) {
    lines.push("**Semgrep SAST:** No findings.");
  } else {
    lines.push(
      `**Semgrep SAST:** ${results.semgrep.length} finding${results.semgrep.length !== 1 ? "s" : ""}:`,
    );
    for (const [sev, items] of groupBySeverity(
      results.semgrep,
      (f) => f.severity,
    )) {
      for (const f of items) {
        lines.push(
          `- [${sev}] **${f.ruleId}** — \`${f.file}:${f.line}\`: ${f.message}`,
        );
      }
    }
  }
  lines.push("");

  // Deps
  if (results.depsSkipped) {
    lines.push(`**Dependency Audit:** Skipped — ${results.depsSkipped}`);
  } else if (results.deps.length === 0) {
    lines.push(
      `**Dependency Audit:** No known vulnerabilities.${results.depsManager ? ` (${results.depsManager})` : ""}`,
    );
  } else {
    lines.push(
      `**Dependency Audit:** ${results.deps.length} vulnerable dependenc${results.deps.length !== 1 ? "ies" : "y"}:`,
    );
    for (const [sev, items] of groupBySeverity(
      results.deps,
      (f) => f.severity,
    )) {
      for (const f of items) {
        const advisory = f.advisory ? ` — ${f.advisory}` : "";
        lines.push(
          `- [${sev}] **${f.name}** (${f.version}): ${f.description}${advisory}`,
        );
      }
    }
  }

  lines.push("");
  if (totalFindings === 0) {
    lines.push("**Pre-flight summary:** No static analysis findings.");
  } else {
    const parts: string[] = [];
    if (results.secrets.length > 0)
      parts.push(
        `${results.secrets.length} secret${results.secrets.length !== 1 ? "s" : ""}`,
      );
    if (results.semgrep.length > 0)
      parts.push(`${results.semgrep.length} SAST`);
    if (results.deps.length > 0)
      parts.push(
        `${results.deps.length} dep vuln${results.deps.length !== 1 ? "s" : ""}`,
      );
    lines.push(
      `**Pre-flight summary: ${totalFindings} finding${totalFindings !== 1 ? "s" : ""}** (${parts.join(", ")})`,
    );
  }

  return lines.join("\n");
}

// ─── Arg parser ───────────────────────────────────────────────────────────────

function parseArgs(args: string | undefined): ScanMode {
  const allEnabled: ScanMode = {
    secrets: true,
    semgrep: true,
    deps: true,
    scope: { type: "gitChanged" },
  };

  if (!args?.trim()) return allEnabled;

  const parts = tokenizeSpaceSeparated(args.trim());
  const sub = parts[0]?.toLowerCase();
  if (!sub) return allEnabled;

  switch (sub) {
    case "all":
      return { ...allEnabled, scope: { type: "all" } };
    case "secrets":
      return {
        secrets: true,
        semgrep: false,
        deps: false,
        scope: { type: "gitChanged" },
      };
    case "semgrep":
      return {
        secrets: false,
        semgrep: true,
        deps: false,
        scope: { type: "gitChanged" },
      };
    case "deps":
      return {
        secrets: false,
        semgrep: false,
        deps: true,
        scope: { type: "gitChanged" },
      };
    case "folder": {
      const paths = parts.slice(1);
      if (paths.length === 0) return allEnabled;
      return { ...allEnabled, scope: { type: "folder", paths } };
    }
    default:
      return allEnabled;
  }
}

// ─── Extension ────────────────────────────────────────────────────────────────

export default function securityScanExtension(pi: ExtensionAPI) {
  pi.registerCommand("security-scan", {
    description:
      "Static security scan: secret detection, Semgrep SAST, and dependency audit",
    handler: async (args, ctx: ExtensionCommandContext) => {
      const mode = parseArgs(args);
      const cwd = ctx.cwd;

      // ── Collect files ──
      ctx.ui.notify("Collecting files to scan…", "info");
      let files: string[];

      switch (mode.scope.type) {
        case "gitChanged": {
          files = await getGitChangedFiles(pi, cwd);
          if (files.length === 0) {
            ctx.ui.notify(
              "No git-changed files found, falling back to all tracked files…",
              "info",
            );
            files = await getAllTrackedFiles(pi, cwd);
          }
          break;
        }
        case "all": {
          files = await getAllTrackedFiles(pi, cwd);
          break;
        }
        case "folder": {
          files = await getFolderFiles(mode.scope.paths, cwd);
          break;
        }
      }

      const results: ScanResults = {
        scannedFiles: files.map((f) => path.relative(cwd, f)),
        secrets: [],
        semgrep: [],
        deps: [],
      };

      // ── Run scans ──
      if (mode.secrets) {
        ctx.ui.notify("Running secret detection…", "info");
        results.secrets = await scanSecrets(files, cwd);
      }

      if (mode.semgrep) {
        ctx.ui.notify("Running Semgrep SAST…", "info");
        const { findings, skipped } = await scanSemgrep(
          pi,
          files,
          mode.scope,
          cwd,
        );
        results.semgrep = findings;
        results.semgrepSkipped = skipped;
      }

      if (mode.deps) {
        ctx.ui.notify("Running dependency audit…", "info");
        const { findings, manager, skipped } = await scanDeps(pi, cwd);
        results.deps = findings;
        results.depsManager = manager;
        results.depsSkipped = skipped;
      }

      const report = formatResults(results, mode);
      console.log("\n" + report);
      pi.sendUserMessage(report);
    },
  });
}
