# 🏗️ AskFDALabel-Suite: AI-Optimized Architecture Guide

This document is designed for high-speed indexing by AI agents. It maps technical logic to file paths and provides "Quick-Look" tags for common engineering tasks.

---

## 🚀 Quick-Look Navigation (AI Task Mapping)

| Task Scenario | Primary Files to Inspect | Technical Logic Keywords |
| :--- | :--- | :--- |
| **Fix FAERS/Safety Counts** | `backend/dashboard/services/fda_client.py`<br>`backend/dashboard/routes/api.py` | `get_faers_data`, `run_ae_report_generation` |
| **Update Search Agent Flow** | `backend/search/scripts/semantic_core/controller.py`<br>`backend/search/blueprint.py` | `run_controller`, `search_agentic_stream` |
| **Add New AI Provider** | `backend/dashboard/services/ai_handler.py` | `AIClientFactory`, `call_llm` |
| **Modify Schema / MedDRA** | `backend/database/models.py` | `MeddraMDHIER`, `SystemTask` |
| **Unified Task Tracking** | `backend/dashboard/services/task_service.py` | `create_task`, `start_background_task` |
| **Change Result Card UI** | `frontend/app/search/components/ResultCard.tsx` | `Metadata`, `Highlighting`, `Comparison` |
| **Fix Auth / Session** | `backend/dashboard/routes/auth.py`<br>`frontend/app/context/UserContext.tsx` | `login`, `session`, `activeTasks` |

---

## 🛠️ Technical Stack Summary
- **Backend:** Flask (Python 3.11+), SQLAlchemy (PostgreSQL/Oracle), Flask-Login.
- **Frontend:** Next.js 15 (App Router), TypeScript, Tailwind-ready (Vanilla CSS preferred), Recharts.
- **AI Infrastructure:** Google Gemini (SDK), Meta Llama (vLLM / OpenAI API), Elsa (FDA Internal Pixel API).
- **Data Sources:** openFDA API, DailyMed (NIH), Internal FDALabel Oracle DB.
- **Background Tasks:** Unified `TaskService` for threads (reports) and subprocesses (imports).

---

## 1. Backend: Core Intelligence & Data

### `backend/app.py`
**AI Purpose:** Entry point. Handles **Blueprint Registration** and global config.
- `create_unified_app()`: Registers `api_bp`, `auth_bp`, `main_bp`, `search_bp`, `drugtox_bp`. Look here to see how routes are prefixed (e.g., `/api/dashboard/...`).

### `backend/database/models.py`
**AI Purpose:** **SQLAlchemy Schema**. Critical for understanding data relationships.
- `User`: Preferences (`ai_provider`), API keys.
- `Project`: Workspace container.
- `Favorite`: Denormalized label metadata (`set_id`, `ndc`, `brand_name`).
- `SystemTask`: Unified task state (`progress`, `status`, `task_type`, `user_id`, `project_id`, `result_data`).
- `MeddraMDHIER`: MedDRA hierarchy (SOC -> HLT -> PT).

### `backend/dashboard/services/task_service.py`
**AI Purpose:** **Task Orchestration**. Use this for background execution and status tracking.
- `create_task()`: Initializes a new `SystemTask`.
- `update_task()`: Updates progress, message, and status.
- `start_background_task()`: Thread-safe wrapper with app context.

### `backend/dashboard/services/ai_handler.py`
**AI Purpose:** **LLM Orchestration**. Use this to modify how the app talks to AI.
- `AIClientFactory`: Logic for switching between **Gemini**, **Llama**, and **Elsa**.
- `call_llm()`: Unified wrapper. Implements **Model Fallback**.
- `chat_with_document()`: Prompt engineering for RAG-style chat with verbatim citation rules.

### `backend/dashboard/services/fda_client.py`
**AI Purpose:** **Data Acquisition**. Resolves SetIDs and fetches safety data.
- `identify_query_type()`: RegEx parser for SetID vs UNII vs NDC.
- `get_faers_data()`: High-level aggregator for safety trends and reactions.
- `get_label_xml()`: Fetching logic (Local Storage -> DailyMed).

### `backend/dashboard/services/fdalabel_db.py`
**AI Purpose:** **Internal Oracle Bridge**. High-fidelity searching.
- `search_labels()`: SQL for multi-field search against production FDA databases.
- `ingredient_role_breakdown_for_set_ids()`: Logic to distinguish Active vs. Inactive ingredients across a project.

---

## 2. Search Engine (AFL Agent) Logic

### `backend/search/blueprint.py`
**AI Purpose:** **NDJSON Streaming**. Orchestrates the real-time agent output.
- `search_agentic_stream()`: Spawns a background thread to run the agent controller and streams logs to the frontend.

### `backend/search/scripts/semantic_core/`
**AI Purpose:** **Agent Brain**.
- `controller.py`: The main loop (`run_controller`) that iterates through Planner -> Executor -> Composer.
- `agents/answer_composer.py`: Final clinical answer generation logic.
- `agents/reasoning_generator.py`: Generates the "Thought Process" shown in the UI.

---

## 3. Frontend: App Structure & State

### `frontend/app/context/UserContext.tsx`
**AI Purpose:** **Global State Hub**.
- `activeTasks`: Array of ongoing reports and background jobs being polled every 30s from `/api/dashboard/tasks/active`.
- `refreshSession()`: Handles re-authentication and preference syncing.

### `frontend/app/dashboard/page.tsx`
**AI Purpose:** **Workspace Management**.
- Implements project switching, label filtering, and the **Analyze (AE Profiles)** dropdown.

### `frontend/app/search/page.tsx`
**AI Purpose:** **AFL Agent Terminal**.
- Implements NDJSON stream parsing to update the status log and stream answer tokens simultaneously.

---

## 🛰️ Data Flow Map (Internal AI Context)

1. **User Query** -> `frontend/.../search/page.tsx` -> POST `/api/search/search_agentic_stream`
2. **Backend Entry** -> `backend/search/blueprint.py` -> `run_controller` (`semantic_core/controller.py`)
3. **Planning** -> AI uses `SEARCH_HELPER_PROMPT` to build SQL or API query.
4. **Data Retrieval** -> `fdalabel_db.py` (Internal) OR `fda_client.py` (External).
5. **Answer Generation** -> `answer_composer.py` streams tokens via `ai_handler.py`.
6. **Background Tasks** -> `TaskService` updates `SystemTask` in DB -> UI polls via `UserContext.tsx` from `/api/dashboard/tasks/active`.

---

## 🎭 Pseudo-Scenarios for AI Agents

- **"Add a 'Pediatric Only' filter to AE Reports"**:
    1. Inspect `backend/dashboard/routes/api.py` -> `run_ae_report_generation`.
    2. Update openFDA query in Phase 2 to include `patient.patientagegroup:1`.
    3. Update `ProjectAeReportDetail` model in `models.py` to store the new count.
- **"The search agent is failing to find NDCs"**:
    1. Check `backend/dashboard/services/fda_client.py` -> `identify_query_type` regex.
    2. Check `backend/dashboard/services/fdalabel_db.py` -> `search_labels` SQL where clause for NDC.
- **"Change the color of the 'Active Tasks' pulsing dot"**:
    1. Go to `frontend/app/components/Header.tsx`.
    2. Find the `<style jsx>` block and update `.pulse-dot` background-color.
