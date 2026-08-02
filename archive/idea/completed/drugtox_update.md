# Drug Toxicity Assessment Batch Update System

## Overview
This document outlines the design for a batch processing script aimed at automatically assessing drug toxicity (DILI, DICT, DIRI) for all human prescription (Rx) drugs available in the FDALabel database. The results will be stored in a centralized `tox_agent` table for rapid retrieval during label viewing.

## Workflow

### 1. Identify Target & New Drugs (Delta Detection)
The script will perform a cross-database comparison between the FDALabel Oracle DB and the local application database.

- **Objective:** Find `SET_ID`s that are either missing from `tox_agent` or have a newer version available in FDALabel.
- **FDALabel Source Table:** `druglabel.dgv_sum_rx_spl`
- **Logic:**
  1. Fetch the latest `SET_ID` and `EFF_TIME` for all Human Rx drugs in PLR format with single ingredients.
  2. Compare against the local `tox_agent` table.
  3. Identify "New" (SetID doesn't exist) or "Updated" (SetID exists but `EFF_TIME` is more recent).

**SQL Sketch:**
```sql
SELECT l.format_group, l.set_id, l.product_names, l.PRODUCT_NORMD_GENERIC_NAMES, l.AUTHOR_ORG_NORMD_NAME, l.eff_time
FROM druglabel.dgv_sum_rx_spl l
WHERE l.document_type_loinc_code in ('34390-5', '34391-3', '45129-4')
    AND l.format_group = 1 -- PLR format
    AND l.num_act_ingrs = 1 -- Single ingredient for cleaner assessment
ORDER BY l.format_group ASC, l.eff_time DESC
```

### 2. Automated Assessment Process
For each identified `set_id`, the script follows this pipeline:
1. **XML Extraction:** Call `get_label_xml(set_id)` to get the SPL content.
2. **Metadata Harvesting:** 
   - From FDALabel: `brand_name`, `generic_name`, `AUTHOR_ORG_NORMD_NAME`, `eff_time`.
   - From XML: Verify consistency and check for specific toxic sections.
3. **Sequential AI Analysis:**
   - **DILI:** Run `generate_assessment` with `DILI_prompt`.
   - **DICT:** Run `generate_assessment` with `DICT_prompt`.
   - **DIRI:** Run `generate_assessment` with `DIRI_prompt`.
4. **Validation:** Ensure the AI output contains the expected HTML report blocks (e.g., `<div class="label-section">`).

### 3. Database Schema: `tox_agent`
This table serves as a high-performance cache for pre-computed toxicity data, merging metadata from FDALabel with AI assessments.

| Column | Type | Description |
| :--- | :--- | :--- |
| `id` | Integer | Primary Key (Autoincrement) |
| `set_id` | String(100) | Unique SPL Set ID (Indexed) |
| `is_plr` | Integer | 1 for PLR format, 0 for others |
| `brand_name` | String(500) | Trade name(s) from FDALabel |
| `generic_name` | String(500) | Proper/Generic name(s) from FDALabel |
| `manufacturer` | String(500) | Author Organization from FDALabel |
| `spl_effective_time`| String(50) | The `EFF_TIME` from FDALabel used for this assessment |
| `dili_report` | Text | HTML report for Liver Injury (DILI) |
| `dict_report` | Text | HTML report for Cardiotoxicity (DICT) |
| `diri_report` | Text | HTML report for Renal Injury (DIRI) |
| `last_updated` | DateTime | Timestamp of the last successful batch run for this record |
| `update_notes` | Text | Any notes about why the record was updated |
| `status` | String(20) | 'completed', 'failed', or 'pending' |

### 4. Integration & UI Logic
- **API (backend/dashboard/routes/api.py):**
  - Modify `api_bp.route('/label/<set_id>')` to include the `tox_agent` data if available.
  - Add a dedicated endpoint `GET /api/tox/summary/<set_id>` for the sidebar/tab display.
- **Frontend:** 
  - Show a "Toxicity Profile" tab in the label viewer.
  - If data is pre-populated from `tox_agent`, show it immediately.
  - If missing, provide a "Generate Assessment" button which calls the batch logic for that single drug.

## Technical Considerations
- **Concurrency:** Limit parallel AI calls (e.g., max 5 concurrent) to manage provider rate limits.
- **Rate Limiting:** Implement exponential backoff for 429 errors.
- **Error Handling:** Log failures (e.g., "XML too large", "AI Refused") and store the failure status in the `tox_agent` table to avoid infinite retries.
- **Update Cycle:** A standalone script `./scripts/update_tox_agent.py` executed periodically.
