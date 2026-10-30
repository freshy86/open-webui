# AGENTS.md

Guidance for AI coding agents working in the Open WebUI repository.

Open WebUI is a self-hosted AI chat interface. It is a monorepo with two apps:

- **Frontend**: SvelteKit (Svelte 5) + Vite + Tailwind CSS 4, in `src/`
- **Backend**: Python / FastAPI, in `backend/open_webui/`

## Critical rules

- **All PRs target the `dev` branch**, never `main`. `main` is a snapshot of `dev` taken on release day. A PR opened against `main` will be closed.
- **Do not open a code pull request unless a maintainer explicitly asked for one**, or the change is strictly limited to i18n/localization. Report bugs in Issues and propose features in Discussions first. This policy is in the PR template and contribution guide; it applies to agent-generated changes just as it does to human ones.
- **Match nearby code patterns.** Avoid unnecessary new settings, abstractions, or dependencies. The codebase favors direct, repetitive, readable code over clever generalization.
- **Do not add or rewrite automated tests, fixtures, snapshots, or test infrastructure** unless a maintainer explicitly requests it. Do not remove, disable, or weaken existing tests to make a change pass.
- **One PR = one logical unit.** No unrelated commits or drive-by fixes.
- **Review AI-generated code before submitting it** (PR checklist requirement). Do not commit code you cannot explain.
- Do not edit generated or vendored files: `static/` build output, `src/lib/i18n/locales/*` except the English source locale, Pyodide assets fetched by `npm run pyodide:fetch`, and `package-lock.json` (edit `package.json` instead; lockfile changes go through `npm install`).

## Environment requirements

| Tool    | Version                                                                                  |
| ------- | ---------------------------------------------------------------------------------------- |
| Python  | 3.11 or 3.12 only (**3.13 is not supported**; `requires-python = ">= 3.11, < 3.13.0a1"`) |
| Node.js | 22.x (engines allow 18.13–22)                                                            |
| npm     | >= 6                                                                                     |

Dependency pins in `pyproject.toml` are deliberate — comments there flag versions that must not be bumped (e.g. `aiohttp`, `aiodns`, `preshed`, `pyarrow`). Do not "helpfully" update them.

## Getting started (development)

Two processes are needed, one terminal each.

### Frontend (first terminal, repo root)

```sh
cp -RPp .env.example .env
npm install          # add --force if dependency warnings break the install
npm run build        # catches build errors early; uses a 12 GB Node heap
npm run dev          # dev server at http://localhost:5173
```

The Vite dev server proxies `/api`, `/ollama`, `/openai`, `/oauth`, and `/ws` to the backend (default `http://localhost:8080`, override with `WEBUI_BACKEND_URL`). The frontend shows a waiting screen until the backend is up.

### Backend (second terminal)

```sh
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt -U
sh dev.sh            # uvicorn with --reload at http://localhost:8080
```

- API docs: `http://localhost:8080/docs`
- **`WEBUI_SECRET_KEY` is a hard requirement** (auth is on by default and this fork exits instead of auto-generating a key). It is already set in the repo-root `.env`; if starting from a clean checkout, generate one:
  ```sh
  printf 'WEBUI_SECRET_KEY=%s\n' "$(python -c 'import secrets; print(secrets.token_urlsafe(48))')" >> .env
  ```
- The backend loads env vars from the **repo-root `.env`**, not `backend/.env` (`BASE_DIR` in `open_webui/env.py` is the repo root). Vite uses the same file.
- `dev.sh` sets `CORS_ALLOW_ORIGIN` for `localhost:5173`; add other origins there when testing from another device.
- Never share a data directory or database between dev and production: dev builds can contain non-backward-compatible migrations. Local data lives in `backend/data/` (SQLite `webui.db`, uploads, vector DB) — do not commit it.

### Troubleshooting quick hits

- `FATAL ERROR: Reached Heap Limit` → `export NODE_OPTIONS="--max-old-space-size=4096"` and retry; ensure ~4 GB RAM.
- Port conflicts on 5173/8080 → change the port in `vite.config.ts` or via `PORT` in `dev.sh`.
- Backend never binds 8080 but no traceback appears → the uvicorn worker crashed at startup while the `--reload` parent keeps waiting. Run `venv/bin/python -c "import open_webui.main"` in `backend/` to see the real error (most often the missing `WEBUI_SECRET_KEY` above). A quick `curl localhost:8080/api/version` tells you whether the backend is actually up.
- Static assets/icons failing to load → CORS; align `CORS_ALLOW_ORIGIN` in `backend/dev.sh` with the frontend origin.

## Common commands

### Frontend (repo root)

| Command                             | What it does                                                         |
| ----------------------------------- | -------------------------------------------------------------------- |
| `npm run build`                     | Production build (Vite, 12 GB heap)                                  |
| `npm run check`                     | `svelte-check` type checking — run this after TS/Svelte changes      |
| `npm run lint:frontend`             | ESLint with `--fix`                                                  |
| `npm run format`                    | Prettier over js/ts/svelte/css/html/json (markdown is excluded)      |
| `npm run test:frontend`             | Vitest unit tests                                                    |
| `npm run i18n:parse` / `i18n:check` | Extract/validate i18n keys (CI runs these and requires a clean tree) |
| `npm run dev` / `dev:5050`          | Dev server on 5173 / 5050                                            |

### Backend (`backend/`, venv active)

| Command                                            | What it does                                                                    |
| -------------------------------------------------- | ------------------------------------------------------------------------------- |
| `ruff format .`                                    | Formatter — **CI enforces `ruff format --check`**, so run it before finishing   |
| `ruff check .`                                     | Linter (CI runs `ruff check --select=F --ignore=F401,F403,F405,F541,F811,F841`) |
| `uvicorn open_webui.main:app --reload --port 8080` | What `sh dev.sh` runs                                                           |

Python style: line length **120**, **single quotes**, isort-compatible imports (`ruff lint` rules `E,F,W,I,UP,C90,Q,ICN`), `datetime` imported as `dt`, no `from ast` / `from datetime` imports. Formatting is handled by Ruff (the `black` config in `pyproject.toml` is legacy; `black` ships only as a runtime dependency for code execution).

## Architecture

### Backend — `backend/open_webui/`

- `main.py` — FastAPI app entry; mounts routers and middleware.
- `config.py` / `env.py` — environment-variable parsing and persistent runtime config. New env vars go here and should be documented in `.env.example`.
- `routers/` — FastAPI route modules (one file per domain: `chats.py`, `models.py`, `knowledge.py`, `ollama.py`, `openai.py`, ...). Routers are thin; logic lives below.
- `models/` — data layer. Each file owns its SQLAlchemy models plus CRUD functions; Pydantic schemas for API responses live alongside.
- `utils/` — shared logic: `auth.py`, `middleware.py` (chat processing pipeline), `access_control/`, `files.py`, `mcp/`, etc.
- `migrations/` — Alembic migrations. Schema changes require a new migration; dev migrations are not guaranteed backward-compatible.
- `retrieval/` — RAG: loaders, vector DB connectors (`vector/`), reranking.
- `socket/`, `storage/` — Socket.IO handling and file storage providers (local, S3, GCS, Azure).
- `internal/` — internal request/response wrappers.
- `tasks.py` — background task wrappers (e.g. embeddings, titles, tags).

Pattern to follow: new feature → router endpoint(s) in `routers/`, data functions in `models/`, Pydantic schemas next to the models, config/env plumbing through `config.py`/`env.py`.

### Frontend — `src/`

- `routes/` — SvelteKit routes; `(app)` is the authenticated shell, `auth` the pre-login pages.
- `lib/apis/` — API client layer, mirroring the backend routers one directory per domain (`lib/apis/chats`, `lib/apis/knowledge`, ...). New backend endpoints get a matching client function here.
- `lib/components/` — Svelte components grouped by feature (`chat/`, `admin/`, `workspace/`, `common/`, ...).
- `lib/stores/` — Svelte stores for shared state.
- `lib/i18n/` — locales (`en-US` is the source; ~65 locales are translated). When adding user-facing strings: use i18next keys in components, run `npm run i18n:parse` to extract them, and only edit the English locale file by hand. CI runs `i18n:parse` and fails if the tree is dirty.
- `lib/utils/`, `lib/constants.ts` — helpers and constants.
- Svelte 5 is used — prefer its runes/runes-era patterns as found in neighboring components over porting Svelte 4 idioms.

### Other

- `Dockerfile`, `docker-compose*.yaml` — packaging; `docker-compose.api.yaml` (API-only), `.gpu.yaml`, `.amdgpu.yaml`, `.otel.yaml`, `.playwright.yaml` variants.
- `.github/workflows/` — CI: `frontend.yaml` (format + i18n + build + Vitest), `backend.yaml` (Ruff format/check on Python 3.11 and 3.12), `regression.yaml` (release suite), `docker.yaml` (image builds).
- `scripts/` — build helpers: `build-info.js` (version/channel injection), `prepare-pyodide.js` (fetches Pyodide for code interpreter), `encryption/` (verified by `npm run crypto:verify` predev/prebuild hooks), `i18n/check.mjs`.

## Extensibility — prefer plugins over core edits

Before touching core code for a user request, check whether the existing addon mechanisms can do it. DB-stored plugins survive upgrades; forks of core code drift with every upstream release.

### Runtime plugin mechanisms (no code changes needed)

| Mechanism                                  | Where managed                       | Hook class                             | Use for                                                                                           |
| ------------------------------------------ | ----------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------- |
| **Functions**                              | Admin Panel → Functions (DB-stored) | `Pipe` / `Filter` / `Action` / `Event` | Custom model providers, inlet/outlet/stream message middleware, message buttons, lifecycle events |
| **Tools**                                  | Workspace → Tools (DB-stored)       | `Tools` class, methods → tool specs    | Abilities the LLM can call (live data, external APIs)                                             |
| **Tool servers / MCP**                     | Admin → Settings → Tool Servers     | —                                      | Out-of-process tools via OpenAPI spec or MCP (HTTP-only, no stdio)                                |
| **Functions/Tools/Skills version history** | per-plugin                          | —                                      | This fork snapshots every save (`*_history` tables); diff/rollback after upgrades                 |

Key files: `backend/open_webui/utils/plugin.py` (loader, frontmatter, hot-reload), `backend/open_webui/functions.py` (hook dispatch), `backend/open_webui/models/functions.py` / `models/tools.py` (DB + CRUD), `backend/open_webui/routers/functions.py` / `routers/tools.py` (admin API), `backend/open_webui/utils/mcp/` (MCP client). Docs: https://docs.openwebui.com/features/extensibility/plugin/

### Constraints & limitations

- **No sandbox**: Functions/Tools `exec()` in-process with full privileges, no import blacklist. Mutations are admin-only (`get_admin_user`); kill-switches `ENABLE_FUNCTIONS` / `ENABLE_TOOLS` / `ENABLE_TOOL_SERVERS` (`.env.example`).
- **pip install disabled by default**: frontmatter `requirements:` installs only with `ENABLE_PIP_INSTALL_FRONTMATTER_REQUIREMENTS=true` (never in `OFFLINE_MODE`); runs on the host, not a container.
- **Hot reload** is content-hash based per worker process — admin UI edits apply immediately, but uvicorn workers each reload independently. A failing function is auto-deactivated (`is_active = false`).
- **No versioned plugin API**: hook signatures change between releases (`stream` added in 0.5.17). Plugins should stick to documented contracts (hook args, `__event_emitter__` / `__event_call__`, valves/UserValves) and avoid internal `open_webui.utils.*` imports beyond `utils/plugin.py`'s legacy-path rewrite (`from utils…` → `from open_webui.utils…`).
- **Frontend is closed to plugins**: only static injection points are `static/custom.css` and `static/loader.js` (deployment-time mounts); themes are fixed (`dark` / `light` / `oled-dark`). UI beyond Action buttons and event-emitted status can't come from a plugin.
- **Legacy "pipelines" framework is deprecated** in favor of in-process Functions; it now rides on OpenAI-compatible connections serving `/pipelines`.
- This fork additionally has **Skills**, **Apps** (external bot/webhook integrations), and **Automations** — not in stock upstream; don't assume they exist when comparing against upstream issues.

### Choosing an extension point

1. Deep lifecycle hooks / platform behavior → **Function** (Filter/Pipe/Action).
2. New model abilities → **Tool**.
3. Anything isolatable, or where version coupling matters → **external tool server (MCP/OpenAPI)**.
4. Deployment customization (branding, headers) → env vars (`env.py`, document in `.env.example`) or `static/` mounts.

## Docker image — build & publish (this fork)

The fork publishes a private arm64 image to `ghcr.io/freshy86/open-webui`, tagged with the **currently checked-out branch name** (whatever `git branch --show-current` returns). CI does this automatically for `main`/`dev`/`v*` tags; for other branches, build and push locally.

### Prerequisites

- Docker + buildx installed (`docker.io`, `docker-buildx` packages on Ubuntu); this machine is **arm64**.
- **RAM matters**: the Vite frontend build needs ~12 GB Node heap (`NODE_OPTIONS=--max-old-space-size=12288` is set in the Dockerfile) and runs in parallel with the backend dependency stage. **15 GB RAM minimum**; on the original 7.7 GB box the kernel OOM-killed node twice. No swap needed at 15 GB, but an 8 GB swapfile helps below that.
- **Disk**: 60+ GB free. Build cache alone is ~11 GB; final image ~6 GB.
- **DNS fix (already applied)**: `/etc/docker/daemon.json` sets `"dns": ["8.8.8.8", "1.1.1.1"]` because the host's systemd-resolved stub (`127.0.0.53`) is unreachable from build containers — without it, `apt-get update` inside the build fails with `Temporary failure resolving`.
- **Auth**: push credentials live in a GPG-encrypted `pass` store (`docker-credential-pass` + `credsStore: pass` in `/root/.docker/config.json`). No plaintext token anywhere. If auth ever fails, re-login (token typed in the user's own terminal, never in chat):
  ```sh
  read -rs TOKEN && echo "$TOKEN" | sudo docker login ghcr.io -u freshy86 --password-stdin
  ```
  A first-ever push of a new tag may fail once with a transient `denied` — just retry the push.

### Build

```sh
sudo docker buildx build --platform linux/arm64 --load \
  --build-arg BUILD_HASH=$(git rev-parse --short HEAD) \
  --build-arg BUILD_BRANCH=$(git branch --show-current) \
  --build-arg BUILD_CHANNEL=unknown \
  -t ghcr.io/freshy86/open-webui:$(git branch --show-current) \
  /home/ubuntu/open-webui
```

Notes:

- `--load` is required or the finished image never lands in the local store (buildx completes "successfully" without it).
- Variants via build args: `USE_SLIM=true`, `USE_CUDA=true`, `USE_OLLAMA=true` (see Dockerfile header).
- The image bundles the built frontend; the container serves everything on port 8080 (`bash start.sh`).

### Push

```sh
sudo docker push ghcr.io/freshy86/open-webui:$(git branch --show-current)
```

The package is **private** — target machines must `docker login ghcr.io -u freshy86` (a `read:packages` token suffices) before pulling.

### Run (any machine, after login)

```sh
docker run -d -p 3000:8080 \
  -v open-webui:/app/backend/data \
  --name open-webui --restart always \
  ghcr.io/freshy86/open-webui:<branch-name>
```

## Before you finish

1. `npm run format` (frontend) — CI requires a clean tree after format + i18n.
2. `npm run check` if you touched TS/Svelte.
3. `ruff format . && ruff check .` if you touched Python.
4. `npm run build` if you changed anything that affects bundling or static assets.
5. Manually test the changed workflow and nearby behavior it could affect; describe the verification steps in the PR.
6. PR title must use a prefix: `feat`, `fix`, `chore`, `docs`, `refactor`, `perf`, `build`, `ci`, `i18n`, or `BREAKING CHANGE`.
7. Update `.env.example` and the docs repo (open-webui/docs) when adding/changing env configuration.
8. Add screenshots for UI changes (and a recording when motion/interaction matters).
