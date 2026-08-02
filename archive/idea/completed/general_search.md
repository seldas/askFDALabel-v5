# General Search (Unified Entry Point) Plan

## 📝 Current State Summary
- **File:** `backend/search/scripts/general_search.py`
- **Functionality:** 
  - Acts as a zero-shot LLM wrapper using `call_llm`.
  - Uses a strict system prompt to restrict context to FDA drug labeling.
  - Returns `'out-of-scope'` for unrelated queries.
  - Currently powers the `/api/search/search` endpoint (non-streaming).
- **Limitation:** It does not perform any data retrieval (RAG) or database lookups, making it "hallucination-prone" for specific clinical data if used alone.

## 🎯 Objective
Transform `general_search.py` into a smart "Unified Entry Point" that can intelligently handle user queries by either answering directly (for general knowledge) or routing to the appropriate search/retrieval mechanism.

## 🚀 Proposed Plan

### Phase 1: Intent Classification & Routing
- Update the `SYSTEM_PROMPT` to act as an **Intent Router**.
- The LLM should classify the input into one of these categories:
  - `GENERAL_QA`: Questions about FDA processes, general labeling rules, or basic definitions.
  - `LABEL_SEARCH`: Queries requiring specific data from drug labels (e.g., "What are the side effects of Lisinopril?").
  - `OUT_OF_SCOPE`: Unrelated queries.
- **Action:** If `LABEL_SEARCH` is detected, `general_search.py` should ideally trigger a "quick" version of the semantic search or inform the system that retrieval is needed.

### Phase 2: Lightweight RAG Integration
- Instead of just a zero-shot call, integrate with `FDALabelDBService` or a simplified `semantic_search` call.
- For `LABEL_SEARCH` intents, perform a quick keyword or vector lookup to get 1-3 top snippets before answering.
- This allows the `/search` endpoint to provide grounded, high-fidelity answers without the overhead of a full agentic stream.

### Phase 3: Error Handling & Persona Refinement
- Improve the "out-of-scope" response to be more informative (e.g., "I specialize in FDA labeling. I can't help with [topic], but I can help you find [related labeling topic].").
- Implement better error handling for LLM timeouts or quota issues.

### Phase 4: Frontend Alignment
- Ensure the `/search` endpoint (used by `general_search.py`) returns a structured JSON that the frontend can use to decide whether to offer a "Deep Search" (agentic) button.

---

## 🛠️ Implementation Steps
1. [x] Modify `SYSTEM_PROMPT` in `general_search.py` to include clinical annotation instructions.
2. [x] Update `ChatPanel.tsx` and `Results.tsx` to handle clinical filters and highlighting.
3. [x] Add filter support to `AgentState` in `semantic_core`.
4. [x] Update `Planner` to route queries with filters to the precise search path.
5. [x] Update `KeywordRetriever` to use `drugNames`, `ndcs`, and `adverseEvents` in SQL queries.
6. [x] Update `blueprint.py` to route filtered requests to the semantic agent.
