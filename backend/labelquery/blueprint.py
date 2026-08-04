"""
Structured label query — the backend for the FDALabel-style criteria builder.

Three concerns live here:
  * /options and /suggest/*  feed the dropdowns and autocompletes in the panel.
  * /execute                 runs a compiled criteria tree against Postgres.
  * /translate               turns a free-text intent into a criteria tree.

/translate deliberately never runs the query. It only fills the panel in, so the
user reviews and edits what the model produced before anything is executed —
which is also why it returns `notes` describing what it could not express.
"""

import csv
import io
import json
import re
from datetime import datetime

from flask import Blueprint, request, jsonify, send_file
from flask_login import current_user

from dashboard.services.fdalabel_db import FDALabelDBService
from .compiler import (
    CLASS_TYPE_FILTERS,
    SELECT_COLUMNS,
    QueryCompileError,
    compile_where,
    order_by_sql,
)

labelquery_bp = Blueprint('labelquery', __name__)

MAX_LIMIT = 200
# Counting an unbounded match set costs more than the page itself, so the count
# is capped and the UI shows "10000+" when the cap is hit.
COUNT_CAP = 10000


def _pg():
    conn = FDALabelDBService.get_postgres_connection()
    if not conn:
        raise RuntimeError('Local label database is not available.')
    return conn


def _rows(sql, params=None):
    conn = _pg()
    try:
        with conn.cursor() as cur:
            cur.execute(sql, params or {})
            return [dict(r) for r in cur.fetchall()]
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Option lists
# ---------------------------------------------------------------------------

def _distinct_list_column(column, limit=300):
    """
    Distinct members of a `; `-joined column.

    unnest(string_to_array(...)) is what makes "HUMAN PRESCRIPTION DRUG LABEL"
    come back as one option instead of appearing inside a dozen joined strings.
    """
    sql = f"""
        SELECT value, COUNT(*) AS n FROM (
            SELECT TRIM(unnest(string_to_array(s.{column}, ';'))) AS value
            FROM labeling.sum_spl s
            WHERE s.is_latest = TRUE AND s.{column} IS NOT NULL AND s.{column} <> ''
        ) t
        WHERE value <> ''
        GROUP BY value
        ORDER BY n DESC
        LIMIT {int(limit)}
    """
    return [{'value': r['value'], 'count': r['n']} for r in _rows(sql)]


SECTION_TAXONOMY = [
    # Group 1: Additional Fields
    ("Additional Fields", "Product Title", "SPLTITLE", 133436),
    ("Additional Fields", "Initial U.S. Approval [4 Digit Year]", "43683-2", 24907),
    ("Additional Fields", "Highlights [Excluding Product Title]", "34066-1", 24934),

    # Group 2: Full Prescribing Information (PLR & Non-PLR)
    ("Full Prescribing Information (PLR & Non-PLR)", "BOXED WARNING", "34066-1", 18032),
    ("Full Prescribing Information (PLR & Non-PLR)", "1 INDICATIONS AND USAGE", "34067-9", 152093),
    ("Full Prescribing Information (PLR & Non-PLR)", "2 DOSAGE AND ADMINISTRATION", "34068-7", 152412),
    ("Full Prescribing Information (PLR & Non-PLR)", "3 DOSAGE FORMS AND STRENGTHS", "43678-2", 27561),
    ("Full Prescribing Information (PLR & Non-PLR)", "4 CONTRAINDICATIONS", "34070-3", 50459),
    ("Full Prescribing Information (PLR & Non-PLR)", "5 WARNINGS AND PRECAUTIONS", "43685-7", 29069),
    ("Full Prescribing Information (PLR & Non-PLR)", "6 ADVERSE REACTIONS", "34084-4", 51770),
    ("Full Prescribing Information (PLR & Non-PLR)", "7 DRUG INTERACTIONS", "34073-7", 38378),
    ("Full Prescribing Information (PLR & Non-PLR)", "8 USE IN SPECIFIC POPULATIONS", "43684-0", 26630),
    ("Full Prescribing Information (PLR & Non-PLR)", "8.1 Pregnancy", "42228-7", 38488),
    ("Full Prescribing Information (PLR & Non-PLR)", "8.2 Lactation", "77290-5", 9878),
    ("Full Prescribing Information (PLR & Non-PLR)", "8.2 Labor and Delivery", "34079-4", 9969),
    ("Full Prescribing Information (PLR & Non-PLR)", "8.3 Females and Males of Reproductive Potential", "77291-3", 3053),
    ("Full Prescribing Information (PLR & Non-PLR)", "8.3 Nursing Mothers", "34080-2", 23069),
    ("Full Prescribing Information (PLR & Non-PLR)", "8.4 Pediatric Use", "34081-0", 38303),
    ("Full Prescribing Information (PLR & Non-PLR)", "8.5 Geriatric Use", "34082-8", 32880),
    ("Full Prescribing Information (PLR & Non-PLR)", "9 DRUG ABUSE AND DEPENDENCE", "42227-9", 10363),
    ("Full Prescribing Information (PLR & Non-PLR)", "9.1 Controlled Substance", "34085-1", 4581),
    ("Full Prescribing Information (PLR & Non-PLR)", "9.2 Abuse", "34086-9", 4525),
    ("Full Prescribing Information (PLR & Non-PLR)", "9.3 Dependence", "34087-7", 4217),
    ("Full Prescribing Information (PLR & Non-PLR)", "10 OVERDOSAGE", "34088-5", 46721),
    ("Full Prescribing Information (PLR & Non-PLR)", "11 DESCRIPTION", "34089-3", 54436),
    ("Full Prescribing Information (PLR & Non-PLR)", "12 CLINICAL PHARMACOLOGY", "34090-1", 49604),
    ("Full Prescribing Information (PLR & Non-PLR)", "12.1 Mechanism of Action", "43679-0", 26003),
    ("Full Prescribing Information (PLR & Non-PLR)", "12.2 Pharmacodynamics", "43681-6", 19351),
    ("Full Prescribing Information (PLR & Non-PLR)", "12.3 Pharmacokinetics", "43682-4", 29239),
    ("Full Prescribing Information (PLR & Non-PLR)", "12.4 Microbiology", "49489-8", 2862),
    ("Full Prescribing Information (PLR & Non-PLR)", "12.5 Pharmacogenomics", "74348-4", 346),
    ("Full Prescribing Information (PLR & Non-PLR)", "13 NONCLINICAL TOXICOLOGY", "34091-9", 25813),
    ("Full Prescribing Information (PLR & Non-PLR)", "13.1 Carcinogenesis, Mutagenesis, Impairment of Fertility", "34083-6", 34769),
    ("Full Prescribing Information (PLR & Non-PLR)", "13.2 Animal Toxicology and/or Pharmacology", "43680-8", 6374),
    ("Full Prescribing Information (PLR & Non-PLR)", "14 CLINICAL STUDIES", "34092-7", 27322),
    ("Full Prescribing Information (PLR & Non-PLR)", "15 REFERENCES", "34093-5", 7992),
    ("Full Prescribing Information (PLR & Non-PLR)", "16 HOW SUPPLIED/STORAGE AND HANDLING", "34069-5", 86703),
    ("Full Prescribing Information (PLR & Non-PLR)", "17 PATIENT COUNSELING INFORMATION/INFORMATION FOR PATIENTS", "34076-0", 39098),
    ("Full Prescribing Information (PLR & Non-PLR)", "WARNINGS", "34071-1", 124714),
    ("Full Prescribing Information (PLR & Non-PLR)", "PRECAUTIONS", "42232-9", 25229),
    ("Full Prescribing Information (PLR & Non-PLR)", "GENERAL", "34072-9", 12628),
    ("Full Prescribing Information (PLR & Non-PLR)", "LABORATORY TESTS", "34075-2", 7439),
    ("Full Prescribing Information (PLR & Non-PLR)", "DRUG/LABORATORY TEST INTERACTIONS", "34074-5", 3966),
    ("Full Prescribing Information (PLR & Non-PLR)", "TERATOGENIC EFFECTS", "34077-8", 5786),
    ("Full Prescribing Information (PLR & Non-PLR)", "NONTERATOGENIC EFFECTS", "34078-6", 2265),

    # Group 3: HUMAN OVER-THE-COUNTER (OTC) DRUG PRODUCTS (DRUG FACTS)
    ("HUMAN OVER-THE-COUNTER (OTC) DRUG PRODUCTS (DRUG FACTS)", "WARNINGS", "50566-9", 124714),
    ("HUMAN OVER-THE-COUNTER (OTC) DRUG PRODUCTS (DRUG FACTS)", "PURPOSE(S)", "50565-1", 100953),
    ("HUMAN OVER-THE-COUNTER (OTC) DRUG PRODUCTS (DRUG FACTS)", "ACTIVE INGREDIENT", "50564-4", 98072),
    ("HUMAN OVER-THE-COUNTER (OTC) DRUG PRODUCTS (DRUG FACTS)", "WHEN USING", "50567-7", 48055),
    ("HUMAN OVER-THE-COUNTER (OTC) DRUG PRODUCTS (DRUG FACTS)", "ASK DOCTOR", "50569-3", 24262),
    ("HUMAN OVER-THE-COUNTER (OTC) DRUG PRODUCTS (DRUG FACTS)", "ASK DOCTOR/PHARMACIST", "50570-1", 11430),
    ("HUMAN OVER-THE-COUNTER (OTC) DRUG PRODUCTS (DRUG FACTS)", "DO NOT USE", "50568-5", 45224),
    ("HUMAN OVER-THE-COUNTER (OTC) DRUG PRODUCTS (DRUG FACTS)", "STOP USE", "50571-9", 57490),
    ("HUMAN OVER-THE-COUNTER (OTC) DRUG PRODUCTS (DRUG FACTS)", "QUESTIONS", "50563-6", 44122),
    ("HUMAN OVER-THE-COUNTER (OTC) DRUG PRODUCTS (DRUG FACTS)", "PREGNANCY OR BREAST FEEDING", "50572-7", 24443),
    ("HUMAN OVER-THE-COUNTER (OTC) DRUG PRODUCTS (DRUG FACTS)", "KEEP OUT OF REACH OF CHILDREN", "50573-5", 100761),

    # Group 4: Other Sections
    ("Other Sections", "ACCESSORIES", "ACCESSORIES", 23),
    ("Other Sections", "ALARMS", "ALARMS", 23),
    ("Other Sections", "ASSEMBLY OR INSTALLATION INSTRUCTIONS", "ASSEMBLY OR INSTALLATION INSTRUCTIONS", 3),
    ("Other Sections", "CALIBRATION INSTRUCTIONS", "CALIBRATION INSTRUCTIONS", 1),
    ("Other Sections", "CLEANING, DISINFECTING, AND STERILIZATION INSTRUCTIONS", "CLEANING, DISINFECTING, AND STERILIZATION INSTRUCTIONS", 181),
    ("Other Sections", "COMPATIBLE ACCESSORIES", "COMPATIBLE ACCESSORIES", 8),
    ("Other Sections", "COMPONENTS", "COMPONENTS", 4634),
    ("Other Sections", "DIAGRAM OF DEVICE", "DIAGRAM OF DEVICE", 13),
    ("Other Sections", "DISPOSAL AND WASTE HANDLING", "DISPOSAL AND WASTE HANDLING", 100),
    ("Other Sections", "ENVIRONMENTAL WARNING", "ENVIRONMENTAL WARNING", 97),
    ("Other Sections", "INFORMATION FOR OWNERS/CAREGIVERS", "INFORMATION FOR OWNERS/CAREGIVERS", 466),
    ("Other Sections", "INSTRUCTIONS FOR USE", "INSTRUCTIONS FOR USE", 5005),
    ("Other Sections", "INTENDED USE OF THE DEVICE", "INTENDED USE OF THE DEVICE", 130),
    ("Other Sections", "OTHER SAFETY INFORMATION", "OTHER SAFETY INFORMATION", 16484),
    ("Other Sections", "PACKAGE LABEL.PRINCIPAL DISPLAY PANEL", "PACKAGE LABEL.PRINCIPAL DISPLAY PANEL", 159693),
    ("Other Sections", "RESIDUE WARNING", "RESIDUE WARNING", 216),
    ("Other Sections", "RISKS", "RISKS", 620),
    ("Other Sections", "ROUTE, METHOD AND FREQUENCY OF ADMINISTRATION", "ROUTE, METHOD AND FREQUENCY OF ADMINISTRATION", 898),
    ("Other Sections", "SAFE HANDLING WARNING", "SAFE HANDLING WARNING", 1427),
    ("Other Sections", "SPL INDEXING DATA ELEMENTS", "SPL INDEXING DATA ELEMENTS", 134),
    ("Other Sections", "SPL PRODUCT DATA ELEMENTS", "SPL PRODUCT DATA ELEMENTS", 159725),
    ("Other Sections", "SPL MEDGUIDE", "SPL MEDGUIDE", 12985),
    ("Other Sections", "SPL PATIENT PACKAGE INSERT", "SPL PATIENT PACKAGE INSERT", 7482),
    ("Other Sections", "SPL UNCLASSIFIED SECTION", "SPL UNCLASSIFIED SECTION", 83329),
    ("Other Sections", "STATEMENT OF IDENTITY", "STATEMENT OF IDENTITY", 833),
    ("Other Sections", "STORAGE AND HANDLING", "STORAGE AND HANDLING", 46415),
    ("Other Sections", "SUMMARY OF SAFETY AND EFFECTIVENESS", "SUMMARY OF SAFETY AND EFFECTIVENESS", 153),
    ("Other Sections", "TROUBLESHOOTING", "TROUBLESHOOTING", 22),
    ("Other Sections", "USER SAFETY WARNINGS", "USER SAFETY WARNINGS", 520),
    ("Other Sections", "VETERINARY INDICATIONS", "VETERINARY INDICATIONS", 699),
]


@labelquery_bp.route('/options', methods=['GET'])
def options():
    """Every dropdown the panel needs, served instantly from the pre-computed stats cache."""
    try:
        cache_rows = []
        try:
            cache_rows = _rows("SELECT category, key_name, item_count FROM labeling.query_options_cache ORDER BY item_count DESC")
        except Exception:
            cache_rows = []

        # If cache is missing or empty, attempt an on-the-fly refresh
        if not cache_rows:
            try:
                from database.scripts.db_07_import_labels import refresh_query_options_cache
                refresh_query_options_cache()
                cache_rows = _rows("SELECT category, key_name, item_count FROM labeling.query_options_cache ORDER BY item_count DESC")
            except Exception as ex:
                print(f"[WARN] Options cache refresh fallback failed: {ex}")

        # Group cached items by category
        grouped = {}
        db_counts = {}
        for r in cache_rows:
            cat = r['category']
            if cat not in grouped:
                grouped[cat] = []
            grouped[cat].append({'value': r['key_name'], 'count': r['item_count']})
            if cat in ('db_counts', 'sections'):
                db_counts[r['key_name']] = r['item_count']

        sections = []
        for group, label, code_or_val, default_count in SECTION_TAXONOMY:
            cnt = db_counts.get(code_or_val) or db_counts.get(label.upper()) or default_count
            sections.append({
                'value': code_or_val,
                'label': label,
                'group': group,
                'count': cnt
            })

        return jsonify({
            'labelingTypes': grouped.get('labelingTypes', []),
            'applicationTypes': grouped.get('applicationTypes', []),
            'routes': grouped.get('routes', []),
            'dosageForms': grouped.get('dosageForms', []),
            'sections': sections,
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@labelquery_bp.route('/suggest/pharm_class', methods=['GET'])
def suggest_pharm_class():
    q = (request.args.get('q') or '').strip()
    class_type = (request.args.get('type') or 'any').lower()
    if len(q) < 2:
        return jsonify({'suggestions': []})
    try:
        params = {'q': f'%{q}%'}
        type_clause = ''
        if class_type in CLASS_TYPE_FILTERS:
            # Same two-signal match the compiler uses, so suggestions can never
            # offer a class the search would then fail to find.
            types, suffixes = CLASS_TYPE_FILTERS[class_type]
            type_clause = (
                'AND (si.indexing_type ILIKE ANY(%(t)s) OR si.indexing_name ILIKE ANY(%(sfx)s))'
            )
            params['t'] = types
            params['sfx'] = suffixes

        rows = []
        if class_type in ('any', 'epc'):
            rows += _rows(
                """
                SELECT DISTINCT em.epc_term AS name, 'EPC' AS kind
                FROM labeling.epc_map em
                WHERE em.epc_term ILIKE %(q)s
                ORDER BY name
                LIMIT 25
                """,
                {'q': params['q']},
            )
        if class_type != 'epc':
            rows += _rows(
                f"""
                SELECT DISTINCT si.indexing_name AS name, si.indexing_type AS kind
                FROM labeling.substance_indexing si
                WHERE si.indexing_name ILIKE %(q)s {type_clause}
                ORDER BY name
                LIMIT 25
                """,
                params,
            )
        return jsonify({'suggestions': rows[:40]})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


_MEDDRA_LEVELS = {
    'llt': ('meddra_llt', 'llt_name'),
    'pt': ('meddra_pt', 'pt_name'),
    'hlt': ('meddra_hlt', 'hlt_name'),
    'hlgt': ('meddra_hlgt', 'hlgt_name'),
    'soc': ('meddra_soc', 'soc_name'),
}


@labelquery_bp.route('/suggest/meddra', methods=['GET'])
def suggest_meddra():
    q = (request.args.get('q') or '').strip()
    level = (request.args.get('level') or 'pt').lower()
    if len(q) < 2 or level not in _MEDDRA_LEVELS:
        return jsonify({'suggestions': []})
    table, column = _MEDDRA_LEVELS[level]
    try:
        rows = _rows(
            f"""
            SELECT DISTINCT {column} AS name FROM public.{table}
            WHERE {column} ILIKE %(q)s ORDER BY name LIMIT 30
            """,
            {'q': f'%{q}%'},
        )
        return jsonify({'suggestions': [r['name'] for r in rows]})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


_capability_cache = {}


def _capabilities():
    """
    What this deployment's data can actually answer.

    Cached per process: the answer only changes on a re-import, and the probe
    would otherwise run on every search. Restart the app after importing.
    """
    if 'unii' not in _capability_cache:
        try:
            rows = _rows(
                "SELECT 1 FROM labeling.active_ingredients_map "
                "WHERE unii IS NOT NULL AND unii <> '' LIMIT 1"
            )
            _capability_cache['unii'] = bool(rows)
        except Exception:
            # Assume supported on probe failure: a warning that the data is
            # missing is worse than none if the column is really there.
            _capability_cache['unii'] = True
    return dict(_capability_cache)


def _expand_meddra(level, terms):
    """
    Resolves a non-PT MedDRA selection down to the PT names actually used in
    label text. Passed into the compiler so it stays DB-free.

    Returns [] when nothing could be expanded — an empty MedDRA dictionary is a
    common deployment state, and the caller has to be able to tell that apart
    from a real expansion so it can say the search fell back to literal text.
    """
    level = (level or 'pt').lower()
    if level == 'pt' or not terms:
        return list(terms)
    column = {
        'llt': 'llt_name',
        'hlt': 'hlt_name',
        'hlgt': 'hlgt_name',
        'soc': 'soc_name',
    }.get(level)
    if not column:
        return []

    if level == 'llt':
        sql = """
            SELECT DISTINCT p.pt_name AS name
            FROM public.meddra_llt l JOIN public.meddra_pt p ON p.pt_code = l.pt_code
            WHERE l.llt_name = ANY(%(terms)s)
        """
    else:
        sql = f"""
            SELECT DISTINCT h.pt_name AS name
            FROM public.meddra_mdhier h WHERE h.{column} = ANY(%(terms)s)
        """
    try:
        rows = _rows(sql, {'terms': list(terms)})
    except Exception:
        return []
    # Keep the originals too: a SOC name can itself appear in label prose.
    names = [r['name'] for r in rows if r['name']]
    return (names + list(terms))[:200] if names else []


# ---------------------------------------------------------------------------
# Execute
# ---------------------------------------------------------------------------

@labelquery_bp.route('/execute', methods=['POST'])
def execute():
    payload = request.get_json(silent=True) or {}
    query = payload.get('query') or {}
    try:
        limit = max(1, min(int(payload.get('limit') or 50), MAX_LIMIT))
        offset = max(0, int(payload.get('offset') or 0))
    except (TypeError, ValueError):
        return jsonify({'error': 'limit and offset must be integers'}), 400

    try:
        where, params, warnings = compile_where(
            query, expand_meddra=_expand_meddra, capabilities=_capabilities()
        )
    except QueryCompileError as e:
        return jsonify({'error': str(e)}), 400

    order_by = order_by_sql(payload.get('sort'), payload.get('dir'))

    conn = None
    try:
        conn = _pg()
        with conn.cursor() as cur:
            count_params = dict(params)
            count_params['_cap'] = COUNT_CAP
            cur.execute(
                f"""
                SELECT COUNT(*) AS n FROM (
                    SELECT 1 FROM labeling.sum_spl s WHERE {where} LIMIT %(_cap)s
                ) capped
                """,
                count_params,
            )
            total = cur.fetchone()['n']

            page_params = dict(params)
            page_params['_limit'] = limit
            page_params['_offset'] = offset
            cur.execute(
                f"""
                SELECT {SELECT_COLUMNS}
                FROM labeling.sum_spl s
                WHERE {where}
                ORDER BY {order_by}
                LIMIT %(_limit)s OFFSET %(_offset)s
                """,
                page_params,
            )
            results = [dict(r) for r in cur.fetchall()]

        return jsonify({
            'results': results,
            'total': total,
            'capped': total >= COUNT_CAP,
            'limit': limit,
            'offset': offset,
            'warnings': warnings,
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        if conn:
            conn.close()


# ---------------------------------------------------------------------------
# Export
# ---------------------------------------------------------------------------

# "Download Full Results" means the whole match set, not the visible page, so
# this is capped separately and much higher than a page.
EXPORT_CAP = 5000

# (header, row key) in the order FDALabel's own download uses.
EXPORT_COLUMNS = [
    ('SET ID', 'set_id'),
    ('SPL ID', 'spl_id'),
    ('Labeling Type', 'doc_type'),
    ('Marketing Category', 'market_categories'),
    ('Application Number(s)', 'appr_num'),
    ('Trade Name', 'product_names'),
    ('Generic/Proper Name(s)', 'generic_names'),
    ('Active Ingredient(s)', 'active_ingredients'),
    ('Active Ingredient UNII(s)', 'active_uniis'),
    ('Labeler', 'manufacturer'),
    ('Dosage Form(s)', 'dosage_forms'),
    ('Route(s) of Administration', 'routes'),
    ('Pharmacologic Class(es)', 'epc'),
    ('NDC Code(s)', 'ndc_codes'),
    ('Most Recent SPL Date', 'revised_date'),
    ('Initial Approval Year', 'initial_approval_year'),
    ('RLD', 'is_rld'),
    ('RS', 'is_rs'),
]


def _export_rows(query, sort, direction):
    where, params, _ = compile_where(
        query, expand_meddra=_expand_meddra, capabilities=_capabilities()
    )
    page_params = dict(params)
    page_params['_limit'] = EXPORT_CAP
    return _rows(
        f"""
        SELECT {SELECT_COLUMNS}
        FROM labeling.sum_spl s
        WHERE {where}
        ORDER BY {order_by_sql(sort, direction)}
        LIMIT %(_limit)s
        """,
        page_params,
    )


def _cell(row, key):
    value = row.get(key)
    if key in ('is_rld', 'is_rs'):
        return 'Yes' if value else 'No'
    # Multi-valued columns are "; "-joined in storage; a comma reads better in a
    # spreadsheet and does not collide with CSV quoting.
    return (value or '').replace(';', ',') if isinstance(value, str) else value


@labelquery_bp.route('/export', methods=['POST'])
def export():
    payload = request.get_json(silent=True) or {}
    fmt = (payload.get('format') or 'csv').lower()
    if fmt not in ('csv', 'xlsx'):
        return jsonify({'error': "format must be 'csv' or 'xlsx'"}), 400

    try:
        rows = _export_rows(payload.get('query') or {}, payload.get('sort'), payload.get('dir'))
    except QueryCompileError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500

    stamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    headers = [h for h, _ in EXPORT_COLUMNS]

    if fmt == 'csv':
        buffer = io.StringIO()
        writer = csv.writer(buffer, lineterminator='\n')
        writer.writerow(headers)
        for row in rows:
            writer.writerow([_cell(row, key) for _, key in EXPORT_COLUMNS])
        # utf-8-sig: Excel on Windows reads a plain UTF-8 CSV as cp1252 and
        # mangles the non-ASCII characters common in labeler names.
        data = io.BytesIO(buffer.getvalue().encode('utf-8-sig'))
        return send_file(
            data,
            mimetype='text/csv',
            as_attachment=True,
            download_name=f'FDALabel_Query_{stamp}.csv',
        )

    from openpyxl import Workbook

    wb = Workbook()
    ws = wb.active
    ws.title = 'Query Results'
    ws.append(headers)
    for row in rows:
        ws.append([_cell(row, key) for _, key in EXPORT_COLUMNS])
    for column in ws.columns:
        width = max((len(str(c.value)) for c in column if c.value is not None), default=10)
        ws.column_dimensions[column[0].column_letter].width = min(45, width + 2)

    data = io.BytesIO()
    wb.save(data)
    data.seek(0)
    return send_file(
        data,
        mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        as_attachment=True,
        download_name=f'FDALabel_Query_{stamp}.xlsx',
    )


# ---------------------------------------------------------------------------
# Translate (AI)
# ---------------------------------------------------------------------------

TRANSLATE_SYSTEM_PROMPT = """
You convert a drug-labeling analyst's plain-English request into a structured
query for the FDALabel search panel.

Return ONLY a JSON object (no markdown, no code fences) with this schema:
{
  "groups": [
    {"criteria": [{"type": "<type>", "value": {...}}]}
  ],
  "notes": ["short note about anything you could not express"]
}

Criteria inside a group are combined with AND. Groups are combined with OR.
Prefer ONE group unless the request clearly asks for alternatives ("either X or Y").

Allowed "type" values and the exact shape of their "value":

- "labelingType"      {"values": ["HUMAN PRESCRIPTION DRUG LABEL"]}
- "applicationType"   {"values": ["NDA"]}          // ANDA, BLA, NDA, NDA authorized generic, OTC monograph drug
- "route"             {"values": ["ORAL"]}
- "productName"       {"field": "any"|"trade"|"generic",
                       "op": "contains"|"startsWith"|"equals"|"notContains",
                       "text": "metformin"}
- "fullText"          {"mode": "simple"|"advanced", "text": "hepatic failure"}
- "labelingSection"   {"mode": "simple"|"advanced",
                       "text": "DILI OR hepatotoxicity OR \"liver function test\" OR \"acute liver failure\"",
                       "sections": ["BOXED WARNING", "WARNINGS AND PRECAUTIONS", "ADVERSE REACTIONS"]}
- "marketStatus"      {"values": ["rld"]}          // rld, rs, marketed, discontinued
- "meddra"            {"level": "pt"|"llt"|"hlt"|"hlgt"|"soc", "terms": ["Hepatic failure", "Hepatotoxicity", "Drug-induced liver injury", "Acute hepatic failure"]}
- "pharmClass"        {"classType": "any"|"epc"|"moa"|"pe"|"cs", "terms": ["Kinase Inhibitor"]}
- "identifier"        {"text": "NDA 021436", "ingredientType": "active"|"inactive"|"both"}

Rules:
1. Multi-term or Adverse Event OR Queries:
   When multiple terms, adverse events, or conditions are requested (e.g. "DILI, hepatotoxicity, liver function test abnormalities, or acute liver failure"):
   - Use "labelingSection" or "fullText" with "mode": "advanced" and join phrases with "OR" (e.g. text: "\"drug-induced liver injury\" OR DILI OR hepatotoxicity OR \"liver function test\" OR \"acute liver failure\"").
   - OR use "meddra" with a list of terms in "terms": ["Drug-induced liver injury", "Hepatotoxicity", "Liver function test abnormal", "Acute hepatic failure"].
2. Target Sections:
   When specific sections are named (e.g. "Boxed Warning", "Warnings and Precautions", "Adverse Reactions"):
   - Use "labelingSection" with "sections": ["BOXED WARNING", "WARNINGS AND PRECAUTIONS", "ADVERSE REACTIONS"] and place the search terms in "text".
3. A drug name goes in "productName", never "identifier".
4. Never return an empty "groups" array when medical concepts, adverse events, or labeling sections are requested.
"""

_ALLOWED_TYPES = {
    'labelingType', 'applicationType', 'route', 'productName', 'fullText',
    'labelingSection', 'marketStatus', 'meddra', 'pharmClass', 'identifier',
    'chemicalStructure', 'dosageForm',
}


def _parse_json_object(text):
    text = re.sub(r'^```(?:json)?\s*', '', (text or '').strip(), flags=re.I)
    text = re.sub(r'\s*```$', '', text)
    try:
        return json.loads(text)
    except Exception:
        i, j = text.find('{'), text.rfind('}')
        if i != -1 and j > i:
            try:
                return json.loads(text[i:j + 1])
            except Exception:
                return None
        return None


def _sanitize_translation(parsed):
    """
    Keeps only criteria the compiler understands and normalizes loose LLM outputs.
    """
    groups = []
    dropped = []
    for group in (parsed.get('groups') or [])[:5]:
        criteria = []
        for criterion in (group.get('criteria') or [])[:12]:
            if not isinstance(criterion, dict):
                continue
            ctype = criterion.get('type')
            value = criterion.get('value')
            if ctype not in _ALLOWED_TYPES:
                dropped.append(str(ctype))
                continue

            # Auto-repair loose values from LLM
            if isinstance(value, str):
                if ctype in ('fullText', 'labelingSection'):
                    value = {'mode': 'advanced' if ' OR ' in value or ' AND ' in value else 'simple', 'text': value}
                elif ctype == 'productName':
                    value = {'field': 'any', 'op': 'contains', 'text': value}
                elif ctype == 'meddra':
                    value = {'level': 'pt', 'terms': [value]}
                elif ctype == 'pharmClass':
                    value = {'classType': 'any', 'terms': [value]}
                elif ctype in ('labelingType', 'applicationType', 'route', 'marketStatus'):
                    value = {'values': [value]}
            elif isinstance(value, list):
                if ctype in ('labelingType', 'applicationType', 'route', 'marketStatus'):
                    value = {'values': value}
                elif ctype in ('meddra', 'pharmClass'):
                    value = {'level': 'pt' if ctype == 'meddra' else 'any', 'terms': value}

            if not isinstance(value, dict):
                dropped.append(str(ctype))
                continue
            criteria.append({'type': ctype, 'value': value})
        if criteria:
            groups.append({'criteria': criteria})

    notes = [str(n) for n in (parsed.get('notes') or []) if n][:5]
    if dropped:
        notes.append('Dropped unsupported criteria: ' + ', '.join(sorted(set(dropped))))
    return {'groups': groups}, notes


@labelquery_bp.route('/translate', methods=['POST'])
def translate():
    payload = request.get_json(silent=True) or {}
    intent = (payload.get('intent') or '').strip()
    if not intent:
        return jsonify({'error': 'intent is required'}), 400

    from dashboard.services.ai_handler import call_llm

    user = current_user._get_current_object() if current_user.is_authenticated else None
    try:
        raw = call_llm(
            user=user,
            system_prompt=TRANSLATE_SYSTEM_PROMPT,
            user_message=json.dumps({'request': intent}),
            temperature=0.0,
        )
    except Exception as e:
        return jsonify({'error': f'AI translation failed: {e}'}), 502

    parsed = _parse_json_object(raw)
    if not isinstance(parsed, dict):
        return jsonify({'error': 'The model did not return a usable query.'}), 502

    query, notes = _sanitize_translation(parsed)
    if not query['groups']:
        return jsonify({
            'error': 'Could not turn that into search criteria. Try naming a drug, '
                     'a labeling section, or an adverse event.',
            'notes': notes,
        }), 422

    # Validate before handing it to the UI: a criterion that cannot compile is
    # better caught here than when the user presses Search.
    try:
        compile_where(query)
    except QueryCompileError as e:
        return jsonify({'error': f'The generated query was invalid: {e}'}), 502

    return jsonify({'query': query, 'notes': notes})


REFINE_SYSTEM_PROMPT = """
You are an expert FDA Drug Label Query Analyst and prompt engineer for AskFDALabel.
Your job is to rewrite a user's natural language search intent into a highly clear, standardized, formal query description that can be accurately parsed into FDA prescribing label search criteria (such as product names, labeling sections like Boxed Warning or Warnings, MedDRA adverse event terms, pharmacologic classes, or route of administration).

Also, evaluate the query for any ambiguities, broad/vague terms, or missing scope that could affect query performance or accuracy, and provide clear warning notes.

Return ONLY a JSON object (no markdown, no code fences) with this schema:
{
  "refined_intent": "A standardized, explicit, and well-structured natural language prompt describing the search criteria in clear formal clinical language.",
  "warnings": [
    "Clear, helpful warning note regarding broad terms, ambiguous sections, or potential search coverage issues."
  ]
}
"""


@labelquery_bp.route('/refine', methods=['POST'])
def refine():
    payload = request.get_json(silent=True) or {}
    intent = (payload.get('intent') or '').strip()
    if not intent:
        return jsonify({'error': 'intent is required'}), 400

    from dashboard.services.ai_handler import call_llm

    user = current_user._get_current_object() if current_user.is_authenticated else None
    try:
        raw = call_llm(
            user=user,
            system_prompt=REFINE_SYSTEM_PROMPT,
            user_message=json.dumps({'request': intent}),
            temperature=0.2,
        )
    except Exception as e:
        return jsonify({'error': f'AI prompt refinement failed: {e}'}), 502

    parsed = _parse_json_object(raw)
    if not isinstance(parsed, dict) or not parsed.get('refined_intent'):
        return jsonify({'error': 'The model did not return a usable refined prompt.'}), 502

    return jsonify({
        'refined_intent': parsed.get('refined_intent'),
        'warnings': [str(w) for w in (parsed.get('warnings') or []) if w][:5]
    })

