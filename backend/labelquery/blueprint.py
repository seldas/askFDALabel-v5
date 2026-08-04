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
from .compiler import SELECT_COLUMNS, QueryCompileError, compile_where, order_by_sql

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


@labelquery_bp.route('/options', methods=['GET'])
def options():
    """Every dropdown the panel needs, in one round trip."""
    try:
        # A LOINC code carries many literal titles ("2.1 Adults", "5.3 Hepatic
        # Impairment", a product-specific carton name), so the label shown is the
        # most common title for that code with any leading section number
        # stripped — MIN(title) would pick an arbitrary one.
        sections = _rows(
            """
            SELECT code, title, total FROM (
                SELECT
                    sec.loinc_code AS code,
                    regexp_replace(sec.title, '^[0-9]+(\\.[0-9]+)*\\s+', '') AS title,
                    ROW_NUMBER() OVER (
                        PARTITION BY sec.loinc_code ORDER BY COUNT(*) DESC
                    ) AS rn,
                    SUM(COUNT(*)) OVER (PARTITION BY sec.loinc_code) AS total
                FROM labeling.spl_sections sec
                WHERE sec.loinc_code IS NOT NULL AND sec.loinc_code <> ''
                  AND sec.title IS NOT NULL AND sec.title <> ''
                GROUP BY sec.loinc_code, 2
            ) ranked
            WHERE rn = 1
            ORDER BY total DESC
            LIMIT 150
            """
        )
        return jsonify({
            'labelingTypes': _distinct_list_column('doc_type'),
            'applicationTypes': _distinct_list_column('market_categories'),
            'routes': _distinct_list_column('routes'),
            'dosageForms': _distinct_list_column('dosage_forms'),
            'sections': [
                {'value': r['code'], 'label': r['title'], 'count': r['total']} for r in sections
            ],
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
        if class_type not in ('any', 'epc'):
            type_clause = 'AND si.indexing_type ILIKE %(t)s'
            params['t'] = f'%{class_type}%'

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
        where, params, warnings = compile_where(query, expand_meddra=_expand_meddra)
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
    where, params, _ = compile_where(query, expand_meddra=_expand_meddra)
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
- "labelingSection"   {"mode": "simple"|"advanced", "text": "...",
                       "sections": ["34084-4"]}    // LOINC codes or section title words
- "marketStatus"      {"values": ["rld"]}          // rld, rs, marketed, discontinued
- "meddra"            {"level": "pt"|"llt"|"hlt"|"hlgt"|"soc", "terms": ["Hepatic failure"]}
- "pharmClass"        {"classType": "any"|"epc"|"moa"|"pe"|"cs", "terms": ["Kinase Inhibitor"]}
- "identifier"        {"text": "NDA 021436", "ingredientType": "active"|"inactive"|"both"}

Rules:
- Use "simple" mode for an exact phrase; "advanced" only when the user needs
  boolean operators (AND/OR/NOT) or a trailing * for prefix matching.
- A drug name goes in "productName", never "identifier". Application numbers,
  NDC codes, set IDs and UNII codes go in "identifier".
- An adverse event or medical concept goes in "meddra" when it is a recognizable
  MedDRA term, otherwise "fullText".
- "Warnings", "Boxed Warning", "Adverse Reactions", "Contraindications" and
  similar are sections: use "labelingSection" with the section name in "sections".
- Omit any criterion you have no value for. Never invent identifiers.
- Chemical structure search is not supported; put that in "notes".
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
    Keeps only criteria the compiler understands.

    A model that invents a type or nests the value wrongly should degrade to a
    partly-filled panel the user can finish, not a 500.
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
