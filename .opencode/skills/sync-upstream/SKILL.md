---
name: Sync Fork with Upstream
description: Sync this fork (freshy86/open-webui) with the official open-webui/open-webui repo — fetch upstream, fast-forward only the `main` branch, and push only the latest release tag. Use when the user asks to sync the fork with the official repo, update from upstream, or pull/push the latest tag.
---

Sync `origin` (`freshy86/open-webui`) with `upstream`
(`https://github.com/open-webui/open-webui`). **Scope: the `main` branch and
the latest release tag only.** Other branches (`dev`, `dependabot/*`, feature
branches) are NOT synced. Run from the repo root. This is safe on any
checked-out branch and never touches the working tree.

## 0. Hard rules

- **Fast-forward only. Never force-push.** If the fork `main` diverged from
  upstream `main`, skip it and report — never resolve, never rewrite.
- **Never touch any branch other than `main`.** Fork-only branches (e.g.
  `v0.12.4_modified`), `dev`, and the current local checkout are left
  completely alone. All syncing happens via push refspecs against `origin` —
  no local branch is ever checked out, reset, or merged.
- **Never push to upstream.** This is one-way: official → fork.
- Verify everything with `git ls-remote`; **do not trust push output**. It can
  omit ref-update lines for refs that did update (seen on 2026-10-31: the
  `main` push line was missing from output but the ref did move).

## 1. Remotes (check, don't assume)

```sh
git remote -v
```

Expect `origin` = `git@github.com:freshy86/open-webui.git` (SSH) and `upstream`
= `https://github.com/open-webui/open-webui.git`. Add upstream if missing:

```sh
git remote add upstream https://github.com/open-webui/open-webui.git
```

## 2. Fetch upstream with all tags

```sh
git fetch upstream --tags --prune
```

Use a generous timeout (300 s or more). `--prune` drops stale
`upstream/*`-prefixed tracking refs; it does not touch local tags or branches.

## 3. Sync `main` only

Compare the remote SHAs directly — never compare against local `main`, which
may be stale. Ignore every other branch (including `dev` and all
`dependabot/*` branches): they are out of scope, do not create, update, or
report on them beyond noting they were skipped.

Classify `main` against `origin`:

- same SHA → up to date, skip
- origin's SHA is an ancestor of upstream's → fast-forward it
- diverged → **skip and report** (hard rule above)

```sh
upstream_sha=$(git ls-remote upstream refs/heads/main | awk '{print $1}')
origin_sha=$(git ls-remote origin refs/heads/main | awk '{print $1}')
if [ "$origin_sha" = "$upstream_sha" ]; then
  echo "UP-TO-DATE:   main $origin_sha"
elif git merge-base --is-ancestor "$origin_sha" "$upstream_sha"; then
  echo "FAST-FORWARD: main $origin_sha -> $upstream_sha"
  git push origin "upstream/main:main"
else
  echo "DIVERGED (SKIPPED): main origin=$origin_sha upstream=$upstream_sha"
fi
```

`merge-base --is-ancestor` works here because step 2 fetched the upstream
objects into the local repo.

## 4. Push only the latest release tag

All upstream tags are already local after step 2. Identify the latest release
tag by version sort (upstream has ~178 tags; `grep -v '\^{}'` excludes the
peeled `^{}` duplicate lines):

```sh
latest_tag=$(git tag --list 'v*' | grep -v '\^{}' | sort -V | tail -1)
echo "latest release tag: $latest_tag"
```

Push it only if missing on origin:

```sh
if [ -z "$(git ls-remote origin "refs/tags/$latest_tag")" ]; then
  git push origin "$latest_tag"
else
  echo "$latest_tag already on origin"
fi
```

Do **not** run `git push origin --tags` — it would push every new tag, which
is out of scope. If the tag push is rejected because a same-named tag already
exists on origin pointing elsewhere, **stop and report** — do not
force-update tags.

## 5. Verify (mandatory)

```sh
git ls-remote origin refs/heads/main "refs/tags/$latest_tag"
git ls-remote upstream refs/heads/main "refs/tags/$latest_tag"
```

Both lines of `origin` output must match the corresponding `upstream` SHAs
exactly: `refs/heads/main` identical, and the tag resolved to the same SHA
(the tag's own SHA if annotated; compare the peeled `^{}` line if present).

## 6. Report

One line each: `main` fast-forwarded or up-to-date or diverged (with reason),
latest release tag pushed or already present (with the tag name). Confirm the
working tree and current branch were untouched. Mention explicitly that other
branches and older tags were not synced (out of scope).
