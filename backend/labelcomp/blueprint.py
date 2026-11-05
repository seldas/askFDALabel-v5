from flask import Blueprint, request, jsonify, current_app
from flask_login import current_user, login_required
from database import Favorite, ComparisonSummary
from dashboard.services.xml_handler import parse_spl_xml, flatten_sections, get_aggregate_content
from dashboard.services.fda_client import get_label_metadata, get_label_xml
from dashboard.utils import normalize_text_for_diff, get_section_sort_key, normalize_title_text, extract_numeric_section_id
import re
import json
import hashlib
from difflib import SequenceMatcher
from .compare import get_comparison_summary

labelcomp_bp = Blueprint('labelcomp', __name__)

@labelcomp_bp.route('/summarize', methods=['POST'])
@login_required
def summarize():
    data = request.json
    if not data:
        return jsonify({'error': 'Missing JSON data'}), 400
    set_ids = data.get('set_ids')
    comparison_data = data.get('comparison_data')
    label_names = data.get('label_names')
    force_refresh = data.get('force_refresh', False)
    
    try:
        user_obj = current_user._get_current_object()
        summary = get_comparison_summary(user_obj, set_ids, comparison_data, label_names, force_refresh)
        return jsonify({'summary': summary})
    except Exception as e:
        current_app.logger.error(f"Summarization error: {e}")
        return jsonify({'error': str(e)}), 500

@labelcomp_bp.route('/', methods=['GET', 'POST'], strict_slashes=False)
def index():
    """Returns label comparison data as JSON."""
    if request.method == 'POST':
        set_ids = request.form.getlist('set_ids')
        spl_ids = request.form.getlist('spl_ids')
        drug_name = request.form.get('drug_name')
    else:
        set_ids = request.args.getlist('set_ids')
        spl_ids = request.args.getlist('spl_ids')
        drug_name = request.args.get('drug_name')
    
    if not set_ids:
        return jsonify({
            'labels': [], 
            'comparison_data': [],
            'selected_labels_metadata': [],
            'drug_name': drug_name,
            'current_set_ids': []
        })

    selected_labels_metadata = []
    labels_data = []
    all_section_keys = {}
    comparison_format = 'PLR'

    for i, set_id in enumerate(set_ids):
        spl_id = spl_ids[i] if i < len(spl_ids) else None
        label_xml_raw = get_label_xml(set_id, spl_id=spl_id)
        if label_xml_raw:
            from dashboard.services.xml_handler import extract_metadata_from_xml
            doc_title, sections, _, _, _, _ = parse_spl_xml(label_xml_raw, set_id)
            flat_sections = flatten_sections(sections)
            
            meta = extract_metadata_from_xml(label_xml_raw)
            if not meta.get('brand_name') or meta.get('brand_name') == 'N/A':
                db_meta = get_label_metadata(set_id, spl_id=spl_id)
                if db_meta:
                    meta.update(db_meta)

            if not meta.get('set_id'):
                meta['set_id'] = set_id

            # Ensure is_rld is present
            if 'is_rld' not in meta:
                db_meta = get_label_metadata(set_id, spl_id=spl_id)
                if db_meta:
                    meta['is_rld'] = db_meta.get('is_rld', False)
                else:
                    meta['is_rld'] = False

            selected_labels_metadata.append(meta)
            label_format = meta.get('label_format', 'PLR')

            sections_by_key = {}
            for s in flat_sections:
                if s.get('title'):
                    raw_title = s['title']
                    norm_title = normalize_title_text(raw_title)

                    if label_format == 'PLR':
                        normalized_title = (norm_title or '').strip().lower()

                        if re.search(r'\bboxed warning(s)?\b', normalized_title):
                            key = '0'
                        else:
                            key = extract_numeric_section_id(raw_title)

                        if key:
                            content = get_aggregate_content(s)
                            sections_by_key[key] = content
                            if key not in all_section_keys:
                                all_section_keys[key] = {}
                            if normalized_title not in all_section_keys[key]:
                                all_section_keys[key][normalized_title] = raw_title
                    else:
                        key = norm_title
                        if key:
                            sections_by_key[key] = s.get('content', '')
                            if key not in all_section_keys:
                                all_section_keys[key] = {}
                            if norm_title not in all_section_keys[key]:
                                all_section_keys[key][norm_title] = raw_title

            labels_data.append({
                'title': doc_title,
                'sections_by_key': sections_by_key
            })

    if comparison_format == 'PLR':
        sorted_keys = sorted(all_section_keys.keys(), key=lambda x: get_section_sort_key(x))
    else:
        sorted_keys = sorted(all_section_keys.keys())

    comparison_data = []

    def nuanced_word_diff(text1, text2):
        if not text1: text1 = ""
        if not text2: text2 = ""
        words1 = text1.split()
        words2 = text2.split()
        matcher = SequenceMatcher(None, words1, words2)
        html1, html2 = [], []
        for tag, i1, i2, j1, j2 in matcher.get_opcodes():
            if tag == 'equal':
                chunk = " ".join(words1[i1:i2])
                html1.append(chunk); html2.append(chunk)
            elif tag == 'insert':
                chunk = " ".join(words2[j1:j2])
                html2.append(f'<ins class="diff-add">{chunk}</ins>')
            elif tag == 'delete':
                chunk = " ".join(words1[i1:i2])
                html1.append(f'<del class="diff-sub">{chunk}</del>')
            elif tag == 'replace':
                chunk1, chunk2 = " ".join(words1[i1:i2]), " ".join(words2[j1:j2])
                html1.append(f'<del class="diff-sub">{chunk1}</del>')
                html2.append(f'<ins class="diff-add">{chunk2}</ins>')
        return " ".join(html1), " ".join(html2)

    def aggressive_normalize(lines):
        if not lines: return ""
        text = " ".join(lines).lower()
        return re.sub(r'[^a-z0-9]', '', text)

    for key in sorted_keys:
        contents = [label['sections_by_key'].get(key) for label in labels_data]
        display_titles = sorted(list(all_section_keys[key].values()))
        display_title = " / ".join(display_titles)
        normalized_contents = [tuple(normalize_text_for_diff(c)) if c else None for c in contents]
        agg_normalized_contents = [aggressive_normalize(nc) for nc in normalized_contents]
        is_empty = all(not nc for nc in agg_normalized_contents)
        has_all = all(nc is not None for nc in agg_normalized_contents)
        is_same = has_all and len(set(agg_normalized_contents)) == 1
        is_major_change = False
        similarity = 1.0 if is_same else 0.0
        nuanced_contents = [None, None]

        if not is_same and len(contents) == 2:
            t1 = " ".join(normalized_contents[0]) if normalized_contents[0] else ""
            t2 = " ".join(normalized_contents[1]) if normalized_contents[1] else ""
            similarity = SequenceMatcher(None, t1, t2).ratio() if t1 and t2 else 0
            if similarity < 0.3 and len(t1) > 200 and len(t2) > 200:
                is_major_change = True
            else:
                nuanced_contents = list(nuanced_word_diff(t1, t2))

        comparison_data.append({
            'title': display_title,
            'key': key,
            'nesting_level': key.count('.') if comparison_format == 'PLR' else 0,
            'contents': contents,
            'nuanced_contents': nuanced_contents,
            'is_same': is_same,
            'is_empty': is_empty,
            'is_major_change': is_major_change,
            'similarity_ratio': similarity
        })

    existing_summary = None
    if set_ids:
        sorted_ids = sorted(set_ids)
        ids_hash = hashlib.sha256(json.dumps(sorted_ids).encode('utf-8')).hexdigest()
        cached = ComparisonSummary.query.filter_by(set_ids_hash=ids_hash).first()
        if cached:
            existing_summary = cached.summary_content

    return jsonify({
        'labels': [ld['title'] for ld in labels_data],
        'comparison_data': comparison_data,
        'selected_labels_metadata': selected_labels_metadata,
        'drug_name': drug_name,
        'current_set_ids': set_ids,
        'existing_summary': existing_summary,
        'is_authenticated': current_user.is_authenticated
    })
