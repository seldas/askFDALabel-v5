# AskFDALabel Data Sources Report

## 1. Purpose and boundary

This document describes the **data-source layer** of AskFDALabel as it exists in the current codebase. Its purpose is to identify the systems, files, feeds, and derived artifacts that supply the application with label content, safety data, reference vocabularies, device records, and user-imported materials.

This report is intentionally **source-centric**, not feature-centric. It does not attempt to explain every application module in depth. Instead, it focuses on:

- what the sources are,
- how they are acquired,
- where they land locally,
- which database tables or artifacts they populate,
- which subsystems consume them,
- and where the current source pipeline has drift or quality gaps.

Companion documents:

- `Documents/Overview.md` for the suite-level technical overview
- `Documents/Architecture.md` for system topology and request flows
- `Documents/Backend.md` for service and blueprint boundaries
- `Documents/Database.md` for full table inventory and schema details
- `Documents/Operations.md` for environment setup, refresh procedures, and runtime guidance
- `Documents/AI-and-Search.md` for retrieval, embeddings, and AI orchestration

## 2. Executive summary

AskFDALabel uses a **hybrid source model**.

At the center of the system is a **locally materialized drug-label corpus** built from **DailyMed bulk SPL releases** and stored in PostgreSQL under the `labeling` schema. That local corpus powers local search, label comparison, semantic retrieval, and downstream derived artifacts such as `label_embeddings`.

Around that local corpus, the application relies on several **live external APIs**:

- **openFDA drug label** for label metadata fallback and public drug-label search,
- **openFDA drug event** for FAERS-style adverse-event analysis,
- **openFDA device endpoints** for 510(k), PMA, MAUDE, and recall/enforcement views,
- **DailyMed live SPL XML/media services** as the on-demand fallback for full label XML and image rendering.

The application also depends on several **manually refreshed reference datasets** staged under `data/downloads/`:

- **Orange Book** for RLD/RS status,
- **MedDRA MedAscii** for reaction normalization and hierarchy enrichment,
- the FDA **pharmacogenomic biomarker workbook** for PGx workflows,
- and the **DrugTox workbook** for toxicity-class review.

A secondary path exists for an **internal Oracle FDALabel database**, which can replace or augment public/openFDA lookup behavior when `LABEL_DB=ORACLE` is enabled. The environment variables for this connection have been unified and support both newer and legacy layouts transparently.

Finally, the suite accepts **user-supplied XML/ZIP/Excel inputs** and creates several **derived internal artifacts** such as semantic embeddings, snippet lexicons, AI assessment tables, and QA history files.

## 3. Source classes used by the suite

The current codebase uses five practical source classes.

### 3.1 Live external services

These are queried on demand and are not treated as the suite’s long-term system of record:

- DailyMed live SPL XML and image services
- openFDA drug label endpoint
- openFDA drug event endpoint
- openFDA device endpoints

### 3.2 Downloaded reference datasets

These are downloaded or manually staged under `data/downloads/` and then imported into PostgreSQL:

- DailyMed bulk SPL ZIP releases
- Orange Book `products.txt`
- MedDRA `MedAscii` distribution
- pharmacogenomic biomarker workbook
- DrugTox workbook

### 3.3 Optional internal enterprise source

This is the internal Oracle-backed FDALabel store used when the application is configured for enterprise/internal mode.

### 3.4 User-supplied operational inputs

These include uploaded SPL XML/ZIP files and imported FDALabel-style Excel files used for comparison, curation, and workflow acceleration.

### 3.5 Derived local artifacts

These are generated from primary sources and then used by specific modules:

- `label_embeddings`
- snippet lexicons / generated JavaScript trie assets
- AI assessment tables
- AE report tables
- webtest histories and JSON result snapshots

## 4. Source precedence model

The application does not use one universal source precedence rule. Instead, precedence depends on the data type being requested.

### 4.1 Label metadata search precedence

For label-search and label-metadata requests, the code prefers the following order:

1. `FDALabelDBService` against the configured label database
   - PostgreSQL `labeling` schema in the default local path
   - Oracle FDALabel in internal mode
2. `openFDA` drug label fallback
3. direct XML extraction fallback when metadata is incomplete

This means a healthy local PostgreSQL label corpus will usually prevent routine public openFDA lookups for label metadata.

### 4.2 Full label XML precedence

For complete SPL XML retrieval, the code prefers:

1. local ZIP-backed retrieval via `labeling.sum_spl.local_path` and `data/spl_storage/`
2. DailyMed live XML fallback at `https://dailymed.nlm.nih.gov/dailymed/services/v2/spls/{set_id}.xml`

### 4.3 Safety and device data precedence

For FAERS and device workflows, the application currently uses **live openFDA calls** rather than a local warehouse.

### 4.4 Reference-dictionary precedence

For MedDRA, PGx, DrugTox, and Orange Book, the suite expects imported local PostgreSQL tables after staged-file refresh.

## 5. Canonical source inventory

| Source family | Access pattern | Canonical location or endpoint | Primary landing zone | Primary consumers |
|---|---|---|---|---|
| DailyMed bulk SPL release archives | download + import | `https://dailymed-data.nlm.nih.gov/public-release-files/` | `data/downloads/dailymed/`, `data/spl_storage/`, `labeling.*` | local label retrieval, search, comparison, embeddings |
| DailyMed live SPL XML/media | live HTTP fallback | `https://dailymed.nlm.nih.gov/dailymed/services/v2/spls/{set_id}.xml` and image service URLs | in-memory response; optional upload copy | XML fallback, SPL rendering, media rendering |
| openFDA drug label | live HTTP | `https://api.fda.gov/drug/label.json` | transient responses; sometimes copied into favorites/import workflows | public label search, metadata fallback, counts, peer sampling |
| openFDA drug event | live HTTP | `https://api.fda.gov/drug/event.json` | transient responses; derived outputs may be persisted | FAERS counts, trends, emerging AEs, assessment helpers |
| openFDA device 510(k) | live HTTP | `https://api.fda.gov/device/510k.json` | transient responses | device search, applicant lookup, IFU retrieval |
| openFDA device PMA | live HTTP | `https://api.fda.gov/device/pma.json` | transient responses | device search, applicant lookup, IFU retrieval |
| openFDA device event (MAUDE) | live HTTP | `https://api.fda.gov/device/event.json` | transient responses | device safety/MAUDE summaries |
| openFDA device enforcement | live HTTP | `https://api.fda.gov/device/enforcement.json` | transient responses | device recall/enforcement summaries |
| Orange Book | staged file + import | `data/downloads/OrangeBook/EOB_Latest/products.txt` | `public.orange_book`, plus RLD/RS flags on label import | RLD/RS classification, peer sampling, DrugTox reference lookups |
| MedDRA MedAscii | staged file + import | `data/downloads/MedDRA/MedDRA_latest/MedAscii/` | `public.meddra_*` tables | FAERS enrichment, MedDRA scanning, deep-dive analytics |
| PGx biomarker workbook | staged file + import | `data/downloads/biomarker_db/Table of Pharmacogenomic Biomarkers in Drug Labeling  FDA.xlsx` | `public.pgx_biomarker`, `public.pgx_synonym` | PGx assessment workflow |
| DrugTox workbook | staged file + import | `data/downloads/ALT_update_latest.xlsx` | `public.drug_toxicity` | DrugTox module |
| Internal Oracle FDALabel | direct DB access | Oracle DSN via env | no local mirror required at runtime | internal label search/query/export paths |
| User-uploaded SPL XML/ZIP | ad hoc upload | `data/uploads/{set_id}.xml` | upload file storage | comparison and ad hoc label inspection |
| User-imported FDALabel Excel | ad hoc upload | `data/uploads/import_{uuid}.json` | temporary JSON cache | search/import-to-project workflows |
| Derived embeddings | generated from local labels | `label_embeddings` pipeline | `public.label_embeddings` | semantic search |
| Snippet lexicons and generated trie asset | checked-in text files + generator | `backend/search/scripts/drug_snippet/*` -> `frontend/public/snippets/drug-snippet/drug_snippet.js` | generated JS asset | snippet/highlighting tools |
| Webtest templates and histories | checked-in and generated operational files | `backend/webtest/*.xlsx`, `backend/webtest/history/`, `backend/webtest/results/` | filesystem only | QA / validation workflows |

## 6. Detailed source profiles

### 6.1 DailyMed bulk SPL releases

#### Role

This is the **primary source of the local label corpus**.

#### Acquisition path

- `scripts/labels/download_dailymed.py` downloads DailyMed public-release ZIP files into `data/downloads/dailymed/`.
- The downloader is hard-coded around DailyMed release naming patterns such as:
  - `dm_spl_release_human_rx_part1.zip` ... `part6.zip`
  - `dm_spl_release_human_otc_part1.zip` ... `part11.zip`
- `scripts/database/pg_import_labels.py` unpacks the bulk archives, extracts nested ZIP members, and stores them in `data/spl_storage/`.

#### Local storage and normalization

This pipeline materializes the corpus into the `labeling` schema:

- `labeling.sum_spl`
- `labeling.spl_sections`
- `labeling.active_ingredients_map`
- `labeling.processed_zips`

`labeling.spl_sections.search_vector` is a generated column created by schema initialization and is used for full-text matching.

The local ZIP filename is preserved in `labeling.sum_spl.local_path`, and that path is later used to reopen the original SPL ZIP when full XML is requested.

#### Extracted fields

The current importer extracts, among other fields:

- `spl_id`
- `set_id`
- product names
- generic names
- manufacturer
- approval number(s)
- active ingredients
- routes
- dosage forms
- NDC codes
- revised date
- initial approval year
- per-section LOINC code, title, and XML content
- RLD/RS flags derived during import from Orange Book application-number matching

#### Main consumers

- `backend/dashboard/services/fdalabel_db.py`
- `backend/localquery/blueprint.py`
- `backend/labelcomp/blueprint.py`
- `backend/search/scripts/semantic_core/*`
- `scripts/ai/sync_label_embeddings.py`
- export helpers that build DailyMed and hosted FDALabel links

#### Important caveats

1. The current PostgreSQL importer inserts **empty strings** for `market_categories` and `epc` in `labeling.sum_spl`. In practice, that means the local corpus is materially weaker than openFDA or Oracle for those fields.
2. The schema initializer creates `labeling.epc_map`, but the current import path does **not** populate it.
3. The importer stores section XML and local ZIP references, not a single canonical raw-XML blob per label inside PostgreSQL.
4. The importer appears to process the first XML file inside each nested ZIP, which is appropriate for normal SPL packages but still assumes package structure consistency.

### 6.2 DailyMed live SPL and media services

#### Role

DailyMed remains the **on-demand fallback source** for full XML and image/media resolution when the local corpus is unavailable or incomplete.

#### Endpoints used by the code

- SPL XML fallback: `https://dailymed.nlm.nih.gov/dailymed/services/v2/spls/{set_id}.xml`
- image resolution for inline rendering: `https://dailymed.nlm.nih.gov/dailymed/image.cfm?setid={set_id}&name={filename}`
- generated external links in exports and favorites:
  - DailyMed lookup page
  - DailyMed PDF page

#### Main consumers

- `backend/dashboard/services/fda_client.py::get_label_xml`
- `backend/dashboard/services/xml_handler.py` for image rendering
- export helpers in `fdalabel_db.py`

#### Important caveats

1. DailyMed live access is a fallback, not the main local-search backbone.
2. Network availability therefore matters whenever the local ZIP-backed corpus cannot satisfy full XML retrieval.
3. Exported DailyMed links are generated conventionally from `set_id`; they are not separately validated before emission.

### 6.3 openFDA drug label

#### Role

openFDA drug label is the public **metadata and search fallback** when the local label database is unavailable or when richer public metadata is needed.

#### Endpoint

- `https://api.fda.gov/drug/label.json`

#### Query patterns in the code

The code searches openFDA by:

- `spl_set_id`
- `unii`
- `product_ndc`
- `package_ndc`
- brand name
- generic name
- pharmacologic class EPC

#### Fields actively consumed

The code reads or derives values from fields including:

- `set_id`
- `effective_time`
- `openfda.brand_name`
- `openfda.generic_name`
- `openfda.manufacturer_name`
- `openfda.application_number`
- `openfda.product_type`
- `openfda.product_ndc`
- `openfda.package_ndc`
- `openfda.pharm_class_epc`
- `openfda.pharm_class_moa`
- section presence such as `warnings_and_cautions` or `description` to infer a coarse label-format classification

#### Main consumers

- `backend/dashboard/services/fda_client.py`
- `backend/dashboard/services/deep_dive_service.py`
- label search and metadata enrichment paths in dashboard routes

#### Important caveats

1. openFDA is not the preferred source when local PostgreSQL or Oracle label access is healthy.
2. openFDA is used to compensate for missing or weak local metadata, especially EPC/MOA.
3. The helper `get_rich_metadata_by_generic()` can borrow EPC/MOA from another label sharing the same generic name, which is useful but should be understood as **enrichment by generic-match inference**, not necessarily label-specific truth.

### 6.4 openFDA drug event (FAERS-style adverse-event data)

#### Role

This is the live source for the suite’s **FAERS-oriented safety analysis**.

#### Endpoint

- `https://api.fda.gov/drug/event.json`

#### Uses in the code

The application uses the endpoint for:

- top reaction counts by drug
- trend queries over time
- emerging-event analysis comparing recent versus older periods
- assessment helper queries for DILI, DICT, and DIRI review
- AE profile and AI rematch workflows

#### Local persistence model

The raw openFDA event responses are generally **not warehoused** as a long-term fact table. Instead, the suite stores downstream results in derived tables such as:

- `project_ae_report`
- `project_ae_report_detail`
- `ae_ai_assessment`

#### Main consumers

- `backend/dashboard/services/fda_client.py`
- multiple FAERS routes in `backend/dashboard/routes/api.py`

#### Important caveats

1. This is a live API dependency; results are time-sensitive and can shift as the upstream dataset changes.
2. MedDRA enrichment happens locally after retrieval; openFDA itself is not the hierarchy source.
3. There is no evidence in the current codebase of a full local FAERS warehouse.

### 6.5 openFDA device datasets

#### Role

These endpoints supply the **device** module with discovery, IFU, MAUDE, and recall/enforcement data.

#### Endpoints used by the code

- `https://api.fda.gov/device/510k.json`
- `https://api.fda.gov/device/pma.json`
- `https://api.fda.gov/device/event.json`
- `https://api.fda.gov/device/enforcement.json`

#### Functional use

- 510(k) and PMA endpoints support device search, applicant lookup, and IFU/statement-of-indications retrieval.
- The device event endpoint is used for MAUDE-style aggregation and trend analysis.
- The device enforcement endpoint is used for recall/enforcement counts and recent recall listings.

#### Main consumers

- `backend/device/services/device_client.py`
- `backend/device/services/maude_analyzer.py`
- `backend/device/services/recall_analyzer.py`

#### Important caveats

1. Device data is live-only in the current architecture; the suite does not build a local device warehouse.
2. `get_device_metadata()` is currently a stub returning `None`, so metadata retrieval is not yet a fully implemented source path.
3. The actual recall source in code is `device/enforcement.json`, not a separate locally stored recall table.

### 6.6 Orange Book

#### Role

Orange Book is the suite’s **reference source for RLD and RS classification**.

#### Expected staged file

- `data/downloads/OrangeBook/EOB_Latest/products.txt`

#### Import and use patterns

- `scripts/database/import_orange_book.py` imports the file into `public.orange_book`.
- `scripts/database/pg_import_labels.py` also reads the same file directly during label import in order to stamp `is_rld` and `is_rs` onto `labeling.sum_spl` rows.
- `backend/admin/tasks/import_labels.py` repeats the same pattern in the admin task flow.

#### Main consumers

- `labeling.sum_spl.is_rld`
- `labeling.sum_spl.is_rs`
- `public.orange_book`
- `backend/dashboard/services/deep_dive_service.py`
- `backend/drugtox/blueprint.py`
- search and export paths that prioritize or display RLD/RS labels

#### Important caveats

1. Refreshing `public.orange_book` alone does **not** automatically re-stamp already imported label rows in `labeling.sum_spl`.
2. RLD/RS status is computed during label-import workflows, so keeping Orange Book and label imports synchronized matters.
3. Deep-dive logic may query Orange Book directly, while many other paths rely on the cached `is_rld` / `is_rs` values in the local label corpus.

### 6.7 MedDRA MedAscii distribution

#### Role

MedDRA provides the suite’s **clinical terminology and hierarchy layer** for adverse-event normalization, grouping, and enrichment.

#### Expected staged directory

- `data/downloads/MedDRA/MedDRA_latest/MedAscii/`

#### Imported tables

The import script loads eight MedDRA tables:

- `meddra_soc`
- `meddra_hlgt`
- `meddra_hlt`
- `meddra_pt`
- `meddra_llt`
- `meddra_mdhier`
- `meddra_smq_list`
- `meddra_smq_content`

#### Main consumers

- `backend/dashboard/services/meddra_matcher.py`
- `backend/dashboard/services/deep_dive_service.py`
- FAERS enrichment flows in `backend/dashboard/routes/api.py`
- AE profile and event-label comparison logic

#### Important caveats

1. The application is designed to run even when MedDRA is absent, but safety-detail outputs degrade noticeably.
2. This is a manually staged import; the repository does not include a full MedDRA distribution.
3. The backend startup warning for missing MedDRA data confirms that the system treats this source as optional for boot, but important for meaningful safety analysis.

### 6.8 FDA pharmacogenomic biomarker workbook

#### Role

This workbook is the primary structured source for the suite’s **PGx reference database**.

#### Expected staged file

- `data/downloads/biomarker_db/Table of Pharmacogenomic Biomarkers in Drug Labeling  FDA.xlsx`

The filename in code includes a **double space before `FDA.xlsx`** and should be treated as exact unless the import script is updated.

#### Imported tables

- `pgx_biomarker`
- `pgx_synonym`

#### Derived outputs

- `pgx_assessment`

#### Main consumers

- `backend/dashboard/services/pgx_handler.py`
- PGx assessment route in `backend/dashboard/routes/api.py`

#### Important caveats

1. This is an imported workbook, not a live API integration.
2. Search quality depends heavily on synonym parsing and normalization during import.
3. The suite compares label text against the PGx tables rather than treating the workbook itself as a runtime query source.

### 6.9 DrugTox workbook

#### Role

This workbook is the structured source for the **DrugTox review dataset** used by the DrugTox module.

#### Expected staged file

- `data/downloads/ALT_update_latest.xlsx`

#### Imported table

- `drug_toxicity`

#### Import behavior

The importer derives `is_historical` by sorting rows by trade name, author organization, toxicity type, and SPL effective time, then treating older records within the same grouping as historical.

#### Main consumers

- `backend/drugtox/blueprint.py`

#### Important caveats

1. This is a staged workbook import, not a live feed.
2. Historical/current classification is generated during import and depends on workbook content and sort assumptions.
3. The DrugTox module cross-references the local or Oracle label store to find RLD/RS anchors and label IDs, so DrugTox is not operationally independent of label sources.

### 6.10 Internal Oracle FDALabel database

#### Role

Oracle mode is the suite’s optional **enterprise/internal high-fidelity label source**.

#### Runtime activation

This path is used when `LABEL_DB=ORACLE` and the Oracle client library is available.

#### Objects referenced by the code

The current code expects objects such as:

- `druglabel.DGV_SUM_SPL`
- `druglabel.SPL_SEC`
- `druglabel.sum_spl_rld`
- `druglabel.active_ingredients_map`

#### Main consumers

- `backend/dashboard/services/fdalabel_db.py`
- `backend/localquery/blueprint.py`
- internal-mode search/export paths
- some legacy or helper scripts that still expect Oracle credentials

#### Important caveats

1. Oracle mode is currently affected by environment-variable naming drift.
2. `backend/dashboard/config.py` defines `FDALabel_PASSWORD`, while `backend/dashboard/services/fdalabel_db.py` reads `FDALabel_PSW`.
3. Some helper scripts still use older variable families such as `FDALabel_SERV` and `FDALabel_APP`.
4. Oracle should therefore be treated as a supported but drift-prone mode until variable naming is normalized.

### 6.11 User-supplied uploads and imported spreadsheets

#### SPL XML and ZIP uploads

Users can upload SPL XML or ZIP files, which are parsed for metadata and saved as:

- `data/uploads/{set_id}.xml`

These uploads support ad hoc comparison and workflow augmentation but do not automatically become part of the persistent `labeling` schema.

#### FDALabel-style Excel imports

Users can upload an Excel workbook with FDALabel-like columns. The backend maps the sheet into a temporary JSON cache:

- `data/uploads/import_{uuid}.json`

This temporary import is then used by search and “add to project” flows.

#### Important caveats

1. These are workflow inputs, not authoritative system reference data.
2. The imported Excel path depends on column-name heuristics rather than one rigid canonical format.
3. Uploaded and imported files can enrich comparisons and favorites without materially updating the core label corpus.

### 6.12 Derived internal artifacts and operational datasets

#### Label embeddings

The semantic-search pipeline uses `public.label_embeddings`, generated from `labeling.spl_sections` through:

- `scripts/ai/sync_label_embeddings.py`
- `scripts/database/pg_export_embeddings.py`
- `scripts/database/pg_import_embeddings_v2.py`

This is a derived artifact, not a primary source.

#### Snippet lexicons

The search/snippet utility uses checked-in lexicon files such as:

- `backend/search/scripts/drug_snippet/rld_drug_name.txt`
- `backend/search/scripts/drug_snippet/distinct_drug_name.txt`

These are transformed into a browser-consumable trie asset. Two paths are visible in the current codebase:

- the checked-in public asset location: `frontend/public/snippets/drug-snippet/drug_snippet.js`
- the generator output target in `trie_gen.py`: `frontend/public/drug-snippet/drug_snippet.js`

That mismatch should be treated as an implementation drift issue rather than one canonical settled path. This is a source-adjacent utility dataset rather than a primary regulatory data source.

#### Webtest assets

The webtest subsystem uses:

- template workbooks in `backend/webtest/*.xlsx`
- saved history workbooks in `backend/webtest/history/`
- result JSON snapshots in `backend/webtest/results/`

These are operational QA artifacts used to probe hosted FDALabel environments and service URLs.

## 7. Source-to-storage lineage

| Source | Stage location | Persistent storage | Notes |
|---|---|---|---|
| DailyMed bulk ZIPs | `data/downloads/dailymed/` | extracted ZIPs in `data/spl_storage/`; metadata and sections in `labeling.*` | primary local label corpus |
| DailyMed live XML | none | none unless manually saved/uploaded | fallback only |
| openFDA drug label | none | none directly | used live; may enrich favorites or reports |
| openFDA drug event | none | derived outputs only | AE reports and AI assessments persist downstream results |
| openFDA device endpoints | none | none | live-only device workflows |
| Orange Book `products.txt` | `data/downloads/OrangeBook/EOB_Latest/` | `public.orange_book`; RLD/RS flags in `labeling.sum_spl` on import | dual use: table + import-time classifier |
| MedDRA `MedAscii` | `data/downloads/MedDRA/MedDRA_latest/MedAscii/` | `public.meddra_*` | hierarchy dictionary |
| PGx workbook | `data/downloads/biomarker_db/` | `public.pgx_biomarker`, `public.pgx_synonym` | label-text PGx reference set |
| DrugTox workbook | `data/downloads/` | `public.drug_toxicity` | toxicity-review dataset |
| Oracle FDALabel | external DB | no local replication required | runtime alternate source |
| Uploaded SPL files | `data/uploads/` | filesystem only | ad hoc comparison/input |
| Imported Excel label caches | `data/uploads/import_*.json` | filesystem only | temporary workflow input |
| Embedding export/import | `data/embeddings_export.json.gz` | `public.label_embeddings` | derived semantic index |
| Webtest histories/results | `backend/webtest/history/`, `backend/webtest/results/` | filesystem only | QA/validation artifacts |

## 8. Refresh and stewardship model

### 8.1 Sources refreshed by script-driven import

These sources require explicit staging and refresh:

- DailyMed bulk SPL releases
- Orange Book
- MedDRA
- PGx workbook
- DrugTox workbook
- embeddings

### 8.2 Sources consumed live

These sources are not normally imported into a durable warehouse in the current architecture:

- DailyMed live XML/media services
- openFDA drug label
- openFDA drug event
- openFDA device endpoints

### 8.3 Sources owned outside the repo

These sources are external to the repository and are only accessed at runtime:

- internal Oracle FDALabel
- hosted FDALabel web/service endpoints used by the webtest subsystem

### 8.4 User-owned ad hoc inputs

These are provided on demand by users:

- uploaded SPL XML/ZIP files
- FDALabel-style Excel files

## 9. Current source drift and data-quality issues

The following issues are visible directly in the current codebase and matter for future documentation and maintenance.

### 9.1 Local DailyMed import does not fully populate metadata richness

The PostgreSQL label importer currently sets `market_categories` and `epc` to empty strings in `labeling.sum_spl`. As a result, the local label corpus is strong for structural SPL content and section search, but weaker for market/EPC-driven metadata workflows than openFDA or Oracle.

### 9.2 `labeling.epc_map` exists but is not actively populated

The labeling schema initializer creates `labeling.epc_map`, but the import pipeline does not populate it. This makes the table structurally present but not operationally authoritative.

### 9.3 Orange Book refresh and label refresh are not the same operation

Importing `public.orange_book` does not by itself recompute `is_rld` and `is_rs` on previously imported labels. Those flags are assigned during the label-import pipeline. Operationally, Orange Book refresh and label-corpus refresh must therefore be coordinated.

### 9.4 `scripts/README.md` is itself outdated for label import source paths

The checked-in `scripts/README.md` still describes `pg_import_labels.py` as syncing from `data/uploads/`, but the actual code path is the DailyMed bulk-download staging directory plus `data/spl_storage/` extraction. Documentation should follow the code, not that legacy note.

### 9.5 Oracle environment variables unified

The Oracle/internal database bridge has been updated to unify the host, database name, and credential variables. It now supports both older and newer keys dynamically:
- Host: `FDALabel_HOST` or `FDALabel_SERV`
- Service/App: `FDALabel_SERVICE` or `FDALabel_APP`
- Password: `FDALabel_PASSWORD` or `FDALabel_PSW`

This ensures full backward-compatibility and robust configuration across different deployments.

### 9.6 Device metadata coverage is incomplete

The device module has live search, IFU, MAUDE, and enforcement sourcing, but `get_device_metadata()` is not yet implemented. The device-source story is therefore partially complete rather than fully rounded.

### 9.7 Live safety and device sources are not warehoused

FAERS and device results are computed from live openFDA responses rather than a stable local mirror. This keeps the implementation light, but it means reproducibility depends on request time and upstream availability.

### 9.8 Snippet-lexicon generation still shows source-layer drift

The snippet trie generator includes a database fallback that expects older Oracle-style environment variables even though the repository also includes checked-in text lexicons. In addition, the generator writes to `frontend/public/drug-snippet/` while the checked-in public asset currently lives under `frontend/public/snippets/drug-snippet/`. That is a visible source-layer drift in a support utility.

## 10. Recommended next documentation steps

This report should be treated as the source-reference baseline for later, deeper documents.

Recommended follow-on documents or expansions:

1. a dedicated **Label Corpus and Ingestion** report covering DailyMed, local PostgreSQL labeling, embeddings, and refresh semantics;
2. a dedicated **Safety Data** report covering openFDA drug events, MedDRA, AE reports, and assessment outputs;
3. a dedicated **Device Data** report covering openFDA device endpoints and current functional gaps;
4. a dedicated **Reference Dataset Maintenance** report covering Orange Book, MedDRA, PGx, and DrugTox refresh procedures.

## 11. Bottom line

The current AskFDALabel source architecture is built around one strong local core and several strategic auxiliary feeds:

- **DailyMed bulk SPL** is the core local corpus,
- **openFDA** is the main live public API layer,
- **Orange Book / MedDRA / PGx / DrugTox** are staged reference imports,
- **Oracle FDALabel** is an optional enterprise path,
- and **user uploads plus derived artifacts** fill workflow-specific gaps.

The most important documentation truth to preserve is that the suite is **not** driven by a single monolithic source. It is a layered system in which local materialized label content, live public APIs, staged regulatory reference files, and ad hoc user inputs all coexist, with clear but currently imperfect precedence and refresh boundaries.
