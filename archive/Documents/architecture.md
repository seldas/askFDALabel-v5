# AskFDALabel Architecture Report

**Document type:** Cross-cutting technical architecture report  
**Status:** Living document  
**Implementation basis:** Current repository contents under `backend/`, `frontend/`, `backend/database/`, `scripts/`, `docker-compose.yml`, and `deploy/nginx/`  
**Boundary:** This report describes the platform’s runtime architecture, component boundaries, request flow, deployment topology, data-layer organization, and current architectural caveats. It is intentionally broader than a module deep dive and intentionally narrower than a full endpoint-by-endpoint reference.

## Abstract

AskFDALabel is implemented as a modular monolith rather than a collection of separately deployed services. The running system consists of a single Next.js frontend, a unified Flask backend assembled from multiple blueprints, a shared PostgreSQL database with both relational and vector-search responsibilities, and a set of operational scripts that extend the effective system boundary beyond the web processes. The architecture is organized around a shared regulatory-labeling core, but it now serves several distinct capability domains: search, dashboard-based review, structured comparison, toxicology analysis, device intelligence, local database query, and validation tooling.

At runtime, the system uses two external-facing path spaces. The user interface is served under `/askfdalabel`, while API traffic is intended to enter through `/askfdalabel_api` when deployed behind the checked-in nginx proxy. In local development, the same frontend can also reach the backend through the Next.js `/api/*` rewrite path. This dual-path model is one of the defining implementation characteristics of the current codebase and explains several configuration and routing decisions visible in both the frontend and backend.

The backend is architecturally unified even though the feature set is broad. The dashboard package provides the base Flask application, database integration, authentication, and much of the shared service layer. Additional feature areas are attached as blueprints by `backend/app.py`. As a result, the platform behaves operationally like one application with internal feature domains, not as independently scaled microservices. Concurrency exists, but it is lightweight and in-process: background threads are used for AE report generation and for search orchestration, while administrative refresh jobs are launched as subprocesses from the web tier.

This document records that actual implementation structure and highlights several areas where the live code has drifted from older design notes or from adjacent parts of the stack. Those drift points matter because they affect how the platform should be documented, deployed, and evolved.

## 1. Architectural position and design model

The current repository implements a **single-suite architecture** with the following characteristics:

- **Single browser-facing web application:** one Next.js application under `frontend/app/`
- **Single backend process model:** one Flask application assembled from multiple blueprints
- **Shared persistence tier:** PostgreSQL stores both application state and label/search data, with `pgvector` used for semantic retrieval
- **Optional alternate label source:** Oracle/internal FDALabel connectivity may substitute for some label-query paths
- **Shared AI abstraction layer:** model selection and invocation are centralized under `backend/dashboard/services/ai_handler.py`
- **Hybrid operational surface:** some critical functions run through HTTP endpoints, while others run through standalone scripts or admin-launched subprocesses

This design makes the suite comparatively easy to reason about as a platform: all feature modules share identity, configuration, storage, and core service abstractions. The tradeoff is that architectural drift in one area can propagate across the entire system if route conventions, environment variables, or database assumptions are not kept synchronized.

## 2. System context and deployment topology

### 2.1 Primary deployment model

The checked-in deployment layout assumes a reverse proxy in front of the web tier.

```text
Browser
  |
  |  /askfdalabel/*
  v
nginx  ----------------------------->  Next.js frontend (port 8841)
  |
  |  /askfdalabel_api/*  -> rewrite -> /api/*
  v
Flask backend (port 8842)
  |
  +--> PostgreSQL / pgvector
  +--> Optional Oracle FDALabel
  +--> openFDA / DailyMed
  +--> AI providers (Gemini, Elsa, OpenAI-compatible LLM)
  +--> Local runtime files under /data
```

The runtime behavior comes from three pieces working together:

1. `docker-compose.yml` starts `db`, `backend`, and `frontend` as internal services on a shared Docker network.  
2. `deploy/nginx/default.conf` publishes the system under `/askfdalabel` and `/askfdalabel_api`.  
3. `backend/app.py` uses `ProxyFix`, allowing the backend to respect forwarded host/protocol/prefix headers from nginx.

### 2.2 Local development model

The frontend can also run without nginx. In that mode:

- Next.js keeps its own base path, usually `/askfdalabel`
- `frontend/next.config.ts` rewrites `/api/:path*` to the backend URL defined by `BACKEND_URL` or `HOST` and `BACKEND_PORT`
- `frontend/app/FetchPrefix.tsx` rewrites relative links and fetches so that UI navigation and API requests continue to work under prefixed deployment modes

This local mode is functional and aligns architecturally with the nginx pathing model. By using consistent base-path variables and Next.js rewrites that account for the proxied `/askfdalabel_api` path, the system maintains a coherent end-to-end runtime shape across all environments.

## 3. Runtime component model

### 3.1 Frontend runtime

The frontend is a **single Next.js App Router application** rooted at `frontend/app/`. Its cross-cutting runtime services are concentrated in a few files:

| File | Architectural role |
|---|---|
| `frontend/app/layout.tsx` | Global page shell; installs `UserProvider`, `FetchPrefix`, and auth modal infrastructure |
| `frontend/app/context/UserContext.tsx` | Session bootstrap, task polling, and user-level AI preference state |
| `frontend/app/FetchPrefix.tsx` | Runtime path rewriting for anchors, assets, `fetch`, and `window.open` |
| `frontend/app/utils/appPaths.ts` | Centralized app, dashboard, and API base-path constants |
| `frontend/next.config.ts` | Next.js base path, asset prefix, and `/api/*` rewrite configuration |

The frontend is therefore not just a page collection. It contains a deployment-aware client-side routing adapter (`FetchPrefix`) that compensates for the fact that the suite can run with or without a reverse proxy and with different path prefixes.

### 3.2 Backend runtime

The backend is a **unified Flask application** composed in two stages:

| File | Architectural role |
|---|---|
| `backend/dashboard/__init__.py` | Base Flask app factory; loads config, initializes DB/auth/migrations, registers dashboard blueprints |
| `backend/app.py` | Wraps the dashboard app into the full suite, applies `ProxyFix`, enables CORS, and registers non-dashboard blueprints |

This two-stage composition matters. The dashboard package is not merely one feature module among many; it acts as the backend foundation. Search, DrugTox, label comparison, device, local query, and webtest are then attached to that foundation as additional blueprints.

### 3.3 Shared storage and file runtime

The platform uses both database-backed persistence and file-backed runtime storage:

- PostgreSQL for users, projects, saved artifacts, MedDRA, PGx, DrugTox, embeddings, and label data
- `/data` for uploads, SPL storage, generated logs, and other runtime files
- `backend/webtest/history/` and `backend/webtest/results/` for validation artifacts

As a result, the architectural boundary of the application is broader than “frontend + backend + database.” Runtime directories and script-driven refresh flows are part of normal operation.

## 4. Backend blueprint map and ownership

The unified Flask app registers the following blueprint groups.

| Blueprint area | Prefix | Primary responsibility |
|---|---|---|
| Dashboard auth | `/api/dashboard/auth` | Login, registration, logout, password change, session inspection |
| Dashboard main | `/api/dashboard` | Label import/upload, label detail retrieval, search helper pages, project export and project-level views |
| Dashboard API | `/api/dashboard` | Deep-dive analysis, AI chat/search assistance, favorites/projects, annotations, FAERS, AE report workflows, PGx/DILI/DICT/DIRI endpoints |
| Dashboard admin | `/api/dashboard/admin` | User administration and database refresh task orchestration |
| Search | `/api/search` | Search chat, refinement, semantic/agentic search orchestration, metadata fetch, export helpers |
| DrugTox | `/api/drugtox` | Toxicity dataset statistics, drill-down, discrepancy analysis, company and market views |
| Label comparison | `/api/labelcomp` | Multi-label comparison and AI summarization |
| Device | `/api/device` | Device metadata, MAUDE/recall lookup, IFU comparison |
| Local query | `/api/localquery` | Lightweight direct query and export against the local label database |
| Webtest | `/api/webtest` | Template-driven validation/probing workflows and result persistence |
| App-level routes | `/health`, `/api/check-fdalabel` | Health status and environment capability detection |

The architectural consequence is that the backend is **functionally segmented but operationally unified**. There is one process, one config surface, one authentication model, and one database extension layer.

## 5. Frontend page map and interaction domains

The frontend page structure mirrors the backend’s feature segmentation, but all pages are hosted inside one application shell.

| Route | Page role | Primary backend dependency |
|---|---|---|
| `/` | Landing page and top-level search/navigation entry | Session, project listing, environment detection |
| `/search` | Search workspace | Search blueprint and selected dashboard helpers |
| `/dashboard` | Project-based review workspace | Dashboard main/API/auth endpoints |
| `/dashboard/label/[setId]` | Label analysis and detail workspace | Dashboard label, deep-dive, FAERS, MedDRA, assessment endpoints |
| `/dashboard/ae-report/[reportId]` | AE report detail view | Dashboard AE report endpoints |
| `/labelcomp` | Multi-label comparison workspace | Label comparison blueprint plus dashboard project/favorite endpoints |
| `/drugtox` | Toxicology intelligence workspace | DrugTox blueprint |
| `/device` | Device intelligence workspace | Device blueprint |
| `/localquery` | Direct local DB search/export workspace | Local query blueprint |
| `/webtest` | Validation and probing workspace | Webtest blueprint |
| `/management` | Admin operations page | Dashboard admin endpoints |
| `/snippet` | Snippet helper/bookmarklet page | Static and convenience utilities |

The architecture is therefore **domain-aggregated at the UI level**: one navigation shell, one session model, multiple feature workspaces.

## 6. Data architecture

### 6.1 Application-state domain (`public` schema)

The `backend/database/models.py` file shows that the public schema carries several distinct classes of data:

- **Identity and collaboration:** `User`, `Project`, project membership table, `Favorite`, `FavoriteComparison`, `LabelAnnotation`
- **Analysis outputs and caches:** `ComparisonSummary`, `DiliAssessment`, `DictAssessment`, `DiriAssessment`, `PgxAssessment`, `AeAiAssessment`
- **Workflow state:** `ProjectAeReport`, `ProjectAeReportDetail`, `SystemTask` (includes user/project ownership, progress, status, and JSON result data)
- **Reference and enrichment data:** `DrugToxicity`, MedDRA tables, PGx biomarker/synonym tables, `OrangeBook`
- **Vector search layer:** `LabelEmbedding`

This is not a thin application metadata database. It is the platform’s core knowledge store for both user workflows and derived analytical outputs.

### 6.2 Label database domain (`labeling` schema)

The `labeling` schema forms the structured-label substrate used across multiple features.

| `labeling.sum_spl` / `DrugLabel` | Label-level metadata and indexing fields |
| `labeling.spl_sections` / `LabelSection` | Section-level SPL content |
| `labeling.active_ingredients_map` / `ActiveIngredientMap` | Active/inactive ingredient mapping including UNII |
| `labeling.epc_map` | High-quality link between labels and pharmacologic classes |
| `labeling.substance_indexing` | Master mapping between substances (UNII/Name) and EPC/MoA |

This schema is used by local query, dashboard retrieval, comparison, and semantic search preparation.
 It is also the source of full-text and vector-search supporting operations.

### 6.3 Vector-search domain

`LabelEmbedding` stores chunk-level embeddings with 768-dimensional vectors. The supporting scripts in `scripts/ai/` show that embedding generation, vector extension checks, and HNSW index creation are treated as explicit operational tasks rather than hidden startup behavior.

### 6.4 External and alternate sources

The application is not purely database-backed. It also depends on:

- `openFDA` for adverse-event and device data
- `DailyMed` for SPL XML fallback retrieval
- optional Oracle/internal FDALabel access through `FDALabelDBService`
- AI providers for summarization, comparison, search planning, and assessment generation

This creates a **hybrid data architecture** in which PostgreSQL is the primary working store, but some request paths still depend on remote live services.

## 7. Core service-layer architecture

The backend service layer is concentrated under `backend/dashboard/services/` and is reused by multiple blueprints.

| Service | Architectural role |
|---|---|
| `ai_handler.py` | Shared model-provider abstraction for LLM and embedding calls |
| `fdalabel_db.py` | Data-access abstraction for PostgreSQL and optional Oracle label retrieval/search |
| `fda_client.py` | External FDA/openFDA/DailyMed access layer |
| `xml_handler.py` | SPL XML parsing, normalization, and section extraction |
| `deep_dive_service.py` | Higher-level deep-dive analysis orchestration |
| `pgx_handler.py` | PGx-specific assessment and biomarker matching logic |
| `meddra_matcher.py` | Label-to-MedDRA scanning support |
| `task_service.py` | Centralized task creation, status tracking, and background thread orchestration |

### 7.1 Deep Dive Peer Sampling Logic

The "Deep Dive" feature (implemented in `deep_dive_service.py`) utilizes a multi-tier sampling strategy to identify relevant peer labels for signal anomaly analysis. The sampling logic prioritizes high-confidence links:

1.  **UNII-based Class Expansion (Deep Link):** The system maps the target label's active ingredient UNIIs to Established Pharmacologic Classes (EPC) using the `substance_indexing` table. It then identifies all other substances sharing those EPCs and finds labels containing them. This is the highest-confidence method for identifying pharmacological peers.
2.  **Generic Name Matching:** Direct matches on the generic drug names.
3.  **EPC String Matching:** Broad substring matching on the EPC text fields in the label metadata.

The sampling process collects up to 25 unique labels, prioritizing RLDs and matching label formats (e.g., PLR vs non-PLR) to ensure a statistically relevant and balanced peer group.

This layer is one of the most important architectural stabilizers in the codebase. Even though features are spread across several blueprints, they converge on a smaller set of shared services.

## 8. AI and semantic retrieval architecture

### 8.1 Provider abstraction

`backend/dashboard/services/ai_handler.py` centralizes provider selection and invocation. The current implementation supports three primary inference modes:

- **Gemini** via `google-genai`
- **Elsa** for internal FDA environments
- **OpenAI-compatible LLM endpoints** for internal or local Llama-style deployments

Embeddings are abstracted separately from text generation and can be served by:

- a local `sentence-transformers` model when `EMBEDDING_PROVIDER=local`
- Gemini embeddings
- OpenAI-compatible embedding endpoints

This is architecturally significant because it means the rest of the application mostly does not need to know which model backend is active. The provider decision is pushed to a common service boundary.

### 8.2 Search execution model

The current search stack is split between a general chat-style path and a semantic agent pipeline:

- `search_general(...)` supports a direct conversational response path
- `backend/search/scripts/semantic_core/` implements a staged semantic retrieval pipeline

The semantic pipeline is organized around `AgentState` and the controller in `semantic_core/controller.py`. The current agent stages are:

1. planner  
2. semantic retriever  
3. keyword retriever  
4. reranker  
5. evidence fetcher  
6. answer composer  
7. postprocessing and reasoning generation

The architecture here is not a general agent framework with dynamic tools. It is a fixed pipeline with explicit intermediate state containers for intent, retrieval, evidence, answer, debugging metadata, and trace logs.

### 8.3 Streaming pattern

`/api/search/search_agentic_stream` uses a hybrid execution model:

- a background worker thread runs the controller up to, but not including, final answer composition
- trace lines are streamed back to the client as NDJSON status events
- the final answer tokens are streamed separately
- a final payload returns results, reasoning, and debug state

This is one of the suite’s most advanced runtime patterns. It gives the search subsystem a different execution shape from the rest of the backend, which is mostly request/response JSON.

## 9. Request and execution patterns

### 9.1 Standard synchronous JSON flow

Many feature modules follow a conventional browser-to-API JSON pattern:

```text
Frontend page/component
  -> fetch('/api/...')
  -> Flask blueprint route
  -> service layer and/or database query
  -> JSON response
  -> client-side rendering
```

This is the dominant pattern for local query, device search, much of DrugTox, session management, project CRUD, and several dashboard APIs.

### 9.2 Label retrieval and review flow

A common dashboard pattern is:

1. fetch label metadata from PostgreSQL or fallback services  
2. retrieve XML content  
3. parse SPL sections via `xml_handler.py`  
4. attach derived analyses such as MedDRA, FAERS, or AI-generated content  
5. render the assembled view in the dashboard label page

This shows that the dashboard is architecturally a composition layer, not merely a thin UI on top of a single table.

### 9.3 Search orchestration flow

The semantic search path is structurally different:

1. user query enters the search workspace  
2. backend constructs `AgentState`  
3. planner and retrievers populate retrieval candidates  
4. evidence snippets are prepared from label content  
5. answer generation occurs through the shared AI provider layer  
6. reasoning/debug payloads are returned alongside results

### 9.4 Unified Background Task Strategy

The application uses a centralized **`TaskService`** and a shared **`SystemTask`** model to manage both user-triggered background work and administrative operations. This provides a consistent status, progress, and result-tracking mechanism across the platform.

The system supports two execution strategies behind a common service interface:

1.  **In-process threads:** Used for interactive, user-scoped work like AE report generation or complex AI summarizations. These tasks are launched via `TaskService.start_background_task`, which manages the application context and error handling.
2.  **External subprocesses:** Used for heavy operational maintenance (e.g., importing labeling data, Orange Book, or MedDRA). These are launched as standalone Python processes but report progress back to the same `SystemTask` record, allowing the frontend to track them uniformly.

The workflow for any non-blocking task follows this pattern:
1.  The request creates a `SystemTask` record via `TaskService.create_task`.
2.  The task is launched (as a thread or subprocess).
3.  The backend persists progress (0-100), status messages, and optional JSON `result_data` in the database.
4.  The frontend polls the unified `/api/dashboard/tasks/active` endpoint via the `UserContext` and displays progress globally.

This unified approach removes the architectural distinction between "interactive analysis" and "system maintenance," making the platform easier to monitor and scale.

## 10. Session, identity, and authorization model

The identity model is centralized and shared across the suite.

- Flask-Login manages backend user sessions
- `User` stores username, password hash, admin flag, and AI preference settings
- `auth.py` exposes login, registration, logout, change-password, and session inspection routes
- `frontend/app/context/UserContext.tsx` bootstraps the current session and exposes it to the client tree
- admin-only operations are protected by `login_required` plus an `admin_required` decorator

Architecturally, there is no separate API token layer or independently authenticated microservice boundary. Authentication is suite-wide and cookie-session based.

## 11. Startup and lifecycle behavior

The suite does more on startup than simply instantiate web routes.

Inside `backend/dashboard/__init__.py`, application startup includes:

- database extension initialization
- Flask-Migrate initialization
- `db.create_all()`
- project migration logic to normalize each user’s “Favorite” project
- a MedDRA population check that warns when reference tables are empty

This is an important architectural characteristic. Startup mixes **framework initialization**, **schema creation**, and **data normalization**. That is convenient for a single-stack deployment, but it also means startup behavior has side effects that should be documented and handled carefully in production and testing.

## 12. Routing and path-prefix architecture

The suite’s pathing model is more complex than a default Next.js + Flask pairing.

### 12.1 Intended public paths

| Public path | Intended owner |
|---|---|
| `/askfdalabel/*` | Next.js frontend |
| `/askfdalabel_api/*` | nginx-to-Flask proxy |
| `/api/*` | Flask internal route space and local-dev rewrite target |

### 12.2 Frontend path management

The frontend uses several mechanisms to survive deployment under a subpath:

- `basePath` and `assetPrefix` in `next.config.ts`
- `APP_BASE`, `API_BASE`, and `DASHBOARD_BASE` in `appPaths.ts`
- runtime rewriting of anchors, media sources, and `fetch()` calls in `FetchPrefix.tsx`

This path-rewriting layer is not optional convenience code. It is part of the suite’s deployment architecture.

### 12.3 Practical consequence

The standardization of path-prefix handling ensures that the application behaves consistently across different deployment environments. By centralizing path logic in `appPaths.ts` and `FetchPrefix.tsx`, the suite maintains a stable reference runtime whether accessed directly during development or through the nginx proxy in production.

## 13. Operational surface outside the web tier

The `scripts/` directory and `backend/admin/tasks/` folder show that maintenance and ingestion are not peripheral concerns. They are part of the platform architecture.

Key architectural responsibilities outside the request path include:

- **Database Initialization and Maintenance:** Centralized in `backend/database/scripts/` with a sequential, idempotent bootstrap flow (db_01 through db_07).
- **Label Data Ingestion:** Handled by `backend/database/scripts/db_07_import_labels.py` and the admin label import task.
- **Enrichment Ingestion:** Importing MedDRA, PGx, DrugTox, Orange Book, and EPC Indexing metadata.
- **AI Readiness:** Generating and indexing embeddings for semantic search.

This broader operational surface is why later documentation should treat operations and data refresh as first-class technical topics rather than as appendices.

## 14. Observed architectural caveats and drift points

The live code reveals several issues that should be documented explicitly rather than hidden behind an idealized architecture description.

### 14.1 Legacy documentation drift

Older notes in `idea/` refer to search paths such as `search_v2_core`, but the current implementation uses `backend/search/scripts/semantic_core/`. That older material is useful as historical context, but not as the architectural source of truth.

### 14.2 Resolved search chat route definitions

The previous duplication of two separate `POST /chat` handlers in `backend/search/blueprint.py` has been resolved. The `/chat` endpoint is now consolidated and cleanly routes to search_general, eliminating the previous handler ambiguity.

### 14.3 Frontend-to-backend route mismatch in search

The checked-in frontend search results code references endpoints such as `/api/search/search` and `/api/search/export_xml`, but the current backend route map does not expose matching handlers. That suggests either an incomplete migration or partially retired UI behavior. This should be reconciled before treating the search workspace as fully coherent from an architectural standpoint.

### 14.4 Unified Oracle configuration parameters

The previously documented naming mismatch between `FDALabel_PASSWORD` and `FDALabel_PSW` has been resolved. The configuration layer now maps older key layouts (like `FDALabel_SERV`, `FDALabel_APP`, `FDALabel_PSW`) to newer ones, and `FDALabelDBService.get_connection()` accepts both forms dynamically.

### 14.5 Standardized path-prefix handling

The system now consistently supports multiple pathing strategies through standardized `withAppBase` and `withApiBase` utilities and centralized configuration in `next.config.ts`. This normalization ensures that both local development and proxied nginx deployments work identically without requiring manual route adjustments in individual modules.

### 14.6 Mixed maturity in the search workspace

The backend includes a substantial semantic agent pipeline with trace, reasoning, and streaming support, while the checked-in search page still appears primarily wired to the simpler `/api/search/chat` path. This suggests that the search subsystem is in a transitional state between a simpler conversational mode and a richer streamed agentic mode.

### 14.7 Consolidation of Database Management Scripts

The project has transitioned from fragmented root database scripts folders (`scripts/database/` and `scripts/db_init/`) to a single, consolidated, sequential, and idempotent initialization flow located inside the backend package at `backend/database/scripts/`. This is the authoritative source for database environment setup and schema maintenance.

## 15. Boundaries for companion documentation

This architecture report is the bridge between the high-level overview and the deeper implementation documents. The intended handoff is:

| Companion document | Expected follow-on scope |
|---|---|
| [`Documents/backend.md`](./backend.md) | Blueprint internals, route ownership, service contracts, background execution details |
| [`Documents/database.md`](./database.md) | Schema inventory, migrations, initialization, import/update workflows |
| [`Documents/AI-and-Search.md`](./AI-and-Search.md) | Provider abstraction, semantic pipeline internals, evidence composition, current search drift |
| [`Documents/Operations.md`](./Operations.md) | Docker/nginx deployment, environment variables, maintenance jobs, troubleshooting |
| [`Documents/FDA_autotest.md`](./FDA_autotest.md) | Web validation workflows, test assets, manual and automated checks |

The architectural rule for the documentation set should be simple: this document explains **how the platform is put together**, while later documents explain **how each part works in detail**.

## 16. Summary

The current AskFDALabel codebase is best understood as a modular monolith with a shared regulatory-labeling core. Its architecture is anchored by a single Next.js frontend, a unified Flask backend, a shared PostgreSQL plus `pgvector` persistence tier, optional Oracle/internal label access, and a script-driven operational layer that keeps reference data and derived artifacts current. The backend is not split into separately deployed services; instead, it is segmented internally by blueprint and service boundaries. The frontend follows the same pattern, presenting multiple domain workspaces inside one deployment-aware application shell.

The most important architectural conclusion is that the suite should be documented as a platform with shared infrastructure and distinct capability domains, not as a single dashboard or a single search interface. The second conclusion is that the current code contains meaningful drift in routing, search wiring, and environment assumptions, so the live implementation must remain the authority while the documentation set is refreshed.
