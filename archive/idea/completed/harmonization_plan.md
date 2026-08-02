# Application Harmonization Plan

This document outlines the plan to merge three separate applications (Dashboard, Search, DrugTox) into a single, unified codebase with a single entry point for the backend and frontend.

## Goals
1.  **Unified Backend**: One Flask application serving all APIs with specific prefixes.
2.  **Unified Frontend**: One Next.js application hosting all three sub-apps as routes.
3.  **Specific API Paths**: All APIs will follow the pattern `/api/[sub-app]/[endpoint]`.
4.  **Simplified Deployment**: Reduce the number of running services and simplify configuration.

---

## 1. Backend Harmonization (Flask-based)

### Current State
- `dashboard`: Flask app with Blueprints.
- `search`: Flask app in `app.py`.
- `drugtox`: FastAPI app in `main.py`.

### Target Architecture
- Root: `backend/app.py` (The single entry point)
- Modules:
    - `backend/dashboard/` -> Remains a package, refactored for unified imports.
    - `backend/search/` -> Refactored from a standalone app to a Flask Blueprint.
    - `backend/drugtox/` -> Refactored from FastAPI to a Flask Blueprint.

### Technical Steps
1.  **Refactor `search` backend**:
    - Change `app = Flask(__name__)` to `search_bp = Blueprint('search', __name__)`.
    - Update all `@app.route` to `@search_bp.route`.
    - Move initialization logic (OracleDB, OpenAI) into a setup function or handle it at the module level.
    - Ensure `load_dotenv()` is called at the root.
2.  **Refactor `drugtox` backend**:
    - Convert FastAPI endpoints to Flask routes using `@drugtox_bp.route`.
    - Adapt FastAPI `Depends(get_db)` to a Flask-style `get_db` helper or context manager.
    - Standardize JSON response format (FastAPI automatically handles dicts, Flask needs `jsonify`).
3.  **Unified `app.py`**:
    - Create `backend/app.py`.
    - Initialize Flask-SQLAlchemy (for Dashboard) and separate SQLAlchemy engines (for DrugTox).
    - Register blueprints with prefixes:
        - `app.register_blueprint(dashboard_bp, url_prefix='/api/dashboard')`
        - `app.register_blueprint(search_bp, url_prefix='/api/search')`
        - `app.register_blueprint(drugtox_bp, url_prefix='/api/drugtox')`
    - Configure global CORS to allow requests from the unified frontend.
4.  **Shared Resources and Config**:
    - Consolidate all `.env` requirements into a single `.env` at the project root or `backend/`.
    - Create a unified `backend/config.py` that aggregates settings for all modules.

---

## 2. Frontend Harmonization (Next.js-based)

### Current State
- `dashboard`: Mixed static/Next.js components.
- `search`: Next.js application.
- `drugtox`: Vite + React application.

### Target Architecture
- Single Next.js application in `frontend/`.
- Routes:
    - `/dashboard` -> Dashboard UI.
    - `/search` -> Agentic Search UI.
    - `/drugtox` -> DrugTox UI.

### Technical Steps
1.  **Unified Next.js Root**:
    - Use the existing `frontend/search` as the base or create a new Next.js project at `frontend/`.
2.  **Porting `dashboard`**:
    - Move components and pages into `app/dashboard/`.
    - Update API calls to use `/api/dashboard/`.
3.  **Porting `search`**:
    - Move current `search` logic into `app/search/`.
    - Update API calls to use `/api/search/`.
4.  **Porting `drugtox`**:
    - Move React components from the Vite app into `app/drugtox/`.
    - Replace `react-router-dom` with Next.js App Router (links and navigation).
    - Update API calls to use `/api/drugtox/`.
5.  **Shared UI Library**:
    - Create `frontend/components/shared/` for common elements like Navigation, Footer, and Theme provider.
    - Standardize on a CSS framework (e.g., Tailwind or Bootstrap as currently used).

---

## 3. Revised API Mapping (Examples)

| Old API Path | New API Path |
| :--- | :--- |
| `dashboard: /api/labels` | `/api/dashboard/labels` |
| `search: /api/search_agentic` | `/api/search/search_agentic` |
| `drugtox: /analyze` | `/api/drugtox/analyze` |

---

## 4. Implementation Sequence

1.  **Phase 1: Backend Consolidation [COMPLETED]**
    - Created unified `backend/app.py`.
    - Refactored `search` and `drugtox` into Blueprints.
    - Standardized imports and verified health.
2.  **Phase 2: Frontend Consolidation [COMPLETED]**
    - Unified Next.js structure in `frontend/`.
    - Created central landing page in `frontend/app/page.tsx`.
    - Ported `drugtox` to Next.js page.
    - Updated all API paths to prefixed versions.
3.  **Phase 3: Cleanup [COMPLETED]**
    - Removed redundant sub-folders and configurations.
    - Verified unified structure.
    - Set up the unified Next.js structure.
    - Port `search` first (since it's already Next.js).
    - Port `dashboard` next.
    - Port `drugtox` last (requires most conversion from Vite).
3.  **Phase 3: Cleanup**
    - Remove redundant `Dockerfile`s and `package.json`s.
    - Update `docker-compose.yml` to reflect the new structure.
    - Final end-to-end testing.
