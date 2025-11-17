import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  truncateHead,
  type TruncationResult,
} from "@mariozechner/pi-coding-agent";
import { StringEnum } from "@mariozechner/pi-ai";
import { Type } from "@sinclair/typebox";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  existsSync,
  mkdirSync,
} from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join, basename, resolve as resolvePath } from "node:path";
import { exec, execFileSync } from "node:child_process";

// Bitbucket Cloud swagger (v3): https://dac-static.atlassian.com/cloud/bitbucket/swagger.v3.json?_v=2.300.146-0.1327.0
const CREDENTIALS_FILE = join(homedir(), ".pi", "bitbucket-credentials.json");

type StoredCredentials = {
  username: string;
  apiToken: string;
};

const Actions = [
  "get_pull_request",
  "get_diff",
  "get_diffstat",
  "list_comments",
  "create_comment",
  "approve",
  "unapprove",
  "request_changes",
  "remove_request_changes",
] as const;

const LineTypes = ["to", "from"] as const;

const CommentSchema = Type.Object({
  content: Type.String({ description: "Comment text (markdown)." }),
  path: Type.Optional(
    Type.String({ description: "File path for inline comments." }),
  ),
  line: Type.Optional(
    Type.Integer({
      description: "Line number (1-based) to anchor the comment.",
    }),
  ),
  line_type: Type.Optional(StringEnum(LineTypes) as any),
  start_line: Type.Optional(
    Type.Integer({ description: "Start line for multi-line inline comments." }),
  ),
  start_line_type: Type.Optional(StringEnum(LineTypes) as any),
  parent_id: Type.Optional(
    Type.Integer({ description: "Parent comment id to reply to." }),
  ),
});

const BitbucketToolParams = Type.Object({
  action: StringEnum(Actions) as any,
  pull_request_id: Type.Integer({ description: "Pull request id." }),
  comment: Type.Optional(CommentSchema),
}) as any;

// Define types explicitly to avoid TypeBox Static<> issues
type BitbucketAction = (typeof Actions)[number];
type LineType = "to" | "from";

interface CommentInput {
  content: string;
  path?: string;
  line?: number;
  line_type?: LineType;
  start_line?: number;
  start_line_type?: LineType;
  parent_id?: number;
}

interface BitbucketToolInput {
  action: BitbucketAction;
  pull_request_id: number;
  comment?: CommentInput;
}
type BitbucketCommandAction = "review" | "respond";

type BitbucketCommandArgs = {
  action: BitbucketCommandAction;
  pullRequestId: number;
};

function getGitRemoteInfo(): { workspace?: string; repoSlug?: string } {
  try {
    const remoteUrl = runGit(["remote", "get-url", "origin"]).trim();
    // Match Bitbucket URLs: git@bitbucket.org:workspace/repo.git or https://bitbucket.org/workspace/repo.git
    const match = remoteUrl.match(/bitbucket\.org[:/]([^/]+)\/([^/.]+)/);
    if (match) {
      return { workspace: match[1], repoSlug: match[2].replace(/\.git$/, "") };
    }
  } catch {
    // Not in a git repo or no origin remote
  }
  return {};
}

type BitbucketResponse = {
  status: number;
  url: string;
  data?: unknown;
  raw?: string;
};

class BitbucketError extends Error {
  status?: number;
  details?: unknown;
  raw?: string;
  url?: string;

  constructor(
    message: string,
    status?: number,
    details?: unknown,
    raw?: string,
    url?: string,
  ) {
    super(message);
    this.name = "BitbucketError";
    this.status = status;
    this.details = details;
    this.raw = raw;
    this.url = url;
  }
}

const DEFAULT_BASE_URL = "https://api.bitbucket.org/2.0";

export default function (pi: ExtensionAPI) {
  registerBitbucketTool(pi);
  registerBitbucketCommand(pi);
  registerBitbucketLoginCommand(pi);
}

function registerBitbucketTool(pi: ExtensionAPI) {
  pi.registerTool({
    name: "bitbucket_pr",
    label: "Bitbucket PR",
    description:
      "Review Bitbucket pull requests. Supports actions: get_pull_request, get_diff, get_diffstat, list_comments, create_comment (inline), approve, unapprove, request_changes, remove_request_changes. Workspace/repo are auto-detected from git remotes (fallback: BITBUCKET_WORKSPACE + BITBUCKET_REPO_SLUG/BITBUCKET_REPO). Auth: set BITBUCKET_ACCESS_TOKEN (Bearer) or BITBUCKET_USERNAME with BITBUCKET_API_TOKEN. Output is truncated to 2000 lines or 50KB; full output is saved to a temp file when truncated.",
    parameters: BitbucketToolParams,

    async execute(_toolCallId, rawParams, signal) {
      const params = rawParams as BitbucketToolInput;
      try {
        const { workspace, repoSlug, pullRequestId } = resolveContext(params);
        const action = params.action as BitbucketAction;

        switch (action) {
          case "get_pull_request": {
            return await handleJsonAction(
              action,
              `/repositories/${workspace}/${repoSlug}/pullrequests/${pullRequestId}`,
              signal,
              { workspace, repoSlug, pullRequestId },
            );
          }
          case "get_diff": {
            return await handleTextAction(
              action,
              `/repositories/${workspace}/${repoSlug}/pullrequests/${pullRequestId}/diff`,
              signal,
              { workspace, repoSlug, pullRequestId },
            );
          }
          case "get_diffstat": {
            return await handleJsonAction(
              action,
              `/repositories/${workspace}/${repoSlug}/pullrequests/${pullRequestId}/diffstat`,
              signal,
              { workspace, repoSlug, pullRequestId },
            );
          }
          case "list_comments": {
            return await handleJsonAction(
              action,
              `/repositories/${workspace}/${repoSlug}/pullrequests/${pullRequestId}/comments`,
              signal,
              { workspace, repoSlug, pullRequestId },
            );
          }
          case "create_comment": {
            if (!params.comment) {
              throw new Error(
                "comment payload is required for create_comment.",
              );
            }
            const body = buildCommentBody(params.comment);
            return await handleJsonAction(
              action,
              `/repositories/${workspace}/${repoSlug}/pullrequests/${pullRequestId}/comments`,
              signal,
              { workspace, repoSlug, pullRequestId },
              { method: "POST", body },
            );
          }
          case "approve": {
            return await handleJsonAction(
              action,
              `/repositories/${workspace}/${repoSlug}/pullrequests/${pullRequestId}/approve`,
              signal,
              { workspace, repoSlug, pullRequestId },
              { method: "POST" },
            );
          }
          case "unapprove": {
            return await handleNoContentAction(
              action,
              `/repositories/${workspace}/${repoSlug}/pullrequests/${pullRequestId}/approve`,
              signal,
              { workspace, repoSlug, pullRequestId },
              "Approval removed.",
            );
          }
          case "request_changes": {
            return await handleJsonAction(
              action,
              `/repositories/${workspace}/${repoSlug}/pullrequests/${pullRequestId}/request-changes`,
              signal,
              { workspace, repoSlug, pullRequestId },
              { method: "POST" },
            );
          }
          case "remove_request_changes": {
            return await handleNoContentAction(
              action,
              `/repositories/${workspace}/${repoSlug}/pullrequests/${pullRequestId}/request-changes`,
              signal,
              { workspace, repoSlug, pullRequestId },
              "Change request removed.",
            );
          }
          default:
            throw new Error(`Unsupported action: ${action}`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const details: Record<string, unknown> = { error: message };
        let detailMessage: string | undefined;

        if (error instanceof BitbucketError) {
          details.status = error.status;
          details.details = error.details;
          details.raw_body = error.raw;
          details.url = error.url;
          const fields =
            (error.details as any)?.error?.fields ??
            (error.details as any)?.fields;
          if (fields) {
            details.fields = fields;
          }
          detailMessage = extractErrorMessage(error.details);
          if (detailMessage) {
            details.error_detail = detailMessage;
          }
        }

        const summary = detailMessage
          ? `${message}: ${detailMessage}`
          : message;

        return {
          content: [
            {
              type: "text" as const,
              text: `Bitbucket request failed: ${summary}`,
            },
          ],
          details,
          isError: true,
        };
      }
    },
  });
}

function registerBitbucketCommand(pi: ExtensionAPI) {
  pi.registerCommand("bitbucket", {
    description:
      "Review or respond to Bitbucket pull requests. Usage: /bitbucket <review|respond> <pr>. Automatically checks out the PR into a git worktree and detects workspace/repo from git remotes.",
    getArgumentCompletions: (prefix: string) => {
      const options = ["review", "respond"].filter((opt) =>
        opt.startsWith(prefix),
      );
      return options.length
        ? options.map((opt) => ({ value: `${opt} `, label: opt }))
        : null;
    },
    handler: async (args, ctx) => {
      const parsed = parseBitbucketCommandArgs(args);
      if ("error" in parsed) {
        notify(ctx, parsed.error, "error");
        return;
      }

      const { action, pullRequestId } = parsed;

      let worktreePath: string | undefined;
      try {
        const worktree = await prepareBitbucketWorktree(pullRequestId);
        worktreePath = worktree.worktreePath;
        notify(
          ctx,
          `Checked out PR #${pullRequestId} into worktree ${worktreePath}`,
          "info",
        );
      } catch (error) {
        notify(
          ctx,
          `Failed to prepare worktree: ${error instanceof Error ? error.message : String(error)}`,
          "error",
        );
        return;
      }

      const message =
        action === "review"
          ? buildBitbucketReviewPrompt(pullRequestId, worktreePath)
          : buildBitbucketRespondPrompt(pullRequestId, worktreePath);

      pi.sendUserMessage(message);
      notify(
        ctx,
        `Started Bitbucket ${action} flow for PR #${pullRequestId}${worktreePath ? ` (worktree: ${worktreePath})` : ""}.`,
        "info",
      );
    },
  });
}

function registerBitbucketLoginCommand(pi: ExtensionAPI) {
  pi.registerCommand("bitbucket-login", {
    description:
      "Set up Bitbucket credentials (API token). Usage: /bitbucket-login",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) {
        notify(ctx, "Login requires interactive mode.", "error");
        return;
      }

      // Open browser to Atlassian API token page
      const tokenUrl =
        "https://id.atlassian.com/manage-profile/security/api-tokens";
      notify(ctx, `Opening Atlassian API tokens page...`, "info");
      openBrowser(tokenUrl);

      // Show instructions
      const proceed = await ctx.ui.confirm(
        "Bitbucket Login",
        "Create an API token:\n" +
          "  1. Click 'Create API token'\n" +
          "  2. Give it a label (e.g., 'pi-bitbucket')\n" +
          "  3. Copy the generated token\n\n" +
          "Then continue here to enter your credentials.",
      );

      if (!proceed) {
        notify(ctx, "Login cancelled.", "info");
        return;
      }

      // Get username
      const username = await ctx.ui.input("Bitbucket username:", "");
      if (!username?.trim()) {
        notify(ctx, "Username is required.", "error");
        return;
      }

      // Get API token
      const apiToken = await ctx.ui.input("API token:", "");
      if (!apiToken?.trim()) {
        notify(ctx, "API token is required.", "error");
        return;
      }

      // Test credentials
      notify(ctx, "Testing credentials...", "info");
      const testResult = await testCredentials(
        username.trim(),
        apiToken.trim(),
      );

      if ("error" in testResult) {
        notify(ctx, `Authentication failed: ${testResult.error}`, "error");
        return;
      }

      // Save credentials
      saveCredentials({ username: username.trim(), apiToken: apiToken.trim() });
      notify(
        ctx,
        `Logged in as ${testResult.displayName} (${username.trim()}). Credentials saved to ${CREDENTIALS_FILE}`,
        "info",
      );
    },
  });
}

function openBrowser(url: string) {
  const cmd =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "start"
        : "xdg-open";
  exec(`${cmd} "${url}"`);
}

async function testCredentials(
  username: string,
  apiToken: string,
): Promise<
  { success: true; displayName: string } | { success: false; error: string }
> {
  try {
    const encoded = Buffer.from(`${username}:${apiToken}`).toString("base64");
    const response = await fetch("https://api.bitbucket.org/2.0/user", {
      headers: { Authorization: `Basic ${encoded}` },
    });

    if (!response.ok) {
      return {
        success: false,
        error: `HTTP ${response.status} ${response.statusText}`,
      };
    }

    const data = (await response.json()) as { display_name?: string };
    return { success: true, displayName: data.display_name ?? username };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function saveCredentials(credentials: StoredCredentials): void {
  const dir = join(homedir(), ".pi");
  if (!existsSync(dir)) {
    const { mkdirSync } = require("node:fs");
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(CREDENTIALS_FILE, JSON.stringify(credentials, null, 2), {
    mode: 0o600,
  });
}

function loadCredentials(): StoredCredentials | null {
  if (!existsSync(CREDENTIALS_FILE)) {
    return null;
  }
  try {
    const content = readFileSync(CREDENTIALS_FILE, "utf-8");
    const data = JSON.parse(content) as Record<string, string>;
    // Handle both old format (appPassword) and current format (apiToken)
    const apiToken = data.apiToken ?? data.appPassword;
    if (!data.username || !apiToken) {
      return null;
    }
    return { username: data.username, apiToken };
  } catch {
    return null;
  }
}

function parseBitbucketCommandArgs(
  args?: string,
): BitbucketCommandArgs | { error: string } {
  if (!args?.trim()) {
    return { error: "Usage: /bitbucket <review|respond> <pull-request-id>" };
  }

  const parts = args.trim().split(/\s+/);
  const action = parts[0]?.toLowerCase();
  if (action !== "review" && action !== "respond") {
    return { error: 'First argument must be "review" or "respond".' };
  }

  const prRef = parts[1];
  if (!prRef || prRef.startsWith("--")) {
    return { error: "Provide a pull request id or URL." };
  }

  const pullRequestId = parseBitbucketPrId(prRef);
  if (!pullRequestId) {
    return { error: "Could not parse pull request id from input." };
  }

  return { action, pullRequestId };
}

function parseBitbucketPrId(ref: string): number | null {
  const numeric = parseInt(ref, 10);
  if (!Number.isNaN(numeric) && numeric > 0) {
    return numeric;
  }

  const urlMatch = ref.match(/pull-requests\/(\d+)/i);
  if (urlMatch) {
    const pr = parseInt(urlMatch[1], 10);
    return Number.isNaN(pr) ? null : pr;
  }

  return null;
}

function resolveWorkspaceRepoFromGitOrEnv(): {
  workspace: string;
  repoSlug: string;
} {
  const gitInfo = getGitRemoteInfo();
  const workspace = gitInfo.workspace ?? process.env.BITBUCKET_WORKSPACE;
  const repoSlug =
    gitInfo.repoSlug ??
    process.env.BITBUCKET_REPO_SLUG ??
    process.env.BITBUCKET_REPO;

  if (!workspace || !repoSlug) {
    throw new Error(
      "workspace/repo_slug are auto-detected from git remotes (origin). Set BITBUCKET_WORKSPACE and BITBUCKET_REPO_SLUG (or BITBUCKET_REPO) if detection fails.",
    );
  }

  return { workspace, repoSlug };
}

type PullRequestMeta = {
  title?: string;
  source?: { branch?: { name?: string } };
  destination?: { branch?: { name?: string } };
};

async function fetchPullRequestMeta(
  workspace: string,
  repoSlug: string,
  pullRequestId: number,
): Promise<PullRequestMeta> {
  const response = await bitbucketRequest(
    `/repositories/${workspace}/${repoSlug}/pullrequests/${pullRequestId}`,
    { method: "GET", expect: "json" },
  );
  const data = response.data as PullRequestMeta | undefined;
  if (!data) {
    throw new Error(
      `Pull request #${pullRequestId} not found for ${workspace}/${repoSlug}`,
    );
  }
  return data;
}

async function prepareBitbucketWorktree(pullRequestId: number): Promise<{
  worktreePath: string;
  branch: string;
  sourceBranch: string;
  targetBranch?: string;
  title?: string;
}> {
  const { workspace, repoSlug } = resolveWorkspaceRepoFromGitOrEnv();
  const pr = await fetchPullRequestMeta(workspace, repoSlug, pullRequestId);
  const sourceBranch = pr?.source?.branch?.name;
  const targetBranch = pr?.destination?.branch?.name;
  const title = pr?.title;

  if (!sourceBranch) {
    throw new Error(
      `Could not determine source branch for PR #${pullRequestId}.`,
    );
  }

  const repoRoot = getRepoRoot();
  const repoName = basename(repoRoot);
  const worktreeBase = join(homedir(), ".pi", "worktrees", repoName);
  mkdirSync(worktreeBase, { recursive: true });

  const branchName = `pi/bitbucket/pr-${pullRequestId}`;
  const worktreePath = join(worktreeBase, `bitbucket-pr-${pullRequestId}`);
  const remoteRef = `origin/${sourceBranch}`;

  // Ensure origin exists and fetch the PR source branch
  runGit(["remote", "get-url", "origin"], repoRoot);
  runGit(["fetch", "origin", sourceBranch], repoRoot);

  ensureBranchAt(repoRoot, branchName, remoteRef);
  ensureWorktree(repoRoot, worktreePath, branchName, remoteRef);

  return {
    worktreePath,
    branch: branchName,
    sourceBranch,
    targetBranch,
    title,
  };
}

type WorktreeInfo = { path: string; branch?: string };

function ensureWorktree(
  repoRoot: string,
  worktreePath: string,
  branchName: string,
  ref: string,
) {
  const worktrees = listWorktrees(repoRoot);
  const normalizedPath = resolvePath(worktreePath);
  const existing = worktrees.find(
    (wt) => resolvePath(wt.path) === normalizedPath,
  );
  const branchInUse = worktrees.find((wt) => wt.branch === branchName);

  if (existing) {
    ensureCleanWorktree(existing.path);
    runGit(["checkout", branchName], existing.path);
    runGit(["reset", "--hard", ref], existing.path);
    return;
  }

  if (branchInUse) {
    throw new Error(
      `Branch ${branchName} is already checked out at ${branchInUse.path}. Clean it up or reuse that worktree.`,
    );
  }

  if (existsSync(worktreePath)) {
    throw new Error(
      `Worktree path ${worktreePath} already exists. Remove it or choose a different location.`,
    );
  }

  runGit(["worktree", "add", "-B", branchName, worktreePath, ref], repoRoot);
}

function ensureBranchAt(repoRoot: string, branchName: string, ref: string) {
  const branchInUse = listWorktrees(repoRoot).find(
    (wt) => wt.branch === branchName,
  );
  if (branchInUse) {
    return;
  }

  const hasBranch = (() => {
    try {
      runGit(["show-ref", "--verify", `refs/heads/${branchName}`], repoRoot);
      return true;
    } catch {
      return false;
    }
  })();

  if (hasBranch) {
    runGit(["branch", "-f", branchName, ref], repoRoot);
  } else {
    runGit(["branch", branchName, ref], repoRoot);
  }
}

function ensureCleanWorktree(worktreePath: string) {
  const status = runGit(["status", "--porcelain"], worktreePath);
  if (status.trim().length > 0) {
    throw new Error(
      `Worktree at ${worktreePath} has uncommitted changes. Commit or stash them before continuing.`,
    );
  }
}

function listWorktrees(repoRoot: string): WorktreeInfo[] {
  const output = runGit(["worktree", "list", "--porcelain"], repoRoot).trim();
  if (!output) return [];

  const worktrees: WorktreeInfo[] = [];
  let current: WorktreeInfo | null = null;

  for (const line of output.split("\n")) {
    if (!line.trim()) continue;

    if (line.startsWith("worktree ")) {
      if (current) worktrees.push(current);
      current = { path: line.slice("worktree ".length).trim() };
      continue;
    }

    if (line.startsWith("branch ") && current) {
      const branchRef = line.slice("branch ".length).trim();
      current.branch = branchRef.replace("refs/heads/", "");
    }
  }

  if (current) worktrees.push(current);
  return worktrees;
}

function getRepoRoot(): string {
  const root = runGit(["rev-parse", "--show-toplevel"]).trim();
  if (!root) {
    throw new Error(
      "Failed to determine repository root (git rev-parse returned empty).",
    );
  }
  return root;
}

function runGit(args: string[], cwd?: string): string {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (error: any) {
    const stderr = error?.stderr?.toString?.().trim();
    const stdout = error?.stdout?.toString?.().trim();
    const details = stderr || stdout || error.message;
    throw new Error(
      `git ${args.join(" ")} failed${details ? `: ${details}` : ""}`,
    );
  }
}

function buildBitbucketReviewPrompt(
  pullRequestId: number,
  worktreePath?: string,
): string {
  const toolArgs = `pull_request_id: ${pullRequestId}`;

  return [
    `Review Bitbucket pull request #${pullRequestId}.`,
    worktreePath
      ? `The PR is checked out at ${worktreePath} (git worktree). Run commands and edits there.`
      : undefined,
    `Workspace and repo are auto-detected from git remotes. Use the bitbucket_pr tool for all API calls (${toolArgs}).`,
    "Workflow:",
    "1) Gather context with get_pull_request plus get_diff/get_diffstat, and review existing threads via list_comments.",
    "2) Perform a thorough review for correctness, reliability, security, and test coverage.",
    "3) Leave inline feedback with create_comment (include path, line, and line_type=to/from). Use parent_id to reply within an existing thread.",
    "4) Summarize findings. Use request_changes when blockers remain, comment when non-blocking, and approve only when confident.",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildBitbucketRespondPrompt(
  pullRequestId: number,
  worktreePath?: string,
): string {
  const toolArgs = `pull_request_id: ${pullRequestId}`;

  return [
    `Address review feedback on Bitbucket pull request #${pullRequestId}.`,
    worktreePath
      ? `The PR is checked out at ${worktreePath} (git worktree). Run commands and edits there.`
      : undefined,
    `Workspace and repo are auto-detected from git remotes. Use the bitbucket_pr tool to read and reply (${toolArgs}).`,
    "Workflow:",
    "1) Pull review threads with list_comments and fetch any needed context with get_pull_request and get_diff.",
    "2) For each comment, inspect the referenced code, make necessary fixes locally, and note what changed.",
    "3) Respond inline using create_comment: set parent_id to reply within a thread and include path + line (with line_type) when anchoring to code. Keep replies concise and specific.",
    "4) Wrap up with a short summary of addressed feedback. Avoid approving your own work automatically.",
  ]
    .filter(Boolean)
    .join("\n");
}

function notify(
  ctx: { hasUI: boolean; ui: any },
  message: string,
  level: "info" | "error" = "info",
) {
  if (ctx.hasUI) {
    ctx.ui.notify(message, level);
  }
}

function resolveContext(params: BitbucketToolInput): {
  workspace: string;
  repoSlug: string;
  pullRequestId: number;
} {
  const pullRequestId = params.pull_request_id;
  const gitInfo = getGitRemoteInfo();
  const workspace = gitInfo.workspace ?? process.env.BITBUCKET_WORKSPACE;
  const repoSlug =
    gitInfo.repoSlug ??
    process.env.BITBUCKET_REPO_SLUG ??
    process.env.BITBUCKET_REPO;

  if (!workspace || !repoSlug) {
    throw new Error(
      "workspace/repo_slug are auto-detected from git remotes (origin). Set BITBUCKET_WORKSPACE and BITBUCKET_REPO_SLUG (or BITBUCKET_REPO) if detection fails.",
    );
  }
  if (!pullRequestId) {
    throw new Error("pull_request_id is required.");
  }

  return { workspace, repoSlug, pullRequestId };
}

function buildCommentBody(comment: CommentInput): Record<string, unknown> {
  if (!comment.content?.trim()) {
    throw new Error("comment.content is required.");
  }

  const body: Record<string, unknown> = {
    // Bitbucket API requires `content.raw`; `markup` is optional and defaults to markdown.
    content: {
      raw: comment.content,
    },
  };

  if (comment.parent_id) {
    body.parent = { id: comment.parent_id };
  }

  const inline = buildInline(comment);
  if (inline) {
    body.inline = inline;
  }

  return body;
}

function buildInline(
  comment: CommentInput,
): Record<string, unknown> | undefined {
  const hasInlineData =
    comment.path ||
    comment.line ||
    comment.start_line ||
    comment.line_type ||
    comment.start_line_type;

  if (!hasInlineData) {
    return undefined;
  }

  if (!comment.path) {
    throw new Error(
      "comment.path is required when specifying inline line data.",
    );
  }

  const inline: Record<string, unknown> = { path: comment.path };
  const lineType = comment.line_type ?? "to";

  if (typeof comment.line === "number") {
    if (lineType === "from") {
      inline.from = comment.line;
    } else {
      inline.to = comment.line;
    }
  }

  if (typeof comment.start_line === "number") {
    const startType = comment.start_line_type ?? lineType;
    if (startType === "from") {
      inline.start_from = comment.start_line;
    } else {
      inline.start_to = comment.start_line;
    }
  }

  return inline;
}

async function handleJsonAction(
  action: BitbucketAction,
  path: string,
  signal: AbortSignal | undefined,
  context: { workspace: string; repoSlug: string; pullRequestId: number },
  options: { method?: string; body?: Record<string, unknown> } = {},
) {
  const response = await bitbucketRequest(path, {
    method: options.method ?? "GET",
    signal,
    body: options.body,
    expect: "json",
  });

  const payload = response.data
    ? JSON.stringify(response.data, null, 2)
    : (response.raw ?? "");
  return formatResult(action, payload, response, context);
}

async function handleTextAction(
  action: BitbucketAction,
  path: string,
  signal: AbortSignal | undefined,
  context: { workspace: string; repoSlug: string; pullRequestId: number },
  options: { method?: string; body?: Record<string, unknown> } = {},
) {
  const response = await bitbucketRequest(path, {
    method: options.method ?? "GET",
    signal,
    body: options.body,
    expect: "text",
  });

  return formatResult(action, response.raw ?? "", response, context);
}

async function handleNoContentAction(
  action: BitbucketAction,
  path: string,
  signal: AbortSignal | undefined,
  context: { workspace: string; repoSlug: string; pullRequestId: number },
  successMessage: string,
  options: { method?: string; body?: Record<string, unknown> } = {},
) {
  const response = await bitbucketRequest(path, {
    method: options.method ?? "DELETE",
    signal,
    body: options.body,
    expect: "none",
  });

  return {
    content: [{ type: "text" as const, text: successMessage }],
    details: {
      action,
      workspace: context.workspace,
      repo_slug: context.repoSlug,
      pull_request_id: context.pullRequestId,
      status: response.status,
      url: response.url,
    },
  };
}

function formatResult(
  action: BitbucketAction,
  text: string,
  response: BitbucketResponse,
  context: { workspace: string; repoSlug: string; pullRequestId: number },
) {
  if (!text.trim()) {
    return {
      content: [{ type: "text" as const, text: "No content returned." }],
      details: {
        action,
        workspace: context.workspace,
        repo_slug: context.repoSlug,
        pull_request_id: context.pullRequestId,
        status: response.status,
        url: response.url,
      },
    };
  }

  const { output, truncation, fullOutputPath } = applyTruncation(text);

  return {
    content: [{ type: "text" as const, text: output }],
    details: {
      action,
      workspace: context.workspace,
      repo_slug: context.repoSlug,
      pull_request_id: context.pullRequestId,
      status: response.status,
      url: response.url,
      truncation,
      fullOutputPath,
    },
  };
}

function applyTruncation(text: string): {
  output: string;
  truncation?: TruncationResult;
  fullOutputPath?: string;
} {
  const truncation = truncateHead(text, {
    maxLines: DEFAULT_MAX_LINES,
    maxBytes: DEFAULT_MAX_BYTES,
  });

  if (!truncation.truncated) {
    return { output: text };
  }

  const tempDir = mkdtempSync(join(tmpdir(), "pi-bitbucket-"));
  const tempFile = join(tempDir, "output.txt");
  writeFileSync(tempFile, text);

  const truncatedLines = truncation.totalLines - truncation.outputLines;
  const truncatedBytes = truncation.totalBytes - truncation.outputBytes;

  let output = truncation.content;
  output += `\n\n[Output truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines`;
  output += ` (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}).`;
  output += ` ${truncatedLines} lines (${formatSize(truncatedBytes)}) omitted.`;
  output += ` Full output saved to: ${tempFile}]`;

  return {
    output,
    truncation,
    fullOutputPath: tempFile,
  };
}

function extractErrorMessage(details: unknown): string | undefined {
  if (!details) {
    return undefined;
  }

  if (typeof details === "string") {
    return details;
  }

  if (typeof details === "object") {
    const wrapper = (details as any).error ?? details;
    const message = wrapper?.message ?? (details as any).message;
    const detail =
      typeof wrapper?.detail === "string"
        ? wrapper.detail
        : typeof wrapper?.detail?.message === "string"
          ? wrapper.detail.message
          : (details as any).detail;

    const parts = [
      message,
      typeof detail === "string" ? detail : undefined,
    ].filter(Boolean);
    if (parts.length) {
      return parts.join(" — ");
    }

    try {
      const json = JSON.stringify(details);
      return json.length > 500 ? `${json.slice(0, 500)}…` : json;
    } catch {
      // ignore
    }
  }

  return undefined;
}

async function bitbucketRequest(
  path: string,
  options: {
    method: string;
    signal?: AbortSignal;
    body?: Record<string, unknown>;
    expect: "json" | "text" | "none";
  },
): Promise<BitbucketResponse> {
  const baseUrl = process.env.BITBUCKET_BASE_URL ?? DEFAULT_BASE_URL;
  const url = `${baseUrl}${path}`;
  const headers: Record<string, string> = {
    Accept: options.expect === "text" ? "text/plain" : "application/json",
    ...getAuthHeaders(),
  };

  if (options.body) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(url, {
    method: options.method,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: options.signal,
    redirect: "follow",
  });

  const raw = await response.text();

  if (!response.ok) {
    let details: unknown = raw;
    try {
      details = raw ? JSON.parse(raw) : raw;
    } catch {
      // Ignore JSON parse errors
    }
    const err = new BitbucketError(
      `HTTP ${response.status} ${response.statusText}`,
      response.status,
      details,
      raw,
      response.url,
    );
    throw err;
  }

  if (options.expect === "none") {
    return { status: response.status, url: response.url };
  }

  if (!raw) {
    return { status: response.status, url: response.url, raw: "" };
  }

  if (options.expect === "text") {
    return { status: response.status, url: response.url, raw };
  }

  try {
    const data = JSON.parse(raw);
    return { status: response.status, url: response.url, data, raw };
  } catch {
    return { status: response.status, url: response.url, raw };
  }
}

function getAuthHeaders(): Record<string, string> {
  // 1. Check environment variables first
  const accessToken = process.env.BITBUCKET_ACCESS_TOKEN;
  if (accessToken) {
    return { Authorization: `Bearer ${accessToken}` };
  }

  const username = process.env.BITBUCKET_USERNAME;
  const password =
    process.env.BITBUCKET_API_TOKEN ??
    process.env.BITBUCKET_APP_PASSWORD ?? // Legacy, deprecated June 2026
    process.env.BITBUCKET_TOKEN;

  if (username && password) {
    const encoded = Buffer.from(`${username}:${password}`).toString("base64");
    return { Authorization: `Basic ${encoded}` };
  }

  // 2. Fall back to stored credentials
  const stored = loadCredentials();
  if (stored) {
    const token = stored.apiToken ?? (stored as any).appPassword; // Support legacy credentials
    const encoded = Buffer.from(`${stored.username}:${token}`).toString(
      "base64",
    );
    return { Authorization: `Basic ${encoded}` };
  }

  throw new Error(
    "Missing Bitbucket credentials. Run /bitbucket-login or set BITBUCKET_ACCESS_TOKEN / BITBUCKET_USERNAME + BITBUCKET_API_TOKEN.",
  );
}
