# Database Architecture and Current Schema Reference

## 1. Purpose and scope

This document is the current technical reference for the AskFDALabel database layer. It replaces the earlier, lighter-weight notes with a code-grounded description of how persistence is actually implemented in the current application.

This report is based on the current repository sources, primarily:
- `backend/database/models.py`
- `scripts/database/pg_init_labeldb.py`
- `backend/migrations/versions/*`
- the active import and maintenance scripts under `scripts/database/` and `scripts/migration/`

The goal of this document is to describe:
- the current PostgreSQL architecture,
- how schema creation is actually split across ORM models, custom SQL, and Alembic,
- the complete set of application-owned tables expected in the current database,
- the data-loading and maintenance flows that populate those tables.

This is a schema reference for the application-owned PostgreSQL database. It does **not** treat the FDA internal Oracle objects referenced by some services, such as `druglabel.DGV_SUM_SPL`, as part of the local AskFDALabel schema. Those are external data sources, not local application tables.

## 2. Current database model

The active persistence model is a **single PostgreSQL database** with **pgvector** enabled for semantic retrieval. The application uses a **two-schema layout**:

- `public` schema: application state, user/workspace data, caches, reference datasets, toxicity and PGx datasets, AE-analysis state, Orange Book data, and vector embeddings.
- `labeling` schema: normalized Structured Product Labeling (SPL) metadata and section content used by local search and label-driven workflows.

The archived SQLite path is no longer the active architecture. Some archived scripts remain in `scripts/archive_sqlite/`, but the current codebase is clearly organized around PostgreSQL.

## 3. How the current schema is managed

The current schema is **not** managed by a single mechanism. It is split across three sources of truth.

### 3.1 ORM-managed tables

Most application tables are declared in `backend/database/models.py` and are created through SQLAlchemy / Flask-SQLAlchemy via `db.create_all()`.

This includes nearly all `public` schema tables and three `labeling` schema tables:
- `labeling.sum_spl`
- `labeling.spl_sections`
- `labeling.active_ingredients_map`

### 3.2 Custom SQL-managed labeling objects

`backend/database/scripts/db_02_init_labeling_schema.py` is authoritative for the **full** `labeling` schema bootstrap. It creates:
- `labeling.sum_spl`
- `labeling.spl_sections`
- `labeling.active_ingredients_map` (including the `unii` column)
- `labeling.epc_map`
- `labeling.substance_indexing`
- `labeling.processed_zips`

It also adds or enforces labeling-specific database objects that are **not fully represented in the ORM**, especially:
- the generated `search_vector` column on `labeling.spl_sections`
- the GIN index on `labeling.spl_sections.search_vector`
- supporting indexes for `sum_spl`, `spl_sections`, `active_ingredients_map`, and `epc_map`
- `IDENTITY` column properties for primary keys to ensure consistent auto-increment behavior across different machine environments.

This means the ORM alone does **not** fully describe the `labeling` schema.

### 3.3 Alembic-managed incremental migrations

Alembic is present and active, but only a small number of changes are currently tracked in migrations.

Current revisions in `backend/migrations/versions/`:
- `41e1e18194c9` — makes `label_annotation.project_id` nullable
- `cbaf12977b82` — adds `faers_1yr_count` and `faers_5yr_count` to `project_ae_report_detail` and adjusts lengths on selected `favorite` columns

The practical consequence is important: the database is currently managed through a **hybrid model** of ORM bootstrap, custom SQL bootstrap, and limited Alembic deltas.

## 4. Complete current table inventory

Based on the current source-defined schema, the application owns **35 primary tables**:
- **30** in `public`
- **5** in `labeling`

In addition, a database that has been migrated with Alembic will typically also contain the Alembic metadata table:
- `public.alembic_version`

That table is migration metadata rather than application domain data, so it is documented separately from the 35 application tables.

### 4.1 Flat inventory by schema

#### `public` schema (30 tables)

```text
public.ae_ai_assessment
public.annotation
public.comparison_summary
public.dict_assessment
public.dili_assessment
public.diri_assessment
public.drug_toxicity
public.favorite
public.favorite_comparison
public.label_annotation
public.label_embeddings
public.meddra_hlgt
public.meddra_hlt
public.meddra_llt
public.meddra_mdhier
public.meddra_pt
public.meddra_smq_content
public.meddra_smq_list
public.meddra_soc
public.orange_book
public.pgx_assessment
public.pgx_biomarker
public.pgx_synonym
public.project
public.project_ae_report
public.project_ae_report_detail
public.project_users
public.system_tasks
public.tox_agent
public.user
```

#### `labeling` schema (5 tables)

```text
labeling.active_ingredients_map
labeling.epc_map
labeling.processed_zips
labeling.spl_sections
labeling.sum_spl
```

#### Migration metadata table (typically present when Alembic has run)

```text
public.alembic_version
```

## 5. Table reference by functional domain

### 5.1 Identity, workspace, and user content (`public`)

#### `user`
Primary identity table for local authentication and per-user AI configuration.

Key columns:
- `id`
- `username`
- `password_hash`
- `is_admin`
- `ai_provider`
- `custom_gemini_key`
- `openai_api_key`
- `openai_base_url`
- `openai_model_name`

#### `project`
Workspace container used to organize user-saved labels, comparisons, and AE-analysis work.

Key columns:
- `id`
- `title`
- `description`
- `owner_id`
- `share_code`
- `display_order`
- `created_at`

#### `project_users`
Many-to-many join table connecting shared projects to participating users.

Key columns:
- `project_id`
- `user_id`

#### `favorite`
Stores user-saved label records and cached label metadata associated with a project.

Key columns:
- `id`
- `user_id`
- `project_id`
- `set_id`
- `brand_name`
- `generic_name`
- `manufacturer_name`
- `market_category`
- `application_number`
- `ndc`
- `effective_time`
- `active_ingredients`
- `labeling_type`
- `dosage_forms`
- `routes`
- `epc`
- `fdalabel_link`
- `dailymed_spl_link`
- `dailymed_pdf_link`
- `product_type`
- `label_format`
- `source`
- `timestamp`

#### `annotation`
Stores user-authored question/answer annotations against label sections.

Key columns:
- `id`
- `user_id`
- `set_id`
- `section_number`
- `question`
- `answer`
- `keywords`
- `is_public`
- `timestamp`

#### `favorite_comparison`
Stores saved comparison sets of one or more labels.

Key columns:
- `id`
- `user_id`
- `project_id`
- `set_ids`
- `title`
- `timestamp`

#### `label_annotation`
Stores highlighted spans and comments created directly against label text.

Key columns:
- `id`
- `project_id`
- `set_id`
- `user_id`
- `section_id`
- `start_offset`
- `end_offset`
- `selected_text`
- `annotation_type`
- `color`
- `comment`
- `created_at`

#### `comparison_summary`
Caches LLM-generated summaries for multi-label comparisons, keyed by a hash of the compared set IDs.

Key columns:
- `id`
- `set_ids_hash`
- `set_ids`
- `summary_content`
- `timestamp`

### 5.2 AE-analysis workflow and operational state (`public`)

#### `project_ae_report`
Header table for project-level adverse-event analysis jobs.

Key columns:
- `id`
- `project_id`
- `target_pt`
- `status`
- `progress`
- `total_labels`
- `processed_labels`
- `created_at`
- `completed_at`

#### `project_ae_report_detail`
Detail rows for label-by-label AE analysis results associated with a `project_ae_report`.

Key columns:
- `id`
- `report_id`
- `set_id`
- `brand_name`
- `generic_name`
- `is_labeled`
- `found_sections`
- `faers_count`
- `faers_1yr_count`
- `faers_5yr_count`
- `faers_serious_count`

#### `ae_ai_assessment`
Stores AI-generated adverse-event analysis output as JSON-like text payloads.

Key columns:
- `id`
- `set_id`
- `drug_name`
- `result_json`
- `min_count`
- `timestamp`

#### `system_tasks`
Tracks administrative and long-running background data tasks such as label ingestion and Orange Book import.

Key columns:
- `id`
- `task_type`
- `status`
- `progress`
- `message`
- `error_details`
- `created_at`
- `updated_at`
- `completed_at`

### 5.3 Drug toxicity and assessment caches (`public`)

#### `drug_toxicity`
Imported toxicity dataset used by the DrugTox feature and related analyses.

Key columns:
- `id`
- `SETID`
- `Trade_Name`
- `Generic_Proper_Names`
- `Toxicity_Class`
- `Author_Organization`
- `Tox_Type`
- `SPL_Effective_Time`
- `Changed`
- `is_historical`
- `Update_Notes`
- `AI_Summary`

#### `dili_assessment`
Stores DILI narrative/report content by `set_id`.

Key columns:
- `id`
- `set_id`
- `report_content`
- `timestamp`

#### `dict_assessment`
Stores DICT narrative/report content by `set_id`.

Key columns:
- `id`
- `set_id`
- `report_content`
- `timestamp`

#### `diri_assessment`
Stores DIRI narrative/report content by `set_id`.

Key columns:
- `id`
- `set_id`
- `report_content`
- `timestamp`

#### `tox_agent`
Consolidated toxicity-agent output table combining label identity data and multiple toxicity assessments.

Key columns:
- `id`
- `set_id`
- `is_plr`
- `brand_name`
- `generic_name`
- `manufacturer`
- `spl_effective_time`
- `dili_report`
- `dict_report`
- `diri_report`
- `last_updated`
- `update_notes`
- `status`
- `current`

### 5.4 MedDRA dictionary tables (`public`)

These tables are populated by `scripts/migration/01_import_meddra.py` and support FAERS-oriented analysis and term enrichment.

#### `meddra_soc`
System Organ Class master table.

#### `meddra_hlgt`
High Level Group Term master table.

#### `meddra_hlt`
High Level Term master table.

#### `meddra_pt`
Preferred Term master table.

#### `meddra_llt`
Lowest Level Term master table, linked to `meddra_pt`.

#### `meddra_mdhier`
Hierarchy mapping between PT, HLT, HLGT, and SOC.

#### `meddra_smq_list`
Standardized MedDRA Query (SMQ) definition table.

#### `meddra_smq_content`
SMQ membership and term-content mapping table.

### 5.5 PGx and regulatory reference tables (`public`)

#### `pgx_biomarker`
Imported FDA pharmacogenomic biomarker records.

Key columns:
- `id`
- `drug_name`
- `therapeutic_area`
- `biomarker_name`
- `labeling_sections`
- `timestamp`

#### `pgx_synonym`
Normalized search synonym map for PGx biomarker lookup.

Key columns:
- `id`
- `term`
- `normalized_name`

#### `pgx_assessment`
Cached AI-generated PGx assessment content by `set_id`.

Key columns:
- `id`
- `set_id`
- `report_content`
- `timestamp`

#### `orange_book`
Imported Orange Book product records used for RLD/RS and approval-oriented enrichment.

Key columns:
- `id`
- `ingredient`
- `df_route`
- `trade_name`
- `applicant`
- `strength`
- `appl_type`
- `appl_no`
- `product_no`
- `te_code`
- `approval_date`
- `rld`
- `rs`
- `type`
- `applicant_full_name`

### 5.6 Semantic retrieval and embeddings (`public`)

#### `label_embeddings`
Vector-search table for chunked SPL content embeddings.

Key columns:
- `id`
- `set_id`
- `spl_id`
- `section_title`
- `loinc_code`
- `chunk_index`
- `chunk_text`
- `embedding`
- `created_at`

This table depends on the PostgreSQL `vector` extension and is the semantic retrieval backbone for the current search stack.

### 5.7 Core SPL storage (`labeling`)

#### `labeling.sum_spl`
Primary label metadata table. One row per SPL document instance.

Key columns:
- `spl_id`
- `set_id`
- `product_names`
- `generic_names`
- `manufacturer`
- `appr_num`
- `active_ingredients`
- `market_categories`
- `doc_type`
- `routes`
- `dosage_forms`
- `epc`
- `ndc_codes`
- `revised_date`
- `initial_approval_year`
- `is_rld`
- `is_rs`
- `local_path`

#### `labeling.spl_sections`
Stores section-level SPL content. This is the key table for full-text and semantic section retrieval.

Key columns:
- `id`
- `spl_id`
- `loinc_code`
- `title`
- `content_xml`
- `search_vector` *(generated column added by `pg_init_labeldb.py`)*

#### `labeling.active_ingredients_map`
Normalized active ingredient mapping table per SPL.

Key columns:
- `id`
- `spl_id`
- `substance_name`
- `is_active`

#### `labeling.epc_map`
Additional normalized EPC term mapping table.

Key columns:
- `id`
- `spl_id`
- `epc_term`

This table is currently created by `scripts/database/pg_init_labeldb.py` and is **not** represented by an ORM model.

#### `labeling.processed_zips`
Tracks previously imported DailyMed ZIP files.

Key columns:
- `zip_name`
- `processed_at`

This table is also created by `scripts/database/pg_init_labeldb.py` and is **not** represented by an ORM model.

## 6. Non-table database objects that matter operationally

The current system depends on several non-table database objects and behaviors that should be considered part of the effective database design.

### 6.1 Extensions

#### `vector`
Required for `label_embeddings.embedding` and semantic retrieval.

Provisioning script:
- `scripts/database/enable_pgvector.py`

### 6.2 Generated columns and search indexes

#### `labeling.spl_sections.search_vector`
A stored generated `tsvector` column derived from `content_xml`.

Provisioning source:
- `scripts/database/pg_init_labeldb.py`

#### `idx_spl_sections_fts`
GIN index on `labeling.spl_sections.search_vector`.

This is critical for local keyword/full-text search performance.

### 6.3 Vector index

#### `label_embeddings_embedding_idx`
Optional HNSW index created by `scripts/ai/create_vector_index.py`.

This is critical for production-grade semantic retrieval performance but is not automatically created by the ORM.

## 7. Initialization and migration sequence

Because the schema is hybrid-managed, database setup should be understood as a sequence rather than a single command.

### 7.1 Recommended clean bootstrap order

The project uses a numbered sequence of scripts in `backend/database/scripts/` to ensure all components are initialized in the correct order. These scripts are idempotent and can be run safely on new or existing environments.

1.  **Enable pgvector**: `python backend/database/scripts/db_01_enable_pgvector.py`
2.  **Initialize Labeling Schema**: `python backend/database/scripts/db_02_init_labeling_schema.py`
3.  **Initialize Public Schema**: `python backend/database/scripts/db_03_init_public_schema.py`
4.  **Import Orange Book**: `python backend/database/scripts/db_04_import_orange_book.py`
5.  **Import EPC Indexing**: `python backend/database/scripts/db_05_import_epc_indexing.py`
6.  **Create Admin User**: `python backend/database/scripts/db_06_create_admin.py`
7.  **Import Labels (ZIP)**: `python backend/database/scripts/db_07_import_labels.py` (use `--force` to re-populate UNII/EPC fields)
8.  **Import Archived Labels (Raw XML)**: `python backend/database/scripts/db_08_import_archive_labels.py` (alternative to step 7 if using unzipped XML files in `spl_storage_archived`)

### 7.2 Why the order matters

The order matters because the application startup path calls `db.create_all()`, while the `labeling` schema also depends on custom DDL not fully expressed in the ORM. A clean setup that skips `pg_init_labeldb.py` can leave the system without:
- `labeling.epc_map`
- `labeling.processed_zips`
- `labeling.spl_sections.search_vector`
- the full-text GIN index on `spl_sections`

For that reason, `pg_init_labeldb.py` should be treated as the authoritative bootstrap for the `labeling` schema.

## 8. Data population flows

### 8.1 SPL label data

Primary scripts:
- `backend/database/scripts/db_07_import_labels.py` (for zipped SPL packaging files)
- `backend/database/scripts/db_08_import_archive_labels.py` (for raw unzipped XML archive files)
- `backend/admin/tasks/import_labels.py`

Target tables:
- `labeling.sum_spl`
- `labeling.spl_sections`
- `labeling.active_ingredients_map` (populates `unii`)
- `labeling.processed_zips`

Important note: the standalone `db_07_import_labels.py` and `db_08_import_archive_labels.py` paths are currently the more complete schema-aware flows because they explicitly fall back to `db_02_init_labeling_schema.py`.

### 8.2 MedDRA

Primary script:
- `scripts/migration/01_import_meddra.py`

Target tables:
- all `meddra_*` tables listed above

### 8.3 PGx

Primary script:
- `scripts/migration/02_import_pgx.py`

Target tables:
- `pgx_biomarker`
- `pgx_synonym`

### 8.4 DrugTox

Primary script:
- `scripts/migration/03_import_drugtox.py`

Target table:
- `drug_toxicity`

### 8.5 Orange Book

Primary script:
- `scripts/database/import_orange_book.py`

Target table:
- `orange_book`

### 8.6 Embeddings

Primary scripts:
- `scripts/ai/sync_label_embeddings.py`
- `scripts/database/pg_import_embeddings_v2.py`
- `scripts/ai/create_vector_index.py`

Target table:
- `label_embeddings`

## 9. Label Metadata and EPC Borrowing Logic

The application implements a "borrowing" strategy for clinical metadata, particularly the Established Pharmacologic Class (EPC), which is often missing from specific manufacturer labels.

### 9.1 EPC Borrowing Strategy

When a label's `epc` field is empty or 'N/A', the system attempts to find a related label to "borrow" the EPC from. This is critical for comparative analytical features like the "Deep Dive" peer analysis.

The borrowing sequence is:
1.  **Search by Application Number (`appr_num`):** The system looks for other labels in `labeling.sum_spl` with the exact same application number that have a populated `epc` field. This is the highest-confidence match (e.g., matching a generic to its RLD or other generics in the same approval).
2.  **Search by Generic Name (`generic_names`):** If no match is found by application number, the system searches for other labels with a matching generic name (using `ILIKE` on `generic_names`) that have a populated `epc` field.

### 9.2 Implementation in Services

-   **`DeepDiveService._borrow_epc`**: Implements the logic described above for statistical peer sampling.
-   **`api_bp` (Dashboard Routes)**: Utilizes `get_rich_metadata_by_generic` as a fallback when initial metadata is sparse.

### 9.3 SPL ID Search Priority Matching Logic

The local search implementation (`local_search` in `FDALabelDBService`) uses a two-tiered priority system to retrieve labels from the `labeling.sum_spl` metadata table:

1.  **Priority 1: Exact SPL ID Match:**
    If the search term is a valid UUID/SPL ID, it executes a query targeting `spl_id = %(sid)s`. This query intentionally **omits/relaxes** the `is_latest = TRUE` constraint. This allows the system to discover and load historical or archived versions of a specific labeling document.
2.  **Priority 2: Text/Approval Number Match:**
    If no matches are found for the exact SPL ID, it executes a fallback keyword search matching the term against product names, generic names, set ID, or approval/application number. This query **enforces** `is_latest = TRUE` to ensure search results are not cluttered by multiple old versions of the same product.

## 10. Current architectural observations and caveats

### 9.1 Schema management is partially fragmented

The schema is currently split across ORM models, custom SQL, and a small Alembic history. This works, but it means developers should not assume that `db.create_all()` alone produces the complete operational database.

### 9.2 The `labeling` schema is only partially represented in ORM models

The ORM models cover `sum_spl`, `spl_sections`, and `active_ingredients_map`, but not:
- `epc_map`
- `processed_zips`
- `spl_sections.search_vector`
- the associated search indexes

### 9.3 Some database utility scripts are now historical backfill tools

Examples:
- `scripts/database/add_is_admin_column.py`
- `scripts/database/fix_favorite_columns.py`

These reflect earlier schema drift and upgrade needs. They are useful for repairing older databases, but they should not be treated as the primary bootstrap path for a clean installation.

### 9.4 External Oracle objects are not local schema objects

Several services still query FDA internal Oracle objects such as `druglabel.DGV_SUM_SPL` and related tables/views. Those objects remain important to application behavior, but they are **external dependencies**, not part of the local PostgreSQL schema described in this document.

## 10. Recommended follow-on documentation

This document should be read together with:
- `Documents/Architecture.md` for system topology and request flow
- `Documents/Backend.md` for blueprint and service ownership
- a future `Documents/Data-Sources.md` for source-system lineage and import provenance
- a future `Documents/AI-and-Search.md` for vector retrieval and semantic search pipeline details

## Appendix A. Short reference: all current application tables

```text
public.ae_ai_assessment
public.annotation
public.comparison_summary
public.dict_assessment
public.dili_assessment
public.diri_assessment
public.drug_toxicity
public.favorite
public.favorite_comparison
public.label_annotation
public.label_embeddings
public.meddra_hlgt
public.meddra_hlt
public.meddra_llt
public.meddra_mdhier
public.meddra_pt
public.meddra_smq_content
public.meddra_smq_list
public.meddra_soc
public.orange_book
public.pgx_assessment
public.pgx_biomarker
public.pgx_synonym
public.project
public.project_ae_report
public.project_ae_report_detail
public.project_users
public.system_tasks
public.tox_agent
public.user
labeling.active_ingredients_map
labeling.epc_map
labeling.processed_zips
labeling.spl_sections
labeling.sum_spl
```

## Appendix B. Schema ownership summary

| Object class | Primary source |
|---|---|
| Most `public` tables | `backend/database/models.py` |
| `labeling.sum_spl`, `labeling.spl_sections`, `labeling.active_ingredients_map`, `labeling.substance_indexing` | Both ORM and `db_02_init_labeling_schema.py` |
| `labeling.epc_map`, `labeling.processed_zips` | `backend/database/scripts/db_02_init_labeling_schema.py` only |
| `labeling.spl_sections.search_vector` and full-text index | `backend/database/scripts/db_02_init_labeling_schema.py` only |
| Incremental public-schema changes | `backend/migrations/versions/*` |
| Vector extension and HNSW index | `backend/database/scripts/db_01_enable_pgvector.py`, `scripts/ai/create_vector_index.py` |
