# AskFDALabel Operations Report

**Document type:** Technical operations report  
**Status:** Living document  
**Implementation basis:** Current repository contents under `docker-compose.yml`, `deploy/nginx/`, `backend/`, `frontend/`, `backend/admin/tasks/`, and `scripts/`  
**Boundary:** This report documents how the current suite is configured, started, deployed, refreshed, monitored, and maintained. It is intentionally operational rather than feature-specific. Detailed behavior of individual product modules belongs in their own technical documents.

## Abstract

AskFDALabel operates as a modular monolith with a broader runtime footprint than “frontend plus backend.” The web-facing system consists of a Next.js frontend, a unified Flask backend, PostgreSQL with optional `pgvector`, and an optional nginx reverse proxy that normalizes the application under `/askfdalabel` and `/askfdalabel_api`. The operational boundary also includes a file-backed data area, manual and admin-triggered data-import jobs, standalone maintenance scripts, and a small set of health and validation surfaces.

The checked-in repository supports more than one runtime shape, but they are not equally mature. The most coherent deployment model is the nginx-fronted container stack. Local development without nginx is also possible, but the current codebase mixes `/api/*` and `/askfdalabel_api/*` assumptions, so path-prefix behavior is cleaner when the reverse proxy is present. This matters for operations because startup instructions, environment variables, browser URLs, and troubleshooting steps all depend on which runtime model is being used.

This report records the current operating model, the environment and filesystem contracts, the actual initialization flow needed for a fresh PostgreSQL-backed instance, the supported administrative refresh paths, and the current operational caveats visible in the repository.

## 1. Operational model

From an operations standpoint, AskFDALabel is made of five cooperating layers:

1. **Published web edge** — nginx under `deploy/nginx/`, optional but currently the cleanest external entry point.
2. **Frontend runtime** — Next.js application under `frontend/`.
3. **Backend runtime** — Flask application rooted in `backend/app.py`, composed from multiple blueprints.
4. **Persistence tier** — PostgreSQL for application state and label/search storage, optionally with `pgvector` enabled.
5. **Maintenance layer** — data-import scripts, embedding/index utilities, admin-triggered subprocess jobs, and validation artifacts.

A key operational characteristic of the codebase is that not all state is managed the same way:

- public application tables are largely created through SQLAlchemy `db.create_all()` when the backend starts,
- some changes are tracked through Alembic migrations under `backend/migrations/`,
- the `labeling` schema is initialized and extended partly through custom SQL scripts,
- major domain datasets are populated through standalone import scripts or admin-launched jobs,
- webtest and task logs are persisted on disk outside normal request/response storage.

As a result, a successful deployment is not just “containers are up.” It also requires the right environment variables, the right filesystem layout, the right reference datasets, and in many cases the right maintenance scripts to have run.

## 2. Supported runtime topologies

### 2.1 Reference deployment: nginx + frontend + backend + database

The checked-in deployment model is split across two compose files:

- `docker-compose.yml` starts `db`, `backend`, and `frontend`
- `deploy/nginx/docker-compose.yml` starts `nginx` on the same external Docker network (`apps-network`)

Operationally, this means the root stack should be started first, because the nginx compose file expects `apps-network` to already exist as an external network. The root compose file creates that network automatically.

In this reference topology:

- the browser enters through nginx,
- the user interface is served under `/askfdalabel`,
- API traffic is published under `/askfdalabel_api`,
- nginx rewrites `/askfdalabel_api/...` to backend paths such as `/api/...` or `/health`,
- backend and frontend remain internal services exposed only to the Docker network.

This is the most operationally consistent mode because it matches:

- the checked-in nginx config,
- the frontend base-path defaults,
- `ProxyFix` handling in `backend/app.py`,
- the public environment variables shipped in `.env.template.txt`.

It is also the only checked-in topology with explicit TLS handling. `deploy/nginx/entrypoint.sh` enables HTTPS on port 443 when certificate files are present at `/etc/nginx/certs/cert.pem` and `/etc/nginx/certs/key.pem`. The nginx Dockerfile copies `cert.pem*` and `key.pem*` from the `deploy/nginx/` build context if they exist there. When those files are absent, nginx stays on HTTP only and disables redirect logic.

### 2.2 Local development: direct frontend + direct backend

The repo also supports a direct local runtime without nginx:

- frontend launched from `frontend/`
- backend launched from `backend/`
- PostgreSQL started separately, commonly via Docker

This mode is useful for development, but it is not identical to the proxy deployment. The frontend rewrite in `frontend/next.config.ts` maps `/api/:path*` to the backend URL, while the client-side path logic in `frontend/app/FetchPrefix.tsx` and `frontend/app/utils/appPaths.ts` can still prefix requests with `/askfdalabel_api`. That means direct local mode works best when environment variables are tuned specifically for it.

Operationally, the direct mode is best treated as a developer workflow, not as the primary documentation baseline for production-like behavior.

### 2.3 Standalone process mode

Both tiers can also be run individually:

- backend with `python app.py`, `waitress`, or `gunicorn`
- frontend with `npm run dev` or `npm run start`

This is valid for targeted debugging, but it omits the reverse-proxy layer and does not solve dataset initialization, admin bootstrapping, or database preparation by itself.

## 3. Runtime services, ports, and access paths

### 3.1 Service inventory

| Service | Source | Internal port | Published port | Notes |
|---|---|---:|---:|---|
| PostgreSQL | root `docker-compose.yml` | 5432 | 5432 | Uses `ankane/pgvector:latest`; persisted to `./database/pgdata` |
| Flask backend | root `docker-compose.yml` | 8842 | none | Internal-only in compose; health endpoint at `/health` |
| Next.js frontend | root `docker-compose.yml` | 8841 | none | Internal-only in compose; served with base path `/askfdalabel` |
| nginx | `deploy/nginx/docker-compose.yml` | 80 / 443 | 80 / 443 | External entry point; rewrites `/askfdalabel_api` to backend |

### 3.2 Access patterns by topology

With the reference nginx topology:

- UI base: `http://<host>/askfdalabel/`
- API base: `http://<host>/askfdalabel_api/`
- backend health through nginx: `http://<host>/askfdalabel_api/health`

Without nginx:

- frontend commonly serves at `http://<host>:8841/askfdalabel/` in container mode
- backend serves at `http://<host>:8842/`
- local frontend wrapper defaults to port `8848` if `FRONTEND_PORT` is unset, which differs from the containerized default of `8841`

That frontend port mismatch is operationally important: the checked-in template assumes `8841`, while `frontend/scripts/start-frontend.js` falls back to `8848` when no environment value is present.

## 4. Configuration model

### 4.1 Central configuration source

The entire suite expects a root-level `.env` file. Multiple runtimes load it directly from the repository root:

- `backend/app.py`
- `backend/dashboard/config.py`
- `frontend/next.config.ts`
- `frontend/scripts/start-frontend.js`
- `frontend/scripts/start-backend.js`
- many utility scripts under `scripts/`

In container mode, the backend and frontend also receive values through `env_file: ./.env`, with selected overrides injected directly by Docker Compose.

### 4.2 Core runtime variables

| Variable | Current purpose | Operational notes |
|---|---|---|
| `DATABASE_URL` | Primary SQLAlchemy and psycopg2 connection string | Required for backend startup |
| `SECRET_KEY` | Flask session signing | Strongly recommended; code has an insecure default |
| `HOST` | Bind host for backend/frontend helper scripts | Defaults to `0.0.0.0` in several places |
| `BACKEND_PORT` | Backend listen port | Defaults to `8842` |
| `FRONTEND_PORT` | Frontend listen port | Template uses `8841`; local wrapper falls back to `8848` if absent |
| `OPENFDA_API_KEY` | External openFDA access | Optional but useful for production behavior |

### 4.3 AI and model variables

| Variable | Current purpose | Operational notes |
|---|---|---|
| `GOOGLE_API_KEY` | Gemini API key used by `ai_handler.py` | This is the active code path for Gemini |
| `PRIMARY_MODEL_ID` | Primary Gemini model | Defaults in code to `gemini-2.5-pro` or `gemini-2.5-flash` depending on call site |
| `FALLBACK_MODEL_ID` | Gemini fallback on quota/resource exhaustion | Defaults to `gemini-2.0-flash` |
| `LLM_URL` | OpenAI-compatible or self-hosted LLM endpoint | Required for llama/openai-style provider mode |
| `LLM_KEY` | Credential for `LLM_URL` | Optional if endpoint does not require auth |
| `LLM_MODEL` | Model name for `LLM_URL` endpoint | Defaults to a Llama model string in code/template |
| `ELSA_API_NAME` | Elsa username | Used only in Elsa/internal mode |
| `ELSA_API_KEY` | Elsa password/token | Used only in Elsa/internal mode |
| `ELSA_MODEL_ID` | Elsa engine/model identifier | Required for Elsa mode |
| `ELSA_MODEL_NAME` | Elsa display/model name | Informational and provider-adjacent |
| `EMBEDDING_PROVIDER` | Embedding backend selection | `local` forces SentenceTransformer embeddings |
| `LOCAL_EMBEDDING_MODEL_ID` | Local embedding model identifier | Used by semantic search and embedding scripts |

### 4.4 Label-source and internal-connectivity variables

| Variable | Current purpose | Operational notes |
|---|---|---|
| `LABEL_DB` | Label source mode: `POSTGRES` or `ORACLE` | Defaults to `POSTGRES` |
| `LOCAL_QUERY` | Enables local query behavior | Parsed as boolean in config |
| `FDALabel_HOST` | Oracle host | Used only when `LABEL_DB=ORACLE` |
| `FDALabel_PORT` | Oracle port | Used only when `LABEL_DB=ORACLE` |
| `FDALabel_SERVICE` | Oracle service name | Used only when `LABEL_DB=ORACLE` |
| `FDALabel_USER` | Oracle username | Used only when `LABEL_DB=ORACLE` |
| `FDALabel_PASSWORD` | Oracle password as defined in config | Current config name |

### 4.5 Frontend path and rewrite variables

| Variable | Current purpose | Operational notes |
|---|---|---|
| `FRONTEND_BASE_PATH` | Next.js base path in `next.config.ts` | Defaults to `/askfdalabel` |
| `BACKEND_URL` | Explicit backend origin for Next rewrites | Used mainly outside containerized reverse-proxy mode |
| `NEXT_PUBLIC_API_BASE` | Browser-visible API prefix in `appPaths.ts` | Defaults to `/askfdalabel_api` |
| `NEXT_PUBLIC_DASHBOARD_BASE` | Browser-visible app base for internal links | Defaults to `/askfdalabel` |
| `NEXT_PUBLIC_APP_BASE` | Full app base for assets and path helpers | Not present in template but supported in code |

### 4.6 Template drift that must be corrected

The shipped `.env.template.txt` is close to the current implementation, but not fully aligned. These mismatches should be corrected in any real deployment:

1. **Gemini key name mismatch**  
   The template uses `GEMINI_API_KEY`, while the active backend code reads `GOOGLE_API_KEY`.

2. **Local query variable mismatch**  
   The template uses `LOCAL-QUERY=True`, while the backend config reads `LOCAL_QUERY`.

3. **Oracle password unified**  
   The previous naming mismatch between `FDALabel_PASSWORD` and `FDALabel_PSW` has been resolved. The configuration layer supports both variables and falls back to either key dynamically, removing the need for a manual patch.

4. **App base variable omitted from template**  
   `NEXT_PUBLIC_APP_BASE` is not in the template even though `frontend/app/utils/appPaths.ts` supports it.

5. **Default secret should not be relied on**  
   `SECRET_KEY` falls back to a checked-in value and should be set explicitly in any shared environment.

## 5. Filesystem and persistence model

### 5.1 Data root selection

The backend selects its runtime data root in `dashboard/config.py`:

- if `/data` exists, it uses `/data`
- otherwise it uses `<repo>/data`

This makes host execution and container execution behave differently but predictably.

### 5.2 Important runtime paths

| Path | Operational role | Persistence source |
|---|---|---|
| `data/uploads/` or `/data/uploads/` | Uploaded XML, import staging JSON, temporary user content | File-backed runtime state |
| `data/spl_storage/` or `/data/spl_storage/` | Input ZIP files for label import | Required for label snapshot ingestion |
| `data/logs/tasks/` or `/data/logs/tasks/` | Admin task logs | Created on demand by admin jobs |
| `data/downloads/` or `/data/downloads/` | Reference datasets (Orange Book, MedDRA, PGx, DrugTox, etc.) | Operator-managed data area |
| `backend/webtest/history/` | Web validation history workbooks | Mounted separately in compose |
| `backend/webtest/results/` | Web validation JSON outputs | Mounted separately in compose |
| `database/pgdata/` | PostgreSQL data volume on host | Created by compose if missing |

### 5.3 Expected reference-data locations

The current import scripts expect the following host-side data layout:

| Dataset | Expected path |
|---|---|
| SPL ZIP files for local label ingestion | `data/spl_storage/*.zip` |
| Orange Book products file | `data/downloads/OrangeBook/EOB_Latest/products.txt` |
| MedDRA ASCII release | `data/downloads/MedDRA/MedDRA_latest/MedAscii/` |
| DrugTox workbook | `data/downloads/ALT_update_latest.xlsx` |
| PGx biomarker workbook | `data/downloads/biomarker_db/Table of Pharmacogenomic Biomarkers in Drug Labeling  FDA.xlsx` |
| DailyMed bulk downloads (download utility target) | `data/downloads/dailymed/` |

A critical operational nuance is that the DailyMed downloader writes to `data/downloads/dailymed/` by default, while the current local label-import path expects prepared ZIP files in `data/spl_storage/`. The repository does not currently provide one authoritative end-to-end normalization pipeline between those two locations, so operators should treat label source acquisition and label import as separate steps.

## 6. Fresh-environment bootstrap

### 6.1 Recommended first bootstrap for a PostgreSQL-backed instance

The most reliable fresh-environment sequence is:

```bash
# 1) Create the real environment file from the template and fix variable drift
cp .env.template.txt .env

# 2) Start the core services
docker compose up -d

# 3) Optionally start the public edge
cd deploy/nginx
docker compose up -d
cd ../..
# 4) Initialize database capabilities and schema helpers
python backend/database/scripts/db_01_enable_pgvector.py
python backend/database/scripts/db_02_init_labeling_schema.py
python backend/database/scripts/db_03_init_public_schema.py

# 5) Import reference datasets
python backend/database/scripts/db_04_import_orange_book.py --force
python backend/database/scripts/db_05_import_epc_indexing.py
python scripts/migration/01_import_meddra.py --force
python scripts/migration/02_import_pgx.py
python scripts/migration/03_import_drugtox.py

# 6) Final preparation
python backend/database/scripts/db_06_create_admin.py
python backend/database/scripts/db_07_import_labels.py


# 7) Optional semantic-search preparation
python scripts/ai/check_pg_vector.py
python scripts/ai/create_vector_index.py

# 8) Create an admin user for the management console
python backend/database/scripts/db_06_create_admin.py
```

Two notes matter here:

- `db.create_all()` in the backend will create many public-schema tables automatically, but it does **not** replace `pg_init_labeldb.py` for the full `labeling` schema.
- The label-search stack can run without precomputed embeddings, but semantic retrieval quality and speed depend on vector data and indexing being prepared.

### 6.2 Container-first versus host-first execution

Operationally, the bootstrap sequence is easiest when scripts are run from the host against a host-reachable `DATABASE_URL` such as `localhost:5432`, because many standalone scripts load the root `.env` directly.

When a script is run inside the backend container instead, the effective connection string should target the Compose service name `db`, not `localhost`. The checked-in root compose file already injects `DATABASE_URL=postgresql://afd_user:afd_password@db:5432/askfdalabel` into the backend container.

### 6.3 Alembic is not the whole migration story

The presence of `backend/migrations/` should not be interpreted as “run Alembic and the platform is ready.” In the current codebase:

- many tables come from SQLAlchemy model creation,
- some schema elements are created by custom SQL scripts,
- only a subset of schema evolution is expressed through Alembic revisions.

The safe operational assumption is therefore:

- Alembic covers some deltas,
- `db.create_all()` covers many public tables,
- custom scripts still matter for the `labeling` schema and several data-population workflows.

## 7. Runtime startup procedures

### 7.1 Containerized reference startup

From the repository root:

```bash
docker compose up -d
```

From `deploy/nginx/`:

```bash
docker compose up -d
```

Use this mode when you want the path-prefix behavior that most closely matches the checked-in frontend and proxy assumptions.

### 7.2 Local development startup

From `frontend/`:

```bash
npm install
npm run dev
```

To launch the backend from the same `frontend/` workspace:

```bash
npm run dev:backend
```

To launch both together:

```bash
npm run dev:all
```

To start Docker services from the frontend helper:

```bash
npm run db:start
```

That helper shells out to `docker compose up -d`; despite its name, it is not limited to the database service. Because the script does not override its working directory, it also appears to assume a compose file is discoverable from the `frontend/` working tree. Treat it as a convenience script that should be verified locally, not as the primary documented bootstrap path.

### 7.3 Standalone backend startup

From `backend/`:

```bash
python app.py
```

In containerized production, the backend uses:

```bash
gunicorn --bind 0.0.0.0:8842 app:app
```

The frontend helper script also supports a Waitress-based production launch path on local systems.

## 8. Administrative refresh and maintenance workflows

### 8.1 Management console responsibilities

The admin-facing operational console lives at `/management` in the frontend and talks to backend admin routes under `/api/dashboard/admin/*`.

It currently supports two major administrative surfaces:

- **user administration**
- **database refresh task orchestration**

The supported refresh job types are:

- `labeling`
- `orangebook`
- `drugtox`
- `meddra`

These are implemented as subprocess launches from `backend/dashboard/routes/admin.py`, not as queue-backed background workers.

### 8.2 Task execution model

When an admin triggers a refresh:

- a `system_tasks` row is created,
- a backend subprocess is started with `--task-id`,
- the task updates progress directly in PostgreSQL,
- stdout and stderr are redirected to a task log file,
- the management UI can poll both task status and logs.

Current task log location:

- `data/logs/tasks/task_<id>.log` or `/data/logs/tasks/task_<id>.log`

This design works for moderate, manually triggered jobs, but it is still an in-process web-tier orchestration model rather than a dedicated worker system.

### 8.3 Manual scripts that remain operationally important

Not all maintenance is exposed through the admin UI. Important manual scripts include:

| Script | Purpose |
|---|---|
| `backend/database/scripts/db_06_create_admin.py` | Creates or resets the admin user |
| `backend/database/scripts/list_tables_pg.py` | Lists tables and row counts by schema |
| `backend/database/scripts/check_schema.py` | Checks vector-column dimensional metadata |
| `backend/database/scripts/db_01_enable_pgvector.py` | Ensures `vector` extension exists |
| `backend/database/scripts/db_02_init_labeling_schema.py` | Initializes `labeling` schema objects |
| `backend/database/scripts/db_07_import_labels.py` | Bulk imports local SPL ZIPs |
| `backend/database/scripts/db_04_import_orange_book.py` | Imports Orange Book dataset |
| `backend/database/scripts/db_05_import_epc_indexing.py` | Imports Pharmacologic Class Indexing data |
| `scripts/migration/01_import_meddra.py` | Imports MedDRA release files |
| `scripts/migration/02_import_pgx.py` | Imports PGx biomarker workbook |
| `scripts/migration/03_import_drugtox.py` | Imports DrugTox workbook |

| `scripts/ai/check_pg_vector.py` | Verifies vector extension and table presence |
| `scripts/ai/create_vector_index.py` | Builds HNSW vector index |
| `scripts/labels/download_dailymed.py` | Downloads DailyMed bulk release ZIPs |

## 9. Health checks, observability, and validation surfaces

### 9.1 Built-in health checks

The stack includes several lightweight health probes:

| Surface | Current behavior |
|---|---|
| `GET /health` on backend | Returns `{"status": "ok"}` |
| backend Docker healthcheck | Calls `curl http://localhost:8842/health` |
| frontend Docker healthcheck | Calls `curl http://localhost:8841/askfdalabel/` |
| nginx Docker healthcheck | Calls `curl http://localhost/askfdalabel/` |
| `POST /api/check-fdalabel` | Tests whether internal or public FDALabel endpoints are reachable |
| `GET /api/dashboard/auth/session` | Confirms session state and some runtime context |

These are useful liveness signals, but they are not deep integration tests. They do not confirm that reference datasets are loaded, that the `labeling` schema exists, or that semantic search embeddings are present.

### 9.2 Validation artifacts

The repository also carries a validation subsystem under `backend/webtest/` with:

- workbook templates,
- history files,
- JSON result outputs.

Those artifacts are operationally useful for regression checking, but they are separate from container liveness checks. They should be treated as validation tooling, not as the primary health surface.

### 9.3 Practical log sources

Current operations can observe the system through:

- `docker compose logs`
- backend stdout/stderr
- nginx container logs
- admin task log files under `data/logs/tasks/`
- webtest JSON outputs under `backend/webtest/results/`
- standalone script log files such as `sync_embeddings_multigpu.log` where applicable

## 10. Troubleshooting guide

### 10.1 UI loads fail or paths are incorrect

Likely causes:

- nginx is not running but browser URLs still use `/askfdalabel` and `/askfdalabel_api`
- the frontend is running directly, but `NEXT_PUBLIC_API_BASE` still points to `/askfdalabel_api`
- `FRONTEND_BASE_PATH` and the public path variables are inconsistent

Operational response:

- prefer the nginx-fronted topology for end-to-end verification,
- or deliberately align direct-local variables with the frontend rewrite model.

A practical local-only adjustment is to use `/api` as the public API base when bypassing nginx. That follows the current code structure in `appPaths.ts`, `FetchPrefix.tsx`, and `next.config.ts`, but it should be treated as a local-development convention rather than the published production shape.

### 10.2 Backend is healthy but label features are incomplete

Likely causes:

- `labeling` schema not initialized,
- `data/spl_storage/` is empty,
- imports have not run,
- `LABEL_DB=ORACLE` is configured but Oracle credentials are incomplete or mismatched.

Operational response:

- initialize `labeling` with `scripts/database/pg_init_labeldb.py`,
- verify input ZIPs exist in `data/spl_storage/`,
- run label import scripts,
- treat Oracle mode as a code-level fix item, not just an environment-variable issue, because the password alias is currently broken between config and service layers.

### 10.3 Admin refresh jobs fail immediately

Likely causes:

- expected data files are absent from `data/downloads/`,
- backend process lacks filesystem access to `/data`,
- subprocess import script fails while updating `system_tasks`.

Operational response:

- verify input files and directories first,
- inspect `data/logs/tasks/task_<id>.log`,
- confirm the backend process has access to the mounted data directory.

### 10.4 AI features fail while the rest of the app runs

Likely causes:

- missing `GOOGLE_API_KEY`, `LLM_URL`, or Elsa credentials,
- wrong provider selected for the environment,
- fallback model IDs not configured as expected.

Operational response:

- verify provider-specific environment values,
- verify that the active provider path matches the deployment environment,
- test a lightweight model call before assuming the broader search stack is broken.

### 10.5 Semantic search is slow or unavailable

Likely causes:

- `pgvector` extension is missing,
- `label_embeddings` is empty,
- HNSW index has not been built,
- the embedding preparation workflow has not actually completed.

Operational response:

- run `scripts/ai/check_pg_vector.py`,
- verify `label_embeddings` exists and contains rows,
- build the vector index,
- validate the embedding-generation pipeline before debugging the search UI.

## 11. Current operational caveats and cleanup targets

The codebase exposes several operational drift points that should be recorded explicitly.

### 11.1 Environment naming is not yet fully normalized

Current examples:

- `GEMINI_API_KEY` in the template vs `GOOGLE_API_KEY` in code
- `LOCAL-QUERY` in the template vs `LOCAL_QUERY` in code
- Oracle variables unified (`FDALabel_PASSWORD` and `FDALabel_PSW` are mapped dynamically, as are `FDALabel_HOST`/`FDALabel_SERV` and `FDALabel_SERVICE`/`FDALabel_APP`)

These should be normalized before the deployment model is treated as stable.

### 11.2 The root compose file is not externally published by itself

`backend` and `frontend` use `expose`, not `ports`. This is correct for the nginx-fronted topology, but it means a root-level `docker compose up -d` alone does not produce the same browser entry path implied by the rest of the docs.

### 11.3 Public-schema creation is automatic, but full schema management is not unified

Because `db.create_all()` runs on backend startup, the application can appear healthy even when important custom schema elements or imported datasets are still missing.

### 11.4 Some standalone utilities need verification before being treated as turnkey

At least two scripts appear to have import-path assumptions that should be reviewed before being treated as standard operational tooling:

- `scripts/ai/sync_label_embeddings.py`
- `scripts/utils/update_tox_agent.py`

Both append a `backend` path relative to `scripts/`, not relative to the repository root, which may fail outside a very specific execution context.

The frontend helper `npm run db:start` should also be treated cautiously. It shells out to `docker compose up -d` without changing directories, so it may not resolve the root compose file when invoked from `frontend/`.

### 11.5 The checked-in admin creation script is not production-safe as written

`scripts/database/create_admin.py` contains hard-coded credentials and is useful for controlled local setup, but it should not be used unchanged in a shared or production environment.

## 12. Recommended operational baseline

For the current repository state, the safest baseline is:

1. use PostgreSQL as the primary operational store,
2. use the nginx-fronted topology as the reference deployment shape,
3. correct the `.env` naming drift before first deployment,
4. treat `labeling` initialization and dataset imports as mandatory setup,
5. treat semantic embeddings and vector indexing as optional but strongly recommended search preparation,
6. use the management console for supported refresh jobs, but keep the standalone scripts documented and available,
7. regard `idea/` notes and older deployment assumptions as historical, not authoritative.

## 13. Companion documents

This operations report should be read alongside:

- `Documents/Overview.md` — system-level purpose and scope
- `Documents/Architecture.md` — runtime topology and component boundaries
- `Documents/Backend.md` — backend assembly, services, and server-side execution model
- `Documents/Frontend.md` — frontend routing, state, and deployment-aware path behavior
- `Documents/Database.md` — schema, table inventory, and data population model
- `Documents/AI-and-Search.md` — provider configuration, semantic search, and AI execution architecture

