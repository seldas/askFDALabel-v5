from flask import Blueprint, request, jsonify, send_file
from dashboard.services.fdalabel_db import FDALabelDBService
from openpyxl import Workbook
from io import BytesIO
from datetime import datetime

localquery_bp = Blueprint('localquery', __name__)

@localquery_bp.route('/stats', methods=['GET'])
def get_stats():
    """
    Returns statistics about the local label database.
    """
    try:
        stats = FDALabelDBService.get_stats()
        return jsonify(stats)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@localquery_bp.route('/search', methods=['GET'])
def local_search():
    """
    Simple search for local label database.
    Supports Brand Name, Generic Name, Set ID, and Application Number.
    """
    query = request.args.get('query', '').strip()
    human_rx_only = request.args.get('human_rx_only') == 'true'
    rld_only = request.args.get('rld_only') == 'true'
    rs_only = request.args.get('rs_only') == 'true'
    use_archive = request.args.get('use_archive') == 'true'

    if not query:
        return jsonify({'results': [], 'total': 0})

    try:
        results = FDALabelDBService.local_search(
            query, 
            human_rx_only=human_rx_only, 
            rld_only=rld_only,
            rs_only=rs_only,
            force_local=use_archive
        )
        total = len(results)
            
        return jsonify({
            'results': results,
            'total': total
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@localquery_bp.route('/export', methods=['GET', 'POST'])
def export_results():
    """
    Exports searched results as an Excel table importable by the dashboard.
    Supports exporting by query string or specific list of spl_ids.
    """
    query = request.args.get('query', '').strip()
    spl_ids = []
    
    # Check if spl_ids are provided (either in args or JSON body for POST)
    if request.method == 'POST':
        data = request.get_json() or {}
        spl_ids = data.get('spl_ids') or data.get('set_ids', [])
    else:
        # Prioritize spl_ids parameter
        spl_ids_raw = request.args.get('spl_ids') or request.args.get('set_ids', '')
        if spl_ids_raw:
            spl_ids = [sid.strip() for sid in spl_ids_raw.split(',') if sid.strip()]

    if not query and not spl_ids:
        return jsonify({'error': 'No query or spl_ids provided'}), 400

    try:
        if spl_ids:
            results = FDALabelDBService.get_labels_by_spl_ids_for_export(spl_ids)
        else:
            results = FDALabelDBService.get_labels_for_export(query)
            
        if not results:
            return jsonify({'error': 'No results found to export'}), 404

        wb = Workbook()
        ws = wb.active
        ws.title = "LocalQuery Export"

        # Headers from the first result keys
        headers = list(results[0].keys())
        ws.append(headers)

        for row in results:
            ws.append([row.get(h, '') for h in headers])

        # Auto-adjust column widths
        for col in ws.columns:
            max_length = 0
            column = col[0].column_letter
            for cell in col:
                try:
                    if len(str(cell.value)) > max_length:
                        max_length = len(str(cell.value))
                except: pass
            ws.column_dimensions[column].width = min(40, max_length + 2)

        output = BytesIO()
        wb.save(output)
        output.seek(0)

        filename = f"LocalQuery_Export_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx"
        return send_file(
            output,
            mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            as_attachment=True,
            download_name=filename
        )
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@localquery_bp.route('/autocomplete', methods=['GET'])
def autocomplete():
    """
    Autocomplete suggestions for Brand/Generic names.
    """
    query = request.args.get('query', '').strip()
    human_rx_only = request.args.get('human_rx_only') == 'true'
    rld_only = request.args.get('rld_only') == 'true'
    rs_only = request.args.get('rs_only') == 'true'

    if not query or len(query) < 2:
        return jsonify({'suggestions': []})

    try:
        suggestions = FDALabelDBService.get_autocomplete_suggestions(
            query, 
            human_rx_only=human_rx_only, 
            rld_only=rld_only,
            rs_only=rs_only
        )
        return jsonify({'suggestions': suggestions})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@localquery_bp.route('/random', methods=['GET'])
def get_random():
    """
    Returns 5 random records for quick access.
    """
    human_rx_only = request.args.get('human_rx_only') == 'true'
    rld_only = request.args.get('rld_only') == 'true'
    rs_only = request.args.get('rs_only') == 'true'
    try:
        results = FDALabelDBService.get_random_labels(
            limit=5, 
            human_rx_only=human_rx_only, 
            rld_only=rld_only,
            rs_only=rs_only
        )
        return jsonify({'results': results})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@localquery_bp.route('/rld_search', methods=['GET'])
def rld_search():
    """
    Search for Reference Listed Drugs (RLD) from the Orange Book.
    Supports matching ingredient, trade_name, and appl_no.
    """
    from database.models import OrangeBook
    from sqlalchemy import or_

    query = request.args.get('query', '').strip()
    
    if not query:
        return jsonify({'results': [], 'total': 0})

    try:
        q = f"%{query}%"
        rld_only = request.args.get('rld_only', 'false').lower() == 'true'
        rs_only = request.args.get('rs_only', 'false').lower() == 'true'

        # Search Orange Book
        query_obj = OrangeBook.query.filter(
            or_(
                OrangeBook.ingredient.ilike(q),
                OrangeBook.trade_name.ilike(q),
                OrangeBook.appl_no.ilike(q)
            )
        )
        if rld_only:
            query_obj = query_obj.filter(OrangeBook.rld == 'Yes')
        if rs_only:
            query_obj = query_obj.filter(OrangeBook.rs == 'Yes')
        
        obs = query_obj.all()
        
        results = []
        for ob in obs:
            prefix = 'NDA' if ob.appl_type == 'N' else ('ANDA' if ob.appl_type == 'A' else '')
            formatted_appl_no = f'{prefix}{ob.appl_no}' if prefix else ob.appl_no
            results.append({
                'formatted_appl_no': formatted_appl_no,
                'ingredient': ob.ingredient,
                'trade_name': ob.trade_name,
                'df_route': ob.df_route,
                'strength': ob.strength,
                'applicant': ob.applicant,
                'appl_no': ob.appl_no,
                'product_no': ob.product_no,
                'te_code': ob.te_code,
                'approval_date': ob.approval_date,
                'rld': ob.rld,
                'rs': ob.rs,
                'type': ob.type
            })
            
        return jsonify({
            'results': results,
            'total': len(results)
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@localquery_bp.route('/rld_random', methods=['GET'])
def rld_random():
    """
    Returns 5 random records from the Orange Book.
    """
    from database.models import OrangeBook
    from sqlalchemy.sql.expression import func

    try:
        rld_only = request.args.get('rld_only', 'false').lower() == 'true'
        rs_only = request.args.get('rs_only', 'false').lower() == 'true'
        
        query_obj = OrangeBook.query
        if rld_only:
            query_obj = query_obj.filter(OrangeBook.rld == 'Yes')
        if rs_only:
            query_obj = query_obj.filter(OrangeBook.rs == 'Yes')
            
        obs = query_obj.order_by(func.random()).limit(5).all()
        
        results = []
        for ob in obs:
            prefix = 'NDA' if ob.appl_type == 'N' else ('ANDA' if ob.appl_type == 'A' else '')
            formatted_appl_no = f'{prefix}{ob.appl_no}' if prefix else ob.appl_no
            results.append({
                'formatted_appl_no': formatted_appl_no,
                'ingredient': ob.ingredient,
                'trade_name': ob.trade_name,
                'df_route': ob.df_route,
                'strength': ob.strength,
                'applicant': ob.applicant,
                'appl_no': ob.appl_no,
                'product_no': ob.product_no,
                'te_code': ob.te_code,
                'approval_date': ob.approval_date,
                'rld': ob.rld,
                'rs': ob.rs,
                'type': ob.type
            })
            
        return jsonify({
            'results': results,
            'total': len(results)
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500
