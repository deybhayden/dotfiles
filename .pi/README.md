# Pi Agent Configuration

This directory contains globally loaded pi extensions and task-specific skills. After editing files here, run `/reload` in pi (or restart) to pick up changes.

## Extensions

Extensions add commands, tools, and behaviors to the agent. Located in `agent/extensions/`.

| File | Commands/Tools | Summary |
| --- | --- | --- |
| `answer.ts` | `/answer`, `Ctrl+.` | Extracts questions from the last assistant reply and opens an interactive Q&A UI to answer them. Sends a custom message with the compiled answers. |
| `review.ts` | `/review`, `/end-review` | Interactive code review workflow for GitHub PRs, branches, commits, uncommitted changes, or custom instructions. Supports a fresh review branch and optional summarization when ending the review. |
| `todos.ts` | `/todos`, tool: `todo` | File-based todo manager (stored in `.pi/todos` or `$PI_TODO_PATH`) with interactive TUI plus LLM tool actions. |
| `uv.ts` | tool: `bash` (wrapped) | Redirects Python tooling to `uv` equivalents by prepending shim commands to `PATH`. Blocks `pip`/`poetry` and rewrites `python` to `uv run`. |
| `bitbucket.ts` | `/bitbucket review`, `/bitbucket respond`, tool: `bitbucket_pr` | Bitbucket PR review/responder helper that auto-checks out PRs in a git worktree, fetches PR data/diffs, replies inline, and approves/requests changes via the Bitbucket API. |
| `github.ts` | `/github review`, `/github respond`, tool: `github_pr` | GitHub PR review/responder helper that auto-checks out PRs in a git worktree and uses the `gh` CLI to fetch PR data/diffs, reply inline, and approve/request changes. |
| `web-search.ts` | tool: `web_search` | Adds live web/news search (Bing RSS) so the agent can research current events and recent best practices. |

### Extension details

#### answer.ts

- **Command:** `/answer` (or `Ctrl+.`)
- **Behavior:** Extracts questions from the last assistant message, then opens a TUI to answer them. Submits the compiled Q&A as a custom message and triggers a new turn.
- **Notes:** Requires interactive mode. Prefers Codex mini for extraction, then Anthropic Haiku, then the current model.

#### review.ts

- **Commands:** `/review`, `/end-review`
- **Review targets:**
  - `/review` (interactive selector)
  - `/review pr <number|url>`
  - `/review branch <name>`
  - `/review uncommitted`
  - `/review commit <sha>`
  - `/review custom "instructions"`
- **Notes:**
  - Requires `git` and `gh` (GitHub CLI) for PR checkout.
  - PR review requires a clean working tree (no tracked uncommitted changes).
  - If `REVIEW_GUIDELINES.md` exists alongside the project's `.pi` directory, it is appended to the review prompt.
  - `/end-review` optionally summarizes the review branch before returning to the original session.

#### todos.ts

- **Command:** `/todos` (interactive manager)
- **Tool:** `todo` with actions `list`, `list-all`, `get`, `create`, `update`, `append`, `delete`, `claim`, `release`
- **Storage:** `.pi/todos` by default, or `$PI_TODO_PATH` (relative to project root if set).
- **Notes:** Todos are stored as Markdown files with a JSON front matter block. Supports assignment locks, quick actions, and clipboard utilities.

#### uv.ts

- **Tool override:** wraps the built-in `bash` tool to prepend shim commands.
- **Behavior:**
  - Blocks `pip`/`pip3` and suggests `uv add` or `uv run --with`.
  - Blocks `poetry` and suggests `uv` alternatives.
  - Redirects `python`/`python3` to `uv run python` (blocks `python -m pip` and `python -m venv`).

#### bitbucket.ts

- **Commands:** `/bitbucket review <pr-id>`, `/bitbucket respond <pr-id>`
- **Tool:** `bitbucket_pr` (workspace/repo auto-detected from git remotes; fallback to `BITBUCKET_WORKSPACE` + `BITBUCKET_REPO_SLUG`/`BITBUCKET_REPO`)
- **Actions:** `get_pull_request`, `get_diff`, `get_diffstat`, `list_comments`, `create_comment`, `approve`, `unapprove`, `request_changes`, `remove_request_changes`
- **Auth:**
  - Preferred: `BITBUCKET_ACCESS_TOKEN` (Bearer)
  - Or: `BITBUCKET_USERNAME` + `BITBUCKET_APP_PASSWORD` (or `BITBUCKET_API_TOKEN`)
- **Checkout:** PRs are checked out into a git worktree under `~/.pi/worktrees/<repo>/bitbucket-pr-<id>`.
- **Defaults:**
  - `BITBUCKET_BASE_URL` to override `https://api.bitbucket.org/2.0`
- **Inline comment payload:**
  - `comment.path` + `comment.line` (or `comment.start_line`) with `line_type`/`start_line_type` set to `to` or `from`.
- **Respond flow:** Reads review threads via `bitbucket_pr list_comments`, applies fixes, and replies inline using `create_comment` (set `parent_id` for replies and include `path`/`line`/`line_type` to anchor code-specific responses).

Example call:

```json
{
  "action": "create_comment",
  "pull_request_id": 123,
  "comment": {
    "content": "Please handle the error case here.",
    "path": "src/foo.ts",
    "line": 42,
    "line_type": "to"
  }
}
```

#### github.ts

- **Commands:** `/github review <pr>`, `/github respond <pr>`
- **Tool:** `github_pr` (repo inferred from the current git worktree/`gh` defaults)
- **Actions:** `get_pull_request`, `get_diff`, `list_files`, `list_comments`, `create_comment`, `reply_comment`, `approve`, `request_changes`, `comment_review`
- **Requirements:** `gh` CLI must be installed and authenticated (`gh auth login`)
- **Checkout:** PRs are checked out into a git worktree under `~/.pi/worktrees/<repo>/github-pr-<id>`.
- **Parameters:**
  - `action` – one of the supported actions
  - `pull_request_number` – PR number (required)
  - `comment` – comment payload for `create_comment`/`reply_comment`
  - `review_body` – body text for `approve`, `request_changes`, `comment_review`
- **Comment payload:**
  - `body` – comment text (markdown, required)
  - `path` – file path for inline comments
  - `line` – line number in the diff (1-based)
  - `side` – `LEFT` (deletions) or `RIGHT` (additions, default)
  - `start_line` – start line for multi-line comments
  - `comment_id` – comment ID to reply to (for `reply_comment`)
- **Respond flow:** Reads review threads with `github_pr list_comments`, addresses feedback, and replies inline via `reply_comment` (for threads) or `create_comment` with `path`/`line` for new anchors before summarizing changes.

Example calls:

```json
{
  "action": "get_pull_request",
  "pull_request_number": 42
}
```

```json
{
  "action": "create_comment",
  "pull_request_number": 42,
  "comment": {
    "body": "Consider using a constant here.",
    "path": "src/utils.ts",
    "line": 15,
    "side": "RIGHT"
  }
}
```

```json
{
  "action": "request_changes",
  "pull_request_number": 42,
  "review_body": "Please address the security concerns before merging."
}
```

```json
{
  "action": "reply_comment",
  "pull_request_number": 42,
  "comment": {
    "comment_id": 123456789,
    "body": "Good point, I'll fix that."
  }
}
```

#### web-search.ts

- **Tool:** `web_search`
- **Purpose:** Quick web/news lookup for up-to-date guidance (for example, 2026 best practices) and current events.
- **Provider:** Bing RSS feeds (`/search?format=rss` and `/news/search?format=rss`).
- **Parameters:**
  - `query` – search query text
  - `type` – `web` (default) or `news`
  - `max_results` – number of results to return (default `5`, max `15`)
  - `market` – Bing locale/market such as `en-US` (default)
- **Result shape:** Returns numbered results with title, canonical URL, snippet, and (when present) source/publication date metadata.

---

## Skills

Skills provide task-specific instructions that the agent loads when needed. Located in `agent/skills/`.

| Skill | Description |
| --- | --- |
| **commit** | Guidance for making git commits. |
| **frontend-design** | Direction for designing and implementing production-ready frontend interfaces. |
| **uv** | Instructions for using `uv` for Python dependency and script management. |
| **vscode** | Notes on using VS Code integration for viewing diffs and comparing files. |
| **web-browser** | Steps for remote-controlling Chrome via CDP for web browsing tasks. |

Each skill lives in its own subdirectory with a `SKILL.md` that the agent reads when the task matches its description.

### Adding a new skill

Create a directory under `agent/skills/` with a `SKILL.md` that explains when and how to use it, and include any supporting files needed by the skill.
