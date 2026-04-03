/**
 * Simplify Extension
 *
 * Provides a `/simplify` command that scopes simplification work to one of:
 * - uncommitted changes
 * - changes relative to a local base branch
 * - a snapshot of folders/files
 *
 * Like `/review`, it can optionally run in a fresh session branch and later
 * return to the original position with `/end`.
 *
 * Usage:
 * - `/simplify` - show interactive selector
 * - `/simplify uncommitted` - simplify the current working tree changes
 * - `/simplify branch main` - simplify changes relative to a local branch
 * - `/simplify snapshot src docs` - simplify a snapshot of folders/files
 * - `/simplify folder src docs` - alias for `snapshot`
 *
 * Project-specific simplify guidelines:
 * - If a SIMPLIFY_GUIDELINES.md file exists in the same directory as .pi,
 *   its contents are appended to the simplify prompt.
 * - Falls back to REVIEW_GUIDELINES.md if no simplify-specific file exists.
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
  getLatestCustomState,
  hasUpstreamTrackingBranch,
  parseReviewPathsInput,
  tokenizeSpaceSeparated,
} from "./_shared/review-utils.js";
import { registerReloadableEventBusListener } from "./_shared/reloadable-event-bus.js";
import {
  COLLECT_END_TARGETS_EVENT,
  type CollectEndTargetsEvent,
} from "./_shared/end-events.js";
import {
  BASE_BRANCH_PROMPT_FALLBACK as SHARED_BASE_BRANCH_PROMPT_FALLBACK,
  BASE_BRANCH_PROMPT_WITH_MERGE_BASE as SHARED_BASE_BRANCH_PROMPT_WITH_MERGE_BASE,
  FOLDER_REVIEW_MODE_OVERRIDE as SHARED_FOLDER_REVIEW_MODE_OVERRIDE,
  FOLDER_REVIEW_PROMPT as SHARED_FOLDER_REVIEW_PROMPT,
  UNCOMMITTED_PROMPT as SHARED_UNCOMMITTED_PROMPT,
} from "./_shared/review-prompts.js";

let simplifyOriginId: string | undefined = undefined;
let endSimplifyInProgress = false;

const SIMPLIFY_STATE_TYPE = "simplify-session";

type SimplifySessionState = {
  active: boolean;
  originId?: string;
};

type SimplifyTarget =
  | { type: "uncommitted" }
  | { type: "baseBranch"; branch: string }
  | { type: "folder"; paths: string[] };

const UNCOMMITTED_PROMPT = SHARED_UNCOMMITTED_PROMPT;
const BASE_BRANCH_PROMPT_WITH_MERGE_BASE =
  SHARED_BASE_BRANCH_PROMPT_WITH_MERGE_BASE;
const BASE_BRANCH_PROMPT_FALLBACK = SHARED_BASE_BRANCH_PROMPT_FALLBACK;
const FOLDER_REVIEW_PROMPT = SHARED_FOLDER_REVIEW_PROMPT;
const FOLDER_REVIEW_MODE_OVERRIDE = SHARED_FOLDER_REVIEW_MODE_OVERRIDE;

const DIFF_SCOPE_GUIDANCE = `For diff-based targets, focus on simplifying code that is part of the selected changes and the minimum adjacent code needed to keep the result coherent. Avoid unrelated cleanup.`;

const SNAPSHOT_SCOPE_GUIDANCE = `For snapshot targets, you may simplify any code in the listed paths when it materially improves readability or maintainability without introducing risky behavior changes.`;

const SIMPLIFY_INSTRUCTIONS = `Directly implement simplifications in the working tree after inspecting the target above.

Approach this codebase using the spirit of the Zen of Python and pragmatic engineering. Prefer simple, readable, maintainable solutions over clever or complex ones. Re-use existing code before adding new abstractions. Keep things DRY, but don’t abstract prematurely. Minimize duplication, reduce unnecessary layers, and make the intent of the code obvious. Choose clear names, small focused functions, and straightforward control flow. When changing code, improve consistency and remove incidental complexity where possible. Favor practicality, but leave the codebase easier to understand than you found it.

Additional instructions:
1. Preserve behavior unless a tiny, obviously safe fix naturally falls out of the simplification.
2. Prefer deleting dead code, collapsing wrappers, and reducing indirection over adding new layers.
3. Re-use existing helpers, modules, and patterns before introducing anything new.
4. Run relevant tests or checks for touched code when practical.
5. End with a brief summary of what changed, what you validated, and any worthwhile follow-up opportunities.
6. If the targeted code is already about as simple as it should be, say so briefly instead of forcing edits.`;

const SIMPLIFY_SUMMARY_PROMPT = `We are switching back to the original coding session.

Create a brief, factual summary of the simplification work that was ALREADY completed in this branch.

Important:
- Keep it succinct and informational.
- Make it clear the simplifications were already applied in this branch.
- Do NOT frame completed simplifications as pending work.
- Do NOT ask the next agent to re-do the simplifications.
- Only mention follow-up work if something was intentionally deferred or needs verification.

Include only:
1. The scope that was simplified
2. The most important code changes and why they made the code simpler
3. Any tests/checks that were run
4. Any genuinely deferred follow-up, if applicable

You MUST append a message with this EXACT format at the end of your summary:

## Next Steps
1. [(none) unless something was intentionally deferred]

## Constraints & Preferences
- [Any constraints, preferences, or requirements mentioned]
- [Or "(none)" if none were mentioned]

## Simplification Summary
- [One short bullet describing the most important simplification already completed]
`;

function setSimplifyWidget(ctx: ExtensionContext, active: boolean) {
  if (!ctx.hasUI) return;

  ctx.ui.setWidget(
    "simplify",
    active
      ? (_tui, theme) =>
          new Text(
            theme.fg("warning", "Simplify session active, return with /end"),
            0,
            0,
          )
      : undefined,
  );
}

function getSimplifyState(
  ctx: ExtensionContext,
): SimplifySessionState | undefined {
  return getLatestCustomState<SimplifySessionState>(ctx, SIMPLIFY_STATE_TYPE);
}

function applySimplifyState(ctx: ExtensionContext) {
  const state = getSimplifyState(ctx);

  if (state?.active && state.originId) {
    simplifyOriginId = state.originId;
    setSimplifyWidget(ctx, true);
    return;
  }

  simplifyOriginId = undefined;
  setSimplifyWidget(ctx, false);
}

async function loadProjectSimplifyGuidelines(
  cwd: string,
): Promise<string | null> {
  let currentDir = path.resolve(cwd);

  while (true) {
    const piDir = path.join(currentDir, ".pi");
    const simplifyGuidelinesPath = path.join(
      currentDir,
      "SIMPLIFY_GUIDELINES.md",
    );
    const reviewGuidelinesPath = path.join(currentDir, "REVIEW_GUIDELINES.md");

    const piStats = await fs.stat(piDir).catch(() => null);
    if (piStats?.isDirectory()) {
      for (const candidate of [simplifyGuidelinesPath, reviewGuidelinesPath]) {
        const stats = await fs.stat(candidate).catch(() => null);
        if (!stats?.isFile()) continue;

        try {
          const content = await fs.readFile(candidate, "utf8");
          const trimmed = content.trim();
          if (trimmed) return trimmed;
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

async function isGitRepo(pi: ExtensionAPI): Promise<boolean> {
  const { code } = await pi.exec("git", ["rev-parse", "--git-dir"]);
  return code === 0;
}

async function hasUncommittedChanges(pi: ExtensionAPI): Promise<boolean> {
  const { stdout, code } = await pi.exec("git", ["status", "--porcelain"]);
  return code === 0 && stdout.trim().length > 0;
}

async function getCurrentBranch(pi: ExtensionAPI): Promise<string | null> {
  const { stdout, code } = await pi.exec("git", ["branch", "--show-current"]);
  return code === 0 && stdout.trim() ? stdout.trim() : null;
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
    .map((branch) => branch.trim())
    .filter(Boolean);
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
  return branches[0] ?? "main";
}

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
    return code === 0 && mergeBase.trim() ? mergeBase.trim() : null;
  } catch {
    return null;
  }
}

async function buildTargetPrompt(
  pi: ExtensionAPI,
  target: SimplifyTarget,
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

    case "folder":
      return FOLDER_REVIEW_PROMPT.replace("{paths}", target.paths.join(", "));
  }
}

async function buildSimplifyPrompt(
  pi: ExtensionAPI,
  target: SimplifyTarget,
  cwd: string,
): Promise<string> {
  const targetPrompt = await buildTargetPrompt(pi, target);
  const projectGuidelines = await loadProjectSimplifyGuidelines(cwd);

  let prompt = `${targetPrompt}\n\n${SIMPLIFY_INSTRUCTIONS}`;

  if (target.type === "folder") {
    prompt += `\n\n---\n\n${FOLDER_REVIEW_MODE_OVERRIDE}\n\n${SNAPSHOT_SCOPE_GUIDANCE}`;
  } else {
    prompt += `\n\n${DIFF_SCOPE_GUIDANCE}`;
  }

  if (projectGuidelines) {
    prompt += `\n\nThis project has additional instructions for simplification work:\n\n${projectGuidelines}`;
  }

  return prompt;
}

function getUserFacingHint(target: SimplifyTarget): string {
  switch (target.type) {
    case "uncommitted":
      return "current changes";
    case "baseBranch":
      return `changes against '${target.branch}'`;
    case "folder": {
      const joined = target.paths.join(", ");
      return joined.length > 40
        ? `snapshot: ${joined.slice(0, 30)}...`
        : `snapshot: ${joined}`;
    }
  }
}

type SimplifyPresetValue = "uncommitted" | "baseBranch" | "folder";

async function showPresetSelector(
  ctx: ExtensionContext,
  smartDefault: SimplifyPresetValue,
): Promise<SimplifyPresetValue | null> {
  const items: SelectItem[] = [
    {
      value: "uncommitted",
      label: "Uncommitted changes",
      description: smartDefault === "uncommitted" ? "recommended" : "",
    },
    {
      value: "baseBranch",
      label: "Local branch diff",
      description:
        smartDefault === "baseBranch" ? "(local) recommended" : "(local)",
    },
    {
      value: "folder",
      label: "Snapshot of folders/files",
      description:
        smartDefault === "folder" ? "(snapshot) recommended" : "(snapshot)",
    },
  ];
  const selectedIndex = items.findIndex((item) => item.value === smartDefault);

  return ctx.ui.custom<SimplifyPresetValue | null>((tui, theme, _kb, done) => {
    const container = new Container();
    container.addChild(new DynamicBorder((str) => theme.fg("accent", str)));
    container.addChild(
      new Text(theme.fg("accent", theme.bold("Select a simplify target"))),
    );

    const selectList = new SelectList(items, Math.min(items.length, 10), {
      selectedPrefix: (text) => theme.fg("accent", text),
      selectedText: (text) => theme.fg("accent", text),
      description: (text) => theme.fg("muted", text),
      scrollInfo: (text) => theme.fg("dim", text),
      noMatch: (text) => theme.fg("warning", text),
    });

    if (selectedIndex >= 0) {
      selectList.setSelectedIndex(selectedIndex);
    }

    selectList.onSelect = (item) => done(item.value as SimplifyPresetValue);
    selectList.onCancel = () => done(null);

    container.addChild(selectList);
    container.addChild(
      new Text(theme.fg("dim", "Press enter to confirm or esc to go back")),
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
        selectList.handleInput(data);
        tui.requestRender();
      },
    };
  });
}

async function getSmartDefault(pi: ExtensionAPI): Promise<SimplifyPresetValue> {
  if (await hasUncommittedChanges(pi)) {
    return "uncommitted";
  }

  const currentBranch = await getCurrentBranch(pi);
  const defaultBranch = await getDefaultBranch(pi);
  if (currentBranch && currentBranch !== defaultBranch) {
    return "baseBranch";
  }

  return "folder";
}

async function showBranchSelector(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
): Promise<SimplifyTarget | null> {
  const branches = await getLocalBranches(pi);
  const currentBranch = await getCurrentBranch(pi);
  const defaultBranch = await getDefaultBranch(pi);
  const currentBranchHasUpstream = currentBranch
    ? await hasUpstreamTrackingBranch(pi, currentBranch)
    : false;

  const candidateBranches =
    currentBranch && !currentBranchHasUpstream
      ? branches.filter((branch) => branch !== currentBranch)
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

  const branchLabels = new Map<string, string>();
  const labels = sortedBranches.map((branch) => {
    const tags: string[] = [];
    if (branch === defaultBranch) tags.push("default");
    if (currentBranchHasUpstream && branch === currentBranch) {
      tags.push("current → upstream");
    }

    const label = tags.length > 0 ? `${branch} (${tags.join(", ")})` : branch;
    branchLabels.set(label, branch);
    return label;
  });

  const choice = await ctx.ui.select("Select local base branch:", labels);
  if (choice === undefined) return null;

  const branch = branchLabels.get(choice);
  return branch ? { type: "baseBranch", branch } : null;
}

async function showSnapshotInput(
  ctx: ExtensionContext,
): Promise<SimplifyTarget | null> {
  const value = await ctx.ui.editor(
    "Enter folders/files to simplify (space-separated; quote/escape paths with spaces; or one per line):",
    "",
  );

  if (!value?.trim()) return null;

  const paths = parseReviewPathsInput(value);
  if (paths.length === 0) {
    ctx.ui.notify("No snapshot paths provided", "warning");
    return null;
  }

  return { type: "folder", paths };
}

async function showSimplifySelector(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
): Promise<SimplifyTarget | null> {
  const smartDefault = await getSmartDefault(pi);

  while (true) {
    const result = await showPresetSelector(ctx, smartDefault);

    if (!result) return null;

    switch (result) {
      case "uncommitted":
        return { type: "uncommitted" };

      case "baseBranch": {
        const target = await showBranchSelector(pi, ctx);
        if (target) return target;
        break;
      }

      case "folder": {
        const target = await showSnapshotInput(ctx);
        if (target) return target;
        break;
      }
    }
  }
}

async function ensureGitTargetSupported(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  target: SimplifyTarget,
): Promise<boolean> {
  if (target.type === "folder") return true;

  if (await isGitRepo(pi)) return true;

  ctx.ui.notify(
    "This simplify target requires a git repository. Use snapshot mode instead.",
    "error",
  );
  return false;
}

async function executeSimplify(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  target: SimplifyTarget,
  useFreshSession: boolean,
): Promise<void> {
  if (simplifyOriginId) {
    ctx.ui.notify(
      "Already in a simplify session. Use /end to finish first.",
      "warning",
    );
    return;
  }

  if (useFreshSession) {
    const originId = ctx.sessionManager.getLeafId() ?? undefined;
    if (!originId) {
      ctx.ui.notify(
        "Failed to determine simplify origin. Try again from a session with messages.",
        "error",
      );
      return;
    }

    simplifyOriginId = originId;
    const lockedOriginId = originId;

    const entries = ctx.sessionManager.getEntries();
    const firstUserMessage = entries.find(
      (entry) => entry.type === "message" && entry.message.role === "user",
    );

    if (!firstUserMessage) {
      ctx.ui.notify("No user message found in session", "error");
      simplifyOriginId = undefined;
      return;
    }

    try {
      const result = await ctx.navigateTree(firstUserMessage.id, {
        summarize: false,
        label: "simplify",
      });
      if (result.cancelled) {
        simplifyOriginId = undefined;
        return;
      }
    } catch (error) {
      simplifyOriginId = undefined;
      ctx.ui.notify(
        `Failed to start simplify session: ${error instanceof Error ? error.message : String(error)}`,
        "error",
      );
      return;
    }

    simplifyOriginId = lockedOriginId;
    ctx.ui.setEditorText("");
    setSimplifyWidget(ctx, true);
    pi.appendEntry(SIMPLIFY_STATE_TYPE, {
      active: true,
      originId: lockedOriginId,
    });
  }

  const fullPrompt = await buildSimplifyPrompt(pi, target, ctx.cwd);
  const hint = getUserFacingHint(target);
  const modeHint = useFreshSession ? " (fresh session)" : "";

  ctx.ui.notify(`Starting simplify: ${hint}${modeHint}`, "info");
  pi.sendUserMessage(fullPrompt);
}

function parseArgs(args: string | undefined): SimplifyTarget | null {
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
      return branch ? { type: "baseBranch", branch } : null;
    }

    case "snapshot":
    case "folder": {
      const paths = parseReviewPathsInput(remainder);
      return paths.length > 0 ? { type: "folder", paths } : null;
    }

    default:
      return null;
  }
}

function getActiveSimplifyOrigin(ctx: ExtensionContext): string | undefined {
  if (simplifyOriginId) {
    return simplifyOriginId;
  }

  const state = getSimplifyState(ctx);
  if (state?.active && state.originId) {
    simplifyOriginId = state.originId;
    return simplifyOriginId;
  }

  return undefined;
}

function clearSimplifyState(pi: ExtensionAPI, ctx: ExtensionContext) {
  setSimplifyWidget(ctx, false);
  simplifyOriginId = undefined;
  pi.appendEntry(SIMPLIFY_STATE_TYPE, { active: false });
}

async function runEndSimplify(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
): Promise<void> {
  if (!ctx.hasUI) {
    ctx.ui.notify("/end requires interactive mode", "error");
    return;
  }

  if (endSimplifyInProgress) {
    ctx.ui.notify("/end is already running", "info");
    return;
  }

  const stateBeforeResolve = getSimplifyState(ctx);
  const originId = getActiveSimplifyOrigin(ctx);
  if (!originId) {
    if (stateBeforeResolve?.active && !stateBeforeResolve.originId) {
      clearSimplifyState(pi, ctx);
      ctx.ui.notify(
        "Simplify state was missing origin info; cleared simplify status.",
        "warning",
      );
      return;
    }

    ctx.ui.notify(
      "Not in a simplify branch (use /simplify first, or simplify was started in current session mode)",
      "info",
    );
    return;
  }

  endSimplifyInProgress = true;

  try {
    const choice = await ctx.ui.select("Finish simplify session:", [
      "Return and summarize",
      "Return only",
    ]);

    if (choice === undefined) {
      ctx.ui.notify("Cancelled. Use /end to try again.", "info");
      return;
    }

    if (choice === "Return only") {
      try {
        const result = await ctx.navigateTree(originId, { summarize: false });
        if (result.cancelled) {
          ctx.ui.notify("Navigation cancelled. Use /end to try again.", "info");
          return;
        }
      } catch (error) {
        ctx.ui.notify(
          `Failed to return: ${error instanceof Error ? error.message : String(error)}`,
          "error",
        );
        return;
      }

      clearSimplifyState(pi, ctx);
      ctx.ui.notify(
        "Simplify session complete! Returned to original position.",
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
        "Summarizing simplify branch and returning...",
      );
      loader.onAbort = () => done(null);

      ctx
        .navigateTree(originId, {
          summarize: true,
          customInstructions: SIMPLIFY_SUMMARY_PROMPT,
          replaceInstructions: true,
        })
        .then(done)
        .catch((error) =>
          done({
            cancelled: false,
            error: error instanceof Error ? error.message : String(error),
          }),
        );

      return loader;
    });

    if (summaryResult === null) {
      ctx.ui.notify("Summarization cancelled. Use /end to try again.", "info");
      return;
    }

    if (summaryResult.error) {
      ctx.ui.notify(`Summarization failed: ${summaryResult.error}`, "error");
      return;
    }

    if (summaryResult.cancelled) {
      ctx.ui.notify("Navigation cancelled. Use /end to try again.", "info");
      return;
    }

    clearSimplifyState(pi, ctx);

    ctx.ui.notify(
      "Simplify session complete! Returned and summarized.",
      "info",
    );
  } finally {
    endSimplifyInProgress = false;
  }
}

export default function simplifyExtension(pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    applySimplifyState(ctx);
  });

  pi.on("session_before_switch", (_event, ctx) => {
    applySimplifyState(ctx);
  });

  pi.on("session_tree", (_event, ctx) => {
    applySimplifyState(ctx);
  });

  pi.registerCommand("simplify", {
    description:
      "Simplify code for uncommitted changes, a local branch diff, or a snapshot of folders/files",
    handler: async (args, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("Simplify requires interactive mode", "error");
        return;
      }

      if (simplifyOriginId) {
        ctx.ui.notify(
          "Already in a simplify session. Use /end to finish first.",
          "warning",
        );
        return;
      }

      let target = parseArgs(args);
      let fromSelector = false;

      if (!target) {
        fromSelector = true;
        target = await showSimplifySelector(pi, ctx);
      }

      while (true) {
        if (!target) {
          ctx.ui.notify("Simplify cancelled", "info");
          return;
        }

        if (!(await ensureGitTargetSupported(pi, ctx, target))) {
          if (!fromSelector) return;
          target = await showSimplifySelector(pi, ctx);
          continue;
        }

        const hasMessages = ctx.sessionManager
          .getEntries()
          .some((entry) => entry.type === "message");

        let useFreshSession = false;
        if (hasMessages) {
          const choice = await ctx.ui.select("Start simplify in:", [
            "Empty branch",
            "Current session",
          ]);

          if (choice === undefined) {
            if (fromSelector) {
              target = await showSimplifySelector(pi, ctx);
              continue;
            }
            ctx.ui.notify("Simplify cancelled", "info");
            return;
          }

          useFreshSession = choice === "Empty branch";
        }

        await executeSimplify(pi, ctx, target, useFreshSession);
        return;
      }
    },
  });

  registerReloadableEventBusListener(
    pi,
    "simplify:collect-end-targets",
    COLLECT_END_TARGETS_EVENT,
    (event) => {
      const { ctx, targets } = event as CollectEndTargetsEvent;
      if (!getSimplifyState(ctx)?.active) {
        return;
      }

      targets.push({
        key: "simplify",
        label: "Simplify",
        run: () => runEndSimplify(pi, ctx),
      });
    },
  );
}
