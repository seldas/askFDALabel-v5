# AskFDALabel (v5)

AskFDALabel is an enterprise-grade FDA drug and device labeling intelligence suite. Combining a modern Next.js frontend, a unified Flask modular backend, high-performance PostgreSQL storage, and optional Oracle/CDER-CBER enterprise connectivity, AskFDALabel enables deep label search, multi-criteria querying, automated pharmacovigilance profiling, toxicology assessment, medical device discovery, and regression validation tooling.

> **Master Documentation**: Comprehensive architecture, module specifications, operations runbooks, and historical archives are consolidated in the [`documents/`](documents/README.md) directory.

---

## Key Modules & Platform Capabilities

| Module | Route / Path | Core Description | Documentation |
| :--- | :--- | :--- | :--- |
| **Global AI Search** | `/search` | DB-first decision routing (`uuid`, `ndc`, `appnum`, `keyword`, `general`), XML disk extraction, and conversational synthesis. | [Search & Discovery](documents/modules/search_and_discovery.md) |
| **Criteria Query Builder** | `/querybuilder` | 3-step structured filter builder, AI natural language intent compiler, Late Materialization, and Excel export. | [Query Builder Docs](documents/modules/local_query_builder.md) |
| **Adverse Events & MedDRA** | `/labeling-ae` | In-situ SPL XML clinical text rendering with hierarchical MedDRA (SOC/HLGT/HLT/PT/LLT) multi-color keyword highlighting. | [Labeling AE & MedDRA](documents/modules/labeling_ae_and_meddra.md) |
| **PV Profile & QC** | `/pv-profile` | SIDER 4.1-style adverse event evidence grid, user tagging, manual reconciliation, and automated rule-based QC verification. | [PV Profile & QC](documents/modules/pv_profile_and_qc.md) |
| **Label Comparison** | `/labelcomp` | Side-by-side structured multi-label diff (up to 4 labels), section-level alignment, and AI change summaries. | [Label Comparison](documents/modules/label_comparison.md) |
| **askDrugTox** | `/drugtox` | Toxicology intelligence: DILI Rule-of-Two, DICT, DIRI, chemical structure viewer, and FAERS signal correlation. | [askDrugTox](documents/modules/drugtox.md) |
| **Device Intelligence** | `/device` | openFDA medical device discovery: 510(k), PMA, recall enforcement, MAUDE adverse events, and IFU comparisons. | [Device Intelligence](documents/modules/device_intelligence.md) |
| **Chemical Structure Search** | `/chemsearch` | Exact, substructure, and Tanimoto similarity chemical structure querying with interactive 2D structure drawing. | [DrugTox & Chem](documents/modules/drugtox.md) |
| **Local Query** | `/localquery` | 11-dimension Boolean criteria compiler, raw SQL execution, random sampling, and bulk Excel export. | [Local Query Builder](documents/modules/local_query_builder.md) |
| **RESTful API Service** | `/api/v1` | Token-authenticated (`afl_live_`) programmatic query interface with structured JSON responses and pagination. | [System Overview](documents/architecture/system_overview.md) |
| **Web Validation Tool** | `/webtest` | Automated regression test engine executing batch query suites against official FDA web endpoints. | [WebTest Validation](documents/modules/webtest_validation.md) |
| **System Management** | `/management` | Administration portal for users, RBAC, feature gates, API keys, and background Celery task monitoring. | [Feature Gates & RBAC](documents/operations/feature_gates_and_rbac.md) |

---

## Documentation Hub

All developer and operator documentation is centralized under [`documents/`](documents/README.md):

```text
documents/
├── README.md                              # Master Documentation Hub & Navigation
├── architecture/
│   ├── system_overview.md                 # System architecture, topology, & deployment model
│   ├── backend_architecture.md            # Flask app factory, blueprints, Celery, AI routing
│   ├── frontend_architecture.md           # Next.js 16 App Router, central tool registry, FetchPrefix
│   ├── database_architecture.md           # Dual-schema PostgreSQL, GIN pg_trgm, model schemas
│   └── label_storage_and_cache.md         # SPL XML storage cascade, caching, atomic disk writes
├── modules/
│   ├── search_and_discovery.md            # DB-first query classifier and search workspace
│   ├── labeling_ae_and_meddra.md          # Adverse events SPL view & MedDRA highlighting
│   ├── pv_profile_and_qc.md               # Pharmacovigilance safety profile & automated QC engine
│   ├── label_comparison.md                # Multi-label structured diff & AI synthesis
│   ├── drugtox.md                         # Toxicology assessment & chemical structure search
│   ├── device_intelligence.md             # openFDA 510(k), PMA, MAUDE, and IFU analysis
│   ├── local_query_builder.md             # Criteria query builder & Boolean SQL compiler
│   └── webtest_validation.md              # FDA endpoint automated regression test harness
├── operations/
│   ├── server_management.md               # start_server.py orchestrator & container runtimes
│   ├── environment_configuration.md       # Exhaustive .env configuration reference
│   ├── database_initialization.md         # Numbered database setup and ingestion runbook
│   ├── rapid_migration_guide.md           # Zero-downtime packaging, dump, restore, & deployment
│   ├── feature_gates_and_rbac.md          # Role-based access control & dynamic runtime gates
│   └── oracle_fdalabel_reference.md       # Oracle CDER-CBER schema mapping & SQL compilers
└── archived/
    ├── README.md                          # Deprecation index and architectural evolution notes
    ├── full_text_and_vector_search.md     # Deprecation of TSVECTOR full_search_vector & semantic core
    └── legacy_sqlite_architecture.md      # Deprecation of early afd.db monolithic SQLite storage
```

---

## Repository Layout

```text
├── backend/                               # Flask application, blueprints, services, database models
│   ├── dashboard/                         # Base dashboard app, config, auth, and API routes
│   ├── search/                            # DB-first search blueprint and chat endpoints
│   ├── labelquery/                        # Criteria query builder (PostgreSQL & Oracle compilers)
│   ├── drugtox/                           # Drug toxicity assessment and FAERS integration
│   ├── device/                            # openFDA device intelligence blueprint
│   ├── localquery/                        # Direct SQL and criteria local query blueprint
│   ├── chemsearch/                        # Chemical structure search blueprint
│   ├── api_service/                       # Programmatic RESTful API (v1) with API key auth
│   ├── webtest/                           # Web validation harness and regression suite
│   ├── admin/tasks/                       # Asynchronous Celery task implementations
│   └── database/scripts/                  # Numbered database setup & maintenance runbook
├── frontend/                              # Next.js 16 (App Router) frontend application
│   ├── app/                               # Route handlers, module pages, layout, and global providers
│   └── public/                            # Static assets and vendor JavaScript libraries
├── documents/                             # Centralized technical documentation hub
├── deploy/                                # Deployment orchestration, Nginx configs, and rapid tooling
├── data/                                  # Local runtime storage (SPL XML files, uploads, caches)
├── start_server.py                        # Unified container orchestrator (Apptainer / Docker)
└── docker-compose.yml                     # Standard multi-container compose configuration
```

---

## Architecture at a Glance

### Frontend
- **Framework**: Next.js 16 (App Router) & React 19.
- **UI Components**: Material UI (MUI v6) with Tailwind CSS styling.
- **Routing & Base Paths**: Mounted at `/fdalabel-v3` with runtime transparent rewriting via `FetchPrefix.tsx`.
- **Tool Registry**: Declarative catalog at `frontend/app/platform/registry.ts`.

### Backend
- **Framework**: Python 3.12 Flask unified modular application (`backend/app.py`).
- **Asynchronous Tasks**: Celery worker backed by Redis for long-running batch ingestion and exports.
- **AI Routing**: Multi-provider client abstraction supporting Google Gemini, Elsa (FDA internal), and OpenAI-compatible endpoints (vLLM, Ollama, Llama).
- **Security**: XML external entity protection (`defusedxml`), rate limiting, lowercase username normalization, and bearer API tokens.

### Data Layer
- **PostgreSQL**: Dual-schema design:
  - `labeling` schema: SPL label metadata (`sum_spl`), pharmacologic classes (`epc_map`), active ingredients (`active_ingredients_map`), indexed with GIN `pg_trgm`.
  - `public` schema: Application entities (users, tasks, favorites, MedDRA hierarchy, DrugTox, PV-Profiles, system tasks, API keys).
- **Disk Storage**: Unpacked SPL XML files stored in `data/spl_storage/` and `data/spl_storage_archived/`, with automatic persistent caching for Oracle fetches in `data/spl_cache/`.
- **Oracle (Optional)**: Enterprise CDER-CBER database connection for live FDA production label queries.

---

## Quick Start

### 1. Prerequisites
- **Python**: 3.11+ (3.12 recommended)
- **Node.js**: 20+ (22 recommended)
- **PostgreSQL**: 15+
- **Redis**: 7+ (required for Celery task processing)
- **Container Runtimes (Optional)**: Apptainer or Docker / Docker Compose

### 2. Environment Configuration

Copy the template environment configuration to `.env` in the repository root:

```bash
cp .env.template.txt .env
```

Ensure `DATABASE_URL` and essential API keys (e.g. `GEMINI_API_KEY`) are set. For complete environment variable documentation, see the [Environment Configuration Guide](documents/operations/environment_configuration.md).

### 3. Launching with `start_server.py` (Recommended)

`start_server.py` orchestrates the backend, frontend, database, and Redis instances:

```bash
# Development Mode (Hot-reload, ports 8841 [web] and 8842 [api])
python start_server.py --mode dev

# Production Mode (Optimized production build with Nginx proxy on :80/:443)
python start_server.py --mode prod

# Stop running instances
python start_server.py --mode dev --down
```

**Common flags:**
- `--runtime apptainer|docker`: Select container runtime (defaults to Apptainer on Linux, Docker on Windows).
- `--efficient`: Run in low-resource mode with reduced workers and database connection limits.
- `--local-db true|false`: Run a local PostgreSQL container or connect to an external server.
- `--rapid`: Production mode without Nginx, pre-configured for remote database connections.

#### Standard Docker Compose:
Once generated via `python start_server.py --runtime docker --dry-run`, standard Docker commands work directly:

```bash
docker compose up -d       # Start all services in background
docker compose logs -f     # Tail live logs
docker compose down        # Stop all containers
```

- **Web Application URL**: `http://localhost:8841/fdalabel-v3/` (dev) or `http://localhost/fdalabel-v3/` (prod).
- **Backend Health Check**: `http://localhost:8842/health`.

### 4. Asynchronous Task Worker (Celery)

For admin imports, MedDRA processing, and long-running batch tasks, start the Celery worker from the `backend/` directory:

```bash
# Windows
cd backend && celery -A celery_app.celery worker --loglevel=info --pool=solo

# Linux / macOS
cd backend && celery -A celery_app.celery worker --loglevel=info
```

---

## Database Setup Runbook

The database initialization scripts are numbered, idempotent, and executed from the repository root:

```bash
# 1. Initialize SPL labeling schema and trigram GIN indexes
python backend/database/scripts/db_02_init_labeling_schema.py

# 2. Initialize application public schema tables
python backend/database/scripts/db_03_init_public_schema.py

# 3. Import FDA Orange Book reference data (RLD/RS tracking)
python backend/database/scripts/db_04_import_orange_book.py

# 4. Import Established Pharmacologic Class (EPC) indexing
python backend/database/scripts/db_05_import_epc_indexing.py

# 5. Create default administrator account (admin / 1986414)
python backend/database/scripts/db_06_create_admin.py

# 6. Ingest SPL label packages from storage
python backend/database/scripts/db_07_import_labels.py --force --skip-unpack

# 7. Import DILI Rule-of-Two reference dataset (optional)
python backend/database/scripts/db_11_import_dili_reference.py
```

For full details on reference datasets and migrations, review the [Database Initialization Guide](documents/operations/database_initialization.md).

---

## Rapid Migration & Backup Tooling

To migrate AskFDALabel instances across environments (e.g. local dev to remote staging) without re-importing 700k+ labels:

```bash
# Export configuration, user data, and database dumps into an archive
python export_rapid_package.py --output /path/to/backup.tar.gz

# Import archive package onto the target machine
python import_rapid_package.py --package /path/to/backup.tar.gz

# Database dump and restore utilities
python dump_db.py --output data/db_dump.sql
python restore_db.py --input data/db_dump.sql
```

For full disaster recovery and migration workflows, refer to the [Rapid Migration Guide](documents/operations/rapid_migration_guide.md).

---

## License & Disclaimer

AskFDALabel is developed for scientific research, regulatory science, and labeling intelligence exploration. All drug labeling data and product identifiers are sourced from official FDA and NLM DailyMed public releases.
