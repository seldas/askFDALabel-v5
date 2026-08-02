# Frontend Architecture and Implementation Reference

**Document type:** Technical report  
**Status:** Living document  
**Implementation basis:** Current repository contents under `frontend/package.json`, `frontend/next.config.ts`, `frontend/app/`, `frontend/public/`, `frontend/scripts/`, and `frontend/Dockerfile`  
**Boundary:** This report describes the current frontend architecture, routing model, shared shell, state management, path-prefix behavior, and major implementation patterns. It is intentionally not a page-by-page user guide or a deep functional specification for each module. Detailed module documents should be maintained separately and linked from here.

## 1. Purpose and scope

The AskFDALabel frontend is a single Next.js application that serves as the browser-facing shell for the broader platform. It presents multiple functional surfaces under one UI umbrella: landing and navigation, label search, dashboard/project workflows, label detail review, comparison, toxicology exploration, device intelligence, local metadata query, administrative management, web validation, and bookmarklet/widget distribution.

The current frontend should be understood as a **multi-module application shell**, not as a standalone search site and not as a purely static presentation layer. It is responsible for:

- route composition for all user-facing modules,
- authentication and session-aware navigation,
- client-side orchestration of backend API calls,
- interactive stateful workflows such as search, filtering, comparison, and exports,
- selective visualization and rich-client rendering,
- compatibility with both local development routing and nginx-prefixed deployment routing.

This report is based on the frontend source as currently implemented. Historical notes under `idea/` are not authoritative for frontend behavior.

## 2. Current frontend model

The frontend is implemented as a **single Next.js 16 App Router application** in `frontend/app/`. It uses React 19 and TypeScript, but the architecture is primarily **client-rendered** rather than server-rendered.

A repo scan of the current app tree shows:

- **13** route pages (`page.tsx` files),
- **32** `.tsx` files under `frontend/app/`,
- **27** files explicitly marked with `'use client'`,
- **0** `route.ts` API handlers in the Next.js layer,
- **0** server actions (`'use server'`),
- **0** `loading.tsx` or `error.tsx` route boundary files.

This means the frontend is not using Next.js as a full-stack application framework in the usual App Router sense. Instead, it is using Next.js primarily for:

- browser routing,
- asset serving,
- layout composition,
- base-path handling,
- development tooling and bundling.

All business data continues to come from the Flask backend via HTTP requests.

## 3. Technology stack

### 3.1 Core framework stack

The active frontend stack in `frontend/package.json` is:

- `next 16.1.6`
- `react 19.2.4`
- `react-dom 19.2.4`
- `typescript 5.9.3`

### 3.2 Primary UI and utility libraries

The current frontend mixes several UI styles and helper libraries:

- **Material UI** (`@mui/material`, `@mui/icons-material`) — used most heavily by `drugtox`
- **Recharts** — charting in `drugtox`, `webtest`, and selected dashboard views
- **React Markdown** with `remark-gfm` and `rehype-raw` — rendering LLM-generated text and explanation panels
- **Axios** — used notably in `drugtox`; most other modules use `fetch`
- **file-saver** — used for client-side export download handling
- **lodash/debounce** — used in autocomplete and interaction throttling
- **xlsx** — present for export/report workflows

The frontend also imports a broad set of **DataTables Bootstrap CSS packages** globally in `frontend/app/globals.css`. In the current app tree, this styling footprint is larger than the visible React usage of DataTables components, which suggests some retained styling/dependency surface from earlier iterations.

## 4. Source-of-truth files and directory map

The most important frontend source areas are listed below.

| Path | Current role |
|---|---|
| `frontend/app/layout.tsx` | Root layout, font setup, metadata, global providers, auth modal mount point |
| `frontend/app/FetchPrefix.tsx` | Client-side path rewriting layer for fetch, links, media assets, and `window.open` |
| `frontend/app/context/UserContext.tsx` | Global session, active-task polling, auth modal state, AI preference updates |
| `frontend/app/components/` | Shared shell components: header, footer, auth modals, base modal |
| `frontend/app/utils/appPaths.ts` | Base-path and prefixed-path helper functions |
| `frontend/app/page.tsx` | Landing page and module portal |
| `frontend/app/search/` | Ask Elsa search/chat interface and result state |
| `frontend/app/dashboard/` | Project dashboard, label detail route, AE report route, dashboard subcomponents |
| `frontend/app/labelcomp/` | Multi-label comparison workflow |
| `frontend/app/drugtox/` | Toxicology analytics UI |
| `frontend/app/device/` | Device search, compare, MAUDE/recall views |
| `frontend/app/localquery/` | Local metadata search over snapshot label archive |
| `frontend/app/webtest/` | Template-driven regression/probing console |
| `frontend/app/management/` | Admin-only operational console |
| `frontend/app/snippet/` | Bookmarklet/widget distribution page |
| `frontend/public/dashboard/js/` | Legacy dashboard JavaScript loaded by the label detail page |
| `frontend/next.config.ts` | Backend rewrite, basePath, assetPrefix, allowed dev origins |
| `frontend/scripts/start-frontend.js` | Local/prod Next startup wrapper |
| `frontend/Dockerfile` | Container build and runtime definition |

## 5. Route inventory

The frontend currently exposes the following App Router pages.

| Route | Primary file | Current role |
|---|---|---|
| `/` | `frontend/app/page.tsx` | Landing page, global navigation hub, quick search entry, recent project summary |
| `/search` | `frontend/app/search/page.tsx` | Ask Elsa conversational search and result review surface |
| `/dashboard` | `frontend/app/dashboard/page.tsx` | Project workspace, saved labels/comparisons, import/export, AE workflow entry |
| `/dashboard/results` | `frontend/app/dashboard/results/page.tsx` | Legacy-style search results listing for dashboard search flows |
| `/dashboard/label/[setId]` | `frontend/app/dashboard/label/[setId]/page.tsx` | Detailed label review route with tabs for label, FAERS, deep dive, and safety agent view |
| `/dashboard/ae-report/[reportId]` | `frontend/app/dashboard/ae-report/[reportId]/page.tsx` | AE profile report detail and export route |
| `/labelcomp` | `frontend/app/labelcomp/page.tsx` | Multi-label comparison builder and summary workflow |
| `/drugtox` | `frontend/app/drugtox/page.tsx` | Toxicology intelligence and portfolio analysis UI |
| `/device` | `frontend/app/device/page.tsx` | Device search, comparison, and safety/recall exploration |
| `/localquery` | `frontend/app/localquery/page.tsx` | Local snapshot label archive search and export |
| `/webtest` | `frontend/app/webtest/page.tsx` | Automated/web regression validation console |
| `/management` | `frontend/app/management/page.tsx` | Administrative console for users and data-update tasks |
| `/snippet` | `frontend/app/snippet/page.tsx` | ELSA widget/bookmarklet distribution page |

Two dynamic routes are central to the frontend’s analytical workflows:

- `dashboard/label/[setId]` — the most complex single route in the frontend
- `dashboard/ae-report/[reportId]` — an analytical report viewer with exports and visualization

## 6. Shared application shell

### 6.1 Root layout

`frontend/app/layout.tsx` defines the global shell. It does four important things:

1. loads the `Inter` and `Geist Mono` fonts,
2. mounts `UserProvider` globally,
3. mounts `FetchPrefix` globally,
4. mounts `AuthModals` globally.

This is significant because authentication UX, session refresh, and path-prefix correction are not page-local concerns. They are runtime-wide behaviors.

The root metadata also hardcodes the icon path as `/askfdalabel/askfdalabel_icon.svg`, which implicitly assumes the production-style base path.

### 6.2 Shared header and footer

`frontend/app/components/Header.tsx` is the shared top-level navigation shell used across most pages. It is more than a visual header:

- it queries `/api/check-fdalabel` to determine environment capabilities,
- it conditionally exposes internal/public FDALabel links,
- it conditionally shows `localquery`,
- it surfaces active background AE tasks from `UserContext`,
- it provides account actions, AI preference selection, and management access.

The header therefore acts as a capability-aware navigation controller.

`frontend/app/components/Footer.tsx` is lightweight and present on some, but not all, pages.

### 6.3 Auth modal system

`frontend/app/components/AuthModals.tsx` centralizes login, registration, and password-change flows. Because it is mounted globally in the root layout, any route can trigger auth UX through `UserContext.openAuthModal(...)` without embedding its own auth dialog stack.

## 7. Session and global state model

### 7.1 `UserContext`

`frontend/app/context/UserContext.tsx` is the only true cross-application state container in the current frontend. It owns:

- current session data,
- loading state for session bootstrap,
- active background AE tasks,
- auth modal state,
- AI preference updates,
- session refresh logic.

This context is populated by `/api/dashboard/auth/session` and, when authenticated, also polls `/api/dashboard/ae_report/active_tasks` on the dashboard route.

The design is intentionally light-weight. There is no Redux, Zustand, SWR, or TanStack Query layer. Session and polling are handled with plain React state and effects.

### 7.2 Domain-local state

Outside `UserContext`, the frontend is dominated by **page-local `useState` and `useEffect` state management**.

Examples:

- `dashboard/page.tsx` owns project, favorite, comparison, and import/export UI state locally.
- `labelcomp/page.tsx` owns comparison-slot state, modal state, project selection, and AI summary state locally.
- `drugtox/page.tsx` owns search, paging, drawers, company selection, and chart state locally.
- `device/page.tsx` owns search, selection, modal, and compare state locally.
- `webtest/page.tsx` owns template selection, execution state, history state, sort/filter state, and report export state locally.

### 7.3 Search-specific context

The one major exception is `frontend/app/search/context/SearchContext.tsx`, which provides a domain-scoped state model for the Ask Elsa experience. It holds:

- current query text,
- structured filters,
- chat history,
- result arrays and result counts,
- generated SQL and data-filter state,
- debug/reasoning payload placeholders,
- refinement state for label-grounded answer updates.

This is the densest client-side state model in the current frontend and serves as the coordination layer between the search chat column and the result column.

## 8. Data-fetching and backend coupling model

The frontend is tightly coupled to the Flask backend. The dominant pattern is:

- browser event in a client component,
- direct `fetch(...)` or `axios(...)` call to `/api/...`,
- JSON response handling in the component,
- local state update and immediate re-render.

There is no intermediary frontend BFF layer beyond the Next.js rewrite in `next.config.ts`.

### 8.1 Current API consumption patterns by module

| Frontend area | Representative API families |
|---|---|
| Shared shell | `/api/check-fdalabel`, `/api/dashboard/auth/*`, `/api/dashboard/preferences` |
| Dashboard | `/api/dashboard/projects`, `/api/dashboard/favorites_data`, `/api/dashboard/project_stats`, `/api/dashboard/import_fdalabel`, `/api/dashboard/favorite_all` |
| Label detail | `/api/dashboard/label/<setId>`, `/api/dashboard/export_sections`, `/api/dashboard/meddra/profile/<setId>`, `/api/dashboard/faers/*`, `/api/dashboard/deep_dive/*` |
| AE profile | `/api/dashboard/ae_report/*` |
| Label comparison | `/api/labelcomp/*`, plus dashboard project/favorite helper routes |
| Search | `/api/search/*` |
| DrugTox | `${API_BASE}/api/drugtox/*` |
| Device | `/api/device/*` |
| Local query | `/api/localquery/*` |
| Web test | `${API_BASE}/api/webtest/*` |
| Management | `/api/dashboard/admin/*` |

### 8.2 Mixed request styles

The request model is not fully uniform.

- Most modules use relative `/api/...` URLs and rely on either the Next.js rewrite or the `FetchPrefix` runtime patch.
- `drugtox` and `webtest` explicitly construct backend-prefixed URLs using `API_BASE`.
- `localquery` mostly uses relative `/api/...` calls but hardcodes one export URL to `/askfdalabel_api/api/localquery/export`.

This mixed style is workable, but it means path-prefix correctness depends on multiple overlapping mechanisms.

## 9. Routing, base paths, and deployment prefix behavior

### 9.1 Build-time base path

`frontend/next.config.ts` sets:

- a rewrite from `/api/:path*` to the Flask backend,
- `basePath` from `FRONTEND_BASE_PATH` (default `/askfdalabel`),
- `assetPrefix` from the same normalized value.

This is the build-time routing layer.

### 9.2 Runtime path helpers

`frontend/app/utils/appPaths.ts` separately defines runtime path helpers:

- `APP_BASE` from `NEXT_PUBLIC_APP_BASE` (default `/askfdalabel`)
- `API_BASE` from `NEXT_PUBLIC_API_BASE` (default `/askfdalabel_api`)
- `DASHBOARD_BASE` from `NEXT_PUBLIC_DASHBOARD_BASE` or `APP_BASE`
- `withAppBase(...)`
- `withDashboardBase(...)`

This is a second configuration surface, separate from `FRONTEND_BASE_PATH`.

### 9.3 Global path rewriting layer

`frontend/app/FetchPrefix.tsx` adds a third layer. At runtime it:

- monkey-patches `window.fetch`,
- monkey-patches `window.open`,
- rewrites anchor `href`s in the DOM,
- rewrites `src` and `srcset` on media elements,
- prefixes `/api/...` requests with `API_BASE`,
- prefixes dashboard-style routes with `DASHBOARD_BASE`,
- prefixes asset paths with `APP_BASE`.

This is unusual for a modern React/Next application and should be treated as a compatibility layer for mixed deployment environments rather than as a long-term architectural ideal.

### 9.4 Practical implication

The frontend currently depends on **three partially overlapping path mechanisms**:

1. Next.js `basePath` and API rewrites,
2. runtime helper functions in `appPaths.ts`,
3. the global `FetchPrefix` mutation layer.

The application works because these layers generally point to the same prefixes, but they can drift if configured inconsistently.

## 10. Styling architecture

The current frontend uses a hybrid styling model.

### 10.1 Inline styles are dominant

Most route pages and shared components rely heavily on inline style objects. This is the dominant style system in:

- `page.tsx`
- `dashboard/page.tsx`
- `labelcomp/page.tsx`
- `device/page.tsx`
- `localquery/page.tsx`
- `snippet/page.tsx`
- `management/page.tsx`

### 10.2 Global and feature CSS

The frontend also uses a smaller set of global and feature CSS files:

- `frontend/app/globals.css`
- `frontend/app/dashboard/dashboard.css`
- `frontend/app/dashboard/label/[setId]/analysis.css`
- `frontend/app/dashboard/label/[setId]/label_view.css`
- `frontend/app/search/search_global.css`
- `frontend/app/dashboard/components/ProjectSummary.module.css`

The styling model is therefore not CSS-module-first. CSS is used selectively for larger, repeated feature surfaces, while most UI decisions remain co-located in TSX.

### 10.3 Route-specific library styling

`drugtox/page.tsx` is an outlier because it uses Material UI extensively, adding a component-library styling idiom that differs from the rest of the app. This means the frontend does not have one uniform presentation stack.

## 11. The label detail route as a hybrid legacy-modern boundary

The most important frontend implementation detail is in `frontend/app/dashboard/label/[setId]/page.tsx`.

That route is not purely React-driven. It is a **hybrid boundary** between modern Next.js code and legacy dashboard JavaScript.

### 11.1 What the React layer does

The React/Next layer:

- fetches the label payload,
- renders the route shell and tab layout,
- manages tab state, TOC state, export selection state, and modal state,
- mounts subviews such as `LabelView`, `DeepDiveView`, `FaersView`, and `AgentView`.

### 11.2 What the legacy layer still does

The same page also:

- injects label metadata into `window.*` globals,
- waits for legacy initializers such as `initUI`, `initFaers`, `initToxAgents`, `initChat`, `initAnnotations`, and `initFavorites`,
- loads multiple scripts from `frontend/public/dashboard/js/` via `next/script`.

Currently loaded script assets include:

- `chart.js`
- `marked.min.js`
- `utils.js`
- `ui.js`
- `favorites.js`
- `session_manager.js`
- `chat.js`
- `annotations.js`
- `faers.js`
- `tox.js`

This architecture matters because it means the label-detail route is partly dependent on imperative DOM-oriented logic and global browser state. It is therefore the least React-native part of the current frontend and should be treated as a transitional integration zone.

## 12. Module-level implementation patterns

This section intentionally stays high-level and defers deep module behavior to future companion documents.

### 12.1 Landing and navigation

`frontend/app/page.tsx` acts as a platform entry page rather than a marketing-only home page. It includes:

- quick search dispatch to `/search?q=...`,
- recent project retrieval for authenticated users,
- links into the major modules.

### 12.2 Search

`frontend/app/search/page.tsx` builds a two-column experience around `SearchProvider`, `ChatPanel`, and `Results`. The architecture anticipates:

- conversational querying,
- structured filters,
- evidence/result panels,
- SQL/debug visibility,
- answer refinement against selected labels.

### 12.3 Dashboard and reports

The dashboard routes combine project management with saved-label workflows, imports, exports, comparison shortcuts, and AE profiling.

### 12.4 Comparison and data exploration modules

`labelcomp`, `drugtox`, `device`, `localquery`, and `webtest` are all route-local applications inside the same shell. They share the header/session model but otherwise keep most state and behavior local to each route.

### 12.5 Admin and utilities

`management` is an admin-only route for user and maintenance operations. `snippet` is a specialized distribution page for bookmarklets/widgets rather than a conventional analysis module.

## 13. Build, startup, and container model

### 13.1 Local startup wrappers

The frontend package defines these notable scripts:

- `npm run dev` → `frontend/scripts/start-frontend.js`
- `npm run dev:backend` → `frontend/scripts/start-backend.js`
- `npm run dev:all` → starts both frontend and backend concurrently
- `npm run build`
- `npm run start`
- `npm run prod`

This means the frontend repo subproject is being used as a convenience launcher for both halves of the stack during local development.

### 13.2 Backend rewrite during development

`next.config.ts` rewrites `/api/:path*` to the Flask backend, using `BACKEND_URL` or `HOST` + `BACKEND_PORT`. This allows the browser to interact with Flask through the Next dev server without changing the frontend code.

### 13.3 Container build

`frontend/Dockerfile` builds the Next app in production mode on Node 22, runs `npm ci`, performs `npm run build`, exposes port `8841`, and starts the app with `npm run start`.

## 14. Security and authorization behavior

The frontend does not own security enforcement, but it does shape the user experience around authentication and authorization.

- Session bootstrap is performed globally through `UserContext`.
- Auth-required actions often trigger `openAuthModal('login')` rather than redirecting immediately.
- Admin UI visibility is controlled in the header and in the `/management` page.
- `/management` performs a client-side redirect to `/` if the user is not authenticated or not admin.

This is appropriate as UX logic, but backend permission checks remain the real enforcement boundary.

## 15. Observed drift, inconsistencies, and cleanup candidates

The current frontend is functional, but several architecture-level inconsistencies should be documented clearly.

### 15.1 Split path-prefix configuration

The frontend currently depends on all of the following:

- `FRONTEND_BASE_PATH` in `next.config.ts`
- `NEXT_PUBLIC_APP_BASE`, `NEXT_PUBLIC_API_BASE`, and `NEXT_PUBLIC_DASHBOARD_BASE` in `appPaths.ts`
- `FetchPrefix.tsx` runtime rewrites

These should be kept aligned. The current implementation works best when nginx is the reference deployment layer and all prefixes resolve consistently.

### 15.2 Hardcoded `/askfdalabel` and `/askfdalabel_api` assumptions

Several places still hardcode production-style prefixes instead of routing through shared helpers, including:

- `layout.tsx` icon metadata
- `dashboard/label/[setId]/page.tsx` script asset URLs
- `localquery/page.tsx` export URL

These are fragile if deployment prefixes ever change.

### 15.3 Search frontend and backend contract drift

The search frontend is in a transitional state.

From the current frontend code:

- `ChatPanel.tsx` posts to `/api/search/chat`
- `Results.tsx` posts to `/api/search/search`
- `Results.tsx` posts to `/api/search/get_metadata`
- `Results.tsx` posts to `/api/search/export_xml`
- `Results.tsx` posts to `/api/search/export_excel`
- `SearchContext.tsx` posts to `/api/search/refine_chat` and `/api/search/filter_data`

From the current backend route surface in `backend/search/blueprint.py`, the implemented routes include:

- `/chat`
- `/refine_chat`
- `/filter_data`
- `/search_agentic_stream`
- `/get_metadata`
- `/export_excel`

But there is **no current `/search` route** and **no current `/export_xml` route** in that blueprint. The frontend therefore still contains calls that do not match the present backend route map.

A related issue is that the frontend search state model is prepared for richer agent/debug payloads, while `ChatPanel.tsx` currently uses the simpler `/api/search/chat` JSON flow rather than the streaming `/search_agentic_stream` endpoint.

### 15.4 Duplicate and likely stale frontend search artifacts

Two frontend files appear unreferenced in the current App Router tree:

- `frontend/app/search/components/Header.tsx`
- `frontend/app/search/page.module.css`

They should be treated as likely stale until proven otherwise.

### 15.5 Hybrid legacy boundary on the label route

The label-detail route still depends on browser globals and imperative scripts from `frontend/public/dashboard/js/`. This is the single clearest signal that the frontend is still carrying forward legacy dashboard behavior inside a newer Next.js shell.

## 16. Recommended documentation follow-ons

This report should be paired with narrower documents rather than expanded into a full manual.

Recommended companion docs:

- `Documents/Search.md` or `Documents/AI-and-Search.md` — detailed Ask Elsa/search UI and backend contract
- `Documents/Dashboard.md` — project workspace, favorites, comparisons, AE workflows
- `Documents/Label-Detail.md` — hybrid label route, TOC model, legacy script integration
- `Documents/DrugTox.md` — MUI-based toxicology explorer
- `Documents/Device.md` — device search/compare/MAUDE UI
- `Documents/Operations.md` — frontend deployment paths, nginx prefixes, and environment settings

## 17. Summary

The AskFDALabel frontend is best described as a **single Next.js application that hosts several route-local analytical tools under a shared session-aware shell**. It is modern in framework choice, but not uniformly modern in implementation style. Most of the app is client-rendered and uses direct backend calls with local React state. The most complex route, `dashboard/label/[setId]`, remains a hybrid integration point that combines React components with legacy JavaScript assets and `window.*` globals.

From a maintenance standpoint, the frontend is stable enough to document as one coherent application, but it should not be described as a fully uniform or fully migrated architecture. The most important realities to preserve in the documentation are:

- it is multi-module rather than single-purpose,
- it is heavily client-driven,
- it depends on layered path-prefix handling,
- it uses a hybrid legacy boundary on the label-detail route,
- its search UI currently shows backend contract drift that should be cleaned up.
