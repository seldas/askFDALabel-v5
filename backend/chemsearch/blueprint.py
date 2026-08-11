"""
Chemical Structure Search blueprint.

Provides two endpoints:

  GET  /api/chemsearch/validate   — quick SMILES/InChI/InChIKey syntax check
  POST /api/chemsearch/search     — find drug labels by structure

Input formats accepted:
  - SMILES   — parsed natively by RDKit
  - InChI    — parsed natively by RDKit (rdkit.Chem.inchi.MolFromInchi)
  - InChIKey — 27-char hash; resolved via PubChem PUG REST API (external
               network required). If PubChem is unreachable the endpoint
               returns a clear error asking the user to provide SMILES/InChI.

The search pulls SMILES strings from the Oracle DRUGLABEL.UNII_CHEM_STRUCT
table, screens them with RDKit in Python (exact / substructure / similarity),
then resolves the matching UNIIs to drug-label rows via SUM_SPL.

Two caches keep that off the hot path. The structure library — parsed
molecules plus Morgan and pattern fingerprints — is built once per worker and
reused for a day. Screening results are keyed by the query and held for
minutes, so paging through a result set does not re-screen the library.
GET /status reports the state of both.

If RDKit is not installed, exact match is still offered via a plain SQL
equality on the SMILES column. Substructure and similarity return 501.
If RDKit is present but exposes no usable Morgan fingerprint API, only
similarity returns 501. If Oracle is unreachable the whole search returns
a clear 503.
"""

import re
import urllib.request
import urllib.error
import json
import os
import time
import hashlib
import logging
import threading
from collections import OrderedDict
from flask import Blueprint, request, jsonify

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Optional RDKit import — degrades gracefully when not installed.
#
# Only Chem + DataStructs gate RDKIT_AVAILABLE (parsing, canonicalization and
# substructure need nothing else). Morgan fingerprints are resolved separately
# so that a fingerprint API change in a future RDKit release disables only
# similarity search instead of silently switching the whole module off.
# ---------------------------------------------------------------------------
try:
    from rdkit import Chem
    from rdkit import DataStructs
    try:
        from rdkit.Chem.inchi import MolFromInchi
    except ImportError:
        # Older RDKit versions expose it directly on Chem
        MolFromInchi = getattr(Chem, 'MolFromInchi', None)
    import rdkit as _rdkit
    RDKIT_VERSION = getattr(_rdkit, '__version__', None)
    RDKIT_AVAILABLE = True
except ImportError:
    RDKIT_AVAILABLE = False
    RDKIT_VERSION = None
    MolFromInchi = None

# Morgan fingerprint backend: the generator API is current (RDKit >= 2022.09);
# GetMorganFingerprintAsBitVect is the deprecated fallback for older builds.
_FP_BITS = 2048
_MORGAN_GEN = None
_MORGAN_LEGACY = None
if RDKIT_AVAILABLE:
    try:
        from rdkit.Chem import rdFingerprintGenerator as _rfg
        _MORGAN_GEN = _rfg.GetMorganGenerator(radius=2, fpSize=_FP_BITS)
    except Exception:
        try:
            from rdkit.Chem.rdMolDescriptors import (
                GetMorganFingerprintAsBitVect as _MORGAN_LEGACY,
            )
        except ImportError:
            _MORGAN_LEGACY = None

FINGERPRINT_AVAILABLE = _MORGAN_GEN is not None or _MORGAN_LEGACY is not None

# Oracle allows at most 1000 expressions in an IN (...) list, so UNII lookups
# are issued in chunks below that ceiling.
_ORACLE_IN_CHUNK = 900

# --- Cache tuning ----------------------------------------------------------
# UNII_CHEM_STRUCT changes rarely, so the parsed structure library is held for
# a day. Screening results are held far more briefly — just long enough to
# cover a user paging through one result set.
_STRUCT_TTL      = int(os.getenv('CHEMSEARCH_STRUCT_TTL', 24 * 3600))
_RESULT_TTL      = int(os.getenv('CHEMSEARCH_RESULT_TTL', 900))
_RESULT_MAX_KEYS = int(os.getenv('CHEMSEARCH_RESULT_MAX_KEYS', 16))
# Result sets larger than this are screened but never cached, to bound memory.
_RESULT_MAX_ROWS = int(os.getenv('CHEMSEARCH_RESULT_MAX_ROWS', 20000))

# InChIKey pattern: 3 blocks of uppercase letters separated by hyphens (27 chars total)
_INCHIKEY_RE = re.compile(r'^[A-Z]{14}-[A-Z]{10}-[A-Z]$')

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


def _detect_format(s: str) -> str:
    """Return 'inchikey', 'inchi', or 'smiles' based on the input string."""
    s = s.strip()
    if _INCHIKEY_RE.match(s):
        return 'inchikey'
    if s.upper().startswith('INCHI='):
        return 'inchi'
    return 'smiles'


def _inchikey_to_smiles(inchikey: str) -> tuple:
    """
    Resolve an InChIKey to canonical SMILES via PubChem PUG REST API.
    Returns (smiles, error_message). On success error_message is None.
    On failure smiles is None and error_message describes the problem.
    """
    url = (
        'https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/inchikey/'
        f'{inchikey}/property/IsomericSMILES/JSON'
    )
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'FDALabel-ChemSearch/1.0'})
        with urllib.request.urlopen(req, timeout=8) as resp:
            data = json.loads(resp.read().decode())
        smiles = data['PropertyTable']['Properties'][0]['IsomericSMILES']
        return smiles, None
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None, (
                f'InChIKey "{inchikey}" was not found in PubChem. '
                'Please provide the structure as a SMILES or InChI string instead.'
            )
        return None, (
            f'PubChem returned HTTP {e.code} while resolving this InChIKey. '
            'Please provide the structure as a SMILES or InChI string instead.'
        )
    except urllib.error.URLError:
        return None, (
            'Could not reach the PubChem API to resolve this InChIKey '
            '(network unreachable or timed out). '
            'Please provide the structure as a SMILES or InChI string instead.'
        )
    except Exception:
        return None, (
            'Unexpected error resolving InChIKey via PubChem. '
            'Please provide the structure as a SMILES or InChI string instead.'
        )


def _parse_input(raw: str):
    """
    Parse a SMILES, InChI, or InChIKey string into a canonical SMILES.

    Returns a dict with keys:
      canonical  — canonical SMILES string (None on failure)
      fmt        — detected format ('smiles' | 'inchi' | 'inchikey')
      error      — error message string (None on success)
      warning    — optional warning string (None if none)
    """
    s = raw.strip()
    fmt = _detect_format(s)
    result = {'fmt': fmt, 'canonical': None, 'error': None, 'warning': None}

    # --- InChIKey: resolve via PubChem, then parse the returned SMILES -------
    if fmt == 'inchikey':
        pubchem_smiles, err = _inchikey_to_smiles(s)
        if err:
            result['error'] = err
            return result
        result['warning'] = (
            f'InChIKey resolved via PubChem → SMILES: {pubchem_smiles}'
        )
        s = pubchem_smiles
        fmt = 'smiles'      # fall through to SMILES parsing below

    # --- InChI ----------------------------------------------------------------
    if fmt == 'inchi':
        if not RDKIT_AVAILABLE:
            result['error'] = 'InChI input requires RDKit, which is not installed on this server.'
            return result
        if MolFromInchi is None:
            result['error'] = (
                'InChI parsing is not available in this version of RDKit. '
                'Please provide a SMILES string instead.'
            )
            return result
        mol = MolFromInchi(s)
        if mol is None:
            result['error'] = 'Invalid InChI string; could not parse the molecule.'
            return result
        result['canonical'] = Chem.MolToSmiles(mol)
        return result

    # --- SMILES (default) -----------------------------------------------------
    if not RDKIT_AVAILABLE:
        result['canonical'] = s     # pass through for exact SQL fallback
        return result
    mol = Chem.MolFromSmiles(s)
    if mol is None:
        result['error'] = 'Invalid SMILES string; could not parse the molecule.'
        return result
    result['canonical'] = Chem.MolToSmiles(mol)
    return result


def _morgan_fp(mol, radius=2, nbits=_FP_BITS):
    """Morgan (ECFP4) bit-vector fingerprint, generator API preferred."""
    if _MORGAN_GEN is not None:
        return _MORGAN_GEN.GetFingerprint(mol)
    return _MORGAN_LEGACY(mol, radius, nBits=nbits)


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


# ---------------------------------------------------------------------------
# Structure library cache
#
# Parsing 10 k SMILES on every request dominated the cost of substructure and
# similarity search. The library is parsed once per worker into three parallel
# arrays and reused: Morgan fingerprints for bulk Tanimoto, pattern
# fingerprints as a substructure screen, and binary mol blobs so survivors of
# that screen can be rehydrated (~4x faster than re-parsing SMILES) instead of
# holding 10 k live molecules in memory.
# ---------------------------------------------------------------------------

class _StructureLibrary:
    __slots__ = ('uniis', 'blobs', 'morgans', 'patterns', 'built_at', 'build_seconds', 'skipped')

    def __init__(self):
        self.uniis = []
        self.blobs = []
        self.morgans = []
        self.patterns = []
        self.built_at = 0.0
        self.build_seconds = 0.0
        self.skipped = 0

    @property
    def size(self):
        return len(self.uniis)

    @property
    def age(self):
        return time.time() - self.built_at


_struct_lib = None
_struct_lock = threading.Lock()


def _build_structure_library(conn):
    """Parse every stored SMILES once and precompute its fingerprints."""
    started = time.perf_counter()
    lib = _StructureLibrary()

    for unii, smi in _fetch_all_structures(conn):
        try:
            mol = Chem.MolFromSmiles(smi)
        except Exception:
            mol = None
        if mol is None:
            lib.skipped += 1
            continue
        try:
            pattern = Chem.PatternFingerprint(mol, fpSize=_FP_BITS)
            morgan = _morgan_fp(mol) if FINGERPRINT_AVAILABLE else None
            blob = mol.ToBinary()
        except Exception:
            lib.skipped += 1
            continue
        lib.uniis.append(unii)
        lib.blobs.append(blob)
        lib.patterns.append(pattern)
        if morgan is not None:
            lib.morgans.append(morgan)

    lib.built_at = time.time()
    lib.build_seconds = time.perf_counter() - started
    logger.info(
        'chemsearch: structure library built — %d structures, %d unparseable, %.2fs',
        lib.size, lib.skipped, lib.build_seconds,
    )
    return lib


def _get_structure_library(conn):
    """Return the cached structure library, rebuilding it when stale."""
    global _struct_lib

    lib = _struct_lib
    if lib is not None and lib.age < _STRUCT_TTL:
        return lib

    with _struct_lock:
        # Another thread may have rebuilt it while we waited for the lock.
        lib = _struct_lib
        if lib is not None and lib.age < _STRUCT_TTL:
            return lib
        _struct_lib = _build_structure_library(conn)
        return _struct_lib


# ---------------------------------------------------------------------------
# Screening-result cache
#
# Paging through a result set re-ran the whole screen for every page. Screen
# output (matched UNIIs + scores) is keyed by the query itself, so pages after
# the first — and repeat queries — skip the structure work entirely.
#
# Redis is shared across gunicorn workers, so a page served by a different
# worker still hits. The in-process ring is the fallback when Redis is absent
# (local dev, or a Redis outage) and never grows past _RESULT_MAX_KEYS.
# ---------------------------------------------------------------------------

_local_results = OrderedDict()
_local_lock = threading.Lock()
_redis_client = False        # False = not yet probed, None = unavailable


def _redis():
    global _redis_client
    if _redis_client is not False:
        return _redis_client
    try:
        import redis
        url = os.getenv('CELERY_BROKER_URL', 'redis://localhost:6379/0')
        client = redis.Redis.from_url(url, socket_timeout=2, socket_connect_timeout=2)
        client.ping()
        _redis_client = client
    except Exception as e:
        logger.info('chemsearch: Redis unavailable (%s); using in-process result cache', e)
        _redis_client = None
    return _redis_client


def _result_key(canonical, match_type, threshold):
    raw = f'{canonical}|{match_type}|{threshold if match_type == "similarity" else ""}'
    return 'chemsearch:screen:' + hashlib.sha256(raw.encode()).hexdigest()[:32]


def _cache_get(key):
    """Return {'uniis': [...], 'scores': {...}} or None."""
    client = _redis()
    if client is not None:
        try:
            blob = client.get(key)
            if blob:
                return json.loads(blob)
        except Exception as e:
            logger.warning('chemsearch: Redis read failed (%s)', e)

    with _local_lock:
        entry = _local_results.get(key)
        if entry is None:
            return None
        if time.time() - entry['stored_at'] > _RESULT_TTL:
            _local_results.pop(key, None)
            return None
        _local_results.move_to_end(key)
        return entry['value']


def _cache_put(key, uniis, scores):
    if len(uniis) > _RESULT_MAX_ROWS:
        return
    value = {'uniis': uniis, 'scores': scores}

    client = _redis()
    if client is not None:
        try:
            client.setex(key, _RESULT_TTL, json.dumps(value))
            return
        except Exception as e:
            logger.warning('chemsearch: Redis write failed (%s)', e)

    with _local_lock:
        _local_results[key] = {'value': value, 'stored_at': time.time()}
        _local_results.move_to_end(key)
        while len(_local_results) > _RESULT_MAX_KEYS:
            _local_results.popitem(last=False)


def _screen(conn, query_mol, match_type, threshold):
    """
    Run substructure or similarity screening over the cached structure library.
    Returns (matched_uniis, scores).
    """
    lib = _get_structure_library(conn)
    matched = []
    scores = {}

    if match_type == 'substructure':
        query_pattern = Chem.PatternFingerprint(query_mol, fpSize=_FP_BITS)
        for i, pattern in enumerate(lib.patterns):
            # Cheap bit-level screen first; only survivors are rehydrated and
            # put through the real (expensive) graph match.
            if not DataStructs.AllProbeBitsMatch(query_pattern, pattern):
                continue
            try:
                mol = Chem.Mol(lib.blobs[i])
            except Exception:
                continue
            if mol.HasSubstructMatch(query_mol):
                matched.append(lib.uniis[i])
        return matched, scores

    # Similarity — one bulk C++ loop over precomputed fingerprints.
    query_fp = _morgan_fp(query_mol)
    sims = DataStructs.BulkTanimotoSimilarity(query_fp, lib.morgans)
    for i, sim in enumerate(sims):
        if sim >= threshold:
            unii = lib.uniis[i]
            matched.append(unii)
            scores[unii] = sim

    matched.sort(key=lambda u: scores.get(u, 0), reverse=True)
    return matched, scores


def _labels_for_uniis(conn, unii_list):
    """
    Given a list of UNII strings return drug-label summary rows.
    Joins SUM_SPL through SUM_SPL_ACT_INGR_UNII.
    Returns a list of dicts.
    """
    if not unii_list:
        return []

    rows = []
    seen = set()
    cursor = conn.cursor()
    try:
        # Oracle caps an IN (...) list at 1000 expressions, and a broad
        # substructure query can easily match more UNIIs than that, so the
        # lookup is chunked and the result sets merged here.
        for start in range(0, len(unii_list), _ORACLE_IN_CHUNK):
            chunk = unii_list[start:start + _ORACLE_IN_CHUNK]

            # Oracle doesn't support psycopg2-style IN (:v1, :v2, ...) with
            # variable length easily, so we build a bind-variable list
            # dynamically.
            placeholders = ', '.join(f':u{i}' for i in range(len(chunk)))
            params = {f'u{i}': v for i, v in enumerate(chunk)}

            sql = f"""
                SELECT DISTINCT {_SUM_SPL_COLS},
                       ai.UNII as MATCH_UNII,
                       (SELECT COUNT(*) FROM druglabel.SUM_SPL_RLD_RS rld
                        WHERE rld.SPL_ID = s.SPL_ID AND rld.REFERENCE_DRUG = 'Y') as IS_RLD
                FROM druglabel.SUM_SPL s
                JOIN druglabel.SUM_SPL_ACT_INGR_UNII ai ON ai.SPL_ID = s.SPL_ID
                WHERE ai.UNII IN ({placeholders})
            """
            cursor.execute(sql, params)
            columns = [d[0].lower() for d in cursor.description]
            for row in cursor.fetchall():
                d = dict(zip(columns, row))
                key = (d.get('spl_id'), d.get('match_unii'))
                if key in seen:
                    continue
                seen.add(key)
                rows.append(d)
    finally:
        cursor.close()
    return rows


def _eff_time_key(row: dict):
    """Sort key for EFF_TIME that tolerates NULLs and DATE/VARCHAR columns."""
    return str(row.get('revised_date') or '')


def _sort_rows(rows: list, scores: dict, match_type: str) -> list:
    """
    Order label rows for presentation. ORDER BY moved out of SQL because the
    UNII lookup is chunked, so no single query sees the whole result set.
    Similarity ranks by Tanimoto first — otherwise the best matches can fall
    off the far side of pagination.
    """
    if match_type == 'similarity':
        return sorted(
            rows,
            key=lambda r: (scores.get(r.get('match_unii'), 0.0), _eff_time_key(r)),
            reverse=True,
        )
    return sorted(rows, key=_eff_time_key, reverse=True)


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

@chemsearch_bp.route('/status', methods=['GET'])
def status():
    """
    Diagnostics for the chemistry backend: which match modes are live and
    whether the structure library is warm. Reports capability only — it never
    touches Oracle, so it answers even when the FDA network is unreachable.
    """
    lib = _struct_lib
    return jsonify({
        'rdkit_available':       RDKIT_AVAILABLE,
        'rdkit_version':         RDKIT_VERSION,
        'fingerprint_available': FINGERPRINT_AVAILABLE,
        'morgan_backend':        ('generator' if _MORGAN_GEN is not None
                                  else 'legacy' if _MORGAN_LEGACY is not None else None),
        'modes': {
            'exact':        True,
            'substructure': RDKIT_AVAILABLE,
            'similarity':   RDKIT_AVAILABLE and FINGERPRINT_AVAILABLE,
        },
        'structure_library': {
            'loaded':        lib is not None,
            'structures':    lib.size if lib else 0,
            'unparseable':   lib.skipped if lib else 0,
            'age_seconds':   round(lib.age, 1) if lib else None,
            'build_seconds': round(lib.build_seconds, 2) if lib else None,
            'ttl_seconds':   _STRUCT_TTL,
        },
        'result_cache': {
            'backend':     'redis' if _redis() is not None else 'in-process',
            'ttl_seconds': _RESULT_TTL,
            'local_keys':  len(_local_results),
        },
    })


@chemsearch_bp.route('/validate', methods=['GET'])
def validate():
    """
    Quick SMILES / InChI / InChIKey syntax check.
    GET /api/chemsearch/validate?smiles=<input>
    The query parameter is named 'smiles' for backwards compatibility but
    accepts SMILES, InChI, and InChIKey strings.
    """
    raw = (request.args.get('smiles') or '').strip()
    if not raw:
        return jsonify({'valid': False, 'error': 'No structure provided.'}), 400

    parsed = _parse_input(raw)
    if parsed['error']:
        return jsonify({'valid': False, 'error': parsed['error'], 'fmt': parsed['fmt']})

    resp = {'valid': True, 'canonical': parsed['canonical'], 'fmt': parsed['fmt']}
    if parsed['warning']:
        resp['warning'] = parsed['warning']
    return jsonify(resp)


@chemsearch_bp.route('/search', methods=['POST'])
def search():
    """
    POST /api/chemsearch/search
    Body:
      {
        "smiles":     "CC(=O)Oc1ccccc1C(=O)O",   // SMILES, InChI, or InChIKey
        "match":      "exact" | "substructure" | "similarity",
        "threshold":  0.7,      // only for similarity, default 0.7
        "limit":      50,
        "offset":     0
      }
    The "smiles" field accepts SMILES, InChI, or InChIKey strings.
    """
    data = request.get_json(force=True, silent=True) or {}
    raw_input    = (data.get('smiles') or '').strip()
    match_type   = (data.get('match') or 'exact').lower()
    threshold    = float(data.get('threshold') or 0.7)
    limit        = min(int(data.get('limit') or 50), 500)
    offset       = int(data.get('offset') or 0)

    if not raw_input:
        return jsonify({'error': 'No structure provided. Supply a SMILES, InChI, or InChIKey string.'}), 400

    if match_type not in ('exact', 'substructure', 'similarity'):
        return jsonify({'error': f'Unknown match type: {match_type!r}. Use exact, substructure, or similarity.'}), 400

    if match_type in ('substructure', 'similarity') and not RDKIT_AVAILABLE:
        return jsonify({
            'error': f'{match_type.capitalize()} search requires RDKit, which is not installed on this server.',
            'hint': 'Use "exact" match, or contact the administrator to install rdkit.'
        }), 501

    if match_type == 'similarity' and not FINGERPRINT_AVAILABLE:
        return jsonify({
            'error': 'Similarity search requires Morgan fingerprint support, which this '
                     'RDKit build does not expose.',
            'hint': 'Use "exact" or "substructure" match, or contact the administrator '
                    'to upgrade rdkit.'
        }), 501

    # Parse / canonicalize — handles SMILES, InChI, InChIKey
    parsed = _parse_input(raw_input)
    if parsed['error']:
        return jsonify({'error': parsed['error']}), 400

    canonical = parsed['canonical']
    warnings = []
    if parsed['warning']:
        warnings.append(parsed['warning'])

    # A cached screen makes pagination cheap: pages after the first skip the
    # structure work entirely and go straight to the label lookup.
    cache_key = _result_key(canonical, match_type, threshold)
    cached = _cache_get(cache_key) if match_type != 'exact' else None
    cache_hit = cached is not None

    try:
        conn = _oracle()
    except RuntimeError as e:
        return jsonify({'error': str(e)}), 503

    try:
        # ----------------------------------------------------------------
        # Cached screen — matched UNIIs and scores are already known
        # ----------------------------------------------------------------
        if cache_hit:
            matched_uniis = cached['uniis']
            scores = cached['scores']

        # ----------------------------------------------------------------
        # Exact match — pure SQL, no full-table fetch needed
        # ----------------------------------------------------------------
        elif match_type == 'exact':
            cursor = conn.cursor()
            cursor.execute(
                'SELECT UNII FROM druglabel.UNII_CHEM_STRUCT WHERE SMILES = :s',
                {'s': canonical}
            )
            exact_uniis = [r[0] for r in cursor.fetchall()]
            cursor.close()

            if not exact_uniis and RDKIT_AVAILABLE and raw_input != canonical:
                # Try the original SMILES too in case the stored string isn't canonical
                cursor = conn.cursor()
                cursor.execute(
                    'SELECT UNII FROM druglabel.UNII_CHEM_STRUCT WHERE SMILES = :s',
                    {'s': raw_input}
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
        # Substructure / similarity — screen the cached structure library
        # ----------------------------------------------------------------
        else:
            query_mol = Chem.MolFromSmiles(canonical)
            if query_mol is None:
                return jsonify({'error': 'Could not build query molecule from SMILES.'}), 400

            matched_uniis, scores = _screen(conn, query_mol, match_type, threshold)
            _cache_put(cache_key, matched_uniis, scores)

        # ----------------------------------------------------------------
        # Resolve UNIIs → label rows
        # ----------------------------------------------------------------
        label_rows = _sort_rows(_labels_for_uniis(conn, matched_uniis), scores, match_type)
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
            'cached':       cache_hit,
            'warnings':     warnings,
        })

    except Exception as e:
        return jsonify({'error': f'Search failed: {str(e)}'}), 500
    finally:
        try:
            conn.close()
        except Exception:
            pass
