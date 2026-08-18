# Seed data

Small, version-controlled reference datasets that must be importable in **any**
environment (local, Docker, internal FDA). Unlike `data/downloads/*.xlsx` — which
is gitignored and machine-local — everything here travels with the repo.

## `dili_ro2_reference.csv`

Fixed reference drugs for the **Rule-of-Two (DILI)** tool's quadrant plot. These
are plotted as static background points so a user can see where the drug under
assessment falls relative to well-characterised compounds. They are *never*
recomputed per request.

66 oral drugs, spanning all four dose/lipophilicity quadrants.

### Provenance, per column

| Column | Source | Trust |
|---|---|---|
| `dili_concern`, `dili_severity_class`, `dilirank_compound` | FDA **DILIrank 2.0** via the PubChem LTKB annotation API | Authoritative, public domain |
| `pubchem_cid`, `inchikey`, `smiles`, `mol_weight`, `pubchem_xlogp3` | PubChem PUG REST, **parent** (free-base) record | Authoritative |
| `max_daily_dose_mg`, `dose_basis`, `dose_note` | Hand-curated from FDA labeling / standard references | **Needs SME review** |

`dose_review_status` is `needs-sme-review` on every row. Doses are the only
hand-curated field and the only plausible source of error; `dose_basis` records
how each number was derived (`label-max`, `maintenance`, `weight-based` at a
60 kg reference weight, `typical-max`) so a reviewer can re-check it quickly.

### ALogP is deliberately NOT stored

`pubchem_xlogp3` is carried for cross-checking only. The plotted ALogP is
computed at import time by RDKit (`Crippen.MolLogP`) from the `smiles` column —
the **same** implementation used for the drug under assessment. Storing a
literature ALogP would put reference points and the query drug on different
scales and silently distort the quadrant boundaries.

### Structures are parent forms, not salts

DILIrank keys many entries to a salt (e.g. `Diclofenac sodium`, `Atorvastatin
calcium`) and to that salt's CID. `smiles` is resolved to the **parent** so
logP is computed on the free base. `dilirank_compound` preserves the original
DILIrank string for traceability.

### This is NOT a validation set

The set is deliberately enriched with famous hepatotoxicants (36 of 66 are
vMost-DILI-concern), so prevalence is far above the real-world base rate. Under
a binary hepatotoxicity endpoint it reproduces the published high PPV (100% here
vs ~96% reported) but its NPV is meaningless (5%). **Do not quote performance
statistics from this file.** For actual validation, use the full DILIrank 2.0
dataset.

### Known exclusion

**Methotrexate** is omitted despite being a well-known hepatotoxicant: oral
low-dose methotrexate is dosed *weekly*, so "maximum daily dose" is not a
meaningful quantity for it. It is exactly the kind of drug the tool's
qualification gate should refuse to score rather than score wrongly.

### Citation

Chen M, Borlak J, Tong W. High lipophilicity and high daily dose of oral
medications are associated with significant risk for drug-induced liver injury.
*Hepatology*. 2013;58(1):388-396. doi:10.1002/hep.26208 (PMID 23258593)

Thakkar S, et al. DILIrank 2.0. *Drug Discov Today*. 2025. (PMID 41005561)
