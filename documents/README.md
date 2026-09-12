# AskFDALabel Documentation Hub

Welcome to the central technical documentation repository for **AskFDALabel v5**. This documentation suite covers the system architecture, domain feature modules, deployment runbooks, and historical archives.

---

## Documentation Directory Map

```
documents/
├── architecture/           # Core System & Software Architecture
├── modules/                # Feature Modules & Clinical Intelligence Tools
├── operations/             # Operations, Deployment & Administration
└── archived/               # Historical & Superseded Architectural Records
```

---

### 1. Architecture
- **[System Overview](file:///d:/Coding/askFDALabel_v5/documents/architecture/system_overview.md)**: High-level system design, modular monolith pattern, technology stack, and runtime topology.
- **[Backend Architecture](file:///d:/Coding/askFDALabel_v5/documents/architecture/backend_architecture.md)**: Flask unified app factory, blueprint assembly, Celery task orchestration, and AI model routing.
- **[Frontend Architecture](file:///d:/Coding/askFDALabel_v5/documents/architecture/frontend_architecture.md)**: Next.js 16 App Router, central tool registry (`platform/registry.ts`), and path-prefix handling.
- **[Database Architecture](file:///d:/Coding/askFDALabel_v5/documents/architecture/database_architecture.md)**: PostgreSQL dual-schema design (`public` and `labeling`), GIN `pg_trgm` indexes, models, and lowercase username standard.
- **[SPL Storage & Cache Cascade](file:///d:/Coding/askFDALabel_v5/documents/architecture/label_storage_and_cache.md)**: SPL XML retrieval flow (`spl_storage` -> `spl_storage_archived` -> `spl_cache` -> Oracle fallback).

---

### 2. Feature Modules
- **[Search & Discovery](file:///d:/Coding/askFDALabel_v5/documents/modules/search_and_discovery.md)**: DB-first query classifier, criteria filters, and interactive label viewer.
- **[Labeling Adverse Events & MedDRA](file:///d:/Coding/askFDALabel_v5/documents/modules/labeling_ae_and_meddra.md)**: Adverse event extraction, MedDRA 5-level hierarchy, and interactive in-situ highlighting engine.
- **[PV Profile & Quality Control](file:///d:/Coding/askFDALabel_v5/documents/modules/pv_profile_and_qc.md)**: Pharmacovigilance safety profiles and automated regulatory discrepancy detection.
- **[Label Comparison](file:///d:/Coding/askFDALabel_v5/documents/modules/label_comparison.md)**: Version-to-version and cross-product structured comparison with AI clinical synthesis.
- **[DrugTox: Toxicology Intelligence](file:///d:/Coding/askFDALabel_v5/documents/modules/drugtox.md)**: DILI Rule-of-Two assessment, cardiotoxicity (DICT), renal injury (DIRI), chemical structure visualization, and FAERS signals.
- **[Medical Device Intelligence](file:///d:/Coding/askFDALabel_v5/documents/modules/device_intelligence.md)**: openFDA 510(k), PMA, recall enforcement, and MAUDE adverse event reports.
- **[Local Query Builder](file:///d:/Coding/askFDALabel_v5/documents/modules/local_query_builder.md)**: 11-dimension Boolean criteria compiler and streaming data export.
- **[WebTest Validation Suite](file:///d:/Coding/askFDALabel_v5/documents/modules/webtest_validation.md)**: Automated regression testing comparing local engine results against official FDA web services.

---

### 3. Operations & Deployment
- **[Server Management Runbook](file:///d:/Coding/askFDALabel_v5/documents/operations/server_management.md)**: `start_server.py` orchestration CLI, dev/prod/rapid modes, Docker Compose, and Apptainer.
- **[Environment Configuration](file:///d:/Coding/askFDALabel_v5/documents/operations/environment_configuration.md)**: Complete `.env` variable reference dictionary.
- **[Feature Gates & RBAC](file:///d:/Coding/askFDALabel_v5/documents/operations/feature_gates_and_rbac.md)**: User roles (`user`, `developer`, `admin`), guest restrictions, and dynamic runtime permission toggling.
- **[RAPID Migration System](file:///d:/Coding/askFDALabel_v5/documents/operations/rapid_migration_guide.md)**: Package exporter, importer, database dumping, and zero-downtime restoration.
- **[Database Initialization](file:///d:/Coding/askFDALabel_v5/documents/operations/database_initialization.md)**: Numbered database scripts (`db_02` to `db_12`) and external reference data ingestion.
- **[Oracle FDALabel & MedDRA Reference](file:///d:/Coding/askFDALabel_v5/documents/operations/oracle_fdalabel_reference.md)**: Technical schema dictionary and criteria category mapping for internal Oracle FDALabel.

---

### 4. Historical & Superseded
- **[Archived Index](file:///d:/Coding/askFDALabel_v5/documents/archived/README.md)**: Inventory of deprecated architectures and historical development notes.
- **[Full-Text Search & Vector Pipeline](file:///d:/Coding/askFDALabel_v5/documents/archived/full_text_and_vector_search.md)**: Why `spl_sections` TSVECTOR and agentic vector search were removed.
- **[Legacy SQLite Architecture](file:///d:/Coding/askFDALabel_v5/documents/archived/legacy_sqlite_architecture.md)**: Early proof-of-concept SQLite database (`afd.db`) notes.
