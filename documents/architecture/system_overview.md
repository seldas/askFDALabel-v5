# AskFDALabel Suite: System Architecture Overview

## 1. Executive Summary

AskFDALabel is a unified regulatory labeling-intelligence and pharmacovigilance platform built around FDA Structured Product Labeling (SPL) XML and adjacent regulatory datasets. 

The platform combines a modern Next.js 16 frontend, a multi-blueprint Flask backend, a dual-schema PostgreSQL database, optional Oracle internal FDALabel connectivity, and Celery-based background task workers. The system is designed to handle high-throughput label discovery, deep adverse-event inspection, automated quality-control validation, structured comparisons, toxicology lookups, and AI-assisted regulatory analysis.

```
                                  +---------------------------------------+
                                  |            Browser Client             |
                                  +---------------------------------------+
                                                      |
                                    /fdalabel-v3/*    |    /fdalabel-v3_api/*
                                                      v
                                  +---------------------------------------+
                                  |              Nginx Proxy              |
                                  +---------------------------------------+
                                         |                         |
                                         v                         v
                       +---------------------------+   +---------------------------+
                       |    Next.js 16 Frontend    |   |     Flask Unified App     |
                       |       (Port 8841)         |   |        (Port 8842)        |
                       +---------------------------+   +---------------------------+
                                                                     |
                                             +-----------------------+-----------------------+
                                             |                       |                       |
                                             v                       v                       v
                                  +--------------------+   +-------------------+   +--------------------+
                                  |   PostgreSQL 16    |   |    Celery + Redis |   |   Oracle FDALabel  |
                                  | (public + labeling)|   | (Background Tasks)|   |     (Optional)     |
                                  +--------------------+   +-------------------+   +--------------------+
                                             |
                                             v
                                  +--------------------+
                                  | Local SPL Storage  |
                                  | (ZIP / XML / Cache)|
                                  +--------------------+
```

---

## 2. Core Architectural Principles

1. **Modular Monolith over Microservices**:
   All features share a unified authentication lifecycle, configuration tree, database connection pool, and service layer. Individual capabilities are grouped into Flask blueprints on the backend and App Router route groups on the frontend.
2. **DB-First Criteria Routing**:
   Unlike legacy versions that relied on expensive vector pipelines or full-text TSVECTOR scans, search routing employs a deterministic classification tree (`uuid`, `ndc`, `appnum`, `keyword`, `general`) backed by PostgreSQL `pg_trgm` GIN indexes and on-the-fly SPL XML reading.
3. **Hybrid Local/Remote Label Storage**:
   Labels are resolved through a deterministic cascade: local unpacked files, local archive storage, local immutable runtime cache (`data/spl_cache/`), and finally Oracle fallback.
4. **Data-Driven Feature Governance**:
   Permissions and module availability are controlled dynamically via runtime database feature gates (`FeatureGate`), enforcing role boundaries (`user`, `developer`, `admin`, `guest`) without requiring server restarts.
5. **Multi-Provider AI Abstraction**:
   AI generation funnels through a centralized handler supporting Google Gemini, FDA internal ELSA, and local/remote OpenAI-compatible endpoints (vLLM, Ollama, Llama), with per-call token usage accounting.

---

## 3. Technology Stack

| Layer | Component | Version / Technologies |
|---|---|---|
| **Frontend** | Framework | Next.js 16.1 (App Router), React 19, TypeScript |
| | Styling & UI | Tailwind CSS, Lucide Icons, Headless UI |
| | State & Client | React Hooks, Context API, Vanilla JS interop (Chart.js) |
| **Backend** | Framework | Flask 3.0+, Gunicorn, Werkzeug |
| | ORM & Migrations | SQLAlchemy 2.0, Flask-SQLAlchemy, Flask-Migrate (Alembic) |
| | Background Tasks | Celery 5.3+, Redis 7 (Alpine / Bitnami) |
| | XML & Data | `lxml`, `xml.etree`, Pandas, OpenPyXL |
| **Persistence**| Application DB | PostgreSQL 16 (`public` schema) |
| | Labeling DB | PostgreSQL 16 (`labeling` schema with `pg_trgm` GIN indexes) |
| | External Labeling | Oracle Database 19c+ (`oracledb` python client) |
| **Infrastructure** | Containerization | Docker Compose, Apptainer (Singularity) |
| | Web Server / Proxy | Nginx (Alpine) with HTTP/HTTPS reverse proxy and gzip |

---

## 4. Path-Prefix and Runtime Topology

In production environments, the platform operates behind an Nginx reverse proxy under standardized base paths:
- **Web UI**: `/fdalabel-v3/` -> rewritten to `frontend:8841`
- **API Endpoints**: `/fdalabel-v3_api/` -> rewritten to `backend:8842`

To maintain seamless compatibility between local development (where direct calls to `/api/*` are used) and production reverse proxying:
1. `frontend/next.config.ts`: Configures `basePath` and rewrites API requests to the Flask origin.
2. `frontend/app/utils/appPaths.ts`: Exports utility functions (`withAppBase`, `withApiBase`, `withDashboardBase`).
3. `frontend/app/FetchPrefix.tsx`: A globally mounted client component that monkey-patches `window.fetch` and `window.open`, and observes DOM mutations to transparently rewrite `<a href>` and `src` links at runtime.

---

## 5. Directory Blueprint

```
askFDALabel_v5/
├── backend/                    # Python Flask backend
│   ├── admin/                  # Administrative background task implementations
│   ├── api_service/            # Public REST API blueprint
│   ├── dashboard/              # Core application factory, routes, and shared services
│   ├── database/               # Models, extensions, and idempotent initialization scripts
│   ├── device/                 # openFDA Medical Device Intelligence blueprint
│   ├── drugtox/                # Toxicology and DILI assessment blueprint
│   ├── labelcomp/              # Multi-label structured comparison blueprint
│   ├── labelquery/             # Advanced query builder compiler and criteria facets
│   ├── localquery/             # Local database query execution blueprint
│   ├── search/                 # Search decision tree and chat refinement blueprint
│   └── webtest/                # Web test regression engine and verification runner
├── frontend/                   # Next.js 16 App Router frontend
│   ├── app/                    # Pages, layouts, and route handlers
│   │   ├── dashboard/          # Label viewer, deep dive, labeling-ae, pv-profile
│   │   ├── device/             # Device intelligence interface
│   │   ├── drugtox/            # Toxicology analytics dashboard
│   │   ├── labelcomp/          # Label comparison UI
│   │   ├── localquery/         # Criteria builder and export panel
│   │   ├── management/         # User, task, and feature gate admin panel
│   │   ├── search/             # Primary search and results workspace
│   │   └── webtest/            # Automated web test validation UI
│   └── public/                 # Static assets, logos, and legacy vanilla-JS libraries
├── data/                       # Local persistent state (mounted volume)
│   ├── spl_storage/            # Primary unpacked SPL ZIP files
│   ├── spl_storage_archived/   # Archived bare SPL XML files
│   ├── spl_cache/              # Immutable read-through cache for Oracle XMLs
│   └── downloads/              # Download staging for DailyMed, OrangeBook, MedDRA
├── deploy/                     # Deployment configurations (Nginx, Apptainer, RAPID)
├── documents/                  # Comprehensive documentation hub
└── start_server.py             # Official orchestration CLI
```
