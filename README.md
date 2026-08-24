# AskFDALabel

AskFDALabel is a full-stack FDA labeling intelligence suite. It combines a Next.js frontend, a unified Flask backend, PostgreSQL storage, and optional Oracle/internal FDALabel connectivity to support label search, task-based review, AI-assisted analysis, toxicology workflows, device intelligence, and validation tooling.

The authoritative implementation lives in `frontend/`, `backend/`, and the database models under `backend/database/`.

## What the suite includes

### Global AI search (`/search`)
A grounded label-search workspace backed by the `backend/search` blueprint. The current search stack includes:
- conversational search entry points (`/api/search/chat`, `/api/search/search_agentic_stream`)
- a semantic pipeline under `backend/search/scripts/semantic_core/`
- label lookup by drug name, identifier and metadata (label *text* search is not available on the local PostgreSQL database)
- keyword retrieval, reranking, evidence fetching, and answer composition
- export helpers for filtered result sets

### Task dashboard (`/dashboard`)
The dashboard is the main label review workspace. It supports:
- importing FDALabel Excel exports
- uploading SPL XML or ZIP files for local comparison
- searching labels and opening label detail views
- organizing labels and saved comparisons into tasks
- label annotations and saved notes
- AI chat and compare summaries
- deep-dive analysis endpoints
- FAERS-based adverse-event workflows and AI rematching
- MedDRA label scans and profile lookups
- PGx, DILI, DICT, and DIRI assessment endpoints
- admin-only user and database maintenance features

### Label comparison (`/labelcomp`)
A side-by-side comparison workspace for up to four labels, with support for:
- selecting labels from tasks
- adding labels by `set_id`
- uploading local SPL files
- highlighted section-level differences
- AI-generated comparison summaries
- saving comparisons back into tasks

### askDrugTox (`/drugtox`)
A dedicated toxicology module for browsing harmonized toxicity records. The current backend exposes:
- dataset statistics
- filtered drug browsing
- discrepancy analysis
- latest RLD lookup
- per-drug history and market context
- company portfolio and company-level toxicity summaries

### Device intelligence (`/device`)
A device-focused module backed by openFDA endpoints. It provides:
- 510(k) and PMA search
- device metadata lookup
- MAUDE event summaries
- recall and enforcement summaries
- AI comparison of device IFU content

### Local query (`/localquery`)
A lightweight query and export surface for the local labeling database. It supports:
- quick search by brand, generic, `set_id`, or application number
- autocomplete
- random label sampling
- export to Excel for task list import or offline review

### Web validation tool (`/webtest`)
An internal regression and probing tool for FDALabel web endpoints. It works with Excel templates, stores history, and records timing and count-based checks under `backend/webtest/`.  
This function is designed for FDALabel website auto testing, as required by a specific user group.

### Supporting utilities
The repo also includes:
- an admin/management page for users and database update tasks
- an optional nginx reverse proxy under `deploy/nginx/`

## Architecture at a glance

### Frontend
- Next.js `16.1.6`
- React `19`
- MUI-based application UI
- app-router pages under `frontend/app/`
- default app base path: `/fdalabel-v3`

### Backend
- Flask application assembled in `backend/app.py`
- dashboard app factory in `backend/dashboard/__init__.py`
- blueprints registered at:
  - `/api/dashboard`
  - `/api/search`
  - `/api/drugtox`
  - `/api/labelcomp`
  - `/api/device`
  - `/api/localquery`
  - `/api/webtest`

### Data layer
- PostgreSQL is the primary runtime database
- the `labeling` schema stores SPL label metadata and sections
- Label text search was removed; `pg_trgm` trigram indexes over the name and category columns serve the criteria builder
- public-schema tables store users, tasks, favorites, reports, MedDRA, PGx, DrugTox, and system tasks
- optional Oracle connectivity is supported through `FDALabelDBService`

### AI and external data sources
- Gemini via `google-genai`
- OpenAI-compatible endpoints for internal Llama or similar services
- Elsa integration for internal FDA workflows
- openFDA for FAERS and device data
- DailyMed and SPL ZIP ingestion for label content
- Orange Book, MedDRA, PGx, and DrugTox import pipelines

## Repository layout

```text
backend/             Flask app, blueprints, services, models, migrations
frontend/            Next.js app-router frontend
data/                Runtime data, downloads, SPL storage, uploads
deploy/nginx/        Optional reverse proxy for /fdalabel-v3 and /fdalabel-v3_api
backend/webtest/     Validation templates, history, and results
archive/             Archived historical files (Documents, scripts, bookmarklets, legacy code)
```

## Prerequisites

For the containerized stack:
- Docker
- Docker Compose / `docker compose`

For local development:
- Python `3.12` recommended
- Node.js `22` recommended
- PostgreSQL

## Environment configuration

Create a root `.env` file before starting the app. A template file `.env.template.txt` is provided in the repository root.

A few important notes before you copy values:
- the running code reads `GEMINI_API_KEY` (with a backward-compatibility fallback to `GOOGLE_API_KEY` if set)
- `DATABASE_URL` is required by the backend

A minimal local `.env` usually looks like this:

```env
# Core runtime
LOCAL-PG=true
PG_HOST=db
PG_PORT=5432
PG_DATABASE=fdalabel-v3
PG_USERNAME=afd_user
PG_PASSWORD=afd_password
DATABASE_URL=postgresql://${PG_USERNAME}:${PG_PASSWORD}@${PG_HOST}:${PG_PORT}/${PG_DATABASE}

LOCAL_QUERY=True
SECRET_KEY=change-me

# Ports
HOST=0.0.0.0
BACKEND_PORT=8842
FRONTEND_PORT=8841

# Frontend path helpers
NEXT_PUBLIC_API_BASE=/fdalabel-v3_api
NEXT_PUBLIC_DASHBOARD_BASE=/fdalabel-v3

# AI providers
GEMINI_API_KEY=
OPENFDA_API_KEY=
ELSA_API_NAME=
ELSA_API_KEY=
ELSA_MODEL_ID=
LLM_URL=
LLM_KEY=
LLM_MODEL=meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8
```

Optional Oracle/internal FDALabel settings:

```env
FDALabel_HOST=
FDALabel_PORT=1521
FDALabel_SERVICE=
FDALabel_USER=
FDALabel_PASSWORD=
```

Routing note:
- the suite now uses standardized path-prefix handling. For most deployments (including local development), keep `NEXT_PUBLIC_API_BASE=/fdalabel-v3_api` and `NEXT_PUBLIC_APP_BASE=/fdalabel-v3`.
- the `next.config.ts` and `FetchPrefix.tsx` utilities ensure that these paths work correctly whether running behind nginx or during direct local development.

## Starting the Application

The server can be started in **two straightforward ways**:

### Method 1: Using the Startup Script (Recommended)

`start_server.py` reads your `.env`, automatically generates `docker-compose.yml`, prepares base images, and starts the container stack.

```bash
# 1. Development Mode (hot-reload for frontend & backend, ports 8841 and 8842 exposed)
python start_server.py --mode dev

# 2. Production Mode (Gunicorn workers, compiled Next.js, Nginx reverse proxy on port 80/443)
python start_server.py --mode prod
```

**Useful flags for `start_server.py`:**
- `--down`: Stop and clean up active containers (`python start_server.py --mode dev --down`)
- `--build`: Rebuild Docker images during startup
- `--efficient`: Low-resource mode (fewer workers, reduced database connection limits)
- `--local-db true|false`: Force local PostgreSQL container vs. external database
- `--dry-run`: Generate `docker-compose.yml` without starting containers

---

### Method 2: Using Docker Compose Directly

Once `docker-compose.yml` has been generated (either by running `start_server.py` or via `python start_server.py --dry-run`), you can manage the stack directly using standard Docker commands:

```bash
# Start all services in the background
docker compose up -d

# View live container logs
docker compose logs -f

# Stop all services
docker compose down
```

---

### Accessing the Application

- **Development Mode**: `http://localhost:8841/fdalabel-v3/` (Backend API: `http://localhost:8842/health`)
- **Production Mode**: `http://localhost/fdalabel-v3/` (proxied via Nginx)

## Database Initialization and Maintenance

The application uses a two-schema layout in PostgreSQL (`public` and `labeling`). Follow these steps to initialize a **new** system or update an **existing** one. All scripts are idempotent and will safely update schema/columns if the database already exists.

### Step-by-Step Initialization
Run these from the repo root with your virtual environment activated:

1. **Initialize Labeling Schema**: Creates the `labeling` tables and the `pg_trgm` trigram indexes the criteria builder needs.
   ```bash
   python backend/database/scripts/db_02_init_labeling_schema.py
   ```
2. **Initialize Public Schema**: Creates application tables (users, tasks, etc.) via SQLAlchemy.
   ```bash
   python backend/database/scripts/db_03_init_public_schema.py
   ```
3. **Import Orange Book**: Essential for identifying RLD/RS labels.
   ```bash
   python backend/database/scripts/db_04_import_orange_book.py
   ```
4. **Import EPC Indexing**: Required for the Deep Dive "Pharmacologic Class" analysis.
   ```bash
   python backend/database/scripts/db_05_import_epc_indexing.py
   ```
5. **Create Admin User**: Sets up the initial login (default: admin / 1986414).
   ```bash
   python backend/database/scripts/db_06_create_admin.py
   ```
6. **Import Labels**: Syncs SPL files from storage to the database.
   ```bash
   # Add --force to re-process and update UNII/EPC for existing labels
   python backend/database/scripts/db_07_import_labels.py --force --skip-unpack
   ```

*(Note: an existing database created before full-text search was removed should be migrated once with `python backend/database/scripts/db_12_drop_fulltext_search.py`, which drops `labeling.spl_sections`, `sum_spl.full_search_vector` and their GIN indexes.)*

## Data and maintenance workflows

### Label data ingestion
Relevant paths and scripts:
- SPL ZIP storage: `data/spl_storage/`
- uploads and temporary imports: `data/uploads/`
- DailyMed downloader: `archive/scripts/labels/download_dailymed.py`
- PostgreSQL initialization: `backend/database/scripts/` (See Step-by-Step above)
- Main importer: `backend/database/scripts/db_07_import_labels.py`

### Reference and enrichment datasets
- Orange Book import: `backend/database/scripts/db_04_import_orange_book.py`
- MedDRA import: `backend/admin/tasks/import_meddra.py` and `archive/scripts/migration/01_import_meddra.py`
- PGx import: `archive/scripts/migration/02_import_pgx.py`
- DrugTox import: `backend/admin/tasks/import_drugtox.py` and `archive/scripts/migration/03_import_drugtox.py`
- EPC Indexing: `backend/database/scripts/db_05_import_epc_indexing.py`

### Validation assets
- Web test templates: `backend/webtest/*.xlsx`
- Web test history: `backend/webtest/history/`
- Web test results: `backend/webtest/results/`

## Authentication and administration

The dashboard includes built-in user authentication and admin-only maintenance endpoints.

Admin capabilities currently include:
- user creation, deletion, and role management
- password updates
- long-running database update tasks with progress polling and task logs

The admin UI is exposed in the frontend under `/management`, and the corresponding backend routes live under `/api/dashboard/admin`.

## Archives and Historical Documentation

To keep the repository clean, older planning ideas, legacy scripts, and old documentation have been consolidated under the `archive/` directory:
- `archive/Documents/`: Historical database and system architecture design files.
- `archive/scripts/`: Legacy migration, test, and utility scripts.
- `archive/idea/`: Historical design notes and completed writeups.

These files are preserved for reference only and are not active or required for running the current application.

## Known implementation notes

- The backend loads environment variables from the repo-root `.env`.
- The frontend expects the backend under `/api/*` in direct development, and under `/fdalabel-v3_api/*` when routed through nginx.
- The application creates required data directories on startup.
- MedDRA-dependent features will run with reduced detail if MedDRA tables have not been populated.
- Some functionality becomes richer when Oracle/internal FDALabel access is available, but the suite is designed to run in PostgreSQL-only mode as well.



