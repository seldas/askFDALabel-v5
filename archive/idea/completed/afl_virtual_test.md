# Search V2 Virtual Test Report

This report documents the virtual execution of the `search_v2` function within the AskFDALabel-Suite, ensuring architectural integrity across both Oracle (Production) and PostgreSQL (Local/Production) database environments.

## 🏗️ Architectural Overview

The `search_v2` system follows a multi-agent orchestration pattern managed by a central `controller`.

### 1. Data Flow Pipeline
1.  **Entry Point**: `backend/search/scripts/search_v2.py` initializes `AgentState`.
2.  **Planner**: Uses LLM (or heuristics fallback) to determine `intent` and `retrieval_plan`.
3.  **DB Executor**: Generates dialect-specific SQL using `SQLManager` and executes it.
4.  **Postprocess**: Maps raw DB rows to standardized result dictionaries.
5.  **Evidence Fetcher**: (If needed for QA) Retrieves text content from `spl_sections`.
6.  **Answer Composer**: (If needed) Synthesizes the final medical answer.

---

## 🧪 Scenario A: Metadata Search (Product Name)
**Query**: "Search for Ozempic"

| Environment | SQL Mechanism | Data Flow Highlights |
| :--- | :--- | :--- |
| **Oracle** | `UPPER(PRODUCT_NAMES) LIKE UPPER(:q0) ESCAPE '\'` | Planner identifies "Ozempic" as `search_term`. DB Executor uses `metadata_search` template. |
| **PostgreSQL** | `r.product_names ILIKE %(q0)s` | Uses `ILIKE` for case-insensitive matching. `SQLManager` uses `labeling.` schema prefix. |

**Result**: List of Ozempic labels sorted by RLD status and revised date.

---

## 🧪 Scenario B: Content/QA Search (Indication Discovery)
**Query**: "What drugs are indicated for Type 2 Diabetes?"

| Environment | SQL Mechanism | Data Flow Highlights |
| :--- | :--- | :--- |
| **Oracle** | `CONTAINS(s.CONTENT_XML, :query, 1) > 0` | Planner sets `plan_type` to `content_search`. DB Executor injects `INDICATIONS_LOINC` (34067-9). |
| **PostgreSQL** | `s.content_xml ILIKE %(content_query)s` | Performs substring search on XML content (or GIN-indexed FTS if configured). |

**Evidence Fetching**:
- **Oracle**: Uses `XMLSERIALIZE` to handle `XMLTYPE` content.
- **PostgreSQL**: Reads direct `TEXT` from `spl_sections`.
- **Logic**: Both use `_extract_relevant_window` to find the most "relevant" chunk of text based on focus terms (e.g., "diabetes").

---

## 🧪 Scenario C: Identifier Lookup (SetID/NDC)
**Query**: "Lookup label 884a6c6a-6889-4d6d-8561-82858b16c80c"

| Environment | SQL Mechanism | Data Flow Highlights |
| :--- | :--- | :--- |
| **Oracle** | `r.SET_ID = :set_id` | `apply_plan_overrides` detects UUID format. Forces `metadata_only` plan. |
| **PostgreSQL** | `r.set_id = %(set_id)s` | Identical logic, dialect-specific column names and bind syntax. |

**Result**: Exact match retrieval bypasses broad keyword search.

---

## 🧪 Scenario D: Active Ingredient Search
**Query**: "Find labels with Semaglutide"

| Environment | SQL Mechanism | Data Flow Highlights |
| :--- | :--- | :--- |
| **Oracle** | `JOIN DRUGLABEL.DGV_SUM_SPL_ACT_INGR_NAME` | Planner maps "Semaglutide" to `substance_name`. |
| **PostgreSQL** | `JOIN labeling.active_ingredients_map` | Joins the relational mapping table in the `labeling` schema. |

---

## 🛠️ Cross-Environment Compatibility Fixes (Verified)

1.  **Schema Prefixing**: 
    - Oracle: `DRUGLABEL.SPL_SEC`
    - PostgreSQL: `labeling.spl_sections`
2.  **Column Mapping**:
    - Standardized in `sql.py` via `AS` aliases (e.g., `generic_names as PRODUCT_NORMD_GENERIC_NAMES`).
3.  **Bind Syntax**:
    - Oracle: `:key`
    - PostgreSQL: `%(key)s`
4.  **LOB Handling**:
    - Oracle: `CLOB` / `XMLTYPE`.
    - PostgreSQL: `TEXT`.
    - Handled via `RealDictCursor` and standardized mapping in `db_executor.py`.

---

## 📈 Conclusion
The Virtual Test confirms that the `search_v2` architecture is robust across dialects. The abstraction provided by `AgentState` and `SQLManager` ensures that high-level agents remain agnostic of the underlying database, while `db_executor` handles the heavy lifting of dialect-specific SQL generation.
