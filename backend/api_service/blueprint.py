"""
RESTful API Service (v1) for askFDALabel.

Provides structured search over FDA Drug Labels using the CDER-CBER Oracle DB.
Supports:
  - Full-text search across SPL sections
  - Product Name(s) (trade, generic, active ingredient)
  - Identifiers (Application Number, NDC, Set ID, SPL ID, UNII)
  - Labeling types, application types, dosage forms, routes, sections, pharmacologic classes
  - Standard JSON response format with pagination and metadata
  - API-Key authentication (via header or query parameter)

Note on Database:
  Target is pinned to CDER-CBER Oracle DB (BASE_TABLE_HUMAN). Any client-supplied
  target_db / db_source parameter is accepted for interface compatibility but ignored.
"""

import os
import re
import json
from datetime import datetime
from flask import Blueprint, request, jsonify, g, current_app

try:
    import defusedxml.ElementTree as ET
except ImportError:
    import xml.etree.ElementTree as ET

from dashboard.services.fdalabel_db import FDALabelDBService
from database import db, User, LabelPvProfile
from labelquery.oracle_compiler import (
    BASE_TABLE_HUMAN,
    compile_oracle_query,
    OracleQueryCompileError,
)

api_v1_bp = Blueprint('api_v1', __name__)

MAX_API_LIMIT = 1000
DEFAULT_API_LIMIT = 50


def _extract_api_user():
    """
    Extracts the authenticated User associated with this request if an API Key is provided.
    Supports:
      - Header 'X-API-Key: <key>'
      - Header 'Authorization: Bearer <key>'
      - Query param '?api_key=<key>'
      - Current session user (if logged in via web)
    
    Non-blocking: If no key is provided, returns None without halting execution.
    """
    api_key = None
    
    auth_header = request.headers.get('Authorization', '').strip()
    if auth_header.lower().startswith('bearer '):
        api_key = auth_header[7:].strip()
    elif request.headers.get('X-API-Key'):
        api_key = request.headers.get('X-API-Key').strip()
    elif request.args.get('api_key'):
        api_key = request.args.get('api_key').strip()

    if api_key:
        user = User.query.filter_by(api_key=api_key).first()
        if user and getattr(user, 'is_active', True) is not False:
            return user

    # Fallback to session user if logged in
    from flask_login import current_user
    if current_user and current_user.is_authenticated:
        return current_user

    return None


@api_v1_bp.before_request
def authenticate_request():
    """Attach user to flask.g if found, without blocking unauthenticated requests."""
    g.api_user = _extract_api_user()


def _as_list_param(val):
    """Parses a parameter that can be a list or a comma-separated string."""
    if val is None:
        return []
    if isinstance(val, (list, tuple)):
        items = []
        for v in val:
            items.extend([s.strip() for s in str(v).split(',') if s.strip()])
        return items
    return [s.strip() for s in str(val).split(',') if s.strip()]


def _build_criteria_tree_from_params(params):
    """
    Converts flat REST parameters (from GET query params or POST JSON body)
    into the criteria tree format accepted by the Oracle compiler.
    Excludes AI and MedDRA filters.
    """
    criteria = []

    # 1. Full-text search
    full_text = (params.get('full_text') or params.get('q') or '').strip()
    if full_text:
        mode = params.get('full_text_mode') or params.get('mode') or 'simple'
        criteria.append({
            'type': 'fullText',
            'value': {
                'text': full_text,
                'mode': 'advanced' if mode.lower() == 'advanced' else 'simple'
            }
        })

    # 2. Product Name search
    product_name = (
        params.get('product_name') or params.get('trade_name') or
        params.get('generic_name') or params.get('active_ingredient') or ''
    ).strip()
    if product_name:
        field = 'any'
        if params.get('trade_name'):
            field = 'trade'
        elif params.get('generic_name'):
            field = 'generic'
        elif params.get('product_name_field'):
            f = str(params.get('product_name_field')).strip().lower()
            if f in ('trade', 'generic', 'any'):
                field = f

        op = (params.get('match_mode') or params.get('name_match') or params.get('op') or 'contains').strip().lower()
        if op not in ('equals', 'contains', 'starts_with'):
            op = 'contains'

        criteria.append({
            'type': 'productName',
            'value': {
                'field': field,
                'op': op,
                'text': product_name,
                'verified': False
            }
        })

    # 3. Product IDs / Identifiers
    identifier = (
        params.get('identifier') or params.get('id') or
        params.get('appl_num') or params.get('application_number') or
        params.get('ndc') or params.get('set_id') or
        params.get('spl_id') or params.get('unii') or ''
    ).strip()
    if identifier:
        criteria.append({
            'type': 'identifier',
            'value': {
                'text': identifier,
                'ingredientType': params.get('ingredient_type', '')
            }
        })

    # 4. Labeling Type
    labeling_types = _as_list_param(params.get('labeling_type') or params.get('labeling_types') or params.get('doc_type'))
    plr = str(params.get('plr') or 'all').strip().lower()
    if labeling_types or plr in ('plr', 'non_plr'):
        criteria.append({
            'type': 'labelingType',
            'value': {
                'values': labeling_types,
                'plr': plr if plr in ('plr', 'non_plr') else 'all'
            }
        })

    # 5. Application Type / Marketing Category
    app_types = _as_list_param(params.get('application_type') or params.get('marketing_category') or params.get('market_categories'))
    if app_types:
        criteria.append({
            'type': 'applicationType',
            'value': {
                'values': app_types,
                'isRld': False
            }
        })

    # 6. Route of Administration
    routes = _as_list_param(params.get('route') or params.get('routes'))
    if routes:
        criteria.append({
            'type': 'route',
            'value': {
                'values': routes
            }
        })

    # 7. Dosage Form
    dosage_forms = _as_list_param(params.get('dosage_form') or params.get('dosage_forms'))
    if dosage_forms:
        criteria.append({
            'type': 'dosageForm',
            'value': {
                'values': dosage_forms
            }
        })

    # 8. Labeling Section search
    section_text = (params.get('section_text') or '').strip()
    sections = _as_list_param(params.get('section') or params.get('sections') or params.get('section_loinc'))
    if section_text or sections:
        criteria.append({
            'type': 'labelingSection',
            'value': {
                'text': section_text,
                'sections': sections,
                'mode': 'advanced' if str(params.get('section_mode', '')).lower() == 'advanced' else 'simple'
            }
        })

    # 9. Market Status / RLD
    is_rld = params.get('is_rld')
    market_status_vals = _as_list_param(params.get('market_status') or params.get('marketing_status'))
    if is_rld is not None or market_status_vals:
        vals = list(market_status_vals)
        if str(is_rld).lower() in ('true', '1', 'yes') and 'rld' not in vals:
            vals.append('rld')
        criteria.append({
            'type': 'marketStatus',
            'value': {
                'values': vals,
                'startDateMin': params.get('start_date_min', ''),
                'startDateMax': params.get('start_date_max', ''),
            }
        })

    # 10. Pharmacologic Class (EPC)
    pharm_classes = _as_list_param(params.get('pharm_class') or params.get('epc') or params.get('pharm_classes'))
    if pharm_classes:
        criteria.append({
            'type': 'pharmClass',
            'value': {
                'terms': pharm_classes,
                'classType': 'epc'
            }
        })

    # 11. Active Moiety
    active_moiety = (params.get('active_moiety') or '').strip()
    if active_moiety:
        criteria.append({
            'type': 'activeMoiety',
            'value': {
                'text': active_moiety,
                'matchType': 'exact' if str(params.get('moiety_match_type', '')).lower() == 'exact' else 'contains'
            }
        })

    # 12. DEA Schedule
    dea = (params.get('dea_schedule') or params.get('dea') or '').strip()
    if dea:
        criteria.append({
            'type': 'deaSchedule',
            'value': {
                'schedule': dea
            }
        })

    if not criteria:
        return {'groups': []}

    return {'groups': [{'criteria': criteria}]}


def _sanitize_query_groups(query):
    """Removes MedDRA and AI/unsupported criteria if present in a custom wire query."""
    cleaned_groups = []
    for g in (query.get('groups') or []):
        cleaned_criteria = []
        for c in (g.get('criteria') or []):
            ctype = c.get('type')
            if ctype == 'meddra':
                continue
            cleaned_criteria.append(c)
        if cleaned_criteria:
            cleaned_groups.append({'criteria': cleaned_criteria})
    return {'groups': cleaned_groups}


@api_v1_bp.route('/status', methods=['GET'])
def api_status():
    """Returns API status and available features."""
    oracle_conn = None
    oracle_ok = False
    try:
        oracle_conn = FDALabelDBService.get_oracle_connection()
        oracle_ok = oracle_conn is not None
    except Exception:
        oracle_ok = False
    finally:
        if oracle_conn:
            try:
                oracle_conn.close()
            except Exception:
                pass

    return jsonify({
        'status': 'operational',
        'version': '1.0.0',
        'database_target': 'CDER-CBER Oracle DB',
        'oracle_connected': oracle_ok,
        'authentication': {
            'authenticated': bool(g.api_user),
            'user': g.api_user.username if g.api_user else None
        },
        'supported_endpoints': [
            'GET  /api/v1/search',
            'POST /api/v1/search',
            'GET  /api/v1/labels/<set_id_or_spl_id>',
            'GET  /api/v1/sections/<set_id_or_spl_id>',
            'POST /api/v1/sections/<set_id_or_spl_id>',
            'GET  /api/v1/pvlabeling/<set_id_or_spl_id>',
            'GET  /api/v1/status'
        ]
    })


@api_v1_bp.route('/search', methods=['GET', 'POST'])
def search_labels():
    """
    RESTful label search endpoint.
    Queries the CDER-CBER Oracle DB directly.
    
    Accepts:
      - GET: Query parameters (e.g. ?q=diabetes&product_name=metformin&limit=20)
      - POST: JSON body with flat parameters or structured {'query': {...}} criteria
    """
    # Gather parameters
    params = {}
    if request.method == 'GET':
        for key in request.args:
            vals = request.args.getlist(key)
            params[key] = vals if len(vals) > 1 else vals[0]
    else:
        json_body = request.get_json(silent=True) or {}
        params.update(json_body)

    # Check for structured query vs flat params
    if 'query' in params and isinstance(params['query'], dict) and 'groups' in params['query']:
        query = _sanitize_query_groups(params['query'])
    else:
        query = _build_criteria_tree_from_params(params)

    # Pagination
    try:
        limit = max(1, min(int(params.get('limit') or DEFAULT_API_LIMIT), MAX_API_LIMIT))
    except (TypeError, ValueError):
        limit = DEFAULT_API_LIMIT

    try:
        page = max(1, int(params.get('page') or 1))
        offset = (page - 1) * limit if 'page' in params and 'offset' not in params else max(0, int(params.get('offset') or 0))
    except (TypeError, ValueError):
        page = 1
        offset = 0

    sort = params.get('sort') or 'revised_date'
    direction = params.get('dir') or params.get('order') or 'desc'

    # Ensure Oracle DB Connection
    conn = FDALabelDBService.get_oracle_connection()
    if not conn:
        return jsonify({
            'status': 'error',
            'error': 'Oracle CDER-CBER database is unavailable. Please verify network or credentials.',
            'pagination': {
                'total': 0,
                'page': page,
                'limit': limit,
                'offset': offset,
                'total_pages': 0
            },
            'results': []
        }), 503

    try:
        # Pinned to BASE_TABLE_HUMAN
        sql, sql_params, warnings = compile_oracle_query(
            query,
            sort=sort,
            direction=direction,
            limit=limit,
            offset=offset,
            base_table=BASE_TABLE_HUMAN
        )
    except OracleQueryCompileError as e:
        conn.close()
        return jsonify({
            'status': 'error',
            'error': f'Query compilation error: {str(e)}'
        }), 400
    except Exception as e:
        conn.close()
        return jsonify({
            'status': 'error',
            'error': f'Failed to build query: {str(e)}'
        }), 400

    try:
        cur = conn.cursor()
        cur.execute(sql, sql_params)
        rows = cur.fetchall()
        cur.close()

        results = []
        total = 0

        if rows:
            first_r = rows[0]
            if isinstance(first_r, dict):
                total = int(first_r.get('total_count') or first_r.get('TOTAL_COUNT') or 0)
            else:
                total = int(first_r[16] if len(first_r) > 16 else (first_r[15] if len(first_r) > 15 else 0))

            for r in rows:
                if isinstance(r, dict):
                    set_id = r.get('set_id') or r.get('SET_ID')
                    if not set_id:
                        continue
                    rev_date = r.get('revised_date') or r.get('REVISED_DATE') or ''
                    results.append({
                        'set_id': set_id,
                        'spl_id': r.get('spl_id') or r.get('SPL_ID'),
                        'product_names': r.get('product_names') or r.get('PRODUCT_NAMES') or '',
                        'generic_names': r.get('generic_names') or r.get('GENERIC_NAMES') or '',
                        'manufacturer': r.get('manufacturer') or r.get('MANUFACTURER') or '',
                        'appr_num': r.get('appr_num') or r.get('APPR_NUM') or '',
                        'ndc_codes': r.get('ndc_codes') or r.get('NDC_CODES') or '',
                        'ndc3_codes': r.get('ndc3_codes') or r.get('NDC3_CODES') or '',
                        'revised_date': str(rev_date),
                        'market_categories': r.get('market_categories') or r.get('MARKET_CATEGORIES') or '',
                        'doc_type': r.get('doc_type') or r.get('DOCUMENT_TYPE') or '',
                        'active_ingredients': r.get('active_ingredients') or r.get('ACTIVE_INGREDIENTS') or '',
                        'dosage_forms': r.get('dosage_forms') or r.get('DOSAGE_FORMS') or '',
                        'routes': r.get('routes') or r.get('ROUTES') or '',
                        'epc': r.get('epc') or r.get('EPC') or '',
                        'is_rld': bool(r.get('is_rld') or r.get('IS_RLD')),
                        'active_uniis': r.get('active_uniis') or r.get('ACTIVE_UNIIS'),
                        'active_moiety': r.get('active_moiety') or r.get('ACTIVE_MOIETY'),
                        'active_moiety_uniis': r.get('active_moiety_uniis') or r.get('ACTIVE_MOIETY_UNIIS'),
                        'links': {
                            'fdalabel': f"https://nctr-crs.fda.gov/fdalabel/ui/search/spl/{set_id}",
                            'dailymed': f"https://dailymed.nlm.nih.gov/dailymed/lookup.cfm?setid={set_id}",
                            'dailymed_pdf': f"https://dailymed.nlm.nih.gov/dailymed/getpdf.cfm?setid={set_id}"
                        }
                    })
                else:
                    set_id = r[0]
                    if not set_id:
                        continue
                    rev_date = r[8] or ''
                    results.append({
                        'set_id': set_id,
                        'spl_id': r[1],
                        'product_names': r[2] or '',
                        'generic_names': r[3] or '',
                        'manufacturer': r[4] or '',
                        'appr_num': r[5] or '',
                        'ndc_codes': r[6] or '',
                        'ndc3_codes': r[7] or '',
                        'revised_date': str(rev_date),
                        'market_categories': r[9] or '',
                        'doc_type': r[10] or '',
                        'active_ingredients': r[11] or '',
                        'dosage_forms': r[12] or '',
                        'routes': r[13] or '',
                        'epc': r[14] or '',
                        'is_rld': bool(r[15]),
                        'active_uniis': r[17] if len(r) > 17 else None,
                        'active_moiety': r[18] if len(r) > 18 else None,
                        'active_moiety_uniis': r[19] if len(r) > 19 else None,
                        'links': {
                            'fdalabel': f"https://nctr-crs.fda.gov/fdalabel/ui/search/spl/{set_id}",
                            'dailymed': f"https://dailymed.nlm.nih.gov/dailymed/lookup.cfm?setid={set_id}",
                            'dailymed_pdf': f"https://dailymed.nlm.nih.gov/dailymed/getpdf.cfm?setid={set_id}"
                        }
                    })

        total_pages = (total + limit - 1) // limit if limit > 0 else 1
        current_page = (offset // limit) + 1 if limit > 0 else 1

        return jsonify({
            'status': 'success',
            'pagination': {
                'total': total,
                'page': current_page,
                'limit': limit,
                'offset': offset,
                'total_pages': total_pages
            },
            'results': results,
            'meta': {
                'database': 'oracle_cder_cber',
                'authenticated': bool(g.api_user),
                'user': g.api_user.username if g.api_user else None,
                'warnings': warnings
            }
        })

    except Exception as e:
        return jsonify({
            'status': 'error',
            'error': f'Database execution error: {str(e)}'
        }), 500
    finally:
        conn.close()


def _local_tag(tag):
    """Strips XML namespace prefix from tag name."""
    if not tag:
        return ""
    return tag.split('}')[-1] if '}' in tag else tag


def extract_sections_from_spl_xml(xml_content, target_loinc_codes=None):
    """
    Parses SPL XML and extracts sections matching target_loinc_codes.
    If target_loinc_codes is None or empty, extracts all structured sections having a LOINC code.
    Returns a list of dicts:
      [
        {
          'loinc_code': '34066-1',
          'display_name': 'BOXED WARNING SECTION',
          'title': 'BOXED WARNING',
          'section_number': 'Boxed Warning',
          'xml_content': '<section ...>...</section>',
          'text_content': 'Clean text content...'
        },
        ...
      ]
    """
    if not xml_content:
        return []

    try:
        root = ET.fromstring(xml_content.encode('utf-8') if isinstance(xml_content, str) else xml_content)
    except Exception as e:
        current_app.logger.error(f"Error parsing SPL XML: {e}")
        return []

    targets = None
    if target_loinc_codes:
        targets = set(str(c).strip().upper() for c in target_loinc_codes if str(c).strip())

    sections = []

    PLR_MAP = {
        '34066-1': 'Boxed Warning',
        '34067-9': '1', '34068-7': '2', '43678-2': '3', '34070-3': '4',
        '43685-7': '5', '34084-4': '6', '34073-7': '7', '43684-0': '8',
        '42227-9': '9', '34088-5': '10', '34089-3': '11', '34090-1': '12',
        '34091-9': '13', '34092-7': '14', '34093-5': '15', '34069-5': '16',
        '34076-0': '17'
    }

    def _extract_text(elem):
        if elem is None:
            return ""
        return " ".join("".join(elem.itertext()).split()).strip()

    def _traverse_section(sec_el):
        code_node = next((c for c in sec_el if _local_tag(c.tag) == 'code'), None)
        code_val = code_node.get('code', '').strip() if code_node is not None else ""
        code_display = code_node.get('displayName', '').strip() if code_node is not None else ""

        title_node = next((c for c in sec_el if _local_tag(c.tag) == 'title'), None)
        title = _extract_text(title_node)

        if not title and code_display:
            title = code_display.replace(' SECTION', '').replace('OTC - ', '').strip()

        matched = False
        if targets is None:
            matched = bool(code_val)
        else:
            if code_val.upper() in targets:
                matched = True

        if matched and code_val:
            try:
                sec_xml = ET.tostring(sec_el, encoding='unicode')
            except Exception:
                sec_xml = ""

            text_node = next((c for c in sec_el if _local_tag(c.tag) == 'text'), None)
            text_content = _extract_text(text_node) if text_node is not None else _extract_text(sec_el)

            section_num = PLR_MAP.get(code_val, "")
            if not section_num and title:
                m = re.match(r'^(\d+(?:\.\d+)?)\s+', title)
                if m:
                    section_num = m.group(1)

            sections.append({
                'loinc_code': code_val,
                'display_name': code_display,
                'title': title,
                'section_number': section_num,
                'xml_content': sec_xml,
                'text_content': text_content
            })

        for comp in sec_el:
            if _local_tag(comp.tag) == 'component':
                for child_sec in comp:
                    if _local_tag(child_sec.tag) == 'section':
                        _traverse_section(child_sec)

    for sb in root.iter():
        if _local_tag(sb.tag) == 'structuredBody':
            for comp in sb:
                if _local_tag(comp.tag) == 'component':
                    for sec in comp:
                        if _local_tag(sec.tag) == 'section':
                            _traverse_section(sec)

    return sections


def _fetch_label_metadata_row(id_clean):
    """
    Fetches the label metadata row from CDER-CBER Oracle table, with fallback to local PostgreSQL labeling.sum_spl.
    Returns (data_dict, set_id, spl_id) or (None, None, None).
    """
    conn = FDALabelDBService.get_oracle_connection()
    if conn:
        try:
            cur = conn.cursor()
            sql = f"""
                SELECT s.SET_ID, s.SPL_GUID as SPL_ID, s.PRODUCT_NAMES, s.PRODUCT_NORMD_GENERIC_NAMES as GENERIC_NAMES,
                       s.AUTHOR_ORG_NORMD_NAME as MANUFACTURER, s.APPR_NUM, s.NDC_CODES, s.NDC3_CODES, s.EFF_TIME as REVISED_DATE,
                       s.MARKET_CATEGORIES, s.DOCUMENT_TYPE, s.ACT_INGR_NAMES as ACTIVE_INGREDIENTS,
                       s.DOSAGE_FORMS, s.ROUTES_OF_ADMINISTRATION as ROUTES, s.EPC,
                       CASE WHEN EXISTS (SELECT 1 FROM druglabel.SUM_SPL_RLD rld WHERE rld.SPL_ID = s.SPL_ID) THEN 1 ELSE 0 END as IS_RLD,
                       s.ACT_INGR_UNIIS as ACTIVE_UNIIS
                FROM {BASE_TABLE_HUMAN} s
                WHERE UPPER(s.SET_ID) = UPPER(:id) OR UPPER(s.SPL_GUID) = UPPER(:id)
                FETCH FIRST 1 ROWS ONLY
            """
            cur.execute(sql, {'id': id_clean})
            row = cur.fetchone()
            cur.close()

            if row:
                if isinstance(row, dict):
                    set_id = row.get('SET_ID') or row.get('set_id')
                    spl_id = row.get('SPL_ID') or row.get('spl_id')
                    data = {
                        'set_id': set_id,
                        'spl_id': spl_id,
                        'product_names': row.get('PRODUCT_NAMES') or row.get('product_names') or '',
                        'generic_names': row.get('GENERIC_NAMES') or row.get('generic_names') or '',
                        'manufacturer': row.get('MANUFACTURER') or row.get('manufacturer') or '',
                        'appr_num': row.get('APPR_NUM') or row.get('appr_num') or '',
                        'ndc_codes': row.get('NDC_CODES') or row.get('ndc_codes') or '',
                        'ndc3_codes': row.get('NDC3_CODES') or row.get('ndc3_codes') or '',
                        'revised_date': str(row.get('REVISED_DATE') or row.get('revised_date') or ''),
                        'market_categories': row.get('MARKET_CATEGORIES') or row.get('market_categories') or '',
                        'doc_type': row.get('DOCUMENT_TYPE') or row.get('doc_type') or '',
                        'active_ingredients': row.get('ACTIVE_INGREDIENTS') or row.get('active_ingredients') or '',
                        'dosage_forms': row.get('DOSAGE_FORMS') or row.get('dosage_forms') or '',
                        'routes': row.get('ROUTES') or row.get('routes') or '',
                        'epc': row.get('EPC') or row.get('epc') or '',
                        'is_rld': bool(row.get('IS_RLD') or row.get('is_rld')),
                        'active_uniis': row.get('ACTIVE_UNIIS') or row.get('active_uniis'),
                        'links': {
                            'fdalabel': f"https://nctr-crs.fda.gov/fdalabel/ui/search/spl/{set_id}",
                            'dailymed': f"https://dailymed.nlm.nih.gov/dailymed/lookup.cfm?setid={set_id}",
                            'dailymed_pdf': f"https://dailymed.nlm.nih.gov/dailymed/getpdf.cfm?setid={set_id}"
                        }
                    }
                else:
                    set_id = row[0]
                    spl_id = row[1]
                    data = {
                        'set_id': set_id,
                        'spl_id': spl_id,
                        'product_names': row[2] or '',
                        'generic_names': row[3] or '',
                        'manufacturer': row[4] or '',
                        'appr_num': row[5] or '',
                        'ndc_codes': row[6] or '',
                        'ndc3_codes': row[7] or '',
                        'revised_date': str(row[8] or ''),
                        'market_categories': row[9] or '',
                        'doc_type': row[10] or '',
                        'active_ingredients': row[11] or '',
                        'dosage_forms': row[12] or '',
                        'routes': row[13] or '',
                        'epc': row[14] or '',
                        'is_rld': bool(row[15]),
                        'active_uniis': row[16] if len(row) > 16 else None,
                        'links': {
                            'fdalabel': f"https://nctr-crs.fda.gov/fdalabel/ui/search/spl/{set_id}",
                            'dailymed': f"https://dailymed.nlm.nih.gov/dailymed/lookup.cfm?setid={set_id}",
                            'dailymed_pdf': f"https://dailymed.nlm.nih.gov/dailymed/getpdf.cfm?setid={set_id}"
                        }
                    }
                return data, set_id, spl_id
        except Exception as e:
            current_app.logger.warning(f"Error querying Oracle for label {id_clean}: {e}")
        finally:
            conn.close()

    # Fallback to PostgreSQL if Oracle row was not found
    try:
        from database.models import DrugLabel
        dl = DrugLabel.query.filter(
            (db.func.upper(DrugLabel.set_id) == id_clean.upper()) |
            (db.func.upper(DrugLabel.spl_id) == id_clean.upper())
        ).first()
        if dl:
            set_id = dl.set_id
            spl_id = dl.spl_id
            data = {
                'set_id': set_id,
                'spl_id': spl_id,
                'product_names': dl.product_names or '',
                'generic_names': dl.generic_names or '',
                'manufacturer': dl.manufacturer or '',
                'appr_num': dl.appr_num or '',
                'ndc_codes': dl.ndc_codes or '',
                'ndc3_codes': dl.ndc3_codes or '',
                'revised_date': str(dl.revised_date or ''),
                'market_categories': dl.market_categories or '',
                'doc_type': dl.doc_type or '',
                'active_ingredients': dl.active_ingredients or '',
                'dosage_forms': dl.dosage_forms or '',
                'routes': dl.routes or '',
                'epc': dl.epc or '',
                'is_rld': bool(dl.is_rld),
                'active_uniis': dl.active_uniis,
                'links': {
                    'fdalabel': f"https://nctr-crs.fda.gov/fdalabel/ui/search/spl/{set_id}",
                    'dailymed': f"https://dailymed.nlm.nih.gov/dailymed/lookup.cfm?setid={set_id}",
                    'dailymed_pdf': f"https://dailymed.nlm.nih.gov/dailymed/getpdf.cfm?setid={set_id}"
                }
            }
            return data, set_id, spl_id
    except Exception as e:
        current_app.logger.warning(f"Error querying Postgres for label {id_clean}: {e}")

    return None, None, None


@api_v1_bp.route('/labels/<id_val>', methods=['GET'])
def get_label_by_id(id_val):
    """
    Retrieves metadata and full SPL XML content for a specific label by SET ID or SPL ID (GUID).
    """
    id_clean = (id_val or '').strip()
    if not id_clean:
        return jsonify({'status': 'error', 'error': 'ID is required'}), 400

    data, set_id, spl_id = _fetch_label_metadata_row(id_clean)
    if not data:
        return jsonify({'status': 'error', 'error': 'Label not found'}), 404

    # Resolve full SPL XML
    xml_content, xml_source = None, None
    try:
        xml_content, xml_source = FDALabelDBService.resolve_spl_xml(set_id, spl_id=spl_id)
    except Exception as e:
        current_app.logger.warning(f"Error resolving XML for {set_id}: {e}")

    return jsonify({
        'status': 'success',
        'label': data,
        'xml_content': xml_content,
        'xml_source': xml_source,
        'meta': {
            'database': 'oracle_cder_cber',
            'authenticated': bool(g.api_user),
            'user': g.api_user.username if g.api_user else None
        }
    })


@api_v1_bp.route('/sections/<id_val>', methods=['GET', 'POST'])
def get_label_sections_by_id(id_val):
    """
    Retrieves the basic SPL metadata plus targeted section XML snippets matching
    one or more requested LOINC codes (supporting multi-sections).
    
    Query / Body parameters:
      - loinc_code (or loinc, section, sections, code, codes): LOINC code(s) (e.g. 34066-1,34067-9)
    """
    id_clean = (id_val or '').strip()
    if not id_clean:
        return jsonify({'status': 'error', 'error': 'ID is required'}), 400

    # Extract requested LOINC codes
    raw_codes = []
    if request.method == 'GET':
        for key in ('loinc_code', 'loinc', 'sections', 'section', 'code', 'codes'):
            for v in request.args.getlist(key):
                raw_codes.extend(_as_list_param(v))
    else:
        body = request.get_json(silent=True) or {}
        for key in ('loinc_code', 'loinc_codes', 'loinc', 'sections', 'section', 'code', 'codes'):
            if key in body:
                raw_codes.extend(_as_list_param(body[key]))

    target_loinc_codes = [c.strip() for c in raw_codes if c.strip()]

    # Fetch metadata
    data, set_id, spl_id = _fetch_label_metadata_row(id_clean)
    if not data:
        return jsonify({'status': 'error', 'error': 'Label not found'}), 404

    # Resolve XML
    xml_content, xml_source = None, None
    try:
        xml_content, xml_source = FDALabelDBService.resolve_spl_xml(set_id, spl_id=spl_id)
    except Exception as e:
        current_app.logger.warning(f"Error resolving XML for {set_id}: {e}")

    if not xml_content:
        return jsonify({
            'status': 'error',
            'error': 'No SPL XML content available for this label.',
            'label': data,
            'meta': {
                'database': 'oracle_cder_cber',
                'authenticated': bool(g.api_user),
                'user': g.api_user.username if g.api_user else None
            }
        }), 404

    # Extract sections
    sections = extract_sections_from_spl_xml(xml_content, target_loinc_codes=target_loinc_codes if target_loinc_codes else None)

    return jsonify({
        'status': 'success',
        'label': {
            'set_id': data.get('set_id'),
            'spl_id': data.get('spl_id'),
            'product_names': data.get('product_names'),
            'generic_names': data.get('generic_names'),
            'manufacturer': data.get('manufacturer'),
            'appr_num': data.get('appr_num'),
            'ndc_codes': data.get('ndc_codes'),
            'revised_date': data.get('revised_date'),
            'market_categories': data.get('market_categories'),
            'doc_type': data.get('doc_type'),
            'dosage_forms': data.get('dosage_forms'),
            'routes': data.get('routes'),
            'epc': data.get('epc'),
            'is_rld': data.get('is_rld'),
            'links': data.get('links')
        },
        'requested_loinc_codes': target_loinc_codes,
        'matched_sections_count': len(sections),
        'sections': sections,
        'xml_source': xml_source,
        'meta': {
            'database': 'oracle_cder_cber',
            'authenticated': bool(g.api_user),
            'user': g.api_user.username if g.api_user else None
        }
    })


@api_v1_bp.route('/pvlabeling/<id_val>', methods=['GET'])
@api_v1_bp.route('/pv-profile/<id_val>', methods=['GET'])
def get_pvlabeling_by_id(id_val):
    """
    Retrieves the extracted PV-Profile adverse event table and leftover MedDRA terms
    in structured JSON corresponding to the PV Labeling CSV export.
    
    If no PV-Profile has been generated yet for this label, returns a 404 response
    with clear guidance and a direct link to the PV-Profile tool in the UI.
    """
    id_clean = (id_val or '').strip()
    if not id_clean:
        return jsonify({'status': 'error', 'error': 'ID is required'}), 400

    data, set_id, spl_id = _fetch_label_metadata_row(id_clean)
    lookup_set_id = set_id or id_clean
    lookup_spl_id = spl_id or (id_clean if not set_id else None)

    # Check for cached LabelPvProfile
    cached = None
    try:
        cached = LabelPvProfile.query.filter(
            (db.func.upper(LabelPvProfile.set_id) == lookup_set_id.upper()) |
            (db.func.upper(LabelPvProfile.spl_id) == (lookup_spl_id or '').upper())
        ).first()
    except Exception as e:
        current_app.logger.warning(f"Error querying LabelPvProfile for {id_clean}: {e}")

    api_server_host = os.getenv('API_SERVER_HOST') or 'ncshpcgpu01.fda.gov'
    pv_tool_url = f"http://{api_server_host}/fdalabel-v3/dashboard/label/{lookup_set_id}/pv-profile"

    if not cached or not cached.profile_data:
        return jsonify({
            'status': 'not_generated',
            'has_pv_profile': False,
            'message': 'No PV-Profile has been generated for this labeling yet. Please open the PV-Profile tool in askFDALabel web interface to generate it manually before accessing it via API.',
            'pv_profile_tool_url': pv_tool_url,
            'label': data or {
                'set_id': lookup_set_id,
                'spl_id': lookup_spl_id
            },
            'meta': {
                'database': 'oracle_cder_cber',
                'authenticated': bool(g.api_user),
                'user': g.api_user.username if g.api_user else None
            }
        }), 404

    # Parse profile payload
    try:
        profile_data = json.loads(cached.profile_data)
    except Exception as e:
        return jsonify({
            'status': 'error',
            'error': f'Corrupt PV profile data stored in cache: {str(e)}'
        }), 500

    # Build structured adverse events corresponding to CSV export table
    items = profile_data.get('items', [])
    adverse_events = []
    for item in items:
        drug_freq = item.get('drug_frequency_text')
        if not drug_freq and item.get('drug_max_pct') is not None:
            drug_freq = f"{item.get('drug_max_pct')}%"
        elif not drug_freq and item.get('drug_min_pct') is not None:
            drug_freq = f"{item.get('drug_min_pct')}%"

        placebo_freq = item.get('placebo_frequency_text')
        if not placebo_freq and item.get('placebo_pct') is not None:
            placebo_freq = f"{item.get('placebo_pct')}%"

        adverse_events.append({
            'severity_tier': item.get('severity_tier'),
            'severity_tier_label': f"Tier {item.get('severity_tier')}" if item.get('severity_tier') else "",
            'section': item.get('section_name') or item.get('source_section') or '',
            'side_effect_pt': item.get('meddra_pt') or item.get('term') or '',
            'raw_term': item.get('term') or '',
            'is_mapped': bool(item.get('is_mapped')),
            'match_type': 'Mapped' if item.get('is_mapped') else 'Exact Match',
            'meddra_soc': item.get('soc_name') or '',
            'drug_frequency': drug_freq or '',
            'placebo_frequency': placebo_freq or '',
            'risk_difference_pct': item.get('risk_difference_pct'),
            'frequency_category': item.get('frequency_category') or '',
            'excerpt': item.get('excerpt') or '',
            'occurrences': item.get('occurrences', [])
        })

    # Build leftover MedDRA dictionary matches corresponding to CSV export
    leftover_terms_raw = profile_data.get('leftover_terms', [])
    leftover_terms = []
    for lt in leftover_terms_raw:
        leftover_terms.append({
            'matched_term': lt.get('term') or '',
            'meddra_soc': lt.get('soc_name') or '',
            'source_section': lt.get('section_name') or ''
        })

    return jsonify({
        'status': 'success',
        'has_pv_profile': True,
        'label': {
            'set_id': lookup_set_id,
            'spl_id': cached.spl_id or lookup_spl_id,
            'brand_name': cached.brand_name or (data.get('product_names') if data else ''),
            'generic_name': cached.generic_name or (data.get('generic_names') if data else ''),
            'active_ingredient': cached.active_ingredient or (data.get('active_ingredients') if data else ''),
            'manufacturer': data.get('manufacturer') if data else '',
            'appr_num': data.get('appr_num') if data else '',
            'effective_time': str(data.get('revised_date') if data else ''),
            'label_format': cached.label_format or profile_data.get('label_format'),
            'links': data.get('links') if data else {
                'fdalabel': f"https://nctr-crs.fda.gov/fdalabel/ui/search/spl/{lookup_set_id}",
                'dailymed': f"https://dailymed.nlm.nih.gov/dailymed/lookup.cfm?setid={lookup_set_id}",
                'dailymed_pdf': f"https://dailymed.nlm.nih.gov/dailymed/getpdf.cfm?setid={lookup_set_id}"
            }
        },
        'summary': {
            'total_adverse_events': len(adverse_events),
            'total_leftover_terms': len(leftover_terms),
            'generated_at': profile_data.get('generated_at'),
            'cached_at': cached.created_at.isoformat() if cached.created_at else None,
            'model_used': profile_data.get('model_used'),
            'tier_summary': profile_data.get('tier_summary', {}),
            'soc_summary': profile_data.get('soc_summary', [])
        },
        'adverse_events': adverse_events,
        'leftover_terms': leftover_terms,
        'pv_profile_tool_url': pv_tool_url,
        'meta': {
            'database': 'oracle_cder_cber',
            'authenticated': bool(g.api_user),
            'user': g.api_user.username if g.api_user else None
        }
    })


