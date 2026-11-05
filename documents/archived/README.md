# Archived & Superseded Documentation

> [!WARNING]
> **HISTORICAL ARCHIVE**: The documents in this section describe legacy components, retired architectures, and superseded design ideas from earlier versions of AskFDALabel. They are preserved for historical provenance and regulatory reference, but do **not** reflect current production implementation.

---

## Inventory of Retired & Superseded Features

### 1. Document-Level Full-Text Search (TSVECTOR) & Vector Search
- **Document**: [full_text_and_vector_search.md](file:///d:/Coding/askFDALabel_v5/documents/archived/full_text_and_vector_search.md)
- **Status**: **REMOVED**
- **Rationale**: Storing raw section texts in `labeling.spl_sections` and maintaining PostgreSQL `TSVECTOR` search vectors (`full_search_vector`) created massive database bloat (400+ GB) at 700k-label scale. This was removed via `db_12_drop_fulltext_search.py`. Active search uses `pg_trgm` GIN indexes over label metadata and reads XML dynamically from disk.
- **Agentic Pipeline**: The old `semantic_core/` multi-agent orchestrator was replaced with a lightweight DB classification tree in `backend/search/blueprint.py`.

### 2. Legacy SQLite Architecture (`afd.db`)
- **Document**: [legacy_sqlite_architecture.md](file:///d:/Coding/askFDALabel_v5/documents/archived/legacy_sqlite_architecture.md)
- **Status**: **REMOVED**
- **Rationale**: Early proof-of-concept versions used local SQLite database files (`afd.db`). Concurrency limitations, lack of schema separation, and lock contention led to full consolidation into PostgreSQL.

### 3. Dynamic DailyMed Web Fallback
- **Status**: **REMOVED**
- **Rationale**: Dynamically fetching labels via DailyMed's public HTTP API caused severe version skew, as DailyMed only accepts `set_id` and silently returned the latest label when historical versions were requested. Replaced by the deterministic local file cascade and Oracle fallback (`resolve_spl_xml`).

### 4. PostgreSQL `CITEXT` Username Extension
- **Status**: **MIGRATED**
- **Rationale**: Requiring PostgreSQL `CREATE EXTENSION citext` failed on remote cloud or restricted-privilege database hosts. Migrated to standard lowercase `VARCHAR(100)` with automatic startup schema self-healing.
