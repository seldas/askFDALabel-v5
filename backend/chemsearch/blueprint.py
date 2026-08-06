"""
Chemical Structure Search blueprint.

Provides two endpoints:

  GET  /api/chemsearch/validate   — quick SMILES/InChI syntax check
  POST /api/chemsearch/search     — find drug labels by structure

The search pulls SMILES strings from the Oracle DRUGLABEL.UNII_CHEM_STRUCT
table, screens them with RDKit in Python (exact / substructure / similarity),
then resolves the matching UNIIs to drug-label rows via SUM_SPL.

If RDKit is not installed, exact match is still offered via a plain SQL
equality on the SMILES column. Substructure and similarity return 501.
If Oracle is unreachable the whole search returns a clear 503.
"""

import json
from flask import Blueprint, request, jsonify

# ---------------------------------------------------------------------------
# Optional RDKit import — degrades gracefully when not installed.
# ---------------------------------------------------------------------------
try:
    from rdkit import Chem
    from rdkit.Chem import DataStructs
    from rdkit.Chem.rdMorganDescriptors import GetMorganFingerprintAsBitVect
    RDKIT_AVAILABLE = True
except ImportError:
    RDKIT_AVAILABLE = False

chemsearch_bp = Blueprint('chemsearch', __name__)

# Columns to pull from SUM_SPL — mirrors the labelquery execute response shape.
_SUM_SPL_COLS = """
    s.SET_ID, s.SPL_GUID as SPL_ID, s.PRODUCT_NAMES, s.PRODUCT_NORMD_GENERIC_NAMES as GENERIC_NAMES,
    s.AUTHOR_ORG_NORMD_NAME as MANUFACTURER, s.APPR_NUM, s.NDC_CODES,
    s.EFF_TIME as REVISED_DATE, s.MARKET_CATEGORIES, s.DOCUMENT_TYPE,
    s.ACT_INGR_NAMES as ACTIVE_INGREDIENTS, s.DOSAGE_FORMS,
    s.ROUTES_OF_ADMINISTRATION as ROUTES, s.EPC, s.ACT_INGR_UNIIS as ACTIVE_UNIIS
""".strip()


def _oracle():
    """Return an Oracle connection or raise RuntimeError."""
    from dashboard.services.fdalabel_db import FDALabelDBService
    conn = FDALabelDBService.get_oracle_connection()
    if conn is None:
        raise RuntimeError('Oracle database is not available. Chemical structure search requires an FDA network connection.')
    return conn


def _canonicalize(smiles: str):
    """Return canonical SMILES, or None if invalid / RDKit unavailable."""
    if not RDKIT_AVAILABLE:
        return smiles.strip()   # pass through for exact SQL match
    mol = Chem.MolFromSmiles(smiles.strip())
    if mol is None:
        return None
    return Chem.MolToSmiles(mol)


def _morgan_fp(mol, radius=2, nbits=2048):
    return GetMorganFingerprintAsBitVect(mol, radius, nBits=nbits)


def _fetch_all_structures(conn):
    """
    Pull all (UNII, SMILES) rows from UNII_CHEM_STRUCT.
    The table is small (~10 k rows) so a full fetch is fine.
    Returns a list of (unii, smiles) tuples, skipping nulls.
    """
    cursor = conn.cursor()
    cursor.execute('SELECT UNII, SMILES FROM druglabel.UNII_CHEM_STRUCT WHERE SMILES IS NOT NULL')
    rows = cursor.fetchall()
    cursor.close()
    return [(r[0], r[1]) for r in rows if r[1]]


def _labels_for_uniis(conn, unii_list):
    """
    Given a list of UNII strings return drug-label summary rows.
    Joins SUM_SPL through SUM_SPL_ACT_INGR_UNII.
    Returns a list of dicts.
    """
    if not unii_list:
        return []

    # Oracle doesn't support psycopg2-style IN (:v1, :v2, ...) with variable
    # length easily, so we build a bind-variable list dynamically.
    placeholders = ', '.join(f':u{i}' for i in range(len(unii_list)))
    params = {f'u{i}': v for i, v in enumerate(unii_list)}

    sql = f"""
        SELECT DISTINCT {_SUM_SPL_COLS},
               ai.UNII as MATCH_UNII,
               (SELECT COUNT(*) FROM druglabel.SUM_SPL_RLD_RS rld
                WHERE rld.SPL_ID = s.SPL_ID AND rld.REFERENCE_DRUG = 'Y') as IS_RLD
        FROM druglabel.SUM_SPL s
        JOIN druglabel.SUM_SPL_ACT_INGR_UNII ai ON ai.SPL_ID = s.SPL_ID
        WHERE ai.UNII IN ({placeholders})
        ORDER BY s.EFF_TIME DESC NULLS LAST
    """
    cursor = conn.cursor()
    cursor.execute(sql, params)
    columns = [d[0].lower() for d in cursor.description]
    rows = [dict(zip(columns, row)) for row in cursor.fetchall()]
    cursor.close()
    return rows


def _row_to_result(row: dict, scores: dict, match_type: str) -> dict:
    """Merge a label row dict with its per-UNII score."""
    unii = row.get('match_unii')
    score = scores.get(unii) if unii else None
    return {
        'set_id':              row.get('set_id'),
        'spl_id':              row.get('spl_id'),
        'product_names':       row.get('product_names'),
        'generic_names':       row.get('generic_names'),
        'manufacturer':        row.get('manufacturer'),
        'appr_num':            row.get('appr_num'),
        'ndc_codes':           row.get('ndc_codes'),
        'revised_date':        row.get('revised_date'),
        'market_categories':   row.get('market_categories'),
        'doc_type':            row.get('document_type'),
        'active_ingredients':  row.get('active_ingredients'),
        'dosage_forms':        row.get('dosage_forms'),
        'routes':              row.get('routes'),
        'epc':                 row.get('epc'),
        'active_uniis':        row.get('active_uniis'),
        'is_rld':              row.get('is_rld', 0),
        'is_rs':               None,
        'initial_approval_year': None,
        # Chem-search extras
        'match_unii':          unii,
        'match_score':         round(score, 4) if score is not None else None,
        'match_type':          match_type,
    }


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@chemsearch_bp.route('/validate', methods=['GET'])
def validate():
    """
    Quick SMILES/InChI syntax check.
    GET /api/chemsearch/validate?smiles=CC(=O)Oc1ccccc1C(=O)O
    """
    smiles = (request.args.get('smiles') or '').strip()
    if not smiles:
        return jsonify({'valid': False, 'error': 'No SMILES provided.'}), 400

    if not RDKIT_AVAILABLE:
        return jsonify({'valid': True, 'canonical': smiles, 'warning': 'RDKit not installed; validation skipped.'})

    mol = Chem.MolFromSmiles(smiles)
    if mol is None:
        return jsonify({'valid': False, 'error': 'Invalid SMILES string.'})

    canonical = Chem.MolToSmiles(mol)
    return jsonify({'valid': True, 'canonical': canonical})


@chemsearch_bp.route('/search', methods=['POST'])
def search():
    """
    POST /api/chemsearch/search
    Body:
      {
        "smiles":     "CC(=O)Oc1ccccc1C(=O)O",
        "match":      "exact" | "substructure" | "similarity",
        "threshold":  0.7,      // only for similarity, default 0.7
        "limit":      50,
        "offset":     0
      }
    """
    data = request.get_json(force=True, silent=True) or {}
    raw_smiles   = (data.get('smiles') or '').strip()
    match_type   = (data.get('match') or 'exact').lower()
    threshold    = float(data.get('threshold') or 0.7)
    limit        = min(int(data.get('limit') or 50), 500)
    offset       = int(data.get('offset') or 0)

    if not raw_smiles:
        return jsonify({'error': 'No SMILES string provided.'}), 400

    if match_type not in ('exact', 'substructure', 'similarity'):
        return jsonify({'error': f'Unknown match type: {match_type!r}. Use exact, substructure, or similarity.'}), 400

    if match_type in ('substructure', 'similarity') and not RDKIT_AVAILABLE:
        return jsonify({
            'error': f'{match_type.capitalize()} search requires RDKit, which is not installed on this server.',
            'hint': 'Use "exact" match, or contact the administrator to install rdkit.'
        }), 501

    # Canonicalize / validate
    canonical = _canonicalize(raw_smiles)
    if canonical is None:
        return jsonify({'error': 'Invalid SMILES string; could not parse the molecule.'}), 400

    warnings = []

    try:
        conn = _oracle()
    except RuntimeError as e:
        return jsonify({'error': str(e)}), 503

    try:
        # ----------------------------------------------------------------
        # Exact match — pure SQL, no full-table fetch needed
        # ----------------------------------------------------------------
        if match_type == 'exact':
            cursor = conn.cursor()
            cursor.execute(
                'SELECT UNII FROM druglabel.UNII_CHEM_STRUCT WHERE SMILES = :s',
                {'s': canonical}
            )
            exact_uniis = [r[0] for r in cursor.fetchall()]
            cursor.close()

            if not exact_uniis and RDKIT_AVAILABLE:
                # Try the original SMILES too in case the stored string isn't canonical
                cursor = conn.cursor()
                cursor.execute(
                    'SELECT UNII FROM druglabel.UNII_CHEM_STRUCT WHERE SMILES = :s',
                    {'s': raw_smiles}
                )
                extra = [r[0] for r in cursor.fetchall()]
                cursor.close()
                exact_uniis = list(set(exact_uniis + extra))
                if extra:
                    warnings.append(
                        'Exact match found using the raw SMILES rather than the canonical form, '
                        'which may indicate non-canonical SMILES in the database.'
                    )

            matched_uniis = exact_uniis
            scores = {}     # no score for exact

        # ----------------------------------------------------------------
        # Substructure / similarity — fetch all, screen in Python
        # ----------------------------------------------------------------
        else:
            all_structs = _fetch_all_structures(conn)
            query_mol = Chem.MolFromSmiles(canonical)
            if query_mol is None:
                return jsonify({'error': 'Could not build query molecule from SMILES.'}), 400

            matched_uniis = []
            scores = {}

            if match_type == 'substructure':
                for unii, smi in all_structs:
                    try:
                        mol = Chem.MolFromSmiles(smi)
                        if mol and mol.HasSubstructMatch(query_mol):
                            matched_uniis.append(unii)
                    except Exception:
                        pass
            else:  # similarity
                qfp = _morgan_fp(query_mol)
                for unii, smi in all_structs:
                    try:
                        mol = Chem.MolFromSmiles(smi)
                        if not mol:
                            continue
                        fp = _morgan_fp(mol)
                        sim = DataStructs.TanimotoSimilarity(qfp, fp)
                        if sim >= threshold:
                            matched_uniis.append(unii)
                            scores[unii] = sim
                    except Exception:
                        pass

                # Sort by descending similarity before we go to SQL
                matched_uniis.sort(key=lambda u: scores.get(u, 0), reverse=True)

        # ----------------------------------------------------------------
        # Resolve UNIIs → label rows
        # ----------------------------------------------------------------
        label_rows = _labels_for_uniis(conn, matched_uniis)
        total = len(label_rows)

        # Pagination
        page_rows = label_rows[offset: offset + limit]

        results = [_row_to_result(r, scores, match_type) for r in page_rows]

        return jsonify({
            'results':      results,
            'total':        total,
            'limit':        limit,
            'offset':       offset,
            'query_smiles': canonical,
            'match':        match_type,
            'threshold':    threshold if match_type == 'similarity' else None,
            'matched_uniis_count': len(matched_uniis),
            'warnings':     warnings,
        })

    except Exception as e:
        return jsonify({'error': f'Search failed: {str(e)}'}), 500
    finally:
        try:
            conn.close()
        except Exception:
            pass
