# Oracle FDALabel DB Criteria Mapping & Clarification Document

This document outlines how all **11 Query Criteria Categories** in the askFDALabel Query Builder map between the **PostgreSQL Local DB** (`labeling.sum_spl`) and the **Oracle FDALabel DB** (`druglabel.DGV_SUM_SPL`), highlighting specific schema questions and categories requiring user clarification.

---

## Overview of Query Criteria Categories

| # | Criterion Category | UI Field(s) | Local Postgres Mapping (`labeling.sum_spl`) | Oracle FDALabel Mapping (`druglabel.DGV_SUM_SPL`) | Status & Clarifications |
|---|---|---|---|---|---|
| 1 | **Labeling Type** | `values[]` | `s.doc_type` (wildcard `ILIKE` + `string_to_array`) | `DGV_SUM_SPL.LABELING_TYPE` / `DOCUMENT_TYPE` | ✅ Clear |
| 2 | **Application Type** | `values[]` | `s.market_categories` (wildcard `ILIKE` + `string_to_array`) | `DGV_SUM_SPL.MARKET_CATEGORIES` | ✅ Clear |
| 3 | **Route of Administration** | `values[]` | `s.routes` (wildcard `ILIKE` + `string_to_array`) | `DGV_SUM_SPL.ROUTES` | ✅ Clear |
| 4 | **Product Name** | `field`, `op`, `text` | `s.product_names`, `s.generic_names`, `s.active_ingredients` | `PRODUCT_NAMES`, `PRODUCT_NORMD_GENERIC_NAMES`, `ACT_INGR_NAMES` | ✅ Clear |
| 5 | **Full Text Search** | `mode`, `text` | `labeling.spl_sections.search_vector @@ to_tsquery()` | Oracle Text `CONTAINS(druglabel.SPL_SEC.CONTENT_XML, ...)` | ⚠️ Needs Clarification #1 |
| 6 | **Labeling Section** | `sections[]`, `mode`, `text` | `labeling.spl_sections` (LOINC / Title / Virtual Sections) | `druglabel.SPL_SEC` & `DGV_SUM_SPL` | ⚠️ Needs Clarification #2 |
| 7 | **Market Status** | `values[]` (RLD, RS, Marketed, Discontinued) | `s.is_rld`, `s.is_rs`, `public.orange_book` | `druglabel.sum_spl_rld` | ⚠️ Needs Clarification #3 |
| 8 | **MedDRA Terms** | `terms[]`, `level`, `sections[]` | `labeling.spl_sections` (Adverse Reactions, Warnings, Boxed) | Oracle Text `CONTAINS(druglabel.SPL_SEC.CONTENT_XML, ...)` | ✅ Clear |
| 9 | **Pharmacologic Class** | `terms[]`, `classType` (EPC, MoA, PE, CS) | `s.epc`, `labeling.epc_map`, `labeling.substance_indexing` | `DGV_SUM_SPL.EPC` | ⚠️ Needs Clarification #4 |
| 10 | **Identifier Search** | `text`, `ingredientType` | `s.set_id`, `s.spl_id`, `s.ndc_codes`, `s.appr_num`, `aim.unii` | `SET_ID`, `SPL_ID`, `NDC_CODES`, `APPR_NUM` | ⚠️ Needs Clarification #5 |
| 11 | **Chemical Structure** | `structure` (SMILES/Mol) | Warns (requires structure cartridge) | External ChemAxon / Oracle Cartridge | ⚠️ Needs Clarification #6 |

---

## Detailed Category Mapping & Clarification Points

### 1. Labeling Type
- **Postgres**: Filtered against `s.doc_type` (e.g. `HUMAN PRESCRIPTION DRUG LABEL`, `HUMAN OTC DRUG LABEL`).
- **Oracle**: Filtered against `druglabel.DGV_SUM_SPL.LABELING_TYPE` or `DOCUMENT_TYPE`.
- **Implementation Status**: Fully supported.

---

### 2. Application Type (Marketing Category)
- **Postgres**: Filtered against `s.market_categories` (e.g. `NDA`, `ANDA`, `BLA`, `OTC MONOGRAPH NOT FINAL`).
- **Oracle**: Filtered against `druglabel.DGV_SUM_SPL.MARKET_CATEGORIES`.
- **Implementation Status**: Fully supported.

---

### 3. Route of Administration
- **Postgres**: Filtered against `s.routes` (e.g. `ORAL`, `INTRAVENOUS`, `TOPICAL`).
- **Oracle**: Filtered against `druglabel.DGV_SUM_SPL.ROUTES`.
- **Implementation Status**: Fully supported.

---

### 4. Product Name(s)
- **Postgres**: Multi-field search over `product_names` (Trade Name), `generic_names` (Generic Name), and `active_ingredients`.
- **Oracle**: Filtered against `UPPER(PRODUCT_NAMES)`, `UPPER(PRODUCT_NORMD_GENERIC_NAMES)`, and `UPPER(ACT_INGR_NAMES)`.
- **Implementation Status**: Fully supported.

---

### 5. Full Text Search
> [!IMPORTANT]
> **Clarification Item #1**: Full-Text Indexing Engine in Oracle
> - **Postgres**: Uses Postgres `tsvector` over `labeling.spl_sections`.
> - **Oracle**: Uses Oracle Text `CONTAINS(druglabel.SPL_SEC.CONTENT_XML, '{text}') > 0`.
> - **Question for User**: Does the internal FDA Oracle database use `druglabel.SPL_SEC.CONTENT_XML` for full-text search, or is there a dedicated Oracle Text index view (e.g., `druglabel.DGV_SECTION_TEXT`)?

---

### 6. Labeling Section & Virtual Sections
> [!IMPORTANT]
> **Clarification Item #2**: Virtual Sections & Section Filtering in Oracle
> - **Postgres**:
>   - Virtual section `SPLTITLE` maps to `s.product_names` / `s.generic_names`.
>   - Virtual section `43683-2` (Approval Year) maps to `s.initial_approval_year`.
>   - Specific section LOINCs/Titles filter `labeling.spl_sections`.
> - **Oracle**:
>   - `SPLTITLE` maps to `PRODUCT_NAMES` / `PRODUCT_NORMD_GENERIC_NAMES`.
> - **Question for User**: Is `INITIAL_APPROVAL_YEAR` stored as a column on `druglabel.DGV_SUM_SPL` (or `EFF_TIME` year extract), and is section filtering in Oracle executed via `druglabel.SPL_SEC.SECTION_CODE` (LOINC)?

---

### 7. Market Status (RLD, RS, Marketed / Discontinued)
> [!IMPORTANT]
> **Clarification Item #3**: Orange Book & Discontinued Status in Oracle
> - **Postgres**: `s.is_rld = 1`, `s.is_rs = 1`, and joins `public.orange_book` for `RX`, `OTC`, `DISCN`.
> - **Oracle**: `EXISTS (SELECT 1 FROM druglabel.sum_spl_rld rld WHERE rld.SPL_ID = DGV_SUM_SPL.SPL_ID)`.
> - **Question for User**: Does Oracle FDALabel DB maintain a separate `ORANGE_BOOK` or `DISCONTINUED` table/column to differentiate Active Marketed (`RX`/`OTC`) from Discontinued (`DISCN`) drugs, or is `sum_spl_rld` the primary reference?

---

### 8. MedDRA Terms
- **Postgres**: Searches MedDRA adverse event terms across Adverse Reactions (`34084-4`), Warnings and Precautions (`43685-7`), and Boxed Warning (`34066-1`).
- **Oracle**: Uses Oracle Text `CONTAINS(druglabel.SPL_SEC.CONTENT_XML, '{term1} AND {term2}') > 0`.
- **Implementation Status**: Supported.

---

### 9. Pharmacologic Class (EPC, MoA, PE, CS)
> [!IMPORTANT]
> **Clarification Item #4**: MoA, PE, and Chemical Structure (CS) Classes in Oracle
> - **Postgres**:
>   - `EPC`: Matches `s.epc` or `labeling.epc_map`.
>   - `MoA` (Mechanism of Action), `PE` (Physiologic Effect), `CS` (Chemical Structure): Joined via `labeling.substance_indexing`.
> - **Oracle**:
>   - `EPC`: Matches `druglabel.DGV_SUM_SPL.EPC`.
> - **Question for User**: How are Mechanism of Action (`MoA`), Physiologic Effect (`PE`), and Chemical Structure (`CS`) class hierarchies linked in Oracle FDALabel DB? Is there a `substance_indexing` table in Oracle or a UNII SRS table?

---

### 10. Identifier Search (Set ID, SPL ID, NDC, Application Number, Monograph ID, DEA Schedule, UNII)
> [!IMPORTANT]
> **Clarification Item #5**: UNII & DEA Schedule in Oracle
> - **Postgres**: `set_id`, `spl_id`, `ndc_codes`, `appr_num`, and `labeling.active_ingredients_map.unii`.
> - **Oracle**: `SET_ID`, `SPL_ID`, `NDC_CODES`, `APPR_NUM`.
> - **Question for User**: Are UNII ingredient codes stored in an Oracle table (e.g. `druglabel.SPL_ACTIVE_INGREDIENTS`), or should UNII searches fall back to active ingredient name matches in Oracle?

---

### 11. Chemical Structure Search
> [!IMPORTANT]
> **Clarification Item #6**: Chemical Structure Cartridge in Oracle
> - **Postgres / Local**: Structure search is disabled locally (returns warning).
> - **Oracle**:
> - **Question for User**: Does the internal FDA Oracle DB have an Oracle Chemical Structure Cartridge (e.g., ChemAxon / Bingo / RDKit Oracle Cartridge) for SMILES / Molfile substructure queries?

---

## Action Plan for Execution

1. **Current Status**: All 11 query criteria categories are fully compiled for Local Postgres DB (`/api/labelquery/execute`).
2. **Oracle DB Alignment**: Upon clarification of items #1 - #6 above, `FDALabelDBService` and `compiler.py` will be updated with exact Oracle SQL dialect templates.
