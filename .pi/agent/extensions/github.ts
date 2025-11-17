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
import { mkdtempSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join, basename, resolve as resolvePath } from "node:path";
import { spawn, execFileSync } from "node:child_process";

const Actions = [
  "get_pull_request",
  "get_diff",
  "list_files",
  "list_comments",
  "create_comment",
  "reply_comment",
  "approve",
  "request_changes",
  "comment_review",
] as const;

const CommentSchema = Type.Object({
  body: Type.String({ description: "Comment text (markdown)." }),
  path: Type.Optional(
    Type.String({ description: "File path for inline comments." }),
  ),
  line: Type.Optional(
    Type.Integer({
      description: "Line number (1-based) to anchor the comment in the diff.",
    }),
  ),
  side: Type.Optional(
    StringEnum(["LEFT", "RIGHT"], {
      description:
        "Which side of the diff to comment on. LEFT for deletions, RIGHT for additions. Defaults to RIGHT.",
    }) as any,
  ),
  start_line: Type.Optional(
    Type.Integer({ description: "Start line for multi-line inline comments." }),
  ),
  comment_id: Type.Optional(
    Type.Integer({
      description: "Comment ID to reply to (for reply_comment action).",
    }),
  ),
});

const GitHubToolParams = Type.Object({
  action: StringEnum(Actions) as any,
  pull_request_number: Type.Integer({ description: "Pull request number." }),
  comment: Type.Optional(CommentSchema),
  review_body: Type.Optional(
    Type.String({
      description:
        "Body text for the review (used with approve, request_changes, comment_review).",
    }),
  ),
}) as any;

// Define types explicitly to avoid TypeBox Static<> issues
type GitHubAction = (typeof Actions)[number];
type DiffSide = "LEFT" | "RIGHT";

interface CommentInput {
  body: string;
  path?: string;
  line?: number;
  side?: DiffSide;
  start_line?: number;
  comment_id?: number;
}

interface GitHubToolInput {
  action: GitHubAction;
  pull_request_number: number;
  comment?: CommentInput;
  review_body?: string;
}
type GitHubCommandAction = "review" | "respond";

type GitHubCommandArgs = {
  action: GitHubCommandAction;
  prNumber: number;
};

class GitHubError extends Error {
  exitCode?: number;
  stderr?: string;

  constructor(message: string, exitCode?: number, stderr?: string) {
    super(message);
    this.name = "GitHubError";
    this.exitCode = exitCode;
    this.stderr = stderr;
  }
}

export default function (pi: ExtensionAPI) {
  registerGitHubTool(pi);
  registerGitHubCommand(pi);
}

function registerGitHubTool(pi: ExtensionAPI) {
  pi.registerTool({
    name: "github_pr",
    label: "GitHub PR",
    description:
      "Review GitHub pull requests using the gh CLI. Supports actions: get_pull_request, get_diff, list_files, list_comments, create_comment (inline or general), reply_comment, approve, request_changes, comment_review. Repo is inferred from the current git worktree (gh defaults). Requires gh CLI to be installed and authenticated. Output is truncated to 2000 lines or 50KB; full output is saved to a temp file when truncated.",
    parameters: GitHubToolParams,

    async execute(_toolCallId, rawParams, signal) {
      const params = rawParams as GitHubToolInput;
      try {
        const { prNumber } = resolveContext(params);
        const action = params.action as GitHubAction;

        switch (action) {
          case "get_pull_request": {
            return await handleGetPullRequest(prNumber, signal);
          }
          case "get_diff": {
            return await handleGetDiff(prNumber, signal);
          }
          case "list_files": {
            return await handleListFiles(prNumber, signal);
          }
          case "list_comments": {
            return await handleListComments(prNumber, signal);
          }
          case "create_comment": {
            if (!params.comment) {
              throw new Error(
                "comment payload is required for create_comment.",
              );
            }
            return await handleCreateComment(prNumber, params.comment, signal);
          }
          case "reply_comment": {
            if (!params.comment?.comment_id) {
              throw new Error(
                "comment.comment_id is required for reply_comment.",
              );
            }
            if (!params.comment?.body) {
              throw new Error("comment.body is required for reply_comment.");
            }
            return await handleReplyComment(
              prNumber,
              params.comment.comment_id,
              params.comment.body,
              signal,
            );
          }
          case "approve": {
            return await handleReview(
              prNumber,
              "approve",
              params.review_body,
              signal,
            );
          }
          case "request_changes": {
            if (!params.review_body) {
              throw new Error("review_body is required for request_changes.");
            }
            return await handleReview(
              prNumber,
              "request_changes",
              params.review_body,
              signal,
            );
          }
          case "comment_review": {
            if (!params.review_body) {
              throw new Error("review_body is required for comment_review.");
            }
            return await handleReview(
              prNumber,
              "comment",
              params.review_body,
              signal,
            );
          }
          default:
            throw new Error(`Unsupported action: ${action}`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const details: Record<string, unknown> = { error: message };
        if (error instanceof GitHubError) {
          details.exitCode = error.exitCode;
          details.stderr = error.stderr;
        }
        return {
          content: [
            {
              type: "text" as const,
              text: `GitHub request failed: ${message}`,
            },
          ],
          details,
          isError: true,
        };
      }
    },
  });
}

function registerGitHubCommand(pi: ExtensionAPI) {
  pi.registerCommand("github", {
    description:
      "Review or respond to GitHub pull requests via the github_pr tool. Usage: /github <review|respond> <pr>. Automatically checks out the PR into a git worktree and lets gh detect the repo from git remotes.",
    getArgumentCompletions: (prefix: string) => {
      const options = ["review", "respond"].filter((opt) =>
        opt.startsWith(prefix),
      );
      return options.length
        ? options.map((opt) => ({ value: `${opt} `, label: opt }))
        : null;
    },
    handler: async (args, ctx) => {
      const parsed = parseGitHubCommandArgs(args);
      if ("error" in parsed) {
        notify(ctx, parsed.error, "error");
        return;
      }

      const { action, prNumber } = parsed;

      let worktreePath: string | undefined;
      try {
        const worktree = prepareGitHubWorktree(prNumber);
        worktreePath = worktree.worktreePath;
        notify(
          ctx,
          `Checked out PR #${prNumber} into worktree ${worktreePath}`,
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
          ? buildGitHubReviewPrompt(prNumber, worktreePath)
          : buildGitHubRespondPrompt(prNumber, worktreePath);

      pi.sendUserMessage(message);
      notify(
        ctx,
        `Started GitHub ${action} flow for PR #${prNumber}${worktreePath ? ` (worktree: ${worktreePath})` : ""}.`,
        "info",
      );
    },
  });
}

function parseGitHubCommandArgs(
  args?: string,
): GitHubCommandArgs | { error: string } {
  if (!args?.trim()) {
    return { error: "Usage: /github <review|respond> <pr-number|url>" };
  }

  const parts = args.trim().split(/\s+/);
  const action = parts[0]?.toLowerCase();
  if (action !== "review" && action !== "respond") {
    return { error: 'First argument must be "review" or "respond".' };
  }

  const prRef = parts[1];
  if (!prRef || prRef.startsWith("--")) {
    return { error: "Provide a pull request number or URL." };
  }

  const prNumber = parseGitHubPrNumber(prRef);
  if (!prNumber) {
    return { error: "Could not parse pull request number from input." };
  }

  return { action, prNumber };
}

function parseGitHubPrNumber(ref: string): number | null {
  const numeric = parseInt(ref, 10);
  if (!Number.isNaN(numeric) && numeric > 0) {
    return numeric;
  }

  const urlMatch = ref.match(/pull\/(\d+)/i);
  if (urlMatch) {
    const pr = parseInt(urlMatch[1], 10);
    return Number.isNaN(pr) ? null : pr;
  }

  return null;
}

function prepareGitHubWorktree(prNumber: number): {
  worktreePath: string;
  branch: string;
} {
  const repoRoot = getRepoRoot();
  const repoName = basename(repoRoot);
  const worktreeBase = join(homedir(), ".pi", "worktrees", repoName);
  mkdirSync(worktreeBase, { recursive: true });

  const branchName = `pi/github/pr-${prNumber}`;
  const worktreePath = join(worktreeBase, `github-pr-${prNumber}`);
  const remoteRef = `refs/remotes/origin/github-pr-${prNumber}`;

  // Ensure origin exists and fetch the PR ref
  runGit(["remote", "get-url", "origin"], repoRoot);
  runGit(["fetch", "origin", `pull/${prNumber}/head:${remoteRef}`], repoRoot);

  ensureBranchAt(repoRoot, branchName, remoteRef);
  ensureWorktree(repoRoot, worktreePath, branchName, remoteRef);

  return { worktreePath, branch: branchName };
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

function buildGitHubReviewPrompt(
  prNumber: number,
  worktreePath?: string,
): string {
  return [
    `Review GitHub pull request #${prNumber}.`,
    worktreePath
      ? `The PR is checked out at ${worktreePath} (git worktree). Run commands and edits there.`
      : undefined,
    `Repo is inferred from git remotes via gh; use the github_pr tool for all GitHub interactions (pull_request_number: ${prNumber}).`,
    "Workflow:",
    "1) Gather context with get_pull_request and list_files, then inspect the diff via get_diff.",
    "2) Perform a thorough review focused on correctness, safety, performance, and tests.",
    "3) For issues, leave inline review comments with github_pr create_comment (include path and line) or reply_comment to continue threads.",
    "4) Conclude with a concise summary. Use request_changes with review_body when blockers remain, comment_review for non-blocking notes, and approve only if the PR is truly ready.",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildGitHubRespondPrompt(
  prNumber: number,
  worktreePath?: string,
): string {
  return [
    `Address outstanding review feedback on GitHub pull request #${prNumber}.`,
    worktreePath
      ? `The PR is checked out at ${worktreePath} (git worktree). Run commands and edits there.`
      : undefined,
    `Repo is inferred from git remotes via gh; use the github_pr tool to fetch and reply (pull_request_number: ${prNumber}).`,
    "Workflow:",
    "1) Retrieve review threads/comments with list_comments and pull additional context with get_pull_request, list_files, and get_diff as needed.",
    "2) For each piece of feedback, inspect the referenced code, make the necessary changes locally, and note what changed.",
    "3) Respond inline: use reply_comment with comment_id for existing threads, or create_comment with path + line for new notes tied to code. Keep replies concise and specific about fixes.",
    "4) Finish with a short summary of addressed feedback. Do not merge or approve your own work automatically.",
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

function resolveContext(params: GitHubToolInput): {
  prNumber: number;
} {
  const prNumber = params.pull_request_number;

  if (!prNumber) {
    throw new Error("pull_request_number is required.");
  }

  return { prNumber };
}

async function runGhCommand(
  args: string[],
  signal?: AbortSignal,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn("gh", args, {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      if (code !== 0) {
        reject(
          new GitHubError(
            `gh command failed with exit code ${code}`,
            code ?? undefined,
            stderr,
          ),
        );
      } else {
        resolve({ stdout, stderr });
      }
    });

    proc.on("error", (err) => {
      reject(new GitHubError(`Failed to spawn gh: ${err.message}`));
    });

    if (signal) {
      signal.addEventListener("abort", () => {
        proc.kill("SIGTERM");
      });
    }
  });
}

async function handleGetPullRequest(prNumber: number, signal?: AbortSignal) {
  const args = [
    "pr",
    "view",
    prNumber.toString(),
    "--json",
    "number,title,state,body,author,createdAt,updatedAt,baseRefName,headRefName,mergeable,reviewDecision,additions,deletions,changedFiles,commits,reviews,comments,labels,assignees,milestone",
  ];

  const { stdout } = await runGhCommand(args, signal);
  return formatResult("get_pull_request", stdout, { prNumber });
}

async function handleGetDiff(prNumber: number, signal?: AbortSignal) {
  const args = ["pr", "diff", prNumber.toString()];

  const { stdout } = await runGhCommand(args, signal);
  return formatResult("get_diff", stdout, { prNumber });
}

async function handleListFiles(prNumber: number, signal?: AbortSignal) {
  const args = ["pr", "view", prNumber.toString(), "--json", "files"];

  const { stdout } = await runGhCommand(args, signal);
  return formatResult("list_files", stdout, { prNumber });
}

async function handleListComments(prNumber: number, signal?: AbortSignal) {
  // Get both PR comments and review comments
  const args = [
    "pr",
    "view",
    prNumber.toString(),
    "--json",
    "comments,reviews",
  ];

  const { stdout } = await runGhCommand(args, signal);
  return formatResult("list_comments", stdout, { prNumber });
}

async function handleCreateComment(
  prNumber: number,
  comment: CommentInput,
  signal?: AbortSignal,
) {
  if (!comment.body?.trim()) {
    throw new Error("comment.body is required.");
  }

  // If path and line are provided, create an inline review comment using the API
  if (comment.path && comment.line) {
    return await createInlineComment(prNumber, comment, signal);
  }

  // Otherwise, create a general PR comment
  const args = ["pr", "comment", prNumber.toString(), "--body", comment.body];

  const { stdout, stderr } = await runGhCommand(args, signal);
  const output = stdout || stderr || "Comment created successfully.";
  return formatResult("create_comment", output, { prNumber });
}

async function createInlineComment(
  prNumber: number,
  comment: CommentInput,
  signal?: AbortSignal,
) {
  // Use gh api to create a review comment on a specific line
  const repoArg = "{owner}/{repo}";
  const endpoint = `/repos/${repoArg}/pulls/${prNumber}/comments`;

  const body: Record<string, unknown> = {
    body: comment.body,
    path: comment.path,
    line: comment.line,
    side: comment.side || "RIGHT",
  };

  if (comment.start_line) {
    body.start_line = comment.start_line;
    body.start_side = comment.side || "RIGHT";
  }

  // We need to get the latest commit SHA for the PR
  const prArgs = ["pr", "view", prNumber.toString(), "--json", "headRefOid"];

  const { stdout: prJson } = await runGhCommand(prArgs, signal);
  const prData = JSON.parse(prJson);
  body.commit_id = prData.headRefOid;

  const args = [
    "api",
    "--method",
    "POST",
    endpoint,
    "-f",
    `body=${comment.body}`,
    "-f",
    `path=${comment.path}`,
    "-F",
    `line=${comment.line}`,
    "-f",
    `side=${comment.side || "RIGHT"}`,
    "-f",
    `commit_id=${prData.headRefOid}`,
  ];

  if (comment.start_line) {
    args.push("-F", `start_line=${comment.start_line}`);
    args.push("-f", `start_side=${comment.side || "RIGHT"}`);
  }

  const { stdout } = await runGhCommand(args, signal);
  return formatResult(
    "create_comment",
    stdout || "Inline comment created successfully.",
    { prNumber },
  );
}

async function handleReplyComment(
  prNumber: number,
  commentId: number,
  body: string,
  signal?: AbortSignal,
) {
  // Use gh api to reply to a review comment
  const repoArg = "{owner}/{repo}";
  const endpoint = `/repos/${repoArg}/pulls/${prNumber}/comments/${commentId}/replies`;

  const args = ["api", "--method", "POST", endpoint, "-f", `body=${body}`];

  const { stdout } = await runGhCommand(args, signal);
  return formatResult(
    "reply_comment",
    stdout || "Reply created successfully.",
    { prNumber },
  );
}

async function handleReview(
  prNumber: number,
  reviewType: "approve" | "request_changes" | "comment",
  body: string | undefined,
  signal?: AbortSignal,
) {
  const args = ["pr", "review", prNumber.toString()];

  switch (reviewType) {
    case "approve":
      args.push("--approve");
      break;
    case "request_changes":
      args.push("--request-changes");
      break;
    case "comment":
      args.push("--comment");
      break;
  }

  if (body) {
    args.push("--body", body);
  }

  const { stdout, stderr } = await runGhCommand(args, signal);
  const output = stdout || stderr || `Review submitted: ${reviewType}`;
  return formatResult(
    reviewType === "comment" ? "comment_review" : reviewType,
    output,
    { prNumber },
  );
}

function formatResult(
  action: string,
  text: string,
  context: { prNumber: number },
) {
  if (!text.trim()) {
    return {
      content: [{ type: "text" as const, text: "No content returned." }],
      details: {
        action,
        pull_request_number: context.prNumber,
      },
    };
  }

  const { output, truncation, fullOutputPath } = applyTruncation(text);

  return {
    content: [{ type: "text" as const, text: output }],
    details: {
      action,
      pull_request_number: context.prNumber,
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

  const tempDir = mkdtempSync(join(tmpdir(), "pi-github-"));
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
