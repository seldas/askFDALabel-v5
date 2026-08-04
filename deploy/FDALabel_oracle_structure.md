# FDA Label Database Structure and Query-Development Guide

## 1. Database overview

The database is organized around **Structured Product Labeling (SPL) documents**. Its tables support four main query layers:

1. **Document-level summary and filtering**

   * `SUM_SPL`
   * `DGV_SUM_RX_SPL`

2. **Raw SPL XML and section-level content**

   * `SPL`
   * `ARCHIVED_SPL`
   * `SPL_SEC`
   * `SPL_SEC_HIGHLIGHT`

3. **Normalized product, ingredient, route, application, and terminology data**

   * `SPL_PROD`
   * `SUM_SPL_GEN_PROD_ACT_INGR_UNII`
   * `SUM_SPL_ROUTE`
   * `SUM_SPL_RLD`
   * `SUM_SPL_RLD_RS`
   * `SPL_INITIAL_APP`
   * `SECTION_TYPE`
   * `DEA_SCHEDULE`
   * `UNII_CHEM_STRUCT`

4. **Section-level MedDRA term occurrences**

   * `SPL_SEC_MEDDRA_LLT_OCC`

For query optimization, searches should normally begin with a summary or normalized table to identify a small set of `SPL_ID` values. Raw XML should be accessed only after the candidate document set has been narrowed.

---

# 2. Core identifiers

Several identifiers appear throughout the schema.

| Identifier                   | Meaning and use                                                                                                                                 |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `SPL_ID`                     | Numeric internal identifier for an SPL document. This is the principal join key across most current-document tables.                            |
| `SET_ID`                     | Persistent identifier for a labeling set across multiple versions. Use it for version history and current-versus-previous labeling comparisons. |
| `SPL_GUID` / `GUID`          | Document-level or section-level globally unique identifier. The exact semantic role depends on the table.                                       |
| `SPL_MD5`                    | Hash of the SPL XML or document content. Useful for duplicate detection and change identification.                                              |
| `VERSION_NUM`                | Version number within an SPL set.                                                                                                               |
| `EFF_TIME`                   | SPL effective time, stored as character data.                                                                                                   |
| `ARCHIVE_DIR` and `FILENAME` | Physical or logical source location of the SPL XML file.                                                                                        |
| `LOINC_CODE`                 | LOINC identifier for a labeling section.                                                                                                        |
| `SEC_GUID`                   | Unique identifier for an individual SPL section.                                                                                                |
| `UNII`                       | Unique Ingredient Identifier.                                                                                                                   |
| `APPL_NO` / `APPR_NUM`       | Application or approval number associated with the labeling.                                                                                    |

Because the screenshots show column definitions rather than constraints, the precise primary keys and foreign keys should be confirmed from the database metadata before relying on enforced referential integrity.

---

# 3. Document-level summary tables

## 3.1 `SUM_SPL`

### Purpose

`SUM_SPL` is the primary **FDA-wide document summary table**. It contains one summarized record per SPL document and is intended for fast document discovery without parsing the raw XML.

It should be the preferred starting point for broad FDA labeling queries involving:

* Label title
* Document type
* Manufacturer or author organization
* Product names
* Generic names
* Marketing category
* Route of administration
* NDC
* Dosage form
* Active ingredients
* Application numbers
* Reference-listed-drug status
* Initial approval year
* Revised date
* Establishment or product category information

### Important columns

| Column                        | Description                                    |
| ----------------------------- | ---------------------------------------------- |
| `SPL_ID`                      | Internal document identifier; non-null.        |
| `SPL_GUID`                    | SPL document GUID.                             |
| `TITLE`                       | Document title.                                |
| `SPL_MD5`                     | Content hash.                                  |
| `DOCUMENT_TYPE_LOINC_CODE`    | LOINC code representing the SPL document type. |
| `DOCUMENT_TYPE`               | Human-readable document type.                  |
| `AUTHOR_ORG_NORMD_NAME`       | Normalized author or organization name.        |
| `NUM_PRODUCTS`                | Number of products represented in the label.   |
| `NUM_GENERIC_PRODUCTS`        | Number of normalized generic products.         |
| `MARKETING_ACTS`              | Aggregated marketing information.              |
| `PRODUCT_NAMES`               | Aggregated product names.                      |
| `PRODUCT_NORMD_GENERIC_NAMES` | Aggregated normalized generic names.           |
| `MARKET_CATEGORIES`           | Aggregated marketing categories.               |
| `ROUTES_OF_ADMINISTRATION`    | Aggregated routes.                             |
| `NDC_CODES`                   | Aggregated NDC values.                         |
| `DOSAGE_FORMS`                | Aggregated dosage forms.                       |
| `NUM_ACT_INGRS`               | Number of active ingredients.                  |
| `ACT_INGR_UNIIS`              | Aggregated active-ingredient UNIIs.            |
| `ACT_INGR_NAMES`              | Aggregated active-ingredient names.            |
| `DAILYMED_NDC_LINKS`          | DailyMed-related NDC links.                    |
| `ARCHIVE_DIR`                 | Source archive directory.                      |
| `FILENAME`                    | Source SPL filename.                           |
| `EFF_TIME`                    | Effective time from the SPL document.          |
| `VERSION_NUM`                 | SPL version number.                            |
| `ARCHIVE_DIR_DATE`            | Date associated with the archive directory.    |
| `SET_ID`                      | Persistent labeling-set identifier.            |
| `ORG_CURRENCY_RANK`           | Organization/document currency ranking.        |
| `INITIAL_APPROVAL_YEAR`       | Initial approval year.                         |
| `REVISED_DATE`                | Label revision date.                           |
| `PRODUCT_TITLE`               | Aggregated or standardized product title.      |
| `EPC`                         | Established pharmacologic class information.   |
| `ACT_MOIETY_UNIIS`            | Active-moiety UNIIs.                           |
| `ACT_MOIETY_NAMES`            | Active-moiety names.                           |
| `APPR_NUM`                    | Approval/application numbers.                  |
| `RLD_NUM`                     | Reference-listed-drug numbers or indicators.   |
| `MEDDRA_SUPPORTED`            | Indicator of MedDRA processing support.        |
| `NDC3_CODES`                  | Aggregated three-segment NDC codes.            |

### Query-development guidance

Use `SUM_SPL` when:

* Searching across all FDA SPL document types
* Returning a document-level result set
* Filtering labels by metadata before retrieving XML
* Building search result pages or label catalogs
* Identifying `SPL_ID`, `SET_ID`, or `SPL_GUID` for subsequent joins

Several fields contain aggregated multi-value data in `VARCHAR2(4000)` columns. These fields are useful for display and preliminary search, but normalized tables should be preferred for exact matching.

For example, an exact route search should generally use `SUM_SPL_ROUTE` rather than:

```sql
WHERE ROUTES_OF_ADMINISTRATION LIKE '%ORAL%'
```

Similarly, exact ingredient searches should favor `SUM_SPL_GEN_PROD_ACT_INGR_UNII` or `SPL_PROD` over text matching in `ACT_INGR_NAMES`.

---

## 3.2 `DGV_SUM_RX_SPL`

### Purpose

`DGV_SUM_RX_SPL` is the **CDER-CBER prescription-label summary table**. It contains data comparable to `SUM_SPL`, but is designed for CDER/CBER use and includes information supporting differentiation of **PLR and non-PLR label formats**.

The `FORMAT_GROUP` column appears to provide the label-format grouping used for this distinction.

### Main differences from `SUM_SPL`

* Includes `FORMAT_GROUP`
* Focuses on the CDER-CBER prescription-labeling population
* Contains PLR/non-PLR-related classification
* Does not show some columns present in `SUM_SPL`, such as:

  * `ACT_MOIETY_UNIIS`
  * `ACT_MOIETY_NAMES`
  * `MEDDRA_SUPPORTED`
* Column lengths differ for some fields, such as `ARCHIVE_DIR_DATE`

### Important columns

Most columns have the same conceptual meaning as their `SUM_SPL` counterparts:

* `FORMAT_GROUP`
* `SPL_ID`
* `SPL_GUID`
* `TITLE`
* `SPL_MD5`
* `DOCUMENT_TYPE_LOINC_CODE`
* `DOCUMENT_TYPE`
* `AUTHOR_ORG_NORMD_NAME`
* Product, generic-name, route, dosage-form, ingredient, application, and RLD summary fields
* `SET_ID`
* `VERSION_NUM`
* `EFF_TIME`
* `ORG_CURRENCY_RANK`

### Query-development guidance

Use `DGV_SUM_RX_SPL` when:

* The analysis is limited to CDER/CBER prescription labels
* PLR versus non-PLR format is relevant
* The query should use the curated CDER-CBER labeling population
* Prescription-label format consistency is important

Use `SUM_SPL` when the intended scope is the broader FDA labeling collection.

Avoid joining `SUM_SPL` and `DGV_SUM_RX_SPL` solely to retrieve fields that exist in both. Select the summary table that corresponds to the intended regulatory scope.

---

# 4. Raw XML tables

## 4.1 `SPL`

### Purpose

`SPL` stores the **complete raw XML for the current or active SPL document record**.

### Columns

| Column                   | Description                                           |
| ------------------------ | ----------------------------------------------------- |
| `ID`                     | Internal numeric record identifier; non-null.         |
| `ARCHIVE_DIR`            | Source archive directory.                             |
| `FILENAME`               | SPL source filename.                                  |
| `SPL_XML`                | Complete SPL document stored as `XMLTYPE`.            |
| `SPL_MD5`                | XML content hash.                                     |
| `LOADED_TS`              | Database load timestamp; defaults to `SYSTIMESTAMP`.  |
| `CREATED_LOAD_NUM`       | Load or batch number associated with record creation. |
| `AUTHOR_ORG`             | Original author organization.                         |
| `TITLE`                  | Original SPL title.                                   |
| `NORMD_ORG`              | Normalized organization name.                         |
| `DOC_TYPE_LOINC_CODE`    | Document-type LOINC code.                             |
| `DOC_TYPE_NAME_FROM_MFR` | Manufacturer-provided document type name.             |
| `EFF_TIME`               | Effective time.                                       |
| `VERSION_NUM`            | Version number.                                       |
| `SET_ID`                 | Persistent labeling-set identifier; non-null.         |
| `GUID`                   | SPL document GUID.                                    |

### Query-development guidance

Use `SPL` when:

* The complete XML document is required
* A data element is unavailable in the summary or normalized tables
* XML structure, attributes, or nested elements must be examined
* A document must be exported or reconstructed

Do not use `SPL_XML` as the first step for large document searches. XML evaluation is generally more expensive than filtering on relational columns.

Preferred pattern:

```sql
SELECT s.spl_xml
FROM spl s
JOIN sum_spl ss
  ON ss.spl_id = s.id
WHERE ss.set_id = :set_id;
```

This assumes `SUM_SPL.SPL_ID = SPL.ID`, which should be validated against actual database constraints or sample data.

---

## 4.2 `ARCHIVED_SPL`

### Purpose

`ARCHIVED_SPL` stores archived or historical SPL XML records.

### Columns

| Column                   | Description                                 |
| ------------------------ | ------------------------------------------- |
| `ARCHIVED_LOAD_NUM`      | Load number associated with archival.       |
| `ID`                     | Internal SPL record identifier.             |
| `ARCHIVE_DIR`            | Archive directory.                          |
| `FILENAME`               | SPL filename.                               |
| `SPL_XML`                | Complete archived XML document.             |
| `SPL_MD5`                | Content hash.                               |
| `LOADED_TS`              | Load timestamp; defaults to `SYSTIMESTAMP`. |
| `CREATED_LOAD_NUM`       | Original load number.                       |
| `AUTHOR_ORG`             | Author organization.                        |
| `TITLE`                  | SPL title.                                  |
| `NORMD_ORG`              | Normalized organization.                    |
| `DOC_TYPE_LOINC_CODE`    | Document-type LOINC code.                   |
| `DOC_TYPE_NAME_FROM_MFR` | Manufacturer-supplied document-type name.   |
| `EFF_TIME`               | Effective time.                             |
| `VERSION_NUM`            | Version number.                             |
| `SET_ID`                 | Persistent label-set identifier.            |
| `GUID`                   | SPL document GUID.                          |

### Query-development guidance

Use `ARCHIVED_SPL` for:

* Historical version retrieval
* Label-change analysis
* Audit and provenance review
* Recovery of documents no longer present in the current `SPL` table

For version-history queries, filter first by `SET_ID`, then order by a reliable version field:

```sql
SELECT
    set_id,
    version_num,
    eff_time,
    spl_md5,
    loaded_ts
FROM archived_spl
WHERE set_id = :set_id
ORDER BY version_num DESC, loaded_ts DESC;
```

Because `EFF_TIME` is stored as character data, direct date comparisons may not be reliable without explicit conversion.

---

# 5. Section-level tables

## 5.1 `SPL_SEC`

### Purpose

`SPL_SEC` stores the XML content of individual labeling sections. It is the preferred table for **section-level content retrieval and section-constrained text searches**.

Using this table avoids repeatedly parsing an entire SPL document when only one section is needed.

### Columns

| Column            | Description                                     |
| ----------------- | ----------------------------------------------- |
| `ID`              | Internal section record identifier; non-null.   |
| `SPL_ID`          | Parent SPL document identifier.                 |
| `LOINC_CODE`      | Section-type LOINC code.                        |
| `CONTENT_XML`     | XML content of the section.                     |
| `GUID`            | Section GUID.                                   |
| `TITLE`           | Processed or displayed section title.           |
| `PARENT_SEC_GUID` | GUID of the parent section for nested sections. |
| `ORIG_TITLE`      | Original title as represented in the SPL.       |

### Logical relationships

```text
SPL or SUM_SPL
    |
    | SPL_ID
    v
SPL_SEC
```

Nested section hierarchy can be represented through:

```text
SPL_SEC.GUID
    |
    | referenced by
    v
SPL_SEC.PARENT_SEC_GUID
```

### Query-development guidance

Use `SPL_SEC` when:

* Searching only a specific labeling section
* Retrieving boxed warning, warnings and precautions, adverse reactions, indications, or another LOINC-defined section
* Processing section XML independently
* Reconstructing section hierarchy

Preferred pattern:

```sql
SELECT
    sec.spl_id,
    sec.loinc_code,
    sec.title,
    sec.content_xml
FROM spl_sec sec
WHERE sec.loinc_code = :section_loinc_code
  AND sec.spl_id IN (
      SELECT ss.spl_id
      FROM dgv_sum_rx_spl ss
      WHERE ss.format_group = :format_group
  );
```

For section searches, filter by `LOINC_CODE` and `SPL_ID` before applying XML or text functions to `CONTENT_XML`.

---

## 5.2 `SPL_SEC_HIGHLIGHT`

### Purpose

`SPL_SEC_HIGHLIGHT` stores section-level highlight content.

### Columns

| Column                  | Description                             |
| ----------------------- | --------------------------------------- |
| `ID`                    | Internal record identifier; non-null.   |
| `SPL_ID`                | Parent SPL document identifier.         |
| `LOINC_CODE`            | LOINC code for the highlighted section. |
| `HIGHLIGHT_CONTENT_XML` | Highlight XML content.                  |

### Query-development guidance

Use this table when the query specifically requires **Highlights of Prescribing Information** rather than the full corresponding section body.

This prevents unnecessary XML extraction from the complete SPL document.

---

## 5.3 `SECTION_TYPE`

### Purpose

`SECTION_TYPE` is a lookup table that maps section LOINC codes to human-readable section names.

### Columns

| Column       | Description                   |
| ------------ | ----------------------------- |
| `LOINC_CODE` | Section LOINC code; non-null. |
| `LOINC_NAME` | Human-readable section name.  |

### Typical join

```sql
SELECT
    sec.spl_id,
    sec.loinc_code,
    st.loinc_name,
    sec.title
FROM spl_sec sec
LEFT JOIN section_type st
  ON st.loinc_code = sec.loinc_code;
```

Use this lookup for presentation and reporting instead of embedding section-name mappings in application code.

---

# 6. MedDRA section-occurrence table

## `SPL_SEC_MEDDRA_LLT_OCC`

### Purpose

`SPL_SEC_MEDDRA_LLT_OCC` records occurrences of MedDRA **Lowest Level Terms (LLTs)** identified through text matching in SPL sections.

It connects:

* A labeling set
* A section type
* A section instance
* A MedDRA LLT
* The start and end character positions of the occurrence

### Columns

| Column          | Description                                                                                                                                       |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SET_ID`        | SPL set identifier; non-null.                                                                                                                     |
| `SEC_TYPE_CODE` | Section-type code; non-null. This likely corresponds to a section classification or LOINC-related code, but the exact mapping should be verified. |
| `SEC_GUID`      | GUID of the matching section; non-null.                                                                                                           |
| `LLT_CODE`      | MedDRA Lowest Level Term code; non-null.                                                                                                          |
| `START_IX`      | Starting position of the matched text; non-null.                                                                                                  |
| `END_IX`        | Ending position of the matched text; non-null.                                                                                                    |

### Intended use

Use this table for:

* Finding labels containing a MedDRA concept
* Finding which sections contain the concept
* Counting term occurrences
* Highlighting the matched text in a section
* Supporting terminology-driven safety-label analyses

### Logical relationship

The likely section-level relationship is:

```text
SPL_SEC_MEDDRA_LLT_OCC.SEC_GUID
              =
SPL_SEC.GUID
```

The document-level relationship is likely:

```text
SPL_SEC_MEDDRA_LLT_OCC.SET_ID
              =
SPL.SET_ID / SUM_SPL.SET_ID
```

These relationships should be confirmed from actual data because the screenshots do not show declared foreign keys.

### Recommended query pattern

Start with the MedDRA table when the LLT is the principal search criterion:

```sql
SELECT DISTINCT
    ss.spl_id,
    ss.set_id,
    ss.title,
    occ.llt_code,
    occ.sec_type_code,
    occ.sec_guid
FROM spl_sec_meddra_llt_occ occ
JOIN sum_spl ss
  ON ss.set_id = occ.set_id
WHERE occ.llt_code = :llt_code;
```

When exact text positions are needed:

```sql
SELECT
    occ.set_id,
    occ.sec_guid,
    occ.llt_code,
    occ.start_ix,
    occ.end_ix,
    sec.content_xml
FROM spl_sec_meddra_llt_occ occ
JOIN spl_sec sec
  ON sec.guid = occ.sec_guid
WHERE occ.llt_code = :llt_code;
```

Care is needed when joining through `SET_ID`: a set may contain multiple versions. The query may need an additional current-version rule, such as `ORG_CURRENCY_RANK`, maximum `VERSION_NUM`, or another authoritative current-label indicator.

---

# 7. Product and ingredient tables

## 7.1 `SPL_PROD`

### Purpose

`SPL_PROD` provides one row per product represented in an SPL document. It supports product-level filtering without parsing product elements from the raw XML.

### Columns

| Column               | Description                                   |
| -------------------- | --------------------------------------------- |
| `ID`                 | Internal product-record identifier; non-null. |
| `SPL_ID`             | Parent SPL document identifier; non-null.     |
| `NORMD_GENERIC_NAME` | Normalized generic name.                      |
| `NAME`               | Product name.                                 |
| `GENERIC_NAME`       | Generic name as represented in the document.  |
| `NDC_CODE`           | NDC code.                                     |
| `NCIT_FORM_CODE`     | NCIt dosage-form code.                        |
| `NCIT_FORM_NAME`     | NCIt dosage-form name.                        |
| `DOC_ORDER`          | Product order within the document; non-null.  |

### Query-development guidance

Use `SPL_PROD` for:

* Exact or product-level name matching
* NDC filtering
* Dosage-form filtering
* Returning individual products from multi-product labels
* Preserving document order

Example:

```sql
SELECT
    p.spl_id,
    p.doc_order,
    p.name,
    p.normd_generic_name,
    p.ndc_code,
    p.ncit_form_name
FROM spl_prod p
WHERE p.normd_generic_name = :generic_name;
```

This is preferable to searching the aggregated `SUM_SPL.PRODUCT_NORMD_GENERIC_NAMES` column when exact product-level results are required.

---

## 7.2 `SUM_SPL_GEN_PROD_ACT_INGR_UNII`

### Purpose

This table associates a document-level normalized generic product with an active-ingredient UNII.

### Columns

| Column                       | Description                                |
| ---------------------------- | ------------------------------------------ |
| `SPL_ID`                     | Parent SPL document identifier; non-null.  |
| `PRODUCT_NORMD_GENERIC_NAME` | Normalized generic product name; non-null. |
| `UNII`                       | Active-ingredient UNII; non-null.          |

### Query-development guidance

Use this table for:

* Exact UNII-to-label searches
* Mapping normalized generic products to active ingredients
* Multi-ingredient product analysis
* Avoiding substring searches in aggregated ingredient columns

Example:

```sql
SELECT DISTINCT
    ss.spl_id,
    ss.title,
    ai.product_normd_generic_name,
    ai.unii
FROM sum_spl_gen_prod_act_ingr_unii ai
JOIN sum_spl ss
  ON ss.spl_id = ai.spl_id
WHERE ai.unii = :unii;
```

---

## 7.3 `UNII_CHEM_STRUCT`

### Purpose

`UNII_CHEM_STRUCT` maps a UNII to a chemical structure represented as SMILES.

### Columns

| Column   | Description                             |
| -------- | --------------------------------------- |
| `UNII`   | Unique Ingredient Identifier; non-null. |
| `SMILES` | Chemical structure string.              |

### Query-development guidance

Use this table after ingredient identification, not as the starting point for general label searches.

Typical relationship:

```text
SUM_SPL_GEN_PROD_ACT_INGR_UNII.UNII
                    =
UNII_CHEM_STRUCT.UNII
```

Example:

```sql
SELECT
    ai.spl_id,
    ai.product_normd_generic_name,
    ai.unii,
    cs.smiles
FROM sum_spl_gen_prod_act_ingr_unii ai
LEFT JOIN unii_chem_struct cs
  ON cs.unii = ai.unii
WHERE ai.spl_id = :spl_id;
```

---

# 8. Route table

## `SUM_SPL_ROUTE`

### Purpose

`SUM_SPL_ROUTE` provides normalized route-of-administration data at the SPL-document level.

### Columns

| Column                      | Description                                  |
| --------------------------- | -------------------------------------------- |
| `SPL_ID`                    | Parent SPL document identifier; non-null.    |
| `NCIT_ROUTE_OF_ADMIN_CODE`  | NCIt route-of-administration code; non-null. |
| `ROUTE_SPL_ACCEPTABLE_TERM` | SPL acceptable route term.                   |

### Query-development guidance

Use this table for exact route filtering rather than searching the aggregated route string in `SUM_SPL`.

```sql
SELECT DISTINCT
    ss.spl_id,
    ss.title,
    r.ncit_route_of_admin_code,
    r.route_spl_acceptable_term
FROM sum_spl_route r
JOIN sum_spl ss
  ON ss.spl_id = r.spl_id
WHERE r.ncit_route_of_admin_code = :route_code;
```

---

# 9. Application, RLD, and reference-standard tables

## 9.1 `SUM_SPL_RLD`

### Purpose

`SUM_SPL_RLD` captures application-level Reference Listed Drug information.

### Columns

| Column                      | Description                                         |
| --------------------------- | --------------------------------------------------- |
| `SPL_ID`                    | SPL document identifier; non-null.                  |
| `MARKETING_CAT_NCIT_CODE`   | NCIt marketing-category code; non-null.             |
| `MARKETING_CAT_DESCRIPTION` | Marketing-category description; non-null.           |
| `APPL_NO`                   | Application number; non-null.                       |
| `RLD`                       | Reference Listed Drug value or indicator; non-null. |

### Use

Use for exact application-level RLD filtering instead of searching the summarized `RLD_NUM` field.

---

## 9.2 `SUM_SPL_RLD_RS`

### Purpose

`SUM_SPL_RLD_RS` provides both Reference Listed Drug and Reference Standard information.

### Columns

| Column                      | Description                                      |
| --------------------------- | ------------------------------------------------ |
| `SPL_ID`                    | SPL document identifier; non-null.               |
| `MARKETING_CAT_NCIT_CODE`   | Marketing-category NCIt code; non-null.          |
| `MARKETING_CAT_DESCRIPTION` | Marketing-category description; non-null.        |
| `APPL_NO`                   | Application number; non-null.                    |
| `REFERENCE_DRUG`            | Reference-drug indicator or value; non-null.     |
| `REFERENCE_STANDARD`        | Reference-standard indicator or value; non-null. |

### Use

Use `SUM_SPL_RLD_RS` when both RLD and reference-standard status are required. Use `SUM_SPL_RLD` when only the simpler RLD representation is needed.

---

## 9.3 `SPL_INITIAL_APP`

### Purpose

`SPL_INITIAL_APP` contains derived document-level approval and revision information.

### Columns

| Column                  | Description              |
| ----------------------- | ------------------------ |
| `SPL_ID`                | SPL document identifier. |
| `TITLE`                 | Label title.             |
| `EFF_TIME`              | Effective time.          |
| `PRODUCT_TITLE`         | Product title.           |
| `INITIAL_APPROVAL_YEAR` | Initial approval year.   |
| `REVISED_DATE`          | Revised date.            |

### Query-development guidance

Use for approval-year and revision-date reporting when these fields are the main analytical focus. Because all columns are nullable, data completeness should be assessed before applying restrictive filters.

---

# 10. Terminology lookup table

## `DEA_SCHEDULE`

### Purpose

`DEA_SCHEDULE` maps an NCI Thesaurus code to an SPL acceptable term for DEA schedule classifications.

### Columns

| Column                | Description                                  |
| --------------------- | -------------------------------------------- |
| `NCI_THESAURUS_CODE`  | NCI Thesaurus code; non-null.                |
| `SPL_ACCEPTABLE_TERM` | Corresponding SPL acceptable term; non-null. |

This is a lookup table and does not itself contain `SPL_ID`. It must be connected through another table or XML-derived field containing the relevant terminology code.

---

# 11. Recommended table-selection strategy

| Query requirement                  | Preferred table                  |
| ---------------------------------- | -------------------------------- |
| General FDA label search           | `SUM_SPL`                        |
| CDER/CBER prescription labels      | `DGV_SUM_RX_SPL`                 |
| PLR versus non-PLR filtering       | `DGV_SUM_RX_SPL`                 |
| Complete current SPL XML           | `SPL`                            |
| Historical SPL XML                 | `ARCHIVED_SPL`                   |
| Section-specific content           | `SPL_SEC`                        |
| Highlights content                 | `SPL_SEC_HIGHLIGHT`              |
| Section name from LOINC            | `SECTION_TYPE`                   |
| Product-level name or NDC          | `SPL_PROD`                       |
| Exact active-ingredient UNII       | `SUM_SPL_GEN_PROD_ACT_INGR_UNII` |
| Chemical structure by UNII         | `UNII_CHEM_STRUCT`               |
| Exact route filtering              | `SUM_SPL_ROUTE`                  |
| RLD status                         | `SUM_SPL_RLD`                    |
| RLD and reference-standard status  | `SUM_SPL_RLD_RS`                 |
| Initial approval or revision date  | `SPL_INITIAL_APP`                |
| MedDRA LLT occurrence in a section | `SPL_SEC_MEDDRA_LLT_OCC`         |
| DEA schedule terminology mapping   | `DEA_SCHEDULE`                   |

---

# 12. Recommended query-development workflow

## Step 1: Define the label population

Use either:

```sql
FROM sum_spl
```

or:

```sql
FROM dgv_sum_rx_spl
```

Select `DGV_SUM_RX_SPL` for CDER/CBER prescription-label analyses and PLR/non-PLR classification. Select `SUM_SPL` for FDA-wide queries.

## Step 2: Filter using relational metadata

Apply selective filters such as:

* `SPL_ID`
* `SET_ID`
* `DOCUMENT_TYPE_LOINC_CODE`
* `FORMAT_GROUP`
* `AUTHOR_ORG_NORMD_NAME`
* `VERSION_NUM`
* `INITIAL_APPROVAL_YEAR`

## Step 3: Join normalized child tables

Use normalized tables for exact matching:

* `SPL_PROD` for product and NDC
* `SUM_SPL_ROUTE` for route
* `SUM_SPL_GEN_PROD_ACT_INGR_UNII` for ingredient UNII
* `SUM_SPL_RLD_RS` for reference status
* `SPL_SEC_MEDDRA_LLT_OCC` for MedDRA concepts

## Step 4: Retrieve section content

Join to `SPL_SEC` only after narrowing the SPL population.

## Step 5: Retrieve full XML only when necessary

Access `SPL.SPL_XML` after the query has identified the required documents.

---

# 13. Performance and indexing recommendations

The following are logical recommendations based on the visible structure. Existing indexes and execution plans should be reviewed before creating new indexes.

## High-priority join indexes

Consider indexes on:

```text
SUM_SPL(SPL_ID)
SUM_SPL(SET_ID)
DGV_SUM_RX_SPL(SPL_ID)
DGV_SUM_RX_SPL(SET_ID)
SPL(ID)
SPL(SET_ID)
ARCHIVED_SPL(SET_ID, VERSION_NUM)
SPL_SEC(SPL_ID)
SPL_SEC(GUID)
SPL_SEC(LOINC_CODE, SPL_ID)
SPL_PROD(SPL_ID)
SUM_SPL_ROUTE(SPL_ID)
SUM_SPL_GEN_PROD_ACT_INGR_UNII(SPL_ID)
```

## Search-oriented indexes

Depending on query frequency:

```text
DGV_SUM_RX_SPL(FORMAT_GROUP, SPL_ID)
SPL_PROD(NORMD_GENERIC_NAME)
SPL_PROD(NDC_CODE)
SUM_SPL_ROUTE(NCIT_ROUTE_OF_ADMIN_CODE, SPL_ID)
SUM_SPL_GEN_PROD_ACT_INGR_UNII(UNII, SPL_ID)
SUM_SPL_RLD_RS(APPL_NO, SPL_ID)
SPL_SEC_MEDDRA_LLT_OCC(LLT_CODE, SET_ID)
SPL_SEC_MEDDRA_LLT_OCC(SEC_GUID)
```

For MedDRA queries, a useful composite index may be:

```sql
CREATE INDEX ...
ON spl_sec_meddra_llt_occ
   (llt_code, sec_type_code, set_id);
```

The optimal column order depends on which predicates are most selective and most frequently used.

## XML indexing

If XML predicates are frequently applied to `SPL_XML`, `CONTENT_XML`, or `HIGHLIGHT_CONTENT_XML`, evaluate appropriate Oracle XML indexing. However, relational extraction or precomputed search columns will often outperform repeated broad XML evaluation.

## Text indexing

For unstructured section-text search, consider extracting searchable text from `CONTENT_XML` into a dedicated text column or search index. Do not repeatedly convert every `XMLTYPE` value to text in a full-table query.

---

# 14. Important query-design cautions

### Aggregated fields

Many `SUM_SPL` and `DGV_SUM_RX_SPL` fields contain multiple values concatenated into `VARCHAR2(4000)`. A predicate such as:

```sql
WHERE ACT_INGR_NAMES LIKE '%ASPIRIN%'
```

can introduce:

* False-positive substring matches
* Poor index utilization
* Ambiguity in multi-product records
* Inability to preserve product-to-ingredient relationships

Use normalized tables wherever possible.

### Version duplication

`SET_ID` identifies the label family, while `SPL_ID` identifies a particular document/version. Joining only by `SET_ID` can produce multiple versions.

A query should explicitly define whether it needs:

* Every historical version
* The most recent version
* The current version according to `ORG_CURRENCY_RANK`
* A specific `VERSION_NUM`
* A specific `EFF_TIME`

### Character-based dates

Fields such as `EFF_TIME`, `REVISED_DATE`, and `INITIAL_APPROVAL_YEAR` are stored as character values in several tables. Validate formats before converting:

```sql
TO_DATE(revised_date, 'YYYYMMDD')
```

Do not assume every row uses an identical date representation without profiling the data.

### GUID semantics

The database contains several GUID fields:

* Document GUID in `SPL`
* `SPL_GUID` in summary tables
* Section `GUID` in `SPL_SEC`
* `SEC_GUID` in the MedDRA occurrence table

They should not be treated as interchangeable.

### Nullable relationships

Many join columns are nullable. Use inner joins only when the query requires a matching child record. Use left joins when summary documents must be retained even if normalized data is unavailable.

---

# 15. Conceptual relationship map

```text
                         +----------------------+
                         |     SECTION_TYPE     |
                         | LOINC_CODE            |
                         | LOINC_NAME            |
                         +-----------+----------+
                                     |
                                     | LOINC_CODE
                                     |
+------------------+       +---------v---------+
|     SUM_SPL      |       |      SPL_SEC      |
| FDA-wide summary |       | section XML       |
| SPL_ID           +-------> SPL_ID             |
| SET_ID           |       | GUID               |
+--------+---------+       | PARENT_SEC_GUID    |
         |                 +---------+----------+
         | SPL_ID                    |
         |                           | SEC_GUID / GUID
         |                 +---------v------------------+
         |                 | SPL_SEC_MEDDRA_LLT_OCC     |
         |                 | SET_ID                     |
         |                 | LLT_CODE                   |
         |                 | START_IX / END_IX          |
         |                 +----------------------------+
         |
         +---------------------> SPL_PROD
         |                       product/NDC/form
         |
         +---------------------> SUM_SPL_ROUTE
         |                       normalized route
         |
         +---------------------> SUM_SPL_GEN_PROD_ACT_INGR_UNII
         |                                      |
         |                                      | UNII
         |                                      v
         |                             UNII_CHEM_STRUCT
         |
         +---------------------> SUM_SPL_RLD
         |
         +---------------------> SUM_SPL_RLD_RS
         |
         +---------------------> SPL_INITIAL_APP
         |
         v
+------------------+
|       SPL        |
| complete XML     |
| ID               |
| SET_ID           |
| SPL_XML          |
+------------------+

+------------------------+
|   DGV_SUM_RX_SPL       |
| CDER/CBER summary      |
| PLR/non-PLR grouping   |
| FORMAT_GROUP           |
| SPL_ID / SET_ID        |
+------------------------+

+------------------------+
|     ARCHIVED_SPL       |
| historical SPL XML     |
| SET_ID / VERSION_NUM   |
+------------------------+
```

## Summary

The schema follows a useful layered design:

* **`SUM_SPL` and `DGV_SUM_RX_SPL`** identify and filter documents.
* **Normalized child tables** support exact product, route, ingredient, application, and terminology queries.
* **`SPL_SEC`** supports efficient section-level retrieval and text analysis.
* **`SPL_SEC_MEDDRA_LLT_OCC`** supports terminology-based section searches and match localization.
* **`SPL` and `ARCHIVED_SPL`** provide full current and historical XML when detailed document processing is necessary.

The central optimization principle is:

> Filter with summary and normalized relational tables first, retrieve section XML second, and access whole-document XML last.
