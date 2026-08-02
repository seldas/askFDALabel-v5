# askFDALabel Embedding Strategy & Implementation

This document tracks the vision, implementation progress, and future roadmap for semantic search within the AskFDALabel-Suite.

---

## ✅ 1. Completed Implementation (March 2026)

We have moved from design to a production-ready Semantic RAG pipeline (Search V3).

### 🏗️ Infrastructure
*   **Vector Database:** Migrated from SQLite to **PostgreSQL** with the **`pgvector`** extension.
*   **Schema:** Implemented the `label_embeddings` table with 768-dimension vector support, linked to the `labeling.sum_spl` metadata.
*   **Local Embedding Model:** Integrated `sentence-transformers` using the **`all-mpnet-base-v2`** model (768-dim).
    *   *Benefit:* Matches `gemini-embedding-001` dimensions, enabling zero-cost, private, and high-speed local processing.
    *   *Optimization:* Implemented lazy loading and batch processing in `ai_handler.py`.

### 🚀 High-Performance Processing
*   **Multi-GPU Synchronization:** Developed `scripts/ai/sync_label_embeddings.py` optimized for **8x NVIDIA V100 GPUs**.
*   **Throughput:** Uses `encode_multi_process` to saturate all available VRAM, allowing the entire FDA labeling database to be embedded in hours rather than days.
*   **Incremental Updates:** The sync script automatically detects new or modified labels and only processes missing embeddings.

### 🧠 Search V3 Agentic Pipeline
*   **Smart Planner:** Uses a lightweight LLM call to classify intent (Clinical QA vs. Entity Lookup) and resolve multi-turn conversational context (Query Resolution).
*   **Semantic Retriever:** Performs high-recall vector similarity searches (`1 - (embedding <=> query_vector)`) in Postgres.
*   **LLM Reranker:** A precision step where an LLM re-scores the top 20 semantic results to ensure the most relevant clinical evidence is prioritized.
*   **Grounded Composer:** Generates final answers using ONLY retrieved snippets, with mandatory drug/section citations to prevent hallucination.

---

## 🛠️ 2. Current Status: Operational Setup

To bring the system to full capacity, the following operational tasks are ready for execution:

1.  **Full Database Sync:** Run `python scripts/ai/sync_label_embeddings.py` in the V100 environment to populate the vector table.
2.  **Vector Indexing:** Apply HNSW indexing once the table is populated to ensure sub-second search latency:
    ```sql
    CREATE INDEX ON label_embeddings USING hnsw (embedding vector_cosine_ops);
    ```

---

## 🔮 3. Next Steps & Future Roadmap

### 🔄 Phase 1: Hybrid Search Implementation
*   **Goal:** Combine the "Exact Match" strengths of SQL/Keyword search with the "Conceptual Match" of Semantic search.
*   **Technique:** Implement **Reciprocal Rank Fusion (RRF)** to merge results from `KeywordRetriever` and `SemanticRetriever`.

### 📊 Phase 2: Domain-Specific Fine-Tuning
*   **Goal:** Improve retrieval accuracy for highly technical FDA regulatory terminology.
*   **Action:** Evaluate if `all-mpnet-base-v2` requires fine-tuning on SPL-specific corpora or if a specialized medical embedding model (like `BioLinkBERT`) provides better separation for drug classes.

### 🎨 Phase 3: Frontend V3 Integration
*   **Goal:** Expose the power of V3 to the end-user.
*   **Action:** 
    *   Add a "Search Mode" toggle (Standard vs. Semantic AI).
    *   Update the UI to display "Relevance Scores" and "Reasoning Trace" for transparency.
    *   Implement "Citation Highlighting" where clicking a bracketed citation `[Drug, Section]` scrolls the user to the exact text in the label viewer.

### 📉 Phase 4: Quantization & Optimization
*   **Goal:** Reduce memory footprint for smaller deployment environments.
*   **Action:** Explore `Int8` or `Binary` quantization for the vector index if the `label_embeddings` table grows beyond 10GB.

---

## 📝 Architectural Summary
The V3 system successfully balances **Scalability** (via pgvector), **Accuracy** (via LLM Reranking), and **Data Sovereignty** (via local embedding models on V100s). It serves as the foundation for the next generation of FDA regulatory intelligence.
