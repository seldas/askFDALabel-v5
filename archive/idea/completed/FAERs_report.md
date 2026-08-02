# Targeted FAERS & Labeling Analysis Plan

## 1. Objective
Enable users to perform a deep-dive analysis of a **Specific Adverse Event (AE)** across a project's labeling documents. The goal is to compare how that specific AE is described in the text of thousands of labels versus how it is being reported in the FAERS database for those same drugs.

## 2. User Workflow
1.  **Create/Select Project:** User assembles a set of labeling documents (e.g., all drugs in a specific class).
2.  **Define Target AE:** User defines the focus by selecting one or more MedDRA Preferred Terms (PTs) or LLTs (e.g., "Hepatotoxicity" or "Acute Myocardial Infarction").
3.  **Generate Analysis:** The system performs a dual-layer scan and generates a statistical summary.

## 3. Analysis Components

### A. Labeling Content Analysis (The "Inside" View)
Analyze how the specific AE is represented within the text of the labels:
-   **Detection:** Use `MeddraMatcher` to find occurrences of the Target AE and its synonyms.
-   **Section-Specific Presence:** Identify which sections contain the AE (Boxed Warning vs. Warnings & Precautions vs. Adverse Reactions).
-   **Contextual Severity:** Extract the surrounding text (snippets) to determine the "strength" of the warning.
-   **Statistics:** 
    -   % of labels in the project that mention the AE.
    -   Distribution of the AE across different labeling sections.

### B. FAERS Reporting Analysis (The "Outside" View)
Analyze the real-world reporting data for the **same specific drugs and the same specific AE**:
-   **Targeted Query:** Fetch FAERS data specifically for the drugs in the project, filtered by the Target AE.
-   **Key Metrics:**
    -   **Report Count:** Total number of cases for this specific AE per drug.
    -   **Seriousness Ratio:** % of reports for this specific AE that are classified as "Serious" or "Fatal."
    -   **Trend Analysis:** Are reports for this specific AE increasing or decreasing for this class?

## 4. Statistical Synthesis & Output
The final report provides a comparative table and summary:
-   **Cross-Comparison Table:** A grid listing each drug, its labeling status for the AE (Labeled/Unlabeled), the section it appears in, and its FAERS report volume.
-   **Gap Identification:** Highlight drugs where the FAERS signal is high but labeling is either absent or "weak" (e.g., only in Adverse Reactions vs. Warnings).
-   **Class Overview:** A statistical summary of the "Labeling Landscape" for the AE within the chosen drug class.

## 5. Proposed Data Structure
-   **Project Focus:** Store the `target_meddra_terms` as metadata for the project.
-   **Analysis Cache:** A table to store the results of the batch scan to allow for quick re-filtering and UI updates.
