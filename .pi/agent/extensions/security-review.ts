/**
 * Security Review Extension
 *
 * Provides a `/security-review` command that performs OWASP Top 10 and
 * security-focused code reviews. Uses the same review target infrastructure
 * as /review (PR, branch, commit, uncommitted, folder, custom) but replaces
 * the general review rubric with a security-specific one.
 *
 * Usage:
 * - `/security-review` - show interactive selector
 * - `/security-review pr 123` - security review PR #123
 * - `/security-review pr https://github.com/owner/repo/pull/123` - review PR from URL
 * - `/security-review uncommitted` - review uncommitted changes
 * - `/security-review branch main` - review against main branch
 * - `/security-review commit abc123` - review specific commit
 * - `/security-review folder src docs` - review specific folders/files (snapshot, not diff)
 * - `/security-review custom "check auth flow"` - custom security instructions
 *
 * Project-specific security review guidelines:
 * - If a SECURITY_REVIEW_GUIDELINES.md file exists in the same directory as .pi,
 *   its contents are appended to the security review prompt.
 * - Falls back to REVIEW_GUIDELINES.md if no security-specific file exists.
 *
 * Note: PR review requires a clean working tree (no uncommitted changes to tracked files).
 */

import type {
  ExtensionAPI,
  ExtensionContext,
  ExtensionCommandContext,
} from "@mariozechner/pi-coding-agent";
import { DynamicBorder, BorderedLoader } from "@mariozechner/pi-coding-agent";
import {
  Container,
  type SelectItem,
  SelectList,
  Text,
} from "@mariozechner/pi-tui";
import path from "node:path";
import { promises as fs } from "node:fs";
import {
  hasUpstreamTrackingBranch,
  isSelectListActionInput,
  parseReviewPathsInput,
  tokenizeSpaceSeparated,
} from "./_shared/review-utils.js";
import {
  BASE_BRANCH_PROMPT_FALLBACK as SHARED_BASE_BRANCH_PROMPT_FALLBACK,
  BASE_BRANCH_PROMPT_WITH_MERGE_BASE as SHARED_BASE_BRANCH_PROMPT_WITH_MERGE_BASE,
  COMMIT_PROMPT as SHARED_COMMIT_PROMPT,
  COMMIT_PROMPT_WITH_TITLE as SHARED_COMMIT_PROMPT_WITH_TITLE,
  FOLDER_REVIEW_MODE_OVERRIDE as SHARED_FOLDER_REVIEW_MODE_OVERRIDE,
  FOLDER_REVIEW_PROMPT as SHARED_FOLDER_REVIEW_PROMPT,
  PULL_REQUEST_PROMPT as SHARED_PULL_REQUEST_PROMPT,
  PULL_REQUEST_PROMPT_FALLBACK as SHARED_PULL_REQUEST_PROMPT_FALLBACK,
  UNCOMMITTED_PROMPT as SHARED_UNCOMMITTED_PROMPT,
} from "./_shared/review-prompts.js";

// ─── Module-level state ──────────────────────────────────────────────────────
let securityReviewOriginId: string | undefined = undefined;
let endSecurityReviewInProgress = false;

const SECURITY_REVIEW_STATE_TYPE = "security-review-session";

type SecurityReviewSessionState = {
  active: boolean;
  originId?: string;
};

// ─── Widget / state helpers ──────────────────────────────────────────────────

function setSecurityReviewWidget(ctx: ExtensionContext, active: boolean) {
  if (!ctx.hasUI) return;
  if (!active) {
    ctx.ui.setWidget("security-review", undefined);
    return;
  }

  ctx.ui.setWidget("security-review", (_tui, theme) => {
    const text = new Text(
      theme.fg(
        "warning",
        "Security review session active, return with /end-security-review",
      ),
      0,
      0,
    );
    return {
      render(width: number) {
        return text.render(width);
      },
      invalidate() {
        text.invalidate();
      },
    };
  });
}

function getSecurityReviewState(
  ctx: ExtensionContext,
): SecurityReviewSessionState | undefined {
  let state: SecurityReviewSessionState | undefined;
  for (const entry of ctx.sessionManager.getBranch()) {
    if (
      entry.type === "custom" &&
      entry.customType === SECURITY_REVIEW_STATE_TYPE
    ) {
      state = entry.data as SecurityReviewSessionState | undefined;
    }
  }
  return state;
}

function applySecurityReviewState(ctx: ExtensionContext) {
  const state = getSecurityReviewState(ctx);

  if (state?.active && state.originId) {
    securityReviewOriginId = state.originId;
    setSecurityReviewWidget(ctx, true);
    return;
  }

  securityReviewOriginId = undefined;
  setSecurityReviewWidget(ctx, false);
}

// ─── Review target types (same as /review) ───────────────────────────────────

type ReviewTarget =
  | { type: "uncommitted" }
  | { type: "baseBranch"; branch: string }
  | { type: "commit"; sha: string; title?: string }
  | { type: "custom"; instructions: string }
  | { type: "pullRequest"; prNumber: number; baseBranch: string; title: string }
  | { type: "folder"; paths: string[] };

// ─── Shared target prompts ───────────────────────────────────────────────────

const UNCOMMITTED_PROMPT = SHARED_UNCOMMITTED_PROMPT;
const BASE_BRANCH_PROMPT_WITH_MERGE_BASE =
  SHARED_BASE_BRANCH_PROMPT_WITH_MERGE_BASE;
const BASE_BRANCH_PROMPT_FALLBACK = SHARED_BASE_BRANCH_PROMPT_FALLBACK;
const COMMIT_PROMPT_WITH_TITLE = SHARED_COMMIT_PROMPT_WITH_TITLE;
const COMMIT_PROMPT = SHARED_COMMIT_PROMPT;
const PULL_REQUEST_PROMPT = SHARED_PULL_REQUEST_PROMPT;
const PULL_REQUEST_PROMPT_FALLBACK = SHARED_PULL_REQUEST_PROMPT_FALLBACK;
const FOLDER_REVIEW_PROMPT = SHARED_FOLDER_REVIEW_PROMPT;
const FOLDER_REVIEW_MODE_OVERRIDE = SHARED_FOLDER_REVIEW_MODE_OVERRIDE;

// ─── Security-focused review rubric ──────────────────────────────────────────

const SECURITY_REVIEW_RUBRIC = `# Security Review Guidelines

You are acting as a **security reviewer** for a proposed code change. Your job is to identify
security vulnerabilities, insecure patterns, and violations of security best practices.

Focus exclusively on security. Ignore style, performance, or general code-quality issues
unless they have a direct security impact.

## OWASP Top 10 (2021) Checklist

Evaluate every change against the following categories. If a category is not applicable to the
change, skip it silently — do not list it as "N/A".

### A01: Broken Access Control
- Missing or incorrect authorization checks (role/permission verification).
- Insecure Direct Object References (IDOR) — can a user manipulate an ID to access another user's data?
- Path traversal / directory traversal in file operations.
- CORS misconfiguration allowing unauthorized origins.
- Missing access control on API endpoints, admin panels, or internal routes.
- Elevation of privilege — acting as a user without being logged in, or acting as admin without admin role.
- Force browsing to authenticated/privileged pages.

### A02: Cryptographic Failures
- Sensitive data transmitted in cleartext (HTTP, FTP, SMTP without TLS).
- Weak, deprecated, or improperly used cryptographic algorithms (MD5, SHA-1 for security, DES, RC4).
- Hard-coded encryption keys, IVs, or salts.
- Missing or weak password hashing (plain text, simple hash without salt/work factor; require bcrypt/scrypt/argon2).
- Insufficient key length (RSA < 2048, symmetric < 128-bit).
- Disabled or improperly configured TLS certificate validation.
- Use of ECB mode, deterministic encryption where randomized is needed.
- Missing encryption at rest for PII, credentials, financial data, health data.

### A03: Injection
- SQL injection — string concatenation or template literals in queries instead of parameterized statements.
- NoSQL injection — unsanitized user input in MongoDB/document-DB queries.
- OS command injection — user input passed to \`exec\`, \`spawn\`, \`system\`, shell commands.
- LDAP, XPath, or expression-language injection.
- Server-Side Template Injection (SSTI).
- Log injection / log forging — unsanitized input written to logs.
- Header injection (CRLF injection in HTTP headers).
- **Escape, don't sanitize** when you have the option (e.g. HTML escaping > stripping tags).

### A04: Insecure Design
- Missing rate limiting on authentication, password reset, or expensive operations.
- Missing or weak CSRF protection on state-changing operations.
- Business logic flaws that allow bypassing payment, quotas, or access restrictions.
- Missing input validation at trust boundaries (API surface, deserialization points).
- Race conditions / TOCTOU bugs that can be exploited.
- Missing abuse-case handling (e.g., no brute-force protection).

### A05: Security Misconfiguration
- Debug mode, verbose errors, or stack traces exposed in production.
- Default credentials or accounts left enabled.
- Unnecessary features, ports, services, or pages enabled.
- Missing security headers (Content-Security-Policy, X-Content-Type-Options, Strict-Transport-Security, X-Frame-Options, Permissions-Policy).
- Overly permissive CORS policies (\`*\` origin, credentials with wildcard).
- Directory listing enabled.
- Misconfigured cloud permissions (S3 buckets, IAM roles, security groups).
- XML external entity (XXE) processing enabled.

### A06: Vulnerable and Outdated Components
- Known-vulnerable dependency versions (flag if the change adds or pins a version with known CVEs).
- Unmaintained or abandoned libraries being newly introduced.
- Components pulled from untrusted sources.
- Missing integrity checks (SRI hashes, lockfile integrity).

### A07: Identification and Authentication Failures
- Weak password policies (no minimum length, no complexity, no breach-list check).
- Missing multi-factor authentication on sensitive operations.
- Session tokens in URLs.
- Session fixation — not rotating session ID after login.
- Missing session expiration or idle timeout.
- Credential stuffing / brute-force unprotected (no rate limit, no account lockout, no CAPTCHA).
- Insecure "remember me" implementation.
- Passwords or tokens logged or included in error messages.

### A08: Software and Data Integrity Failures
- Deserialization of untrusted data (Java serialization, pickle, YAML.load, eval of JSON-like input).
- Missing code or artifact signature verification in CI/CD.
- Auto-update without integrity verification.
- Insecure CI/CD pipeline (secrets in logs, unprotected deployment triggers).
- Prototype pollution (JavaScript/TypeScript: merging user-controlled objects into prototypes).

### A09: Security Logging and Monitoring Failures
- Authentication events (login, failed login, logout) not logged.
- Authorization failures not logged.
- Sensitive data (passwords, tokens, PII) written to logs.
- Log injection possible (user input echoed to logs unsanitized).
- Missing audit trail for high-value transactions.

### A10: Server-Side Request Forgery (SSRF)
- User-supplied URLs fetched server-side without validation.
- Missing allowlist for outbound requests.
- DNS rebinding not mitigated (resolve, then connect to resolved IP; or pin DNS).
- Internal/private IP ranges (127.0.0.0/8, 10.0.0.0/8, 169.254.169.254, 172.16.0.0/12, 192.168.0.0/16, ::1, fd00::/8) not blocked.
- Redirect-following that can be tricked into hitting internal services.

## Additional Security Checks

### Secrets & Credentials
- Hard-coded API keys, tokens, passwords, or connection strings.
- Secrets committed to version control (.env files, config files with credentials).
- Secrets in client-side / frontend code.
- Missing \`.gitignore\` entries for secret files.

### Input Handling
- Open redirects — user-controlled redirect targets not validated against an allowlist of trusted domains.
- Unvalidated file uploads (missing type check, size limit, content validation).
- Path traversal in user-supplied filenames (\`../\`, null bytes).
- ReDoS-vulnerable regular expressions applied to user input.
- Missing Content-Type / Accept header validation.

### Browser / Client-Side Security
- Cross-Site Scripting (XSS) — user input rendered without escaping in HTML, JavaScript, or attributes.
- DOM-based XSS — \`innerHTML\`, \`document.write\`, \`eval()\` with user-controlled data.
- Missing HttpOnly / Secure / SameSite flags on sensitive cookies.
- Sensitive data stored in localStorage/sessionStorage.
- Clickjacking protection missing (X-Frame-Options, CSP frame-ancestors).
- Postmessage handlers without origin verification.

### Infrastructure & Deployment
- Containers running as root.
- Overly permissive file permissions on secrets (world-readable).
- Missing network segmentation (database exposed to public internet).
- Disabled or ineffective firewall rules.

## Comment Guidelines

1. Be specific about the vulnerability class and attack vector.
2. Include a concrete exploitation scenario (one sentence) where possible.
3. Reference CWE IDs when applicable (e.g. CWE-89 for SQL injection).
4. Communicate severity accurately — do not exaggerate or downplay.
5. Be brief — at most 1 paragraph per finding.
6. Use \`\`\`suggestion blocks ONLY for concrete fix code (minimal lines; no commentary inside). Preserve exact leading whitespace.
7. Use a matter-of-fact tone — helpful security advisor, not accusatory.

## Priority Levels

Tag each finding with a priority level:
- **[P0]** — Critical. Actively exploitable in production. Blocks release.
  Examples: SQL injection, RCE, auth bypass, exposed secrets.
- **[P1]** — High. Exploitable under realistic conditions. Fix before merge.
  Examples: XSS, CSRF, SSRF, missing authorization checks, weak crypto.
- **[P2]** — Medium. Defense-in-depth issue or requires unusual conditions to exploit.
  Examples: missing security headers, verbose error messages, weak session config.
- **[P3]** — Low / Informational. Best-practice violation unlikely to be exploited alone.
  Examples: missing SRI hashes, overly broad try/catch hiding errors, minor logging gaps.

## Output Format

1. List each finding with its priority tag, OWASP category (if applicable), CWE, file location, and explanation.
2. Findings must reference locations that overlap with the actual diff — do not flag pre-existing code (unless in snapshot/folder mode).
3. Keep line references precise (avoid ranges over 5-10 lines).
4. Group findings by OWASP category when there are many.
5. At the end, provide a **security verdict**:
   - **"secure"** — No blocking security issues found.
   - **"needs remediation"** — Has security issues that should be addressed before merge.
6. If no security issues are found, explicitly state the change looks secure from a security perspective.
7. Do not generate full fixes — only flag issues and optionally provide short suggestion blocks.

Output ALL security findings. Do not stop at the first issue — list every qualifying vulnerability.`;

// ─── Project guidelines loader ───────────────────────────────────────────────

async function loadSecurityReviewGuidelines(
  cwd: string,
): Promise<string | null> {
  let currentDir = path.resolve(cwd);

  while (true) {
    const piDir = path.join(currentDir, ".pi");
    const securityPath = path.join(currentDir, "SECURITY_REVIEW_GUIDELINES.md");
    const fallbackPath = path.join(currentDir, "REVIEW_GUIDELINES.md");

    const piStats = await fs.stat(piDir).catch(() => null);
    if (piStats?.isDirectory()) {
      // Prefer security-specific guidelines
      for (const guidelinesPath of [securityPath, fallbackPath]) {
        const guidelineStats = await fs.stat(guidelinesPath).catch(() => null);
        if (guidelineStats?.isFile()) {
          try {
            const content = await fs.readFile(guidelinesPath, "utf8");
            const trimmed = content.trim();
            return trimmed ? trimmed : null;
          } catch {
            return null;
          }
        }
      }
      return null;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      return null;
    }
    currentDir = parentDir;
  }
}

// ─── Git helpers (same as review.ts) ─────────────────────────────────────────

async function getMergeBase(
  pi: ExtensionAPI,
  branch: string,
): Promise<string | null> {
  try {
    const { stdout: upstream, code: upstreamCode } = await pi.exec("git", [
      "rev-parse",
      "--abbrev-ref",
      `${branch}@{upstream}`,
    ]);

    if (upstreamCode === 0 && upstream.trim()) {
      const { stdout: mergeBase, code } = await pi.exec("git", [
        "merge-base",
        "HEAD",
        upstream.trim(),
      ]);
      if (code === 0 && mergeBase.trim()) {
        return mergeBase.trim();
      }
    }

    const { stdout: mergeBase, code } = await pi.exec("git", [
      "merge-base",
      "HEAD",
      branch,
    ]);
    if (code === 0 && mergeBase.trim()) {
      return mergeBase.trim();
    }

    return null;
  } catch {
    return null;
  }
}

async function getLocalBranches(pi: ExtensionAPI): Promise<string[]> {
  const { stdout, code } = await pi.exec("git", [
    "branch",
    "--format=%(refname:short)",
  ]);
  if (code !== 0) return [];
  return stdout
    .trim()
    .split("\n")
    .filter((b) => b.trim());
}

async function getRecentCommits(
  pi: ExtensionAPI,
  limit: number = 10,
): Promise<Array<{ sha: string; title: string }>> {
  const { stdout, code } = await pi.exec("git", [
    "log",
    `--oneline`,
    `-n`,
    `${limit}`,
  ]);
  if (code !== 0) return [];

  return stdout
    .trim()
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => {
      const [sha, ...rest] = line.trim().split(" ");
      return { sha, title: rest.join(" ") };
    });
}

async function hasUncommittedChanges(pi: ExtensionAPI): Promise<boolean> {
  const { stdout, code } = await pi.exec("git", ["status", "--porcelain"]);
  return code === 0 && stdout.trim().length > 0;
}

async function hasPendingChanges(pi: ExtensionAPI): Promise<boolean> {
  const { stdout, code } = await pi.exec("git", ["status", "--porcelain"]);
  if (code !== 0) return false;
  const lines = stdout
    .trim()
    .split("\n")
    .filter((line) => line.trim());
  const trackedChanges = lines.filter((line) => !line.startsWith("??"));
  return trackedChanges.length > 0;
}

function parsePrReference(ref: string): number | null {
  const trimmed = ref.trim();
  const num = parseInt(trimmed, 10);
  if (!isNaN(num) && num > 0) {
    return num;
  }
  const urlMatch = trimmed.match(/github\.com\/[^/]+\/[^/]+\/pull\/(\d+)/);
  if (urlMatch) {
    return parseInt(urlMatch[1], 10);
  }
  return null;
}

async function getPrInfo(
  pi: ExtensionAPI,
  prNumber: number,
): Promise<{ baseBranch: string; title: string; headBranch: string } | null> {
  const { stdout, code } = await pi.exec("gh", [
    "pr",
    "view",
    String(prNumber),
    "--json",
    "baseRefName,title,headRefName",
  ]);
  if (code !== 0) return null;
  try {
    const data = JSON.parse(stdout);
    return {
      baseBranch: data.baseRefName,
      title: data.title,
      headBranch: data.headRefName,
    };
  } catch {
    return null;
  }
}

async function checkoutPr(
  pi: ExtensionAPI,
  prNumber: number,
): Promise<{ success: boolean; error?: string }> {
  const { stdout, stderr, code } = await pi.exec("gh", [
    "pr",
    "checkout",
    String(prNumber),
  ]);
  if (code !== 0) {
    return {
      success: false,
      error: stderr || stdout || "Failed to checkout PR",
    };
  }
  return { success: true };
}

async function getCurrentBranch(pi: ExtensionAPI): Promise<string | null> {
  const { stdout, code } = await pi.exec("git", ["branch", "--show-current"]);
  if (code === 0 && stdout.trim()) {
    return stdout.trim();
  }
  return null;
}

async function getDefaultBranch(pi: ExtensionAPI): Promise<string> {
  const { stdout, code } = await pi.exec("git", [
    "symbolic-ref",
    "refs/remotes/origin/HEAD",
    "--short",
  ]);
  if (code === 0 && stdout.trim()) {
    return stdout.trim().replace("origin/", "");
  }
  const branches = await getLocalBranches(pi);
  if (branches.includes("main")) return "main";
  if (branches.includes("master")) return "master";
  return "main";
}

// ─── Prompt builder ──────────────────────────────────────────────────────────

async function buildReviewPrompt(
  pi: ExtensionAPI,
  target: ReviewTarget,
): Promise<string> {
  switch (target.type) {
    case "uncommitted":
      return UNCOMMITTED_PROMPT;

    case "baseBranch": {
      const mergeBase = await getMergeBase(pi, target.branch);
      if (mergeBase) {
        return BASE_BRANCH_PROMPT_WITH_MERGE_BASE.replace(
          /{baseBranch}/g,
          target.branch,
        ).replace(/{mergeBaseSha}/g, mergeBase);
      }
      return BASE_BRANCH_PROMPT_FALLBACK.replace(/{branch}/g, target.branch);
    }

    case "commit":
      if (target.title) {
        return COMMIT_PROMPT_WITH_TITLE.replace("{sha}", target.sha).replace(
          "{title}",
          target.title,
        );
      }
      return COMMIT_PROMPT.replace("{sha}", target.sha);

    case "custom":
      return target.instructions;

    case "pullRequest": {
      const mergeBase = await getMergeBase(pi, target.baseBranch);
      if (mergeBase) {
        return PULL_REQUEST_PROMPT.replace(
          /{prNumber}/g,
          String(target.prNumber),
        )
          .replace(/{title}/g, target.title)
          .replace(/{baseBranch}/g, target.baseBranch)
          .replace(/{mergeBaseSha}/g, mergeBase);
      }
      return PULL_REQUEST_PROMPT_FALLBACK.replace(
        /{prNumber}/g,
        String(target.prNumber),
      )
        .replace(/{title}/g, target.title)
        .replace(/{baseBranch}/g, target.baseBranch);
    }

    case "folder":
      return FOLDER_REVIEW_PROMPT.replace("{paths}", target.paths.join(", "));
  }
}

function getUserFacingHint(target: ReviewTarget): string {
  switch (target.type) {
    case "uncommitted":
      return "current changes";
    case "baseBranch":
      return `changes against '${target.branch}'`;
    case "commit": {
      const shortSha = target.sha.slice(0, 7);
      return target.title
        ? `commit ${shortSha}: ${target.title}`
        : `commit ${shortSha}`;
    }
    case "custom":
      return target.instructions.length > 40
        ? target.instructions.slice(0, 37) + "..."
        : target.instructions;
    case "pullRequest": {
      const shortTitle =
        target.title.length > 30
          ? target.title.slice(0, 27) + "..."
          : target.title;
      return `PR #${target.prNumber}: ${shortTitle}`;
    }
    case "folder": {
      const joined = target.paths.join(", ");
      return joined.length > 40
        ? `folders: ${joined.slice(0, 37)}...`
        : `folders: ${joined}`;
    }
  }
}

// ─── Review preset options ───────────────────────────────────────────────────

const REVIEW_PRESETS = [
  {
    value: "uncommitted",
    label: "Security review uncommitted changes",
    description: "",
  },
  {
    value: "baseBranch",
    label: "Security review against a base branch",
    description: "(local)",
  },
  { value: "commit", label: "Security review a commit", description: "" },
  {
    value: "pullRequest",
    label: "Security review a pull request",
    description: "(GitHub PR)",
  },
  {
    value: "folder",
    label: "Security review a folder (or more)",
    description: "(snapshot, not diff)",
  },
  {
    value: "custom",
    label: "Custom security review instructions",
    description: "",
  },
] as const;

// ─── Extension ───────────────────────────────────────────────────────────────

export default function securityReviewExtension(pi: ExtensionAPI) {
  // ── Session lifecycle ────────────────────────────────────────────────────

  pi.on("session_start", (_event, ctx) => {
    applySecurityReviewState(ctx);
  });

  pi.on("session_switch", (_event, ctx) => {
    applySecurityReviewState(ctx);
  });

  pi.on("session_tree", (_event, ctx) => {
    applySecurityReviewState(ctx);
  });

  // ── Smart default ────────────────────────────────────────────────────────

  async function getSmartDefault(): Promise<
    "uncommitted" | "baseBranch" | "commit"
  > {
    if (await hasUncommittedChanges(pi)) {
      return "uncommitted";
    }
    const currentBranch = await getCurrentBranch(pi);
    const defaultBranch = await getDefaultBranch(pi);
    if (currentBranch && currentBranch !== defaultBranch) {
      return "baseBranch";
    }
    return "commit";
  }

  // ── UI: preset selector ──────────────────────────────────────────────────

  async function showReviewSelector(
    ctx: ExtensionContext,
  ): Promise<ReviewTarget | null> {
    const smartDefault = await getSmartDefault();
    const items: SelectItem[] = REVIEW_PRESETS.map((preset) => ({
      value: preset.value,
      label: preset.label,
      description: preset.description,
    }));
    const smartDefaultIndex = items.findIndex(
      (item) => item.value === smartDefault,
    );

    while (true) {
      const result = await ctx.ui.custom<string | null>(
        (tui, theme, _kb, done) => {
          const container = new Container();
          container.addChild(
            new DynamicBorder((str) => theme.fg("accent", str)),
          );
          container.addChild(
            new Text(
              theme.fg("accent", theme.bold("Select a security review target")),
            ),
          );

          const selectList = new SelectList(items, Math.min(items.length, 10), {
            selectedPrefix: (text) => theme.fg("accent", text),
            selectedText: (text) => theme.fg("accent", text),
            description: (text) => theme.fg("muted", text),
            scrollInfo: (text) => theme.fg("dim", text),
            noMatch: (text) => theme.fg("warning", text),
          });

          if (smartDefaultIndex >= 0) {
            selectList.setSelectedIndex(smartDefaultIndex);
          }

          selectList.onSelect = (item) => done(item.value);
          selectList.onCancel = () => done(null);

          container.addChild(selectList);
          container.addChild(
            new Text(
              theme.fg("dim", "Press enter to confirm or esc to go back"),
            ),
          );
          container.addChild(
            new DynamicBorder((str) => theme.fg("accent", str)),
          );

          return {
            render(width: number) {
              return container.render(width);
            },
            invalidate() {
              container.invalidate();
            },
            handleInput(data: string) {
              selectList.handleInput(data);
              tui.requestRender();
            },
          };
        },
      );

      if (!result) return null;

      switch (result) {
        case "uncommitted":
          return { type: "uncommitted" };
        case "baseBranch": {
          const target = await showBranchSelector(ctx);
          if (target) return target;
          break;
        }
        case "commit": {
          const target = await showCommitSelector(ctx);
          if (target) return target;
          break;
        }
        case "custom": {
          const target = await showCustomInput(ctx);
          if (target) return target;
          break;
        }
        case "folder": {
          const target = await showFolderInput(ctx);
          if (target) return target;
          break;
        }
        case "pullRequest": {
          const target = await showPrInput(ctx);
          if (target) return target;
          break;
        }
        default:
          return null;
      }
    }
  }

  // ── UI: branch selector ──────────────────────────────────────────────────

  async function showBranchSelector(
    ctx: ExtensionContext,
  ): Promise<ReviewTarget | null> {
    const branches = await getLocalBranches(pi);
    const currentBranch = await getCurrentBranch(pi);
    const defaultBranch = await getDefaultBranch(pi);
    const currentBranchHasUpstream = currentBranch
      ? await hasUpstreamTrackingBranch(pi, currentBranch)
      : false;

    const candidateBranches =
      currentBranch && !currentBranchHasUpstream
        ? branches.filter((b) => b !== currentBranch)
        : branches;

    if (candidateBranches.length === 0) {
      ctx.ui.notify(
        currentBranch
          ? `No other branches found (current branch: ${currentBranch})`
          : "No branches found",
        "error",
      );
      return null;
    }

    const sortedBranches = [...candidateBranches].sort((a, b) => {
      if (a === defaultBranch) return -1;
      if (b === defaultBranch) return 1;
      return a.localeCompare(b);
    });

    const items: SelectItem[] = sortedBranches.map((branch) => {
      const tags: string[] = [];
      if (branch === defaultBranch) tags.push("default");
      if (currentBranchHasUpstream && branch === currentBranch) {
        tags.push("current (uses upstream)");
      }
      return {
        value: branch,
        label: branch,
        description: tags.length > 0 ? `(${tags.join(", ")})` : "",
      };
    });

    const result = await ctx.ui.custom<string | null>(
      (tui, theme, _kb, done) => {
        const container = new Container();
        container.addChild(new DynamicBorder((str) => theme.fg("accent", str)));
        container.addChild(
          new Text(theme.fg("accent", theme.bold("Select base branch"))),
        );

        const selectList = new SelectList(items, Math.min(items.length, 10), {
          selectedPrefix: (text) => theme.fg("accent", text),
          selectedText: (text) => theme.fg("accent", text),
          description: (text) => theme.fg("muted", text),
          scrollInfo: (text) => theme.fg("dim", text),
          noMatch: (text) => theme.fg("warning", text),
        });

        let filter = "";
        const filterLine = new Text(
          theme.fg("dim", "Filter: (type to filter)"),
        );

        const applyFilter = () => {
          selectList.setFilter(filter);
          filterLine.setText(
            theme.fg(
              "dim",
              `Filter: ${filter.length > 0 ? filter : "(type to filter)"}`,
            ),
          );
        };

        selectList.onSelect = (item) => done(item.value);
        selectList.onCancel = () => done(null);

        container.addChild(filterLine);
        container.addChild(selectList);
        container.addChild(
          new Text(
            theme.fg(
              "dim",
              "Type to filter • ↑↓ navigate • enter to select • esc to cancel",
            ),
          ),
        );
        container.addChild(new DynamicBorder((str) => theme.fg("accent", str)));

        return {
          render(width: number) {
            return container.render(width);
          },
          invalidate() {
            container.invalidate();
          },
          handleInput(data: string) {
            if (isSelectListActionInput(data)) {
              selectList.handleInput(data);
            } else if (data.length === 1 && data >= " " && data !== "\x7f") {
              filter += data;
              applyFilter();
            } else if (data === "\x7f" || data === "\b") {
              filter = filter.slice(0, -1);
              applyFilter();
            } else if (data === "\x15") {
              filter = "";
              applyFilter();
            } else {
              selectList.handleInput(data);
            }
            tui.requestRender();
          },
        };
      },
    );

    if (!result) return null;
    return { type: "baseBranch", branch: result };
  }

  // ── UI: commit selector ──────────────────────────────────────────────────

  async function showCommitSelector(
    ctx: ExtensionContext,
  ): Promise<ReviewTarget | null> {
    const commits = await getRecentCommits(pi, 20);

    if (commits.length === 0) {
      ctx.ui.notify("No commits found", "error");
      return null;
    }

    const commitByFilterKey = new Map<string, { sha: string; title: string }>();
    const items: SelectItem[] = commits.map((commit) => {
      const filterKey = `${commit.title} ${commit.sha}`;
      commitByFilterKey.set(filterKey, commit);
      return {
        value: filterKey,
        label: `${commit.sha.slice(0, 7)} ${commit.title}`,
        description: "",
      };
    });

    const result = await ctx.ui.custom<{ sha: string; title: string } | null>(
      (tui, theme, _kb, done) => {
        const container = new Container();
        container.addChild(new DynamicBorder((str) => theme.fg("accent", str)));
        container.addChild(
          new Text(
            theme.fg("accent", theme.bold("Select commit to security review")),
          ),
        );

        const selectList = new SelectList(items, Math.min(items.length, 10), {
          selectedPrefix: (text) => theme.fg("accent", text),
          selectedText: (text) => theme.fg("accent", text),
          description: (text) => theme.fg("muted", text),
          scrollInfo: (text) => theme.fg("dim", text),
          noMatch: (text) => theme.fg("warning", text),
        });

        let filter = "";
        const filterLine = new Text(
          theme.fg("dim", "Filter: (type title prefix)"),
        );

        const applyFilter = () => {
          selectList.setFilter(filter);
          filterLine.setText(
            theme.fg(
              "dim",
              `Filter: ${filter.length > 0 ? filter : "(type title prefix)"}`,
            ),
          );
        };

        selectList.onSelect = (item) => {
          const commit = commitByFilterKey.get(item.value);
          done(commit ?? null);
        };
        selectList.onCancel = () => done(null);

        container.addChild(filterLine);
        container.addChild(selectList);
        container.addChild(
          new Text(
            theme.fg(
              "dim",
              "Type title prefix to filter • ↑↓ navigate • enter to select • esc to cancel",
            ),
          ),
        );
        container.addChild(new DynamicBorder((str) => theme.fg("accent", str)));

        return {
          render(width: number) {
            return container.render(width);
          },
          invalidate() {
            container.invalidate();
          },
          handleInput(data: string) {
            if (isSelectListActionInput(data)) {
              selectList.handleInput(data);
            } else if (data.length === 1 && data >= " " && data !== "\x7f") {
              filter += data;
              applyFilter();
            } else if (data === "\x7f" || data === "\b") {
              filter = filter.slice(0, -1);
              applyFilter();
            } else if (data === "\x15") {
              filter = "";
              applyFilter();
            } else {
              selectList.handleInput(data);
            }
            tui.requestRender();
          },
        };
      },
    );

    if (!result) return null;
    return { type: "commit", sha: result.sha, title: result.title };
  }

  // ── UI: custom input ─────────────────────────────────────────────────────

  async function showCustomInput(
    ctx: ExtensionContext,
  ): Promise<ReviewTarget | null> {
    const result = await ctx.ui.editor(
      "Enter security review instructions:",
      "Review the authentication flow for bypass vulnerabilities...",
    );

    if (!result?.trim()) return null;
    return { type: "custom", instructions: result.trim() };
  }

  // ── UI: folder input ─────────────────────────────────────────────────────

  async function showFolderInput(
    ctx: ExtensionContext,
  ): Promise<ReviewTarget | null> {
    const result = await ctx.ui.editor(
      "Enter folders/files to security review (space-separated; quote/escape paths with spaces; or one per line):",
      ".",
    );

    if (!result?.trim()) return null;
    const paths = parseReviewPathsInput(result);
    if (paths.length === 0) return null;

    return { type: "folder", paths };
  }

  // ── UI: PR input ─────────────────────────────────────────────────────────

  async function showPrInput(
    ctx: ExtensionContext,
  ): Promise<ReviewTarget | null> {
    if (await hasPendingChanges(pi)) {
      ctx.ui.notify(
        "Cannot checkout PR: you have uncommitted changes. Please commit or stash them first.",
        "error",
      );
      return null;
    }

    const prRef = await ctx.ui.editor(
      "Enter PR number or URL (e.g. 123 or https://github.com/owner/repo/pull/123):",
      "",
    );

    if (!prRef?.trim()) return null;

    const prNumber = parsePrReference(prRef);
    if (!prNumber) {
      ctx.ui.notify(
        "Invalid PR reference. Enter a number or GitHub PR URL.",
        "error",
      );
      return null;
    }

    ctx.ui.notify(`Fetching PR #${prNumber} info...`, "info");
    const prInfo = await getPrInfo(pi, prNumber);

    if (!prInfo) {
      ctx.ui.notify(
        `Could not find PR #${prNumber}. Make sure gh is authenticated and the PR exists.`,
        "error",
      );
      return null;
    }

    if (await hasPendingChanges(pi)) {
      ctx.ui.notify(
        "Cannot checkout PR: you have uncommitted changes. Please commit or stash them first.",
        "error",
      );
      return null;
    }

    ctx.ui.notify(`Checking out PR #${prNumber}...`, "info");
    const checkoutResult = await checkoutPr(pi, prNumber);

    if (!checkoutResult.success) {
      ctx.ui.notify(`Failed to checkout PR: ${checkoutResult.error}`, "error");
      return null;
    }

    ctx.ui.notify(`Checked out PR #${prNumber} (${prInfo.headBranch})`, "info");

    return {
      type: "pullRequest",
      prNumber,
      baseBranch: prInfo.baseBranch,
      title: prInfo.title,
    };
  }

  // ── Execute review ───────────────────────────────────────────────────────

  async function executeSecurityReview(
    ctx: ExtensionCommandContext,
    target: ReviewTarget,
    useFreshSession: boolean,
  ): Promise<void> {
    if (securityReviewOriginId) {
      ctx.ui.notify(
        "Already in a security review. Use /end-security-review to finish first.",
        "warning",
      );
      return;
    }

    if (useFreshSession) {
      const originId = ctx.sessionManager.getLeafId() ?? undefined;
      if (!originId) {
        ctx.ui.notify(
          "Failed to determine review origin. Try again from a session with messages.",
          "error",
        );
        return;
      }
      securityReviewOriginId = originId;
      const lockedOriginId = originId;

      const entries = ctx.sessionManager.getEntries();
      const firstUserMessage = entries.find(
        (e) => e.type === "message" && e.message.role === "user",
      );

      if (!firstUserMessage) {
        ctx.ui.notify("No user message found in session", "error");
        securityReviewOriginId = undefined;
        return;
      }

      try {
        const result = await ctx.navigateTree(firstUserMessage.id, {
          summarize: false,
          label: "security-review",
        });
        if (result.cancelled) {
          securityReviewOriginId = undefined;
          return;
        }
      } catch (error) {
        securityReviewOriginId = undefined;
        ctx.ui.notify(
          `Failed to start security review: ${error instanceof Error ? error.message : String(error)}`,
          "error",
        );
        return;
      }

      securityReviewOriginId = lockedOriginId;
      ctx.ui.setEditorText("");
      setSecurityReviewWidget(ctx, true);

      pi.appendEntry(SECURITY_REVIEW_STATE_TYPE, {
        active: true,
        originId: lockedOriginId,
      });
    }

    const prompt = await buildReviewPrompt(pi, target);
    const hint = getUserFacingHint(target);
    const projectGuidelines = await loadSecurityReviewGuidelines(ctx.cwd);

    let fullPrompt = `${SECURITY_REVIEW_RUBRIC}\n\n---\n\nPlease perform a **security-focused code review** with the following target:\n\n${prompt}`;

    if (projectGuidelines) {
      fullPrompt += `\n\nThis project has additional security review guidelines:\n\n${projectGuidelines}`;
    }

    if (target.type === "folder") {
      fullPrompt += `\n\n---\n\n${FOLDER_REVIEW_MODE_OVERRIDE}`;
    }

    const modeHint = useFreshSession ? " (fresh session)" : "";
    ctx.ui.notify(`Starting security review: ${hint}${modeHint}`, "info");

    pi.sendUserMessage(fullPrompt);
  }

  // ── Parse CLI args ───────────────────────────────────────────────────────

  function parseArgs(
    args: string | undefined,
  ): ReviewTarget | { type: "pr"; ref: string } | null {
    if (!args?.trim()) return null;

    const trimmedArgs = args.trim();
    const parts = tokenizeSpaceSeparated(trimmedArgs);
    const subcommand = parts[0]?.toLowerCase();
    if (!subcommand) return null;

    const remainder = trimmedArgs.slice(subcommand.length).trim();

    switch (subcommand) {
      case "uncommitted":
        return { type: "uncommitted" };
      case "branch": {
        const branch = parts[1];
        if (!branch) return null;
        return { type: "baseBranch", branch };
      }
      case "commit": {
        const sha = parts[1];
        if (!sha) return null;
        const title = parts.slice(2).join(" ") || undefined;
        return { type: "commit", sha, title };
      }
      case "custom": {
        const instructions = remainder;
        if (!instructions) return null;
        return { type: "custom", instructions };
      }
      case "folder": {
        const paths = parseReviewPathsInput(remainder);
        if (paths.length === 0) return null;
        return { type: "folder", paths };
      }
      case "pr": {
        const ref = parts[1];
        if (!ref) return null;
        return { type: "pr", ref };
      }
      default:
        return null;
    }
  }

  async function handlePrCheckout(
    ctx: ExtensionContext,
    ref: string,
  ): Promise<ReviewTarget | null> {
    if (await hasPendingChanges(pi)) {
      ctx.ui.notify(
        "Cannot checkout PR: you have uncommitted changes. Please commit or stash them first.",
        "error",
      );
      return null;
    }

    const prNumber = parsePrReference(ref);
    if (!prNumber) {
      ctx.ui.notify(
        "Invalid PR reference. Enter a number or GitHub PR URL.",
        "error",
      );
      return null;
    }

    ctx.ui.notify(`Fetching PR #${prNumber} info...`, "info");
    const prInfo = await getPrInfo(pi, prNumber);

    if (!prInfo) {
      ctx.ui.notify(
        `Could not find PR #${prNumber}. Make sure gh is authenticated and the PR exists.`,
        "error",
      );
      return null;
    }

    ctx.ui.notify(`Checking out PR #${prNumber}...`, "info");
    const checkoutResult = await checkoutPr(pi, prNumber);

    if (!checkoutResult.success) {
      ctx.ui.notify(`Failed to checkout PR: ${checkoutResult.error}`, "error");
      return null;
    }

    ctx.ui.notify(`Checked out PR #${prNumber} (${prInfo.headBranch})`, "info");

    return {
      type: "pullRequest",
      prNumber,
      baseBranch: prInfo.baseBranch,
      title: prInfo.title,
    };
  }

  // ── /security-review command ─────────────────────────────────────────────

  pi.registerCommand("security-review", {
    description:
      "Security-focused code review (OWASP Top 10, secrets, auth, injection, etc.)",
    handler: async (args, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("Security review requires interactive mode", "error");
        return;
      }

      if (securityReviewOriginId) {
        ctx.ui.notify(
          "Already in a security review. Use /end-security-review to finish first.",
          "warning",
        );
        return;
      }

      const { code } = await pi.exec("git", ["rev-parse", "--git-dir"]);
      if (code !== 0) {
        ctx.ui.notify("Not a git repository", "error");
        return;
      }

      let target: ReviewTarget | null = null;
      let fromSelector = false;
      const parsed = parseArgs(args);

      if (parsed) {
        if (parsed.type === "pr") {
          target = await handlePrCheckout(ctx, parsed.ref);
          if (!target) {
            ctx.ui.notify(
              "PR review failed. Returning to review menu.",
              "warning",
            );
          }
        } else {
          target = parsed;
        }
      }

      if (!target) {
        fromSelector = true;
      }

      while (true) {
        if (!target && fromSelector) {
          target = await showReviewSelector(ctx);
        }

        if (!target) {
          ctx.ui.notify("Security review cancelled", "info");
          return;
        }

        const entries = ctx.sessionManager.getEntries();
        const messageCount = entries.filter((e) => e.type === "message").length;

        let useFreshSession = false;

        if (messageCount > 0) {
          const choice = await ctx.ui.select("Start security review in:", [
            "Empty branch",
            "Current session",
          ]);

          if (choice === undefined) {
            if (fromSelector) {
              target = null;
              continue;
            }
            ctx.ui.notify("Security review cancelled", "info");
            return;
          }

          useFreshSession = choice === "Empty branch";
        }

        await executeSecurityReview(ctx, target, useFreshSession);
        return;
      }
    },
  });

  // ── Summary prompt for /end-security-review ──────────────────────────────

  const SECURITY_REVIEW_SUMMARY_PROMPT = `We are switching to a coding session to continue working on the code.
Create a structured summary of this security review branch for context when returning later.

You MUST summarize the security review that was performed in this branch so that the user can act on it.

1. What was reviewed (files, changes, scope)
2. Security findings and their priority levels (P0-P3)
3. OWASP categories affected
4. The overall security verdict (secure vs needs remediation)
5. Action items and recommended fixes

YOU MUST append a message with this EXACT format at the end of your summary:

## Next Steps
1. [What should happen next to remediate the security findings]

## Constraints & Preferences
- [Any constraints, preferences, or requirements mentioned]
- [Or "(none)" if none were mentioned]

## Security Review Findings

[P0] Short Title — OWASP Category — CWE-XXX

File: path/to/file.ext:line_number

\`\`\`
affected code snippet
\`\`\`

Preserve exact file paths, function names, and error messages.
`;

  const SECURITY_FIX_FINDINGS_PROMPT = `Use the latest security review summary in this session and remediate the security findings now.

Instructions:
1. Treat the summary's "## Security Review Findings" and "## Next Steps" as a checklist.
2. Fix in priority order: P0, P1, then P2 (include P3 if quick and safe).
3. For each fix, briefly explain the vulnerability it addresses and how the fix mitigates it.
4. If a finding is a false positive or not fixable right now, explain why and continue.
5. Run relevant tests/checks for touched code where practical.
6. End with: fixed items, deferred/skipped items (with reasons), and verification results.`;

  // ── /end-security-review helpers ─────────────────────────────────────────

  type EndSecurityReviewAction =
    | "returnOnly"
    | "returnAndFix"
    | "returnAndSummarize";

  function getActiveSecurityReviewOrigin(
    ctx: ExtensionContext,
  ): string | undefined {
    if (securityReviewOriginId) {
      return securityReviewOriginId;
    }

    const state = getSecurityReviewState(ctx);
    if (state?.active && state.originId) {
      securityReviewOriginId = state.originId;
      return securityReviewOriginId;
    }

    if (state?.active) {
      setSecurityReviewWidget(ctx, false);
      pi.appendEntry(SECURITY_REVIEW_STATE_TYPE, { active: false });
      ctx.ui.notify(
        "Security review state was missing origin info; cleared review status.",
        "warning",
      );
    }

    return undefined;
  }

  function clearSecurityReviewState(ctx: ExtensionContext) {
    setSecurityReviewWidget(ctx, false);
    securityReviewOriginId = undefined;
    pi.appendEntry(SECURITY_REVIEW_STATE_TYPE, { active: false });
  }

  async function runEndSecurityReview(
    ctx: ExtensionCommandContext,
  ): Promise<void> {
    if (!ctx.hasUI) {
      ctx.ui.notify("End-security-review requires interactive mode", "error");
      return;
    }

    if (endSecurityReviewInProgress) {
      ctx.ui.notify("/end-security-review is already running", "info");
      return;
    }

    const stateBeforeResolve = getSecurityReviewState(ctx);
    const originId = getActiveSecurityReviewOrigin(ctx);
    if (!originId) {
      if (stateBeforeResolve?.active && !stateBeforeResolve.originId) {
        return;
      }
      if (!getSecurityReviewState(ctx)?.active) {
        ctx.ui.notify(
          "Not in a security review branch (use /security-review first, or review was started in current session mode)",
          "info",
        );
      }
      return;
    }

    endSecurityReviewInProgress = true;
    try {
      const choice = await ctx.ui.select("Finish security review:", [
        "Return and summarize",
        "Return only",
        "Return, summarize, and queue fixes",
      ]);

      if (choice === undefined) {
        ctx.ui.notify(
          "Cancelled. Use /end-security-review to try again.",
          "info",
        );
        return;
      }

      const action: EndSecurityReviewAction =
        choice === "Return only"
          ? "returnOnly"
          : choice === "Return, summarize, and queue fixes"
            ? "returnAndFix"
            : "returnAndSummarize";

      if (action === "returnOnly") {
        try {
          const result = await ctx.navigateTree(originId, {
            summarize: false,
          });
          if (result.cancelled) {
            ctx.ui.notify(
              "Navigation cancelled. Use /end-security-review to try again.",
              "info",
            );
            return;
          }
        } catch (error) {
          ctx.ui.notify(
            `Failed to return: ${error instanceof Error ? error.message : String(error)}`,
            "error",
          );
          return;
        }

        clearSecurityReviewState(ctx);
        ctx.ui.notify(
          "Security review complete! Returned to original position.",
          "info",
        );
        return;
      }

      const summaryResult = await ctx.ui.custom<{
        cancelled: boolean;
        error?: string;
      } | null>((tui, theme, _kb, done) => {
        const loader = new BorderedLoader(
          tui,
          theme,
          "Summarizing security review and returning...",
        );
        loader.onAbort = () => done(null);

        ctx
          .navigateTree(originId, {
            summarize: true,
            customInstructions: SECURITY_REVIEW_SUMMARY_PROMPT,
            replaceInstructions: true,
          })
          .then(done)
          .catch((err) =>
            done({
              cancelled: false,
              error: err instanceof Error ? err.message : String(err),
            }),
          );

        return loader;
      });

      if (summaryResult === null) {
        ctx.ui.notify(
          "Summarization cancelled. Use /end-security-review to try again.",
          "info",
        );
        return;
      }

      if (summaryResult.error) {
        ctx.ui.notify(`Summarization failed: ${summaryResult.error}`, "error");
        return;
      }

      if (summaryResult.cancelled) {
        ctx.ui.notify(
          "Navigation cancelled. Use /end-security-review to try again.",
          "info",
        );
        return;
      }

      clearSecurityReviewState(ctx);

      if (action === "returnAndFix") {
        pi.sendUserMessage(SECURITY_FIX_FINDINGS_PROMPT, {
          deliverAs: "followUp",
        });
        ctx.ui.notify(
          "Security review complete! Returned, summarized, and queued fixes.",
          "info",
        );
        return;
      }

      if (!ctx.ui.getEditorText().trim()) {
        ctx.ui.setEditorText("Remediate the security findings");
      }

      ctx.ui.notify(
        "Security review complete! Returned and summarized.",
        "info",
      );
    } finally {
      endSecurityReviewInProgress = false;
    }
  }

  // ── /end-security-review command ─────────────────────────────────────────

  pi.registerCommand("end-security-review", {
    description: "Complete security review and return to original position",
    handler: async (_args, ctx) => {
      await runEndSecurityReview(ctx);
    },
  });
}
