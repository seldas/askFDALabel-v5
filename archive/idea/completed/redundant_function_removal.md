# Redundant Function Removal Analysis

This file tracks legacy backend functions in `backend/dashboard/routes/main.py` and their usage in the project. This analysis helps in safely removing unused code during refactoring.

## `backend/dashboard/routes/main.py`

| Function | Route / Internal | Called By (Location) | Status | Notes |
| :--- | :--- | :--- | :--- | :--- |
| `favicon` | `/favicon.ico` | Browsers (implied) | Keep | Default browser behavior. |
| `index` | `/` | Browsers (implied) | Keep | Redirects to `/dashboard`. |
| `upload_label` | `/upload_label` | **None** | Removed | Deleted as it was no longer in use. |
| `import_fdalabel` | `/import_fdalabel` | `frontend/app/dashboard/page.tsx` | Used | Used for Excel import. |
| `search` | `/search` | `frontend/app/dashboard/results/page.tsx` | Used | Core search functionality. |
| `view_label` | `/label/<set_id>` | `frontend/app/dashboard/label/[setId]/page.tsx` | Used | Label details viewing. |
| `preferences` | `/preferences` | `frontend/app/context/UserContext.tsx`, `frontend/public/dashboard/js/ui.js` | Used | AI configuration saving. |
| `snippet_preview` | `/snippet-preview` | `frontend/public/snippets/drug-snippet/snippet_logic.js`, `frontend/public/snippets/drug-snippet/drug_snippet.js` | Used | Used by bookmarklet/snippet. |
| `export_project` | `/export_project` | `frontend/app/dashboard/page.tsx` | Used | Project export to Excel. |
| `project_stats` | `/project_stats` | `frontend/app/dashboard/page.tsx` | Used | Dashboard stats visualization. |
| `_safe_str` | Internal | `export_project` | Used | Helper for `export_project`. |
| `_fmt_eff_time` | Internal | `export_project` | Used | Helper for `export_project`. |
| `_norm_str` | Internal | `project_stats` | Used | Helper for `project_stats`. |
| `_parse_eff_time_to_date` | Internal | `project_stats` | Used | Helper for `project_stats`. |

## `backend/dashboard/routes/api.py`

| Function | Route / Internal | Called By (Location) | Status | Notes |
| :--- | :--- | :--- | :--- | :--- |
| `scan_label_meddra` | `/meddra/scan_label/<set_id>` | `frontend/public/dashboard/js/faers.js` | Used | MedDRA scanning. |
| `enrich_faers_with_meddra` | Internal | `api.py` | Used | MedDRA enrichment helper. |
| `suggest_drugs` | `/suggest-drugs` | **None** | Removed | Deleted. |
| `ai_chat` | `/ai_chat` | `frontend/public/dashboard/js/chat.js`, `frontend/public/dashboard/js/faers.js` | Used | AI chat functionality. |
| `ai_search_help` | `/ai_search_help` | `frontend/public/dashboard/js/ai_search.js`, `frontend/public/js/ai_search.js` | Used | AI search helper. |
| `search_count` | `/search_count` | `frontend/public/dashboard/js/ai_search.js`, `frontend/public/js/ai_search.js` | Used | Search results count. |
| `ai_compare_summary` | `/ai_compare_summary` | `frontend/public/js/compare.js` | Used | Comparison summary. |
| `save_annotation` | `/save_annotation` | `frontend/public/dashboard/js/chat.js`, `frontend/public/dashboard/js/faers.js` | Used | Saving Q&A annotations. |
| `delete_annotation` | `/delete_annotation` | `frontend/public/dashboard/js/chat.js` | Used | Deleting Q&A annotations. |
| `toggle_favorite` | `/toggle_favorite` | `frontend/public/dashboard/js/favorites.js` | Used | Star/Unstar labels. |
| `check_favorite` | `/check_favorite/<set_id>` | `frontend/public/dashboard/js/favorites.js` | Used | Favorite status check. |
| `toggle_favorite_comparison` | `/toggle_favorite_comparison` | `frontend/public/dashboard/js/favorites.js` | Used | Toggle comparison favorite. |
| `delete_favorites_bulk` | `/delete_favorites_bulk` | **None** | Removed | Deleted. |
| `delete_favorite_comparisons_bulk` | `/delete_favorite_comparisons_bulk` | **None** | Removed | Deleted. |
| `check_favorite_comparison` | `/check_favorite_comparison` | `frontend/public/dashboard/js/favorites.js` | Used | Comparison favorite status. |
| `import_favorites` | `/import_favorites` | **None** | Removed | Deleted. |
| `save_label_annotation` | `/annotations/save` | `frontend/public/dashboard/js/annotations.js` | Used | In-text annotations. |
| `get_label_annotations` | `/annotations/get/<set_id>` | `frontend/public/dashboard/js/annotations.js` | Used | Retrieve in-text annotations. |
| `delete_label_annotation` | `/annotations/delete` | `frontend/public/dashboard/js/annotations.js` | Used | Delete in-text annotations. |
| `api_projects` | `/projects` | `frontend/app/dashboard/page.tsx`, `frontend/app/labelcomp/page.tsx`, `frontend/public/dashboard/js/favorites.js` | Used | Project list & creation. |
| `api_reorder_projects` | `/projects/reorder` | **None** | Removed | Deleted. |
| `api_project_detail` | `/projects/<id>` | `frontend/app/dashboard/page.tsx` | Used | Project update/delete. |
| `export_project` | `/projects/<id>/export` | **None** | Removed | Deleted. |
| `import_project` | `/projects/import` | **None** | Removed | Deleted. |
| `api_move_items` | `/projects/move_items` | **None** | Removed | Deleted. |
| `api_my_favorites` | `/favorites_data` | `frontend/app/dashboard/page.tsx`, `frontend/app/labelcomp/page.tsx` | Used | Get project favorites. |
| `api_check_favorites_batch` | `/check_favorites_batch` | `frontend/public/dashboard/js/favorites.js` | Used | Batch favorite status. |
| `favorite_all` | `/favorite_all` | `frontend/app/dashboard/page.tsx` | Used | Favorite all search results. |
| `get_my_labelings` | `/my_labelings` | `frontend/public/dashboard/js/favorites.js` | Used | Link to labelings page. |
| `api_faers_data` | `/faers/<drug_name>` | `frontend/public/dashboard/js/faers.js` | Used | FAERS reactions data. |
| `api_faers_trends` | `/faers/trends` | `frontend/public/dashboard/js/faers.js` | Used | FAERS trends data. |
| `generic_assessment_route` | Internal | `api.py` | Used | Helper for tox assessment. |
| `run_assessment_logic` | Internal | `api.py` | Used | Helper for tox assessment. |
| `api_dili_faers` | `/dili/faers/<set_id>` | `frontend/public/dashboard/js/tox.js` | Used | DILI FAERS check. |
| `api_dili_assess` | `/dili/assess/<set_id>` | `frontend/public/dashboard/js/tox.js` | Used | DILI AI assessment. |
| `api_dict_faers` | `/dict/faers/<set_id>` | `frontend/public/dashboard/js/tox.js` | Used | DICT FAERS check. |
| `api_dict_assess` | `/dict/assess/<set_id>` | `frontend/public/dashboard/js/tox.js` | Used | DICT AI assessment. |
| `api_diri_faers` | `/diri/faers/<set_id>` | `frontend/public/dashboard/js/tox.js` | Used | DIRI FAERS check. |
| `api_diri_assess` | `/diri/assess/<set_id>` | `frontend/public/dashboard/js/tox.js` | Used | DIRI AI assessment. |
| `api_pgx_assess` | `/pgx/assess/<set_id>` | `frontend/public/dashboard/js/tox.js` | Used | PGx AI assessment. |

## `backend/dashboard/routes/auth.py`

| Function | Route / Internal | Called By (Location) | Status | Notes |
| :--- | :--- | :--- | :--- | :--- |
| `login` | `/login` | `frontend/app/components/AuthModals.tsx` | Used | User login. |
| `register` | `/register` | `frontend/app/components/AuthModals.tsx` | Used | User registration. |
| `logout` | `/logout` | `frontend/app/page.tsx`, `frontend/app/search/components/Header.tsx`, etc. | Used | User logout. |
| `change_password` | `/change_password` | `frontend/app/components/AuthModals.tsx` | Used | Password update. |
| `session` | `/session` | `frontend/app/context/UserContext.tsx` | Used | Get current user session. |

## `backend/search/blueprint.py`

| Function | Route / Internal | Called By (Location) | Status | Notes |
| :--- | :--- | :--- | :--- | :--- |
| `search` | `/search` | `frontend/app/search/components/Results.tsx`, `frontend/app/search/components/ChatPanel.tsx` | Used | Standard search. |
| `find` | `/find` | **None** | Removed | Deleted. |
| `search_agentic` | `/search_agentic` | **None** | Removed | Deleted. |
| `generate_answer` | `/generate_answer` | `frontend/app/search/components/ChatPanel.tsx` | Used | Answer generation stream. |
| `get_metadata` | `/get_metadata` | `frontend/app/search/components/Results.tsx`, `frontend/app/search/components/ChatPanel.tsx` | Used | Fetch label metadata. |
| `search_agentic_stream` | `/search_agentic_stream` | `frontend/app/search/components/ChatPanel.tsx` | Used | Streaming agentic search. |
| `chat` | `/chat` | `frontend/app/search/components/ChatPanel.tsx` | Used | General search chat. |
| `export_xml` | `/export_xml` | `frontend/app/search/components/Results.tsx` | Used | Export labels to XML. |
| `export_excel` | `/export_excel` | `frontend/app/search/components/Results.tsx` | Used | Export labels to Excel. |
| `random_query` | `/random_query` | `frontend/app/search/components/ChatPanel.tsx` | Used | Generate random query. |
| `snippet_preview` | `/snippet-preview` | **None** | Removed | Deleted. |

## `backend/labelcomp/blueprint.py`

| Function | Route / Internal | Called By (Location) | Status | Notes |
| :--- | :--- | :--- | :--- | :--- |
| `summarize` | `/summarize` | `frontend/app/labelcomp/page.tsx` | Used | Comparison AI summary. |
| `index` | `/` | `frontend/app/labelcomp/page.tsx` | Used | Get label comparison data. |

## `backend/drugtox/blueprint.py`

| Function | Route / Internal | Called By (Location) | Status | Notes |
| :--- | :--- | :--- | :--- | :--- |
| `read_root` | `/` | **None** | Removed | Deleted. |
| `health_check` | `/health` | **None** | Removed | Deleted. |
| `get_drugs` | `/drugs` | `frontend/app/drugtox/page.tsx` | Used | Get drugs list with filters. |
| `get_stats` | `/stats` | `frontend/app/drugtox/page.tsx` | Used | Get tox distribution stats. |
| `get_company_stats` | `/companies/<name>/stats` | `frontend/app/drugtox/page.tsx` | Used | Stats for a specific company. |
| `get_company_portfolio` | `/companies/<name>/portfolio` | `frontend/app/drugtox/page.tsx` | Used | Drugs portfolio for a company. |
| `get_discrepancies` | `/discrepancies` | `frontend/app/drugtox/page.tsx` | Used | Get market discrepancies. |
| `autocomplete` | `/autocomplete` | `frontend/app/drugtox/page.tsx` | Used | Search autocomplete. |
| `get_drug_history` | `/drugs/<setid>/history` | `frontend/app/drugtox/page.tsx` | Used | Drug tox history. |
| `get_drug_detail` | `/drugs/<setid>` | `frontend/app/drugtox/page.tsx` | Used | Drug tox details. |
| `get_drug_market` | `/drugs/<setid>/market` | `frontend/app/drugtox/page.tsx` | Used | Market comparison for drug. |

## `backend/app.py`

| Function | Route / Internal | Called By (Location) | Status | Notes |
| :--- | :--- | :--- | :--- | :--- |
| `health` | `/health` | **None** | Removed | Deleted. |
| `check_fdalabel` | `/api/check-fdalabel` | `frontend/app/page.tsx`, `frontend/app/drugtox/page.tsx`, etc. | Used | Check DB connectivity. |

## Recommendations

- **`upload_label`**: Removed.
- **Project Sharing/Bulk/Reorder routes**: Several routes like `/projects/reorder`, `/projects/move_items`, `/projects/import`, and `/projects/<id>/export` are currently unused by the frontend. If these features (bulk operations and project sharing) are not planned, they can be removed.
- **`suggest_drugs`**: Appears unused; might have been replaced by a different search implementation.
- **`import_favorites`**: Appears unused.
