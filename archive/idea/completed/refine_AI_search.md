# Renovation Plan: Stateful AI Search

This document outlines the implementation plan to renovate the AI search function in AskFDALabel. The goal is to transition from a "stateless translation" model (User Intent -> SQL) to a "stateful collaborative" model where the AI acts as a search partner, refining queries iteratively based on context.

## Core Concept: The "Living Search State"

Instead of treating every query as a fresh start, we will treat the search as a **living state object**. The AI maintains the state of the SQL query across turns.

### Workflow

1.  **Input:** User Message + `Current_Active_SQL` (State) + `Previous_Metadata`.
2.  **Processing:** AI analyzes intent (Narrowing, Broadening, Pivoting) vs. the current state.
3.  **Output:** New SQL + Explanation + Suggestions (Structured JSON).
4.  **Execution:** Backend runs SQL.
5.  **Feedback:** Results displayed; State updated.

---

## Detailed Implementation Plan

### 1. Backend Refactoring (`backend/app.py`)

**Current Status:**
The `/api/search` endpoint accepts `query` (string) and `manual_sql` (string). It uses `safe_llm_call` which returns raw text (often wrapped in markdown). Verification (`get_keywords`) is a separate, subsequent LLM call.

**Required Changes:**

*   **Update Request Schema:**
    Modify `/api/search` to accept an optional `context_sql` or `previous_sql` parameter.
    ```python
    # Planned change in search()
    data = request.json
    user_query = data.get("query", "")
    current_sql = data.get("current_sql", "") # New parameter
    ```

*   **Prompt Construction:**
    Dynamically inject the `current_sql` into the system prompt before calling the LLM. This allows the LLM to see what it (or the user) previously generated.

*   **Response Parsing (JSON Mode):**
    Force the LLM to return structured JSON instead of free text. This avoids regex parsing issues and separates the "Explanation" from the "SQL".
    *   *Action:* Update `safe_llm_call` usage or prompt instructions to enforce JSON output.
    *   *Action:* Parse the JSON response in `app.py`.

*   **Unified Verification:**
    Instead of a separate `get_keywords` call (which adds latency), instruct the main LLM to include a "verification_logic" or "keywords" field in its JSON response. This reduces 2 LLM calls to 1.

### 2. Prompt Engineering (`backend/prompt_active.py`)

**Current Status:**
`prompt_query_all` is a comprehensive monolithic prompt. It handles "Query Refinement" only if the user *pastes* a query. It expects raw SQL or tagged text output.

**Required Changes:**

*   **Inject State Variable:**
    Add a placeholder `{{CURRENT_SQL_CONTEXT}}` in the system prompt.
    ```text
    ...
    ### CURRENT SEARCH CONTEXT
    The user is currently looking at results from this query:
    {{CURRENT_SQL_CONTEXT}}

    If this is empty, generate a new query from scratch.
    If this contains SQL, interpret the user's new request as a MODIFICATION of this query (e.g., add a filter, remove a condition).
    ...
    ```

*   **Enforce JSON Output:**
    Change `<RESPONSE_HIERARCHY>` and `<RULES>` to demand JSON.
    ```json
    {
      "thought_process": "Brief analysis of user intent vs current SQL",
      "sql": "SELECT ...",
      "explanation": "User-friendly explanation of the change",
      "suggestions": ["Filter by RLD", "Search for side effects"]
    }
    ```

*   **Strict Section Search Logic:**
    Refine the rules for `SPL_SEC` searching to ensure `CONTAINS` clauses are always accompanied by `LOINC_CODE` filters where possible, to improve performance and relevance.

### 3. Database Strategy & Schema (`backend/db_search.py`)

**Current Status:**
`run_oracle_search` constructs queries dynamically based on params, OR executes raw SQL from the LLM.

**Required Changes:**

*   **Optimization:** Ensure the LLM generates optimized SQL (e.g., using `Fetch First`, avoiding `SELECT *` if not needed, though the current prompt selects specific columns).
*   **Safety:** The `is_safe_sql` check in `app.py` must remain strict.
*   **Metadata vs. Content:**
    *   *Metadata (Table `r`):* High precision (Brand Name, Manufacturer).
    *   *Content (Table `s`):* High recall/semantic (Side effects, Indications).
    *   *Action:* Ensure the prompt explicitly distinguishes these. If a user asks "What treats diabetes?", it's a content search (Indications). If they ask "Show me Metformin", it's a metadata search.

### 4. Frontend Integration (Brief Overview)

*   **State Management:** The frontend must store the `current_sql` returned by the API and send it back with the next request.
*   **UI:** Display the "Explanation" separately from the results. Ideally, show the SQL in a collapsible "Advanced" view (Monaco Editor) allowing power users to edit it directly.

---

## Action Checklist

1.  [ ] **Modify `backend/prompt_active.py`**:
    *   Create `prompt_query_v2`.
    *   Add JSON schema definition.
    *   Add `{{CURRENT_SQL_CONTEXT}}` section.
2.  [ ] **Update `backend/app.py`**:
    *   Refactor `search()` to read `current_sql` from request.
    *   Update `safe_llm_call` to use the new prompt and inject the SQL.
    *   Implement JSON parsing for the LLM response.
    *   Remove legacy `get_keywords` call if the new prompt handles explanation well.
3.  [ ] **Test & Verify**:
    *   Test "Refinement" flows:
        *   "Show me Ozempic" -> (Generates SQL)
        *   "Only the ones from Novo Nordisk" -> (Should append `AND AUTHOR_ORG...`)
        *   "What about side effects?" -> (Should JOIN `SPL_SEC` and search)
4.  [ ] **Cleanup**: Remove old prompts and unused functions once confirmed.