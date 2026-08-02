# AskFDALabel Backend Technical Report

**Document type:** Technical backend report  
**Status:** Living document  
**Implementation basis:** Current repository contents under `backend/`, `backend/dashboard/`, `backend/database/`, `backend/search/`, `backend/admin/tasks/`, and the backend runtime defined in `backend/Dockerfile` and `docker-compose.yml`  
**Boundary:** This report documents the server-side architecture, package layout, execution model, service boundaries, and operational characteristics of the current Flask backend. It is **not** a route-by-route API reference, database schema catalog, or deployment runbook.

## Abstract

The AskFDALabel backend is a unified Flask application assembled from a dashboard-centered application factory and a set of additional feature blueprints. Although the user-facing product appears as several workspaces—dashboard, search, label comparison, DrugTox, device intelligence, local query, and web validation—the server side runs as one integrated process with shared configuration, shared authentication, shared database extensions, and a common service layer.

The current implementation is best described as a hybrid backend. It combines classic transactional web application behavior, analytical retrieval and enrichment, live calls to external FDA-related services, background thread execution for user-triggered long-running jobs, subprocess-based administrative import tasks, and vector-enabled semantic retrieval against PostgreSQL. It also mixes abstraction styles: ORM-backed application models, raw PostgreSQL/Oracle data access helpers, SQLAlchemy text queries, XML parsing utilities, and LLM/provider orchestration.

For that reason, this backend should be documented as a platform runtime rather than as a simple REST API server. The backend is both the control plane for application workflows and the computational layer for label parsing, search, enrichment, comparison, and maintenance.

## 1. Purpose and documentation boundary

This document exists to explain how the backend is actually organized in the checked-in codebase. It answers questions such as:

- how the Flask runtime is assembled,
- which backend packages own which responsibilities,
- how requests flow through blueprints and services,
- how database access is structured,
- how asynchronous or long-running tasks are executed,
- where the current implementation shows architectural drift.

It intentionally stops short of per-endpoint detail. More focused documents should carry those details later:

- `Architecture.md` for cross-system topology and frontend/backend interaction,
- `Database.md` for schema and migration details,
- `AI-and-Search.md` for search and model orchestration,
- `Operations.md` for deployment, environment, and maintenance procedures,
- module-specific documents for `drugtox`, `labelcomp`, `device`, `localquery`, and `webtest`.

## 2. Backend role in the overall suite

The backend is not a thin API layer sitting behind a separately designed frontend. It is the primary implementation core of AskFDALabel. The Next.js frontend delegates nearly all nontrivial work to this server-side layer:

- label discovery and metadata lookup,
- SPL XML retrieval and parsing,
- project and favorite management,
- annotation persistence,
- AI reasoning and comparison summaries,
- MedDRA and FAERS-based analytical enrichment,
- local label database search and export,
- DrugTox and device intelligence data retrieval,
- administrative imports and system task tracking,
- web validation template execution and reporting.

The architectural consequence is that the backend carries both application concerns and data/analysis concerns. It is not organized purely around REST resources. Instead, it is organized around feature domains and shared computational services.

## 3. Application construction and startup lifecycle

### 3.1 Unified entry point: `backend/app.py`

The outer runtime entry point is `backend/app.py`. Its job is to assemble the full backend by layering feature modules on top of the dashboard application factory.

The startup sequence is:

1. load `.env` from the repository root,
2. create the dashboard app via `dashboard.create_app()`,
3. wrap the app with `ProxyFix` so forwarded headers from nginx are respected,
4. apply CORS for `/api/*`,
5. register the non-dashboard blueprints,
6. expose lightweight app-level endpoints such as `/health` and `/api/check-fdalabel`.

This produces a single Flask application object that is used in both development and containerized execution. When run directly, `app.py` starts Flask’s built-in threaded server. In the containerized runtime, `backend/Dockerfile` instead launches the same app object under Gunicorn on port `8842`.

### 3.2 Dashboard factory: `backend/dashboard/__init__.py`

The most important backend design fact is that the dashboard package is not just one feature area. It is the application foundation.

`create_app()` in `backend/dashboard/__init__.py` performs the following responsibilities:

- loads configuration from `dashboard.config.Config`,
- initializes SQLAlchemy, Flask-Migrate, and Flask-Login,
- registers dashboard blueprints (`auth`, `main`, `api`, `admin`),
- ensures runtime directories exist,
- defines the Flask-Login `user_loader`,
- enters an app context during startup and performs initialization work.

That startup work includes three notable side effects:

- `db.create_all()` is called on boot,
- `migrate_projects()` normalizes or creates each user’s default `Favorite` project and rehomes orphaned records,
- `check_meddra_data()` warns when MedDRA reference tables are empty.

This means backend startup is not side-effect free. It performs schema creation and application-state normalization in addition to ordinary app construction. That is an important operational characteristic and should be accounted for in later deployment and migration documentation.

### 3.3 Registered blueprint topology

The unified app combines four dashboard blueprints and six feature blueprints.

| Blueprint source | Mounted prefix | Primary responsibility |
|---|---|---|
| `dashboard.routes.auth` | `/api/dashboard/auth` | Session, login, registration, password change, session metadata |
| `dashboard.routes.main` | `/api/dashboard` | Core dashboard routes, uploads, import/export helpers, label views, preferences |
| `dashboard.routes.api` | `/api/dashboard` | Analytical, project, favorite, annotation, FAERS, AE report, and assessment APIs |
| `dashboard.routes.admin` | `/api/dashboard/admin` | Admin-only user management and import task orchestration |
| `search.blueprint` | `/api/search` | Search workspace APIs, semantic streaming, metadata helpers, exports |
| `drugtox.blueprint` | `/api/drugtox` | DrugTox search, detail, history, discrepancy, and company analytics |
| `labelcomp.blueprint` | `/api/labelcomp` | Multi-label comparison and AI summary generation |
| `device.blueprint` | `/api/device` | Device lookup, metadata, MAUDE, recalls, IFU comparison |
| `localquery.blueprint` | `/api/localquery` | Direct local DB search, autocomplete, random samples, export |
| `webtest.blueprint` | `/api/webtest` | Template-based FDALabel/web validation and report generation |

Two app-level routes live outside those blueprints:

- `/health` for service health checks,
- `/api/check-fdalabel` for environment capability detection and local-query availability checks.

## 4. Configuration model and runtime assumptions

### 4.1 Central configuration

`backend/dashboard/config.py` is the primary configuration surface. The backend expects a repository-root `.env` file and treats `DATABASE_URL` as mandatory.

Configuration falls into five major groups:

| Configuration family | Examples | Purpose |
|---|---|---|
| Core Flask/runtime | `SECRET_KEY`, `BACKEND_PORT`, `HOST`, `FLASK_DEBUG` | Basic runtime behavior |
| Database | `DATABASE_URL` | Main PostgreSQL connection used by SQLAlchemy and several raw-query paths |
| Label DB mode | `LABEL_DB`, `LOCAL_QUERY` | Selects Postgres vs Oracle access behavior for label retrieval/search |
| AI providers | `GOOGLE_API_KEY`, `PRIMARY_MODEL_ID`, `FALLBACK_MODEL_ID`, `LLM_URL`, `LLM_KEY`, `LLM_MODEL`, `ELSA_*` | LLM and embedding provider selection |
| Oracle/internal FDALabel | `FDALabel_HOST`, `FDALabel_PORT`, `FDALabel_SERVICE`, `FDALabel_USER`, `FDALabel_PASSWORD` | Internal label DB connectivity |

### 4.2 Data directory policy

The backend uses a simple but important path policy:

- if `/data` exists, it becomes the effective data root,
- otherwise the repository-local `data/` directory is used.

From that root the backend derives file-backed working locations such as:

- uploads,
- SPL storage,
- task logs,
- downloaded import inputs.

This design allows the same code to run in local development and in containers with a mounted persistent volume.

### 4.3 Current configuration drift

The configuration variable naming mismatch (where `Config` defined `FDALabel_PASSWORD` while legacy scripts and `FDALabelDBService.get_connection()` expected `FDALabel_PSW`) has been resolved. The configuration class now supports both names and falls back transparently. Similarly, utility scripts support both legacy and standardized parameters.

Other observations:
- `AIClientFactory` uses `GOOGLE_API_KEY` for Gemini rather than the older `GEMINI_API_KEY` terminology.
- `Config.ANNOTATIONS_FILE` still points to a JSON file, but current annotation persistence is database-backed through `LabelAnnotation`.

These notes help developers understand historical drifts that are now unified.

## 5. Package topology and responsibilities

The backend is divided into a small set of top-level packages with clear intent, though not always with perfectly uniform abstraction boundaries.

| Package | Role in backend architecture |
|---|---|
| `backend/app.py` | Unified app assembly, global middleware, top-level health/capability routes |
| `backend/dashboard/` | Core Flask application foundation plus dashboard-specific routes and shared services |
| `backend/database/` | Flask extension objects, ORM models, and database package exports |
| `backend/search/` | Search workspace APIs, semantic retrieval orchestration, file utilities, prompts |
| `backend/labelcomp/` | Label comparison orchestration and AI summary caching |
| `backend/drugtox/` | Toxicology-oriented API surface backed primarily by direct SQL queries |
| `backend/device/` | Device intelligence APIs and supporting service clients |
| `backend/localquery/` | Thin local label DB query/export API over shared DB services |
| `backend/webtest/` | Template-driven probing/reporting subsystem with file-backed history/results |
| `backend/admin/tasks/` | Long-running data import scripts invoked by admin routes |
| `backend/migrations/` | Alembic migration environment and version scripts |

One structural point deserves emphasis: `dashboard/` is both a feature namespace and the backend’s shared platform layer. Most of the reusable service logic lives there, even when it supports non-dashboard modules.

## 6. Route and API surface structure

This report is not intended to be a complete endpoint inventory, but the shape of the route surface matters because it reveals how backend responsibilities are concentrated.

### 6.1 Dashboard route families

The dashboard routes carry the broadest scope.

- `auth.py` implements session-oriented identity APIs.
- `main.py` mixes redirect-style routes, upload/import helpers, label view assembly, exports, preferences, and a snippet preview helper.
- `api.py` is the largest single backend route file and acts as a general analytical and application-state API surface.
- `admin.py` owns privileged operations such as user management and import task launches.

At a code-organization level, `dashboard/routes/api.py` is the current backend’s densest integration surface. It handles deep-dive analytics, MedDRA scanning and profiling, AI chat helpers, favorite and project management, label annotations, AE report generation and polling, FAERS access, and DILI/DICT/DIRI/PGx assessment endpoints. That concentration makes it a key candidate for future refactoring, but it also reflects the product’s current center of gravity.

### 6.2 Feature blueprint surfaces

The non-dashboard blueprints are more narrowly scoped.

- `search` contains both general chat/search helpers and the newer semantic streaming path.
- `drugtox` exposes a reporting-style API over curated toxicity tables.
- `labelcomp` exposes comparison generation and summary caching behavior.
- `device` acts as a thin orchestration layer over external device data sources plus LLM comparison.
- `localquery` is a narrow façade over `FDALabelDBService` helpers.
- `webtest` supports validation templates, probing, result persistence, and report generation.

### 6.3 API style diversity

The backend does not use one interaction style consistently. Current route shapes include:

- JSON request/response endpoints,
- form and multipart upload endpoints,
- Excel and file-download endpoints,
- streaming NDJSON responses for semantic search,
- redirect-style routes and mixed browser/API helpers.

This is one reason a future API reference should be organized by module and interaction pattern rather than assuming all endpoints behave like uniform REST resources.

## 7. Shared service-layer architecture

Most backend reuse happens in the dashboard service layer.

### 7.1 `ai_handler.py`: model and embedding orchestration

`backend/dashboard/services/ai_handler.py` is the backend’s inference gateway. It centralizes:

- provider selection,
- client caching,
- text-generation calls,
- embedding generation,
- retry and fallback logic,
- internal-environment detection.

The current provider model supports three main inference modes:

- Gemini via `google-genai`,
- Elsa for internal FDA environments,
- OpenAI-compatible LLM endpoints for Llama-style or other compatible deployments.

Embeddings are abstracted separately and can be served by Gemini, OpenAI-compatible endpoints, or a local `sentence-transformers` model.

Architecturally, this is a strong point in the backend design: most callers do not need to know which provider is active. However, there is also visible drift. User records store `custom_gemini_key`, `openai_api_key`, `openai_base_url`, and `openai_model_name`, and those values are exposed and updated through routes, but the current `AIClientFactory` appears to honor only `user.ai_provider` plus environment-sourced credentials. That gap should be reconciled before the AI configuration model is considered complete.

### 7.2 `fdalabel_db.py`: label database abstraction

`backend/dashboard/services/fdalabel_db.py` is the shared backend abstraction for label-oriented database access. It is used by multiple modules and is one of the most important backend services.

It provides:

- Postgres and optional Oracle connectivity,
- environment availability checks,
- label filtering and search,
- metadata retrieval,
- full XML retrieval,
- local autocomplete and random-label helpers,
- export-oriented query helpers,
- selected metadata breakdown and lookup utilities.

This service deliberately bypasses the ORM in many places and uses raw connections/cursors instead. That is not accidental. It allows one service surface to support both PostgreSQL and Oracle-style access while also targeting the `labeling` schema and its search-oriented structures directly.

### 7.3 `fda_client.py`: external FDA and DailyMed access

`backend/dashboard/services/fda_client.py` sits at the boundary between local label storage and remote services. It:

- prefers local or internal label DB access when available,
- falls back to openFDA for label search and metadata,
- falls back to DailyMed for SPL XML,
- exposes FAERS-related helpers,
- supplies helper logic for label counts and metadata enrichment.

This service is load-bearing because it gives the backend graceful degradation paths. The application can operate against local/internal data when present, but it can still answer many requests through public FDA endpoints when necessary.

### 7.4 `xml_handler.py`: SPL parsing and normalization

`backend/dashboard/services/xml_handler.py` is the core document-processing utility for drug labels. It handles:

- SPL/XML parsing,
- label-format identification,
- recursive section extraction,
- HTML conversion,
- table-of-contents generation,
- metadata extraction,
- section flattening and LOINC-oriented extraction.

This parser is reused across dashboard label views, comparison logic, and several analytical routines. In practical terms, it is the backend’s document normalization layer.

### 7.5 Higher-level analytical services

Three additional services carry higher-level logic rather than low-level access:

- `deep_dive_service.py` orchestrates comparison analysis, peer selection, MedDRA mapping, and discrepancy tiering,
- `meddra_matcher.py` scans label text for MedDRA term matches,
- `pgx_handler.py` performs pharmacogenomic assessment and biomarker matching.

These services illustrate an important architectural trait of the backend: analytical features are implemented as server-side domain logic, not as frontend-side composition over raw data.

## 8. Data-access architecture

The backend uses a hybrid data-access model rather than a single persistence abstraction.

### 8.1 ORM-backed application state

The `backend/database/models.py` file defines the shared ORM model set for:

- identity and collaboration (`User`, `Project`, membership table),
- user-saved content (`Favorite`, `FavoriteComparison`, `LabelAnnotation`),
- analytical caches and reports (`ComparisonSummary`, `ProjectAeReport`, assessment tables),
- reference datasets (MedDRA, PGx, Orange Book, DrugToxicity),
- vector storage (`LabelEmbedding`),
- normalized label data in the `labeling` schema.

These models are accessed through Flask-SQLAlchemy in many dashboard, admin, and comparison workflows.

### 8.2 Raw DB access for label retrieval and search

Despite the presence of ORM models for the `labeling` schema, much label retrieval and filtering work is implemented with raw PostgreSQL or Oracle queries in `FDALabelDBService`. That choice appears intentional for three reasons:

- the service must support two database backends,
- some queries are easier to express at the SQL level,
- several paths rely on search-oriented or schema-specific behavior that is not cleanly centralized in ORM query code.

### 8.3 Direct SQL in specialized modules

Several modules use direct SQL or direct DB connections instead of routing everything through one common abstraction.

Examples include:

- `drugtox/blueprint.py`, which uses SQLAlchemy `text()` queries directly,
- semantic retrieval agents under `search/scripts/semantic_core/`, which open direct psycopg2 connections to PostgreSQL,
- admin task scripts, which bulk insert into tables or operate with explicit schema management logic.

The result is a pragmatic but mixed data-access architecture. It works, but it also means some filtering logic and SQL knowledge are duplicated across modules.

### 8.4 Schema domains

At a high level the backend interacts with two major schema domains:

- the application/reference domain in the default schema,
- the normalized label corpus in the `labeling` schema.

A fuller breakdown belongs in `Database.md`, but backend readers should understand that the server is designed around both domains at once. It is not just storing app state; it is also serving a structured label corpus and derived search indexes.

## 9. Search-specific backend architecture

The search subsystem is important enough to note here even though it deserves its own dedicated document later.

### 9.1 Two search paths coexist

The current backend exposes two conceptually different search paths:

- a simpler conversational/general search path centered on `search_general(...)`,
- a newer semantic agentic path under `search/scripts/semantic_core/`.

This coexistence is visible directly in `backend/search/blueprint.py`, which mixes chat-style routes, refinement helpers, metadata/export helpers, and the semantic streaming endpoint.

### 9.2 Semantic pipeline structure

The semantic path is organized around `AgentState` and a staged controller. The current stages include:

- planner,
- semantic retriever,
- keyword retriever,
- reranker,
- postprocess,
- evidence fetcher,
- answer composer,
- reasoning generator.

The retrievers query PostgreSQL directly, including the `label_embeddings` table and `labeling.sum_spl`, and the final answer is composed through the shared AI layer.

### 9.3 Search architectural drift

The search module contains:
- both legacy-style chat handling and a newer semantic-core pipeline,
- a backend route surface that lines up with the current frontend search calls (with the previous duplicate `POST /api/search/chat` route definitions resolved).

Additionally, the backend database service (`FDALabelDBService.local_search()`) implements a two-priority matching logic for searching labels:
1. **Priority 1: Exact `spl_id` match** — relaxes the `is_latest = TRUE` constraint to retrieve historical/archived versions of a label.
2. **Priority 2: Regular search (text/set_id/approval_no)** — enforces `is_latest = TRUE` to avoid duplicate active/historical results from cluttering search results.

These details provide context for search-specific queries and API validation.

## 10. Execution patterns and long-running work

The backend supports several distinct execution models.

### 10.1 Standard synchronous request/response

Most routes follow conventional synchronous Flask behavior:

1. validate request data,
2. call shared services and/or the database,
3. return JSON or a file response.

This is the dominant pattern for auth, favorites, projects, local query, DrugTox, device metadata, and many dashboard operations.

### 10.2 Streaming NDJSON for semantic search

`/api/search/search_agentic_stream` is the most sophisticated execution path in the current backend.

Its pattern is:

- create an `AgentState`,
- start a background worker thread to run the controller up to answer generation,
- stream status updates from the state trace log as NDJSON,
- stream answer tokens through the shared LLM interface,
- emit a final payload containing results, reasoning, and debug statistics.

This is structurally different from the rest of the backend and should be treated as a first-class streaming workflow, not as an ordinary JSON endpoint.

### 10.3 In-process background threads for AE reports

The AE reporting workflow uses a lighter background strategy.

When a report is generated or reanalyzed:

- a `ProjectAeReport` row is created or reset,
- a Python `threading.Thread` is launched inside the Flask process,
- progress and status are persisted back into the database,
- the frontend polls status endpoints.

This is a deliberate lightweight background-job model. There is no external job queue or worker service in the checked-in architecture.

### 10.4 Subprocess-based admin tasks

Administrative imports use a different nonblocking model.

`/api/dashboard/admin/update_db`:

- creates a `SystemTask` row,
- resolves the correct task script,
- launches a separate Python subprocess,
- redirects stdout/stderr to a log file,
- allows the UI to poll both structured task status and raw logs.

This keeps long-running maintenance work out of the request thread and out of the main process memory path, at the cost of more operational complexity.

### 10.5 Process pools inside import scripts

The label import task adds another layer of concurrency. `admin/tasks/import_labels.py` uses a `ProcessPoolExecutor` to parse ZIP/SPL files in parallel before bulk-inserting metadata, sections, and ingredient maps.

That is an important backend characteristic because it means the maintenance subsystem is not purely serial. It uses multiprocessing internally for throughput-sensitive ingestion work.

## 11. Authentication, authorization, and trust surface

### 11.1 Session model

The backend uses Flask-Login with session cookies rather than token-based auth. `User` records are loaded through the login manager, and the auth blueprint exposes login, logout, registration, password change, and session inspection endpoints.

### 11.2 Authorization style

Authorization is mostly route-local and explicit. Patterns include:

- `@login_required` on user-scoped routes,
- project ownership or membership checks in dashboard APIs,
- `admin_required` wrapper checks for privileged admin operations,
- manual `current_user.is_authenticated` checks in selected routes such as parts of `webtest`.

### 11.3 Mixed-public vs authenticated surfaces

Not all blueprints are protected uniformly. Several read-oriented modules such as device lookup, DrugTox browsing, local query, and parts of search are available without login, while most project-specific and mutation-oriented dashboard flows are protected.

That design may be intentional, but it means the backend should be thought of as a mixed-trust surface rather than an all-private API. In later operational documentation, network exposure and reverse-proxy policy should reflect that distinction.

## 12. File-backed state and runtime artifacts

Although the backend is database-centric in many places, it also relies on a meaningful amount of file-backed state.

Key locations include:

| Location | Purpose |
|---|---|
| `data/uploads/` | Uploaded XML/ZIP inputs and import helper artifacts |
| `data/spl_storage/` | Local SPL ZIP corpus used by import and full-XML retrieval paths |
| `data/logs/tasks/` | Admin task log files |
| `data/downloads/...` | Import-source material such as MedDRA, Orange Book, and DrugTox inputs |
| `backend/webtest/` | Validation templates |
| `backend/webtest/history/` | Historical webtest Excel artifacts |
| `backend/webtest/results/` | Saved JSON results for web validation runs |

This file-backed layer matters because several backend workflows are not reproducible from the database alone. Maintenance, validation, and local document handling all depend on persistent files.

## 13. Operational runtime profile

The backend’s active runtime profile is straightforward but important:

- framework: Flask,
- WSGI server in container: Gunicorn,
- internal port: `8842`,
- health endpoint: `/health`,
- proxy awareness: `ProxyFix`,
- cross-origin policy: CORS enabled for `/api/*`,
- primary persistent dependency: PostgreSQL with `pgvector`,
- optional alternate label source: Oracle/internal FDALabel,
- external live dependencies: openFDA, DailyMed, LLM providers.

The checked-in backend `requirements.txt` also includes packages such as FastAPI and Uvicorn, but the active backend runtime in the current repository is Flask/Gunicorn-based.

## 14. Current implementation observations and cleanup candidates

The following items are not necessarily defects in every environment, but they are important backend realities that should be captured before the documentation set expands.

### 14.1 Dashboard startup mixes migrations and auto-create behavior

The repository includes Alembic migration infrastructure under `backend/migrations/`, but the dashboard factory still calls `db.create_all()` at startup. That creates a mixed migration model in which schema changes may enter through both migration scripts and application boot behavior.

### 14.2 Search route surface cleanup

The `backend/search/blueprint.py` has been cleaned up to remove redundant search/chat styles. Specifically, the duplicate `POST /chat` route declaration has been resolved, leaving `chat_with_ai` as the primary entry point for conversational AI search. Further normalization of the search API surface is ongoing.

### 14.3 Frontend/backend search contract drift exists

The current frontend search workspace references endpoints such as `/api/search/search` and `/api/search/export_xml`, while the backend currently exposes routes such as `/api/search/search_agentic_stream`, `/api/search/filter_data`, and `/api/search/export_excel`. The search UI may still work through compatibility layers or older paths elsewhere, but the route contract is not yet cleanly unified in the codebase.

### 14.4 Oracle configuration naming is inconsistent

As noted earlier, the configuration layer and DB service disagree on the Oracle password key name. This is a concrete backend deployment risk and should be corrected rather than left to convention or undocumented environment-specific workarounds.

### 14.5 AI preference persistence is ahead of AI preference execution

The backend persists user-level provider and credential fields and exposes them through session and preferences endpoints, but current provider selection logic appears to use only `user.ai_provider` plus environment-defined credentials. That means stored per-user keys are not yet clearly part of the active inference path.

### 14.6 Some configuration artifacts appear stale

`ANNOTATIONS_FILE` remains in config despite current database-backed annotation handling. This suggests leftover design history that should either be removed or explicitly documented as deprecated.

## 15. Relationship to companion documents

This backend report should be read together with:

- `Architecture.md` for system-wide request flow and deployment topology,
- `Overview.md` for platform scope and product-level framing.

The next most natural companion documents are:

- `Database.md`, which should document schema layout, migrations, and import flows in detail,
- `AI-and-Search.md`, which should document the semantic-core pipeline, prompts, providers, and grounding model,
- `Operations.md`, which should cover environment variables, container runtime, data mounts, health checks, and maintenance tasks,
- module-specific reports for `drugtox`, `labelcomp`, `device`, `localquery`, and `webtest`.

## 16. Conclusion

The current AskFDALabel backend is a unified Flask platform with a dashboard-centric core and a set of feature blueprints layered around it. Its architecture is already broad: application state, label corpus access, document parsing, AI orchestration, vector retrieval, background processing, and operational imports all live in one server-side codebase.

That breadth is a strength, but it also explains why the backend needs disciplined documentation. The codebase is no longer a single-purpose dashboard API. It is the technical heart of the platform, and later documentation should build from that fact rather than from older, narrower descriptions.
