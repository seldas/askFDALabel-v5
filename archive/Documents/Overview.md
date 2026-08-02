# AskFDALabel Suite Overview

**Document type:** Technical overview  
**Status:** Living document  
**Implementation basis:** Current repository contents under `frontend/`, `backend/`, `backend/database/`, `scripts/`, `docker-compose.yml`, and `deploy/nginx/`  
**Boundary:** This report is intentionally architecture-level. It describes system purpose, composition, operating model, data domains, and documentation boundaries. It does **not** serve as the endpoint reference, module deep dive, or deployment runbook.

## Abstract

AskFDALabel is a unified labeling-intelligence platform built around FDA structured product labeling and adjacent regulatory datasets. The current implementation combines a Next.js frontend, a Flask-based multi-blueprint backend, PostgreSQL with `pgvector`, optional Oracle/internal FDALabel connectivity, and a collection of ingestion and maintenance scripts. The system is not a single-purpose search page or a narrow adverse-event dashboard. It is a broader working environment for label discovery, project-based review, structured comparison, AI-assisted analysis, toxicology and pharmacogenomics lookups, device-related intelligence, administrative maintenance, and regression-style web validation.

At a technical level, the suite blends three styles of computation. First, it supports deterministic data retrieval and transformation from structured sources such as SPL XML, PostgreSQL tables, and openFDA APIs. Second, it supports project-centric application workflows such as saved labels, saved comparisons, user accounts, annotations, and asynchronous administrative tasks. Third, it overlays grounded AI capabilities for summarization, comparison, retrieval augmentation, and explanation, with model selection abstracted behind a shared backend service layer.

## 1. Scope and intent

The suite is designed to support labeling-centered analysis rather than generic document management. Its core subject matter is drug labeling, but the implementation has expanded to include supporting knowledge domains that help interpret or contextualize labeling content: MedDRA terminology, FAERS-oriented adverse-event analysis, pharmacogenomic biomarkers, toxicity datasets, Orange Book reference information, and selected device data from openFDA.

The current codebase indicates two primary usage modes. The first is an interactive review mode, where a user searches for labels, inspects content, saves items into projects, compares labels, requests AI summaries, and exports results. The second is a maintenance and enrichment mode, where administrators or developers populate and update local data stores, generate embeddings, synchronize imported datasets, and validate behavior against web-facing FDALabel endpoints.

This overview deliberately avoids detailed discussion of each user-facing application surface. Those belong in the companion technical documents listed later in this report.

## 2. Source-of-truth boundaries

This report is based on the implementation currently checked into the repository, with the running system centered on:

- `backend/app.py`, which assembles the unified Flask application
- `backend/dashboard/__init__.py`, which creates the base dashboard application and initializes extensions
- `backend/database/models.py`, which defines the shared data model across application and labeling domains
- `frontend/app/`, which contains the Next.js app-router UI surfaces
- `scripts/` and `backend/admin/tasks/`, which provide import, migration, embedding, and maintenance workflows
- `docker-compose.yml` and `deploy/nginx/`, which define the containerized runtime topology

Older material under `idea/` should be treated as historical design context rather than authoritative implementation documentation. Some of it remains conceptually useful, but it no longer reliably describes the current file layout, route organization, or module boundaries.

## 3. System composition

The present system is organized as a layered application rather than a collection of disconnected tools.

| Layer | Current implementation | Role in the system |
|---|---|---|
| Presentation layer | Next.js 16 app-router application under `frontend/app/` | Browser-facing user experience, page routing, client-side state, and API consumption |
| Application layer | Unified Flask runtime assembled in `backend/app.py` | Hosts shared dashboard services plus additional domain blueprints for search, toxicology, device intelligence, local query, label comparison, and web validation |
| Shared service layer | `backend/dashboard/services/` plus module-specific services | Encapsulates AI access, XML parsing, label retrieval, MedDRA matching, PGx assessment, deep-dive analysis, TaskService for background orchestration, and external API calls |
| Persistence layer | PostgreSQL, `pgvector`, SQLAlchemy models, Alembic migrations | Stores application state, analytical datasets, labeling content, embeddings, and task metadata |
| File-backed runtime state | `data/`, uploaded files, `spl_storage`, `backend/webtest/history`, `backend/webtest/results` | Supports imports, uploaded SPL material, local storage, validation history, and generated results |
| Integration layer | openFDA, DailyMed/SPL files, Orange Book, MedDRA, PGx inputs, optional Oracle/internal FDALabel, LLM providers | Supplies external or semi-external data needed for search, enrichment, analysis, and validation |

The unifying pattern is that the dashboard application is used as the base Flask app and then extended by additional blueprints. This means the suite shares authentication, configuration, database initialization, and a common service environment, even when the user perceives the system as multiple separate modules.

## 4. Runtime architecture and operating model

### 4.1 Unified backend assembly

The backend is assembled in two stages. `backend/dashboard/__init__.py` creates the core Flask application, initializes SQLAlchemy, Alembic, and Flask-Login, registers dashboard-related blueprints, and ensures baseline application directories exist. `backend/app.py` then treats that dashboard app as the base runtime and attaches additional blueprints for search, DrugTox, label comparison, device intelligence, local query, and web validation. In effect, the dashboard is not just one feature area; it is also the application foundation.

### 4.2 Frontend-to-backend request flow

The frontend is implemented as a Next.js application with app-router pages under `frontend/app/`. In the simplest local form, frontend requests target `/api/*`, which is rewritten by Next.js to the Flask backend. In the deployment-oriented form, nginx exposes the UI under `/askfdalabel/` and API traffic under `/askfdalabel_api/`.

A notable implementation characteristic of the current codebase is that both path conventions are still visible in the repository. The backend itself registers routes under `/api/*`, while frontend runtime helpers also support a prefixed deployment path. This is not a blocker for documentation, but it is important architectural context: production-like behavior is most reliably exercised through the nginx deployment layer, which standardizes the path prefixes.

### 4.3 Workload patterns

The codebase supports several workload types:

1. **Interactive transactional requests**, such as searching, retrieving label metadata, saving project items, and requesting AI summaries.
2. **Analytical retrieval flows**, particularly in semantic search, where a request can pass through planning, retrieval, reranking, evidence collection, answer composition, and reasoning generation.
3. **Background-style maintenance tasks**, where administrative actions launch import/update scripts and track progress in the `system_tasks` table.
4. **File-oriented workflows**, such as SPL uploads, Excel import/export, and web validation templates and result histories.

These patterns coexist within a single application runtime, which is why the suite should be documented as a platform rather than a single web app.

## 5. Functional domain map

The most useful high-level view of AskFDALabel is by domain responsibility rather than by page name.

### 5.1 Labeling intelligence domain

This is the core domain of the system. It includes label discovery, metadata retrieval, SPL XML parsing, label detail views, local label uploads, section extraction, project-based organization, annotations, export flows, and saved comparisons. Much of this capability is anchored in the dashboard services and in the `labeling` schema tables that store normalized label metadata and sections.

### 5.2 Analytical augmentation domain

This domain overlays interpretive and comparative logic on top of the core label corpus. It includes semantic search, grounded answer generation, AI comparison summaries, deep-dive analyses, MedDRA scanning, FAERS-oriented adverse-event workflows, and cached assessment artifacts. The important architectural point is that these features combine deterministic retrieval with AI-assisted interpretation rather than relying on free-form generation alone.

### 5.3 Toxicology and pharmacology domain

The suite includes a set of supporting knowledge services for labeling interpretation. These include DrugTox data, DILI/DICT/DIRI assessments, PGx biomarker assessment, Orange Book reference information, and toxicity-oriented report storage. These are implemented as first-class backend models and routes rather than external add-ons, which means they participate in the same database and application lifecycle as the rest of the platform.

### 5.4 Device intelligence domain

In addition to drug-label work, the platform contains a device-oriented intelligence surface built on openFDA device endpoints. This extends the system into a neighboring regulatory domain and gives the suite a mixed drug/device profile. From an architectural standpoint, this matters because it introduces a second major external data family with distinct entity types, query patterns, and safety-event summaries.

### 5.5 Administration, validation, and utility domain

The repository also contains operational and support capabilities: user management, import/update tasks, local query/export utilities, bookmarklet/snippet helpers, and a dedicated web validation module that uses Excel templates and history tracking. These features are essential for operating and verifying the suite, even though they are not the headline analytical surfaces.

## 6. Data estate and information model

The platform operates across several distinct data layers.

### 6.1 Application state in the public schema

The public schema stores user-facing and analytical application state. Current models include users, projects, favorites, saved comparisons, label annotations, comparison summaries, toxicology assessments, FAERS-related report tables, PGx tables, MedDRA hierarchy tables, Orange Book content, embedding rows, cached AI outputs, and system task tracking.

This data is not merely supporting metadata. It represents a substantial portion of the system’s business state: who can log in, what they have saved, which analytical results are cached, what dictionaries are available, and which maintenance tasks are in progress.

### 6.2 Labeling corpus in the `labeling` schema

The structured label corpus lives primarily in the `labeling` schema, with the main entities represented by:

- `labeling.sum_spl` for label-level metadata
- `labeling.spl_sections` for section-level XML/text storage
- `labeling.active_ingredients_map` for ingredient-level extraction

These tables act as the normalized local representation of the SPL corpus and provide the foundation for local querying, label detail rendering, comparison, deep-dive logic, and embedding generation.

### 6.3 Vector and retrieval data

Semantic retrieval is supported by the `label_embeddings` table using `pgvector`. The embedding layer exists alongside, not instead of, the structured labeling tables. That separation is important: vector search augments search and answer composition, but authoritative label content still comes from the structured corpus and XML-derived sections.

### 6.4 File-backed data assets

Several workflows depend on data outside the relational tables. The `data/` hierarchy stores uploads, downloaded source files, and SPL storage used by importers. The web validation module stores template histories and generated result files on disk. This means the operational state of the system is partly database-backed and partly file-backed.

## 7. AI and retrieval posture

AskFDALabel uses AI as an application capability, not as the sole system substrate. The shared AI access layer in `backend/dashboard/services/ai_handler.py` abstracts model selection and supports multiple provider modes, including Google Gemini, OpenAI-compatible endpoints, and internal/FDA-oriented integrations such as Elsa and LLM endpoints when configured.

The current repository shows two distinct AI usage patterns.

The first pattern is **embedded assistance inside domain workflows**, such as dashboard chat, label comparison summaries, toxicity or PGx assessment generation, and device IFU analysis. In this mode, AI is called from a domain-specific route or service and operates on already retrieved context.

The second pattern is **agentic retrieval and answer composition**, especially in the search subsystem. The semantic search stack under `backend/search/scripts/semantic_core/` follows a staged controller-driven flow that includes planning, keyword and semantic retrieval, reranking, post-processing, evidence fetching, answer composition, and reasoning generation. The repository also includes a streaming search mode that emits intermediate status lines and then streams answer tokens before returning a final payload.

Architecturally, the most important conclusion is that the platform is attempting grounded AI behavior. Label text, database content, evidence snippets, and deterministic retrieval stages remain central; the LLM is layered on top as a reasoning and composition component.

## 8. External dependencies and source systems

The suite depends on a mixed ecosystem of internal, local, and public sources.

| Source family | Current role |
|---|---|
| DailyMed / SPL ZIP content | Supplies structured label source material for local ingestion and section extraction |
| openFDA drug and device APIs | Supports FAERS-oriented queries, device search, MAUDE summaries, and enforcement/recall lookups |
| Orange Book data | Supports RLD/RS mapping and reference-product context |
| MedDRA inputs | Populate the terminology hierarchy used for label scanning and adverse-event grouping |
| PGx source files | Populate biomarker and synonym tables used by pharmacogenomic assessment |
| DrugTox source files | Populate harmonized toxicity datasets and change/history views |
| Optional Oracle/internal FDALabel connectivity | Enables internal-mode label access through `FDALabelDBService` when configured |
| LLM providers | Supply summarization, retrieval augmentation, and assessment-generation capabilities |

The practical result is that AskFDALabel should be understood as an integration platform around labeling intelligence, not simply a standalone database application.

## 9. Deployment contexts

The repository supports more than one operating context.

### 9.1 Local development context

In local development, the frontend and backend can be started separately, with Next.js rewriting `/api/*` traffic to the Flask backend. PostgreSQL remains the primary database, and local file storage under `data/` provides uploads and imported assets.

### 9.2 Containerized suite context

The checked-in root `docker-compose.yml` defines a three-service core stack: PostgreSQL with `pgvector`, Flask backend, and Next.js frontend. The backend and frontend are exposed internally within Docker, and an additional nginx deployment layer provides a more production-like host-facing entry path.

### 9.3 Reverse-proxy deployment context

The deployment assets under `deploy/nginx/` provide the cleanest path-prefix normalization for the current codebase. The UI is intended to be served under `/askfdalabel/`, while API traffic is exposed under `/askfdalabel_api/`. This is an important operational detail because several frontend helpers and routes assume deployment-aware base paths.

### 9.4 Internal-access context

When Oracle/internal FDALabel connectivity is configured, the system can operate in an internal-aware mode through `FDALabelDBService`. This changes how some label retrieval paths behave and is a significant part of the platform’s environmental variability.

## 10. Operational characteristics and maintenance model

The codebase shows a platform that is maintained through both application endpoints and standalone scripts. Database initialization, label ingestion, MedDRA import, PGx import, DrugTox import, Orange Book import, embedding synchronization, and vector-index management all live outside the request-response path and are executed through `scripts/` or `backend/admin/tasks/`.

This is important for documentation because it means the true system boundary is larger than the running web processes. The suite includes a continuous maintenance surface: data needs to be imported, refreshed, embedded, and validated for the application to be useful.

The presence of `SystemTask` tracking, admin-triggered subprocess launches, and multiple import pipelines suggests that operations documentation should be treated as a first-class deliverable rather than an appendix.

## 11. Documentation topology and companion reports

This overview is the entry point for the technical documentation set, but it should not become the only document. The documentation should be split by concern so that implementation detail can evolve without collapsing into a single oversized file.

| Document | Intended role | Status in current documentation refresh |
|---|---|---|
| [`Documents/Overview.md`](./Overview.md) | System-level purpose, composition, scope, and documentation map | **Current** |
| [`Documents/architecture.md`](./architecture.md) | Cross-cutting architecture, request flow, blueprint map, service boundaries | **Current** |
| [`Documents/backend.md`](./backend.md) | Flask app structure, route ownership, service-layer responsibilities | **Current** |
| [`Documents/database.md`](./database.md) | Schemas, models, migrations, import/update flow | **Current** |
| [`Documents/AI-and-Search.md`](./AI-and-Search.md) | AI provider abstraction, semantic search pipeline, evidence composition | **Current** |
| [`Documents/Data-Sources.md`](./Data-Sources.md) | Source systems, ingestion pathways, update dependencies | **Current** |
| [`Documents/Operations.md`](./Operations.md) | Environment variables, Docker/nginx deployment, maintenance and troubleshooting | **Current** |
| [`Documents/FDA_autotest.md`](./FDA_autotest.md) | Web validation workflows, test assets, manual and automated checks | **Current** |

The key editorial rule should be that `README.md` remains the developer entry point, while the `Documents/` directory becomes the authoritative technical reference set. Historical notes under `idea/` may remain in the repository, but they should not compete with the live documentation set.

## 12. Summary

The current AskFDALabel repository represents a multi-domain regulatory intelligence platform with a shared application core. Its center of gravity is FDA structured product labeling, but the implementation has expanded to include semantic retrieval, grounded AI, toxicology and pharmacogenomics support, device intelligence, administrative tasking, and web validation. The architecture combines a single frontend, a unified Flask backend with modular blueprints, a mixed structured/vector data layer, and a set of operational scripts that are essential to keeping the suite current.

For documentation purposes, the most important conclusion is that the suite must be described as a platform with distinct architectural, data, operational, and analytical concerns. A narrow README-style summary is no longer sufficient. This overview establishes that higher-level frame so the companion documents can describe the backend, frontend, database, AI/search stack, data sources, and operations in detail without losing the overall system context.
