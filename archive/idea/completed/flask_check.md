## Resolved Issues

### 1. Missing Templates (Resolved)
- [x] All routes in `backend/dashboard/routes/` and `backend/labelcomp/blueprint.py` now return JSON or handle redirects instead of using `render_template`.

### 2. Static File Serving Discrepancy (Resolved)
- [x] Removed `static_folder` and `template_folder` from Flask app factory.
- [x] Migrated all script paths in `frontend/` to use Next.js public paths.

### 3. Preferences 415 Error (Resolved)
- [x] Refactored `preferences` route in `main.py` to be robust, handling both `application/json` and `application/x-www-form-urlencoded`.
- [x] Updated Next.js `UserContext.tsx` and legacy `ui.js` to send JSON data.

### 4. API Logic Errors (Resolved)
- [x] Fixed a bug in `toggle_favorite` where the `meta` variable was used without being defined.

## Recommendations
1.  **DATABASE_URL Consistency:** Verify that both environments (dev/prod) point to the same database file if parity is desired.
2.  **Waitress Timeout:** Consider increasing the Waitress timeout if AI assessments continue to hang up.

## Migration Tasks (Completed)
- [x] Refactor `backend/dashboard/routes/main.py` to remove all HTML rendering.
- [x] Refactor `backend/dashboard/routes/auth.py` to be purely API-based (JSON only).
- [x] Refactor `backend/labelcomp/blueprint.py` to be purely API-based.
- [x] Clean up `backend/dashboard/__init__.py` (Removed template/static folder config).
- [x] Remove legacy `DashboardClient.tsx` and its references.
- [x] Verify all backend blueprints are JSON-API compliant.
- [x] Fix `toggle_favorite` and `preferences` route logic.
