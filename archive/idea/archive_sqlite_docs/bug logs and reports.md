# Bug Logs and Reports - Session Summary (March 4, 2026)

## ✅ 1. PROD Backend Port Issue
**Problem:** Frontend hardcoded to 8842 in production environments.
**Status:** Resolved (Documentation).
**Solution:** 
- Next.js rewrites are build-time operations. 
- Ensured `.env` must be present during `next build` or `BACKEND_PORT` passed as an environment variable.
- Verified path resolution in `next.config.ts`.

## ✅ 2. search_v2 Oracle Version Fallback
**Problem:** System defaulted to Oracle schema even when using local SQLite.
**Status:** Resolved (Documentation).
**Solution:** 
- Confirmed `LABEL_DB=LOCAL` requirement.
- Verified that `is_internal()` and `DB_TYPE` constants are correctly evaluated at runtime/import.
- Restart of backend is mandatory after `.env` changes due to constant caching.

## ✅ 3. Missing Database Columns
**Problem:** `sqlite3.OperationalError: no such column: favorite.active_ingredients`.
**Status:** Resolved (Automation).
**Solution:** 
- Verified `scripts/database/fix_favorite_columns.py`.
- Instructions added to run this script to patch existing `afd.db` instances with new metadata columns required by the Dashboard.

## ✅ 4. Discrepancy Panel Enhancements (labelcomp & drugtox)
**Status:** Completed.
**Implementation Details:**
- **Metadata:** Updated `backend/dashboard/services/fdalabel_db.py` and `backend/labelcomp/blueprint.py` to correctly calculate and pass `is_rld` and `similarity_ratio`.
- **Label Comparison:**
    - Added "RLD" tag to metadata cards.
    - Implemented "FILTER BY SEVERITY GAP" to show only significant changes (similarity < 0.5).
- **askDrugTox:**
    - Refactored severity filters (All/High/Medium/Low) into a clean **Dropdown Panel**.
    - Set **"HIGH"** as the default view for immediate risk assessment.
    - Added **"RLD AVAILABLE ONLY"** toggle.
    - Removed redundant badges to resolve UI overlap with the Gap indicator.
- **Performance Fix (Backend):** Resolved 500 socket hang-up error in `discrepancies` route by implementing batch processing for RLD status and toxicity lookups.

## ✅ 5. AFL Agent (search_v2) Performance Optimization
**Problem:** System hung during Evidence Fetcher when processing many results (28+).
**Status:** Completed.
**Optimizations:**
- **Throttling:** QA queries now limit processing to the top 5 most relevant results.
- **Batched Retrieval:** Replaced multiple per-section DB calls with a single `IN` clause query to fetch all required LOINCs for a label at once.
- **Single-Pass Parsing:** Optimized workflow ensures each SPL XML is accessed and parsed exactly once per query.
- **Sanity Clamping:** Added stricter character limits to prevent LLM latency and context overflows.

## ✅ 6. Authoritative RLD/RS Identification (Orange Book)
**Problem:** Reference labels were not authoritative and did not differentiate between Reference Listed Drugs (RLD) and Reference Standards (RS).
**Status:** Completed.
**Implementation:**
- **Source of Truth:** Integrated official FDA Orange Book data.
- **Logic:** Updated system to match NDA/ANDA numbers against the Orange Book for distinct RLD and RS flags.
- **UI:** Added color-coded tags: **RLD (Red)** and **RS (Green)** across Label View, Comparison, and DrugTox.

### 🛠️ Steps to Implement RLD/RS Identification:
1.  **Ensure Data Presence:**
    Place the latest FDA Orange Book `products.txt` file at:
    `data\downloads\OrangeBook\EOB_Latest\products.txt`
2.  **Add Database Column:**
    Run the following command from the project root to add the `is_rs` column to your existing database:
    ```powershell
    python -c "import sqlite3; conn = sqlite3.connect('data/label.db'); cursor = conn.cursor(); cursor.execute('PRAGMA table_info(sum_spl)'); columns = [row[1] for row in cursor.fetchall()]; [cursor.execute('ALTER TABLE sum_spl ADD COLUMN is_rs INTEGER DEFAULT 0') if 'is_rs' not in columns else None]; conn.commit(); conn.close(); print('is_rs column verified/added.')"
    ```
3.  **Synchronize Reference Status:**
    Run the migration script to populate the RLD/RS flags based on the Orange Book data:
    ```bash
    python scripts/labels/fix_rld_status.py
    ```
4.  **Restart Backend:**
    Restart the Flask backend to clear any cached database metadata and enable the new UI tags.

## ✅ 7. Dynamic FDALabel Version Differentiation
**Problem:** The system showed public or internal links based solely on DB connection, without verifying if internal URLs were actually reachable by the user/server.
**Status:** Completed.
**Implementation:**
- **Backend Connectivity Check:** Updated `/api/check-fdalabel` to ping internal URLs (`https://fdalabel.fda.gov/...`) and report accessibility.
- **Header Menu:** Dynamically replaces the "Public FDALabel" link with "FDA version" and "CDER-CBER version" if they are accessible.
- **Homepage Badge:** Refactored the service card to show internal access points with distinct buttons when reachable, improving regulatory workflow efficiency.

## ✅ 8. LocalQuery Search Enhancements
**Status:** Completed.
**Implementation:**
- **Filtering:** Added "Human Prescription Only" and "RLD / RS Only" checkboxes below the search bar.
- **Backend Logic:** Refactored `local_search`, `get_random_labels`, and `get_autocomplete_suggestions` to respect these filters using `DOCUMENT_TYPE_LOINC_CODE` and `is_rld`/`is_rs` flags.
- **Consistency:** Filters are applied to Manual Search, Quick Access, and Autocomplete suggestions.

## 🚀 9. PostgreSQL & pgvector Migration (Semantic Search Infrastructure)
**Problem:** SQLite does not support scalable semantic/vector search.
**Status:** Ready for Deployment.
**Implementation:**
- **Infrastructure:** Added `docker-compose.yml` for a local PostgreSQL container with the `pgvector` extension.
- **Data Persistence:** Database files are stored locally at `./database/pgdata`.
- **Consolidation:** Migrated `afd.db` (public schema) and `label.db` (labeling schema) into a unified Postgres instance.
- **Semantic Ready:** Added `LabelEmbedding` model to `models.py` for future RAG/Semantic features.

### 🛠️ Steps to Migrate to PostgreSQL:
1.  **Install Docker Desktop** (if not already installed).
2.  **Start Postgres Container:**
    ```bash
    npm run db:start --prefix frontend
    ```
3.  **Run Migration Script:**
    Port your existing SQLite data to Postgres:
    ```bash
    python scripts/archive/migrate_to_postgres.py
    ```
4.  **Verify .env:**
    Ensure `DATABASE_URL` is set to `postgresql://afd_user:afd_password@localhost:5432/askfdalabel`.
5.  **Run System:**
    ```bash
    npm run dev:all --prefix frontend
    ```

## ✅ 10. Database Migration Optimization (SQLite to PostgreSQL)
**Problem:** `scripts/archive/migrate_to_postgres.py` was too slow on large tables (`meddra_llt`, `meddra_smq_content`, `spl_sections`), leading to a `KeyboardInterrupt` as the process appeared hung.
**Status:** Resolved (Performance Optimization).
**Solution:**
- **Bulk Insert:** Replaced standard `executemany` with `psycopg2.extras.execute_values`.
- **Chunking:** Implemented 5,000-row chunking to manage memory while maintaining high throughput.
- **Progress Logging:** Added row-count intervals (e.g., "Inserted 15000/89774...") to provide visual feedback during long migrations.
- **Encoding:** Explicitly set `client_encoding` to `UTF8` to prevent potential character set issues during transfer.
**Results:** Successfully migrated over 400,000 rows across all schemas. Verified data integrity and updated `.env` to `LABEL_DB=POSTGRES`. SQLite files (`afd.db`, `label.db`) renamed to `.bak` and confirmed safe for removal.

## ✅ 11. Localized Embedding Support (sentence-transformers)
**Problem:** Dependency on external Gemini API for embeddings can lead to latency, quota issues, and data privacy concerns.
**Status:** Completed.
**Implementation:**
- **Provider Logic:** Updated `backend/dashboard/services/ai_handler.py` to support a `local` embedding provider using `sentence-transformers`.
- **Model Selection:** Integrated `all-mpnet-base-v2` as the default local model. This model produces **768-dimension** vectors, which matches the existing `gemini-embedding-001` configuration in the `label_embeddings` table.
- **Lazy Loading:** The model is only loaded into memory (RAM/VRAM) when an embedding call is actually made, preventing overhead during standard LLM chat tasks.
- **Batching:** Maintained support for batch embedding (list of strings) to ensure high performance during database population.

### 🛠️ Steps to Enable Local Embeddings:
1.  **Install Dependencies:**
    Install the required machine learning libraries:
    ```powershell
    pip install sentence-transformers torch
    ```
2.  **Configure `.env`:**
    Add or update these variables in your root `.env` file to redirect embedding calls to the local model:
    ```env
    EMBEDDING_PROVIDER=local
    LOCAL_EMBEDDING_MODEL_ID=all-mpnet-base-v2
    ```
3.  **Verify Setup:**
    Run the dedicated test script to ensure the model downloads and generates valid vectors:
    ```powershell
    python scripts/ai/test_local_embedding.py
    ```
    *Note: The first run will download the model files (~420MB) to your local cache.*

## ✅ 12. Automated Embedding Synchronization (Multi-GPU Optimized)
**Problem:** Single-GPU or CPU processing is too slow for the entire FDA labeling database (tens of thousands of labels).
**Status:** Optimized for 8x NVIDIA V100 Environment.
**Implementation:**
- **Sync Script:** Enhanced `scripts/ai/sync_label_embeddings.py` with multi-process GPU support.
- **Parallelism:** Utilizes `SentenceTransformer.encode_multi_process` to distribute workload across all detected CUDA devices (e.g., all 8 V100s).
- **Throughput:** Processes data in large batches (512 chunks per GPU call) to maximize utilization of Tensor Cores.
- **Reliability:** Includes atomic database commits per label-batch and full logging of synchronization progress.

### 🛠️ Steps to Sync Embeddings (8x V100 Environment):
1.  **Verify CUDA Availability:**
    Ensure all 8 GPUs are visible to the system:
    ```powershell
    nvidia-smi
    ```
2.  **Run High-Performance Sync:**
    Execute the sync script. It will automatically detect all 8 GPUs and start a worker pool:
    ```powershell
    python scripts/ai/sync_label_embeddings.py
    ```
3.  **Monitor GPU Utilization:**
    In a separate terminal, watch the GPUs load balancing:
    ```powershell
    watch -n 1 nvidia-smi
    ```
4.  **Logging:**
    Check `sync_embeddings_multigpu.log` for a record of processed batches and any skipped sections.

## ✅ 13. Monthly Dataset Update Workflow
**Problem:** Need a consistent, repeatable process to synchronize the entire system with new DailyMed monthly releases.
**Status:** Workflow Designed & Documented.
**Implementation:**
- **Pipeline:** A 5-step sequential workflow to update raw data, regulatory flags, AI embeddings, and UI metadata.
- **Automation:** Recommended to run these steps once a month following the DailyMed "Monthly Update" ZIP release.

### 🛠️ Steps for Monthly Update:
1.  **Ingest New SPL Data:**
    Process the new DailyMed monthly ZIP into the DB (handles updates/inserts):
    ```powershell
    python scripts/labels/update_labeldb_from_dailymed.py
    ```
2.  **Synchronize Orange Book (RLD/RS):**
    Re-match reference status against the latest Orange Book `products.txt`:
    ```powershell
    python scripts/labels/fix_rld_status.py
    ```
3.  **Sync AI Embeddings (8x V100):**
    Generate vectors for all new/modified sections using the local GPU cluster:
    ```powershell
    python scripts/ai/sync_label_embeddings.py
    ```
4.  **Regenerate UI Snippets:**
    Update the frontend "Trie" search highlights with any new drug names:
    ```powershell
    python scripts/utils/gen_drugsnippet.py
    ```
5.  **Re-Index Database (Optional):**
    Ensure optimal semantic search performance after a large batch update:
    ```sql
    REINDEX INDEX label_embeddings_embedding_idx;
    ```

## ✅ 14. Search V3 (Semantic RAG) Implementation
**Problem:** V2 Search relied on keyword/SQL matching which misses conceptual synonyms and clinical context.
**Status:** Completed.
**Implementation:**
- **Backend:** Implemented a full Semantic RAG pipeline in `backend/search/scripts/search_v3.py`.
    - **Vector Retrieval:** High-recall search using `pgvector` and local `all-mpnet-base-v2`.
    - **Smart Planner:** Lightweight LLM call to classify intent, resolve multi-turn conversational memory, and handle "Out of Scope" or "Clarification" requests.
    - **Precision Reranking:** LLM-based re-scoring of top 20 candidates.
    - **Grounded Answer:** Synthesis engine that answers ONLY from retrieved snippets with mandatory citations.
- **Frontend:** Updated the AI Assistant page:
    - **Default Mode:** Set **Semantic (V3)** as the primary search strategy.
    - **UI Renaming:** Renamed modes to "Semantic (V3)" and "Agentic (V2)".
    - **Hidden V1:** Legacy Standard Search (V1) is hidden from the UI but remains active in the backend.
    - **Intro View:** Added a dedicated "How our Search Pipeline works" section that explains the difference between V3 (Vector Mapping) and V2 (Structured Pipeline).

### 🛠️ Steps to Update Your Local System:
1.  **Ensure Data Presence:**
    Place the latest FDA Orange Book `products.txt` file at:
    `data\downloads\OrangeBook\EOB_Latest\products.txt`
2.  **Add Database Column:**
    Run the following command from the project root to add the `is_rs` column to your existing database:
    ```powershell
    python -c "import sqlite3; conn = sqlite3.connect('data/label.db'); cursor = conn.cursor(); cursor.execute('PRAGMA table_info(sum_spl)'); columns = [row[1] for row in cursor.fetchall()]; [cursor.execute('ALTER TABLE sum_spl ADD COLUMN is_rs INTEGER DEFAULT 0') if 'is_rs' not in columns else None]; conn.commit(); conn.close(); print('is_rs column verified/added.')"
    ```
3.  **Synchronize Reference Status:**
    Run the migration script to populate the RLD/RS flags based on the Orange Book data:
    ```bash
    python scripts/labels/fix_rld_status.py
    ```
4.  **Restart Backend:**
    Restart the Flask backend to clear any cached database metadata and enable the new UI tags.
