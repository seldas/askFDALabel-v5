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
# Repairing SPL revision history

SPL `version_number` is the root XML `<versionNumber>` value. It is never generated
from revision dates, import timestamps, or UUID order. Missing/invalid values are NULL.
All label import paths preserve this value and deduplicate by SPL ID, allowing multiple
SPL documents on the same date. Timelines show every document in a date cell, labeled
**SPL version**, with unknown/ambiguous order flagged. Version numbers are meaningful
within a Set ID, not across all products under an application number.

Older archive/admin imports overwrote version numbers with archive row numbers. Audit
and repair them using exact local XML or SPL-ID cache files:

```bash
python backend/database/scripts/db_13_repair_spl_versions.py
python backend/database/scripts/db_13_repair_spl_versions.py --apply
# Optional: restrict audit/repair to one Set ID
python backend/database/scripts/db_13_repair_spl_versions.py --set-id SET_ID --apply
```

The default audit is read-only. Apply writes original versions, parent IDs, latest flags,
and storage paths to `data/version_repair/before-*.json` before changes. It checks XML
document/set IDs and refuses to commit if records changed during the audit. It does not
substitute another version or fetch Oracle/DailyMed content. Unverifiable versions become
NULL. For a Set ID with any unknown/duplicate version, automatic parent/latest flags are
cleared and automatic comparisons are disabled; this can exclude that set from queries
restricted to `is_latest`. Reimport its exact XML to restore verified lineage. Previously
skipped same-day documents need to be imported from their available source files.

For unambiguous sets, parents follow ascending XML version number, allowing gaps in
the locally stored sequence. The highest known version is the latest **stored** SPL;
this does not assert that all published versions are present locally.
