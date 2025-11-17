/**
 * Review-Fix Loop Extension
 *
 * Provides a `/review-fix-loop` command that automates the review → fix → re-review cycle.
 * Supports the same review targets as /review (uncommitted, branch, commit, PR, folder, custom).
 *
 * The loop:
 * 1. Select a review target (same interactive UI as /review)
 * 2. Agent performs a code review
 * 3. If verdict is "correct" → done
 * 4. If verdict is "needs attention" → agent fixes the issues → re-reviews → repeat
 * 5. Stops after max iterations (default 5) or when approved
 *
 * Usage:
 * - `/review-fix-loop` - interactive selector
 * - `/review-fix-loop uncommitted` - loop on uncommitted changes
 * - `/review-fix-loop branch main` - loop against main branch
 * - `/review-fix-loop commit abc123` - loop on a specific commit
 * - `/review-fix-loop pr 123` - loop on a PR (checks out locally)
 * - `/review-fix-loop folder src docs` - loop on folder(s) (snapshot, not diff)
 * - `/review-fix-loop custom "check for X"` - custom review instructions
 *
 * Project-specific review guidelines:
 * - If REVIEW_GUIDELINES.md exists next to .pi, its contents are appended to the prompt.
 */

import type {
  ExtensionAPI,
  ExtensionContext,
  ExtensionCommandContext,
} from "@mariozechner/pi-coding-agent";
import { DynamicBorder } from "@mariozechner/pi-coding-agent";
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
  BASE_BRANCH_PROMPT_FALLBACK,
  BASE_BRANCH_PROMPT_WITH_MERGE_BASE,
  COMMIT_PROMPT,
  COMMIT_PROMPT_WITH_TITLE,
  FOLDER_REVIEW_MODE_OVERRIDE,
  FOLDER_REVIEW_PROMPT,
  PULL_REQUEST_PROMPT,
  PULL_REQUEST_PROMPT_FALLBACK,
  REVIEW_RUBRIC,
  UNCOMMITTED_PROMPT,
} from "./_shared/review-prompts.js";

// ─── Constants ───────────────────────────────────────────────────────────────

const MAX_ITERATIONS = 5;

// ─── Types ───────────────────────────────────────────────────────────────────

type ReviewTarget =
  | { type: "uncommitted" }
  | { type: "baseBranch"; branch: string }
  | { type: "commit"; sha: string; title?: string }
  | { type: "custom"; instructions: string }
  | { type: "pullRequest"; prNumber: number; baseBranch: string; title: string }
  | { type: "folder"; paths: string[] };

type Verdict = "approved" | "needs-attention" | "unknown";

// ─── Loop-specific Prompts ───────────────────────────────────────────────────

const VERDICT_INSTRUCTION = `

IMPORTANT: You MUST end your review with a clear "## Overall Verdict" section containing exactly the word "correct" (if no blocking issues) or "needs attention" (if there are blocking issues). This verdict determines whether the automated review-fix loop continues.`;

const FIX_PROMPT = `The code review above found issues that need attention. Please fix all the findings now.

Instructions:
1. Fix in priority order: P0, P1, then P2 (include P3 if quick and safe).
2. If a finding is invalid, already fixed, or not possible to fix right now, briefly explain why and continue.
3. Make the minimal changes needed to address each finding.
4. Run relevant tests/checks for touched code where practical.
5. Briefly summarize what was fixed when done.`;

function buildReReviewPrompt(
  basePrompt: string,
  target: ReviewTarget,
  iteration: number,
): string {
  let prompt = `The previous review found issues which have now been fixed. Please re-review the code.

This is re-review iteration ${iteration}. Focus on:
1. Verifying the previous fixes correctly address the reported issues
2. Checking for any new issues introduced by the fixes
3. Flagging any remaining issues not yet addressed

${basePrompt}`;

  // Commit fixes live in the working tree, not in the immutable commit object.
  // Tell the agent to also inspect uncommitted changes so it can verify fixes.
  if (target.type === "commit") {
    prompt += `

IMPORTANT — commit re-review note:
The fixes for the review findings are uncommitted changes in the working tree,
NOT part of the original commit. You MUST also run \`git diff\` and
\`git diff --cached\` to see the applied fixes and verify they address the
original findings from the commit review.`;
  }

  return prompt;
}

// ─── Git Helpers ─────────────────────────────────────────────────────────────

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
      const { stdout, code } = await pi.exec("git", [
        "merge-base",
        "HEAD",
        upstream.trim(),
      ]);
      if (code === 0 && stdout.trim()) return stdout.trim();
    }
    const { stdout, code } = await pi.exec("git", [
      "merge-base",
      "HEAD",
      branch,
    ]);
    return code === 0 && stdout.trim() ? stdout.trim() : null;
  } catch {
    return null;
  }
}

async function getLocalBranches(pi: ExtensionAPI): Promise<string[]> {
  const { stdout, code } = await pi.exec("git", [
    "branch",
    "--format=%(refname:short)",
  ]);
  return code !== 0
    ? []
    : stdout
        .trim()
        .split("\n")
        .filter((b) => b.trim());
}

async function getRecentCommits(
  pi: ExtensionAPI,
  limit = 10,
): Promise<Array<{ sha: string; title: string }>> {
  const { stdout, code } = await pi.exec("git", [
    "log",
    "--oneline",
    "-n",
    `${limit}`,
  ]);
  if (code !== 0) return [];
  return stdout
    .trim()
    .split("\n")
    .filter((l) => l.trim())
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
  return stdout
    .trim()
    .split("\n")
    .filter((l) => l.trim())
    .some((l) => !l.startsWith("??"));
}

function parsePrReference(ref: string): number | null {
  const trimmed = ref.trim();
  const num = parseInt(trimmed, 10);
  if (!isNaN(num) && num > 0) return num;
  const urlMatch = trimmed.match(/github\.com\/[^/]+\/[^/]+\/pull\/(\d+)/);
  return urlMatch ? parseInt(urlMatch[1], 10) : null;
}

async function getPrInfo(
  pi: ExtensionAPI,
  prNumber: number,
): Promise<{
  baseBranch: string;
  title: string;
  headBranch: string;
} | null> {
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
  return code !== 0
    ? { success: false, error: stderr || stdout || "Failed to checkout PR" }
    : { success: true };
}

async function getCurrentBranch(pi: ExtensionAPI): Promise<string | null> {
  const { stdout, code } = await pi.exec("git", ["branch", "--show-current"]);
  return code === 0 && stdout.trim() ? stdout.trim() : null;
}

async function getDefaultBranch(pi: ExtensionAPI): Promise<string> {
  const { stdout, code } = await pi.exec("git", [
    "symbolic-ref",
    "refs/remotes/origin/HEAD",
    "--short",
  ]);
  if (code === 0 && stdout.trim()) return stdout.trim().replace("origin/", "");
  const branches = await getLocalBranches(pi);
  if (branches.includes("main")) return "main";
  if (branches.includes("master")) return "master";
  return "main";
}

// ─── Prompt Building ─────────────────────────────────────────────────────────

async function buildTargetPrompt(
  pi: ExtensionAPI,
  target: ReviewTarget,
): Promise<string> {
  switch (target.type) {
    case "uncommitted":
      return UNCOMMITTED_PROMPT;
    case "baseBranch": {
      const mergeBase = await getMergeBase(pi, target.branch);
      if (mergeBase)
        return BASE_BRANCH_PROMPT_WITH_MERGE_BASE.replace(
          /{baseBranch}/g,
          target.branch,
        ).replace(/{mergeBaseSha}/g, mergeBase);
      return BASE_BRANCH_PROMPT_FALLBACK.replace(/{branch}/g, target.branch);
    }
    case "commit":
      return target.title
        ? COMMIT_PROMPT_WITH_TITLE.replace("{sha}", target.sha).replace(
            "{title}",
            target.title,
          )
        : COMMIT_PROMPT.replace("{sha}", target.sha);
    case "custom":
      return target.instructions;
    case "pullRequest": {
      const mergeBase = await getMergeBase(pi, target.baseBranch);
      if (mergeBase)
        return PULL_REQUEST_PROMPT.replace(
          /{prNumber}/g,
          String(target.prNumber),
        )
          .replace(/{title}/g, target.title)
          .replace(/{baseBranch}/g, target.baseBranch)
          .replace(/{mergeBaseSha}/g, mergeBase);
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

async function buildFullReviewPrompt(
  pi: ExtensionAPI,
  target: ReviewTarget,
  cwd: string,
): Promise<string> {
  const targetPrompt = await buildTargetPrompt(pi, target);
  const projectGuidelines = await loadProjectReviewGuidelines(cwd);

  let prompt = `${REVIEW_RUBRIC}\n\n---\n\nPlease perform a code review with the following focus:\n\n${targetPrompt}`;

  if (projectGuidelines) {
    prompt += `\n\nThis project has additional instructions for code reviews:\n\n${projectGuidelines}`;
  }
  if (target.type === "folder") {
    prompt += `\n\n---\n\n${FOLDER_REVIEW_MODE_OVERRIDE}`;
  }

  prompt += VERDICT_INSTRUCTION;
  return prompt;
}

function getUserFacingHint(target: ReviewTarget): string {
  switch (target.type) {
    case "uncommitted":
      return "current changes";
    case "baseBranch":
      return `changes against '${target.branch}'`;
    case "commit": {
      const short = target.sha.slice(0, 7);
      return target.title
        ? `commit ${short}: ${target.title}`
        : `commit ${short}`;
    }
    case "custom":
      return target.instructions.length > 40
        ? target.instructions.slice(0, 37) + "..."
        : target.instructions;
    case "pullRequest": {
      const short =
        target.title.length > 30
          ? target.title.slice(0, 27) + "..."
          : target.title;
      return `PR #${target.prNumber}: ${short}`;
    }
    case "folder": {
      const joined = target.paths.join(", ");
      return joined.length > 40
        ? `folders: ${joined.slice(0, 37)}...`
        : `folders: ${joined}`;
    }
  }
}

async function loadProjectReviewGuidelines(
  cwd: string,
): Promise<string | null> {
  let currentDir = path.resolve(cwd);
  while (true) {
    const piDir = path.join(currentDir, ".pi");
    const guidelinesPath = path.join(currentDir, "REVIEW_GUIDELINES.md");
    const piStats = await fs.stat(piDir).catch(() => null);
    if (piStats?.isDirectory()) {
      const gStats = await fs.stat(guidelinesPath).catch(() => null);
      if (gStats?.isFile()) {
        try {
          const content = await fs.readFile(guidelinesPath, "utf8");
          return content.trim() || null;
        } catch {
          return null;
        }
      }
      return null;
    }
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) return null;
    currentDir = parentDir;
  }
}

// ─── Verdict Detection ──────────────────────────────────────────────────────

function classifyVerdictSection(section: string): Verdict {
  const s = section.toLowerCase().trim();

  // Negative signals (check FIRST — order matters)
  const hasNeedsAttention = /\bneeds?\s+attention\b/.test(s);
  const hasNegatedCorrect =
    /\bnot\s+correct\b/.test(s) || /\bincorrect\b/.test(s);
  const hasNoBlocking = /\bno\s+blocking(?:\s+issues?)?\b/.test(s);
  const hasBlockingIssues = /\bblocking\s+issues?\b/.test(s);

  if (hasNeedsAttention || hasNegatedCorrect) return "needs-attention";
  if (hasBlockingIssues && !hasNoBlocking) return "needs-attention";

  // Positive signals — only after negatives are ruled out
  // Use a negative lookbehind so "not correct" can't sneak through
  if (
    /(?<!\bnot\s)\bcorrect\b/.test(s) ||
    hasNoBlocking ||
    /\blooks?\s+good\b/.test(s)
  ) {
    return "approved";
  }

  return "unknown";
}

function detectVerdict(text: string): Verdict {
  // Look for "## Overall Verdict" section
  const verdictMatch = text.match(
    /##?\s*overall\s+verdict[:\s]*\n*([\s\S]*?)(?:\n##|\n---|$)/i,
  );

  if (verdictMatch) {
    const result = classifyVerdictSection(verdictMatch[1]);
    if (result !== "unknown") return result;
  }

  // Fallback: search the last 2000 chars for verdict keywords
  const tail = text.slice(-2000).toLowerCase();
  if (/overall\s+verdict/.test(tail)) {
    return classifyVerdictSection(tail);
  }

  return "unknown";
}

function getLastAssistantText(ctx: ExtensionContext): string | null {
  const entries = ctx.sessionManager.getBranch();
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry.type === "message" && entry.message.role === "assistant") {
      const content = entry.message.content;
      if (typeof content === "string") return content;
      if (Array.isArray(content)) {
        return content
          .filter((c: any) => c.type === "text")
          .map((c: any) => c.text)
          .join("\n");
      }
    }
  }
  return null;
}

// ─── Review Preset Options ──────────────────────────────────────────────────

const REVIEW_PRESETS = [
  {
    value: "uncommitted",
    label: "Review uncommitted changes",
    description: "",
  },
  {
    value: "baseBranch",
    label: "Review against a base branch",
    description: "(local)",
  },
  { value: "commit", label: "Review a commit", description: "" },
  {
    value: "pullRequest",
    label: "Review a pull request",
    description: "(GitHub PR)",
  },
  {
    value: "folder",
    label: "Review a folder (or more)",
    description: "(snapshot, not diff)",
  },
  { value: "custom", label: "Custom review instructions", description: "" },
] as const;

// ─── Extension ───────────────────────────────────────────────────────────────

export default function reviewFixLoopExtension(pi: ExtensionAPI) {
  let loopActive = false;

  // ── Send-and-wait helper ─────────────────────────────────────────────
  // We can't use sendUserMessage + waitForIdle because waitForIdle resolves
  // immediately if the agent hasn't started streaming yet (race condition).
  // Instead, register the resolve callback BEFORE sending the message so
  // agent_end fires into a waiting promise.
  let agentEndResolve: (() => void) | null = null;

  pi.on("agent_end", () => {
    if (agentEndResolve) {
      const resolve = agentEndResolve;
      agentEndResolve = null;
      resolve();
    }
  });

  function sendAndWaitForAgent(prompt: string): Promise<void> {
    return new Promise<void>((resolve) => {
      agentEndResolve = resolve;
      pi.sendUserMessage(prompt);
    });
  }

  function setLoopWidget(
    ctx: ExtensionContext,
    iteration: number,
    max: number,
    phase: string,
  ) {
    if (!ctx.hasUI) return;
    ctx.ui.setWidget("review-fix-loop", (_tui, theme) => {
      const text = new Text(
        theme.fg("warning", `Review-fix loop: ${phase} (${iteration}/${max})`),
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

  function clearLoopWidget(ctx: ExtensionContext) {
    if (!ctx.hasUI) return;
    ctx.ui.setWidget("review-fix-loop", undefined);
  }

  // ── Smart Default ────────────────────────────────────────────────────────

  async function getSmartDefault(): Promise<
    "uncommitted" | "baseBranch" | "commit"
  > {
    if (await hasUncommittedChanges(pi)) return "uncommitted";
    const current = await getCurrentBranch(pi);
    const def = await getDefaultBranch(pi);
    if (current && current !== def) return "baseBranch";
    return "commit";
  }

  // ── UI: Review Target Selector ───────────────────────────────────────────

  async function showReviewSelector(
    ctx: ExtensionContext,
  ): Promise<ReviewTarget | null> {
    const smartDefault = await getSmartDefault();
    const items: SelectItem[] = REVIEW_PRESETS.map((p) => ({
      value: p.value,
      label: p.label,
      description: p.description,
    }));
    const smartIdx = items.findIndex((i) => i.value === smartDefault);

    while (true) {
      const result = await ctx.ui.custom<string | null>(
        (tui, theme, _kb, done) => {
          const container = new Container();
          container.addChild(
            new DynamicBorder((str) => theme.fg("accent", str)),
          );
          container.addChild(
            new Text(
              theme.fg(
                "accent",
                theme.bold("Select review target for fix loop"),
              ),
            ),
          );
          const selectList = new SelectList(items, Math.min(items.length, 10), {
            selectedPrefix: (t) => theme.fg("accent", t),
            selectedText: (t) => theme.fg("accent", t),
            description: (t) => theme.fg("muted", t),
            scrollInfo: (t) => theme.fg("dim", t),
            noMatch: (t) => theme.fg("warning", t),
          });
          if (smartIdx >= 0) selectList.setSelectedIndex(smartIdx);
          selectList.onSelect = (item) => done(item.value);
          selectList.onCancel = () => done(null);
          container.addChild(selectList);
          container.addChild(
            new Text(
              theme.fg("dim", "Press enter to confirm or esc to cancel"),
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
          const t = await showBranchSelector(ctx);
          if (t) return t;
          break;
        }
        case "commit": {
          const t = await showCommitSelector(ctx);
          if (t) return t;
          break;
        }
        case "custom": {
          const t = await showCustomInput(ctx);
          if (t) return t;
          break;
        }
        case "folder": {
          const t = await showFolderInput(ctx);
          if (t) return t;
          break;
        }
        case "pullRequest": {
          const t = await showPrInput(ctx);
          if (t) return t;
          break;
        }
        default:
          return null;
      }
    }
  }

  // ── UI: Branch Selector ──────────────────────────────────────────────────

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
          ? `No other branches found (current: ${currentBranch})`
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
      if (currentBranchHasUpstream && branch === currentBranch)
        tags.push("current (uses upstream)");
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
          selectedPrefix: (t) => theme.fg("accent", t),
          selectedText: (t) => theme.fg("accent", t),
          description: (t) => theme.fg("muted", t),
          scrollInfo: (t) => theme.fg("dim", t),
          noMatch: (t) => theme.fg("warning", t),
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

  // ── UI: Commit Selector ──────────────────────────────────────────────────

  async function showCommitSelector(
    ctx: ExtensionContext,
  ): Promise<ReviewTarget | null> {
    const commits = await getRecentCommits(pi, 20);
    if (commits.length === 0) {
      ctx.ui.notify("No commits found", "error");
      return null;
    }

    const commitByKey = new Map<string, { sha: string; title: string }>();
    const items: SelectItem[] = commits.map((c) => {
      const key = `${c.title} ${c.sha}`;
      commitByKey.set(key, c);
      return {
        value: key,
        label: `${c.sha.slice(0, 7)} ${c.title}`,
        description: "",
      };
    });

    const result = await ctx.ui.custom<{ sha: string; title: string } | null>(
      (tui, theme, _kb, done) => {
        const container = new Container();
        container.addChild(new DynamicBorder((str) => theme.fg("accent", str)));
        container.addChild(
          new Text(theme.fg("accent", theme.bold("Select commit to review"))),
        );

        const selectList = new SelectList(items, Math.min(items.length, 10), {
          selectedPrefix: (t) => theme.fg("accent", t),
          selectedText: (t) => theme.fg("accent", t),
          description: (t) => theme.fg("muted", t),
          scrollInfo: (t) => theme.fg("dim", t),
          noMatch: (t) => theme.fg("warning", t),
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

        selectList.onSelect = (item) =>
          done(commitByKey.get(item.value) ?? null);
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
    return { type: "commit", sha: result.sha, title: result.title };
  }

  // ── UI: Custom / Folder / PR Inputs ──────────────────────────────────────

  async function showCustomInput(
    ctx: ExtensionContext,
  ): Promise<ReviewTarget | null> {
    const result = await ctx.ui.editor(
      "Enter review instructions:",
      "Review the code for security vulnerabilities and potential bugs...",
    );
    if (!result?.trim()) return null;
    return { type: "custom", instructions: result.trim() };
  }

  async function showFolderInput(
    ctx: ExtensionContext,
  ): Promise<ReviewTarget | null> {
    const result = await ctx.ui.editor(
      "Enter folders/files to review (space-separated; quote/escape paths with spaces; or one per line):",
      ".",
    );
    if (!result?.trim()) return null;
    const paths = parseReviewPathsInput(result);
    if (paths.length === 0) return null;
    return { type: "folder", paths };
  }

  async function showPrInput(
    ctx: ExtensionContext,
  ): Promise<ReviewTarget | null> {
    if (await hasPendingChanges(pi)) {
      ctx.ui.notify(
        "Cannot checkout PR: you have uncommitted changes to tracked files. Commit or stash them first.",
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
        "Cannot checkout PR: uncommitted changes appeared. Commit or stash them first.",
        "error",
      );
      return null;
    }

    ctx.ui.notify(`Checking out PR #${prNumber}...`, "info");
    const checkout = await checkoutPr(pi, prNumber);
    if (!checkout.success) {
      ctx.ui.notify(`Failed to checkout PR: ${checkout.error}`, "error");
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

  // ── Parse CLI Args ───────────────────────────────────────────────────────

  function parseArgs(
    args: string | undefined,
  ): ReviewTarget | { type: "pr"; ref: string } | null {
    if (!args?.trim()) return null;
    const trimmed = args.trim();
    const parts = tokenizeSpaceSeparated(trimmed);
    const sub = parts[0]?.toLowerCase();
    if (!sub) return null;
    const remainder = trimmed.slice(sub.length).trim();

    switch (sub) {
      case "uncommitted":
        return { type: "uncommitted" };
      case "branch": {
        const branch = parts[1];
        return branch ? { type: "baseBranch", branch } : null;
      }
      case "commit": {
        const sha = parts[1];
        if (!sha) return null;
        const title = parts.slice(2).join(" ") || undefined;
        return { type: "commit", sha, title };
      }
      case "custom": {
        return remainder ? { type: "custom", instructions: remainder } : null;
      }
      case "folder": {
        const paths = parseReviewPathsInput(remainder);
        return paths.length > 0 ? { type: "folder", paths } : null;
      }
      case "pr": {
        const ref = parts[1];
        return ref ? { type: "pr", ref } : null;
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
        "Cannot checkout PR: uncommitted changes to tracked files. Commit or stash first.",
        "error",
      );
      return null;
    }

    const prNumber = parsePrReference(ref);
    if (!prNumber) {
      ctx.ui.notify("Invalid PR reference.", "error");
      return null;
    }

    ctx.ui.notify(`Fetching PR #${prNumber} info...`, "info");
    const prInfo = await getPrInfo(pi, prNumber);
    if (!prInfo) {
      ctx.ui.notify(`Could not find PR #${prNumber}.`, "error");
      return null;
    }

    ctx.ui.notify(`Checking out PR #${prNumber}...`, "info");
    const checkout = await checkoutPr(pi, prNumber);
    if (!checkout.success) {
      ctx.ui.notify(`Failed to checkout PR: ${checkout.error}`, "error");
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

  // ── The Review-Fix Loop ──────────────────────────────────────────────────

  async function runLoop(
    ctx: ExtensionCommandContext,
    target: ReviewTarget,
  ): Promise<void> {
    const hint = getUserFacingHint(target);
    const initialReviewPrompt = await buildFullReviewPrompt(
      pi,
      target,
      ctx.cwd,
    );

    loopActive = true;

    try {
      for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
        // ── Review phase ─────────────────────────────────────────────
        const isReReview = iteration > 1;
        const reviewPrompt = isReReview
          ? buildReReviewPrompt(initialReviewPrompt, target, iteration - 1)
          : initialReviewPrompt;

        setLoopWidget(
          ctx,
          iteration,
          MAX_ITERATIONS,
          isReReview ? "Re-reviewing…" : "Reviewing…",
        );
        ctx.ui.notify(
          isReReview
            ? `Re-review iteration ${iteration - 1}: reviewing fixes…`
            : `Starting review: ${hint}`,
          "info",
        );

        await sendAndWaitForAgent(reviewPrompt);

        // ── Check verdict ────────────────────────────────────────────
        const assistantText = getLastAssistantText(ctx);
        if (!assistantText) {
          ctx.ui.notify(
            "Could not read review output. Stopping loop.",
            "error",
          );
          break;
        }

        let verdict = detectVerdict(assistantText);

        // If we can't parse the verdict, ask the user
        if (verdict === "unknown") {
          const choice = await ctx.ui.select(
            "Could not detect the review verdict. What happened?",
            [
              "Issues found – fix them",
              "Review passed – stop loop",
              "Cancel loop",
            ],
          );
          if (choice === "Issues found – fix them") {
            verdict = "needs-attention";
          } else if (choice === "Review passed – stop loop") {
            verdict = "approved";
          } else {
            ctx.ui.notify("Loop cancelled.", "info");
            break;
          }
        }

        if (verdict === "approved") {
          ctx.ui.notify(
            iteration === 1
              ? `✅ Review approved on first pass! (${hint})`
              : `✅ Review approved after ${iteration - 1} fix iteration${iteration - 1 > 1 ? "s" : ""}! (${hint})`,
            "info",
          );
          break;
        }

        // ── Fix phase ────────────────────────────────────────────────
        if (iteration === MAX_ITERATIONS) {
          ctx.ui.notify(
            `⚠️ Max iterations (${MAX_ITERATIONS}) reached. Last verdict: needs attention.`,
            "warning",
          );
          break;
        }

        setLoopWidget(ctx, iteration, MAX_ITERATIONS, "Fixing issues…");
        ctx.ui.notify(
          `Iteration ${iteration}: fixing review findings…`,
          "info",
        );

        await sendAndWaitForAgent(FIX_PROMPT);
      }
    } finally {
      loopActive = false;
      clearLoopWidget(ctx);
    }
  }

  // ── /review-fix-loop Command ─────────────────────────────────────────────

  pi.registerCommand("review-fix-loop", {
    description:
      "Review → fix → re-review loop until approved (or max iterations)",
    handler: async (args, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("review-fix-loop requires interactive mode", "error");
        return;
      }

      if (loopActive) {
        ctx.ui.notify("A review-fix loop is already running.", "warning");
        return;
      }

      // Check git repo
      const { code } = await pi.exec("git", ["rev-parse", "--git-dir"]);
      if (code !== 0) {
        ctx.ui.notify("Not a git repository", "error");
        return;
      }

      // Resolve target from args or interactive selector
      let target: ReviewTarget | null = null;
      let fromSelector = false;
      const parsed = parseArgs(args);

      if (parsed) {
        if (parsed.type === "pr") {
          target = await handlePrCheckout(ctx, parsed.ref);
          if (!target) {
            ctx.ui.notify(
              "PR checkout failed. Returning to selector.",
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
          ctx.ui.notify("Review-fix loop cancelled", "info");
          return;
        }

        // Confirm before starting the loop
        const hint = getUserFacingHint(target);
        const confirmed = await ctx.ui.confirm(
          "Start review-fix loop?",
          `Target: ${hint}\nMax iterations: ${MAX_ITERATIONS}\n\nThe agent will review, fix issues, and re-review until approved.`,
        );

        if (!confirmed) {
          if (fromSelector) {
            target = null;
            continue;
          }
          ctx.ui.notify("Review-fix loop cancelled", "info");
          return;
        }

        await runLoop(ctx, target);
        return;
      }
    },
  });
}
