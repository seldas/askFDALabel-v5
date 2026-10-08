# Labeling Adverse Events (Labeling AE) & MedDRA Module

## 1. Overview

### LabelingAE viewer: Section View alignment

The external annotation viewer has **List View**, **Section View**, and **Raw JSON** tabs.
Section View groups annotations by their section ID, provides search/classification/SOC
filters, and displays details for selected spans. Overlaps retain all annotations.
The aligned view preserves SPL narrative structure: tables (including merged cells),
captions, lists, paragraphs, inline emphasis, and sub/superscripts. A safe tag and
attribute allowlist converts XML into React elements; source HTML is never injected.
Images and the original publisher's full stylesheet are not reproduced by this renderer.
The optional canonical-only view continues to display plain text.

By default, when canonical text is absent, the viewer extracts sections from the XML
already loaded by the label workspace. That XML follows the standard local-storage /
Oracle resolution cascade; the viewer adds no new Oracle query. It verifies the XML's
document ID and set ID against the annotation document and any requested version pin.
It follows each section's `xml_path`, validating its LOINC code and observed title.
If the path fails, a unique section with matching metadata may be used. Ambiguous
sections are not selected. Parent sections include their nested narratives without
concatenating separately extracted child sections into a single offset space.

Terms are aligned within that section using NFC-normalized text, case-insensitive
matching, whitespace normalization, and word boundaries. A character map translates
matches back to positions in the section's individual text nodes. Highlights split
across inline nodes without replacing any enclosing layout elements. Table cells are
separated by hard boundaries in the searchable projection, so text from adjacent cells
cannot form a false AE phrase. Projection offsets include these structural separators
and are used only for rendering; the JSON offsets are unchanged. Only a unique occurrence is
highlighted. Repeated terms remain unresolved, even if one occurs near the JSON offset;
exact term equality alone cannot prove which repeated occurrence was annotated.
These locations are labeled **Aligned section text**, distinct from hash-verified
canonical locations. Original JSON offsets are preserved, and the detail panel shows
the new section-relative offsets separately. Filters never change alignment decisions.

The current upstream example contains offsets and hashes but no canonical text.
It supports section alignment as described above. To verify original canonical offsets,
the annotation service can supply
`canonical_text` at the payload root (or `document.canonical_text`), or export the same
UTF-8 text for **Verify original canonical offsets → Load canonical text**. The file stays in the browser.
Do not trim or change line endings when exporting it.

For canonical verification, the supported offset contract is `basis: canonical_text`, `indexing: 0-based`,
`interval: half-open`, `normalization: NFC`, and `unit: unicode_code_points`.
The `unit` field is a required addition to the existing example contract; the service
must confirm its offset units rather than the viewer assuming JavaScript string indices.
Document and offset `canonicalization_version` values must agree. The viewer verifies
SHA-256 of the exact UTF-8 canonical text against `document.canonical_text_sha256`,
and compares `document.set_id` and `document.spl_id` with the open label's XML identity
and any requested version pin. It validates section bounds and each annotation's
extracted term (case-insensitively) at the supplied offsets. Unresolved spans remain
inspectable without highlights. Parent/subsection ranges are not concatenated, avoiding
duplicate text and offset shifts.

**Try Section View example** loads a clearly labeled synthetic document, including
split XML text nodes, shifted whitespace, merged table cells, overlapping annotations and repeated terms
that intentionally remain unresolved. **Refresh** returns to the
live response. This example does not represent findings for the open product.

Canonical verification remains an optional stricter path. Original canonical text or
surrounding context from the producer would allow repeated occurrences to be resolved
reliably in a future extension. No guessed endpoint or nearest-term fallback is used.

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
