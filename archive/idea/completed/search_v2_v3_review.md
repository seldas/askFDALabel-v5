# 🧪 Search Architecture Review: V2 (Agentic) vs. V3 (Semantic)

## 📌 Executive Summary
With the introduction of **Semantic Search V3**, the role of the existing **Agentic Search V2** has become ambiguous. This document reviews the current state of both systems, identifies redundancies, and proposes a strategic redesign where V2 shifts from a general search agent to a specialized **Deep Data Analyst** or **Hybrid Orchestrator**.

---

## 🔍 Comparative Analysis

| Feature | Search V2 (Agentic-SQL) | Search V3 (Semantic-RAG) | FDALabel (Direct Oracle) |
| :--- | :--- | :--- | :--- |
| **Primary Engine** | Template-based SQL Generation | Vector Similarity (pgvector) | Structured SQL Input |
| **Best For** | Counting, Filtering, Statistics | Clinical QA, "Why/How" questions | Exact ID/Name Lookups |
| **Data Source** | Production Oracle / Local DB | Local PostgreSQL (Embeddings) | Production Oracle |
| **NLU Logic** | Intent -> SQL Template | Intent -> Retrieval -> Rerank | None (Manual Fields) |
| **Reliability** | Medium (SQL can fail on complex NLU) | High (Retrieval is robust) | Absolute (Direct) |

---

## 🏗️ The "Weirdness" of V2 (Current State)
As noted, Search V2 currently sits in a "middle ground" that makes it feel redundant:
- **Too "Smart" for simple lookups:** Users prefer the directness of the FDALabel interface for exact Set-ID or NDC searches.
- **Too "Brittle" for complex QA:** Generating complex SQL with `JOINs` and `CONTAINS` clauses via LLM is harder to ground than the RAG approach used in V3.

---

## 🚀 Proposed Redesign: The "Data Analyst" Orchestrator
Instead of retiring V2 immediately, we should pivot its identity to handle scenarios that V3 and FDALabel cannot:

### 1. Specialized Statistical Aggregation
V3 is excellent at finding *passages*, but V2 is superior at counting *records*.
- **V2 Unique Power:** "How many labels from [Company] mention [Symptom] in the [Warnings] section?"
- **Action:** Restore and harden the `aggregate_executor` templates (Done: 2026-03-04).

### 2. Hybrid Orchestration (Tool Use)
Redefine V2 not as a search mode, but as a **Super-Agent** that uses V3 and FDALabel as tools.
- **Scenario:** "Compare the hepatotoxicity risk between SGLT2s and GLP-1s."
- **V2 Logic:**
    1. Call **FDALabel** tool to get the counts/list of drugs in those classes.
    2. Call **Semantic V3** tool to extract specific snippets about "liver" from those labels.
    3. Call **Comparison Agent** to synthesize the data.

### 3. Production/Internal Data Access
V3 relies on a pre-processed vector store (PostgreSQL). V2 has direct access to the full, live **Oracle FDALabel** schema. 
- **V2 Unique Power:** Searching historical revisions, regulatory status (RLD/RS), and internal metadata not yet indexed for semantic search.

---

## 📋 Recommendation
1. **Parallel Testing:** Maintain both V2 and V3 for the next phase of thorough testing.
2. **Planner Update:** Modify the V2 Planner to prioritize "Data Analysis" (Aggregation/Comparison) and "Internal Metadata" over general QA.
3. **Unified Entry:** Eventually, provide a single "Ask" interface that intelligently delegates to V3 (for medical/clinical) or V2 (for data/stats).

---
*Reviewed by: Gemini CLI*
*Date: March 4, 2026*
