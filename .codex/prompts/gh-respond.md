---
description: Respond to a GitHub code review
argument-hint: PR=<number> [FOCUS=<section>]
---

Review the feedback comments on the pull request for the PR $PR. Address them in Github using `gh` if they are invalid or dangerous.

For change requests that make sense to implement, carefully add fixes and tests where they are needed then, commit and push to the branch.

In each comment posted within the PR, I want you to include:

"🧑🏻‍⚕️ First Responder:" to make it clear that while my github user is being used, the actual response is being done by Codex.

### gh instructions

Workflow

- Checkout PR: `gh pr checkout <number>`; ensure clean tree `git status -sb`; compare to main `git diff --stat main`.
- Inspect changes: `git diff main -- <file>` and `rg` for cross-file signals.

Inline comments

- Preferred: `gh api repos/<owner>/<repo>/pulls/<num>/comments -f body='🦾 Mecha-Ben: <comment>' -f commit_id=<sha> -f path=<file> -f position=<pos>`.
- Position is the unified diff position (not file line). Get it via `git diff main...HEAD -U0 -- <file> | nl -ba` and count added/hunk lines.
- Alternate quick note: `gh pr comment <num> --body '🦾 Mecha-Ben: ...'` (not line-specific).
