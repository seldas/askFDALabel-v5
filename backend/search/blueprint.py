from flask import Blueprint, request, jsonify, send_file
from flask_login import current_user
import io
import json
import logging
import urllib.parse
import pandas as pd
from dashboard.services.ai_handler import call_llm as unified_call_llm
from search.scripts.general_search import search_general
from search.scripts.annotations import ANNOTATION_RULES

from dashboard.routes.guards import require_developer_access

search_bp = Blueprint('search', __name__)

# LabelChat / Web-test / Local Database Search are developer-only modules.
# Gated on the blueprint rather than per route so any route added later is
# covered by default; see dashboard.routes.guards.
search_bp.before_request(require_developer_access)
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Helpers for the DB-first decision tree
# ---------------------------------------------------------------------------

def _map_to_result_item(row: dict) -> dict:
    """
    Converts a row from search_labels_with_count (snake_case internal keys)
    to the ResultItem shape the Results panel expects (UPPER_CASE keys).
    """
    return {
        "set_id":           row.get("set_id", ""),
        "PRODUCT_NAMES":    row.get("brand_name", ""),
        "GENERIC_NAMES":    row.get("generic_name", ""),
        "COMPANY":          row.get("manufacturer_name", ""),
        "APPR_NUM":         row.get("application_number", ""),
        "ACT_INGR_NAMES":   row.get("active_ingredients", "") or "",
        "MARKET_CATEGORIES":row.get("market_category", "") or "",
        "DOCUMENT_TYPE":    row.get("labeling_type", "") or "",
        "Routes":           row.get("routes", "") or "",
        "DOSAGE_FORMS":     row.get("dosage_forms", "") or "",
        "EPC":              row.get("epc", "") or "",
        "NDC_CODES":        row.get("ndc", "") or "",
        "similarity_score": 1.0,
        "keywords":         "",
        "section_code":     "",
        "section_content":  "",
    }


def _generate_single_label_answer(user, query: str, meta: dict, xml_content: str) -> str:
    """
    Calls the LLM to produce a concise, annotated answer grounded in a single labeling document.
    Falls back to a structured summary if LLM fails.
    """
    product = meta.get("brand_name") or meta.get("generic_name") or "this product"
    set_id  = meta.get("set_id", "")
    ndc     = meta.get("ndc", "")
    mfg     = meta.get("manufacturer_name", "")
    mkt_cat = meta.get("market_category", "")
    appr    = meta.get("application_number", "")

    xml_snippet = (xml_content or "")[:80000]  # cap at 80 k chars

    # This path summarizes the SPL XML read off disk via sum_spl.local_path, so
    # it can still describe label content -- unlike the agentic pipeline, which
    # lost its section text when labeling.spl_sections was dropped.
    system_prompt = f"""You are a highly specialized FDA drug labeling assistant.

{ANNOTATION_RULES}"""

    if xml_snippet:
        user_message = f"""The user searched for: "{query}"

Exactly 1 labeling record was found in the database:
- Product: {product}
- Set ID: {set_id}
- NDC: {ndc}
- Manufacturer: {mfg}
- Market Category: {mkt_cat}
- Application Number: {appr}

Full SPL XML content:
{xml_snippet}

Please provide a concise but informative summary of this labeling record, highlighting:
1. Product name, active ingredient(s), dosage form and route
2. Approved indication(s) / labeling type
3. Key safety information (boxed warnings, contraindications if present)
4. NDC code(s)

Keep your answer focused and clinically useful. Wrap every drug name in a drug annotation tag."""
    else:
        user_message = f"""The user searched for: "{query}"

Exactly 1 labeling record was found in the database:
- Product: {product}
- Set ID: {set_id}
- NDC: {ndc}
- Manufacturer: {mfg}
- Market Category: {mkt_cat}
- Application Number: {appr}

Full XML content is not available locally. Please provide a brief summary based on the metadata above and advise the user they can view the full label on DailyMed using the set ID."""

    try:
        return unified_call_llm(
            user=user,
            system_prompt=system_prompt,
            user_message=user_message,
            temperature=0.0,
            max_tokens=2048,
        )
    except Exception as e:
        logger.error(f"single-label LLM call failed: {e}")
        return (
            f"Found **1** labeling record for **{product}**.\n\n"
            f"- **Set ID**: `{set_id}`\n"
            f"- **NDC**: `{ndc}`\n"
            f"- **Manufacturer**: {mfg}\n"
            f"- **Market Category**: {mkt_cat}\n"
            f"- **Application**: {appr}\n\n"
            "_(Full XML summary unavailable — LLM call failed)_"
        )


# ---------------------------------------------------------------------------
# Detect whether a query string warrants a database lookup
# ---------------------------------------------------------------------------

import re as _re

_UUID_RE   = _re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', _re.I)
_NDC_RE    = _re.compile(r'^\d{4,5}-\d{3,4}(-\d{1,2})?$')          # 2-segment (4-4 / 5-3) or 3-segment
_APPNUM_RE = _re.compile(r'^(NDA|ANDA|BLA)?\s*\d{4,6}$', _re.I)

_CONVERSATIONAL = {
    'hi', 'hello', 'hey', 'hola', 'greetings', 'help', 'info',
    'good morning', 'good afternoon', 'good evening', 'who are you',
    'what is this', 'start', 'clear', 'reset', 'exit', 'quit',
    'thanks', 'thank you', 'okay', 'ok', 'yes', 'no',
}

def _classify_query(query: str):
    """
    Returns (is_db_candidate: bool, query_kind: str).
    query_kind is one of: 'uuid', 'ndc', 'appnum', 'keyword', 'general'
    """
    q = query.strip()
    ql = q.lower()

    if ql in _CONVERSATIONAL:
        return False, 'general'
    if _UUID_RE.match(q):
        return True, 'uuid'
    if _NDC_RE.match(q):
        return True, 'ndc'
    if _APPNUM_RE.match(q):
        return True, 'appnum'
    # Short drug-name style inputs (≤ 3 words, no question mark) → try DB keyword search
    words = q.split()
    if len(words) <= 3 and '?' not in q:
        return True, 'keyword'
    return False, 'general'


# ---------------------------------------------------------------------------
# New DB-first search endpoint
# ---------------------------------------------------------------------------

@search_bp.route("/db_search", methods=["POST"])
def db_search():
    """
    Smart DB-first router implementing the 4-path decision tree:
      Path 1 — DB multi-result  : count > 1, return summary + results (if ≤ 10)
      Path 2 — DB single-result : count == 1, read XML → AI-generated label summary
      Path 3 — AI fallback      : count == 0 or general question → let caller hit /chat
      Path 4 — Not a DB query   : general question → ai_fallback immediately

    Response shape:
    {
      "action"       : "db_found" | "single_label" | "ai_fallback",
      "count"        : <int>,
      "results"      : [...ResultItem],   // populated when count <= 10
      "response_text": "..."              // chat-ready markdown string
      "is_keyword"   : <bool>             // true when a keyword search returned 0 results
    }
    """
    from dashboard.services.fdalabel_db import FDALabelDBService
    from dashboard.services.fda_client   import get_label_xml

    payload    = request.json or {}
    query      = (payload.get("query") or "").strip()
    ai_provider = payload.get("ai_provider")
    user_obj   = current_user._get_current_object() if current_user.is_authenticated else None
    if user_obj and ai_provider:
        user_obj.ai_provider = ai_provider

    if not query:
        return jsonify({"action": "ai_fallback", "count": 0, "is_keyword": False}), 200

    is_db, kind = _classify_query(query)

    # Short-circuit for pure general questions
    if not is_db:
        return jsonify({"action": "ai_fallback", "count": 0, "is_keyword": False}), 200

    # --- DB lookup -----------------------------------------------------------
    results_raw, total_count = FDALabelDBService.search_labels_with_count(query, limit=10)

    if total_count == 0:
        return jsonify({
            "action":    "ai_fallback",
            "count":     0,
            "is_keyword": kind == 'keyword',
            "response_text": ""
        }), 200

    # Map rows to ResultItem shape for the Results panel
    result_items = [_map_to_result_item(r) for r in results_raw]

    # Path 2 — exactly 1 result (or UUID/NDC that returned 1 row)
    if total_count == 1:
        single = results_raw[0]
        set_id = single.get("set_id")
        xml_content = ""
        try:
            xml_content = get_label_xml(set_id, force_local=True, local_only=True) or ""
        except Exception as xml_err:
            logger.warning(f"Could not load XML for {set_id}: {xml_err}")

        response_text = _generate_single_label_answer(user_obj, query, single, xml_content)
        return jsonify({
            "action":        "single_label",
            "count":         1,
            "results":       result_items,
            "response_text": response_text
        }), 200

    # Path 1 — multiple results
    product_hint = results_raw[0].get("brand_name") or results_raw[0].get("generic_name") or query
    if total_count <= 10:
        summary = (
            f"Found **{total_count}** labeling record(s) matching **\"{query}\"** in the database. "
            f"The matching labels are shown in the right panel. You can click any label to refine this answer."
        )
        send_results = result_items          # send all ≤ 10 to populate Results panel
    else:
        encoded_query = urllib.parse.quote(query)
        summary = (
            f"Found **{total_count}** labeling records matching **\"{query}\"**. "
            f"Too many to display inline — use [Direct Database Query](/localquery?q={encoded_query}) for the full list. "
            f"You can also ask me a more specific question about **{product_hint}**."
        )
        send_results = []                    # too many to show in Results panel

    return jsonify({
        "action":        "db_found",
        "count":         total_count,
        "results":       send_results,
        "response_text": summary
    }), 200


@search_bp.route("/chat", methods=["POST"])
def chat_with_ai():
    """
    AI Chat entry point. 
    Handles conversational responses based on labeling data.
    Includes history capping (20 msgs) and length truncation (300k chars).
    """
    payload = request.json or {}
    ai_provider = payload.get("ai_provider")
    user_obj = current_user._get_current_object() if current_user.is_authenticated else None
    if user_obj and ai_provider:
        user_obj.ai_provider = ai_provider
    
    user_input = payload.get("query")
    raw_history = payload.get("chat_history", [])

    # 1. Cap to last 20 messages
    capped_history = raw_history[-20:] if len(raw_history) > 20 else list(raw_history)

    # 2. Length truncation (300,000 characters)
    # We measure total character length of the history content
    total_chars = sum(len(str(m.get("content", ""))) for m in capped_history)
    
    final_history = capped_history
    omitted = len(raw_history) > 20

    if total_chars > 300000:
        current_len = total_chars
        while final_history and current_len > 300000:
            removed = final_history.pop(0)
            current_len -= len(str(removed.get("content", "")))
            omitted = True
        
    # Add the omitted marker to the first remaining message if we actually removed something
    if omitted and final_history:
        # Create a new dict to avoid mutating shared objects
        first_msg = dict(final_history[0])
        original_content = first_msg.get("content", "")
        first_msg["content"] = f"[..prev message omitted..] {original_content}"
        final_history[0] = first_msg

    is_failed_keyword = payload.get("is_failed_keyword_search", False)

    # Pass everything to search_general
    resp = search_general(user_input, user=user_obj, filters=payload, history=final_history, is_failed_keyword=is_failed_keyword)
    return jsonify({"response_text": resp}), 200

@search_bp.route("/refine_chat", methods=["POST"])
def refine_chat():
    """
    Refines the last AI response using the content of a specific labeling document.
    Expects: set_id, product_name, chat_history, filters
    Returns: JSON with refined text and related sections.
    """
    from dashboard.services.fdalabel_db import FDALabelDBService
    from dashboard.services.ai_handler import call_llm

    payload = request.json or {}
    set_id = payload.get("set_id")
    product_name = payload.get("product_name")
    history = payload.get("chat_history", [])
    
    if not history:
        return jsonify({"error": "No chat history to refine."}), 400
    
    last_msg = history[-1]
    if last_msg.get("role") != "assistant":
        return jsonify({"error": "Last message must be from AI to refine it."}), 400
    
    original_text = last_msg.get("content", "")
    
    try:
        # 1. Fetch XML
        xml_content = FDALabelDBService.get_full_xml(set_id)
        if not xml_content:
            return jsonify({"error": f"Could not fetch content for labeling {set_id}"}), 404
        
        # 2. Prepare Prompt
        # Truncate XML if too large for context (clinical LLMs usually handle 32k-128k, but let's be safe)
        xml_snippet = xml_content[:100000] # 100k chars limit for reference
        
        refine_prompt = f"""
        You are a clinical data specialist. 
        
        REFERENCE DOCUMENT CONTENT ({product_name} [set_id: {set_id}]):
        {xml_snippet}
        
        ORIGINAL RESPONSE TO REFINE:
        {original_text}
        
        TASK:
        Based on the given labeling document content, try to refine and add references into the current last response, if possible.

        IMPORTANT:
        1. Keep as much of the ORIGINAL RESPONSE as possible. 
        2. Only modify or add sentences if the reference document provides new evidence or requires a correction.
        3. Preserve any existing <annotation class=\"drug\">...</annotation> tags from the original response.
        4. Add NEW <annotation class=\"drug\"> tags for any drug names introduced from the reference document. "drug" is the only valid annotation class.

        
        OUTPUT FORMAT:
        The content needs to be prepared in JSON format with an explicit wrap like ```json ... ```.
        The JSON should include attributes:
        1. "text": The refined clinical text.
        2. "related sections": A list of specific section titles or headers from the reference document used for refinement.
        """
        
        # 3. Call LLM
        # Use a high-capacity model for full XML reasoning
        ai_provider = payload.get("ai_provider")
        user_obj = current_user._get_current_object() if current_user.is_authenticated else None
        
        response = call_llm(
            user=user_obj,
            system_prompt="You are a precise FDA labeling analyst. Return ONLY valid JSON.",
            user_message=refine_prompt,
            temperature=0.0
        )
        
        # 4. Extract JSON
        import re
        json_match = re.search(r'```json\s*(.*?)\s*```', response, re.DOTALL)
        if json_match:
            json_str = json_match.group(1)
        else:
            json_str = response # Fallback
            
        try:
            refined_data = json.loads(json_str)
            return jsonify({
                "refined_json": refined_data,
                "original_text": original_text,
                "set_id": set_id
            }), 200
        except Exception as json_err:
            return jsonify({"error": f"AI returned invalid JSON: {str(json_err)}", "raw_response": response}), 500
            
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    

@search_bp.route("/filter_data", methods=["POST"])
def filter_data():
    """
    Data-only filtering for the Results panel.
    """
    from dashboard.services.fdalabel_db import FDALabelDBService
    payload = request.json or {}
    filters = payload.get("filters", {})
    limit = int(payload.get("limit", 500))
    
    # NEW: if no filters are active, return 0 results immediately to save resources
    has_active_filters = any(filters.values()) if filters else False
    if not has_active_filters:
        return jsonify({
            "results": [],
            "total_counts": 0,
            "message": ""
        }), 200

    force_local = filters.get("forceLocal", False)
    results, total_count = FDALabelDBService.filter_labels(filters, limit=limit, force_local=force_local)
    
    message = ""
    if total_count > limit:
        message = f"Too many results (>{limit}) meet the criteria. Showing the first {limit} results, please add more conditions."
        
    return jsonify({
        "results": results,
        "total_counts": total_count,
        "message": message
    }), 200

# --- Helper Routes (Metadata, Exports) ---
@search_bp.route("/get_metadata", methods=["POST"])
def get_metadata():
    from dashboard.services.fdalabel_db import FDALabelDBService
    payload = request.json or {}
    set_ids = payload.get("set_ids", [])
    results = []
    for sid_obj in set_ids:
        sid = sid_obj.get("set_id")
        meta = FDALabelDBService.get_label_metadata(sid)
        if meta:
            results.append(meta)
    return jsonify({"results": results})

@search_bp.route("/export_xml", methods=["POST"])
def export_xml():
    try:
        data = request.json or {}
        set_ids = data.get("set_ids", [])
        
        # Currently XML content is not stored in the local SQLite DB for this app instance.
        # Stub this out to avoid frontend crash on JSON export.
        xml_map = {}
        for sid in set_ids:
            xml_map[sid] = "XML content is not available in the local database."
            
        return jsonify(xml_map), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@search_bp.route("/export_excel", methods=["POST"])
def export_excel():
    try:
        data = request.json or {}
        export_data = data.get("export_data", [])
        
        if not export_data:
            return jsonify({"error": "No export data provided"}), 400
            
        df = pd.DataFrame(export_data)
        
        out = io.BytesIO()
        df.to_excel(out, index=False)
        out.seek(0)
        return send_file(out, as_attachment=True, download_name="labels_export.xlsx")
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@search_bp.route("/history", methods=["GET"])
def get_history():
    user_obj = current_user._get_current_object() if current_user.is_authenticated else None
    if not user_obj:
        return jsonify({"error": "Unauthorized"}), 401
    
    from database.models import SearchHistory
    histories = SearchHistory.query.filter_by(user_id=user_obj.id).order_by(SearchHistory.timestamp.desc()).all()
    
    res = []
    for h in histories:
        try:
            chat_data = json.loads(h.chat_data)
        except:
            chat_data = []
        res.append({
            "id": h.id,
            "title": h.title,
            "chat_data": chat_data,
            "timestamp": h.timestamp.isoformat() + 'Z'
        })
    return jsonify({"histories": res}), 200

@search_bp.route("/history", methods=["POST"])
def save_history():
    user_obj = current_user._get_current_object() if current_user.is_authenticated else None
    if not user_obj:
        return jsonify({"error": "Unauthorized"}), 401
    
    payload = request.json or {}
    chat_data = payload.get("chat_history", [])
    title = payload.get("title", "Saved Conversation")
    history_id = payload.get("id")
    
    if not chat_data:
        return jsonify({"error": "No chat history to save."}), 400
        
    from database.models import SearchHistory
    from database import db
    
    if history_id:
        existing_history = SearchHistory.query.filter_by(id=history_id, user_id=user_obj.id).first()
        if existing_history:
            existing_history.chat_data = json.dumps(chat_data)
            # Only update title if it's explicitly provided, but since we auto-generate it based on the first message, we can just update it.
            existing_history.title = title
            db.session.commit()
            return jsonify({"success": True, "id": existing_history.id}), 200

    new_history = SearchHistory(
        user_id=user_obj.id,
        title=title,
        chat_data=json.dumps(chat_data)
    )
    db.session.add(new_history)
    db.session.commit()
    
    return jsonify({"success": True, "id": new_history.id}), 200
