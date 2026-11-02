---
name: Update Open WebUI Container
description: Safely update the local Open WebUI deployment to the latest ghcr.io/freshy86/open-webui fork build. Use when the user asks to update the container, pull the newest fork image, upgrade Open WebUI, or when they ask for a data backup before an update.
---

Update the local Open WebUI container to the newest published fork build from
`ghcr.io/freshy86/open-webui`, following the upstream procedure
(https://docs.openwebui.com/getting-started/updating/). The non-negotiable
order is: **pull → backup → validate backup → and only then stop/replace the
container**. Never touch the running container before the backup has been
validated. Cleanup of the old image and backup tar is a separate final step
and only runs after the user explicitly approves it (step 7).

## 0. Fixed facts (check, don't assume)

- Image: `ghcr.io/freshy86/open-webui` (the **private fork build**). There is
  **no `latest` tag** — CI tags images by branch name. Find the newest fork
  build with `git ls-remote --heads origin | grep -i modified` (highest
  version, e.g. `v0.12.5_modified` → image tag `v0.12.5_modified`), and
  confirm the tag exists with `docker manifest inspect …:vX.Y.Z_modified`.
  The running container usually shows which tag is one release behind.
- Data volume: `open-webui` → `/app/backend/data` (DB, uploads, vector DB).
- Container name: `open-webui`.
- Target machine runs Docker 29+. `gh` CLI is **not installed** — never plan
  around it.
- `WEBUI_SECRET_KEY` is a **hard requirement** on this fork (missing key =
  container exits at startup). On this machine it is an **already exported
  environment variable** — there is no repo-root `.env`. Verify it is set
  before removing anything; it must be passed to the new container explicitly,
  or every session is logged out.

## 1. Preflight (read-only)

```sh
df -h / | tail -1                                        # need ~2 GB free for the new image (~5.8 GB unpacked)
docker version --format '{{.Server.Version}}'          # Docker 29+
docker ps -a --filter name=open-webui \
  --format '{{.Names}} {{.Image}} {{.Status}}'          # current container
docker volume ls --filter name=open-webui               # volume must exist
docker manifest inspect ghcr.io/freshy86/open-webui:vX.Y.Z_modified >/dev/null \
  && echo "new image reachable"                         # also proves ghcr auth works
                                                       # (no :latest tag exists on the fork)
```

- Record the **old image tag / digest** (`docker inspect open-webui
  --format '{{.Image}}'`) — needed if a rollback ever becomes necessary.
- Record the container's run config so the replacement matches
  (`docker inspect open-webui --format '{{json .HostConfig.PortBindings}}
  {{json .HostConfig.ExtraHosts}} {{.HostConfig.RestartPolicy.Name}}'`).
  Reference setup: port `3000:8080`,
  `--add-host=host.docker.internal:host-gateway`, `--restart always`.
- The image is private. If `docker manifest inspect` fails with
  `unauthorized`, the user must `docker login ghcr.io -u freshy86`
  (a `read:packages` token suffices) in their own terminal — never ask for the
  token in chat.
- **Don't diagnose auth from `~/.docker/config.json`**: on this macOS box it
  shows no `credsStore` and an empty `ghcr.io` entry, yet pulls work — Docker
  Desktop keeps credentials in the system keychain. `docker manifest inspect`
  is the only auth test that matters.
- Check the release notes for breaking changes / DB migrations before
  upgrading: https://github.com/open-webui/open-webui/releases

## 2. Pull the new image (before touching anything)

Pull first: pulling is harmless, and a local new image means downtime during
the swap is seconds only.

```sh
docker pull ghcr.io/freshy86/open-webui:vX.Y.Z_modified
docker images ghcr.io/freshy86/open-webui    # note the new image ID
```

## 3. Backup (upstream method, works while the container is running)

Data volume contents: `webui.db` (SQLite, chats/users/settings),
`uploads/`, `vector_db/`, `cache/`. Timestamped filename so repeated runs
never overwrite each other:

```sh
mkdir -p backups
docker run --rm -v open-webui:/data -v "$PWD/backups:/backup" alpine \
  tar czf /backup/open-webui-$(date +%Y%m%d-%H%M%S).tar.gz -C / data
```

- **Size expectation** (this instance): ~1.2 GB volume → ~1.0 GB tarball, of
  which **`cache/` is ~1.1 GB** (embedding/whisper models). The DB itself is
  only ~5 MB — a small `webui.db` in a large tarball is normal, not a red flag.
- The backup is taken while the container runs in SQLite **WAL mode**: the
  tarball contains `webui.db` **plus `webui.db-wal` / `webui.db-shm`**, and
  the `-wal` holds the most recent writes. Only the complete `data/` tree is
  a consistent snapshot — a lone `webui.db` copied out would lose recent
  activity. (Upstream's restore re-extracts the whole tarball, which is why
  this works.)

## 4. Validate the backup — do not skip

A backup that exists is not a backup that works. Check content, integrity,
and usability of the SQLite file inside:

```sh
f=$(ls -t backups/open-webui-*.tar.gz | head -1)
ls -lh "$f"                                             # non-trivial size
tar tzf "$f" | grep -c webui.db                         # entry exists
docker run --rm -i -v "$PWD/backups:/backup" alpine sh -c "
  tar xzf /backup/$(basename $f) -C /tmp &&
  du -sh /tmp/data &&
  test -s /tmp/data/webui.db"
```

Then integrity-check the DB copy in a throwaway container (SQLite CLI ships
inside the open-webui image itself):

```sh
docker run --rm -v "$PWD/backups:/backup" \
  ghcr.io/freshy86/open-webui:vX.Y.Z_modified python3 -c "
import sqlite3, glob
p = glob.glob('/backup/tmp/data/webui.db')[0]
c = sqlite3.connect(p)
print('integrity:', c.execute('PRAGMA integrity_check').fetchone()[0])
print('chats:', c.execute('select count(*) from chat').fetchone()[0])
print('users:', c.execute('select count(*) from user').fetchone()[0])"
```

Gate: proceed **only if** (a) the tarball is non-empty and lists `data/webui.db`,
(b) `integrity_check` returns `ok`, (c) chat/user counts are non-zero and
**match the live system** (`docker exec open-webui python3 -c "…"` with the
same queries). Do not judge the absolute numbers — a lightly-used instance can
legitimately show 1 chat / 0 messages; only a mismatch with the live DB is a
red flag. Any failure → fix the backup first; **do not proceed to the update**.

## 5. Swap the container (only after step 4 passed)

Read the secret from the **already exported `WEBUI_SECRET_KEY` environment
variable** (this machine has no repo-root `.env`). Verify it is set without
ever printing it — **before** `rm -f` — and run the whole sequence as one
unit. If anything between `rm -f` and `docker run` fails, immediately
re-create the container from the **old image** (rollback first, debug after)
instead of leaving the instance down:

```sh
[ -n "$WEBUI_SECRET_KEY" ] && echo "key present" || { echo "NOT SET - stop"; exit 1; }

docker rm -f open-webui
docker run -d -p 3000:8080 \
  --add-host=host.docker.internal:host-gateway \
  -v open-webui:/app/backend/data \
  -e WEBUI_SECRET_KEY="$WEBUI_SECRET_KEY" \
  --name open-webui --restart always \
  ghcr.io/freshy86/open-webui:vX.Y.Z_modified
```

- If the old container had other custom flags (GPU passthrough, extra env),
  reproduce them here — compare with the preflight output from step 1.
- Rolling back: pin the old tag (e.g. `v0.12.4_modified`) instead of `latest`.
  Note migrations are **one-way** — after a schema migration ran, restore the
  pre-update backup instead of pinning the old image.

## 6. Verify the update

```sh
docker ps --filter name=open-webui --format '{{.Status}}'   # healthy
docker logs open-webui 2>&1 | grep -iE "open webui|building" | head -2   # "vX.Y.Z - building …" banner
curl -s -o /dev/null -w '%{http_code}\n' localhost:3000     # 200/301/302
docker logs open-webui 2>&1 | grep -E "Traceback|ERROR|FATAL" | head -5
```

Gotchas from real runs:

- **`Up (health: starting)` for ~30–60 s is normal** — wait for `healthy`
  before judging; don't conclude failure from a fresh container.
- Do **not** `grep -iE "error|migration"`: case-insensitive "migration"
  matches harmless `INFO [alembic.runtime.migration]` lines on every clean
  startup. Match `Traceback`/`ERROR`/`FATAL` case-sensitively instead.

Then let the user log in and confirm the UI works; tell them to hard-refresh
(Cmd+Shift+R / Ctrl+F5) so stale frontend assets don't fake a broken UI.

## 7. Cleanup — old image + backup tar (only after explicit user approval)

Do **not** run this step automatically. It is destructive and gated twice:

1. **The user must have confirmed the update is good** (UI works after login,
   step 6 passed) — cleanup never runs while the update is still unverified.
2. **Ask the user before proceeding** (e.g. with the question tool), listing
   exactly what will be deleted and roughly how much space it frees. Any
   answer other than an explicit yes → skip the step entirely; do not
   re-ask within the same session.

What gets deleted (and nothing else):

- The **old image** recorded in step 1:
  `docker rmi ghcr.io/freshy86/open-webui:<old-tag>` — removes the previous
  release's image (frees ~5.8 GB unpacked). The new image, the `open-webui`
  volume, and any *other* tags are untouched.
- The **backup tar** created in this run:
  `rm backups/open-webui-<timestamp-of-this-run>.tar.gz` (frees ~1 GB).
  Only the tarball from **this** update is removed — older backups in
  `backups/` stay untouched unless the user explicitly asks otherwise.

Verify afterwards:

```sh
docker images ghcr.io/freshy86/open-webui   # only the new tag remains
ls -lh backups/                              # this run's tar gone, older ones intact
```

If the user declines (or doesn't answer), just report that the old image and
backup are kept and stop.

## Hard rules

- **Never `rm -f` the container before a validated backup exists** — the
  volume survives, but a botched migration with no backup is unrecoverable.
- **Never `docker volume prune` / `docker system prune --volumes`** in this
  flow: that deletes app data.
- The volume must be re-attached by name (`-v open-webui:…`) — never bind-mount
  a fresh directory; that silently loses all data.
- `WEBUI_SECRET_KEY` must be present as an **exported env var** on this
  machine (`[ -n "$WEBUI_SECRET_KEY" ]`); if unset, stop and ask the user —
  do not generate a new one (it would log out every user).
- Keep old backups in `backups/` until the user confirms the update is good.
  Deletion happens **only** in step 7, and only after the user explicitly
  approves it.
- **Keep the previous image tag locally** (e.g. `v0.12.4_modified`) until the
  user confirms the update — it is the rollback path. Removing it is part of
  step 7 only. Do **not** run the `docker-build-push` skill's cleanup (it
  removes local images) in this flow.
- **If the swap fails midway** (anything after `docker rm -f` errors), the
  first action is `docker run -d … ghcr.io/freshy86/open-webui:<old-tag>`
  with the same flags — get the service back up before debugging anything.
