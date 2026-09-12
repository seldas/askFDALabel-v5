# Search & Label Discovery Module

## 1. Overview

The Search & Discovery module is the primary entry point for querying FDA drug labels. It supports searching by brand name, generic name, active ingredient, application number (NDA/ANDA/BLA), NDC code, and regulatory identifiers.

Routing is implemented in `backend/search/blueprint.py` using a **DB-first decision tree**, avoiding the resource overhead of heavy semantic pipelines while delivering sub-second response times.

---

## 2. Query Classification & Routing

Incoming search queries pass through `_classify_query()`:

```
                          User Search Query Input
                                     │
                                     ▼
                          Classify Input String
                                     │
         ┌───────────────┬───────────┴───────────┬───────────────┐
         ▼               ▼                       ▼               ▼
      [UUID]           [NDC]                 [App Num]       [Keywords]
  (Set ID / SPL)   (xxxx-xxxx-xx)         (NDA/ANDA/BLA)         │
         │               │                       │               ▼
         └───────────────┼───────────────────────┘     PostgreSQL pg_trgm GIN
                         ▼                             ILIKE search over
                Exact Match Lookup                     `labeling.sum_spl`
             (Postgres or Oracle DB)                             │
                         │                                       │
                         └───────────────────┬───────────────────┘
                                             │
                                             ▼
                                  Evaluation of Results
                                             │
                        ┌────────────────────┴────────────────────┐
                        ▼                                         ▼
                [Single Result]                          [Multiple Results]
             Load XML from disk,                      Return paginated metadata
             parse sections, & build                  list with regulatory badges
             quick summary view                       (RLD, RS, Human Rx, OTC)
```

### Classification Rules:
- **UUID**: Matches 36-character hyphenated strings (`8-4-4-4-12`). Looked up directly against `set_id` and `spl_id`.
- **NDC**: Matches 10- or 11-digit NDC patterns (e.g. `0002-1433-61` or `54868-0923-0`). Matches `ndc_codes`.
- **Application Number**: Matches prefixed or plain numbers (`NDA021433`, `ANDA204122`, `BLA125057`). Matches `appr_num`.
- **Keyword / General**: Fuzzy matched against `product_names`, `generic_names`, and `active_ingredients` using `pg_trgm` GIN indexes.

---

## 3. Label View & Interactive Explorer (`/dashboard/label/[setId]`)

When a specific label is selected, `layout.tsx` fetches:
```http
GET /api/dashboard/label/<set_id>?json=1&spl_id=<spl_id>
```
The backend resolves the XML through the storage cascade and runs `parse_spl_xml()` in memory to produce:

1. **Document Header**: Normalized brand name, active ingredients, manufacturer, approval status, and effective date.
2. **Highlights of Prescribing Information**: Extracted boxed warnings, dosage forms, indications, contraindications.
3. **Interactive Table of Contents**: Hierarchical navigation across full prescribing sections (Boxed Warning, Indications, Dosage, Contraindications, Warnings, Adverse Reactions, Drug Interactions, Clinical Pharmacology, etc.).
4. **Interactive Highlighting & Search**: In-page search with real-time term highlighting and section jumps.
5. **Annotations**: User-specific or team-public notes attached to specific section numbers.
6. **Toolbox Sidebar**: Context-aware launcher giving direct access to Label Comparison, Labeling AE, PV Profile, Deep Dive, and DrugTox for the active drug.
