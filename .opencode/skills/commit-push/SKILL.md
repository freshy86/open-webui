---
name: Commit & Push
description: Stage working-tree changes, write a conventional commit message, and push to the current branch. Use when the user asks to commit, push, or ship their changes.
---

Commit and push the current working-tree changes quickly, without unnecessary
questions, but never blindly. Follow these steps in order.

## 1. Inspect before staging

Run `git status --short` and `git diff` (plus `git diff --cached`) to understand
what actually changed. Skim the diff, do not guess from filenames alone.

- If the changes form one logical unit, stage everything relevant and proceed.
- If the tree contains clearly unrelated changes, split them into separate
  commits by path (`git add <paths>` per logical unit). Only ask the user when
  the split is genuinely ambiguous.
- If there are no changes at all, say so and stop.

## 2. Never commit secrets or junk

Before staging, make sure none of these get included:

- `.env`, credentials, API keys, tokens, private keys
- `backend/data/` (local SQLite database, uploads, vector DB)
- Build output (`static/`, `node_modules/`, `.svelte-kit/`)

If a secret-looking file is tracked in the diff, stop and warn the user. If such
files are untracked, leave them out — do not add them even with a blanket add.

## 3. Write the commit message

Use a conventional-commit prefix, matching the style of the repo's recent
history (`git log --oneline -10`):

- `feat`, `fix`, `chore`, `docs`, `refactor`, `perf`, `build`, `ci`, `i18n`,
  `BREAKING CHANGE`
- Subject line: imperative mood, lowercase after the prefix, no trailing
  period, ≤ 72 characters.
- If the change needs explanation, add a blank line then a short body with the
  why, not the how. Omit the body for trivial changes.

Good: `docs: document WEBUI_SECRET_KEY startup requirement in AGENTS.md`
Good: `fix: resolve build-info hash validation for short hashes`
Bad: `update files`, `changes`, `stuff`

## 4. Commit and push

Commit from the repo root:

```sh
git add <paths or -A only when step 2 is clean>
git commit -m "<type>: <subject>"
```

Then push the current branch to its upstream:

```sh
git push
```

If no upstream exists yet (`git rev-parse --abbrev-ref @{upstream}` fails), use
`git push -u origin <branch>`. If the push is rejected because the remote is
ahead, fetch and rebase first (`git pull --rebase`), then push again. Never
force-push unless the user explicitly asks.

## 5. Report

Confirm with one line each: the commit hash and subject, the branch pushed, and
anything you deliberately left uncommitted.
