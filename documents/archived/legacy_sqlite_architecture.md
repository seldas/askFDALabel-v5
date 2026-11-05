# [SUPERSEDED] Legacy SQLite Architecture (`afd.db`)

> [!WARNING]
> **RETIRED ARCHITECTURE**: This document outlines the early monolithic SQLite architecture (`afd.db`). AskFDALabel has completely migrated to a dual-schema PostgreSQL database. SQLite is no longer used anywhere in the runtime or maintenance workflows.

---

## Historical Context

In early versions of the tool, application state, drug metadata, and section chunks were stored inside a single file-based SQLite database named `afd.db`.

### Architectural Limitations of SQLite:
1. **Concurrent Write Bottlenecks**: High-concurrency environments with multiple analysts and background import tasks suffered from SQLite `database is locked` errors.
2. **Lack of Schema Separation**: SQLite lacked robust schema namespace separation, preventing a clean architectural boundary between application data (`public`) and regulatory metadata (`labeling`).
3. **Advanced Indexing**: SQLite could not support PostgreSQL's `pg_trgm` GIN indexes for fast fuzzy regulatory term searching.

### The Consolidation Plan:
The migration from SQLite to PostgreSQL was executed by:
1. Normalizing drug metadata into the `labeling` schema (`sum_spl`).
2. Moving user accounts, projects, and annotations into the `public` schema.
3. Completely removing SQLite drivers and file dependencies from the Flask backend.
