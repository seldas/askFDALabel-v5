# Deep Dive Evaluation Plan

**Document type:** Evaluation and analysis plan  
**Status:** Working draft  
**Implementation basis:** `backend/dashboard/services/deep_dive_service.py`, `backend/dashboard/routes/api.py`, `frontend/app/dashboard/label/[setId]/deepdive.tsx`  
**Boundary:** This document covers evaluation of the existing Deep Dive feature as a comparative labeling-discrepancy workflow. It does not propose full signal validation or construction of a benchmark annotation corpus.

## Abstract

The Deep Dive feature is best evaluated as a **comparative labeling intelligence tool** rather than a validated safety-signal confirmation engine. At scale, individual flagged terms may imply substantial downstream regulatory review effort, so the evaluation strategy should avoid over-claiming and should not attempt to present every flagged item as a validated finding. Instead, the work should focus on three outputs:

1. a **batch execution pipeline** that runs Deep Dive across the eligible label corpus,
2. a **post-analysis pipeline** that summarizes population-level patterns and identifies interpretable outliers, and
3. a **manuscript-ready reporting package** that presents distributional observations and a small number of traceable case studies.

This approach keeps human effort focused on explaining observations and reviewing selected examples rather than constructing a large benchmark dataset.

## 1. Evaluation objective

The primary objective is to characterize how the Deep Dive feature behaves across the full database and to identify interpretable patterns in:

- Critical Gaps,
- Regulatory Discrepancies,
- cohort composition by generic name or EPC,
- variation within the same generic name,
- variation within the same EPC class,
- rank-order outliers, and
- result stability under repeated runs.

The evaluation is therefore framed as **population-level analytical characterization** and **hypothesis generation**, not formal validation of every individual signal.

## 2. What this work should and should not claim

### 2.1 Appropriate claims

This work can support claims such as:

- the Deep Dive workflow runs successfully across a large corpus,
- the resulting discrepancy profiles show coherent distributions,
- related products can be grouped and compared using generic-name or EPC-based cohorts,
- the system can surface traceable outlier cases for expert review,
- the method is useful for exploratory regulatory intelligence and prioritization.

### 2.2 Claims to avoid

This work should avoid claiming that:

- all flagged terms are true safety signals,
- all Critical Gaps are validated labeling deficiencies,
- the system independently confirms regulatory actionability,
- large-scale findings have been medically adjudicated.

Recommended language is: **observation**, **pattern**, **outlier**, **discrepancy profile**, **hypothesis-generating**, and **requires expert review**.

## 3. Overall work plan

The work has three major implementation tracks.

### 3.1 Track A: batch run script

Build a batch execution script that iterates through eligible labels and records Deep Dive outputs in a structured results table.

#### Responsibilities

- enumerate eligible target labels from the local database,
- choose baseline mode: generic-name cohort, EPC cohort, or both,
- call the existing Deep Dive logic or API for each target label,
- capture runtime success/failure and response metadata,
- flatten the result into analysis-ready tables,
- save raw JSON and tabular outputs for reproducibility.

#### Minimum output fields

At minimum, each target-level result row should include:

- `run_id`
- `run_timestamp`
- `code_version` or git commit hash
- `target_set_id`
- `source`
- `baseline_type` (`generic` or `epc`)
- `baseline_term`
- `peer_count`
- `label_format`
- `critical_gap_count`
- `regulatory_discrepancy_count`
- `minor_discrepancy_count` if retained
- `matrix_term_count`
- `success_flag`
- `error_message` if failed
- `elapsed_seconds`

A second anomaly-level table should include one row per flagged term:

- `run_id`
- `target_set_id`
- `baseline_type`
- `baseline_term`
- `soc`
- `pt_term`
- `tier`
- `target_code`
- `consensus_code`
- `coverage`
- `peer_distribution_B`
- `peer_distribution_W`
- `peer_distribution_A`
- `peer_distribution_N`
- `original_match`

A third peer-level reference table is also recommended:

- `run_id`
- `target_set_id`
- `peer_set_id`
- `baseline_type`
- `baseline_term`
- `peer_brand`
- `peer_manufacturer`

#### Practical notes

- Save one raw JSON file per run target so downstream review can reconstruct the original response.
- Save one aggregated CSV or parquet table for manuscript figures and statistics.
- Include explicit handling for failures such as missing XML, zero peers, or malformed metadata.

### 3.2 Track B: post-analysis script

Build a second script that consumes the batch results and produces descriptive statistics, ranked lists, and manuscript-ready summary tables.

#### Core analyses

The first pass should be descriptive rather than statistically ambitious. The most useful outputs are:

- overall distribution of Critical Gaps,
- overall distribution of Regulatory Discrepancies,
- results stratified by baseline type,
- results stratified by source,
- results stratified by label format if available,
- within-generic variability,
- within-EPC variability,
- association between peer count and discrepancy burden,
- top-ranked and bottom-ranked labels,
- repeated-run stability if reruns are available.

#### Recommended grouped summaries

Create summary tables for:

- all labels,
- grouped by generic name,
- grouped by EPC,
- grouped by source,
- grouped by label format,
- grouped by peer-count bins.

#### Recommended figures

The manuscript-ready analysis set should ideally include:

- histogram of Critical Gap counts,
- histogram of Regulatory Discrepancy counts,
- boxplots or violin plots by baseline type,
- rank-order plot of highest-scoring labels,
- scatter plot of peer count vs discrepancy count,
- within-group variance plot for generic names,
- within-group variance plot for EPCs.

### 3.3 Track C: manuscript section

In parallel with code implementation, draft the manuscript section that explains the evaluation framing, analytical workflow, and selected observations.

This section should emphasize that:

- Deep Dive is evaluated as a comparative discrepancy-surfacing tool,
- large-scale outputs are used to characterize behavior and prioritize review,
- individual findings are not claimed as fully validated safety determinations,
- selected case studies provide interpretability and traceability.

## 4. Recommended evaluation workflow

### Step 1: define the evaluation cohort

Decide which labels are eligible for the batch run. Exclusion criteria should be documented explicitly, for example:

- missing or inaccessible SPL XML,
- missing metadata required for cohorting,
- products with no usable peer cohort,
- duplicates or withdrawn labels if intentionally excluded.

### Step 2: execute full batch runs

Run Deep Dive for all eligible labels under the chosen baseline strategies:

- generic-only,
- EPC-only,
- or both for comparative analysis.

### Step 3: generate master tables

Produce at least three machine-readable tables:

- target-level run summary,
- anomaly-level results,
- peer-level reference table.

### Step 4: perform post-analysis

Compute descriptive summaries and ranking outputs. Focus first on coherent observations rather than formal inferential claims.

### Step 5: identify candidate case studies

Select a small number of examples for narrative interpretation. Suggested selection buckets:

- one high-ranking outlier,
- one moderate but clinically interpretable case,
- optionally one low-signal or apparently clean case for contrast.

### Step 6: targeted human review

Human effort should remain limited and focused. Reviewers should inspect only:

- selected outliers,
- selected representative median cases,
- selected clean cases,
- suspicious failures or implausible cohorts.

The role of the human reviewer is to explain why the observation is interesting or questionable, not to fully validate the entire database.

## 5. Minimal human review protocol

A full benchmark annotation dataset is out of scope. The intended human-review burden is small and selective.

### 5.1 What humans should review

For a short list of chosen cases, reviewers should check:

- whether the peer cohort looks reasonable,
- whether the highlighted PT terms are traceable in the target label,
- whether the reported peer consensus appears plausible,
- whether the flagged discrepancy is meaningful enough to discuss as an observation.

### 5.2 Suggested review set

A practical minimal review set is:

- top 5 to 10 high-ranking outliers,
- 5 median cases,
- 5 low-signal cases,
- 1 to 3 manuscript case studies.

### 5.3 Review outputs

The reviewer only needs to record brief judgments such as:

- plausible,
- questionable,
- likely artifact,
- worth deeper regulatory review.

This is sufficient to support interpretation without implying corpus-wide adjudication.

## 6. Statistical and analytical outputs to prioritize

The project should prioritize descriptive, interpretable outputs over complex modeling.

### 6.1 Essential summary metrics

- number of eligible labels
- number of successful runs
- number of failed runs
- median and interquartile range of peer count
- median and interquartile range of Critical Gap count
- median and interquartile range of Regulatory Discrepancy count
- proportion of labels with zero Critical Gaps
- proportion of labels with high discrepancy burden above chosen thresholds

### 6.2 Group-level observations

- within-generic heterogeneity
- within-EPC heterogeneity
- classes with consistently high discrepancy burden
- classes with consistently low discrepancy burden
- whether peer count strongly affects observed counts
- whether source choice materially changes rankings

### 6.3 Stability checks

If computationally feasible, rerun a subset of labels and compare:

- peer-count agreement,
- overlap of top anomalies,
- correlation of total discrepancy counts,
- changes caused by randomization or data-source drift.

## 7. Case-study strategy

Case studies should be used for interpretability, not for proving universal correctness.

For each chosen case study, the manuscript or supplement should show:

- why the case was selected,
- target label metadata,
- baseline strategy and peer count,
- key flagged PT terms,
- the target classification versus peer consensus,
- traceability back to target and peer label sections,
- a cautious interpretation of what the discrepancy may represent.

Recommended wording:

- "suggests a potential labeling discrepancy"
- "illustrates the type of outlier surfaced by the workflow"
- "requires further expert review"

## 8. Expected code deliverables

### 8.1 Batch run script

Suggested location:

- `scripts/analysis/deepdive_batch_run.py`

Suggested responsibilities:

- query eligible labels,
- dispatch Deep Dive runs,
- collect raw JSON,
- emit summary tables,
- write execution logs.

### 8.2 Post-analysis script

Suggested location:

- `scripts/analysis/deepdive_post_analysis.py`

Suggested responsibilities:

- load batch outputs,
- compute grouped summaries,
- create ranked outlier tables,
- generate manuscript-ready figures and CSV summaries,
- emit a short markdown or JSON summary report.

### 8.3 Optional notebook or report builder

Suggested location:

- `scripts/analysis/deepdive_report.ipynb`
  or
- `scripts/analysis/deepdive_report.py`

Suggested responsibilities:

- produce publication-ready tables and figures,
- support manual case-study extraction,
- generate appendix or supplement tables.

## 9. Expected manuscript content

A manuscript section for Deep Dive evaluation should include the following components.

### 9.1 Evaluation framing

State that the objective is **behavioral characterization at scale**, not full signal validation.

### 9.2 Methods

Describe:

- label corpus and eligibility criteria,
- Deep Dive execution settings,
- baseline strategies,
- output tables generated,
- descriptive analyses performed,
- limited targeted expert review of selected cases.

### 9.3 Results

Report:

- number of labels processed,
- success/failure counts,
- overall discrepancy distributions,
- variation across generic and EPC groups,
- ranking behavior and notable outliers,
- brief stability findings if reruns were performed.

### 9.4 Case studies

Present one or two concise examples with traceability back to source label content.

### 9.5 Limitations

Explicitly state:

- findings are exploratory,
- flagged discrepancies are not equivalent to confirmed safety signals,
- peer cohort quality may affect outputs,
- source coverage and label-format heterogeneity can influence results,
- only a small subset received targeted human inspection.

## 10. Near-term implementation checklist

### Must do

- define the eligible target-label cohort,
- implement the batch run script,
- define and save the master result schema,
- implement the post-analysis script,
- produce summary tables and ranking outputs,
- select candidate case studies,
- draft the manuscript methods/results subsection.

### Should do

- add rerun stability checks on a representative subset,
- save per-target raw JSON for traceability,
- save a code-version identifier with every run,
- document exclusions and failure reasons.

### Nice to have

- create a lightweight HTML or markdown report generator,
- add side-by-side case-study exports,
- compare generic-based and EPC-based rankings directly.

## 11. Bottom-line recommendation

The Deep Dive evaluation should be executed as a **scaled analytical characterization study** with limited, targeted human interpretation. The practical goal is to show that the feature produces meaningful population-level observations and surfaces interpretable outliers, while avoiding any implication that all flagged terms have been fully validated. The three concrete work products for the next phase are therefore:

1. a batch run script,
2. a post-analysis script, and
3. a manuscript section built around descriptive observations plus one or two carefully explained case studies.
