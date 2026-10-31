---
name: Merge Release Tag
description: Create a new _modified branch from the latest fork branch and merge the latest upstream release tag into it, auto-resolving both-sides-added conflicts, asking the user about real conflicts, and running the tests plus build before considering the merge done. Use when the user asks to cut a new release branch, merge a release tag into the fork, or sync a _modified branch with a new upstream version.
---

Merge the latest upstream release tag into the latest fork branch, producing a
new `<version>_modified` branch. Run from the repo root. Based on the
2026-10-31 `v0.12.5` → `v0.12.5_modified` merge (65 conflicts, all
both-sides-added, auto-resolved).

## Load fork feature context first

Before any git work, read **every file in `.opencode/fork/`** — `INDEX.md` and
all files under `features/` — and make sure you understand each fork feature
in detail: what it does, which files it touches, and how it interacts with
upstream code. This is the baseline context for every conflict decision:
when a merge hunk involves fork-side code, you must know which feature it
belongs to and what breaking it would break. Do not skip or skim this step,
even if the merge looks trivial.

## 0. Determine "latest"

Do not hardcode names — detect them:

- **Latest release tag**: highest semver among local tags that look like
  `v<MAJOR>.<MINOR>.<PATCH>` (no `-rc`, no `-test`, no date suffix). E.g.
  among `v0.12.4`, `v0.12.5`, `v0.13.0-rc1` → `v0.12.5`. Sort numerically, not
  lexicographically (`v0.12.10 > v0.12.9`).
- **Latest fork branch**: the `_modified` branch with the highest version.
  If the latest fork branch already equals the target name (e.g. a
  `v0.12.5_modified` exists and is current), reuse it instead of creating a
  duplicate.

If upstream tags are stale locally, the `sync-upstream` skill may need to run
first — check whether the desired tag exists (`git tag -l 'v*'`), and if not,
ask whether to fetch upstream (`git fetch upstream --tags --prune`).

## 1. Pre-flight

```sh
git status --short        # must be clean; stop if dirty
git branch --show-current # note the current branch — the merge must not disturb it
git log --oneline -1 "$latest_fork_branch" -- 2>/dev/null   # sanity: exists
```

## 2. Create the branch

```sh
git switch -c <version>_modified <latest_fork_branch>
```

Example: `git switch -c v0.12.5_modified v0.12.4_modified`.

## 3. Merge the tag

```sh
git merge <latest_release_tag>
```

## 4. Resolve conflicts — auto only when both sides added

For each conflicted file, inspect the conflict hunks (`grep -n '<<<<<<<' <file>`
then read the surrounding lines). Classify every hunk:

**Auto-resolve (union) — safe only when the hunk is purely additive on both
sides** (HEAD added X, upstream added Y, neither side modified shared lines):

- Fork feature code vs upstream new code in the same file → keep both blocks
  (fork block first, then upstream's).
- Locale files: fork-added keys vs upstream-added keys → keep both key sets,
  `""` values matching upstream's convention (key = source string; only cased
  variants like `"Move to top level"` get values). Never drop either side's
  keys — the fork's UI strings and upstream's new keys must both survive.
- A uniform pattern across many files can be resolved with one script:
  ```python
  import subprocess, re
  files = subprocess.check_output(['git','diff','--name-only','--diff-filter=U'], text=True).split()
  pat = re.compile(r'<<<<<<< HEAD\n(.*?)\n=======\n(.*?)\n>>>>>>> [^\n]+\n', re.S)
  for f in files:
      txt = open(f).read()
      txt2 = pat.sub(lambda m: m.group(1) + '\n' + m.group(2) + '\n', txt)
      open(f, 'w').write(txt2)
  ```
  But only run it after verifying **all** conflicted files match the pure
  additive pattern (inspect at least the union of distinct head/upstream key
  or symbol sets, e.g. with a quick Python scan reporting each side's keys).

**Escalate to the user — do not guess** when any of these hold:

- Both sides modified the *same* lines (not just added side by side).
- One side deleted lines the other side kept or modified.
- The two sides' additions are mutually exclusive (duplicate symbol names,
  clashing function signatures, same config key with different defaults).
- A conflict marker sits inside a generated/vendored file (`static/`,
  `node_modules/`) — stop instead of hand-editing.

When escalating, show the user each conflicting hunk (both sides), state what
each side's change does, and offer: keep fork / keep upstream / keep both /
manual. **Never silently pick a side on a real conflict.**

## 5. Verify before committing

```sh
grep -rn '<<<<<<<\|>>>>>>>' src backend/open_webui | grep -v node_modules  # no markers left
npm run i18n:check        # placeholder/translation validation (CI gate)
npx vitest run            # all frontend tests, one-shot (see gotcha below)
npm run build             # authoritative frontend check — run in background, takes ~1-2 min
```

If the merge touched backend Python, also `ruff format . && ruff check .`.

**Test gotchas:**

- Use `npx vitest run` (one-shot), not `npm run test:frontend` — the watch
  script can fail with an inotify `ENOSPC` when dev servers are running.
- When the merge resolves a conflict in `utils.ts` by keeping both sides'
  exports, check whether each side's exports clash (duplicate names). The
  fork's `move-note-to-knowledge` feature adds `noteFilename`,
  `moveNoteToKnowledge`, and `moveNoteToKnowledgeFlow` to
  `src/lib/components/notes/utils.ts`; upstream may add helpers there too.
  Duplicate export names are a real conflict, not an auto-resolve.
- A failing test may point at a fork feature that upstream's merge changed
  (e.g. an upstream rename of a component or store the fork code depends on).
  Diagnose the failure, fix the fork code so the feature keeps working with
  upstream's changes, and re-run the tests — do not skip or weaken a test to
  make the merge pass.

Only commit once the build exits successfully and the tests pass (the only
acceptable "error" grep hits in the build log are page filenames like
`pages/_error.svelte.js`). If tests fail and the fix is not obvious, stop and
report before committing anything.

## 6. Commit

```sh
git add -A
git commit --no-edit     # keeps the default "Merge tag 'vX.Y.Z' into ..." message
```

Do not push unless the user asks — per fork directive 1, pushing is the
user's call. Suggest next steps in the report: push the branch, and
`docker-build-push` if an image for the new branch is wanted.

## 7. Report

One line each: new branch name and its parent, tag merged, conflict summary
(N auto-resolved as both-sides-added, M escalated and how each was resolved),
verification results (tests — pass/fail count, i18n, build), and the merge
commit hash. Never report a merge as done with failing tests outstanding.
