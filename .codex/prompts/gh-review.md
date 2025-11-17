---
description: Request a GitHub code review
argument-hint: PR=<number> [FOCUS=<section>]
---

I want you to do a deep dive on PR $PR using `gh` to pull down a local copy and comparing it to the main branch.

Read and understand all of the principals that we have lined out in the Review Guidelines section of AGENTS.md, and then add the code review via `gh` comments on specific line numbers as well.

In each comment posted within the code review, I want you to include:

"🦾 Mecha-Ben:" to make it clear that while my github user is being used, the actual review is being done by Codex.

### gh instructions

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
