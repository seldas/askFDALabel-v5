"""Import the Chen 2013 Rule-of-Two (DILI) reference drug set.

Supporting Table 1 of Chen M, Borlak J, Tong W, Hepatology 2013;58(1):388-396:
the 164 oral drugs the rule was derived on, 116 Most-DILI-concern and 48
No-DILI-concern. Daily dose and logP are the paper's published values, so
neither plotted axis is hand-curated any more.

Idempotent — upserts by drug_name, so re-running after editing the CSV picks up
corrections.

Unlike the DrugTox importer this reads a *version-controlled* CSV under
backend/database/seed/, so it works in any environment with no prior download.

ALogP is computed here rather than taken from the CSV, so reference points and
the drug under assessment always come from one logP implementation. Without
RDKit the rows still import with alogp NULL; the tool falls back to the
paper's own logP and must say which it used.

Recomputed ALogP is checked against the paper's rule-of-two verdict on import.
A drug that lands in a different quadrant than the paper put it in is reported,
because that is the signal that the two logP scales have diverged.

    python backend/database/scripts/db_11_import_dili_reference.py [--force]
"""

import os
import sys
import csv
import argparse
from pathlib import Path
from sqlalchemy import text

# Dynamic path resolution to support both host execution and container environments
current_dir = Path(__file__).resolve().parent
repo_root = current_dir
for parent in [current_dir] + list(current_dir.parents):
    if (parent / '.env').exists() or (parent / '.env.template.txt').exists():
        repo_root = parent
        break

if (repo_root / 'backend').exists():
    sys.path.append(str(repo_root / 'backend'))
else:
    sys.path.append(str(repo_root))

from database import db, DiliRo2Reference
from dashboard import create_app

SEED_CSV = Path(__file__).resolve().parents[1] / 'seed' / 'dili_ro2_reference.csv'


def _alogp_fn():
    """Return (fn, method_label). fn is None when RDKit is unavailable."""
    try:
        from rdkit import Chem
        from rdkit.Chem import Crippen
        import rdkit
        method = f'rdkit-crippen-{getattr(rdkit, "__version__", "unknown")}'

        def compute(smiles):
            mol = Chem.MolFromSmiles(smiles)
            if mol is None:
                return None
            return round(Crippen.MolLogP(mol), 3)

        return compute, method
    except ImportError:
        return None, None


def _f(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def run_import():
    parser = argparse.ArgumentParser(description='Import DILI Rule-of-Two reference drugs')
    parser.add_argument('--force', action='store_true',
                        help='Clear the table before importing')
    args = parser.parse_args()

    app = create_app()
    with app.app_context():
        print("=== DILI Rule-of-Two Reference Importer ===")
        db.create_all()

        if not SEED_CSV.exists():
            raise FileNotFoundError(f"Seed CSV not found: {SEED_CSV}")

        if args.force:
            print("  [-] Clearing dili_ro2_reference table...")
            db.session.execute(text("TRUNCATE TABLE dili_ro2_reference RESTART IDENTITY CASCADE"))
            db.session.commit()

        compute_alogp, method = _alogp_fn()
        if compute_alogp:
            print(f"  [i] ALogP via {method}")
        else:
            print("  [!] RDKit unavailable - importing with alogp NULL "
                  "(tool will fall back to the paper's logP)")

        created = updated = unparsed = 0
        # Rows where recomputed ALogP disagrees with the published verdict.
        reclassified = []
        with open(SEED_CSV, newline='', encoding='utf-8') as fh:
            for row in csv.DictReader(fh):
                name = (row.get('drug_name') or '').strip()
                if not name:
                    continue

                alogp = None
                if compute_alogp and row.get('smiles'):
                    alogp = compute_alogp(row['smiles'])
                    if alogp is None:
                        unparsed += 1
                        print(f"  [!] RDKit could not parse SMILES for {name}")

                rec = DiliRo2Reference.query.filter_by(drug_name=name).first()
                if rec is None:
                    rec = DiliRo2Reference(drug_name=name)
                    db.session.add(rec)
                    created += 1
                else:
                    updated += 1

                rec.dilirank_compound   = row.get('dilirank_compound')
                rec.dili_concern        = row.get('dili_concern')
                rec.dili_severity_class = row.get('dili_severity_class')
                rec.max_daily_dose_mg   = _f(row.get('max_daily_dose_mg'))
                rec.dose_basis          = row.get('dose_basis')
                rec.dose_note           = row.get('dose_note')
                rec.dose_review_status  = row.get('dose_review_status') or 'needs-sme-review'
                rec.route               = row.get('route') or 'oral'
                rec.pubchem_cid         = row.get('pubchem_cid')
                rec.inchikey            = row.get('inchikey')
                rec.smiles              = row.get('smiles')
                rec.mol_weight          = _f(row.get('mol_weight'))
                rec.pubchem_xlogp3      = _f(row.get('pubchem_xlogp3'))
                rec.paper_logp          = _f(row.get('paper_logp'))
                rec.paper_ro2_test      = row.get('paper_ro2_test')
                rec.alogp               = alogp
                rec.alogp_method        = method if alogp is not None else None

                # Does our ALogP still put this drug in the paper's quadrant?
                dose = _f(row.get('max_daily_dose_mg'))
                if alogp is not None and dose is not None and rec.paper_ro2_test:
                    ours = 'Positive' if (dose >= 100 and alogp >= 3) else 'Negative'
                    if ours != rec.paper_ro2_test.strip():
                        reclassified.append(
                            (name, rec.paper_logp, alogp, rec.paper_ro2_test.strip(), ours))

        db.session.commit()
        total = DiliRo2Reference.query.count()
        print(f"  [+] Created {created}, updated {updated}, total {total}")
        if unparsed:
            print(f"  [!] {unparsed} row(s) had unparseable SMILES")
        if reclassified:
            print(f"  [!] {len(reclassified)} drug(s) changed quadrant when ALogP was "
                  f"recomputed (paper logP vs RDKit Crippen):")
            for name, plog, alog, was, now in reclassified:
                print(f"        {name}: logP {plog} -> {alog}  ({was} -> {now})")
            print("      Expected for drugs sitting on the ALogP=3 line; a large "
                  "count means the two scales have diverged.")
        print("  [i] Dose and logP are published values from Chen 2013 "
              "(PMID 23258593), not hand-curated.")


if __name__ == '__main__':
    run_import()
