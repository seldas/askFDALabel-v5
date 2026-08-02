# AskFDALabel FDA Auto Test Report

**Document type:** Technical subsystem report  
**Status:** Living document  
**Implementation basis:** Current repository contents under `backend/webtest/`, `frontend/app/webtest/`, `backend/app.py`, `frontend/app/FetchPrefix.tsx`, and checked-in template/history/result artifacts  
**Boundary:** This report documents only the `webtest` subsystem, exposed in the UI as the **FDALabel Auto Test Tool**. It is intentionally focused on the current implementation of that subsystem rather than the broader AskFDALabel platform.

**Companion documents:**
- [`Overview.md`](./Overview.md) for platform scope and positioning
- [`Architecture.md`](./Architecture.md) for suite-wide topology and request flow
- [`Backend.md`](./Backend.md) for the full Flask application structure and auth model
- [`Frontend.md`](./Frontend.md) for the full Next.js application structure
- [`Operations.md`](./Operations.md) for deployment, environment, and filesystem behavior

## Abstract

The `webtest` subsystem is a lightweight, file-backed operational validation tool for FDALabel endpoints. Despite the UI label “Web Application Auto-Testing,” the current implementation is not a browser-automation framework in the Selenium or Playwright sense. It does not drive a DOM, click through pages, or assert rendered UI elements. Instead, it reads Excel-based test templates, converts FDALabel UI links into service endpoints, issues HTTP requests against those endpoints, extracts result counts and latency, and persists the observed run history to local files.

Functionally, the subsystem sits between a smoke-test runner, a latency monitor, and a historical comparison dashboard. It is useful for checking whether selected FDALabel query endpoints are reachable, how many labeling results they return, and how long they take to respond. It is much less mature as an automated “pass/fail” test harness, because the current code does not evaluate the template’s expected counts, does not maintain structured assertions, and does not persist results in the application database.

The subsystem is therefore best understood as an internal operational probe tool with historical reporting, not as a comprehensive automated QA platform.

## 1. Scope and intended role

Within the current AskFDALabel suite, `webtest` serves four practical purposes:

1. **Template-driven endpoint probing** — a curated set of FDALabel URLs can be run repeatedly from a saved workbook.
2. **Latency observation** — each probe records time-to-response for the target endpoint.
3. **Historical trend inspection** — prior runs can be visualized per URL or per grouped query.
4. **Operator export** — the current run can be exported as an Excel workbook and archived as JSON.

The subsystem does **not** currently provide:

- full browser automation,
- screenshot or DOM verification,
- automated comparison against expected baseline counts from the template workbook,
- database-backed run storage,
- job queue execution,
- scheduled test orchestration,
- environment-aware configuration management beyond what is inferred from URLs and version labels.

## 2. Current implementation footprint

The active implementation is concentrated in a small number of files:

- `backend/webtest/blueprint.py` — entire backend route surface and file I/O logic
- `backend/app.py` — blueprint registration at `/api/webtest`
- `frontend/app/webtest/page.tsx` — complete user interface and orchestration logic
- `frontend/app/FetchPrefix.tsx` — path-prefix rewriting so `/webtest` and `/api/webtest/*` work under `/askfdalabel` and `/askfdalabel_api`
- `backend/webtest/Testing_Template_11152022.xlsx` — primary checked-in template
- `backend/webtest/Testing_Template_11152022_public.xlsx` — smaller public template
- `backend/webtest/history/History_Testing_Template_11152022.xlsx` — active checked-in history workbook
- `backend/webtest/results/*.json` — archived run snapshots

The subsystem has **no dedicated database tables, ORM models, or Alembic migrations**. All runtime persistence is file-backed.

## 3. Runtime placement in the suite

The backend blueprint is registered in `backend/app.py` at:

- `/api/webtest`

The frontend page is implemented as:

- `/webtest`

Because the frontend uses the shared path-prefix helpers, the effective public path in nginx-fronted deployments is typically:

- `/askfdalabel/webtest` for the page
- `/askfdalabel_api/api/webtest/*` at the proxy boundary, rewritten to `/api/webtest/*` at the Flask boundary

The tool is intentionally low-profile in the UI. The homepage links to it through a small “FDALabel Auto Test Tool” link beneath the main feature cards, which suggests the subsystem is meant for internal or specialist use rather than as a primary end-user workflow.

## 4. Architectural model

`webtest` is a **client-orchestrated, server-assisted** subsystem.

The runtime flow is:

1. the browser requests a list of available `.xlsx` templates,
2. the browser requests parsed task data for the selected template,
3. the browser iterates through tasks sequentially,
4. each task is sent to the backend as a single probe request,
5. the backend transforms the URL, performs the HTTP request, parses result count and timing, and appends history,
6. the browser updates the table in memory,
7. after the run, the browser asks the backend to save a JSON snapshot,
8. the browser may optionally ask the backend to generate an Excel export from the in-memory run data,
9. when a row is selected, the browser requests historical data and renders charts locally.

This design has several consequences:

- runs are **bound to the active browser session** rather than a background worker,
- total run duration is the sum of all probe calls because the client executes them one at a time,
- failure handling is lightweight and mostly per-row,
- history and result artifacts are stored as files rather than relational records,
- the backend does not own a persistent run model; it mainly acts as a translator, probe runner, and file formatter.

## 5. Template and artifact model

### 5.1 Template discovery

`GET /api/webtest/templates` lists all `.xlsx` files in `backend/webtest/`.

In the current repository snapshot, that means the UI can discover two templates:

- `Testing_Template_11152022.xlsx`
- `Testing_Template_11152022_public.xlsx`

Template discovery is directory-based rather than manifest-based. Any additional `.xlsx` file placed in `backend/webtest/` would be surfaced automatically.

### 5.2 Primary template structure

The main checked-in template currently has:

- **93 rows**,
- **18 non-empty category markers**,
- columns `Category`, `Query Details`, `Version`, `Query Link`, `Result Link`, `SPL Counts`, and `Notes`.

The public template currently has:

- **8 rows**,
- **2 non-empty category markers**,
- the same column structure.

A significant implementation detail is that the main template leaves `Query Details` blank on most rows. In the current snapshot, **75 of the 93 rows have no explicit `Query Details` value**. The backend compensates by carrying forward the last non-empty query description while constructing the task list. Grouped views and grouped history therefore depend on this fill-forward behavior rather than on fully normalized template data.

### 5.3 Which template fields are actually used

The current execution path relies mainly on:

- `Version`
- `Result Link`
- `Query Details` (with fill-forward behavior)

`Query Link` is present in the workbook but is not the URL actively probed by the backend. `SPL Counts` is also present, but the current code does **not** use it as an expected-value assertion baseline.

That means the tool currently records what the endpoint returns, but it does not automatically answer whether the returned count matches the template’s intended expectation.

### 5.4 History workbook model

The active history file for the main template is:

- `backend/webtest/history/History_Testing_Template_11152022.xlsx`

In the checked-in repository snapshot, that workbook contains:

- **7,852 rows**,
- dates spanning **2025-01-06** through **2026-03-30**,
- columns including `#Task`, `Server`, `Version`, `URL`, `Query Results`, `Result Time (Minimum 1s)`, `Query_Date`, `Query Details`, `Notes`, `Count`, `Delay`, and `Date`.

There is also a legacy workbook:

- `backend/webtest/history/Old_testing_report.xlsx`

The current code does not actively read `Old_testing_report.xlsx`; it is effectively archival.

### 5.5 Result snapshot model

Completed runs can be serialized to JSON in:

- `backend/webtest/results/`

The current repository snapshot contains **17** saved JSON snapshots. These files store:

- `template`
- `timestamp`
- `total_tasks`
- `results` (a list of row records in history-compatible shape)

The result filename convention retains the template’s `.xlsx` suffix, producing names like:

- `result_Testing_Template_11152022.xlsx_20260329_195453.json`

## 6. API surface and auth model

The current backend API is small and all routes live in `backend/webtest/blueprint.py`.

### 6.1 Read-oriented routes

These routes do not currently enforce authentication:

- `GET /api/webtest/templates` — list template filenames
- `GET /api/webtest/template_info?template_name=...` — parse a template into task rows and enrich it with previous count/time values from history
- `GET /api/webtest/task_history?...` — return history for one exact URL
- `GET /api/webtest/group_history?...` — return history for one exact query-details string

### 6.2 Execution and export routes

These routes require an authenticated session (`current_user.is_authenticated`):

- `POST /api/webtest/probe_single` — run one probe against one URL
- `POST /api/webtest/report_from_data` — convert supplied results into an Excel workbook download
- `POST /api/webtest/save_results` — serialize supplied results into a JSON snapshot

The frontend relies on the shared `UserContext` session model and opens the standard login modal when a run is started without an authenticated session.

## 7. Probe execution model

The core backend function is `probe_single`, but the actual orchestration happens in the browser.

### 7.1 Client-side orchestration

The run loop in `frontend/app/webtest/page.tsx` is sequential. For each task row, the browser posts:

- the row’s `url` (from `Result Link`)
- the row’s `version`
- the selected `template_name`

The page does **not** batch requests and does not run probes concurrently.

This design is simple, but it means:

- long templates keep the browser busy for the entire run,
- navigating away from the page effectively abandons the run,
- there is no queue, retry worker, or server-side scheduler.

### 7.2 URL translation

The backend does not probe the UI URL directly when it recognizes an FDALabel-style URL. `get_api_url()` rewrites the link to the corresponding service endpoint.

Current rewrite rules include:

- `/ui/spl-summaries/criteria/` → `/services/spl/.../summaries/json/criteria/`
- `/ui/spl-summaries/` → `/services/spl/.../summaries/json/`
- `/ui/search` → `/services/spl/search`
- `/ui/spl-doc/` → `/services/spl/set-ids/`

When the version label contains `CDER`, the code switches into the `/ldt/` service path variant.

This is one of the subsystem’s defining characteristics: although the page is labeled as a web auto-test tool, it is really probing **FDALabel service endpoints derived from UI links**.

### 7.3 Network behavior and parsing

The backend probe uses `requests.Session()` with:

- a browser-like `User-Agent`,
- a JSON-friendly `Accept` header,
- timeouts of `(5, 45)` for connect and read,
- `verify=False` for TLS verification,
- suppressed insecure-request warnings.

Successful responses are parsed in a permissive way:

- if the body is JSON, the code checks fields such as `totalResultsCount`, `total`, `count`, `totalResults`, or `recordCount`
- if JSON parsing fails, the code falls back to HTML text matching for phrases like `Labeling Results`
- if neither path yields a count, the row is marked `Format Error`

The backend returns one of several row statuses, including:

- `Success`
- `Format Error`
- `Not Found (404)`
- `HTTP <status>`
- `Inaccessible`

### 7.4 What “success” means today

In the current implementation, `Success` means:

- the endpoint was reachable, and
- a count-like value could be extracted.

It does **not** mean:

- the count matched the template baseline,
- the count matched yesterday’s count,
- the page rendered correctly in a browser,
- the underlying label set was semantically correct.

That distinction is important. The tool is currently strongest as an availability and response-shape monitor, not as a full regression validator.

## 8. Frontend behavior and operator workflow

The frontend page provides a compact operator console with these main capabilities:

- template selection and refresh,
- run status and progress display,
- start and stop controls,
- optional grouping of rows by logical task,
- version filtering,
- current-versus-previous count and latency comparison,
- click-through row selection for history inspection,
- chart-based history visualization,
- Excel export of the current in-memory run,
- auto-save of a JSON snapshot after completion.

### 8.1 Grouping model

Grouped mode is implemented entirely on the client by grouping rows with the same effective `query_details` string. This is a presentation-layer grouping rather than a backend data model. The grouped table also computes a “Matched” badge when all grouped versions returned the same count.

### 8.2 History visualization

When the user selects a row, the page requests either:

- exact URL history, or
- grouped query-details history

and renders a dual-axis Recharts visualization of:

- label count on the left axis,
- delay in seconds on the right axis.

Two hard-coded historical constants are currently embedded in the page logic:

- delay values are suppressed before **2025-06-01**,
- a chart break marker is inserted at **2026-03-01** and labeled as a technical shift.

Those constants may reflect real operational history, but they are currently part of UI logic rather than configuration or documentation metadata.

### 8.3 Partial-run semantics

During a resumed run, the current client logic skips rows unless their status is `pending` or `Inaccessible`. That means rows already marked `Error`, `Format Error`, or `Not Found (404)` are not retried automatically in the same in-memory session unless the template is reloaded.

## 9. Data semantics and persistence behavior

`webtest` is a rare subsystem in this repository because it is almost entirely **file-backed**.

### 9.1 What is persisted

The subsystem persists three kinds of artifacts:

1. **templates** — hand-authored Excel workbooks under `backend/webtest/`
2. **history** — appended Excel workbooks under `backend/webtest/history/`
3. **run snapshots** — JSON files under `backend/webtest/results/`

### 9.2 What is not persisted

The subsystem does not currently persist:

- runs in PostgreSQL,
- row-level assertions in normalized relational form,
- per-user saved configurations,
- scheduled test definitions,
- a durable queue or background-task state.

### 9.3 History enrichment in the UI

`template_info` reads the history workbook and attaches `prev_count` and `prev_time` to each task row based on exact URL matching. The page uses those fields to display “Prev” values beside the current run.

This is a useful operator convenience, but it is not a formal baseline system. It depends on:

- a history workbook existing with the expected naming convention,
- exact URL equality,
- a readable Excel file with parseable date fields.

For example, the checked-in public template does not have a matching `History_Testing_Template_11152022_public.xlsx`, so previous-value enrichment for that template will naturally be sparse or absent.

## 10. Observed repository-state facts

The checked-in repository gives a good sense of how the subsystem is currently being used.

### 10.1 Current template scope

The main template currently covers several version labels, including:

- `FDA`
- `CDER-CBER`
- `FDA (test)`
- `FDA (dev)`
- `CDER-CBER (test)`
- `CDER-CBER (dev)`
- `Public`

However, the checked-in active history workbook currently records only:

- `FDA`
- `CDER-CBER`
- `PUBLIC`

That suggests the historical archive is only partially aligned with the full current template matrix.

### 10.2 Snapshot consistency drift

The checked-in JSON snapshots are not perfectly uniform. Some saved result files contain full populated counts and delays, while others contain rows that remain entirely `N/A` or zero-valued. That is consistent with the current frontend implementation’s risk of saving stale in-memory results rather than the final fully updated row state.

### 10.3 No direct use of the old workbook archive

`Old_testing_report.xlsx` appears to be a historical data artifact rather than an active input to the current UI or API.

## 11. Limitations and cleanup candidates

The current subsystem is useful, but several concrete implementation issues should be recorded clearly.

### 11.1 It is not a true browser automation harness

This is the single most important conceptual clarification. The current tool validates transformed service URLs and parses counts. It does not verify rendered pages or user flows.

### 11.2 The expected-count field is not enforced

The template workbook contains `SPL Counts`, but the backend does not compare the observed count against that field. As a result, the tool does not produce a formal pass/fail verdict on regression against template expectations.

### 11.3 History write path corrected

The history write path fallback inside `record_history()` has been corrected to resolve relative to `backend/webtest/blueprint.py` (resolving to `backend/webtest/history/`), matching the read path. This ensures history reads and writes target the same directory in all deployment configurations.

### 11.4 Auto-save is vulnerable to stale-state capture

The frontend run loop updates row results with `setResults(...)`, then calls `/save_results` using the local `results` variable from the function scope. In React, that creates a risk that the auto-saved JSON reflects the pre-update or partially updated state rather than the final fully completed state.

The mixed quality of the checked-in JSON snapshots strongly suggests this risk is real in practice.

### 11.5 Range helper bug resolved

The latent bug where `get_cutoff_from_range()` mapped the `6m` option to a three-month offset instead of a six-month offset has been fixed to map to `6` months correctly.

### 11.6 TLS verification is disabled

Probes use `verify=False`, which is pragmatic for internal or legacy endpoints but weakens the trust model and can mask certificate issues.

### 11.7 Query grouping depends on fragile string equality

Grouped history uses exact `Query Details` string matching. Because the template uses fill-forward for missing query details, grouping depends on formatting consistency in the workbook rather than on normalized identifiers.

### 11.8 Template inventory is directory-driven

Any `.xlsx` in `backend/webtest/` becomes visible to the UI. That is simple, but it makes governance weak. There is no explicit manifest, metadata file, or template-status model.

### 11.9 The subsystem has no database-backed run model

This keeps the implementation simple, but it limits auditability, filtering, multi-user visibility, and future automation options.

## 12. Recommended direction for future improvement

A pragmatic next evolution of `webtest` would be to choose one of two directions and document it explicitly.

### 12.1 If the goal is operational probing

Then the subsystem should be formalized as a **service probe and trend monitor**:

- keep template-driven endpoint lists,
- store runs in a structured table,
- support scheduled execution,
- define baseline drift thresholds,
- clean up file-path handling,
- make history and reporting deterministic.

### 12.2 If the goal is true UI regression testing

Then the subsystem would need a different architecture:

- browser automation tooling,
- page assertions,
- screenshot capture,
- environment-aware credentials and fixtures,
- richer pass/fail semantics,
- artifact management beyond Excel and JSON snapshots.

At present, the codebase is much closer to the first model than the second.

## 13. Summary

The current `webtest` subsystem is a useful, specialized operational tool for FDALabel endpoint monitoring. It is small, understandable, and already provides tangible value through template-driven runs, latency measurement, history inspection, and operator-friendly exports. Its biggest strengths are simplicity and immediate practical utility.

Its main limitations are equally clear: it is not true browser automation, it does not enforce expected-result baselines, it stores state only in files, and it contains a few implementation drifts that can affect history fidelity and snapshot quality.

For documentation purposes, the correct mental model is:

> `webtest` is a file-backed FDALabel endpoint probe and historical reporting tool that happens to be presented through a web UI.

That framing matches the current code more accurately than “web application auto-testing” in the traditional QA sense.
