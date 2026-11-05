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

Imports preserve the XML `<versionNumber>` and deduplicate by SPL ID. Revision history
orders by `revised_date` first; only records on the same date need XML versions to break
ties. Import time and UUID order never establish revision order. Timelines show every
SPL on the same date, and comparisons use the stored `parent_spl_id`.

The optimized repair command has two phases:

1. PostgreSQL identifies `(set_id, revised_date)` groups containing multiple SPL IDs.
   Only these candidates have their exact local XML/cache read. Python fetches candidates
   in bounded batches and reports a progress bar, completed/total counts, elapsed time,
   and ETA. Missing or invalid candidate XML produces an unknown version.
2. Metadata-only batches recalculate lineage using dates, then versions for same-day
   ties. No XML is loaded for unique-date records, and their stored versions are not
   revalidated by this command. Progress is reported in Set IDs. Only changed parent
   and latest flags are written. A `--set-id` scope restricts both phases' source queries.

```bash
# Read-only audit
python backend/database/scripts/db_13_repair_spl_versions.py
# Apply, with bounded batches (default batch size: 100)
python backend/database/scripts/db_13_repair_spl_versions.py --apply --batch-size 100
# Restrict both phases to one Set ID
python backend/database/scripts/db_13_repair_spl_versions.py --set-id SET_ID --apply
```

Apply writes JSONL backups of changed values to `data/version_repair/before-*.jsonl`
before each write batch. It uses short transactions and row locks for lineage batches,
not a database-wide table lock. Version updates skip concurrent changes to audited
identity, date, version, or file paths and report conflicts; rerun to re-audit conflicts.
Commits occur per batch, so an interrupted run may have applied earlier batches.
Rerunning is safe and writes only remaining differences. Planning still scans database
metadata, but never loads all SPL rows or XML into Python memory.

A same-day group with unknown, nonpositive, or duplicate versions has uncertain order:
its members get no automatic parent, and none is marked latest if it is the newest day.
A later unambiguous day can still be latest, but its first record is not automatically
linked to an ambiguous preceding group. Missing revision dates also prevent a reliable
latest designation. Unknown versions on distinct known dates do not block date ordering.
The latest flag means latest **stored** SPL, not completeness of the publication archive.

The script does not fetch Oracle/DailyMed or substitute sibling XML. Previously skipped
same-day records must still be imported from their available source files. Audit lineage
counts use stored versions; apply rechecks lineage after the same-day XML corrections.
