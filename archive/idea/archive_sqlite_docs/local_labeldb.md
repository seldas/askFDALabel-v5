# Local PostgreSQL Labeling Database Implementation

## 🎯 Goal
Implement a PostgreSQL-based labeling schema (`labeling`) within the main database to serve as a high-performance, scalable alternative to the FDALabel Oracle database. This supports `search_v2_core` and the `FDALabelDBService` for local/production environments.

## 🏗️ Architecture (Hybrid Metadata + Filesystem)
The system uses a hybrid approach to optimize both search speed and storage efficiency:
- **Metadata Schema:** `labeling` schema in PostgreSQL. Stores indexed metadata for fast filtering and joins.
- **Content Storage:** `data/spl_storage/`. Stores individual SPL ZIP files extracted from DailyMed.
- **Engine:** PostgreSQL with GIN indexes (and optional `pg_trgm` / `tsvector`) for high-speed clinical keyword search.
- **Trigger:** Configured via `LABEL_DB=POSTGRES` in `.env`.
- **Detection:** `DB_TYPE` is dynamically determined in `config.py` based on environment variables.

## ⚖️ Rationale: PostgreSQL vs. SQLite
The transition from SQLite to PostgreSQL was driven by several factors:
- **Concurrency:** PostgreSQL handles multiple simultaneous search and ingestion tasks far more robustly than SQLite.
- **Vector Support:** Native integration with `pgvector` allows for future semantic search capabilities within the same database instance.
- **Schema Management:** Using a dedicated `labeling` schema keeps the core application data (`public`) separate from the large-scale labeling repository.
- **Performance:** PostgreSQL's advanced indexing (GIN/GIST) provides superior performance for complex medical queries compared to SQLite's FTS5 in large-scale datasets.

## 📊 Schema Design (Schema: `labeling`)

### 1. `sum_spl` (Metadata Table)
Primary table for drug metadata and filtering.
- `spl_id` (TEXT, PK), `set_id` (TEXT), `product_names` (TEXT), `generic_names` (TEXT)
- `manufacturer` (TEXT), `appr_num` (TEXT), `active_ingredients` (TEXT)
- `doc_type` (TEXT), `routes` (TEXT), `dosage_forms` (TEXT), `revised_date` (TEXT)
- `is_rld` (INTEGER), `is_rs` (INTEGER)
- **`local_path`**: Relative path to the ZIP file in `data/spl_storage/`.

### 2. `spl_sections` (Content Table)
- Stores raw XML fragments (`content_xml`) for near-instant UI rendering of specific sections.
- Indexed for fast retrieval by `spl_id` and `loinc_code`.

### 3. `active_ingredients_map` & `epc_map`
- Relational mapping tables for complex ingredient and pharmacologic class queries.

## 🚀 Search V2 Compatibility (SQL Translation)
The `sql.py` implementation uses a `SQLManager` to dynamically switch dialects:
- **Case Insensitivity:** Uses `ILIKE` in PostgreSQL vs. `UPPER()` in Oracle.
- **Array Handling:** Uses `ANY(%(list)s)` for efficient multi-value filtering.
- **Table Names:** Uses `labeling.` schema prefix in PostgreSQL mode.

## 🛠️ Implementation Status
1. [x] **Initialization:** `scripts/database/pg_init_labeldb.py` creates the schema and tables.
2. [x] **Ingestion:** `scripts/database/pg_import_labels.py` handles bulk DailyMed extraction and PostgreSQL ingestion.
3. [x] **Service Integration:** `backend/dashboard/services/fdalabel_db.py` updated for PostgreSQL/psycopg2.
4. [x] **Search Core Update:** `search_v2_core/sql.py` refactored for PostgreSQL dialect.

## 🏁 Setup: Step-by-Step

### 1. Initialize the Database
```powershell
python scripts/database/pg_init_labeldb.py
```

### 2. Run the Ingestion
```powershell
python scripts/database/pg_import_labels.py --storage_dir data/spl_storage --filter human
```

### 3. Configuration (.env)
```env
LABEL_DB=POSTGRES
DATABASE_URL=postgresql://user:password@localhost:5432/askfdalabel
```

## 📋 Performance Observations
- **Indexing:** GIN indexes on `product_names` and `generic_names` provide sub-millisecond prefix/substring search.
- **Scalability:** Confirmed stable performance with 400,000+ labeling records.
