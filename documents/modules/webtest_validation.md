# WebTest: Automated Regression & Validation Suite (`/webtest`)

## 1. Overview

The **WebTest** validation module (`/webtest`) ensures fidelity between AskFDALabel's query engine and the official public FDA web application (`nctr-crs.fda.gov/fdalabel`).

It provides an automated test execution harness that runs benchmark regulatory query suites, compares returned label sets, and flags data discrepancies.

---

## 2. Architecture & Testing Flow

```
                      Upload / Select Test Suite (Excel Template)
                                          │
                                          ▼
                         Celery Task: `run_webtest.py`
                                          │
                  ┌───────────────────────┴───────────────────────┐
                  ▼                                               ▼
         Execute Query against                          Execute Query against
        Local AskFDALabel Engine                        Official Web FDALabel
                  │                                               │
                  └───────────────────────┬───────────────────────┘
                                          ▼
                            Record Comparison & Diff Analysis
                            • Matching Count (Precision / Recall)
                            • Missing Set IDs
                            • Extra Set IDs
                                          │
                                          ▼
                                Output History & Reports
                           • `backend/webtest/history/`
                           • `backend/webtest/results/` (Excel Diff)
```

- **Backend Blueprint**: `backend/webtest/blueprint.py`
- **Execution Task**: `backend/admin/tasks/run_webtest.py`
- **Cron / Headless Runner**: `backend/cron_webtest.py`

---

## 3. Test Suites & Metrics

- **Excel Template Structure**: Test spreadsheets specify query criteria rows (e.g. *Human Rx + Oral + "Cardiovascular" in Indications*).
- **Automated Scorecards**:
  - **Pass**: Result set from local engine matches official web service 100%.
  - **Divergence**: Shows whether discrepancies stem from un-updated DailyMed monthly archives, differing version eff_times, or discontinued label filtering.
- **History Retention**: Historical test run logs and Excel diff sheets are persisted to `backend/webtest/results/` for regulatory auditability.
