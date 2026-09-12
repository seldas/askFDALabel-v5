# Database Initialization & Data Ingestion Runbook

## 1. Overview

Database initialization scripts are numbered, idempotent, and located under `backend/database/scripts/`. They should be executed from the **repository root** with the Python environment active.

---

## 2. Standard Initialization Sequence

```bash
# 1. Initialize labeling schema DDL and pg_trgm GIN indexes
python backend/database/scripts/db_02_init_labeling_schema.py

# 2. Initialize public application schema and tables
python backend/database/scripts/db_03_init_public_schema.py

# 3. Import FDA Orange Book (RLD and RS reference flags)
python backend/database/scripts/db_04_import_orange_book.py

# 4. Import Established Pharmacologic Class (EPC) and Substance Indexing
python backend/database/scripts/db_05_import_epc_indexing.py

# 5. Create default administrator account (username: admin)
python backend/database/scripts/db_06_create_admin.py

# 6. Import DailyMed SPL Labels (bulk archive ingestion)
python backend/database/scripts/db_07_import_labels.py --skip-unpack

# 7. Import Drug-Induced Liver Injury (DILI) Rule-of-Two reference set
python backend/database/scripts/db_11_import_dili_reference.py
```

---

## 3. Supplementary Scripts

### Ingesting Historical Archive Labels (`db_08`)
To ingest bare `.xml` files from archived SPL datasets into `labeling.sum_spl`:
```bash
python backend/database/scripts/db_08_import_archive_labels.py
```

### Dropping Legacy Full-Text Search Vectors (`db_12`)
For databases upgraded from older AskFDALabel versions that still hold full-text search columns (`spl_sections`, `search_vector TSVECTOR`, `sum_spl.full_search_vector`):
```bash
python backend/database/scripts/db_12_drop_fulltext_search.py
```
This is a one-way migration that reclaims hundreds of gigabytes of disk space and aligns the database with the modern v5 schema.
