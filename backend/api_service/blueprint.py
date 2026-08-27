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
from datetime import datetime
from flask import Blueprint, request, jsonify, g, current_app

from dashboard.services.fdalabel_db import FDALabelDBService
from database import db, User
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


@api_v1_bp.route('/labels/<id_val>', methods=['GET'])
def get_label_by_id(id_val):
    """
    Retrieves metadata for a specific label by SET ID or SPL ID (GUID).
    """
    id_clean = (id_val or '').strip()
    if not id_clean:
        return jsonify({'status': 'error', 'error': 'ID is required'}), 400

    conn = FDALabelDBService.get_oracle_connection()
    if not conn:
        return jsonify({
            'status': 'error',
            'error': 'Oracle CDER-CBER database is unavailable.'
        }), 503

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

        if not row:
            return jsonify({'status': 'error', 'error': 'Label not found'}), 404

        if isinstance(row, dict):
            set_id = row.get('SET_ID') or row.get('set_id')
            data = {
                'set_id': set_id,
                'spl_id': row.get('SPL_ID') or row.get('spl_id'),
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
            data = {
                'set_id': set_id,
                'spl_id': row[1],
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

        return jsonify({
            'status': 'success',
            'label': data,
            'meta': {
                'database': 'oracle_cder_cber',
                'authenticated': bool(g.api_user),
                'user': g.api_user.username if g.api_user else None
            }
        })
    except Exception as e:
        return jsonify({
            'status': 'error',
            'error': f'Database execution error: {str(e)}'
        }), 500
    finally:
        conn.close()
