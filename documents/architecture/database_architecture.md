# Database Architecture & Schema Design

## 1. Overview

AskFDALabel utilizes PostgreSQL 16+ with a **dual-schema layout** within a single database instance:
1. **`public` schema**: Application-level state (users, projects, favorites, annotations, Orange Book references, PGx biomarkers, MedDRA hierarchy, task logs, feature gates).
2. **`labeling` schema**: FDA SPL label metadata and indexing maps.

```
                      +------------------------------------------+
                      |         PostgreSQL Instance              |
                      +------------------------------------------+
                                     |                    |
                                     v                    v
                      +------------------------+  +------------------------+
                      |     public Schema      |  |    labeling Schema     |
                      +------------------------+  +------------------------+
                      | • user (VARCHAR(100))  |  | • sum_spl              |
                      | • project              |  | • active_ingredients_  |
                      | • favorite             |  |   map                  |
                      | • annotation           |  | • epc_map              |
                      | • system_tasks         |  | • substance_indexing   |
                      | • feature_gates        |  | • processed_zips       |
                      | • meddra_soc / pt      |  | • query_options_cache  |
                      | • orange_book          |  |                        |
                      | • drugtox_reports      |  | (No TSVECTOR; fast     |
                      | • token_usage          |  |  pg_trgm GIN indexing) |
                      +------------------------+  +------------------------+
```

All models are defined in a single authoritative file: `backend/database/models.py`. Labeling schema models are explicitly decorated with `__table_args__ = {'schema': 'labeling'}`.

---

## 2. The `labeling` Schema

The `labeling` schema stores structured product labeling metadata imported from DailyMed or internal archives:

- **`sum_spl`** (`DrugLabel` model): Core label index row.
  - `set_id` (UUID string): Persistent identifier across all revisions of a product.
  - `spl_id` (UUID string): Unique identifier for a specific published revision.
  - `product_names`, `generic_names`, `active_ingredients`: Semicolon-delimited names.
  - `appr_num`, `doc_type`, `market_categories`, `routes`, `dosage_forms`.
  - `is_rld`, `is_rs`: Reference Listed Drug and Reference Standard flags (Orange Book).
  - `local_path`: Relative path to the SPL XML or ZIP file on disk (`data/spl_storage/` or `data/spl_storage_archived/`).
- **`active_ingredients_map`**: Maps `spl_id` to normalized substance UNII and ingredient roles.
- **`epc_map`**: Maps substances to Established Pharmacologic Classes (EPC).
- **`substance_indexing`**: Maps UNII codes to preferred names and pharmacologic categories.
- **`processed_zips`**: Checksum and file tracking for incremental DailyMed archive ingestion.

### Key Architectural Evolution: Dropping Full-Text Search
In legacy implementations, full label bodies were chunked into `spl_sections` with `search_vector TSVECTOR` columns and `sum_spl.full_search_vector`.
- **Reason for Removal**: At scale (700,000+ SPL revisions), storing uncompressed section text and full-text search vectors bloated database disk usage by over 400 GB and caused severe vacuum/indexing overhead.
- **Current Pattern**: Section text is read dynamically on-the-fly from SPL XML on disk via `sum_spl.local_path`. Field and name filtering is handled via fast PostgreSQL **`pg_trgm` GIN indexes** on `product_names`, `generic_names`, and `market_categories`.

---

## 3. The `public` Schema

The `public` schema stores application, user, and analytical data:

- **`user`**: User accounts, passwords, activation status, and role assignments (`user`, `developer`, `admin`).
  - **Standardized Lowercase**: Stored as standard `VARCHAR(100)` with a unique constraint. All inputs are normalized with `.strip().lower()`. No dependency on PostgreSQL `CITEXT` extension.
- **`project` & `project_users`**: Workspaces for organizing drug labels, shared with team members.
- **`favorite` & `favorite_comparison`**: Saved drug labels and label comparison diffs pinned to projects.
- **`annotation`**: Section-level user notes and Q&A keywords (public or private).
- **`feature_gates`**: Dynamic role and guest permission matrix for feature control.
- **`system_tasks`**: Progress and logs for Celery asynchronous operations.
- **`token_usage`**: Per-user, per-model accounting of prompt and response tokens.
- **`meddra_soc`, `meddra_hlgt`, `meddra_hlt`, `meddra_pt`, `meddra_llt`**: Complete MedDRA hierarchy for adverse event matching.
- **`orange_book`**: FDA Orange Book exclusivity, patent, and RLD/RS status.
- **`drugtox_reference` & `drugtox_reports`**: Rule-of-Two liver toxicity ratings and generated toxicology assessment reports.

---

## 4. Schema Initialization and Migrations

Schema management follows a dual approach:
1. **Application Tables (`public`)**: Created automatically on application startup in `backend/dashboard/__init__.py::create_app()` via `db.create_all()`. Additional column upgrades (e.g. `role`, `is_active`, `api_key`) and lowercase migrations are executed idempotently in `ensure_user_schema()`.
2. **Labeling Tables (`labeling`)**: Created by running the raw DDL script:
   ```bash
   python backend/database/scripts/db_02_init_labeling_schema.py
   ```
   This script creates the `labeling` schema, core tables, and GIN `pg_trgm` indexes.
