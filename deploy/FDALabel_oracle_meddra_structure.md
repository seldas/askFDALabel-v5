# MedDRA Database Tables: Structure and Query-Development Guide

## 1. Schema overview

The MedDRA terminology tables are stored under the Oracle user/schema `MEDDRA`. Queries should therefore use schema-qualified names such as:

```sql
SELECT *
FROM meddra.low_level_term;
```

The available tables represent the main MedDRA hierarchy:

```text
System Organ Class (SOC)
        |
        v
High Level Grouping Term (HLGT)
        |
        v
High Level Term (HLT)
        |
        v
Preferred Term (PT)
        |
        v
Lowest Level Term (LLT)
```

The schema also includes a denormalized `MEDDRA_HIERARCHY` table that connects PT, HLT, HLGT, and SOC levels in a single row. This table is generally the most efficient option for hierarchy traversal and reporting.

---

## 2. `meddra.soc_term`

### Purpose

Stores MedDRA **System Organ Class (SOC)** terms, the highest level of the MedDRA hierarchy.

### Columns

| Column | Data type | Nullable | Description |
|---|---|---:|---|
| `SOC_CODE` | `NUMBER(38,0)` | No | Numeric MedDRA SOC code. |
| `SOC_NAME` | `VARCHAR2(100 BYTE)` | No | Full SOC name. |
| `SOC_ABBREV` | `VARCHAR2(5 BYTE)` | No | Standard abbreviated SOC name. |

### Typical uses

- Displaying all SOC categories
- Resolving an SOC code to its name
- Grouping adverse-event terms at the broadest MedDRA level
- Joining hierarchy results to a canonical SOC lookup table

### Example

```sql
SELECT
    soc_code,
    soc_name,
    soc_abbrev
FROM meddra.soc_term
ORDER BY soc_name;
```

### Query-development notes

`SOC_CODE` should be treated as the logical identifier for the table. Use exact numeric matching rather than searching by name whenever a code is available.

---

## 3. `meddra.preferred_term`

### Purpose

Stores MedDRA **Preferred Terms (PTs)**. A PT is the primary standardized concept used for coding a distinct symptom, diagnosis, disease, therapeutic indication, investigation, procedure, or related clinical concept.

### Columns

| Column | Data type | Nullable | Description |
|---|---|---:|---|
| `PT_CODE` | `NUMBER(38,0)` | No | Numeric MedDRA PT code. |
| `PT_NAME` | `VARCHAR2(100 BYTE)` | No | Preferred Term name. |
| `PT_SOC_CODE` | `NUMBER(38,0)` | Yes | Code of the PT's primary SOC. |

### Typical uses

- Resolving a PT code to a PT name
- Finding the primary SOC assigned to a PT
- Joining LLTs to their parent PT
- Performing PT-level aggregation of matched LLTs

### Example

```sql
SELECT
    pt.pt_code,
    pt.pt_name,
    pt.pt_soc_code,
    soc.soc_name AS primary_soc_name
FROM meddra.preferred_term pt
LEFT JOIN meddra.soc_term soc
  ON soc.soc_code = pt.pt_soc_code
WHERE pt.pt_code = :pt_code;
```

### Query-development notes

`PT_SOC_CODE` represents the primary SOC relationship. MedDRA is multiaxial, so a PT can appear under more than one SOC in the full hierarchy. Use `MEDDRA_HIERARCHY` when all SOC paths are required.

---

## 4. `meddra.low_level_term`

### Purpose

Stores MedDRA **Lowest Level Terms (LLTs)**. LLTs are the most granular terms in MedDRA and include synonyms, lexical variants, colloquial expressions, and coding-entry terms linked to a PT.

This table is the direct terminology lookup for `SPL_SEC_MEDDRA_LLT_OCC.LLT_CODE` in the FDA labeling schema.

### Columns

| Column | Data type | Nullable | Description |
|---|---|---:|---|
| `LLT_CODE` | `NUMBER(38,0)` | No | Numeric MedDRA LLT code. |
| `LLT_NAME` | `VARCHAR2(100 BYTE)` | No | Lowest Level Term name. |
| `PT_CODE` | `NUMBER(38,0)` | Yes | Parent Preferred Term code. |
| `LLT_CURRENCY` | `VARCHAR2(1 BYTE)` | Yes | Indicator of whether the LLT is current. |

### Typical uses

- Resolving `LLT_CODE` values from text-match occurrence tables
- Mapping matched LLTs to their parent PTs
- Excluding non-current LLTs when desired
- Supporting exact LLT searches

### Example: LLT lookup

```sql
SELECT
    llt_code,
    llt_name,
    pt_code,
    llt_currency
FROM meddra.low_level_term
WHERE llt_code = :llt_code;
```

### Example: LLT to PT mapping

```sql
SELECT
    llt.llt_code,
    llt.llt_name,
    llt.llt_currency,
    pt.pt_code,
    pt.pt_name
FROM meddra.low_level_term llt
LEFT JOIN meddra.preferred_term pt
  ON pt.pt_code = llt.pt_code
WHERE llt.llt_code = :llt_code;
```

### Query-development notes

- `LLT_CODE` is the preferred join column for MedDRA occurrence records.
- `LLT_CURRENCY` should be included when analyses must distinguish current from non-current terminology.
- Do not assume that a non-current LLT is invalid historical data. It may still appear in previously coded or text-matched records.

---

## 5. `meddra.high_level_term`

### Purpose

Stores MedDRA **High Level Terms (HLTs)**.

HLTs group related PTs into clinically meaningful categories below the HLGT level.

### Columns

| Column | Data type | Nullable | Description |
|---|---|---:|---|
| `HLT_CODE` | `NUMBER(38,0)` | No | Numeric MedDRA HLT code. |
| `HLT_NAME` | `VARCHAR2(100 BYTE)` | No | High Level Term name. |

### Typical uses

- Resolving HLT codes returned from `MEDDRA_HIERARCHY`
- HLT-level adverse-event grouping
- Producing hierarchical reports above the PT level

### Example

```sql
SELECT
    hlt_code,
    hlt_name
FROM meddra.high_level_term
WHERE hlt_code = :hlt_code;
```

### Query-development notes

The table does not directly include PT or HLGT foreign keys. Use `MEDDRA_HIERARCHY` to traverse relationships.

---

## 6. `meddra.high_level_grouping_term`

### Purpose

Stores MedDRA **High Level Grouping Terms (HLGTs)**.

HLGTs group related HLTs and sit immediately below the SOC level.

### Columns

| Column | Data type | Nullable | Description |
|---|---|---:|---|
| `HLGT_CODE` | `NUMBER(38,0)` | No | Numeric MedDRA HLGT code. |
| `HLGT_NAME` | `VARCHAR2(100 BYTE)` | No | High Level Grouping Term name. |

### Typical uses

- Resolving HLGT codes
- Aggregating PT- or LLT-level results into broader clinical groups
- Producing SOC/HLGT/HLT/PT hierarchy output

### Example

```sql
SELECT
    hlgt_code,
    hlgt_name
FROM meddra.high_level_grouping_term
WHERE hlgt_code = :hlgt_code;
```

### Query-development notes

As with `HIGH_LEVEL_TERM`, parent-child relationships are not stored directly in this lookup table. Use `MEDDRA_HIERARCHY` for hierarchy traversal.

---

## 7. `meddra.meddra_hierarchy`

### Purpose

Provides a denormalized representation of the MedDRA hierarchy from PT through HLT, HLGT, and SOC.

Each row represents one valid hierarchical path:

```text
PT -> HLT -> HLGT -> SOC
```

Because MedDRA is multiaxial, a PT can appear in more than one row when it belongs to multiple SOC paths.

### Columns

| Column | Data type | Nullable | Description |
|---|---|---:|---|
| `PT_CODE` | `NUMBER(38,0)` | No | Preferred Term code. |
| `HLT_CODE` | `NUMBER(38,0)` | No | High Level Term code. |
| `HLGT_CODE` | `NUMBER(38,0)` | No | High Level Grouping Term code. |
| `SOC_CODE` | `NUMBER(38,0)` | No | System Organ Class code. |
| `PT_NAME` | `VARCHAR2(100 BYTE)` | No | Preferred Term name. |
| `HLT_NAME` | `VARCHAR2(100 BYTE)` | No | High Level Term name. |
| `HLGT_NAME` | `VARCHAR2(100 BYTE)` | No | High Level Grouping Term name. |
| `SOC_NAME` | `VARCHAR2(100 BYTE)` | No | System Organ Class name. |
| `SOC_ABBREV` | `VARCHAR2(5 BYTE)` | No | SOC abbreviation. |
| `PT_SOC_CODE` | `NUMBER(38,0)` | Yes | Primary SOC code assigned to the PT. |
| `PRIMARY_SOC_FG` | `VARCHAR2(1 BYTE)` | Yes | Indicator that the row represents the PT's primary SOC path. |

### Typical uses

- Expanding a PT to its full MedDRA hierarchy
- Retrieving all SOC paths for a PT
- Restricting a result to the primary SOC path
- Aggregating LLT or PT results by HLT, HLGT, or SOC
- Avoiding multiple joins among individual hierarchy lookup tables

### Example: full hierarchy for a PT

```sql
SELECT
    pt_code,
    pt_name,
    hlt_code,
    hlt_name,
    hlgt_code,
    hlgt_name,
    soc_code,
    soc_name,
    soc_abbrev,
    pt_soc_code,
    primary_soc_fg
FROM meddra.meddra_hierarchy
WHERE pt_code = :pt_code
ORDER BY
    CASE WHEN primary_soc_fg = 'Y' THEN 0 ELSE 1 END,
    soc_name,
    hlgt_name,
    hlt_name;
```

### Example: primary hierarchy only

```sql
SELECT
    pt_code,
    pt_name,
    hlt_code,
    hlt_name,
    hlgt_code,
    hlgt_name,
    soc_code,
    soc_name
FROM meddra.meddra_hierarchy
WHERE pt_code = :pt_code
  AND primary_soc_fg = 'Y';
```

### Query-development notes

- Multiple rows per `PT_CODE` are expected because of MedDRA multiaxiality.
- Use `PRIMARY_SOC_FG = 'Y'` when only one hierarchy path per PT is desired.
- Do not use `DISTINCT PT_CODE` without considering whether secondary SOC assignments are analytically relevant.
- `PT_SOC_CODE` should correspond to the PT's primary SOC, while `SOC_CODE` identifies the SOC for the specific hierarchy row.

---

## 8. Logical relationships

```text
meddra.soc_term
    SOC_CODE
       ^
       |
       +------------------------------+
                                      |
meddra.high_level_grouping_term       |
    HLGT_CODE                         |
       ^                              |
       |                              |
meddra.high_level_term                |
    HLT_CODE                          |
       ^                              |
       |                              |
meddra.preferred_term                 |
    PT_CODE                           |
    PT_SOC_CODE ----------------------+
       ^
       |
meddra.low_level_term
    LLT_CODE
    PT_CODE

meddra.meddra_hierarchy
    PT_CODE
    HLT_CODE
    HLGT_CODE
    SOC_CODE
    PT_SOC_CODE
    PRIMARY_SOC_FG
```

The individual term tables provide canonical code-to-name mappings. `MEDDRA_HIERARCHY` provides the parent-child paths that connect PTs to the upper hierarchy.

---

## 9. Integration with FDA labeling MedDRA occurrences

The FDA labeling table `SPL_SEC_MEDDRA_LLT_OCC` contains an `LLT_CODE` identified through section-level text matching.

The primary terminology join is:

```text
SPL_SEC_MEDDRA_LLT_OCC.LLT_CODE
              =
MEDDRA.LOW_LEVEL_TERM.LLT_CODE
```

From the LLT, the parent PT and upper hierarchy can be obtained as follows:

```text
SPL_SEC_MEDDRA_LLT_OCC.LLT_CODE
        -> MEDDRA.LOW_LEVEL_TERM.PT_CODE
        -> MEDDRA.MEDDRA_HIERARCHY.PT_CODE
```

### Example: labeling occurrence with full MedDRA hierarchy

```sql
SELECT
    occ.set_id,
    occ.sec_type_code,
    occ.sec_guid,
    occ.llt_code,
    llt.llt_name,
    llt.llt_currency,
    llt.pt_code,
    mh.pt_name,
    mh.hlt_code,
    mh.hlt_name,
    mh.hlgt_code,
    mh.hlgt_name,
    mh.soc_code,
    mh.soc_name,
    mh.primary_soc_fg,
    occ.start_ix,
    occ.end_ix
FROM druglabel.spl_sec_meddra_llt_occ occ
JOIN meddra.low_level_term llt
  ON llt.llt_code = occ.llt_code
LEFT JOIN meddra.meddra_hierarchy mh
  ON mh.pt_code = llt.pt_code
WHERE occ.llt_code = :llt_code;
```

The FDA-label schema name in this example is illustrative. Use the actual owner of `SPL_SEC_MEDDRA_LLT_OCC` in the target database.

### Primary-SOC version

```sql
SELECT
    occ.set_id,
    occ.sec_type_code,
    occ.sec_guid,
    llt.llt_code,
    llt.llt_name,
    mh.pt_code,
    mh.pt_name,
    mh.hlt_name,
    mh.hlgt_name,
    mh.soc_name,
    occ.start_ix,
    occ.end_ix
FROM druglabel.spl_sec_meddra_llt_occ occ
JOIN meddra.low_level_term llt
  ON llt.llt_code = occ.llt_code
LEFT JOIN meddra.meddra_hierarchy mh
  ON mh.pt_code = llt.pt_code
 AND mh.primary_soc_fg = 'Y'
WHERE occ.set_id = :set_id;
```

---

## 10. Recommended table-selection strategy

| Query requirement | Preferred table |
|---|---|
| Resolve LLT code to term | `meddra.low_level_term` |
| Map LLT to PT | `meddra.low_level_term` joined to `meddra.preferred_term` |
| Resolve PT code to term | `meddra.preferred_term` |
| Get PT primary SOC code | `meddra.preferred_term` |
| Get full PT hierarchy | `meddra.meddra_hierarchy` |
| Get only primary PT hierarchy | `meddra.meddra_hierarchy` with `PRIMARY_SOC_FG = 'Y'` |
| Resolve HLT code | `meddra.high_level_term` |
| Resolve HLGT code | `meddra.high_level_grouping_term` |
| Resolve SOC code | `meddra.soc_term` |
| Map labeling LLT occurrence to hierarchy | `SPL_SEC_MEDDRA_LLT_OCC` -> `meddra.low_level_term` -> `meddra.meddra_hierarchy` |

---

## 11. Query optimization guidance

### 11.1 Start from the most selective code

When the query starts with a known LLT or PT code, filter that code before joining to the hierarchy.

Preferred:

```sql
SELECT ...
FROM meddra.low_level_term llt
JOIN meddra.meddra_hierarchy mh
  ON mh.pt_code = llt.pt_code
WHERE llt.llt_code = :llt_code;
```

Avoid broad joins followed by a late filter.

### 11.2 Use numeric codes for joins

Join using:

- `LLT_CODE`
- `PT_CODE`
- `HLT_CODE`
- `HLGT_CODE`
- `SOC_CODE`

Do not join terminology tables by term names unless a code is unavailable.

### 11.3 Handle multiaxiality explicitly

A PT may have multiple rows in `MEDDRA_HIERARCHY`. Decide whether the query requires:

- All hierarchy paths
- Only the primary SOC path
- One row per PT
- One row per PT-SOC relationship

For one row per PT, use:

```sql
WHERE primary_soc_fg = 'Y'
```

when that flag is consistently populated.

### 11.4 Avoid unnecessary lookup joins

`MEDDRA_HIERARCHY` already contains PT, HLT, HLGT, and SOC names. For hierarchy reports, it is usually unnecessary to join the separate term lookup tables unless validation or additional table-specific attributes are needed.

### 11.5 Filter LLT currency only when analytically appropriate

A current-term-only analysis may apply a predicate such as:

```sql
WHERE llt_currency = 'Y'
```

The actual stored values should be profiled before hard-coding them. Historical labeling matches may legitimately refer to non-current LLTs.

---

## 12. Suggested indexes

The screenshots show table columns but not current indexes. Existing indexes should be reviewed before creating new ones.

Potentially useful indexes include:

```text
MEDDRA.SOC_TERM(SOC_CODE)
MEDDRA.PREFERRED_TERM(PT_CODE)
MEDDRA.PREFERRED_TERM(PT_SOC_CODE)
MEDDRA.LOW_LEVEL_TERM(LLT_CODE)
MEDDRA.LOW_LEVEL_TERM(PT_CODE)
MEDDRA.LOW_LEVEL_TERM(LLT_CURRENCY, PT_CODE)
MEDDRA.HIGH_LEVEL_TERM(HLT_CODE)
MEDDRA.HIGH_LEVEL_GROUPING_TERM(HLGT_CODE)
MEDDRA.MEDDRA_HIERARCHY(PT_CODE)
MEDDRA.MEDDRA_HIERARCHY(PT_CODE, PRIMARY_SOC_FG)
MEDDRA.MEDDRA_HIERARCHY(SOC_CODE, PT_CODE)
```

For integration with labeling occurrences, the most important complementary index is likely:

```text
SPL_SEC_MEDDRA_LLT_OCC(LLT_CODE)
```

or, depending on the common query pattern:

```text
SPL_SEC_MEDDRA_LLT_OCC(LLT_CODE, SET_ID, SEC_TYPE_CODE)
```

---

## 13. Important cautions

### MedDRA version

The displayed tables do not include a MedDRA version column. The schema should be documented with the loaded MedDRA release version because term currency and hierarchy relationships can change between releases.

### Primary SOC flag values

The exact values used in `PRIMARY_SOC_FG` should be verified from the data. Typical systems use `Y`/`N`, but queries should not assume this without checking.

### LLT currency values

The exact values stored in `LLT_CURRENCY` should also be profiled before filtering.

### No visible declared constraints

The screenshots do not show primary-key, unique-key, or foreign-key definitions. The relationships described here are logical relationships inferred from the MedDRA hierarchy and column names. They should be validated against the database metadata.

### Term-name searches

Term names are stored in `VARCHAR2(100 BYTE)`. Case normalization, punctuation, spacing, and Unicode handling should be considered when performing name-based searches.

For exact terminology resolution, code-based queries are preferred.

---

## 14. Practical query templates

### Search LLTs by text

```sql
SELECT
    llt_code,
    llt_name,
    pt_code,
    llt_currency
FROM meddra.low_level_term
WHERE UPPER(llt_name) LIKE UPPER(:term_pattern)
ORDER BY llt_name;
```

### Search PTs by text

```sql
SELECT
    pt_code,
    pt_name,
    pt_soc_code
FROM meddra.preferred_term
WHERE UPPER(pt_name) LIKE UPPER(:term_pattern)
ORDER BY pt_name;
```

### Retrieve LLT, PT, and primary hierarchy

```sql
SELECT
    llt.llt_code,
    llt.llt_name,
    llt.llt_currency,
    mh.pt_code,
    mh.pt_name,
    mh.hlt_code,
    mh.hlt_name,
    mh.hlgt_code,
    mh.hlgt_name,
    mh.soc_code,
    mh.soc_name,
    mh.soc_abbrev
FROM meddra.low_level_term llt
LEFT JOIN meddra.meddra_hierarchy mh
  ON mh.pt_code = llt.pt_code
 AND mh.primary_soc_fg = 'Y'
WHERE llt.llt_code = :llt_code;
```

### Count labeling occurrences by PT

```sql
SELECT
    llt.pt_code,
    mh.pt_name,
    COUNT(*) AS occurrence_count,
    COUNT(DISTINCT occ.set_id) AS label_set_count
FROM druglabel.spl_sec_meddra_llt_occ occ
JOIN meddra.low_level_term llt
  ON llt.llt_code = occ.llt_code
LEFT JOIN meddra.meddra_hierarchy mh
  ON mh.pt_code = llt.pt_code
 AND mh.primary_soc_fg = 'Y'
GROUP BY
    llt.pt_code,
    mh.pt_name
ORDER BY occurrence_count DESC;
```

### Count labeling occurrences by primary SOC

```sql
SELECT
    mh.soc_code,
    mh.soc_name,
    COUNT(*) AS occurrence_count,
    COUNT(DISTINCT occ.set_id) AS label_set_count
FROM druglabel.spl_sec_meddra_llt_occ occ
JOIN meddra.low_level_term llt
  ON llt.llt_code = occ.llt_code
JOIN meddra.meddra_hierarchy mh
  ON mh.pt_code = llt.pt_code
 AND mh.primary_soc_fg = 'Y'
GROUP BY
    mh.soc_code,
    mh.soc_name
ORDER BY occurrence_count DESC;
```

---

## 15. Summary

The `MEDDRA` schema provides both normalized terminology lookup tables and a denormalized hierarchy table:

- `meddra.low_level_term` resolves LLT matches and maps LLTs to PTs.
- `meddra.preferred_term` provides PT names and primary SOC codes.
- `meddra.high_level_term` provides HLT names.
- `meddra.high_level_grouping_term` provides HLGT names.
- `meddra.soc_term` provides SOC names and abbreviations.
- `meddra.meddra_hierarchy` provides complete PT-to-SOC paths and identifies the primary SOC path.

For FDA labeling queries, the preferred workflow is:

```text
SPL section LLT occurrence
    -> MEDDRA.LOW_LEVEL_TERM
    -> MEDDRA.MEDDRA_HIERARCHY
```

This design supports efficient conversion of section-level LLT text matches into PT, HLT, HLGT, and SOC concepts while preserving MedDRA multiaxial relationships.
