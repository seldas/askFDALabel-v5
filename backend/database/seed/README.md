# Seed data

Small, version-controlled reference datasets that must be importable in **any**
environment (local, Docker, internal FDA). Unlike `data/downloads/*.xlsx` — which
is gitignored and machine-local — everything here travels with the repo.

## `dili_ro2_reference.csv`

The background cloud for the **Rule-of-Two (DILI)** quadrant plot: the published
dataset the rule was derived on, so a user can see where the drug under
assessment falls relative to the drugs that defined the boundary. These points
are static and are *never* recomputed per request.

**Source: Supporting Table 1 of** Chen M, Borlak J, Tong W. High lipophilicity
and high daily dose of oral medications are associated with significant risk for
drug-induced liver injury. *Hepatology*. 2013;58(1):388-396.
doi:10.1002/hep.26208 (PMID 23258593).

164 oral drugs: **116 Most-DILI-concern, 48 No-DILI-concern**.

### Only two classes, on purpose

The paper excluded Less-DILI-concern drugs. The rule is a contrast between clear
positives and clear negatives, not a severity gradient, so there is no middle
category to plot. An earlier version of this file was a hand-assembled 66-drug
set that was 55% Most-DILI-concern and held only two No-DILI-concern drugs; it
looked like a hepatotoxicant showcase rather than a reference population and
has been replaced entirely.

### Provenance, per column

| Column | Source | Trust |
|---|---|---|
| `drug_name`, `dili_concern`, `max_daily_dose_mg`, `paper_logp`, `paper_ro2_test` | Chen 2013 Supporting Table 1, as published | Authoritative |
| `pubchem_cid`, `inchikey`, `smiles`, `mol_weight`, `pubchem_xlogp3` | PubChem PUG REST, **parent** (free-base) record | Authoritative |
| `alogp`, `alogp_method` | Computed at import by RDKit from `smiles` | Derived |

**No column here is hand-curated.** Both plotted axes are published values.
`dose_review_status` is `published` on every row (the field is kept because a
future addition from another source may need reviewing).

### The extraction is verified against the paper's own statistic

The table was parsed directly out of the supplementary `.doc` (see
`deploy/data_transfer/hep_26208_sm_supptab1-5.doc`). Word marks every cell with
`\x07` plus one more per row, so rows are exact fixed-width token groups —
`antiword` silently drops this table and truncates the columns of the others, so
it is not used.

The parse reproduces the paper's headline result exactly, which is the check
that the columns are aligned correctly:

| | Rule-of-two + | Rule-of-two − |
|---|---|---|
| **Most-DILI-concern** | 44 | 72 |
| **No-DILI-concern** | 2 | 46 |

Odds ratio (44×46)/(72×2) = **14.06**; the paper reports **14.05**. PPV 95.7%,
sensitivity 37.9%, specificity 95.8%.

One row disagrees with a literal reading of the rule: `fenclozic acid`
(200 mg/day, logP 3.0) is marked Negative where ≥3 would make it Positive. That
is rounding in the paper's printed logP, not a parse error.

### ALogP is recomputed, not read from the CSV

`paper_logp` is what the paper printed; `alogp` is recomputed at import by RDKit
(`Crippen.MolLogP`) from `smiles` — the **same** implementation used for the drug
under assessment. Reference points and the query drug must share one logP scale,
or the ALogP ≥ 3 boundary means different things on either side of the plot.

The importer cross-checks recomputed ALogP against `paper_ro2_test` and reports
any drug that changes quadrant. A handful is expected for drugs sitting on the
line; a large count means the two scales have diverged and the plot is wrong.

Without RDKit the rows still import with `alogp` NULL, and the tool falls back to
`paper_logp` — and must say which it used.

### Structures are parent forms, not salts

Names are resolved through PubChem to the **parent** (free base), so logP is
computed on the active moiety rather than on a salt that includes a counter-ion
and may repeat the molecule. All 164 resolved with no multi-component SMILES.

### This is the derivation set, not a validation set

The rule was fitted on these drugs, so its performance here is optimistic by
construction. **Do not quote these statistics as validation.** The paper's own
independent check is its Supporting Table 2 (179 oral drugs from Greene et al.,
115 HH / 64 NE), which is present in the same `.doc` but is not imported.
