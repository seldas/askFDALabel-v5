# Label Comparison Module (`/labelcomp`)

## 1. Overview

The **Label Comparison** module provides side-by-side and structural diffing between two FDA drug labels.

It supports two distinct comparison modes:
1. **Cross-Product Comparison**: Compare two different drugs (e.g. innovator vs generic, or competing drugs within the same pharmacologic class) to analyze differences in indications, warnings, and adverse reactions.
2. **Version History Comparison**: Compare two historical revisions of the same product (`set_id`) to pinpoint exact label changes introduced in a regulatory supplement (e.g., newly added black box warnings or expanded indications).

---

## 2. Architecture & Comparison Pipeline

```
Label 1 (XML on disk / Oracle)                   Label 2 (XML on disk / Oracle)
             │                                                │
             └───────────────────────┬────────────────────────┘
                                     ▼
                           parse_spl_xml()
                         Normalize & Section Align
                                     ▼
                        compare.py (Diff Engine)
                                     │
         ┌───────────────────────────┴───────────────────────────┐
         ▼                                                       ▼
  Structural Section Alignment                               Text Diff & Token Matching
  (Matches LOINC codes, section                              (Generates inline additions,
   numbers, and virtual titles)                               deletions, and unchanged text)
                                     │
                                     ▼
                       AI Comparison Synthesis (Optional)
                      Summarizes clinical differences across:
                      • Indications & Usage
                      • Warnings & Precautions
                      • Dosage & Administration
```

- **Backend Blueprint**: `backend/labelcomp/blueprint.py` & `backend/labelcomp/compare.py`
- **Frontend Workspace**: `frontend/app/labelcomp/`

---

## 3. Key Features

- **Section-by-Section Alignment**: Labels frequently name sections differently or omit certain sub-sections. The comparison engine aligns sections by LOINC code and semantic title, allowing side-by-side inspection even when section numbering differs.
- **Visual Inline Diff**: Additions are highlighted in green, deletions in strikethrough red, and identical text is dimmed to maximize reviewer efficiency.
- **AI Comparative Summary**: Generates a structured clinical difference report, highlighting key safety or efficacy divergences between the compared labels.
- **Comparison Bookmarks**: Comparisons can be saved into a project as a `FavoriteComparison` entity, preserving the exact pair for future collaborative review.
