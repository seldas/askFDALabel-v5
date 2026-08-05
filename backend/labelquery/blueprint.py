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
    sort_column_sql,
    sort_direction_sql,
)

labelquery_bp = Blueprint('labelquery', __name__)

MAX_LIMIT = 3000
# How far into a match set the UI will page. FDALabel shows the most recent N
# rather than everything, and bounding the browse window is what keeps paging
# cheap: the page query only ever sorts and slices, never scrolls past 3000.
# The reported total stays exact, so the header reads "3,000 / 32,422".
BROWSE_CAP = 3000


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


#: Oracle keeps the dropdown vocabularies precomputed, one pair of count tables
#: per scope. The DGV_ copies are the CDER-CBER curated numbers; the plain ones
#: are the full FDA set. Shapes match column for column except the document-type
#: pair, which carries an extra FORMAT dimension on the DGV side and has to be
#: summed over it -- hence a query per scope rather than a table-name swap.
#:
#: "COUNT" is quoted throughout: it is a column name here, and unquoted it parses
#: as the aggregate function.
_ORACLE_OPTION_QUERIES = {
    'oracle': {
        'labelingTypes': """
            SELECT dt.LOINC_NAME AS name, SUM(c.COUNTS) AS n
            FROM druglabel.DGV_FORMAT_DOCUMENT_TYPE_COUNT c
            JOIN druglabel.DOCUMENT_TYPE dt ON dt.LOINC_CODE = c.CODE
            WHERE dt.LOINC_NAME IS NOT NULL
            GROUP BY dt.LOINC_NAME
            ORDER BY 2 DESC
        """,
        'applicationTypes': """
            SELECT mc.SPL_ACCEPTABLE_TERM AS name, c."COUNT" AS n
            FROM druglabel.DGV_MARKETING_CAT_COUNT c
            JOIN druglabel.MARKETING_CATEGORY mc ON mc.NCI_THESAURUS_CODE = c.CODE
            WHERE mc.SPL_ACCEPTABLE_TERM IS NOT NULL
            ORDER BY c."COUNT" DESC
        """,
        'routes': """
            SELECT SPL_ACCEPTABLE_TERM AS name, "COUNT" AS n
            FROM druglabel.DGV_ROUTE_OF_ADMIN_COUNT
            WHERE SPL_ACCEPTABLE_TERM IS NOT NULL
            ORDER BY "COUNT" DESC
        """,
    },
    'oracle_all': {
        'labelingTypes': """
            SELECT dt.LOINC_NAME AS name, c."COUNT" AS n
            FROM druglabel.DOCUMENT_TYPE_COUNT c
            JOIN druglabel.DOCUMENT_TYPE dt ON dt.LOINC_CODE = c.CODE
            WHERE dt.LOINC_NAME IS NOT NULL
            ORDER BY c."COUNT" DESC
        """,
        'applicationTypes': """
            SELECT mc.SPL_ACCEPTABLE_TERM AS name, c."COUNT" AS n
            FROM druglabel.MARKETING_CAT_COUNT c
            JOIN druglabel.MARKETING_CATEGORY mc ON mc.NCI_THESAURUS_CODE = c.CODE
            WHERE mc.SPL_ACCEPTABLE_TERM IS NOT NULL
            ORDER BY c."COUNT" DESC
        """,
        'routes': """
            SELECT SPL_ACCEPTABLE_TERM AS name, "COUNT" AS n
            FROM druglabel.ROUTE_OF_ADMIN_COUNT
            WHERE SPL_ACCEPTABLE_TERM IS NOT NULL
            ORDER BY "COUNT" DESC
        """,
    },
}

#: Dosage form has no count table on either scope, so the controlled vocabulary
#: is served without counts rather than aggregating SUM_SPL_DOSAGEFORM per
#: request. Same list for both scopes: it is a code list, not a label rollup.
_ORACLE_DOSAGE_FORM_QUERY = """
    SELECT SPL_ACCEPTABLE_TERM AS name, 0 AS n
    FROM druglabel.DOSAGE_FORM
    WHERE SPL_ACCEPTABLE_TERM IS NOT NULL
    ORDER BY SPL_ACCEPTABLE_TERM
"""


def _oracle_options(target_db):
    """
    Dropdown vocabularies for an Oracle scope, or None if Oracle is unreachable.

    Returning None rather than raising lets the caller fall back to the local
    lists: a panel with the wrong dropdowns still works, where a panel with none
    does not. The response says which source it used so the difference is
    visible rather than silent.
    """
    from dashboard.services.fdalabel_db import FDALabelDBService

    queries = _ORACLE_OPTION_QUERIES.get(target_db) or _ORACLE_OPTION_QUERIES['oracle']
    out = {}
    for key, sql in list(queries.items()) + [('dosageForms', _ORACLE_DOSAGE_FORM_QUERY)]:
        rows = FDALabelDBService.execute_oracle_query(sql)
        if not rows and key == 'labelingTypes':
            # The first query coming back empty means no connection, not an
            # empty dictionary -- these tables are never unpopulated.
            return None
        out[key] = [
            {'value': r.get('NAME') or r.get('name'), 'count': int(r.get('N') or r.get('n') or 0)}
            for r in rows
            if (r.get('NAME') or r.get('name'))
        ]
    return out


@labelquery_bp.route('/options', methods=['GET'])
def options():
    """
    Every dropdown the panel needs.

    Served from whichever database the panel is pointed at: the dropdowns used
    to come from the local import regardless of target, so against Oracle they
    offered whatever this deployment happened to have loaded.
    """
    target_db = (request.args.get('target_db') or request.args.get('targetDb') or 'local').lower()
    try:
        if target_db in _ORACLE_TARGETS:
            oracle = _oracle_options(target_db)
            if oracle is not None:
                return jsonify({
                    **oracle,
                    'sections': [
                        {'value': code_or_val, 'label': label, 'group': group, 'count': default_count}
                        for group, label, code_or_val, default_count in SECTION_TAXONOMY
                    ],
                    'source': target_db,
                })
            # Fall through to the local lists, flagged below.

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
            # 'local' when that is what was asked for; when an Oracle scope was
            # asked for and this is the answer, Oracle was unreachable and these
            # lists describe a different database than the one being searched.
            'source': 'local',
            'requested': target_db,
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@labelquery_bp.route('/suggest/product_name', methods=['GET'])
def suggest_product_name():
    """Autocomplete for product names (trade or generic). Requires >= 4 characters to minimize DB load."""
    q = (request.args.get('q') or '').strip()
    field = (request.args.get('field') or 'any').lower()
    if len(q) < 4:
        return jsonify({'suggestions': []})

    try:
        pattern = f"%{q}%"
        if field == 'trade':
            col_sql = "s.product_names"
        elif field == 'generic':
            col_sql = "s.generic_names"
        else:
            col_sql = "COALESCE(s.product_names, '') || '; ' || COALESCE(s.generic_names, '')"

        sql = f"""
            SELECT DISTINCT value FROM (
                SELECT TRIM(unnest(string_to_array({col_sql}, ';'))) AS value
                FROM labeling.sum_spl s
                WHERE s.is_latest = TRUE AND ({col_sql} ILIKE %(pattern)s)
            ) t
            WHERE value ILIKE %(pattern)s AND value <> ''
            ORDER BY value ASC
            LIMIT 30;
        """
        rows = _rows(sql, {'pattern': pattern})
        return jsonify({'suggestions': [r['value'] for r in rows]})
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

_ORACLE_MEDDRA_LEVELS = {
    'llt': ('meddra.low_level_term', 'LLT_NAME'),
    'pt': ('meddra.preferred_term', 'PT_NAME'),
    'hlt': ('meddra.high_level_term', 'HLT_NAME'),
    'hlgt': ('meddra.high_level_grouping_term', 'HLGT_NAME'),
    'soc': ('meddra.soc_term', 'SOC_NAME'),
}


@labelquery_bp.route('/suggest/meddra', methods=['GET'])
def suggest_meddra():
    q = (request.args.get('q') or '').strip()
    level = (request.args.get('level') or 'pt').lower()
    target_db = (request.args.get('target_db') or request.args.get('targetDb') or 'local').lower()
    if len(q) < 2 or level not in _MEDDRA_LEVELS:
        return jsonify({'suggestions': []})

    try:
        if target_db == 'oracle':
            table, column = _ORACLE_MEDDRA_LEVELS[level]
            sql = f"SELECT DISTINCT {column} AS name FROM {table} WHERE UPPER({column}) LIKE :q ORDER BY name FETCH NEXT 30 ROWS ONLY"
            from dashboard.services.fdalabel_db import FDALabelDBService
            oracle_rows = FDALabelDBService.execute_oracle_query(sql, {'q': f'%{q.upper()}%'})
            suggestions = [r.get('NAME') or r.get('name') for r in oracle_rows if r and (r.get('NAME') or r.get('name'))]
            return jsonify({'suggestions': suggestions})
        else:
            table, column = _MEDDRA_LEVELS[level]
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


@labelquery_bp.route('/meddra/hierarchy', methods=['GET'])
def get_meddra_hierarchy():
    term = (request.args.get('term') or '').strip()
    level = (request.args.get('level') or 'pt').lower()
    target_db = (request.args.get('target_db') or request.args.get('targetDb') or 'local').lower()
    if not term:
        return jsonify({'term': term, 'path': [], 'formatted': ''})

    try:
        if target_db == 'oracle':
            from dashboard.services.fdalabel_db import FDALabelDBService
            if level == 'llt':
                sql = """
                    SELECT mh.SOC_NAME, mh.HLGT_NAME, mh.HLT_NAME, mh.PT_NAME, llt.LLT_NAME
                    FROM meddra.low_level_term llt
                    JOIN meddra.meddra_hierarchy mh ON mh.PT_CODE = llt.PT_CODE AND mh.PRIMARY_SOC_FG = 'Y'
                    WHERE UPPER(llt.LLT_NAME) = :t
                    FETCH NEXT 1 ROWS ONLY
                """
            else:
                sql = """
                    SELECT mh.SOC_NAME, mh.HLGT_NAME, mh.HLT_NAME, mh.PT_NAME
                    FROM meddra.meddra_hierarchy mh
                    WHERE UPPER(mh.PT_NAME) = :t AND mh.PRIMARY_SOC_FG = 'Y'
                    FETCH NEXT 1 ROWS ONLY
                """
            oracle_rows = FDALabelDBService.execute_oracle_query(sql, {'t': term.upper()})
            if not oracle_rows:
                # Retry without PRIMARY_SOC_FG filter
                if level == 'llt':
                    sql = """
                        SELECT mh.SOC_NAME, mh.HLGT_NAME, mh.HLT_NAME, mh.PT_NAME, llt.LLT_NAME
                        FROM meddra.low_level_term llt
                        JOIN meddra.meddra_hierarchy mh ON mh.PT_CODE = llt.PT_CODE
                        WHERE UPPER(llt.LLT_NAME) LIKE :t
                        FETCH NEXT 1 ROWS ONLY
                    """
                else:
                    sql = """
                        SELECT mh.SOC_NAME, mh.HLGT_NAME, mh.HLT_NAME, mh.PT_NAME
                        FROM meddra.meddra_hierarchy mh
                        WHERE UPPER(mh.PT_NAME) LIKE :t
                        FETCH NEXT 1 ROWS ONLY
                    """
                oracle_rows = FDALabelDBService.execute_oracle_query(sql, {'t': f'%{term.upper()}%'})

            if oracle_rows:
                r = oracle_rows[0]
                cols = ['SOC_NAME', 'HLGT_NAME', 'HLT_NAME', 'PT_NAME']
                if level == 'llt' and ('LLT_NAME' in r or 'llt_name' in r):
                    cols.append('LLT_NAME')
                path = [r.get(c) or r.get(c.lower()) for c in cols if r.get(c) or r.get(c.lower())]
                formatted = ' → '.join(path)
                return jsonify({'term': term, 'level': level, 'path': path, 'formatted': formatted})
        else:
            # Local PostgreSQL
            if level == 'llt':
                sql = """
                    SELECT s.soc_name, g.hlgt_name, t.hlt_name, p.pt_name, l.llt_name
                    FROM public.meddra_llt l
                    JOIN public.meddra_pt p ON p.pt_code = l.pt_code
                    JOIN public.meddra_mdhier h ON h.pt_code = p.pt_code
                    JOIN public.meddra_soc s ON s.soc_code = h.soc_code
                    JOIN public.meddra_hlgt g ON g.hlgt_code = h.hlgt_code
                    JOIN public.meddra_hlt t ON t.hlt_code = h.hlt_code
                    WHERE LOWER(l.llt_name) = LOWER(%(t)s)
                    LIMIT 1
                """
            else:
                sql = """
                    SELECT s.soc_name, g.hlgt_name, t.hlt_name, p.pt_name
                    FROM public.meddra_pt p
                    JOIN public.meddra_mdhier h ON h.pt_code = p.pt_code
                    JOIN public.meddra_soc s ON s.soc_code = h.soc_code
                    JOIN public.meddra_hlgt g ON g.hlgt_code = h.hlgt_code
                    JOIN public.meddra_hlt t ON t.hlt_code = h.hlt_code
                    WHERE LOWER(p.pt_name) = LOWER(%(t)s)
                    LIMIT 1
                """
            rows = _rows(sql, {'t': term})
            if rows:
                r = rows[0]
                cols = ['soc_name', 'hlgt_name', 'hlt_name', 'pt_name']
                if level == 'llt' and 'llt_name' in r:
                    cols.append('llt_name')
                path = [r[c] for c in cols if r.get(c)]
                formatted = ' → '.join(path)
                return jsonify({'term': term, 'level': level, 'path': path, 'formatted': formatted})

        return jsonify({'term': term, 'level': level, 'path': [term], 'formatted': term})
    except Exception as e:
        return jsonify({'term': term, 'level': level, 'path': [term], 'formatted': term, 'error': str(e)})


@labelquery_bp.route('/meddra/llts', methods=['GET'])
def get_meddra_llts():
    """
    Every Lowest Level Term under one Preferred Term.

    This is what a PT selection actually searches for: label text writes the
    LLT, not the PT, so a PT is only a handle for its descendants. The panel
    shows them so the breadth of a PT pick is visible before the search runs.

    Names only, on both targets. Oracle matches LLT_CODE rather than text when
    it compiles the query -- see _compile_meddra -- but a code is not something
    a reviewer can check, so the code stays server-side and the name is what
    gets displayed.
    """
    term = (request.args.get('term') or '').strip()
    target_db = (request.args.get('target_db') or request.args.get('targetDb') or 'local').lower()
    if not term:
        return jsonify({'term': term, 'llts': []})

    try:
        if target_db == 'oracle':
            from dashboard.services.fdalabel_db import FDALabelDBService
            rows = FDALabelDBService.execute_oracle_query(
                """
                SELECT DISTINCT llt.LLT_NAME AS name
                FROM meddra.low_level_term llt
                JOIN meddra.preferred_term pt ON pt.PT_CODE = llt.PT_CODE
                WHERE UPPER(pt.PT_NAME) = :t
                ORDER BY name
                """,
                {'t': term.upper()},
            )
            llts = [r.get('NAME') or r.get('name') for r in rows if r.get('NAME') or r.get('name')]
        else:
            rows = _rows(
                """
                SELECT DISTINCT l.llt_name AS name
                FROM public.meddra_llt l
                JOIN public.meddra_pt p ON p.pt_code = l.pt_code
                WHERE LOWER(p.pt_name) = LOWER(%(t)s)
                ORDER BY name
                """,
                {'t': term},
            )
            llts = [r['name'] for r in rows if r.get('name')]

        return jsonify({'term': term, 'llts': llts, 'count': len(llts)})
    except Exception as e:
        return jsonify({'term': term, 'llts': [], 'count': 0, 'error': str(e)})


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

    if 'full_fts' not in _capability_cache:
        # Can free text use the document-level vector on sum_spl, or does it
        # have to go the old way, through spl_sections?
        #
        # This has to be all-or-nothing. A partially populated column can't be
        # mixed with a per-row fallback: `IS NULL` is not GIN-indexable, so an
        # OR would cost a sequential scan on every search, and the two paths
        # search different text (the document vector also covers product and
        # manufacturer names) — the same query would apply different rules to
        # different labels.
        #
        # Unpopulated on a fresh column, so it stays False until
        # db_10_populate_full_search_vector.py (or a post-import refresh) has
        # finished. Restart the app afterwards to re-probe.
        try:
            rows = _rows(
                'SELECT 1 FROM labeling.sum_spl '
                'WHERE full_search_vector IS NULL LIMIT 1'
            )
            _capability_cache['full_fts'] = not rows
        except Exception:
            # Column missing entirely (database predates it) — take the
            # section path, which works everywhere.
            _capability_cache['full_fts'] = False

    return dict(_capability_cache)


#: target_db values that mean Oracle. 'oracle_all' additionally widens the base
#: table from the human-only rollup to the raw one; see _oracle_base_table.
_ORACLE_TARGETS = ('oracle', 'fdalabel', 'oracle_all')


def _oracle_base_table(target_db):
    """
    Which summary rollup an Oracle query is based on.

    'oracle' keeps DGV_SUM_RX_SPL, the curated human-labeling subset that
    FDALabel itself presents. 'oracle_all' uses the raw SUM_SPL, which is the
    only one that has animal and other non-human labeling in it -- searching for
    those against the curated table returned zero rows.
    """
    from .oracle_compiler import BASE_TABLE_ALL, BASE_TABLE_HUMAN
    return BASE_TABLE_ALL if str(target_db or '').lower() == 'oracle_all' else BASE_TABLE_HUMAN


def _expand_meddra(level, terms):
    """
    Resolves a MedDRA selection to the term names actually written in label
    text. Passed into the compiler so it stays DB-free.

    Label prose writes the Lowest Level Term, not the grouping above it, so
    every level expands *downward* to LLTs. A PT is a handle for its
    descendants: picking "Hepatic failure" has to match a label that says
    "Liver failure", and matching the PT string alone silently misses it.

    Returns [] when nothing could be expanded — an empty MedDRA dictionary is a
    common deployment state, and the caller has to be able to tell that apart
    from a real expansion so it can say the search fell back to literal text.
    """
    level = (level or 'pt').lower()
    if not terms:
        return list(terms)

    if level == 'llt':
        # Already the leaf level; nothing below it to reach.
        return list(terms)

    if level == 'pt':
        sql = """
            SELECT DISTINCT l.llt_name AS name
            FROM public.meddra_llt l JOIN public.meddra_pt p ON p.pt_code = l.pt_code
            WHERE p.pt_name = ANY(%(terms)s)
        """
    else:
        column = {
            'hlt': 'hlt_name',
            'hlgt': 'hlgt_name',
            'soc': 'soc_name',
        }.get(level)
        if not column:
            return []
        sql = f"""
            SELECT DISTINCT l.llt_name AS name
            FROM public.meddra_mdhier h
            JOIN public.meddra_llt l ON l.pt_code = h.pt_code
            WHERE h.{column} = ANY(%(terms)s)
        """
    try:
        rows = _rows(sql, {'terms': list(terms)})
    except Exception:
        return []
    # Keep the originals too: the selected term can itself appear in prose, and
    # a PT name is usually also an LLT under itself, so this costs nothing.
    names = [r['name'] for r in rows if r['name']]
    return (names + list(terms))[:400] if names else []


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

    # Clamp the requested page into the browse window.
    offset = min(offset, max(0, BROWSE_CAP - 1))
    limit = max(1, min(limit, BROWSE_CAP - offset))

    # Target database selection: check explicit target_db payload first
    target_db = str(payload.get('target_db') or payload.get('source') or '').lower()
    use_oracle = (target_db in _ORACLE_TARGETS) or (target_db != 'local' and FDALabelDBService.is_internal())

    if use_oracle:
        conn = FDALabelDBService.get_oracle_connection()
        if not conn and target_db in _ORACLE_TARGETS:
            return jsonify({
                'error': 'Target database requested is Oracle, but Oracle DB connection failed. Please verify Oracle host/VPN or credentials.',
                'results': [],
                'total': 0,
                'warnings': ['Oracle connection failed. Local database fallback avoided because Oracle target was explicitly selected.']
            }), 503

        if conn:
            try:
                from .oracle_compiler import compile_oracle_query, OracleQueryCompileError
                sql, params, warnings = compile_oracle_query(
                    query,
                    sort=payload.get('sort'),
                    direction=payload.get('dir'),
                    limit=limit,
                    offset=offset,
                    expand_meddra=_expand_meddra,
                    capabilities=_capabilities(),
                    base_table=_oracle_base_table(target_db),
                )
            except OracleQueryCompileError as e:
                conn.close()
                return jsonify({'error': str(e)}), 400

            try:
                cur = conn.cursor()
                cur.execute(sql, params)
                rows = cur.fetchall()
                cur.close()

                results = []
                total = 0
                if rows:
                    first_r = rows[0]
                    if isinstance(first_r, dict):
                        total = first_r.get('total_count') or first_r.get('TOTAL_COUNT') or 0
                    else:
                        total = first_r[15] if len(first_r) > 15 else 0

                    for r in rows:
                        set_id_val = r.get('set_id') or r.get('SET_ID') if isinstance(r, dict) else r[0]
                        if not set_id_val:
                            continue
                        if isinstance(r, dict):
                            results.append(r)
                        else:
                            results.append({
                                'set_id': r[0],
                                'spl_id': r[1],
                                'product_names': r[2],
                                'generic_names': r[3],
                                'manufacturer': r[4],
                                'appr_num': r[5],
                                'ndc_codes': r[6],
                                'revised_date': r[7],
                                'market_categories': r[8],
                                'doc_type': r[9],
                                'active_ingredients': r[10],
                                'dosage_forms': r[11],
                                'routes': r[12],
                                'epc': r[13],
                                'is_rld': bool(r[14]),
                                'is_rs': False
                            })

                browsable = min(total, BROWSE_CAP)
                capped = total > BROWSE_CAP

                return jsonify({
                    'results': results,
                    'total': total,
                    'browsable': browsable,
                    'cap': BROWSE_CAP,
                    'capped': capped,
                    'limit': limit,
                    'offset': offset,
                    'warnings': warnings,
                    'query': sql,
                    'sql': sql,
                })
            except Exception as e:
                formatted_sql = sql
                if params and isinstance(params, dict):
                    param_lines = "\n".join([f"-- :{k} = {repr(v)}" for k, v in params.items()])
                    formatted_sql = f"{param_lines}\n\n{sql}" if sql else ""
                return jsonify({
                    'error': f'Oracle query execution failed: {e}',
                    'query': formatted_sql or sql,
                    'sql': formatted_sql or sql,
                    'params': params
                }), 500
            finally:
                conn.close()

    try:
        relational_where, section_where, params, warnings = compile_where(
            query, expand_meddra=_expand_meddra, capabilities=_capabilities()
        )
    except QueryCompileError as e:
        return jsonify({'error': str(e)}), 400

    order_by = order_by_sql(payload.get('sort'), payload.get('dir'))
    sort_column = sort_column_sql(payload.get('sort'))
    sort_dir = sort_direction_sql(payload.get('dir'))

    conn = None
    try:
        conn = _pg()
        page_params = dict(params)
        page_params['_limit'] = limit
        page_params['_offset'] = offset

        if section_where:
            sql = f"""
            WITH section_candidates AS (
                SELECT DISTINCT sec.spl_id
                FROM labeling.spl_sections sec
                WHERE {section_where}
            ),
            matched AS MATERIALIZED (
                SELECT s.spl_id, {sort_column} AS sort_key, s.set_id
                FROM labeling.sum_spl s
                INNER JOIN section_candidates sc ON sc.spl_id = s.spl_id
                WHERE {relational_where}
            ),
            page AS (
                SELECT spl_id FROM matched
                ORDER BY sort_key {sort_dir} NULLS LAST, set_id
                LIMIT %(_limit)s OFFSET %(_offset)s
            )
            SELECT t.n AS total_count, {SELECT_COLUMNS}
            FROM (SELECT COUNT(*) AS n FROM matched) t
            LEFT JOIN page ON TRUE
            LEFT JOIN labeling.sum_spl s ON s.spl_id = page.spl_id
            ORDER BY {order_by}
            """
        else:
            sql = f"""
            WITH matched AS MATERIALIZED (
                SELECT s.spl_id, {sort_column} AS sort_key, s.set_id
                FROM labeling.sum_spl s
                WHERE {relational_where}
            ),
            page AS (
                SELECT spl_id FROM matched
                ORDER BY sort_key {sort_dir} NULLS LAST, set_id
                LIMIT %(_limit)s OFFSET %(_offset)s
            )
            SELECT t.n AS total_count, {SELECT_COLUMNS}
            FROM (SELECT COUNT(*) AS n FROM matched) t
            LEFT JOIN page ON TRUE
            LEFT JOIN labeling.sum_spl s ON s.spl_id = page.spl_id
            ORDER BY {order_by}
            """

        with conn.cursor() as cur:
            cur.execute(sql, page_params)
            rows = [dict(r) for r in cur.fetchall()]

        total = rows[0]['total_count'] if rows else 0
        results = [{k: v for k, v in r.items() if k != 'total_count'}
                   for r in rows if r.get('spl_id')]

        return jsonify({
            'results': results,
            'total': total,
            'browsable': min(total, BROWSE_CAP),
            'cap': BROWSE_CAP,
            'capped': total > BROWSE_CAP,
            'limit': limit,
            'offset': offset,
            'warnings': warnings,
        })
    except Exception as e:
        formatted_sql = sql if 'sql' in locals() else None
        page_params_val = page_params if 'page_params' in locals() else None
        if formatted_sql and page_params_val and isinstance(page_params_val, dict):
            param_lines = "\n".join([f"-- %({k})s = {repr(v)}" for k, v in page_params_val.items()])
            formatted_sql = f"{param_lines}\n\n{formatted_sql}"
        return jsonify({
            'error': str(e),
            'query': formatted_sql,
            'sql': formatted_sql
        }), 500
    finally:
        if conn:
            conn.close()


# ---------------------------------------------------------------------------
# Export
# ---------------------------------------------------------------------------

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


def _export_rows(query, sort, direction, target_db=None):
    target_str = str(target_db or '').lower()
    use_oracle = (target_str in _ORACLE_TARGETS) or (target_str != 'local' and FDALabelDBService.is_internal())

    if use_oracle:
        conn = FDALabelDBService.get_oracle_connection()
        if not conn:
            raise RuntimeError('Oracle DB connection failed for export. Please check credentials or host.')
        try:
            from .oracle_compiler import compile_oracle_query
            sql, params, warnings = compile_oracle_query(
                query,
                sort=sort,
                direction=direction,
                limit=None,
                offset=0,
                expand_meddra=_expand_meddra,
                capabilities=_capabilities(),
                base_table=_oracle_base_table(target_str),
            )
            cur = conn.cursor()
            cur.execute(sql, params)
            rows = cur.fetchall()
            cur.close()

            results = []
            for r in rows:
                if isinstance(r, dict):
                    set_id_val = r.get('set_id') or r.get('SET_ID')
                    if set_id_val:
                        results.append(r)
                else:
                    if r[0]:
                        results.append({
                            'set_id': r[0],
                            'spl_id': r[1],
                            'product_names': r[2],
                            'generic_names': r[3],
                            'manufacturer': r[4],
                            'appr_num': r[5],
                            'ndc_codes': r[6],
                            'revised_date': r[7],
                            'market_categories': r[8],
                            'doc_type': r[9],
                            'active_ingredients': r[10],
                            'dosage_forms': r[11],
                            'routes': r[12],
                            'epc': r[13],
                            'is_rld': bool(r[14]),
                            'is_rs': False,
                            'active_uniis': '',
                            'initial_approval_year': ''
                        })
            return results
        finally:
            conn.close()

    # Postgres / Local mode: full result export without artificial limits
    relational_where, section_where, params, warnings = compile_where(
        query, expand_meddra=_expand_meddra, capabilities=_capabilities()
    )
    order_by = order_by_sql(sort, direction)

    conn = _pg()
    try:
        if section_where:
            sql = f"""
            WITH section_candidates AS (
                SELECT DISTINCT sec.spl_id
                FROM labeling.spl_sections sec
                WHERE {section_where}
            )
            SELECT {SELECT_COLUMNS}
            FROM labeling.sum_spl s
            INNER JOIN section_candidates sc ON sc.spl_id = s.spl_id
            WHERE {relational_where}
            ORDER BY {order_by}
            """
        else:
            sql = f"""
            SELECT {SELECT_COLUMNS}
            FROM labeling.sum_spl s
            WHERE {relational_where}
            ORDER BY {order_by}
            """
        with conn.cursor() as cur:
            cur.execute(sql, params)
            return [dict(r) for r in cur.fetchall()]
    finally:
        conn.close()


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

    target_db = str(payload.get('target_db') or payload.get('source') or '').lower()

    try:
        rows = _export_rows(payload.get('query') or {}, payload.get('sort'), payload.get('dir'), target_db=target_db)
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

Criteria inside a group are combined with AND, per label. Groups are combined
with OR. Prefer ONE group unless the request clearly asks for alternatives
("either X or Y").

AND is per label, not per section: two text criteria in one group are satisfied
by the same label even when the matches fall in different sections. So "boxed
warning mentions X and the label mentions Y anywhere" is two criteria in one
group, not one criterion with both terms.

Allowed "type" values and the exact shape of their "value":

- "labelingType"      {"values": ["HUMAN PRESCRIPTION DRUG LABEL"]}
- "applicationType"   {"values": ["NDA"]}          // ANDA, BLA, NDA, NDA authorized generic, OTC monograph drug
- "route"             {"values": ["ORAL"]}
- "dosageForm"        {"values": ["TABLET, FILM COATED"]}   // exact NCI SPL term; "TABLET" does not match "TABLET, FILM COATED"
- "productName"       {"field": "any"|"trade"|"generic",
                       "op": "contains"|"startsWith"|"equals"|"notContains",
                       "text": "metformin"}
- "fullText"          {"mode": "simple"|"advanced", "text": "hepatic failure"}
- "applicationType"   {"values": ["NDA"], "isRldRs": false, "excludeRepackager": true}
- "marketStatus"      {"status": "active", "startDateMin": "2020-01-01", "startDateMax": "2023-12-31"} // status: active|completed|discontinued, plus optional startDateMin/Max
- "deaSchedule"       {"values": ["CII"]}          // CI, CII, CIII, CIV, CV -- Oracle only
- "activeMoiety"      {"op": "equals"|"startsWith"|"contains", "terms": ["Amphetamine"]}  // Oracle only; the active part of the molecule, so it catches salts
- "meddra"            {"level": "pt"|"llt", "terms": ["Hepatic failure"]}
- "pharmClass"        {"classType": "any"|"epc"|"moa"|"pe"|"cs", "terms": ["Kinase Inhibitor"]}
- "identifier"        {"text": "NDA 021436", "ingredientType": "active"|"inactive"|"both"}

Rules:
1. Adverse events and medical concepts: prefer "meddra" over free text.
   Give the ONE Preferred Term that names the concept. Do NOT list synonyms or
   near-synonyms -- a PT is automatically expanded to every Lowest Level Term
   beneath it before the search runs, so "Hepatic failure" already covers
   "Liver failure", "Hepatic insufficiency", "Hepatic decompensation" and the
   rest. Listing them yourself does not widen the search; it only risks pulling
   in terms that belong to a different PT.
   Use several "terms" only for genuinely distinct concepts (e.g.
   ["Hepatic failure", "Hepatitis"]), not for wordings of one concept.
   Use "level": "llt" only when the request names one specific lowest-level
   wording and should not be widened.
2. Free text is the fallback, for wording MedDRA does not cover (trial design,
   storage, dosing language). Then "mode": "advanced" with terms joined by OR
   is right: "\"black box\" OR boxed".
3. Target Sections:
   When specific sections are named (e.g. "Boxed Warning", "Warnings and Precautions", "Adverse Reactions"):
   - Use "labelingSection" with "sections": ["BOXED WARNING", "WARNINGS AND PRECAUTIONS", "ADVERSE REACTIONS"] and place the search terms in "text".
   - A "meddra" criterion also accepts "sections" to confine it the same way.
4. A drug name goes in "productName", never "identifier". "identifier" is for
   codes: application number, Set ID, SPL ID (SPL GUID), UNII.
5. Pharmacologic class: set "classType" to what was actually asked for --
   "moa" for a mechanism ("kinase inhibition"), "pe" for a physiologic effect,
   "cs" for a chemical structure class, "epc" for an established pharmacologic
   class. Use "any" only when the request does not say.
6. Market status: "rld" and "rs" are Orange Book roles; "marketed" and
   "discontinued" are derived from marketing end dates and are NOT opposites --
   a label carrying several products can be both.
7. Never return an empty "groups" array when medical concepts, adverse events,
   or labeling sections are requested.
"""


#: Appended to the system prompt per request. The panel targets one of three
#: databases and they do not answer the same questions, so the model is told
#: which one before it picks criteria rather than having its output filtered
#: afterwards -- a dropped criterion is a silently narrower search.
_TRANSLATE_SCOPE_NOTES = {
    'local': """
Target database: LOCAL import (PostgreSQL).
- "deaSchedule", "activeMoiety" and "applicationType" are NOT available. Do not
  emit them; put the requirement in "notes" instead. (applicationType is off
  here because its counts and its results disagree on this import.)
- "chemicalStructure" is not available on any target. Never emit it.
""",
    'oracle': """
Target database: FDALabel Oracle, CDER-CBER scope.
- This scope covers HUMAN labeling only. Animal labeling is absent, so never
  emit a "labelingType" of animal Rx or animal OTC here -- say in "notes" that
  the FDA scope is needed for it.
- "chemicalStructure" is not available on any target. Never emit it.
""",
    'oracle_all': """
Target database: FDALabel Oracle, full FDA scope.
- Covers all labeling, human and animal.
- "chemicalStructure" is not available on any target. Never emit it.
""",
}


#: Criteria that cannot be evaluated per target. Mirrors CRITERION_SUPPORT in
#: frontend/app/querybuilder/types.ts -- keep the two in step.
_TARGET_UNSUPPORTED = {
    'local': {'deaSchedule', 'activeMoiety', 'applicationType', 'chemicalStructure'},
    'oracle': {'chemicalStructure'},
    'oracle_all': {'chemicalStructure'},
}

_ALLOWED_TYPES = {
    'labelingType', 'applicationType', 'route', 'productName', 'fullText',
    'labelingSection', 'marketStatus', 'meddra', 'pharmClass', 'identifier',
    'chemicalStructure', 'dosageForm', 'deaSchedule', 'activeMoiety',
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


def _sanitize_translation(parsed, target_db='local'):
    """
    Keeps only criteria the compiler understands and normalizes loose LLM outputs.

    Criteria the chosen database cannot evaluate are dropped here as a backstop.
    The prompt already tells the model which those are; this catches the case
    where it emits one anyway, and says so in the notes rather than letting the
    search quietly run wider than asked.
    """
    unsupported = _TARGET_UNSUPPORTED.get(target_db, _TARGET_UNSUPPORTED['local'])
    groups = []
    dropped = []
    unavailable = []
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
            if ctype in unsupported:
                unavailable.append(str(ctype))
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
    if unavailable:
        notes.append(
            'Not available on the selected database, so left out: '
            + ', '.join(sorted(set(unavailable)))
        )
    return {'groups': groups}, notes


@labelquery_bp.route('/translate', methods=['POST'])
def translate():
    payload = request.get_json(silent=True) or {}
    intent = (payload.get('intent') or '').strip()
    if not intent:
        return jsonify({'error': 'intent is required'}), 400

    target_db = (payload.get('target_db') or payload.get('targetDb') or 'local').lower()
    if target_db not in _TRANSLATE_SCOPE_NOTES:
        target_db = 'oracle' if target_db in _ORACLE_TARGETS else 'local'

    from dashboard.services.ai_handler import call_llm

    user = current_user._get_current_object() if current_user.is_authenticated else None
    try:
        raw = call_llm(
            user=user,
            system_prompt=TRANSLATE_SYSTEM_PROMPT + _TRANSLATE_SCOPE_NOTES[target_db],
            user_message=json.dumps({'request': intent}),
            temperature=0.0,
        )
    except Exception as e:
        return jsonify({'error': f'AI translation failed: {e}'}), 502

    parsed = _parse_json_object(raw)
    if not isinstance(parsed, dict):
        return jsonify({'error': 'The model did not return a usable query.'}), 502

    query, notes = _sanitize_translation(parsed, target_db)
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

