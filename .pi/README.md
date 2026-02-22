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
| `web-search.ts` | tools: `web_search`, `fetch_url` | Adds web search via Brave Search API and full-page content extraction via Mozilla Readability. Requires `BRAVE_API_KEY`. |
| `session-breakdown.ts` | `/session-breakdown` | Interactive TUI showing last 7/30/90 days of session usage—GitHub-style contribution calendar colored by model, plus per-model session count and cost table. |
| `super-review.ts` | `/super-review`, `/end-super-review` | Runs a code review in parallel across multiple models (configured in `super-review.json`), emits individual per-model reports, then synthesizes a combined summary. Supports the same review targets as `/review`. |
| `system-theme.ts` | *(background)* | Polls Windows system appearance every 2 s via PowerShell and automatically switches pi between `dark` and `light` themes to match. |

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

Registers two tools: `web_search` and `fetch_url`.

**`web_search`**
- **Provider:** Brave Search API (`https://api.search.brave.com/res/v1/web/search`)
- **Auth:** Requires `BRAVE_API_KEY` environment variable (free key at [brave.com/search/api](https://brave.com/search/api/))
- **Parameters:**
  - `query` – search query text; include specifics (year, framework, country) for better results
  - `count` – number of results to return (default `5`, max `20`)
  - `freshness` – `"pd"` (day), `"pw"` (week), `"pm"` (month), `"py"` (year), or `"YYYY-MM-DDtoYYYY-MM-DD"`
  - `country` – two-letter country code for localized results (e.g. `US`, `GB`, `DE`)
- **Result shape:** Numbered list of results with title, URL, and snippet. Output is truncated to 2000 lines or 50 KB (whichever is hit first); full output is saved to a temp file when truncated.

**`fetch_url`**
- **Purpose:** Fetches a URL and returns clean, readable Markdown. Uses Mozilla Readability to strip navigation, ads, and boilerplate, then converts to Markdown via Turndown.
- **Parameters:**
  - `url` – URL to fetch (required)
  - `selector` – CSS selector to narrow extraction before Readability runs (e.g. `'main'`, `'.docs-content'`, `'#api-reference'`)
  - `maxLength` – max characters to return (default `15000`)
  - `includeLinks` – preserve hyperlinks in output (default `false`, stripped to save tokens)
- **Result shape:** Markdown with a header block (title, byline, source URL, extracted/original length), then the page content. Truncated to 2000 lines or 50 KB with full content saved to a temp file when exceeded.

#### session-breakdown.ts

- **Command:** `/session-breakdown`
- **Purpose:** Interactive TUI that reads all `*.jsonl` session files under `~/.pi/agent/sessions` and presents usage statistics for the last 7, 30, or 90 days.
- **Display:**
  - GitHub-contributions-style calendar (weeks × weekdays). Cell color is a weighted mix of model colors (by cost, or by session count when cost is unavailable); brightness is log-scaled cost or session count per day.
  - Per-model table: session count, total cost, and cost share for the selected range.
  - Summary line: total sessions, total cost, and average cost per session.
- **Navigation:** `←`/`→` (or `h`/`l`) to switch time ranges; `1`/`2`/`3` to jump directly; `q` or `Esc` to close.
- **Non-interactive mode:** Falls back to printing a plain-text 30-day summary.
- **Notes:** No API calls are made; all data is parsed locally from session JSONL files.

#### super-review.ts

- **Commands:** `/super-review`, `/end-super-review`
- **Purpose:** Runs the same review prompt against multiple LLM models in parallel, emits an individual report per model, then generates a combined summary.
- **Review targets** (same syntax as `/review`):
  - `/super-review` — interactive selector
  - `/super-review uncommitted`
  - `/super-review branch <name>`
  - `/super-review commit <sha>`
  - `/super-review pr <number|url>` (requires `gh` CLI)
  - `/super-review folder <paths…>`
  - `/super-review custom "instructions"`
- **Config:** Reads `super-review.json` from the project's `.pi/` directory first, then from `~/.pi/agent/`. If neither exists, offers to create one via an in-TUI editor.
- **Config schema (`super-review.json`):**
  ```json
  {
    "models": [
      { "provider": "anthropic", "id": "claude-opus-4-5", "label": "Opus" },
      { "provider": "openai", "id": "o3", "label": "O3", "thinkingLevel": "medium" }
    ],
    "summaryModel": { "provider": "anthropic", "id": "claude-opus-4-5" },
    "summaryPrompt": "(optional extra instructions for the summary step)",
    "maxParallel": 2
  }
  ```
  - `thinkingLevel` — one of `off`, `minimal`, `low`, `medium`, `high`, `xhigh`
  - `maxParallel` — concurrency cap (defaults to all models in parallel)
- **Session branching:** Like `/review`, creates a fresh session branch so the multi-model review stays isolated. `/end-super-review` returns to the origin session (with an optional summary).
- **Requirements:** `pi` CLI must be on `PATH`; `gh` CLI required for PR checkout.

#### system-theme.ts

- **Purpose:** Automatically syncs pi's active theme to the Windows system appearance (light/dark mode).
- **Mechanism:** Polls the Windows registry key `HKCU\…\Themes\Personalize\AppsUseLightTheme` via `powershell.exe` every 2 seconds.
- **Behavior:** On theme change, calls `ctx.ui.setTheme()` with `"dark"` or `"light"` and persists the choice via `SettingsManager`.
- **Notes:** No-op when `powershell.exe` is unavailable (e.g. Linux/macOS). Polling stops on `session_shutdown`.

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
