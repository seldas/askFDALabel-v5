# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Prerequisite: `.env` must exist

`backend/dashboard/config.py` raises `ValueError` at **import time** if `DATABASE_URL` (or the `PG_*` parts) is unset. Nothing in the backend imports without a repo-root `.env` — not the app, not Celery, not the `backend/database/scripts/*` utilities. Copy `.env.template.txt` to `.env` first.

All backend entry points load the `.env` from the **repo root** (`Path(__file__).parents[N] / '.env'`), never from CWD.

## Commands

### Server execution (Two official methods)

The server should be started in one of two standardized ways:

#### Method 1: `start_server.py` orchestrator (Recommended)
`start_server.py` generates `docker-compose.yml` on the fly from `.env` and then shells out to `docker compose`.

```bash
python start_server.py --mode dev    # Hot reload (HMR), ports 8841 (web) + 8842 (api)
python start_server.py --mode prod   # Production build, nginx on :80 / :443
python start_server.py --mode dev --down   # Stop and clean up containers
python start_server.py --mode dev --dry-run   # Write docker-compose.yml only
```

Other flags: `--efficient` (lower pool/worker limits), `--local-db true|false` (overrides `LOCAL-PG`), `--build`, `--rapid` (implies prod, no nginx, remote DB).

#### Method 2: Standard Docker Compose
Once `docker-compose.yml` has been generated:

```bash
docker compose up -d       # Start all services
docker compose down        # Stop all services
docker compose logs -f     # Follow container logs
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
python backend/database/scripts/db_02_init_labeling_schema.py   # labeling tables + pg_trgm indexes
python backend/database/scripts/db_03_init_public_schema.py
python backend/database/scripts/db_04_import_orange_book.py     # RLD/RS identification
python backend/database/scripts/db_05_import_epc_indexing.py    # Deep Dive pharmacologic class
python backend/database/scripts/db_06_create_admin.py
python backend/database/scripts/db_07_import_labels.py --force --skip-unpack
python backend/database/scripts/db_11_import_dili_reference.py   # DILI Rule-of-Two reference set
```

`db_08_import_archive_labels.py` handles archived SPL sets. `db_12_drop_fulltext_search.py` is the one-way migration that removed full-text search from an existing database — run it once on any environment imported before that change.

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

Modules import as `from dashboard.config import Config`, `from database import db`, `from celery_app import ...` — bare, with no `backend.` prefix, and `backend/__init__.py` does not exist. Anything invoking backend code must have `backend/` as CWD or on `PYTHONPATH` (as configured in the container runtime and `start_server.py`). Keep new imports in this style.

### Path-prefix handling is the trickiest part of the frontend

The app is served under a base path (`/fdalabel-v3`) with the API under a separate one (`/fdalabel-v3_api`), both behind nginx in production. Three pieces cooperate:

- `frontend/next.config.ts` — sets `basePath`/`assetPrefix` from `NEXT_PUBLIC_APP_BASE`, and rewrites `/api/:path*` **and** `${API_BASE}/api/:path*` to the Flask origin with `basePath: false`.
- `frontend/app/utils/appPaths.ts` — exports `APP_BASE`/`API_BASE`/`DASHBOARD_BASE` and the `withAppBase()` / `withApiBase()` helpers.
- `frontend/app/FetchPrefix.tsx` — mounted globally, it **monkey-patches `window.fetch` and `window.open`** and runs a `MutationObserver` that rewrites `<a href>`, `src`, and `srcset` across the DOM.

Consequence: write plain paths like `/api/dashboard/foo` in component code and the prefix is injected at runtime. Do not hand-prefix, or you get `/fdalabel-v3_api/fdalabel-v3_api/...` (the helpers guard against double-prefixing, but only for the exact base string). Module routes listed in `DASHBOARD_PREFIXES` get `DASHBOARD_BASE`; `/api/*` gets `API_BASE`.

### Two PostgreSQL schemas in one database

- **`labeling`** — SPL content. `sum_spl` (label metadata, model `DrugLabel`), `active_ingredients_map`, `epc_map`, `substance_indexing`, `processed_zips`, `query_options_cache`. There is **no label-text search**: `spl_sections`, its generated `search_vector TSVECTOR`, and `sum_spl.full_search_vector` were all dropped to keep the database small at 700k-label scale. Label bodies are read from the SPL XML on disk via `sum_spl.local_path`. Criteria queries are served by `pg_trgm` GIN indexes over the name and category columns.
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

### Search is DB-first routing, not a pipeline

The agentic/semantic pipeline (`semantic_core/`, `/api/search/search_agentic_stream`) was
removed along with full-text search. What remains in `backend/search/blueprint.py` is a
much smaller decision tree: `_classify_query()` labels the input `uuid` | `ndc` | `appnum` |
`keyword` | `general`, and `/api/search/db_search` routes it down one of four paths — DB
multi-result, DB single-result (XML read from disk, then AI-summarised), AI fallback, or
straight-to-chat for a general question. `/api/search/chat` and `/refine_chat` handle the
conversational side. There is no controller, no shared state object, and no agent registry.

### One tool catalog: `frontend/app/platform/registry.ts`

Every place that offers a tool — the header nav, the `/tools` directory, the dashboard
selection bar, and the label workspace's Toolbox tab — renders from `TOOLS` in
`platform/registry.ts`. A `ToolDef` carries its own `href(ctx)` builder, the `contexts` it can
launch from, optional deployment `requires`, an optional `featureKey`, and the presentation
hints (`accent`, `pattern`) the toolbox derives its card treatment from. **Adding a tool is one
registry entry** — nothing downstream enumerates tools by hand.

Route strings come from `platform/context.ts`, which is the only module that knows the URL
contract. Its builders return **base-path-relative** routes; `FetchPrefix.tsx` adds the prefix at
runtime, so never wrap a registry href in `withAppBase()`.

Filtering runs in `ToolLauncher.tsx::isToolAvailable`, in this order: `enabled` → `featureKey`
permission → context kind → `applies(ctx)` → deployment `requires`. `applies` is for
availability that depends on the *context* rather than the deployment or the account — the FDA
Application Profile uses it, since not every label has an application number.

### Feature gates and account roles

`User.role` is one of `user` | `developer` | `admin` (`ROLES` in `backend/database/models.py`);
`is_admin` is kept in sync with the role. The shared `guest` account holds the `user` role but
is excluded separately, because it must not touch anything storing per-account state.

Access rules are **data, not code**. `backend/dashboard/services/feature_gates.py` holds
`FEATURE_CATALOG` (the code half — key, blurb, where it is enforced, and the defaults that
reproduce the previously hardcoded behaviour) and resolves it against `FeatureGate` rows (the
data half — only `min_role` and `allow_guest`). Rows are seeded from the catalog on startup
via `seed_feature_gate_rows()`; admins change them at runtime from the management panel
(`/api/dashboard/admin/feature_gates`). Adding a feature is a catalog entry, never a migration.

Enforcement is in three places and all three must agree:

- `backend/dashboard/routes/guards.py` — `feature_before_request('key')` on a whole blueprint
  (`search`/labelchat, `localquery`, `webtest`) or `@require_feature('key')` per route
  (`query_history`, `preferences`). Apply the decorator *below* `@login_required`.
- `frontend/app/components/RequireFeature.tsx` — page-level gate reading the session's
  `permissions` map, rendering `AccessRestricted.tsx` instead of an app shell that 403s.
- The frontend tool registry, which hides ungranted tools from navigation.

**Never cache a gate across requests.** The panel's whole point is that a change applies without
a restart, and the app runs multiple processes — a module-level cache (the pattern
`_check_is_internal` uses) would strand every process but the writer. Gates are read per request
and memoised only on `flask.g`.

### Label source resolution

SPL XML resolution follows one fixed cascade in
`FDALabelDBService.resolve_spl_xml()`, the same in every deployment: the local
file named by `labeling.sum_spl.local_path` (extension picks the directory —
`.zip` → `data/spl_storage`, otherwise `data/spl_storage_archived`), then a
sibling row for the same `set_id`, then Oracle `druglabel.spl.spl_xml`.
`force_local=True` stops before Oracle. It returns `(xml, source)` so callers
can see which step answered and whether a different version was substituted.

**There is no DailyMed fallback**, and no `LABEL_DB` switch. DailyMed fetched by
`set_id` only, so a version-pinned request silently got the current labeling, and
a broken storage path looked like a working app that needed internet. A labeling
this deployment cannot serve is an expected outcome, not a server error: routes
should return 404 with `fda_client.label_not_found_payload()`, which carries
links to DailyMed and public FDALabel. Only the label view does this today.

Which Postgres and whether Oracle is reachable are runtime settings —
`EnvService`'s `labeling_source` and the admin Oracle panel — not env constants.

## Repo conventions and known cruft

- `archive/` is reference-only dead code — legacy scripts, old migrations, completed design notes. Never wire it into runtime code, and don't treat files there as current.
- `backend/drugtox/prev_code/` is superseded.
- The `backend/` root holds one-off operational scripts (`inspect_db.py`, `inspect_db2.py`, `cleanup_db.py`, `cleanup_tasks.py`, `check_queries.py`, `reset_drugtox.py`, `migrate_webtest_to_pg.py`, `update_versions.py`) plus `patch_export.py` at the repo root. These are not part of the app.
- `backend/requirements.txt` lists `fastapi`, `uvicorn`, and `python-multipart`; nothing imports them.
- `data/` is gitignored except for `data/sync_schema.py` (an explicit `!` exception). SPL storage, uploads, and downloads under it are local-only and not in version control.
- Frontend module pages under `frontend/app/{dashboard,search,drugtox,labelcomp,device,localquery,webtest,management}/` mirror the backend blueprint names one-to-one.
- `frontend/public/dashboard/js/` holds legacy vanilla-JS bundles (`chart.js`, `faers.js`, `xlsx.full.min.js`, …) loaded via Next `<Script>` tags from React pages — the dashboard is a partial migration, not a clean rewrite. Reference `chart.js` in lowercase; a duplicate `Chart.js` was removed because Windows filesystems can't hold both.
