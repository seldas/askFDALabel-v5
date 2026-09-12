# Local Database Query Builder (`/localquery`)

## 1. Overview

The **Local Database Query Builder** (`/localquery`) allows regulatory scientists and researchers to execute multi-criteria Boolean queries across the label database without writing raw SQL.

It supports querying both the local PostgreSQL database and the internal Oracle FDALabel database through a unified criteria interface.

---

## 2. Supported Query Criteria Categories

The query builder implements **11 distinct regulatory criteria dimensions**:

| # | Criterion Category | Target Fields & Logic |
|---|---|---|
| 1 | **Labeling Type** | Human Prescription (Rx), OTC Monograph, Biologic, Dietary Supplement |
| 2 | **Application Type** | NDA, ANDA, BLA, Monograph Final/Not Final, Unapproved Medical Gas |
| 3 | **Route of Administration** | Oral, Intravenous, Topical, Infiltration, Subcutaneous, Inhalation, etc. |
| 4 | **Product Name** | Exact, prefix, or contains search across proprietary and non-proprietary names |
| 5 | **Full-Text / Section Text** | On-the-fly search inside specific clinical sections |
| 6 | **Labeling Section** | Prescribed section filter (LOINC code or standard header) |
| 7 | **Market Status** | Reference Listed Drug (RLD), Reference Standard (RS), Marketed, Discontinued |
| 8 | **MedDRA Terms** | Target adverse reactions by SOC, HLGT, HLT, or PT |
| 9 | **Pharmacologic Class** | Established Pharmacologic Class (EPC), MoA, Physiological Effect (PE) |
| 10| **Regulatory Identifiers** | Set ID, SPL ID, UNII, NDC, Application Number |
| 11| **Chemical Structure** | Substructure and similarity search by SMILES/Mol |

---

## 3. Query Compilation & Execution

- **Compiler**: `backend/labelquery/compiler.py` translates user-assembled UI criteria cards into optimized SQL `WHERE` clauses.
- **Boolean Combination**: Criteria can be chained via `AND` / `OR` logic with parenthetical grouping.
- **Export Formats**: Query results can be downloaded in streaming CSV, Excel (`.xlsx`), or structured JSON.
- **Feature Gate**: Gated by the `localquery` feature key, restricting complex database query execution to approved user roles.
