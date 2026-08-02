# 🩺 Device Labeling Support (AFL-Device) - Implementation Plan

## 1. Overview
The **Device Labeling Support** module (AFL-Device) is a dedicated application within the AskFDALabel-Suite for searching, analyzing, and comparing medical device labeling and safety data. It parallels the drug labeling functions but is tailored for the unique data structures of medical devices (UDI, PMA/510k, GUDID).

## 2. Data Strategy
- **Primary Source**: openFDA Device Endpoints
  - `device/510k.json`: 510(k) Clearances (Premarket Notification).
  - `device/pma.json`: Premarket Approvals.
  - `device/registrationlisting.json`: GUDID (Global Unique Device Identification Database) metadata.
  - `device/event.json`: MAUDE (Manufacturer and User Facility Device Experience) reports.
  - `device/recall.json`: Device Recalls and Enforcement Reports.
- **Unique Identifiers**: UDI-DI (Device Identifier), Product Code (3-letter), Regulation Number, K/P Number (e.g., K230001, P220005).

## 3. Backend Architecture (`backend/device/`)
- **`blueprint.py`**: API routes for device search, metadata retrieval, and MAUDE analysis.
- **`services/device_client.py`**: Orchestrator for openFDA device APIs.
- **`services/maude_analyzer.py`**: Logic for processing and aggregating adverse event data (similar to FAERS logic).
- **`models.py`**: Database schemas for `DeviceProject` and `DeviceRecall`.

## 4. Frontend Architecture (`frontend/app/device/`)
- **`page.tsx`**: Main landing for device search and project management.
- **`components/DeviceResultCard.tsx`**: Specialized card for device metadata (UDI, Product Code, Implant status).
- **`components/MaudeReport.tsx`**: Interactive dashboard for device adverse events (Injuries vs. Malfunctions).
- **`compare/page.tsx`**: Side-by-side comparison of device "Instructions for Use" (IFU) or 510(k) Summaries.

## 5. Detailed To-Do List

### Phase 1: Foundation & Search (COMPLETED)
- [x] Initialize `backend/device/` directory and register blueprint in `app.py`.
- [x] Implement `device_client.py` with `find_devices` (Supporting 510(k) and PMA).
- [x] Create search UI in `frontend/app/device/page.tsx` with project-consistent styling.
- [x] Build Result Cards to display Product Codes, PMAs/510ks, and Manufacturer info.
- [x] Added "Starting Examples" (Stent, Pacemaker, etc.) for rapid testing.

### Phase 2: MAUDE & Safety Analysis (COMPLETED)
- [x] Implement `maude_analyzer.py` to fetch and group reports by `event_type` and analyze 3-year trends.
- [x] Add "Safety Profile" action to device results.
- [x] Create `MaudeReport` visualization component (Recharts) for distribution and trend analysis.
- [x] Integrate "Device Search" into the global "Search" navigation menu.

### Phase 3: Comparison & Recalls (COMPLETED)
- [x] Implement `recall_analyzer.py` to check for active recalls/enforcement actions via `device/recall.json`.
- [x] Build IFU/Summary comparison engine (handling text-based summaries).
- [x] Add "Export Device Summary" function (PDF/Excel/HTML).

### Phase 4: Integration & UX
- [ ] Ensure cross-linking between drugs and devices (e.g., drug-device combination products).
- [x] Final styling and performance tuning for the main search page.

## 6. Essential Analysis Functions (Priority 1)
1. **Product Code Comparison**: Compare labeling of all devices under the same FDA Product Code.
2. **MAUDE Trend Analysis**: Identify if a device has a spike in "Malfunction" vs "Injury" reports.
3. **Recall Risk Score**: Aggregate historical recall data to provide a safety overview.
4. **Implant/Sterilization Extraction**: Automatically extract critical "Instructions for Use" parameters.
