# Medical Device Intelligence Module (`/device`)

## 1. Overview

While AskFDALabel centers primarily on drug labeling, the **Device Intelligence** module (`/device`) extends analytical capabilities to medical devices regulated by the FDA Center for Devices and Radiological Health (CDRH).

It aggregates openFDA device APIs to provide regulatory history, clearance records, recall notices, and postmarketing adverse events for medical devices and combination products.

---

## 2. Integration & Endpoints

- **Backend Blueprint**: `backend/device/blueprint.py`
- **Frontend Workspace**: `frontend/app/device/`
- **Primary Data Source**: openFDA Device APIs

### Core Regulatory Surfaces:
1. **510(k) Premarket Notifications**:
   Search cleared 510(k) devices by device name, applicant, regulation number, or 510(k) number (`Kxxxxxx`). Displays substantial equivalence decisions and summary statements.
2. **PMA (Premarket Approval)**:
   Covers high-risk Class III devices, showing approval orders, advisory committee panels, and supplement histories.
3. **Device Recalls (Enforcement Reports)**:
   Indexes Class I, II, and III medical device recalls, showing root-cause categorizations and manufacturer corrective actions.
4. **MAUDE (Manufacturer and User Facility Device Experience)**:
   Explores adverse event reports involving device malfunctions, serious injuries, and fatalities.
5. **UDI (Unique Device Identification)**:
   Resolves Global Unique Device Identification Database (GUDID) records for package configurations, sterility status, and MRI safety classifications.
