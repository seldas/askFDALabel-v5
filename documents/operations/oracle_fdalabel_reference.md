# Oracle FDALabel & MedDRA Database Reference

## 1. Overview

In FDA internal environments, AskFDALabel can interface directly with the authoritative Oracle FDALabel database (`druglabel` schema). This document serves as the technical schema dictionary and criteria-mapping reference between the local PostgreSQL database and the internal Oracle database.

---

## 2. Oracle Schema Architecture

The internal Oracle database organizes labeling records across four primary functional tiers:

### 2.1 Document Summary & Filtering
- **`druglabel.SUM_SPL` / `druglabel.DGV_SUM_SPL`**:
  Principal view containing label metadata, active ingredients, approval numbers, document types, and effective times (`EFF_TIME`).
  - `SPL_ID`: Internal numeric sequence identifier.
  - `SPL_GUID`: Unique document version identifier (corresponds to `spl_id` in PostgreSQL).
  - `SET_ID`: Persistent product identifier across all label versions.

### 2.2 Prescribing XML & Content
- **`druglabel.SPL`**:
  Stores raw SPL XML documents in the `SPL_XML` LOB column.
- **`druglabel.SPL_SEC`**:
  Parsed section text, section LOINC codes, section titles, and section-level GUIDs (`SEC_GUID`).

### 2.3 Normalized Relationships & Terminology
- **`druglabel.SUM_SPL_RLD`**: Reference Listed Drug designations.
- **`druglabel.SUM_SPL_ROUTE`**: Normalized administration routes.
- **`druglabel.SUM_SPL_GEN_PROD_ACT_INGR_UNII`**: Active ingredient substance mappings (UNII codes).
- **`druglabel.UNII_CHEM_STRUCT`**: Chemical structure registrations (SMILES/Mol format).

### 2.4 MedDRA Occurrences
- **`druglabel.SPL_SEC_MEDDRA_LLT_OCC`**:
  Pre-indexed occurrences of MedDRA terms within specific SPL sections, joined on `SEC_GUID` and `LLT_CODE`.

---

## 3. Query Criteria Mapping (PostgreSQL vs. Oracle)

The following matrix defines how Query Builder criteria translate between PostgreSQL (`labeling.sum_spl`) and Oracle (`druglabel.DGV_SUM_SPL`):

| # | Criterion Category | Local PostgreSQL Mapping | Oracle FDALabel Mapping | Status |
|---|---|---|---|---|
| 1 | **Labeling Type** | `s.doc_type ILIKE ...` | `DGV_SUM_SPL.LABELING_TYPE` / `DOCUMENT_TYPE` | Supported |
| 2 | **Application Type** | `s.market_categories ILIKE ...` | `DGV_SUM_SPL.MARKET_CATEGORIES` | Supported |
| 3 | **Route of Administration** | `s.routes ILIKE ...` | `DGV_SUM_SPL.ROUTES` | Supported |
| 4 | **Product Name** | `s.product_names`, `s.generic_names` | `PRODUCT_NAMES`, `PRODUCT_NORMD_GENERIC_NAMES` | Supported |
| 5 | **Section Text** | Dynamic SPL XML parsing on disk | `druglabel.SPL_SEC.CONTENT_XML` | Supported |
| 6 | **Labeling Section** | LOINC code filter on parsed XML | `druglabel.SPL_SEC.LOINC_CODE` | Supported |
| 7 | **Market Status** | `s.is_rld`, `s.is_rs` | `druglabel.sum_spl_rld` | Supported |
| 8 | **MedDRA Terms** | MedDRA hierarchy join on local tables | `druglabel.SPL_SEC_MEDDRA_LLT_OCC` | Supported |
| 9 | **Pharmacologic Class** | `s.epc`, `labeling.epc_map` | `DGV_SUM_SPL.EPC` | Supported |
| 10| **Identifiers** | `set_id`, `spl_id`, `ndc_codes`, `appr_num` | `SET_ID`, `SPL_GUID`, `NDC_CODES`, `APPR_NUM` | Supported |
| 11| **Chemical Structure**| Stored UNII structure lookup | External ChemAxon cartridge on Oracle | Supported |
