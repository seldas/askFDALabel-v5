# Labeling Adverse Events (Labeling AE) & MedDRA Module

## 1. Overview

The **Labeling Adverse Events (Labeling AE)** module (`/dashboard/label/[setId]/labeling-ae`) is a pharmacovigilance tool that extracts, structures, and visualizes adverse events documented within FDA drug labeling.

It maps textual adverse event mentions directly into the **Medical Dictionary for Regulatory Activities (MedDRA)** hierarchy, providing safety reviewers with an interactive explorer that connects regulatory terminology to exact text locations in the prescribing information.

---

## 2. Key Components & Architecture

```
                                SPL Prescribing Information
                                  (Adverse Reactions / Warnings)
                                                │
                                                ▼
                                    MedDRA Term Matching Engine
                                   (`backend/dashboard/services/
                                       meddra_matcher.py`)
                                                │
                     ┌──────────────────────────┴──────────────────────────┐
                     ▼                                                     ▼
           Hierarchical Grouping                                Interactive Highlighter
         SOC -> HLGT -> HLT -> PT                             (`meddraHighlight.ts`)
                     │                                                     │
                     ▼                                                     ▼
         Adverse Event Table View                              In-situ Highlighted Text
         (Frequency %, Risk Categories)                        (Color-coded by MedDRA SOC)
```

### Implementation Files:
- **UI View**: [`frontend/app/dashboard/label/[setId]/labeling-ae/LabelingAeView.tsx`](file:///d:/Coding/askFDALabel_v5/frontend/app/dashboard/label/[setId]/labeling-ae/LabelingAeView.tsx)
- **Highlighter**: [`frontend/app/dashboard/label/[setId]/meddraHighlight.ts`](file:///d:/Coding/askFDALabel_v5/frontend/app/dashboard/label/[setId]/meddraHighlight.ts)
- **Styles**: [`frontend/app/dashboard/label/[setId]/labeling-ae/labeling-ae.css`](file:///d:/Coding/askFDALabel_v5/frontend/app/dashboard/label/[setId]/labeling-ae/labeling-ae.css)
- **Data Model / Example Schema**: [`deploy/data_transfer/example.labelingAE.json`](file:///d:/Coding/askFDALabel_v5/deploy/data_transfer/example.labelingAE.json)

---

## 3. The MedDRA Hierarchy & Highlighting Engine

Adverse reactions are parsed and mapped to the standard 5-level MedDRA structure:
1. **SOC** (System Organ Class) — e.g. *Gastrointestinal disorders*, *Hepatobiliary disorders*
2. **HLGT** (High Level Group Term)
3. **HLT** (High Level Term)
4. **PT** (Preferred Term) — e.g. *Nausea*, *Jaundice*, *Pancreatitis*
5. **LLT** (Lowest Level Term)

### Interactive Highlighting Engine (`meddraHighlight.ts`):
- Scans parsed section text for known MedDRA PT and LLT synonyms.
- Employs token-boundary matching and negation detection (e.g. distinguishing between "no evidence of pancreatitis" and "pancreatitis observed").
- Injects non-destructive DOM span wrappers (`<span class="meddra-highlight ...">`) with distinct color codes corresponding to the parent System Organ Class.
- Clicking an adverse event in the summary table scrolls the label view directly to the highlighted paragraph where the event was described.

---

## 4. Adverse Event Table Features

The Labeling AE interface provides:
- **Frequency Distribution**: Extracted percentage rates from clinical trial tables (e.g., `>= 5%`, `>= 1% and < 5%`, placebo-subtracted rates).
- **Section Attribution**: Distinguishes whether an adverse event was reported in Section 5 (*Warnings and Precautions*), Section 6 (*Adverse Reactions: Clinical Trials Experience*), or Section 6.2 (*Postmarketing Experience*).
- **Multi-SOC Filtering**: Filter events by specific bodily systems (e.g., cardiac, hepatic, nervous system).
- **Export**: Export adverse reaction tables with MedDRA codes to Excel and JSON.
