# [SUPERSEDED] Document-Level Full-Text Search & Vector Agent Pipeline

> [!WARNING]
> **SUPERSEDED ARCHITECTURE**: This document describes the legacy full-text search vector system (`full_search_vector`, `labeling.spl_sections`) and the multi-agent semantic search pipeline (`semantic_core/`). Both were decommissioned in AskFDALabel v5 to keep database scale manageable and remove unnecessary complexity.
>
> **Current Replacement**:
> - Full text is parsed dynamically from local SPL XML on disk (`sum_spl.local_path`).
> - Field and metadata filtering uses PostgreSQL `pg_trgm` GIN indexes.
> - Search routing uses a fast DB classification decision tree in `backend/search/blueprint.py`.

---

## Historical Context: The `full_search_vector` Migration

In earlier iterations, the platform experimented with pre-computing document-level `TSVECTOR` columns to avoid scanning multi-million-row section tables during broad text queries.

### Legacy Configuration:
- Table: `labeling.sum_spl`
- Column: `full_search_vector TSVECTOR`
- Script: `db_10_populate_full_search_vector.py`
- Query Pattern:
  ```sql
  SELECT set_id FROM labeling.sum_spl
  WHERE full_search_vector @@ to_tsquery('english', 'cardiovascular & warning')
  ```

### Why It Was Retired:
1. **Excessive Storage Overhead**: At a scale of over 700,000 label revisions, the full-text search vectors combined with the uncompressed `spl_sections` table consumed over 400 GB of disk space.
2. **Vacuum & Index Stalls**: PostgreSQL GIN maintenance and autovacuum operations on massive TSVECTOR tables caused periodic query stalls during live production use.
3. **The `db_12` Migration**: `backend/database/scripts/db_12_drop_fulltext_search.py` was deployed as a one-way migration that dropped `spl_sections` and `full_search_vector`, instantly shrinking database size by ~85% while delivering faster criteria queries via `pg_trgm`.

---

## Historical Context: The Multi-Agent Semantic Pipeline

The platform previously contained an experimental agentic retrieval architecture (`semantic_core/`):
- Multi-step planning, reranking, and agent registries.
- Heavy vector embedding generation across all labeling sections.

### Why It Was Simplified:
Regulatory users primarily perform deterministic, audit-traceable searches (exact approval numbers, established pharmacologic classes, MedDRA terms). The multi-agent pipeline added latency and non-deterministic behavior without improving regulatory precision. It was replaced by the streamlined DB-first router (`_classify_query`) and direct AI synthesis on verified label XML.
