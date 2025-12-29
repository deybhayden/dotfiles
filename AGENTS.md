## General

- Follow conventional commits format with tight scopes.
- Do not use emojis.

### GitHub PR reviews with gh

Workflow

- Checkout PR: `gh pr checkout <number>`; ensure clean tree `git status -sb`; compare to main `git diff --stat main`.
- Inspect changes: `git diff main -- <file>` and `rg` for cross-file signals.

Inline comments

- Preferred: `gh api repos/<owner>/<repo>/pulls/<num>/comments -f body='🦾 Mecha-Ben: <comment>' -f commit_id=<sha> -f path=<file> -f position=<pos>`.
- Position is the unified diff position (not file line). Get it via `git diff main...HEAD -U0 -- <file> | nl -ba` and count added/hunk lines.
- Alternate quick note: `gh pr comment <num> --body '🦾 Mecha-Ben: ...'` (not line-specific).

Submit review

- `gh pr review <num> --request-changes|--comment|--approve --body '<summary>'` where inline comments are already posted.

Conventions

- Prefix every inline comment with "🦾 Mecha-Ben:" to signal Codex-authored feedback.
- Keep feedback actionable (what/why/how). Avoid secrets and destructive git commands.
