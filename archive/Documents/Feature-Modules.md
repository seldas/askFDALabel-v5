# AskFDALabel Feature Modules Report

**Document type:** Module map and capability crosswalk  
**Status:** Living document  
**Implementation basis:** Current repository contents under `frontend/app/`, `backend/`, `backend/dashboard/routes/`, `backend/admin/tasks/`, `backend/search/scripts/`, and `frontend/public/snippets/`  
**Boundary:** This report maps the current first-class modules in the AskFDALabel suite and explains how they relate to one another. It is intentionally module-centered rather than endpoint-centered. It does **not** replace the deeper architecture, backend, frontend, database, operations, AI/search, or data-source reports.

## Abstract

AskFDALabel is no longer best understood as a single dashboard with several side tools. The current repository implements a set of feature modules that share one frontend shell, one unified Flask backend, one PostgreSQL-centered persistence layer, and a common pool of data services. Some modules are core workspace surfaces for daily labeling work. Some are specialized analytical domains. Some are administrative or distribution-oriented subsystems.

This report provides the missing product-surface map across those modules. For each module it identifies the current purpose, primary frontend and backend entry points, principal data dependencies, common workflows, related technical documents, and the most important caveats visible in the current codebase. The goal is to make the overall suite legible without repeating the implementation-level detail that belongs in later module-specific deep dives.

## 1. Scope and reading guide

The most useful way to read the current application is by **module responsibility**, not by directory name alone. The checked-in code naturally groups into four module families:

1. **Core workspace modules** — the daily work surfaces for label retrieval, review, organization, and comparison.
2. **Analytical domain modules** — specialized surfaces that enrich labeling work with toxicity or device intelligence.
3. **Administrative and validation modules** — control-plane and regression-style tools used to maintain or validate the platform.
4. **Distribution-style modules** — embed or snippet-oriented surfaces that reuse platform data outside the main review workspace.

The browser root page (`frontend/app/page.tsx`) acts as a suite launcher and shared landing surface, but it is not treated here as a standalone feature module. It is better understood as the entry shell that routes users into the modules documented below.

## 2. Module inventory at a glance

| Module | Primary browser route(s) | Primary backend surface(s) | Module class | Principal dependencies | Primary companion docs |
|---|---|---|---|---|---|
| Dashboard | `/dashboard`, `/dashboard/results`, `/dashboard/label/[setId]`, `/dashboard/ae-report/[reportId]` | `backend/dashboard/routes/main.py`, `api.py`, `auth.py` | Core workspace | Projects, favorites, annotations, AE reports, MedDRA, FAERS, PGx, SPL metadata/sections | `Overview.md`, `Architecture.md`, `Backend.md`, `Frontend.md`, `Database.md` |
| Search | `/search` | `backend/search/blueprint.py`, `backend/search/scripts/` | Core workspace | SPL sections, vector/semantic search, AI service layer, metadata filtering | `AI-and-Search.md`, `Frontend.md`, `Backend.md`, `Database.md` |
| Label Comparison | `/labelcomp` | `backend/labelcomp/blueprint.py`, `compare.py` | Core workspace | SPL XML retrieval/parsing, saved comparisons, dashboard projects/favorites | `Backend.md`, `Frontend.md`, `AI-and-Search.md` |
| Local Query | `/localquery` | `backend/localquery/blueprint.py` | Core workspace | Local label database via `FDALabelDBService`, export workflows | `Data-Sources.md`, `Backend.md`, `Frontend.md` |
| DrugTox | `/drugtox` | `backend/drugtox/blueprint.py` | Analytical domain | `public.drug_toxicity`, local label linkage, toxicity imports | `Data-Sources.md`, `Database.md`, `Backend.md` |
| Device | `/device` | `backend/device/blueprint.py`, `backend/device/services/` | Analytical domain | openFDA device endpoints, MAUDE, recall feeds, shared AI layer | `Data-Sources.md`, `Backend.md`, `Frontend.md` |
| Snippet | `/snippet` | `backend/dashboard/routes/main.py` (`/snippet-preview`), public static assets | Distribution | Static snippet assets, label preview lookup, generated trie/script assets | `Data-Sources.md`, `Frontend.md`, `Operations.md` |
| Management | `/management` | `backend/dashboard/routes/admin.py`, `backend/admin/tasks/` | Administrative | User accounts, `system_tasks`, import scripts, log polling | `Operations.md`, `Backend.md`, `Database.md` |
| FDA Autotest / Webtest | `/webtest` | `backend/webtest/blueprint.py` | Validation | Excel templates, JSON result files, history workbooks | `FDA_autotest.md`, `Operations.md` |

## 3. Shared module foundations

Although the suite presents many modules, they are not independent applications in deployment terms.

### 3.1 Shared frontend shell

All browser modules sit inside the same Next.js app-router application under `frontend/app/`. They share:

- `frontend/app/components/Header.tsx` and `Footer.tsx`
- `frontend/app/context/UserContext.tsx` for authentication/session state and AI-provider preference exposure
- `frontend/app/FetchPrefix.tsx` and `frontend/app/utils/appPaths.ts` for path-prefix rewriting under `/askfdalabel` and `/askfdalabel_api`

This means the module boundaries at the UX level are softer than they appear from the URL map. Navigation, auth state, fetch behavior, and base-path behavior are global concerns.

### 3.2 Shared backend foundation

All modules ultimately run inside the unified Flask app assembled in `backend/app.py`. The dashboard app factory in `backend/dashboard/__init__.py` provides the base runtime, and additional blueprints are layered on top of it. In practice, this means even modules that appear separate from the dashboard still inherit the same configuration, logging, database initialization, and shared service environment.

### 3.3 Shared data plane

Most modules depend directly or indirectly on the same data plane:

- `public` schema tables for users, projects, saved artifacts, caches, toxicity/PGx data, MedDRA, tasks, and assessments
- `labeling` schema tables for local SPL metadata and section content
- shared service access to openFDA, optional Oracle/internal FDALabel sources, and LLM providers
- file-backed runtime state under `data/`, uploads, webtest artifacts, and public static assets

For that reason, a module map is useful only if it also shows how porous the boundaries are. Several modules reuse the same data services in different ways.

## 4. Core workspace modules

### 4.1 Dashboard

#### Purpose

The Dashboard module is the primary workspace for project-oriented labeling review. It handles saved labels, project organization, imports from FDALabel-style spreadsheets, label detail review, annotations, adverse-event reporting workflows, and several label-adjacent analytical actions. It is also the historical and technical center of gravity of the backend.

#### Primary frontend entry points

- `frontend/app/dashboard/page.tsx`
- `frontend/app/dashboard/results/page.tsx`
- `frontend/app/dashboard/label/[setId]/...`
- `frontend/app/dashboard/ae-report/[reportId]/page.tsx`

#### Primary backend components

- `backend/dashboard/routes/main.py`
- `backend/dashboard/routes/api.py`
- `backend/dashboard/routes/auth.py`
- `backend/dashboard/routes/admin.py` for related control-plane actions
- shared services in `backend/dashboard/services/`

#### Key dependencies

Dashboard is the heaviest consumer of shared state. Its current workflows touch:

- user/session tables and preferences
- `Project`, `Favorite`, `FavoriteComparison`, `Annotation`, and `LabelAnnotation`
- `ProjectAeReport` and `ProjectAeReportDetail`
- MedDRA reference tables
- cached assessment tables such as DILI/DICT/DIRI/PGx and AI assessment records
- `labeling.sum_spl` and `labeling.spl_sections`
- shared services for XML parsing, openFDA access, local label lookup, deep-dive analysis, PGx handling, and AI prompting

#### Core workflows

In practical terms, Dashboard supports four intertwined workflows:

1. **Workspace management** — create/select projects, move through saved labels, manage saved comparisons, export project data.
2. **Label review** — inspect detailed label views, save annotations, check favorites, retrieve metadata, and export sections.
3. **Project ingestion** — import labels from spreadsheet exports or uploaded SPL-like content.
4. **Analytical augmentation** — trigger adverse-event reports, MedDRA scans, FAERS-linked views, PGx assessment, and AI explanations.

#### Related documents

- `Overview.md`
- `Architecture.md`
- `Backend.md`
- `Frontend.md`
- `Database.md`
- `Data-Sources.md`

#### Current caveats

Dashboard is not merely one feature area. It is both a user-facing module and the **application foundation**. That dual role matters because many supposedly separate modules still depend on dashboard services or dashboard-owned routes. The current label-detail experience also remains hybrid: the Next.js route exists, but parts of that experience still rely on older assets and patterns carried forward from the earlier implementation.

### 4.2 Search

#### Purpose

The Search module is the natural-language and evidence-grounded retrieval workspace. It combines an AI chat surface with structured results, metadata filtering, export actions, and a semantic-search backend that is more ambitious than the current default frontend wiring suggests.

#### Primary frontend entry points

- `frontend/app/search/page.tsx`
- `frontend/app/search/components/ChatPanel.tsx`
- `frontend/app/search/components/Results.tsx`
- `frontend/app/search/context/SearchContext.tsx`

#### Primary backend components

- `backend/search/blueprint.py`
- `backend/search/scripts/general_search.py`
- `backend/search/scripts/semantic_search.py`
- `backend/search/scripts/semantic_core/`

#### Key dependencies

Search depends on:

- the local label corpus and label metadata exposed through the shared data layer
- section-level content from `labeling.spl_sections`
- vector/semantic search infrastructure, including embedding-related objects described in `Database.md`
- the shared AI provider abstraction in `backend/dashboard/services/ai_handler.py`
- metadata filtering and result export utilities

#### Core workflows

The current module exposes two parallel behaviors inside one workspace:

1. **AI-led question answering** — the user asks a natural-language question and receives a grounded response.
2. **Structured result review** — the right-hand results region filters, pages, and exports label-centric result sets.

The codebase also contains an agentic streaming path, planning/reasoning support, and semantic-core orchestration components that indicate the module is intended to evolve beyond its current default chat behavior.

#### Related documents

- `AI-and-Search.md`
- `Architecture.md`
- `Backend.md`
- `Frontend.md`
- `Database.md`

#### Current caveats

Search is the clearest example of a module in transition. The React page still defaults to `/api/search/chat`, while the repository also contains the richer semantic-core stack and a streaming endpoint. `backend/search/blueprint.py` currently defines `POST /api/search/chat` twice, and the frontend still references stale backend contracts in a few places. This module should therefore be treated as strategically important but currently mid-refactor.

### 4.3 Label Comparison

#### Purpose

The Label Comparison module is the structured document-diff workspace for SPL labels. It supports side-by-side or multi-label comparison, project-driven label selection, uploaded-label inclusion, AI-written difference summaries, and persistence of saved comparison records.

#### Primary frontend entry points

- `frontend/app/labelcomp/page.tsx`

#### Primary backend components

- `backend/labelcomp/blueprint.py`
- `backend/labelcomp/compare.py`
- shared XML and metadata services from the dashboard service layer

#### Key dependencies

This module reuses both shared label services and workspace state:

- SPL XML retrieval and parsing through `fda_client.py` and `xml_handler.py`
- saved-comparison state through `ComparisonSummary` and dashboard favorite-comparison flows
- project and favorite state when labels are sourced from user workspaces
- local uploads when the comparison workspace adds user-provided labels

#### Core workflows

The current code supports:

1. selecting labels through query parameters, project-saved labels, or file upload,
2. parsing section structure and aligning sections for comparison,
3. rendering content differences and similarity markers,
4. generating an AI summary of substantive differences,
5. optionally saving the comparison back into the user’s workspace.

#### Related documents

- `Backend.md`
- `Frontend.md`
- `AI-and-Search.md`
- `Database.md`

#### Current caveats

This module is narrower than Dashboard or Search but deeply intertwined with them. It depends on dashboard project/favorites flows on the frontend, on shared XML/metadata services on the backend, and on cached comparison summaries in the database. The backend contract also uses the bare `/api/labelcomp/` root route for the main comparison payload, which works but is less self-documenting than a more explicit route shape.

### 4.4 Local Query

#### Purpose

Local Query is the deterministic archive search surface for the local labeling database. It is the closest thing in the current suite to a direct “local corpus browser,” emphasizing exact or near-exact search, autocomplete, random sample retrieval, and export rather than AI interpretation.

#### Primary frontend entry points

- `frontend/app/localquery/page.tsx`

#### Primary backend components

- `backend/localquery/blueprint.py`
- `dashboard.services.fdalabel_db.FDALabelDBService`

#### Key dependencies

The module relies primarily on the local label database abstraction exposed by `FDALabelDBService`. Under the current PostgreSQL path, that ultimately maps to the normalized labeling corpus and related lookup structures rather than to openFDA search.

#### Core workflows

The current module supports:

1. deterministic search by drug name, set ID, or application number,
2. autocomplete against local label data,
3. optional filtering to human prescription and/or RLD records,
4. random record sampling for browsing,
5. export of results into a spreadsheet format intended to feed Dashboard import workflows.

#### Related documents

- `Data-Sources.md`
- `Backend.md`
- `Frontend.md`
- `Operations.md`

#### Current caveats

Local Query is intentionally not an AI surface. Its value is precision, deterministic access, and compatibility with local data. The frontend currently hardcodes the export path through the prefixed API form, which is operationally fine behind nginx but reinforces the current path-prefix split documented elsewhere.

## 5. Analytical domain modules

### 5.1 DrugTox

#### Purpose

DrugTox is the toxicity-classification and market-comparison workspace for drug labeling. It exposes toxicity-category distributions, detailed label-level toxicity records, discrepancy detection across manufacturers, timeline/history review, and company portfolio views. Conceptually it sits beside the core label workflows as a domain-enrichment module.

#### Primary frontend entry points

- `frontend/app/drugtox/page.tsx`

#### Primary backend components

- `backend/drugtox/blueprint.py`

#### Key dependencies

The module is centered on:

- `public.drug_toxicity` as the primary operational dataset,
- linkage back to the label corpus via `labeling.sum_spl` and `FDALabelDBService`,
- imported toxicity source files described in `Data-Sources.md`,
- dashboard label-view links when the user pivots from a toxicity record to official labeling.

#### Core workflows

The current UI and route layer support:

1. searching drugs by trade/generic/company name,
2. toggling toxicity families such as DILI and related categories,
3. surfacing discrepancy cases where manufacturers disagree,
4. reviewing a single label’s toxicity history,
5. comparing the market around the same generic name,
6. drilling into company-level distributions and portfolios.

#### Related documents

- `Data-Sources.md`
- `Database.md`
- `Backend.md`
- `Frontend.md`

#### Current caveats

DrugTox is operationally mature enough to be useful, but it is highly data-dependent. Without the import pipeline populating `public.drug_toxicity`, the module is effectively empty. The backend also uses a SQL-text-heavy route layer tightly coupled to the imported table’s mixed-case column conventions, so schema drift in the source dataset would affect this module quickly.

### 5.2 Device

#### Purpose

The Device module extends AskFDALabel beyond drug labeling into device intelligence. It is a live-query surface for device approvals and postmarket context, with search, MAUDE-based safety summaries, recall summaries, and AI-generated comparison of indications-for-use content.

#### Primary frontend entry points

- `frontend/app/device/page.tsx`
- `frontend/app/device/components/DeviceCompare.tsx`

#### Primary backend components

- `backend/device/blueprint.py`
- `backend/device/services/device_client.py`
- `backend/device/services/maude_analyzer.py`
- `backend/device/services/recall_analyzer.py`

#### Key dependencies

Unlike the drug-label modules, Device depends mainly on live external data:

- openFDA 510(k) and PMA endpoints,
- MAUDE-style device event summaries,
- recall/enforcement endpoints summarized by the device services,
- the shared AI layer for IFU comparison and free-text analysis.

#### Core workflows

The module supports:

1. live search by device name, manufacturer, or K/P number,
2. retrieval of product code and approval context,
3. safety and recall summarization by product code,
4. side-by-side IFU comparison for two selected devices.

#### Related documents

- `Data-Sources.md`
- `Backend.md`
- `Frontend.md`
- `AI-and-Search.md`

#### Current caveats

This module should be treated as a domain-adjacent live integration rather than as part of the local SPL corpus. It does not share the same persistence depth as the drug-label modules. One important implementation gap is that `get_device_metadata()` currently returns `None`, so the metadata route exists conceptually but is not yet a fully realized feature path.

## 6. Distribution, administrative, and validation modules

### 6.1 Snippet

#### Purpose

Snippet is a distribution-oriented module rather than a traditional in-app analytical workspace. It packages and exposes lightweight tools that can be embedded or invoked outside the main application shell, including drug snippets and label-highlighting assets.

#### Primary frontend entry points

- `frontend/app/snippet/page.tsx`
- public assets under `frontend/public/snippets/`

#### Primary backend components

- `backend/dashboard/routes/main.py` (`/api/dashboard/snippet-preview`)
- generation assets under `backend/search/scripts/drug_snippet/`

#### Key dependencies

Snippet spans three asset layers:

- public JavaScript/CSS/media assets served from `frontend/public/snippets/`
- backend preview lookup via `FDALabelDBService.get_drug_info()`
- trie/script-generation assets under the search scripts area

#### Core workflows

The module currently functions as a catalog and launcher for:

1. drug snippet bookmarklets/widgets,
2. label-highlighting/embed assets,
3. preview-style lookup of drug metadata before deployment in an external surface.

#### Related documents

- `Data-Sources.md`
- `Frontend.md`
- `Operations.md`

#### Current caveats

Snippet is only partly an “app module.” Much of its value lies in the public static assets it distributes. The current repository also shows an asset-path inconsistency between checked-in snippet assets and generation targets, so this module should be treated as useful but somewhat operationally fragile until those paths are normalized.

### 6.2 Management

#### Purpose

Management is the internal control-plane module for user administration and data-maintenance orchestration. It is not a general settings page. It is an administrator-facing operational surface that launches background refresh jobs and manages platform users.

#### Primary frontend entry points

- `frontend/app/management/page.tsx`

#### Primary backend components

- `backend/dashboard/routes/admin.py`
- `backend/admin/tasks/import_labels.py`
- `backend/admin/tasks/import_meddra.py`
- `backend/admin/tasks/import_orangebook.py`
- `backend/admin/tasks/import_drugtox.py`

#### Key dependencies

Management is coupled to:

- `User` records and auth/session state,
- `SystemTask` task tracking,
- admin-triggered subprocess jobs and their logs,
- the import/update scripts that maintain datasets consumed by Dashboard, Search, DrugTox, and Local Query.

#### Core workflows

The current module supports:

1. creating, editing, and deleting users,
2. changing user roles and passwords,
3. launching dataset-refresh tasks,
4. polling task status and retrieving task logs.

#### Related documents

- `Operations.md`
- `Backend.md`
- `Database.md`
- `Data-Sources.md`

#### Current caveats

Management is central to platform upkeep, but it is only as reliable as the underlying import scripts and environment configuration. In particular, any drift in label-database connectivity, Oracle configuration, or file-path assumptions propagates into this module because it is the orchestration surface for those refresh jobs.

### 6.3 FDA Autotest / Webtest

#### Purpose

The FDA Autotest module, implemented in code as `webtest`, is the regression-style validation surface for FDALabel query behavior. It is designed for repeated probing, result capture, and historical comparison of query behavior against templated inputs.

#### Primary frontend entry points

- `frontend/app/webtest/page.tsx`

#### Primary backend components

- `backend/webtest/blueprint.py`
- file-backed stores under `backend/webtest/results/` and `backend/webtest/history/`

#### Key dependencies

The module uses:

- Excel templates in `backend/webtest/`
- JSON result snapshots in `backend/webtest/results/`
- workbook history files in `backend/webtest/history/`

It does not depend on the main PostgreSQL schema in the same way as the rest of the platform.

#### Core workflows

The current module supports:

1. loading a test template,
2. probing one query URL at a time through the backend,
3. saving result snapshots,
4. generating a report from captured results,
5. visualizing historical comparisons by task or grouped query.

#### Related documents

- `FDA_autotest.md`
- `Operations.md`

#### Current caveats

This is best understood as a specialized validation subsystem rather than a general QA framework. It is file-backed, not database-backed, and it is oriented around FDALabel probe behavior rather than end-to-end browser automation.

## 7. Cross-module workflow map

The current suite is best understood not as nine isolated modules, but as a set of linked user journeys.

### 7.1 Core labeling path

A typical labeling workflow can begin in **Search** or **Local Query**, move into **Dashboard** for saving and review, pivot into **Label Comparison** for structured diffing, and return to Dashboard for project persistence or AE/annotation work. These four modules form the practical core of the application.

### 7.2 Domain enrichment path

A user can leave the core labeling path and enter **DrugTox** for toxicity-oriented market context or **Device** for device-specific safety/comparison context. These are not replacements for the core label workspace, but adjacent analytical modules that extend it.

### 7.3 Operations and maintenance path

**Management** maintains the datasets that feed the core and analytical modules. In practical terms, this module sits upstream of several others: if labeling, MedDRA, Orange Book, or DrugTox data is stale, the user-facing modules degrade.

### 7.4 Validation path

**FDA Autotest / Webtest** does not validate the entire local workspace. Instead, it validates FDALabel-facing query behavior through templated probes and historical comparison. It should be considered a platform-assurance module, not a user-analysis module.

### 7.5 Distribution path

**Snippet** takes a different path altogether. It packages selected platform capabilities for use outside the normal shell through bookmarklets, widgets, or injected highlighting behavior.

## 8. Documentation follow-on priorities

This report completes the high-level module map, but some modules are more deserving of dedicated deep dives than others.

### Highest-value next deep dives

1. **Dashboard deep dive** — because it is both the primary workspace and the backend foundation.
2. **Search deep dive** — because it is strategically important and visibly mid-transition.
3. **Label Comparison deep dive** — because it sits at the intersection of XML parsing, AI summarization, and project workflows.
4. **DrugTox deep dive** — because it has a distinct data model and specialized analytical semantics.

### Medium-priority follow-ons

- **Management deep dive** for admin task orchestration and data-refresh flows
- **Device deep dive** for external endpoint use and live-analysis constraints
- **Snippet deep dive** only if snippet distribution is a product priority

## 9. Current architectural reading of the module map

The current repository does not represent a collection of disconnected mini-apps. It represents a **shared platform with differentiated surfaces**. Dashboard is the oldest and deepest module. Search is the most strategically ambitious but also the most transitional. Label Comparison and Local Query are focused companions to the core label workspace. DrugTox and Device are domain enrichments. Management and FDA Autotest are control-plane and assurance layers. Snippet is a distribution surface.

That interpretation aligns better with the current codebase than either of the two overly simple alternatives: describing AskFDALabel as “just a dashboard” or describing it as “a set of unrelated apps.” It is neither. It is a modular but tightly shared platform, and that is the model future documentation should continue to reinforce.
