---
name: Restart Dev Servers
description: Stop the Open WebUI frontend and backend, rebuild the frontend, and start both again with verification. Use when dev servers are stale, broken, or the user asks to rebuild/restart them.
---

Restart the Open WebUI dev stack: stop what is running, rebuild the frontend,
start both processes, and verify. The frontend is the Vite dev server (port
5173, repo root); the backend is uvicorn (port 8080, `backend/`).

## 1. Stop (skip what is not running)

Find the real PIDs first, then kill by PID. **Never `pkill -f` with a plain
pattern from a compound command** — the pattern matches the calling shell's own
command line and kills it mid-script (this has actually happened in this repo).

```sh
ss -tln | grep -E ':(5173|8080)'        # see what is listening
pgrep -f 'uvicorn open_webu[i]'          # bracket trick avoids self-match
pgrep -f 'vit[e]'                        # vite dev server
```

Kill the listed PIDs (backend first, then frontend); include the `sh dev.sh`
and `npm run dev` wrapper shells. Confirm both ports are free before continuing.

## 2. Rebuild the frontend

From the repo root:

```sh
npm run build
```

This needs ~12 GB of Node heap (already configured in the build script) and
several minutes on this machine. If it fails with heap errors, re-run with
`NODE_OPTIONS=--max-old-space-size=4096`. The backend has no build step — its
"rebuild" is just reinstalling deps when `requirements.txt`/`pyproject.toml`
changed (`pip install -r requirements.txt -U` inside the venv); otherwise skip.

## 3. Start both in the background

Run each in its own long-lived shell with logs redirected to `/tmp/opencode/`:

- Backend: from `backend/` with `source venv/bin/activate && sh dev.sh` →
  `/tmp/opencode/backend.log`
- Frontend: from repo root, `npm run dev` → `/tmp/opencode/frontend.log`

Prerequisites the startup depends on (check, don't assume):

- `.env` in the **repo root** must contain `WEBUI_SECRET_KEY` — the backend
  exits instantly without it (see AGENTS.md troubleshooting). If missing:
  `printf 'WEBUI_SECRET_KEY=%s\n' "$(python3 -c 'import secrets; print(secrets.token_urlsafe(48))')" >> .env`
- `backend/venv` and `node_modules` must exist; create them per AGENTS.md if not.

## 4. Verify (wait before concluding failure)

The backend needs 30–90 s to boot (heavy imports). Wait, then check:

```sh
curl -s -m 10 http://localhost:8080/api/version    # expect {"version": ...}
curl -s -m 10 http://localhost:5173/ -o /dev/null -w '%{http_code}'  # expect 200
grep -c "Started server process" /tmp/opencode/backend.log
```

- Frontend down → read `/tmp/opencode/frontend.log` (port conflict → change
  port in `vite.config.ts`).
- Backend "never binds" but the reloader lives → the worker crashed at import;
  run `venv/bin/python -c "import open_webui.main"` in `backend/` to surface the
  real error (usually the missing `WEBUI_SECRET_KEY`). The reloader parent
  surviving a dead worker is the classic trap — trust curl, not process lists.

## 5. Report

A small table: process, port/URL, status (✅/❌), plus the actual error and fix
for anything red. Do not declare success from startup logs alone — verify with
curl.