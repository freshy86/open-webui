---
name: Build & Push Docker Image
description: Rebuild the private arm64 Open WebUI image and push it to ghcr.io/freshy86/open-webui, tagged with the current branch. Use when the user asks to (re)build the Docker image, publish it to ghcr, ship a new image for the current branch, or asks to check/free Docker disk space (what can be pruned).
---

Build and publish the private arm64 image to `ghcr.io/freshy86/open-webui`,
tagged with the **currently checked-out branch name** (whatever
`git branch --show-current` returns). CI does this automatically for
`main`/`dev`/`v*` tags; for other branches this skill is the way.

## 1. Pre-flight (check, don't assume)

```sh
git branch --show-current                                   # the image tag
free -h | head -2                                           # need ~15 GB RAM
docker buildx version                                       # docker + buildx plugin
grep -A2 credsStore /root/.docker/config.json 2>/dev/null   # expect credsStore: pass
```

### Disk space check (always run before building)

```sh
df -h / | tail -1                                  # need ~15 GB free (cache cap + image)
sudo docker system df                              # quick breakdown
sudo docker builder du 2>/dev/null | tail -2       # cache total + reclaimable
```

- **< 15 GB free → prune before building.** The build cache is already
  auto-capped at **12 GB** by the LRU GC policy in `/etc/docker/daemon.json`
  (`builder.gc.policy`), so the cache cannot be the thing that ate the disk —
  look at dangling images/containers instead.
- Safe to prune, in order of value:
  ```sh
  sudo docker builder prune -f --filter until=48h   # only cache unused for 48h; warm set survives
  sudo docker container prune -f                    # stopped containers
  sudo docker image prune -f                        # dangling images
  ```
  **Never** run `docker volume prune` or `docker system prune --volumes` —
  that can delete app data (`backend/data` volumes). Ask the user first if
  anything beyond the three commands above is needed.
- **Phantom "Images … 100% reclaimable" row**: `docker system df` may claim
  GBs of reclaimable images while `docker images -a` is empty. That is
  containerd image-store accounting for the last ghcr push's content blobs,
  already inside the build cache total — not extra disk. Verify with
  `sudo du -sh /var/lib/containerd`: if it is roughly the cache size
  (≤ ~13 GB), there is nothing left to free. Cache lives there, not in
  `/var/lib/docker`.
- Host DNS is already fixed in `/etc/docker/daemon.json`
  (`"dns": ["8.8.8.8", "1.1.1.1"]`) because systemd-resolved's stub
  (127.0.0.53) is unreachable from build containers. If `apt-get update`
  inside the build fails with `Temporary failure resolving`, re-check that file.
- This machine is **arm64**; no QEMU emulation is involved for the native build.

## 2. Build

From the repo root. This takes tens of minutes (Vite frontend build runs with a
12 GB Node heap alongside the backend dependency stage), so run it **in the
background** with the log redirected:

```sh
sudo docker buildx build --platform linux/arm64 --load \
  --build-arg BUILD_HASH=$(git rev-parse --short HEAD) \
  --build-arg BUILD_BRANCH=$(git branch --show-current) \
  --build-arg BUILD_CHANNEL=unknown \
  -t ghcr.io/freshy86/open-webui:$(git branch --show-current) \
  /home/ubuntu/open-webui > /tmp/opencode/docker-build.log 2>&1
```

- **`--load` is required** or the finished image never lands in the local store
  (buildx completes "successfully" without it and the later push fails with
  "manifest unknown").
- Optional build args for variants: `USE_SLIM=true`, `USE_CUDA=true`,
  `USE_OLLAMA=true` (see the Dockerfile header).
- When the background job finishes, confirm success from the **log tail**, then
  verify the image actually exists locally:

```sh
tail -5 /tmp/opencode/docker-build.log
sudo docker images ghcr.io/freshy86/open-webui
```

- Heap OOM inside the frontend stage → the box lost RAM headroom; close other
  heavy processes (dev servers count) and rebuild. An 8 GB swapfile helps on
  smaller machines.

## 3. Push

```sh
sudo docker push ghcr.io/freshy86/open-webui:$(git branch --show-current)
```

- **A first-ever push of a new tag may fail once with a transient `denied` —
  just retry the same push.** Retry once before investigating anything else.
- If auth fails persistently, credentials live in a GPG-encrypted `pass` store
  (`docker-credential-pass` + `credsStore: pass` in `/root/.docker/config.json`).
  No plaintext token anywhere. Have the **user** re-login in their own terminal
  (token typed by them, never in chat):

  ```sh
  read -rs TOKEN && echo "$TOKEN" | sudo docker login ghcr.io -u freshy86 --password-stdin
  ```

- The package is **private** — target machines must
  `docker login ghcr.io -u freshy86` (a `read:packages` token suffices) before
  pulling.

## 4. Report

A small table: step (build / push), status (✅/❌), image tag, and the actual
error plus fix for anything red. Verify by log content and
`sudo docker images`, not by the absence of an error message.

## 5. Run (any machine, after login) — reference

```sh
docker run -d -p 3000:8080 \
  -v open-webui:/app/backend/data \
  --name open-webui --restart always \
  ghcr.io/freshy86/open-webui:<branch-name>
```
