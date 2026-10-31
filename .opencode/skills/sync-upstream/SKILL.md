---
name: Sync Fork with Upstream
description: Sync this fork (freshy86/open-webui) with the official open-webui/open-webui repo — fetch upstream, fast-forward only the fork branches that changed upstream, pull all tags, and push the tags. Use when the user asks to sync the fork with the official repo, update from upstream, or pull/push tags.
---

Sync `origin` (`freshy86/open-webui`) with `upstream`
(`https://github.com/open-webui/open-webui`). Run from the repo root. This is
safe on any checked-out branch and never touches the working tree.

## 0. Hard rules

- **Fast-forward only. Never force-push.** If a fork branch diverged from
  upstream, skip it and report — never resolve, never rewrite.
- **Never touch any branch except the ones changed on the official repo.**
  Fork-only branches (e.g. `v0.12.4_modified`) and the current local checkout
  are left completely alone. All syncing happens via push refspecs against
  `origin` — no local branch is ever checked out, reset, or merged.
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

## 3. Sync only the branches that changed upstream

Compare the remote SHAs directly — never compare against local `main`/`dev`,
which may be stale. For every branch on upstream, classify against `origin`:

- same SHA → up to date, skip
- missing on origin → **new upstream branch**: create it on origin
- origin's SHA is an ancestor of upstream's → fast-forward it
- diverged → **skip and report** (hard rule above)

```sh
git ls-remote --heads upstream | while read -r sha ref; do
  branch=${ref#refs/heads/}
  origin_sha=$(git ls-remote origin "refs/heads/$branch" | awk '{print $1}')
  if [ -z "$origin_sha" ]; then
    echo "NEW:          $branch -> $sha"
    git push origin "upstream/$branch:$branch"
  elif [ "$origin_sha" = "$sha" ]; then
    echo "UP-TO-DATE:   $branch"
  elif git merge-base --is-ancestor "$origin_sha" "$sha"; then
    echo "FAST-FORWARD: $branch $origin_sha -> $sha"
    git push origin "upstream/$branch:$branch"
  else
    echo "DIVERGED (SKIPPED): $branch origin=$origin_sha upstream=$sha"
  fi
done
```

`merge-base --is-ancestor` works here because step 2 fetched all upstream
objects into the local repo. Verify afterwards with
`git ls-remote origin refs/heads/main refs/heads/dev` (and any new branches).

## 4. Pull and push all tags

All upstream tags are already local after step 2 (verify: `git tag | wc -l`
vs `git ls-remote --tags upstream | grep -v '\^{}' | wc -l` — counts must
match; ~177 as of 2026-10-31, and `grep -v '\^{}'` excludes the peeled
`^{}` duplicate lines).

Push only the tags that are missing on origin — `--tags` does exactly that,
printing a line per tag actually added:

```sh
git push origin --tags
```

If a tag push is rejected because a same-named tag already exists on origin
pointing elsewhere, **stop and report** — do not force-update tags.

## 5. Verify (mandatory)

```sh
# tag lists identical between upstream and origin?
git ls-remote --tags upstream | grep -v '\^{}' | awk -F'refs/tags/' '{print $2}' | sort > /tmp/opencode/upstream_tags.txt
git ls-remote --tags origin   | grep -v '\^{}' | awk -F'refs/tags/' '{print $2}' | sort > /tmp/opencode/origin_tags.txt
diff /tmp/opencode/upstream_tags.txt /tmp/opencode/origin_tags.txt && echo "tags OK"

# branch SHAs identical?
git ls-remote --heads upstream | awk '{print $2}' | sort > /tmp/opencode/upstream_heads.txt
git ls-remote --heads origin   | awk '{print $2}' | sort > /tmp/opencode/origin_heads.txt
diff /tmp/opencode/upstream_heads.txt /tmp/opencode/origin_heads.txt
```

The branch diff must show **only** fork-only branches (lines only on the
origin side, e.g. `refs/heads/v0.12.4_modified`). Anything only on the
upstream side means a branch was missed; anything diverged was skipped in
step 3.

## 6. Report

One line each: branches fast-forwarded / created / skipped (with reason),
number of tags added, and the final tag totals. Confirm the working tree and
current branch were untouched.
