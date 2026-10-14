# Label Query Builder and Local Query Workspace

Reviewed against commit `b363224` on 2026-10-14.

## Routes and architecture

The current structured query builder is the authenticated home page (`/`), with results at `/labelquery` and APIs under `/api/labelquery`. The separate `/localquery` workspace uses `/api/localquery` for local name/identifier lookup; it is not the criteria compiler described below.

The frontend criteria model is in `frontend/app/querybuilder/types.ts`. `backend/labelquery/compiler.py` compiles PostgreSQL criteria; `oracle_compiler.py` handles Oracle. `blueprint.py` handles vocabulary lookup, AI translation, entity expansion, execution, facets, and exports. The application's reviewer handbook is `/wiki`, sourced from `frontend/app/wiki/wikiData.tsx`.

## Criteria and database scope

There are 13 criterion types in the current catalog, with availability determined by the database:

| Type | Purpose |
|---|---|
| `labelingType` | Document type and PLR format |
| `applicationType` | Marketing categories and RLD selection |
| `productName` | Product identifiers and name operators |
| `fullText` | Labeling full-text search (Oracle) |
| `labelingSection` | Text within selected sections |
| `marketStatus` | Market status and dates |
| `meddra` | PT/LLT clinical term criteria (Oracle label search) |
| `route` | Routes of administration |
| `dosageForm` | Dosage forms |
| `deaSchedule` | DEA schedule (Oracle) |
| `activeMoiety` | Active moiety |
| `pharmClass` | EPC, MoA, PE, or chemical structure class |
| `identifier` | Regulatory identifiers |

Chemical structure class is a pharmacologic-class category; the criteria catalog does not implement a SMILES substructure/similarity engine.

Criteria within one group use AND; groups use OR. Values in a categorical list are alternatives. Two required ingredients must be represented as two product-name criteria in the same group.

| Target | Scope and constraints |
|---|---|
| `local` | PostgreSQL metadata; no full-text, MedDRA label search, or DEA schedule. Section criteria support Product Title (`SPLTITLE`) and Initial U.S. Approval (`43683-2`) only. |
| `oracle` | CDER-CBER human-labeling subset (`DGV_SUM_RX_SPL`). |
| `oracle_all` | FDA version using broader Oracle `SUM_SPL`, including animal labeling. |

`_resolve_target_db()` enforces the `db_selection` feature per request. Accounts without it use CDER-CBER when reachable, otherwise local. Switching scope on the builder confirms and clears configured criteria. Code restoration rejects incompatible account scopes or unavailable Oracle targets.

## AI criteria and Quick search

By default, AI Query Builder translates input to editable criteria for review. Translation notes explain entity mapping and unavailable conditions. Checked categorical prefilter chips are merged into the criteria when searching.

Quick search is opt-in and changes the action to Search. A successful translation immediately searches using the returned criteria and selected prefilters. The frontend passes those fresh values to `runSearch()` rather than waiting for React state updates. Quick search also applies to query-code restoration and valid external AI imports; an external response with a nonempty `unsupported` list restores criteria without immediate execution.

The translation timer is an elapsed-time indicator. Its staged messages are not backend progress events or proof of successful terminology resolution.

## Entity expansion and matching

Resolved drug-name candidates share the matched label's complete active-ingredient UNII set. The default expanded selection is capped at 20 names. The candidate manager supports search, pagination, category counts (generic/brand/ingredient), and individual selection/removal. Exact match retains recognized input names without related-name expansion and can preserve the prior expanded selection when toggled back.

Ordinary AI drug-name requests can attempt entity resolution even if translated to contains. Explicit partial/prefix requests and fixed-dose combination requests preserve flexible ingredient conditions; unresolved names fall back to their original operator.

Drug-name and MedDRA autocomplete ignore case and treat ASCII hyphens and spaces as interchangeable. Flexible product-name searches use the same separator rule on PostgreSQL and Oracle. `Dry Clox` can match `Dry-Clox`; `dryclox` does not match either separated spelling. Exact product-name criteria and Exact match vocabulary resolution retain literal separators.

MedDRA supports PT and LLT criteria. PT selections resolve downward to LLTs. An individual LLT expands only to the original plus three lowest-code sibling LLTs, with its parent PT retained as display metadata; Exact match keeps the original LLT. Vocabulary resolution uses local MedDRA tables even when the label search runs against Oracle.

## Portable query codes

Results > export menu > Copy Query Code produces `FDALABEL-Q1:` followed by gzip-compressed UTF-8 JSON encoded as base64url. The payload is `{ query, targetDb }`. The active query includes applied filters and Exact match; result rows, sorting, pagination, and credentials are not stored.

`QueryCodeDialog.tsx` shows confirmation and the full code, with Copy again and manual selection if clipboard access fails. Paste it into AI Query Builder to restore criteria without calling the translation AI. Quick search controls whether to execute immediately.

A code is not encrypted and does not grant database access. It preserves search conditions, not immutable results. Browser CompressionStream/DecompressionStream support is required. Search execution still encodes the restored query in a results URL, with an 8,000-character encoded-query ceiling; compression does not remove that execution limit.

## External AI protocol V1

Download External AI Instructions captures the selected database, Exact match, criterion templates, enum choices, Boolean rules, and currently loaded dropdown vocabulary. Give that file and a search request to an external chat tool, then paste its complete response into AI Query Builder.

The response must contain one JSON object between `BEGIN FDALABEL QUERY V1` and `END FDALABEL QUERY V1`, with `version: 1`, `targetDb`, `query`, `notes`, and `unsupported`. The parser validates group contents, criterion types, field types, enum choices, nonempty conditions, and local restrictions. Product names and MedDRA terms are marked unverified for confirmation in the existing cards.

Imported text is parsed as query data, never executed as code. Importing does not call the application's translation AI. External tools cannot confirm terms against the application's live database, and unsupported conditions must be reviewed rather than assumed satisfied.

## Results and filters

Results and facet counts load independently. Facets describe the underlying query with sidebar filters removed, so counts remain stable during filter changes. Sidebar filters apply across all OR groups. The header reports filtered versus underlying totals. Back to search carries the current query for editing; Copy Query Code preserves the active conditions and scope.

## Recent change references

- `586d2ec`, `52ec5cc`, `7b8060c`: exact entity expansion and local MedDRA resolution/hierarchy repair.
- `ceafcf2`, `7c072f3`, `ff4ad75`: candidate management, bounded default selection, and name categories.
- `09fea5b`, `31ea7b9`: translated drug-name expansion and hyphen/space matching.
- `4b9b26e`: Quick search and portable query codes.
- `e1bfbd2`: copy confirmation dialog and external AI protocol.
- `6b81aec`, `ff9f569`: tooltip positioning and aligned Quick search/external instruction presentation.

## Review follow-ups

This review inspected source and commit history; it did not exercise live PostgreSQL/Oracle queries or AI providers.

1. `decodeQueryCode()` validates the envelope, criterion names, and object-shaped values, but is less strict than the external protocol parser: it does not validate every field, enum, Exact match type, or nonempty group. Consider a shared validator for imported data. Do not describe query codes as fully schema-validated.
2. `ResultsPage` clears options loading after successful requests or thrown exceptions, but not after an HTTP error response. An unsuccessful options request can leave the sidebar in a loading state. This is a source-level finding, not a reproduced runtime failure.
3. Exercise Quick search on/off, clipboard failure, incompatible scope, external unsupported conditions, entity-selection restoration, and oversized queries against a running deployment before claiming end-to-end verification.
