# askFDALabel-Suite Scripts Portfolio

This directory contains categorized scripts for backend management, data synchronization, AI maintenance, and debugging.

## 📂 1. Database Management (`scripts/database/`)
*   **`pg_utils.py`**: **[Core]** Centralized utility for PostgreSQL connections and bulk operations using `execute_values`.
*   **`pg_init_labeldb.py`**: Initializes the `labeling` schema and associated tables (sum_spl, spl_sections, etc.) in PostgreSQL.
*   **`pg_import_labels.py`**: Directly synchronizes SPL XML files from `data/uploads/` into the PostgreSQL `labeling` schema.
*   **`pg_import_csv.py`**: **[Generic]** Versatile tool for importing any CSV data into a specified PostgreSQL table/schema.
*   **`pg_fix_identity.py`**: Converts standard `INTEGER` primary keys to PostgreSQL `IDENTITY` columns and synchronizes sequences.
*   **`list_tables_pg.py`**: Lists all tables and row counts across both `public` and `labeling` schemas in PostgreSQL.
*   **`check_schema.py`**: Validates current PostgreSQL table definitions and dimensions.

## 📂 2. Label Data Pipeline (`scripts/labels/`)
*   **`download_dailymed.py`**: Bulk downloads drug labeling SPL files from DailyMed.





## 📂 3. AI & Embeddings (`scripts/ai/`)
*   **`sync_label_embeddings.py`**: **[High Performance]** Multi-GPU (8x V100) script to generate and sync embeddings for new label data.
*   **`create_vector_index.py`**: **[New]** Applies HNSW indexing to the `label_embeddings` table for sub-second vector search latency.
*   **`test_local_embedding.py`**: Verifies the `sentence-transformers` installation and local model vector generation.
*   **`test_embedding.py`**: Generic test for embedding API connectivity (Gemini/Llama).
*   **`check_pg_vector.py`**: Validates the presence and status of the `pgvector` extension in PostgreSQL.

## 📂 4. Maintenance & Utilities (`scripts/utils/`)
*   **`check_users.py` / `check_projects.py`**: Diagnostic tools for inspecting user accounts and collaborative projects.

*   **`gen_drugsnippet.py`**: Generates high-speed lookup tries for drug name highlighting in the UI.
*   **`update_tox_agent.py`**: Updates the toxicity knowledge base for the askDrugTox agent.
*   **`list_gemini_models.py`**: Lists all available models for the configured Google API key.

## 📂 5. Archive & Migration (`scripts/archive/`)
*   **`migrate_to_postgres.py`**: (Archived) One-time use script historically used to port SQLite data into the unified PostgreSQL instance.
*   **`populate_embeddings.py`**: Original legacy script for initial embedding generation.

---
*Note: Most scripts require the root `.env` file to be correctly configured with `DATABASE_URL` and `LOCAL_EMBEDDING_MODEL_ID`.*
