"""Import the Rule-of-Two (DILI) reference drug set.

Idempotent — upserts by drug_name, so re-running after editing the CSV picks up
corrections (notably max_daily_dose_mg, which ships flagged for SME review).

Unlike the DrugTox importer this reads a *version-controlled* CSV under
backend/database/seed/, so it works in any environment with no prior download.

ALogP is computed here rather than stored in the CSV, so reference points and
the drug under assessment always come from one logP implementation. Without
RDKit the rows still import with alogp NULL; the tool falls back to
pubchem_xlogp3 and must say which it used.

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
                  "(tool will fall back to pubchem_xlogp3)")

        created = updated = unparsed = 0
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
                rec.alogp               = alogp
                rec.alogp_method        = method if alogp is not None else None

        db.session.commit()
        total = DiliRo2Reference.query.count()
        print(f"  [+] Created {created}, updated {updated}, total {total}")
        if unparsed:
            print(f"  [!] {unparsed} row(s) had unparseable SMILES")
        print("  [i] max_daily_dose_mg is hand-curated and flagged "
              "'needs-sme-review' - verify before relying on it.")


if __name__ == '__main__':
    run_import()
