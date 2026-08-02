# Migration Plan: AskFDALabel Dashboard (Flask to Next.js)

This plan outlines the steps to complete the migration of the AskFDALabel Dashboard from a Flask-rendered multi-page application to a modern Next.js single-page application structure.

## 1. Backend Transformation (Flask API)

The backend needs to be converted from rendering HTML templates to serving JSON data.

### Actions:
- **Refactor `main.py` Routes:**
    - `search`: Already partially converted. Ensure it consistently returns JSON when requested.
    - `view_label` (`/label/<set_id>`): Convert to return full label data (title, sections, metadata, annotations) as JSON.
    - `compare`: Convert to return comparison results (diffs, merged sections) as JSON.
    - `my_labelings`: Return a list of the user's saved labels and projects.
    - `info`: Return static content as JSON (or move to frontend as static text).
- **Authentication:** Use existing Flask-Login but ensure it works with AJAX requests (return 401 instead of redirecting to `/login`).

## 2. Frontend Routing (Next.js)

Create new page structures in `frontend/app/dashboard/` to handle the different views.

### New Routes:
- `/dashboard/results`:
    - Displays search results (replaces `selection.html`).
    - Supports "Panel View" and "Table View".
    - Handles pagination and project selection ("Save All").
- `/dashboard/label/[setId]`:
    - Displays a detailed drug label (replaces `results.html`).
    - Includes TOC, section navigation, and FAERS integration.
- `/dashboard/compare`:
    - Side-by-side comparison of 2-3 labels (replaces `compare.html`).
- `/dashboard/projects`:
    - Displays saved projects and labels (replaces `my_labelings.html`).

## 3. Componentization (React)

Extract shared UI elements from the existing `page.tsx` and templates.

### Shared Components:
- `DashboardNav`: Top navigation with Home button, AI switcher, and User badge.
- `ProjectDropdown`: "My Projects" menu with project management logic.
- `LabelCard`: Individual search result card.
- `SSTTable`: Shared Strings table logic.
- `AnnotationModal`: For adding/viewing clinical notes.

## 4. State & Data Handling

- **Data Fetching:** Use `SWR` or `React Query` for efficient fetching from the Flask API.
- **Unified State:** Create a `DashboardContext` to manage:
    - Current Search query.
    - Active Project.
    - Selected AI Model.
    - Display Theme (Modern, Scientific, etc.).
- **URL Sync:** Keep search parameters (`drug_name`, `page`, `view`) in the URL for bookmarking.

## 5. CSS & Assets Integration

- **Isolated CSS:** Ensure `dashboard_style.css` and `dashboard_spl.css` only apply to dashboard routes.
- **Dynamic Themes:** Properly load `modern.css`, `scientific.css`, etc., based on the user's selection in `DashboardContext`.

## 6. Implementation Phases

1. **Phase 1: Search Results:** Build the `/dashboard/results` page and hook up the search form.
2. **Phase 2: Label Detail:** Build `/dashboard/label/[setId]` and integrate the XML parser data.
3. **Phase 3: Comparison & Projects:** Implement the comparison engine and project management.
4. **Phase 4: Cleanup:** Remove redundant Flask templates and public JS files that have been migrated to React components.
