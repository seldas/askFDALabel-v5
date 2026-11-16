# Oracle FDALabel Database Reference

**Last verified:** 2025-01 against `FDALABEL_TST_HOST` (`ncsvmlbldbtst2.fda.gov`)  
**Schema owner / connection user:** `druglabel`  
**Database SID:** `lbltst2` (TST) — connect with `SID`, not `SERVICE_NAME`

---

## 1. Overview

In FDA internal environments, AskFDALabel connects directly to the authoritative Oracle FDALabel
database owned by the `druglabel` schema. This document is the definitive schema dictionary and
query-mapping reference for the TST instance and applies to the DEV instance by analogy.

---

## 2. Connection Details
hided
---

## 3. Schema Object Inventory

As of verification, the `druglabel` user owns the following objects (excluding Oracle internal
`SYS*` path tables and `DR$*` Oracle Text index support tables):

| Category | Count |
|---|---|
| Core data tables | ~50 |
| DGV_ denormalized tables | ~25 |
| Views | ~19 |
| Reference / lookup tables | ~10 |
| Load / admin tables | ~8 |
| Archived label tables | ~5 |

External schemas referenced by views: **`meddra`** (MedDRA terms and hierarchy — not owned by
`druglabel`, must be accessible via grants).

---

## 4. Table & View Reference

### 4.1 Core Label Summary — `SUM_SPL` / `DGV_SUM_SPL`

The central label metadata table. `SUM_SPL` is the base table; `DGV_SUM_SPL` is a denormalized
copy (identical column layout, slightly different types) that the web application queries.
Both have **160,988 rows** on TST.

| Column | Type | Notes |
|---|---|---|
| `SPL_ID` | NUMBER (PK in SUM_SPL) | Internal sequence; join key across all child tables |
| `SPL_GUID` | VARCHAR2(200) | Document version GUID — matches `spl_id` in PostgreSQL `labeling.sum_spl` |
| `SET_ID` | VARCHAR2(200) | Persistent product identifier across all versions |
| `TITLE` | VARCHAR2(500) | Label document title |
| `DOCUMENT_TYPE_LOINC_CODE` | VARCHAR2(10) | LOINC code (see `DOCUMENT_TYPE` table) |
| `DOCUMENT_TYPE` | VARCHAR2(200) | Denormalized document type name |
| `AUTHOR_ORG_NORMD_NAME` | VARCHAR2(200) | Normalized manufacturer name |
| `EFF_TIME` | VARCHAR2(20) | Effective date `YYYYMMDD` |
| `VERSION_NUM` | NUMBER | Version sequence number |
| `ARCHIVE_DIR` | VARCHAR2(2000) | Relative archive directory path |
| `ARCHIVE_DIR_DATE` | VARCHAR2(8/32) | Date subdirectory component |
| `FILENAME` | VARCHAR2(2000) | SPL XML file name within archive |
| `ORG_CURRENCY_RANK` | NUMBER | Currency rank (lower = more current for org) |
| `INITIAL_APPROVAL_YEAR` | VARCHAR2(4) | Year of first FDA approval |
| `REVISED_DATE` | VARCHAR2(30) | Most recent revision date |
| `NUM_PRODUCTS` | NUMBER | Total product count in label |
| `NUM_GENERIC_PRODUCTS` | NUMBER | Generic product count |
| `PRODUCT_NAMES` | VARCHAR2(4000) | Pipe-delimited trade product names |
| `PRODUCT_NORMD_GENERIC_NAMES` | VARCHAR2(4000) | Pipe-delimited normalized generic names |
| `PRODUCT_TITLE` | VARCHAR2(4000) | Full product title string |
| `MARKET_CATEGORIES` | VARCHAR2(4000) | Pipe-delimited marketing categories |
| `MARKETING_ACTS` | VARCHAR2(4000) | Pipe-delimited marketing actions |
| `ROUTES_OF_ADMINISTRATION` | VARCHAR2(4000) | Pipe-delimited routes |
| `NDC_CODES` | VARCHAR2(4000) | Pipe-delimited NDC codes |
| `NDC3_CODES` | VARCHAR2(4000) | 3-segment NDC codes |
| `DOSAGE_FORMS` | VARCHAR2(4000) | Pipe-delimited dosage forms |
| `NUM_ACT_INGRS` | NUMBER | Active ingredient count |
| `ACT_INGR_UNIIS` | VARCHAR2(4000) | Pipe-delimited active ingredient UNIIs |
| `ACT_INGR_NAMES` | VARCHAR2(4000) | Pipe-delimited active ingredient names |
| `ACT_MOIETY_UNIIS` | VARCHAR2(4000) | Active moiety UNIIs (SUM_SPL only) |
| `ACT_MOIETY_NAMES` | VARCHAR2(4000) | Active moiety names (SUM_SPL only) |
| `EPC` | VARCHAR2(2000) | Established Pharmacologic Class string |
| `APPR_NUM` | VARCHAR2(1000) | Application number (NDA/ANDA/BLA) |
| `RLD_NUM` | VARCHAR2(1000) | Reference Listed Drug application number |
| `MEDDRA_SUPPORTED` | VARCHAR2(4) | 'YES'/'NO' — MedDRA coding available (SUM_SPL only) |
| `DAILYMED_NDC_LINKS` | VARCHAR2(4000) | DailyMed NDC link URLs |
| `SPL_MD5` | VARCHAR2(32) | MD5 of SPL XML for change detection |

**`DGV_SUM_RX_SPL`** (155,215 rows): Like `DGV_SUM_SPL` but restricted to Rx/PLR labels; adds
a `FORMAT_GROUP` column (1 = PLR, 2 = non-PLR).

**`SPL_SUMMARY`** view: Subset of `SUM_SPL` columns (spl_id, guid, title, document_type,
author, product names, market categories, marketing acts, routes, ndc_codes, act_ingr_uniis,
dosage_forms, eff_time, version_num, org_currency_rank).

---

### 4.2 Raw SPL XML — `SPL`

Stores the full raw SPL XML for each label version. **160,988 rows**.

| Column | Type | Notes |
|---|---|---|
| `ID` | NUMBER (PK) | Corresponds to `SUM_SPL.SPL_ID` |
| `SPL_XML` | XMLTYPE | Full SPL XML document |
| `GUID` | VARCHAR2(200) | Document GUID (= `SPL_GUID` in summary) |
| `SET_ID` | VARCHAR2(200) | Product set identifier |
| `ARCHIVE_DIR` | VARCHAR2(2000) | Archive path |
| `FILENAME` | VARCHAR2(2000) | Filename within archive |
| `EFF_TIME` | VARCHAR2(20) | Effective date `YYYYMMDD` |
| `VERSION_NUM` | NUMBER | Version number |
| `DOC_TYPE_LOINC_CODE` | VARCHAR2(10) | LOINC document type code |
| `DOC_TYPE_NAME_FROM_MFR` | VARCHAR2(100) | Manufacturer-provided document type name |
| `AUTHOR_ORG` | VARCHAR2(500) | Raw author organization |
| `NORMD_ORG` | VARCHAR2(200) | Normalized organization name |
| `TITLE` | VARCHAR2(500) | Document title |
| `SPL_MD5` | VARCHAR2(32) | MD5 hash |
| `LOADED_TS` | TIMESTAMP(6) | Load timestamp |
| `CREATED_LOAD_NUM` | NUMBER | FK → `LOAD.LOAD_NUM` |

---

### 4.3 SPL Sections — `SPL_SEC`

Parsed section content. **3,641,258 rows** (avg ~23 sections per label).

| Column | Type | Notes |
|---|---|---|
| `ID` | NUMBER (PK) | |
| `SPL_ID` | NUMBER | FK → `SPL.ID` / `SUM_SPL.SPL_ID` |
| `LOINC_CODE` | VARCHAR2(20) | Section type (see `SECTION_TYPE` table) |
| `CONTENT_XML` | XMLTYPE | Section XML content; full-text indexed as `CTXIX_SPLSEC_CONTENTXML` |
| `GUID` | VARCHAR2(36) | Section GUID — referenced by `SPL_SEC_MEDDRA_LLT_OCC.SEC_GUID` |
| `TITLE` | VARCHAR2(4000) | Section display title |
| `PARENT_SEC_GUID` | VARCHAR2(36) | Parent section GUID (hierarchical sections) |

**`SPL_SEC_HIGHLIGHT`** (212,777 rows): Highlights section only (`SPL_ID`, `LOINC_CODE`,
`HIGHLIGHT_CONTENT_XML` XMLTYPE). Full-text indexed as `CTXIX_SPLSECHLT_XML`.

**`DGV_SPL_SEC_HIGHLIGHTS`**: Table version of highlights with `HIGHLIGHT_TEXT` VARCHAR2(4000)
(truncated plain text) alongside `HIGHLIGHT_CONTENT` XMLTYPE.

---

### 4.4 MedDRA Term Occurrences — `SPL_SEC_MEDDRA_LLT_OCC`

Pre-computed MedDRA LLT term occurrences within SPL sections. **29,747,378 rows**.

| Column | Type | Notes |
|---|---|---|
| `SET_ID` | VARCHAR2(36) NOT NULL | Product set identifier |
| `SEC_TYPE_CODE` | VARCHAR2(7) NOT NULL | LOINC section type code |
| `SEC_GUID` | VARCHAR2(36) NOT NULL | FK → `SPL_SEC.GUID` |
| `LLT_CODE` | NUMBER NOT NULL | MedDRA LLT code (FK → `meddra.low_level_term`) |
| `START_IX` | NUMBER NOT NULL | Character start position in section text |
| `END_IX` | NUMBER NOT NULL | Character end position |

**`MEDDRA_LLT_HIER_SPL_CODED_SEC`** view (39,286,020 rows): Joins `SPL_SEC_MEDDRA_LLT_OCC`
with `meddra.low_level_term` and `meddra.meddra_hierarchy` to expose the full MedDRA hierarchy
(LLT → PT → HLT → HLGT → SOC) alongside section metadata. This is the primary view for
MedDRA-based queries.

```sql
-- Columns in MEDDRA_LLT_HIER_SPL_CODED_SEC:
-- set_id, section (loinc_name), llt, start_ix, end_ix, llt_code,
-- is_llt_current, section_code, sec_guid,
-- pt, hlt, hlgt, soc, is_primary_soc_for_pt,
-- pt_code, hlt_code, hlgt_code, soc_code, pt_primary_soc_code
```

**`MEDDRA_TERM_SPL_COUNT`** (14,213 rows): Aggregated term → SPL count statistics.
Columns: `TERM`, `ASSIGNED_BY` (NUMBER), `SPL_COUNT`, `IS_PT`.

---

### 4.5 Product-Level Tables — `SPL_PROD` / `DGV_SPL_PROD`

Individual product records within a label. **200,787 rows** each.

| Column | Type | Notes |
|---|---|---|
| `ID` | NUMBER (PK) | Product identifier |
| `SPL_ID` | NUMBER | FK → `SUM_SPL.SPL_ID` |
| `NAME` | VARCHAR2(500) | Trade product name |
| `GENERIC_NAME` | VARCHAR2(500) | Generic name |
| `NORMD_GENERIC_NAME` | VARCHAR2(500) | Normalized generic name |
| `NDC_CODE` | VARCHAR2(13) | NDC code |
| `NCIT_FORM_CODE` | VARCHAR2(6) | NCIT dosage form code |
| `NCIT_FORM_NAME` | VARCHAR2(200) | Dosage form term |
| `DOC_ORDER` | NUMBER | Product order within document |

`DGV_SPL_PROD` adds `EQUIV_TO_NDC_CODE` VARCHAR2(13) and `PROD_XML` XMLTYPE (full product XML).

---

### 4.6 Ingredient Tables — `PROD_INGR` / `DGV_PROD_INGR`

Per-product ingredient detail. **2,072,307 / 2,072,330 rows**.

| Column | Type | Notes |
|---|---|---|
| `ID` | NUMBER (PK) | |
| `SPL_ID` | NUMBER | FK → SUM_SPL |
| `PRODUCT_ID` | NUMBER | FK → SPL_PROD.ID |
| `SUBSTANCE_NAME` | VARCHAR2(500) | Ingredient name |
| `UNII` | VARCHAR2(50) | FDA UNII code |
| `IS_ACTIVE` | NUMBER | 1 = active ingredient |
| `BASIS_OF_STRENGTH_CODE` | VARCHAR2(1) | Strength basis |
| `QTY_NUMER_VAL` | NUMBER / VARCHAR2(50) | Strength numerator value |
| `QTY_NUMER_UNIT` | VARCHAR2(200) | Strength numerator unit |
| `QTY_NUMER_NCIT_UNITS_VAL` | NUMBER | NCIT-normalized unit value |
| `QTY_NUMER_NCIT_UNIT_NAME` | VARCHAR2(200) | NCIT unit name |
| `QTY_NUMER_NCIT_UNIT_CODE` | VARCHAR2(50) | NCIT unit code |
| `QTY_DENOM_VAL` | NUMBER / VARCHAR2(50) | Denominator value |
| `QTY_DENOM_UNIT` | VARCHAR2(200) | Denominator unit |
| `QTY_DENOM_NCIT_*` | various | Denominator NCIT unit fields |
| `GEN_MAT_KINDS_XML` | XMLTYPE | Generic material kinds XML |
| `ACTIVE_MOEITIES_XML` | XMLTYPE | Active moieties XML (PROD_INGR only) |

`DGV_PROD_INGR` additionally has `ACTIVE_ACTIVEMOIETY_NAME` and `ACTIVE_ACTIVEMOIETY_UNII`
denormalized out of the XML.

---

### 4.7 Label Summary Child Tables

These one-to-many tables expand the pipe-delimited columns in `SUM_SPL` into normalized rows.

| Table | Rows | Key Columns |
|---|---|---|
| `SUM_SPL_ROUTE` | 165,930 | SPL_ID, NCIT_ROUTE_OF_ADMIN_CODE, ROUTE_SPL_ACCEPTABLE_TERM |
| `SUM_SPL_ACT_INGR_UNII` | 301,070 | SPL_ID, UNII |
| `SUM_SPL_ACT_INGR_NAME` | 301,159 | SPL_ID, SUBSTANCE_NAME |
| `SUM_SPL_ACT_MOIETY_UNII` | — | SPL_ID, ACTIVE_MOIETY_UNII |
| `SUM_SPL_ACT_MOIETY_NAME` | — | SPL_ID, ACTIVE_MOIETY_NAME |
| `SUM_SPL_EPC` | 160,988 | SPL_ID, SET_ID, EPC (VARCHAR2 4000) |
| `SUM_SPL_MKT_CAT` | 160,589 | SPL_ID, MARKETING_CAT_NCIT_CODE, CATEGORY_SPL_ACCEPTABLE_TERM |
| `SUM_SPL_MKT_ACT` | 165,680 | SPL_ID, MARKETING_ACT |
| `SUM_SPL_PRODNAME` | 169,088 | SPL_ID, PRODUCT_NAME |
| `SUM_SPL_NDC` | 200,597 | SPL_ID, PRODUCT_NDC_CODE (VARCHAR2 13) |
| `SUM_SPL_DOSAGEFORM` | 161,517 | SPL_ID, PRODUCT_NCIT_FORM_CODE, PRODUCT_DOSAGE_FORM_TERM |
| `SUM_SPL_GEN_PROD` | 165,831 | SPL_ID, PRODUCT_NORMD_GENERIC_NAME + denormalized cols |
| `SUM_SPL_GEN_PROD_ACT_INGR_UNII` | — | SPL_ID, PRODUCT_NORMD_GENERIC_NAME, UNII |
| `SUM_SPL_GEN_PROD_MKT_ACT` | — | SPL_ID, PRODUCT_NORMD_GENERIC_NAME, MARKETING_ACT |
| `SUM_SPL_GEN_PROD_NDC` | — | SPL_ID, PRODUCT_NORMD_GENERIC_NAME, NDC_CODE |
| `SUM_SPL_RLD` | 3,520 | SPL_ID, MARKETING_CAT_NCIT_CODE, APPL_NO, RLD (Reference Listed Drug flag) |

**DGV_ equivalents** exist for most child tables (e.g., `DGV_SUM_SPL_ROUTE`, `DGV_SUM_SPL_MKT_CAT`,
etc.) with similar columns but `NUMBER(24,0)` for SPL_ID and `VARCHAR2(80)` for MARKETING_ACT.

---

### 4.8 Product Sub-Tables

| Table | Rows | Purpose |
|---|---|---|
| `PROD_ROUTE` | 214,201 | Product-level routes (PRODUCT_ID, NCIT_ROUTE_OF_ADMIN_CODE, SPL_ID) |
| `PROD_MKT_ACT` | 200,032 | Product marketing actions with date ranges (ACT_NCIT_CODE, STATUS_CODE, LOW_DATE, HIGH_DATE, CENTER_DATE) |
| `PROD_APPR` | 200,152 | Product approval records (APPROVAL_NUM, MARKETING_CAT_NCIT_CODE, DATE_GRANTED, AGENCY_NAME) |
| `PROD_DEA` | — | DEA schedule (NCIT_DEA_CODE, NCIT_DEA_NAME) |
| `PROD_GEN_NAME_COMP` | — | Generic name components |
| `DGV_PROD_MKT_ACT` | — | Denormalized marketing actions (same structure) |
| `DGV_PROD_APPR` | — | Denormalized approvals — approval numbers can be VARCHAR2(4000) |
| `DGV_PROD_ROUTE` | — | Denormalized routes |
| `DGV_PROD_DEAPOLICY` | — | DEA policy (POLICY_CLASS, POLICY_CODE, POLICY_NAME) |
| `DGV_PROD_DENOM` | — | Product denominator unit (PUNIT) |
| `DGV_PROD_INGR_TMP` | — | Staging: ingredient with ACTIVEMOIETY NAME/UNII and UNIT |
| `SPL_PROD_STAGING` | — | Full staging table with XML sub-columns (PACKAGINGS, INGREDIENTS, CHARACTERISTICS, APPROVALS, MARKETING_ACTS, ISSUES, CONSUMED_INS, PARTICIPATIONS) |

---

### 4.9 Reference Listed Drug & Orange Book

**`SUM_SPL_RLD`** (3,520 rows):  
Application-level RLD flag per marketing category.  
`(SPL_ID, MARKETING_CAT_NCIT_CODE, MARKETING_CAT_DESCRIPTION, APPL_NO, RLD)` — `RLD` is a string ('Yes'/'No').

**`OB_PRODUCTS`** (48,381 rows):  
Orange Book product table, loaded periodically from FDA Orange Book data.

| Column | Type |
|---|---|
| `INGREDIENT` | VARCHAR2(500) |
| `DF` | VARCHAR2(200) — dosage form |
| `ROUTE` | VARCHAR2(200) |
| `TRADE_NAME` | VARCHAR2(200) |
| `APPLICANT` | VARCHAR2(200) |
| `APPLICANT_FULL_NAME` | VARCHAR2(200) |
| `STRENGTH` | VARCHAR2(500) |
| `APPL_TYPE` | VARCHAR2(20) — 'A' (ANDA) or 'N' (NDA) |
| `APPL_NO` | NUMBER |
| `PRODUCT_NO` | NUMBER |
| `TE_CODE` | VARCHAR2(20) — therapeutic equivalence code |
| `APPROVAL_DATE` | VARCHAR2(50) |
| `RLD` | VARCHAR2(20) — 'Yes'/'No' |
| `RS` | VARCHAR2(20) — Reference Standard |
| `TYPE` | VARCHAR2(20) |

**`APPL_RLD_V`** view (28,695 rows): Joins `OB_PRODUCTS` A-type to N-type to find RLD applications,
then joins `SPL_APPL_V` to associate with SPL records.

**`SPL_APPL_V`** view (59,331 rows): Extracts `(spl_id, marketing_cat_description, appl_num, appl_no)`
from `DGV_PROD_APPR` for NDA/ANDA/BLA/IND/NADA/ANADA marketing categories.

---

### 4.10 Pharmacologic Class

**`PHARMA_INDEX`** (11,087 rows):  
Maps UNII → NUI (NDF-RT concept identifier) with class name and type level.

| Column | Notes |
|---|---|
| `PHARMA_SETID` | SPL set_id of the pharmacologic class indexing document |
| `UNII` | Substance UNII |
| `NUI` | NDF-RT NUI |
| `NAME` | Class name |
| `TERM` | Preferred term |
| `TLEVEL` | Type: `[EPC]`, `[MoA]`, `[PE]`, `[Chemical/Ingredient]`, `[CS]`, `[EXT]` |

**`PHARM_INDEX`** (9,916 rows): Older/smaller version; just `(PHARMA_SETID, UNII, NUI)`.

**`PHARMA_MAPPING`**: Maps product SPL `SET_ID` → `PHARMA_SETID`.

**`NDFRT_CONCEPT`** / **`NDFRT_CONCEPTINF`** (1,155 rows):  
NDF-RT concept registry. `NDFRT_CONCEPTINF` has `(ID, CODE, NAME, KIND, TLEVEL, NUI)`;
`NDFRT_CONCEPT` has `(NUI, NAME, CAT)`.

**`INGR_NDFRT_CONCEPT`**: Maps ingredient UNII → NDFRT_NUI.

**`DGV_PHARMA_SPL_COUNT`** (1,455 rows): Pre-aggregated `(NUI, NAME, COUNT)` SPL counts per class.

**`DGV_PHARMA_CLASS_SPL_VIEW`** view: Joins `PHARMA_INDEX` with `DGV_PHARMA_SPL_COUNT` exposing
NUI, class_name, class_type (abbreviated), and spl_count.

---

### 4.11 Chemical Structures — `UNII_CHEM_STRUCT`

6,091 rows. Maps UNII → SMILES string.

| Column | Type |
|---|---|
| `UNII` | VARCHAR2(10) NOT NULL (PK) |
| `SMILES` | VARCHAR2(4000) |

---

### 4.12 Archived Labels

Historical SPL versions that have been superseded. `ARCHIVED_SPL` currently has **0 rows** on
TST (data not populated), but the schema matches `SPL` plus `ARCHIVED_LOAD_NUM`.

Related tables: `ARCHIVED_SPL_ANN`, `ARCHIVED_SPL_ATT`, `ARCHIVED_SPL_HTML`, `ARCHIVED_SPL_TAG`
(mirror the annotation/attachment/HTML/tag tables for archived records).

---

### 4.13 Reference / Lookup Tables

| Table | Rows | Key Columns | Purpose |
|---|---|---|---|
| `DOCUMENT_TYPE` | 59 | LOINC_CODE (PK), LOINC_NAME, VIEW_ORDER | Document type registry |
| `SECTION_TYPE` | 110 | LOINC_CODE (PK), LOINC_NAME | Section LOINC code registry |
| `MARKETING_CATEGORY` | 30 | NCI_THESAURUS_CODE (PK), SPL_ACCEPTABLE_TERM, ISLDT | Marketing category registry |
| `ROUTE_OF_ADMIN` | 127 | NCI_THESAURUS_CODE (PK), SPL_ACCEPTABLE_TERM | Route of administration |
| `DOSAGE_FORM` | — | — | Dosage form NCIT codes |
| `DEA_SCHEDULE` | — | NCI_THESAURUS_CODE, SPL_ACCEPTABLE_TERM | DEA schedule codes |
| `CODING_AUTHORITY` | — | ID, NAME, SOURCE_DATE | Terminology source authorities |
| `NDFRT_CONCEPT_PROPERTIES` | — | CONCEPTID, NAME, VALU | NDF-RT concept properties |

**Key marketing category NCIT codes** (from `MARKETING_CATEGORY`):

| Code | Term | ISLDT |
|---|---|---|
| C73584 | ANDA | Y |
| C73585 | BLA | Y |
| C73594 | NDA | Y |
| C73605 | NDA Authorized Generic | Y |
| C200263 | OTC Monograph Drug | Y |
| C73603 | OTC Monograph Final | Y |
| C73604 | OTC Monograph Not Final | Y |
| C75302 | IND | — |
| C73593 | NADA | — |
| C73583 | ANADA | — |
| C80442 | Premarket Notification | — |
| C80441 | Premarket Application | — |
| C80438 | Exempt device | — |
| C80440 | Humanitarian Device Exemption | — |

---

### 4.14 Display / UI Support Tables

| Table | Purpose |
|---|---|
| `DGV_LABELING_TYPE_SECTION` | Section navigation layout per labeling format (TYPEFORMAT, VIEW_NO, CODE, DISPLAY_NAME, SECTION_LEVEL) |
| `DGV_SECTION_TYPE_SEALDS` | Same as above — used by SEALDS UI |
| `DGV_DOCUMENT_TYPE_SEALDS` | Document type with FORMAT_GROUP, OWNER, LEV (level) |
| `DGV_ROUTE_OF_ADMIN_COUNT` | Route → SPL count aggregate (127 codes, 165,930-based) |
| `DGV_MARKETING_CAT_COUNT` | Marketing category → count |
| `DGV_PHARMA_SPL_COUNT` | Pharma class NUI → count |
| `DGV_NDFRT_CONCEPT_SPL_COUNT` | NDF-RT NUI → count |
| `DGV_FORMAT_DOCUMENT_TYPE_COUNT` | Format × code → count |
| `DGV_SPL_SECT_COUNT` | Section code → distinct SPL count |
| `SPL_SECTION_COUNT` | Loinc_code → count (simpler version) |
| `DGV_SPL_TITLE` | SPL_ID → TITLE (XMLTYPE) |
| `STATS_COUNTS` | Aggregate statistics by update date (FDA_HUMAN_RX, FDA_HUMAN_OTC, FDA_NDA, CDER_*, etc.) |
| `MEDDRA_SECTION_VIEW` | 53 rows — MedDRA-supported section codes per format |
| `SECTION_TYPE_SEALDS_VIEW` | 91 rows — Section types with counts for the UI |

---

### 4.15 Load / ETL Management Tables

| Table | Purpose |
|---|---|
| `LOAD` | Load run log (LOAD_NUM PK, STARTED_TS, FINISHED_TS, SOURCE_FETCH_DT, SOURCE) |
| `LOAD_OPERATION` | Per-load operation log (DATETIME, LOAD_NUM, OPERATION, FAILURES) |
| `LOAD_MD5` | MD5 registry per load to detect duplicates |
| `LOAD_RECORD_COUNT` | Table-level record counts per load |
| `SKIP_IMPORT_ENTRY` | Zip entries excluded from import with reason |
| `SPL_INITIAL_APP` | 70,881 rows — Initial approval year lookup (SPL_ID, TITLE, EFF_TIME, INITIAL_APPROVAL_YEAR) |
| `DICT_MAINTANCE` | Data dictionary maintenance log |
| `GLOBAL_TEMP_ID` | Per-session temporary ID storage (SESSION_ID, TYPE, VALUE) |

---

### 4.16 User / Session Management (Oracle-side)

| Table | Purpose |
|---|---|
| `USER_ACCOUNT` | 65 rows — Oracle-side user accounts (USERNAME, PASSWORD hash, ENABLED) |
| `USER_AUTHORITY` | Role grants for Oracle-side users |
| `SAVED_LABELS_SEARCH` | Saved searches (USERNAME, SEARCH_NAME, SEARCH_XML, timestamps) |
| `SPL_ANN` | Annotations on SPL records (OWNER, TITLE, TEXT CLOB, IS_PUBLIC) |
| `SPL_TAG` | Tags on SPL records (OWNER, TAG, IS_PUBLIC) |
| `SPL_ATT` | Attachments (NAME, DATA BLOB) |
| `SPL_HTML` | Pre-rendered HTML sections (SPL_ID, SEC_NUM, SEC_TYPE_CODE, HTML CLOB) |

---

### 4.17 BLA Summary Views

| View | Rows | Description |
|---|---|---|
| `CBER_BLA_TABLE` | 447 | CBER BLA summary from DGV_SUM_SPL (BLA market category) |
| `CDER_BLA_TABLE` | 130 | CDER BLA summary |
| `LH_SAI_DRUGS` | 1,358 | Single active ingredient NDA drugs |
| `LH_SAM_DRUGS` | 1,152 | Single active moiety NDA drugs |
| `NDA_SINGLE_SAI` | 4,771 | NDA single active ingredient lookup |
| `NDA_SINGLE_SAM` | 4,796 | NDA single active moiety lookup |
| `NDFRT_CLASS_SPL` | 1,146 | NDF-RT class → SPL mapping with class type |
| `DOC_TYPE_SEALDS` | 28 | Document types for SEALDS UI |
| `MARKET_CATEGORY_SEALDS` | 24 | Market categories for SEALDS UI |
| `SPL_LOADER_COUNT_VIEW` | 100 | Load count statistics |
| `SPL_LOADER_COUNT_VIEW_LDT` | 309 | Load count statistics (LDT variant) |

---

## 5. Database Row Counts (TST Snapshot)

| Table / View | Row Count |
|---|---|
| `SUM_SPL` / `DGV_SUM_SPL` | 160,988 |
| `DGV_SUM_RX_SPL` | 155,215 |
| `SPL` | 160,988 |
| `SPL_SEC` | 3,641,258 |
| `SPL_SEC_MEDDRA_LLT_OCC` | 29,747,378 |
| `MEDDRA_LLT_HIER_SPL_CODED_SEC` (view) | 39,286,020 |
| `SPL_SEC_HIGHLIGHT` | 212,777 |
| `SPL_PROD` / `DGV_SPL_PROD` | 200,787 |
| `PROD_INGR` | 2,072,307 |
| `DGV_PROD_INGR` | 2,072,330 |
| `PROD_ROUTE` | 214,201 |
| `PROD_MKT_ACT` | 200,032 |
| `PROD_APPR` | 200,152 |
| `SUM_SPL_ACT_INGR_UNII` | 301,070 |
| `SUM_SPL_ACT_INGR_NAME` | 301,159 |
| `SUM_SPL_EPC` | 160,988 |
| `SUM_SPL_MKT_CAT` | 160,589 |
| `SUM_SPL_MKT_ACT` | 165,680 |
| `SUM_SPL_PRODNAME` | 169,088 |
| `SUM_SPL_NDC` | 200,597 |
| `SUM_SPL_DOSAGEFORM` | 161,517 |
| `SUM_SPL_GEN_PROD` | 165,831 |
| `SUM_SPL_RLD` | 3,520 |
| `SUM_SPL_ROUTE` | 165,930 |
| `OB_PRODUCTS` | 48,381 |
| `UNII_CHEM_STRUCT` | 6,091 |
| `PHARMA_INDEX` | 11,087 |
| `PHARM_INDEX` | 9,916 |
| `NDFRT_CONCEPT` / `NDFRT_CONCEPTINF` | 1,155 |
| `MEDDRA_TERM_SPL_COUNT` | 14,213 |
| `APPL_RLD_V` (view) | 28,695 |
| `SPL_APPL_V` (view) | 59,331 |
| `SPL_INITIAL_APP` | 70,881 |
| `STATS_COUNTS` | 520 |
| `LOAD` (load runs) | 752 |
| `USER_ACCOUNT` | 65 |
| `ARCHIVED_SPL` | 0 (unpopulated on TST) |

---

## 6. Query Criteria Mapping (PostgreSQL vs. Oracle)

The following matrix defines how Query Builder criteria translate between PostgreSQL
(`labeling.sum_spl`) and Oracle (`druglabel.DGV_SUM_SPL` / child tables):

| # | Criterion | Local PostgreSQL | Oracle FDALabel | Notes |
|---|---|---|---|---|
| 1 | **Labeling Type** | `s.doc_type ILIKE ...` | `DGV_SUM_SPL.DOCUMENT_TYPE` or `DOCUMENT_TYPE_LOINC_CODE` | Join `DOCUMENT_TYPE` for display |
| 2 | **Application Type** | `s.market_categories ILIKE ...` | `DGV_SUM_SPL.MARKET_CATEGORIES` or `DGV_SUM_SPL_MKT_CAT.MARKETING_CAT_NCIT_CODE` | Use NCIT codes from `MARKETING_CATEGORY` |
| 3 | **Route of Administration** | `s.routes ILIKE ...` | `DGV_SUM_SPL_ROUTE.NCIT_ROUTE_OF_ADMIN_CODE` or `.ROUTE_SPL_ACCEPTABLE_TERM` | Join `ROUTE_OF_ADMIN` for codes |
| 4 | **Product Name** | `s.product_names`, `s.generic_names` | `DGV_SUM_SPL.PRODUCT_NAMES`, `PRODUCT_NORMD_GENERIC_NAMES`, `DGV_SUM_SPL_PRODNAME` | Pipe-delimited or child table |
| 5 | **Section Text** | XML parsing from local disk | `CONTAINS(SPL_SEC.CONTENT_XML, :term) > 0` | Oracle Text full-text index `CTXIX_SPLSEC_CONTENTXML` |
| 6 | **Labeling Section** | LOINC filter on parsed XML | `SPL_SEC.LOINC_CODE = :loinc` | Filter `SPL_SEC` by LOINC code, then `CONTAINS()` |
| 7 | **Market Status (RLD/RS)** | `s.is_rld`, `s.is_rs` | `SUM_SPL_RLD.RLD = 'Yes'` | `OB_PRODUCTS.RS` for RS flag |
| 8 | **MedDRA Terms** | Local `meddra.*` tables + SPL XML | `SPL_SEC_MEDDRA_LLT_OCC` → `MEDDRA_LLT_HIER_SPL_CODED_SEC` | Use `LLT_CODE` or PT/SOC via hierarchy view |
| 9 | **Pharmacologic Class (EPC)** | `s.epc`, `labeling.epc_map` | `DGV_SUM_SPL.EPC` or `DGV_SUM_SPL_EPC.EPC` | Also via `PHARMA_INDEX` + `DGV_PHARMA_CLASS_SPL_VIEW` |
| 10 | **Active Ingredient / UNII** | `labeling.active_ingredients_map` | `DGV_SUM_SPL_ACT_INGR_UNII.UNII`, `DGV_SUM_SPL_ACT_INGR_NAME.SUBSTANCE_NAME` | |
| 11 | **NDC Code** | `s.ndc_codes ILIKE ...` | `DGV_SUM_SPL_NDC.PRODUCT_NDC_CODE`, `DGV_SUM_SPL.NDC_CODES` | |
| 12 | **Application Number** | `s.appl_num` | `DGV_SUM_SPL.APPR_NUM`, `DGV_PROD_APPR.APPROVAL_NUM` | |
| 13 | **Set ID / SPL GUID** | `s.set_id`, `s.spl_id` | `DGV_SUM_SPL.SET_ID`, `DGV_SUM_SPL.SPL_GUID` | |
| 14 | **Dosage Form** | `s.dosage_forms ILIKE ...` | `DGV_SUM_SPL_DOSAGEFORM.PRODUCT_DOSAGE_FORM_TERM` | |
| 15 | **Manufacturer** | `s.labeler_name` | `DGV_SUM_SPL.AUTHOR_ORG_NORMD_NAME` | |
| 16 | **Initial Approval Year** | `s.initial_approval_year` | `DGV_SUM_SPL.INITIAL_APPROVAL_YEAR` or `SPL_INITIAL_APP` | |
| 17 | **Chemical Structure** | UNII → SMILES from local store | `UNII_CHEM_STRUCT.SMILES` | Oracle ChemAxon cartridge may also apply |
| 18 | **Highlights** | SPL XML parsing | `SPL_SEC_HIGHLIGHT.HIGHLIGHT_CONTENT_XML` | Oracle Text index `CTXIX_SPLSECHLT_XML` |
| 19 | **DEA Schedule** | Not indexed | `PROD_DEA.NCIT_DEA_CODE`, `DGV_PROD_DEAPOLICY` | |

---

## 7. Oracle Text Full-Text Indexes

Three `CTXSYS`-managed full-text indexes enable `CONTAINS()` queries:

| Index Name | Table.Column | Usage |
|---|---|---|
| `CTXIX_SPL_SPLXML` | `SPL.SPL_XML` | Full-document XML search |
| `CTXIX_SPLSEC_CONTENTXML` | `SPL_SEC.CONTENT_XML` | Section-level text search (primary) |
| `CTXIX_SPLSECHLT_XML` | `SPL_SEC_HIGHLIGHT.HIGHLIGHT_CONTENT_XML` | Highlights text search |

The `SECTION_TYPE_SEALDS_VIEW` view uses `CONTAINS(content_xml, 'PATIENT COUNSELING INFORMATION') > 0` on `SPL_SEC` as one of its union branches, confirming the index is live.

---

## 8. MedDRA Schema (External)

The `meddra` schema is not owned by `druglabel` but is accessible via grants. Views in the
`druglabel` schema reference:

- **`meddra.low_level_term`**: `(LLT_CODE, LLT_NAME, LLT_CURRENCY, PT_CODE, ...)`
- **`meddra.meddra_hierarchy`**: `(PT_CODE, PT_NAME, HLT_CODE, HLT_NAME, HLGT_CODE, HLGT_NAME, SOC_CODE, SOC_NAME, PRIMARY_SOC_FG, PT_SOC_CODE)`

These are joined in `MEDDRA_LLT_HIER_SPL_CODED_SEC`. The local PostgreSQL `meddra.*` tables
replicate this hierarchy for offline queries.

---

## 9. Key Relationships / Join Patterns

```
SUM_SPL / DGV_SUM_SPL
    .SPL_ID ←→ SPL.ID                              (XML access)
    .SPL_ID ←→ SPL_SEC.SPL_ID                      (sections)
    .SPL_ID ←→ SPL_PROD.SPL_ID / DGV_SPL_PROD.SPL_ID  (products)
    .SPL_ID ←→ SUM_SPL_ROUTE / DGV_SUM_SPL_ROUTE   (routes)
    .SPL_ID ←→ SUM_SPL_ACT_INGR_UNII / _NAME       (ingredients)
    .SPL_ID ←→ SUM_SPL_EPC / DGV_SUM_SPL_EPC       (pharmacologic class)
    .SPL_ID ←→ SUM_SPL_MKT_CAT / _MKT_ACT          (market status)
    .SPL_ID ←→ SUM_SPL_RLD                          (RLD flag)
    .SPL_ID ←→ SUM_SPL_NDC / DGV_SUM_SPL_NDC       (NDC codes)
    .SET_ID ←→ SPL_SEC_MEDDRA_LLT_OCC.SET_ID        (MedDRA occurrences)

SPL_PROD.ID ←→ PROD_INGR.PRODUCT_ID               (product ingredients)
SPL_PROD.ID ←→ PROD_ROUTE.PRODUCT_ID              (product routes)
SPL_PROD.ID ←→ PROD_MKT_ACT.PRODUCT_ID            (marketing actions)
SPL_PROD.ID ←→ PROD_APPR.PRODUCT_ID               (approval records)

SPL_SEC.GUID ←→ SPL_SEC_MEDDRA_LLT_OCC.SEC_GUID   (term-to-section)
SPL_SEC_MEDDRA_LLT_OCC.LLT_CODE ←→ meddra.low_level_term.LLT_CODE

PROD_APPR.APPROVAL_NUM →extract APPL_NO→ OB_PRODUCTS.APPL_NO (via SPL_APPL_V)
```

---

## 10. Practical Query Examples

### Find all current Rx labels for a drug name
```sql
SELECT s.spl_id, s.spl_guid, s.set_id, s.eff_time, s.appr_num, s.product_names
FROM dgv_sum_spl s
WHERE UPPER(s.product_normd_generic_names) LIKE UPPER('%aspirin%')
  AND s.document_type_loinc_code IN ('34391-3', '45129-4')  -- Human Rx with/without highlights
ORDER BY s.eff_time DESC;
```

### Look up full SPL XML by set_id (most current version)
```sql
SELECT spl_xml
FROM spl
WHERE set_id = :set_id
  AND version_num = (
      SELECT MAX(version_num) FROM spl WHERE set_id = :set_id
  );
```

### Find labels by UNII (active ingredient)
```sql
SELECT s.spl_id, s.spl_guid, s.product_names, s.appr_num
FROM dgv_sum_spl s
JOIN dgv_sum_spl_act_ingr_unii u ON s.spl_id = u.spl_id
WHERE u.unii = :unii;
```

### Find labels containing a MedDRA PT term in a specific section
```sql
SELECT DISTINCT h.set_id, h.section, h.pt, h.soc
FROM meddra_llt_hier_spl_coded_sec h
JOIN meddra.low_level_term llt ON h.llt_code = llt.llt_code
WHERE llt.pt_code = :pt_code
  AND h.section_code = '34084-4';  -- Adverse Reactions
```

### Section text search (Oracle Text)
```sql
SELECT s.spl_id, s.loinc_code
FROM spl_sec s
WHERE CONTAINS(s.content_xml, :search_term) > 0
  AND s.loinc_code = '34084-4'  -- Adverse Reactions section
ORDER BY SCORE(1) DESC;
```

### Find RLD for an ANDA application
```sql
SELECT a.ingredient, a.df, a.route, a.strength,
       a.appl_no anda_appl, a.rld_no nda_appl, a.spl_id
FROM appl_rld_v a
WHERE a.appl_no = :anda_no;
```

### Get pharmacologic class for a label
```sql
SELECT e.epc
FROM dgv_sum_spl_epc e
WHERE e.spl_id = :spl_id;

-- Or via full class hierarchy with type:
SELECT p.nui, p.name, p.tlevel
FROM pharma_index p
JOIN sum_spl_act_ingr_unii u ON p.unii = u.unii
WHERE u.spl_id = :spl_id;
```

---

## 11. App Integration Notes

### How `fdalabel_db.py` resolves the connection
1. Reads `oracle_env` from `EnvService.labeling_source` (`'dev'` or `'tst'`)
2. Selects prefix `FDALABEL_DEV_*` or `FDALABEL_TST_*`
3. Reads `HOST`, `PORT`, `SERVICE` from env/config
4. Calls `oracledb.makedsn(host, port, service)` — **note**: in this environment `service` is
   actually a SID; `makedsn` defaults to service_name but the TST listener only recognizes SID.
   This works because `makedsn(host, port, service_name=s)` and `makedsn(host, port, sid=s)`
   produce different descriptors. If the connection silently upgrades to service registration in
   a future Oracle version, switch to `makedsn(host, port, sid=service)` explicitly.

### Oracle vs. PostgreSQL column name differences

| PostgreSQL (`labeling.sum_spl`) | Oracle (`druglabel.DGV_SUM_SPL`) |
|---|---|
| `spl_id` (UUID/text) | `SPL_GUID` (the GUID) + `SPL_ID` (numeric PK) |
| `set_id` | `SET_ID` |
| `doc_type` | `DOCUMENT_TYPE` / `DOCUMENT_TYPE_LOINC_CODE` |
| `market_categories` | `MARKET_CATEGORIES` |
| `routes` | `ROUTES_OF_ADMINISTRATION` |
| `product_names` | `PRODUCT_NAMES` |
| `generic_names` | `PRODUCT_NORMD_GENERIC_NAMES` |
| `epc` | `EPC` |
| `appl_num` | `APPR_NUM` |
| `local_path` | `ARCHIVE_DIR` + `FILENAME` |
| `is_rld` | join `SUM_SPL_RLD.RLD = 'Yes'` |

### Oracle Text `CONTAINS()` requirements
- Queries must use `CONTAINS(column, :term) > 0` with an integer label argument when scoring is needed: `CONTAINS(column, :term, 1) > 0` + `ORDER BY SCORE(1) DESC`.
- Wildcard: `%term%` becomes `'%term%'` in `CONTAINS()` with the `LIKE` operator or use `'*term*'` with fuzzy operators.
- Phrase search: `'"adverse reactions"'`.
- Boolean: `'hepatic AND failure'`.

---

*Document generated from live TST database introspection. Re-run the Python schema
exploration script against the host to verify after any database refresh cycle.*
