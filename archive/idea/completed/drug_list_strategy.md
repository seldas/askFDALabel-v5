# Strategy: Optimized Drug Name List for Snippet Tool

## 1. Goal
To maintain a high-performance, low-noise drug name list that maximizes "true" drug identification in AI responses while minimizing false positives from common medical terms or English words.

## 2. Current State Analysis
*   **Data Sources**: `rld_drug_name.txt` (high precision) and `distinct_drug_name.txt` (broad coverage).
*   **Filters**:
    *   Numbers/Special characters (except hyphens) are excluded.
    *   Names with 2+ spaces are excluded.
    *   Broad list is restricted to **All-Caps** only.
    *   RLD list allows mixed case with a 3-character minimum.
*   **Performance**: ~8,700 terms, ~460KB payload.

---

## 3. Proposed Refinement Strategies

### A. Semantic Categorization (Implemented)
We maintain separate tries for different categories of drug names to allow for differentiated rendering and filtering:
1.  **RLD (Reference Listed Drugs)**: High-precision list. Rendered with a **Light Green** background in the snippet tool.
2.  **BRAND Names**: Broad coverage list, excluding terms already in the RLD list. Rendered with a **Yellow** background.

**Implementation**:
*   `trie_gen.py` now generates two separate tries: `rld` and `brand`.
*   `snippet_logic.js` handles both tries and applies type-specific CSS styles.
*   RLD matches take precedence over BRAND matches if overlaps occur.

### B. Curated Medical Blacklist
The current blacklist is a good start, but it needs to be expanded based on real-world testing.
*   **Candidates for Blacklist**: 
    *   Generic anatomy (HEART, LIVER).
    *   Study terms (PLACEBO, COHORT, BLINDED).
    *   Measurement units (MILLIGRAM, PERCENT).
    *   Common medical abbreviations that aren't drugs (STAT, PRN, BID).

### C. Frequency-Based Filtering
Utilize the `FDALabel` database to count how many labels a term appears in.
*   **Strategy**: If a term appears in thousands of labels but is also a common English word (e.g., "THIN"), it should be flagged for manual review or removed from the automated snippet list.

### D. The "AND" and Combination Problem
Currently, we skip names with "AND" or special delimiters. 
*   **Idea**: Create a "Combinations" dictionary that maps common pairs (e.g., "Lisinopril-HCTZ") to their primary drug name for searching.

---

## 4. Technical Roadmap

1.  **Automated Cleanup Script**: Enhancing `trie_gen.py` to check drug names against a standard English dictionary. If a drug name is a common English word and NOT in the RLD list, it should be auto-removed.
2.  **Versioning**: Store versions of the `drug_snippet.js` so we can revert if a new list generation introduces too much noise.
3.  **User Feedback Loop**: Add a "Report False Positive" button to the snippet popup that logs terms that shouldn't have been highlighted.

## 5. Discussion Points
*   Should we allow 4-character drug names in the broad list if they are all-caps? (e.g., "PAX")
*   How often should the list be regenerated from the DB vs. relying on the static text files?
*   Do we need to support non-English drug names for global AI responses?
