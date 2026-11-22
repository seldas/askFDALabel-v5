"""LabelChat (/api/search/*) blueprint."""

import json
import logging
from flask import Blueprint, Response, jsonify, request, stream_with_context
from flask_login import current_user

from dashboard.routes.guards import feature_before_request

search_bp = Blueprint("search", __name__)

# Gated on the blueprint rather than per route, so any route added later is
# covered by default. The required role is admin-configurable at runtime --
# see dashboard.services.feature_gates.
search_bp.before_request(feature_before_request("labelchat"))
logger = logging.getLogger(__name__)


@search_bp.route("/models", methods=["GET"])
def list_models():
    """Returns allowed AI models from .env/preferences, defaulting to Elsa when available."""
    from dashboard.services.ai_preferences import (
        allowed_providers,
        public_catalog,
        resolve_provider,
    )
    from dashboard.services.deployment import is_rapid

    user_obj = current_user._get_current_object() if current_user.is_authenticated else None
    catalog = public_catalog()
    allowed = allowed_providers()

    if is_rapid():
        catalog = [m for m in catalog if m.get("id") == "elsa"]
        default_provider = "elsa" if "elsa" in allowed else ""
        return jsonify({
            "models": catalog,
            "default_provider": default_provider,
        }), 200

    if "elsa" in allowed:
        default_provider = "elsa"
    elif allowed:
        default_provider, _ = resolve_provider(user_obj)
    else:
        default_provider = ""

    return jsonify({
        "models": catalog,
        "default_provider": default_provider,
    }), 200


@search_bp.route("/agent_stream", methods=["POST"])
def agent_stream():
    """AI-native MCP tool-calling SSE endpoint for LabelChat."""
    try:
        from search.agent_loop import run_agent_stream
    except Exception:
        logger.exception("Failed to initialize LabelChat agent")
        return jsonify({"error": "The assistant service is temporarily unavailable."}), 500

    user_obj = current_user._get_current_object() if current_user.is_authenticated else None
    payload = request.json or {}
    query = (payload.get("query") or "").strip()
    chat_history = payload.get("chat_history") or []
    ai_provider = payload.get("ai_provider")
    active_focus = payload.get("active_focus")

    if not query:
        return jsonify({"error": "Please enter a question."}), 400

    def generate():
        try:
            for evt in run_agent_stream(
                user=user_obj,
                query=query,
                chat_history=chat_history,
                provider_override=ai_provider,
                active_focus=active_focus,
            ):
                yield f"data: {json.dumps(evt, ensure_ascii=False, default=str)}\n\n"
        except Exception:
            logger.exception("LabelChat stream failed")
            yield (
                f"data: {json.dumps({'type': 'error', 'error': 'Something went wrong while answering your question.'})}\n\n"
            )

    return Response(
        stream_with_context(generate()),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@search_bp.route("/history", methods=["GET"])
def get_history():
    user_obj = current_user._get_current_object() if current_user.is_authenticated else None
    if not user_obj:
        return jsonify({"error": "Unauthorized"}), 401

    from database.models import SearchHistory

    histories = (
        SearchHistory.query.filter_by(user_id=user_obj.id)
        .order_by(SearchHistory.timestamp.desc())
        .all()
    )

    res = []
    for h in histories:
        try:
            chat_data = json.loads(h.chat_data)
        except Exception:
            chat_data = []
        res.append({
            "id": h.id,
            "title": h.title,
            "chat_data": chat_data,
            "timestamp": h.timestamp.isoformat() + "Z",
        })
    return jsonify({"histories": res}), 200


@search_bp.route("/history", methods=["POST"])
def save_history():
    user_obj = current_user._get_current_object() if current_user.is_authenticated else None
    if not user_obj:
        return jsonify({"error": "Unauthorized"}), 401

    payload = request.json or {}
    chat_data = payload.get("chat_history", [])
    title = (payload.get("title") or "Saved Conversation").strip()[:200]
    history_id = payload.get("id")

    if not chat_data:
        return jsonify({"error": "No chat history to save."}), 400

    from database import db
    from database.models import SearchHistory

    if history_id:
        existing = SearchHistory.query.filter_by(id=history_id, user_id=user_obj.id).first()
        if existing:
            existing.chat_data = json.dumps(chat_data)
            existing.title = title
            db.session.commit()
            return jsonify({"success": True, "id": existing.id}), 200

    new_history = SearchHistory(
        user_id=user_obj.id,
        title=title,
        chat_data=json.dumps(chat_data),
    )
    db.session.add(new_history)
    db.session.commit()
    return jsonify({"success": True, "id": new_history.id}), 200


@search_bp.route("/history/<int:history_id>", methods=["PATCH"])
def rename_history(history_id: int):
    user_obj = current_user._get_current_object() if current_user.is_authenticated else None
    if not user_obj:
        return jsonify({"error": "Unauthorized"}), 401

    payload = request.json or {}
    title = (payload.get("title") or "").strip()[:200]
    if not title:
        return jsonify({"error": "Title cannot be empty."}), 400

    from database import db
    from database.models import SearchHistory

    existing = SearchHistory.query.filter_by(id=history_id, user_id=user_obj.id).first()
    if not existing:
        return jsonify({"error": "History entry not found."}), 404

    existing.title = title
    db.session.commit()
    return jsonify({"success": True, "id": existing.id, "title": existing.title}), 200


@search_bp.route("/history/<int:history_id>", methods=["DELETE"])
def delete_history(history_id: int):
    user_obj = current_user._get_current_object() if current_user.is_authenticated else None
    if not user_obj:
        return jsonify({"error": "Unauthorized"}), 401

    from database import db
    from database.models import SearchHistory

    existing = SearchHistory.query.filter_by(id=history_id, user_id=user_obj.id).first()
    if not existing:
        return jsonify({"error": "History entry not found."}), 404

    db.session.delete(existing)
    db.session.commit()
    return jsonify({"success": True}), 200
