# DrugTox: Toxicology & Safety Intelligence Module (`/drugtox`)

## 1. Overview

The **DrugTox** module provides deep toxicological profiles for marketed drugs, specializing in organ-specific adverse outcomes:
- **DILI**: Drug-Induced Liver Injury (anchored on the FDA **Rule-of-Two (RO2)** reference set and LTKB datasets).
- **DICT**: Drug-Induced Cardiotoxicity (QT prolongation, arrhythmia, cardiomyopathy).
- **DIRI**: Drug-Induced Renal Injury (acute kidney injury, interstitial nephritis).

---

## 2. Key Capabilities & Architecture

- **Backend Blueprint**: `backend/drugtox/blueprint.py`
- **Frontend Workspace**: `frontend/app/drugtox/`
- **Data Models**: `DrugToxReference`, `DrugToxReport` in `backend/database/models.py`

### Feature Components:
1. **Rule-of-Two (RO2) Liver Toxicity Assessment**:
   Evaluates liver toxicity severity based on clinical trial ALT/total bilirubin elevations, boxed warnings, and Hy's Law criteria:
   - *Most-DILI-concern*: Severe hepatotoxicity, black box warning, market withdrawal.
   - *Less-DILI-concern*: Documented warnings, transient enzyme elevations.
   - *No-DILI-concern*: No evidence of clinical hepatotoxicity.
2. **Chemical Structure & UNII Mapping**:
   Integrates UNII structures (`UNII_CHEM_STRUCT`) and renders 2D/3D chemical structures with SMILES/Mol representations.
3. **FAERS Signal Correlation**:
   Pulls and visualizes adverse event reporting signals from the FDA Adverse Event Reporting System (FAERS), displaying proportional reporting ratios (PRR) alongside label warnings.
4. **Structured Assessment Export**:
   Generates downloadable comprehensive toxicological summary reports in PDF and Excel formats.
