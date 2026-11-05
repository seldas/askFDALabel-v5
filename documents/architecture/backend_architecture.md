# Backend Architecture & Blueprint Assembly

## 1. Overview

The backend is built with Python 3.10+ and Flask, structured as a **modular monolith**. Rather than deploying distinct microservices, the backend initializes a foundational Flask application in `backend/dashboard/__init__.py` and mounts domain-specific blueprints in `backend/app.py`.

All modules share configuration, extensions, authentication state, and database connection pools while remaining logically encapsulated.

---

## 2. Blueprint Assembly & Route Routing

The entry point for starting the web service is `backend/app.py::create_unified_app()`.

```python
def create_unified_app():
    # 1. Initialize base dashboard application (auth, db, core services)
    app = create_dashboard_app()

    # 2. Register module blueprints with explicit URL prefixes
    app.register_blueprint(search_bp, url_prefix='/api/search')
    app.register_blueprint(drugtox_bp, url_prefix='/api/drugtox')
    app.register_blueprint(labelcomp_bp, url_prefix='/api/labelcomp')
    app.register_blueprint(device_bp, url_prefix='/api/device')
    app.register_blueprint(localquery_bp, url_prefix='/api/localquery')
    app.register_blueprint(webtest_bp, url_prefix='/api/webtest')
    app.register_blueprint(api_service_bp, url_prefix='/api/v1')

    return app
```

### Module Blueprint Manifest

| Route Prefix | Blueprint Source | Domain Responsibilities |
|---|---|---|
| `/api/dashboard` | `backend/dashboard/routes/` | Label detail parsing, deep dive, annotations, projects, favorites, preferences, RO2 DILI |
| `/api/dashboard/auth` | `backend/dashboard/routes/auth.py` | User login, registration, session checks, password reset |
| `/api/dashboard/admin`| `backend/dashboard/routes/admin.py` | User management, feature gate toggling, system task logs |
| `/api/search` | `backend/search/blueprint.py` | DB query classification, multi/single label search, chat refinement |
| `/api/drugtox` | `backend/drugtox/blueprint.py` | DILI, DICT, DIRI assessment, chemical structure search, FAERS reports |
| `/api/labelcomp` | `backend/labelcomp/blueprint.py` | Two-way label comparison, section alignment, AI diff synthesis |
| `/api/device` | `backend/device/blueprint.py` | openFDA medical device lookups, 510(k), PMA, recall events |
| `/api/localquery` | `backend/localquery/blueprint.py` | Dynamic Boolean criteria compiler, raw SQL execution, Excel export |
| `/api/webtest` | `backend/webtest/blueprint.py` | Automated test suite execution, Excel diff reporting, history logs |
| `/api/v1` | `backend/api_service/blueprint.py` | Public external REST API with API-key authentication |

---

## 3. Import Conventions & Python Path

All backend imports are strictly rooted at `backend/`, **never** with a `backend.` prefix:
```python
# Correct
from dashboard.config import Config
from database import db, User
from celery_app import celery

# Incorrect (will fail)
from backend.dashboard.config import Config
```
Any command running backend code must have `backend/` in `PYTHONPATH` or be executed with `backend/` as the current working directory. `start_server.py` and the container environment automatically configure this.

---

## 4. Asynchronous Task Orchestration (Celery + SystemTask)

Long-running administrative operations (such as importing DailyMed labels, updating MedDRA datasets, generating DrugTox reports, or executing WebTest suites) run asynchronously outside the HTTP request/response loop.

```
Client -> HTTP POST /api/dashboard/admin/tasks/run
             │
             ▼
     TaskService.create_task()  ──►  Inserts row in `public.system_tasks` (status: PENDING)
             │
             ▼
     execute_generic_task.delay(task_id, module_name, func_name, *args)
             │
             ▼ (Dispatched via Redis broker)
     Celery Worker (`backend/admin/tasks/*`)
             │
             ├── Updates progress (0% -> 100%) in `system_tasks` table
             └── Status set to 'COMPLETED' or 'FAILED'
             │
Client polls HTTP GET /api/dashboard/admin/tasks/<task_id>
```

- **Task Definitions**: Stored in `backend/admin/tasks/` (`import_labels.py`, `import_meddra.py`, `import_orangebook.py`, `generate_drugtox.py`, `run_webtest.py`).
- **Worker Execution Command**:
  ```bash
  cd backend && celery -A celery_app.celery worker --loglevel=info
  ```

---

## 5. AI Client Routing (`AIClientFactory`)

AI operations funnel through a centralized provider router located in `backend/dashboard/services/ai_handler.py`.

### Supported Providers:
1. **Google Gemini**: Uses `google-genai` SDK with models like `gemini-2.5-flash`, `gemini-1.5-pro`.
2. **ELSA (FDA Internal)**: Internal FDA AI service accessed via HTTP API with client certificates.
3. **OpenAI-Compatible Endpoints**: Generic wrapper supporting `vLLM`, `Ollama`, `Llama.cpp`, and custom hosted LLMs.

### Features:
- **Usage Tracking**: Every LLM call records prompt tokens, completion tokens, model name, user ID, and timestamp into the `public.token_usage` table.
- **Internal Environment Detection**: `_check_is_internal()` dynamically probes `fdalabel.fda.gov` with a 1.5s HEAD check to determine whether internal-only features and models (e.g., ELSA) should be exposed.
