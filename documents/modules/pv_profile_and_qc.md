# Pharmacovigilance (PV) Profile & Automated Quality Control (QC)

## 1. Overview

The **Pharmacovigilance Profile (PV Profile)** and **Automated Quality Control (QC)** module (`/dashboard/label/[setId]/pv-profile`) provides an automated safety audit for drug labels.

It compiles a comprehensive safety profile from prescribing text and runs an automated quality-control verification engine (`PvProfileQcService`) to identify inconsistencies, omissions, and regulatory safety discrepancies.

---

## 2. Key Components & Implementation

- **Frontend View**: [`frontend/app/dashboard/label/[setId]/pv-profile/PvProfileView.tsx`](file:///d:/Coding/askFDALabel_v5/frontend/app/dashboard/label/[setId]/pv-profile/PvProfileView.tsx)
- **CSS Styling**: [`frontend/app/dashboard/label/[setId]/pv-profile/pv-profile.css`](file:///d:/Coding/askFDALabel_v5/frontend/app/dashboard/label/[setId]/pv-profile/pv-profile.css)
- **Profile Generation Service**: [`backend/dashboard/services/pv_profile_service.py`](file:///d:/Coding/askFDALabel_v5/backend/dashboard/services/pv_profile_service.py)
- **QC Verification Engine**: [`backend/dashboard/services/pv_profile_qc_service.py`](file:///d:/Coding/askFDALabel_v5/backend/dashboard/services/pv_profile_qc_service.py)

---

## 3. Pharmacovigilance Profile Structure

The profile synthesizes critical safety parameters from the SPL XML into structured dimensions:
1. **Boxed Warnings (Black Box)**: Extracted verbatim text, risk category, and severe hazard flags.
2. **Contraindications & Hypersensitivity**: Absolute contraindications, co-administered contraindications, and pre-existing conditions.
3. **Severe Warnings & Precautions**: Organ toxicity risks, laboratory monitoring recommendations, and dose adjustment triggers.
4. **Adverse Event Signals**: Extracted clinical trial reaction rates, postmarketing signals, and class-effect warnings.
5. **Special Populations**: Pregnancy risk category/narrative, lactation considerations, pediatric safety, and geriatric dosing precautions.

---

## 4. Automated QC Verification Engine (`pv_profile_qc_service.py`)

The QC service performs rule-based and cross-section validation to ensure labeling safety information is logically sound and consistent:

```
                            Parsed Prescribing Information
                                          │
                                          ▼
                         PvProfileQcService Execution Rules
                                          │
             ┌────────────────────────────┼────────────────────────────┐
             ▼                            ▼                            ▼
     Section Concordance        Terminology Compliance       Discrepancy Detection
  (e.g. Warning mentioned     (Standardized MedDRA PT        (Contradictory dosing
   in Section 5 but omitted    usage vs informal terms)       or missing monitoring
    from Highlights section)                                     recommendations)
                                          │
                                          ▼
                             Quality Control Audit Report
                             • Discrepancy Severity Score
                             • Finding Classification (Critical, Warning, Info)
                             • Recommended Labeling Rectifications
```

### Core Verification Rules:
- **Highlights vs. Full Text Concordance**: Checks whether every black box warning or severe contraindication in Section 4/5 is faithfully summarized in the Highlights header.
- **Monitoring Guidance Integrity**: Verifies that warnings requiring baseline/periodic testing (e.g., LFTs, renal function, CBC, ECG) contain actionable monitoring intervals.
- **Drug Interaction Alignment**: Confirms that drugs contraindicated in Section 4 have corresponding pharmacokinetic or pharmacodynamic explanations in Section 7 (*Drug Interactions*).
