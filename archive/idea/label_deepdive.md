# Idea: Dashboard Label "Deep Dive" (Lightweight Analysis)

## Overview
Transform the "Deep Research" concept into a high-performance, explainable analysis panel that uses statistical methods (TF-IDF) and structural XML data instead of heavy AI/Embeddings. This approach is optimized for offline/resource-constrained environments and provides transparent logic for FDA Reviewers.

## Key Objectives
- **Precision & Explainability:** Use statistical benchmarks (class-wide averages) to highlight deviations.
- **Structural Integrity:** Leverage SPL Section IDs (LOINC) for apples-to-apples comparison.
- **Resource Efficiency:** Implement via SQL, JSON, and standard NLP libraries (scikit-learn/NLTK) rather than LLMs.

## Proposed Name
- **Label Deep Dive** (Standard industry terminology)
- **Class Intelligence**
- **Comparative Analytics**

## Implementation Pillars

### 1. Statistical Keyword Extraction (TF-IDF)
- **Concept:** Compare the current label's section text against a "Corpus" consisting of all labels in the same EPC class.
- **Output:** 
    - **"Unique to this Label":** Terms with high TF-IDF scores (rare in the class, frequent here).
    - **"Class Standard":** Terms frequent across the entire EPC (the "baseline").
- **Reviewer Value:** Quickly identifies specific safety phrasing or unique indications that differ from the "class norm."

### 2. Excipient Fingerprinting (Matrix View)
- **Concept:** Extract `<inactiveIngredient>` and `UNII` codes from the XML.
- **Output:** A horizontal comparison matrix.
    - **Rows:** Current label + Top 5 peers.
    - **Columns:** Critical excipients (e.g., Sodium, Benzyl Alcohol, Specific Sugars).
- **Reviewer Value:** Instantly spot if a new generic or formulation introduces a known allergen or "dirty" ingredient compared to the RLD.

### 3. Structural Warning Divergence (Diff)
- **Concept:** Target specific LOINC sections (e.g., `34071-1` Warnings & Precautions).
- **Logic:** 
    - Aggregate all list items/headers from the class.
    - Identify "Omissions": Warnings present in >80% of the class but missing in the current label.
- **Reviewer Value:** Automated "Gap Analysis" for safety compliance.

### 4. MedDRA Term Profiling
- **Concept:** Use the existing MedDRA scanner to count PT/LLT terms in the section.
- **Logic:** Compare term frequency in `ADVERSE REACTIONS` against the EPC average.
- **Reviewer Value:** Detects if a label is reporting a specific SOC (e.g., Cardiac Disorders) at a significantly higher text-density than its peers.

## Development Priorities (Phase 1)

| Priority | Module | Technical Path |
| :--- | :--- | :--- |
| **P0** | **Excipient Matrix** | SQL join on `ingredients` table + UI Grid |
| **P1** | **Sectional TF-IDF** | Python `TfidfVectorizer` on grouped EPC text |
| **P2** | **Structural Gap Analysis** | Header/List-item extraction from XML |
| **P3** | **MedDRA Benchmark** | Comparison of `MedDRAScan` results vs Class |

## Technical Implementation (Backend)
- Create a `deep_dive` service that:
    1. Identifies the EPC peers.
    2. Fetches the raw XML/JSON for specific sections.
    3. Runs a lightweight TF-IDF fit on the small corpus (Label + Peers).
    4. Returns a JSON of "Divergent Terms" and "Excipient Overlap".

## Discussion Points
- Should the "Class baseline" be pre-computed for each EPC, or computed on-the-fly?
- Which 3 LOINC sections are the most critical for the initial "Gap Analysis"?
- Do we need a "Peer Selector" UI to let users customize the comparison group?
