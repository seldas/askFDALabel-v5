# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Prerequisite: `.env` must exist

`backend/dashboard/config.py` raises `ValueError` at **import time** if `DATABASE_URL` (or the `PG_*` parts) is unset. Nothing in the backend imports without a repo-root `.env` — not the app, not Celery, not the `backend/database/scripts/*` utilities. Copy `.env.template.txt` to `.env` first.

All backend entry points load the `.env` from the **repo root** (`Path(__file__).parents[N] / '.env'`), never from CWD.

## Commands

### Docker stack (preferred)

`start_server.py` generates `docker-compose.yml` on the fly from `.env` and then shells out to `docker compose`. The generated file is gitignored — edit the generator, not the YAML.

```bash
python start_server.py --mode dev    # HMR, ports 8841 (web) + 8842 (api)
python start_server.py --mode prod   # nginx on :80
python start_server.py --mode dev --down
python start_server.py --mode dev --dry-run   # write docker-compose.yml only
```

Other flags: `--efficient` (lower pool/worker limits), `--local-db true|false` (overrides `LOCAL-PG`), `--build`, `--rapid` (implies prod, no nginx, remote DB).

### Local development

```bash
cd frontend && npm run dev:all    # concurrently runs Next.js + Flask
```

`npm run dev:all` is the normal entry point. It uses `frontend/scripts/start-{frontend,backend}.js`, which auto-detect `venv/` at the repo root and — critically — spawn Python with **`cwd` set to `backend/`**.

```bash
npm run dev          # Next.js only, :8841
npm run dev:backend  # Flask only, :8842
npm run build
```

Backend health check: `http://localhost:8842/health`.

### Celery (required for admin/import tasks)

Run from **`backend/`**, not the repo root:

```bash
cd backend && celery -A celery_app.celery worker --loglevel=info --pool=solo   # Windows
```

Drop `--pool=solo` on Mac/Linux. The README documents `celery -A backend.celery_app.celery` from the root; that module path does not work, because `backend/celery_app.py` does `from app import create_unified_app` and there is no `backend/__init__.py`.

### Database initialization

Numbered, idempotent, run from the repo root with the venv active:

```bash
python backend/database/scripts/db_02_init_labeling_schema.py   # labeling tables + FTS GIN index
python backend/database/scripts/db_03_init_public_schema.py
python backend/database/scripts/db_04_import_orange_book.py     # RLD/RS identification
python backend/database/scripts/db_05_import_epc_indexing.py    # Deep Dive pharmacologic class
python backend/database/scripts/db_06_create_admin.py
python backend/database/scripts/db_07_import_labels.py --force --skip-unpack
```

`db_01_enable_pgvector.py` is legacy — search is FTS-based now, not vector-based. `db_08_import_archive_labels.py` handles archived SPL sets.

### Testing and linting — there is none

No pytest, no jest/vitest, no test config anywhere in `backend/` or `frontend/`. The only `test_*.py` files live under `archive/scripts/` and are dead. **There is no way to run a test suite in this repo.** Verify changes by exercising the running app.

`npm run lint` maps to `next lint`, which Next 16 removed, and ESLint is not in `devDependencies` — the script fails. Don't cite it as a check.

## Architecture

### One Flask app, assembled from a factory plus blueprints

`backend/app.py::create_unified_app()` calls `dashboard.create_app()` to build the base Flask app (extensions, auth, `/api/dashboard/*` routes), then bolts the module blueprints onto it:

| Prefix | Source |
|---|---|
| `/api/dashboard`, `/api/dashboard/{auth,admin}` | `backend/dashboard/routes/` |
| `/api/search` | `backend/search/blueprint.py` |
| `/api/drugtox` | `backend/drugtox/blueprint.py` |
| `/api/labelcomp` | `backend/labelcomp/blueprint.py` |
| `/api/device` | `backend/device/blueprint.py` |
| `/api/localquery` | `backend/localquery/blueprint.py` |
| `/api/webtest` | `backend/webtest/blueprint.py` |

`backend/dashboard/routes/api.py` is ~3000 lines and holds most dashboard endpoints.

### Backend imports are rooted at `backend/`, not the repo root

Modules import as `from dashboard.config import Config`, `from database import db`, `from celery_app import ...` — bare, with no `backend.` prefix, and `backend/__init__.py` does not exist. Anything invoking backend code must have `backend/` as CWD or on `PYTHONPATH`. This is why `start-backend.js` sets `cwd`. Keep new imports in this style.

### Path-prefix handling is the trickiest part of the frontend

The app is served under a base path (`/askfdalabel`) with the API under a separate one (`/askfdalabel_api`), both behind nginx in production. Three pieces cooperate:

- `frontend/next.config.ts` — sets `basePath`/`assetPrefix` from `NEXT_PUBLIC_APP_BASE`, and rewrites `/api/:path*` **and** `${API_BASE}/api/:path*` to the Flask origin with `basePath: false`.
- `frontend/app/utils/appPaths.ts` — exports `APP_BASE`/`API_BASE`/`DASHBOARD_BASE` and the `withAppBase()` / `withApiBase()` helpers.
- `frontend/app/FetchPrefix.tsx` — mounted globally, it **monkey-patches `window.fetch` and `window.open`** and runs a `MutationObserver` that rewrites `<a href>`, `src`, and `srcset` across the DOM.

Consequence: write plain paths like `/api/dashboard/foo` in component code and the prefix is injected at runtime. Do not hand-prefix, or you get `/askfdalabel_api/askfdalabel_api/...` (the helpers guard against double-prefixing, but only for the exact base string). Module routes listed in `DASHBOARD_PREFIXES` get `DASHBOARD_BASE`; `/api/*` gets `API_BASE`.

### Two PostgreSQL schemas in one database

- **`labeling`** — SPL content. `sum_spl` (label metadata, model `DrugLabel`), `spl_sections` (model `LabelSection`), `active_ingredients_map`, `epc_map`, `substance_indexing`, `processed_zips`. `spl_sections` has a **generated** `search_vector TSVECTOR` column over `content_xml` with a GIN index — this is the search backbone.
- **`public`** — everything application-side: users, projects, favorites, annotations, MedDRA hierarchy, PGx, DrugTox, Orange Book, `system_tasks`, webtest, examine prompts.

All models live in one file, `backend/database/models.py`; `labeling` ones are marked with `__table_args__ = {'schema': 'labeling'}`.

Schema management is split and slightly unusual: Flask-Migrate is initialized but the `labeling` schema is created by raw DDL in `db_02_init_labeling_schema.py`, while `public` comes from `db.create_all()` — which runs on **every app startup** inside `create_app()`, alongside idempotent `migrate_projects()`, `seed_examine_prompts()`, and `check_meddra_data()`. Adding a model to `models.py` is usually enough for it to appear; adding a `labeling` table means editing the DDL script.

### Long-running work goes through SystemTask + Celery

`TaskService.create_task()` writes a `SystemTask` row, then `start_background_task()` dispatches the generic Celery task `execute_generic_task`, which re-imports the target by `(module_name, function_name)` and calls it with the `task_id` first. Workers update progress back onto the same row; the frontend polls it. Task bodies live in `backend/admin/tasks/` (`import_labels`, `import_meddra`, `import_drugtox`, `import_orangebook`, `generate_drugtox`, `run_webtest`) and must be importable by dotted module path from `backend/`.

### AI provider routing

`AIClientFactory.get_client()` in `backend/dashboard/services/ai_handler.py` picks a provider per request from a global setting, overridable per user via `user.ai_provider` and a JSON `user.ai_settings` blob. Supported: `gemini` (google-genai), `elsa` (internal FDA), and OpenAI-compatible endpoints (`llama`, `vllm`, `ollama`, `customized`). Every call funnels through `_record_usage()` into the `TokenUsage` table.

`_check_is_internal()` probes `fdalabel.fda.gov` with a 1.5s HEAD request and caches the result in a module-level global — it decides whether internal-only features light up, and it is per-process sticky.

### Global runtime settings read a Docker-only path

`EnvService` (`backend/dashboard/services/env_service.py`) reads `/data/config/env_settings.json` — a hardcoded absolute path that only exists inside the container. On Windows/macOS local dev it silently falls back to `DEFAULT_CONFIG`, so `labeling_source`, `postgres_db`, and the external-PG overrides are effectively fixed locally. `ai_model_provider` is always forced from the `DEFAULT_AI_MODEL` env var regardless of file contents.

`Config` also rewrites `@db:` → `@localhost:` in `DATABASE_URL` whenever `/.dockerenv` is absent, so the same `.env` works in and out of Docker.

### Agentic search pipeline

`/api/search/search_agentic_stream` runs a state machine, not a linear chain. `semantic_core/controller.py` loops on `state.flags["next_step"]` (capped at 30 steps) across agents in `semantic_core/agents/`: planner → semantic_retriever → keyword_retriever → reranker → postprocess → evidence_fetcher → answer_composer → reasoning_generator. Each agent mutates the shared `state` object (`state.py`) and sets the next step. To add a stage, add the agent module and have an existing agent route to it — there is no central registry.

### Label source abstraction

`LABEL_DB` (`POSTGRES` | `ORACLE`) selects the backing store for label queries via `FDALabelDBService` (`backend/dashboard/services/fdalabel_db.py`). `POSTGRES` is the only mode that works without internal FDA network access; Oracle paths degrade gracefully rather than hard-failing.

## Repo conventions and known cruft

- `archive/` is reference-only dead code — legacy scripts, old migrations, completed design notes. Never wire it into runtime code, and don't treat files there as current.
- `backend/drugtox/prev_code/` is superseded.
- The `backend/` root holds one-off operational scripts (`inspect_db.py`, `inspect_db2.py`, `cleanup_db.py`, `cleanup_tasks.py`, `check_queries.py`, `reset_drugtox.py`, `migrate_webtest_to_pg.py`, `update_versions.py`) plus `patch_export.py` at the repo root. These are not part of the app.
- `backend/requirements.txt` lists `fastapi`, `uvicorn`, and `python-multipart`; nothing imports them.
- `data/` is gitignored except for `data/sync_schema.py` (an explicit `!` exception). SPL storage, uploads, and downloads under it are local-only and not in version control.
- Frontend module pages under `frontend/app/{dashboard,search,drugtox,labelcomp,device,localquery,webtest,management}/` mirror the backend blueprint names one-to-one.
- `frontend/public/dashboard/js/` holds legacy vanilla-JS bundles (`chart.js`, `faers.js`, `xlsx.full.min.js`, …) loaded via Next `<Script>` tags from React pages — the dashboard is a partial migration, not a clean rewrite. Reference `chart.js` in lowercase; a duplicate `Chart.js` was removed because Windows filesystems can't hold both.
