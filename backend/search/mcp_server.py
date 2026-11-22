"""Lightweight Streamable HTTP MCP endpoint (/api/mcp) reusing LabelChat tools."""

import json
import logging
import time
from typing import Any, Dict, List, Optional, Tuple
from flask import Blueprint, Response, jsonify, request

from api_service.blueprint import _extract_api_user
from dashboard.services.feature_gates import is_allowed
from search.mcp_tools import DEFAULT_REGISTRY

mcp_bp = Blueprint("mcp", __name__)
logger = logging.getLogger(__name__)

SUPPORTED_PROTOCOL_VERSIONS = (
    "2025-06-18",
    "2025-03-26",
    "2024-11-05",
)
DEFAULT_PROTOCOL_VERSION = "2025-03-26"


def _jsonrpc_result(req_id: Any, result: Dict[str, Any]) -> Dict[str, Any]:
    return {"jsonrpc": "2.0", "id": req_id, "result": result}


def _jsonrpc_error(req_id: Any, code: int, message: str) -> Dict[str, Any]:
    return {"jsonrpc": "2.0", "id": req_id, "error": {"code": code, "message": message}}


def _negotiate_protocol_version(requested: Optional[str]) -> str:
    if requested and requested in SUPPORTED_PROTOCOL_VERSIONS:
        return requested
    return DEFAULT_PROTOCOL_VERSION


def _handle_single_message(msg: Any, user: Any) -> Tuple[Optional[Dict[str, Any]], int]:
    """Process one JSON-RPC 2.0 request or notification."""
    if not isinstance(msg, dict) or msg.get("jsonrpc") != "2.0" or "method" not in msg:
        return _jsonrpc_error(None, -32600, "Invalid JSON-RPC 2.0 request."), 400

    method = msg["method"]
    req_id = msg.get("id")
    params = msg.get("params") or {}

    # Notifications have no id and require no JSON-RPC body.
    if req_id is None or method.startswith("notifications/"):
        return None, 202

    if method == "initialize":
        proto = _negotiate_protocol_version(params.get("protocolVersion"))
        return (
            _jsonrpc_result(
                req_id,
                {
                    "protocolVersion": proto,
                    "capabilities": {"tools": {"listChanged": False}},
                    "serverInfo": {"name": "askFDALabel", "version": "1.0.0"},
                },
            ),
            200,
        )

    if method == "ping":
        return _jsonrpc_result(req_id, {}), 200

    if method == "tools/list":
        tools = [
            {
                "name": tool.name,
                "description": tool.description,
                "inputSchema": tool.input_schema,
            }
            for tool in DEFAULT_REGISTRY.available_tools(user)
        ]
        return _jsonrpc_result(req_id, {"tools": tools}), 200

    if method == "tools/call":
        if not isinstance(params, dict) or not params.get("name"):
            return _jsonrpc_error(req_id, -32602, "Missing required parameter: name."), 200
        tool_name = str(params["name"])
        tool_args = params.get("arguments") or {}
        if not isinstance(tool_args, dict):
            return _jsonrpc_error(req_id, -32602, "Tool arguments must be an object."), 200

        t0 = time.monotonic()
        output = DEFAULT_REGISTRY.call(tool_name, tool_args, user)
        elapsed_ms = int((time.monotonic() - t0) * 1000)
        is_error = isinstance(output, dict) and "error" in output and len(output) == 1
        logger.info(
            "MCP tools/call user=%s tool=%s is_error=%s elapsed_ms=%d",
            getattr(user, "username", getattr(user, "id", "?")),
            tool_name,
            is_error,
            elapsed_ms,
        )
        return (
            _jsonrpc_result(
                req_id,
                {
                    "content": [
                        {
                            "type": "text",
                            "text": json.dumps(output, ensure_ascii=False, indent=2, default=str),
                        }
                    ],
                    "isError": is_error,
                },
            ),
            200,
        )

    return _jsonrpc_error(req_id, -32601, f"Method not found: {method}"), 200


@mcp_bp.route("", methods=["GET", "POST"])
@mcp_bp.route("/", methods=["GET", "POST"])
def mcp_endpoint():
    """Stateless Streamable HTTP MCP endpoint authenticated by user API key."""
    if request.method == "GET":
        if "text/event-stream" in request.headers.get("Accept", ""):
            return Response(status=405)
        return jsonify({
            "name": "askFDALabel MCP",
            "transport": "streamable-http",
            "status": "ok",
        }), 200

    user = _extract_api_user()
    if user is None:
        return jsonify(_jsonrpc_error(None, -32001, "Unauthorized: valid API key required.")), 401
    if not is_allowed(user, "labelchat"):
        return jsonify(_jsonrpc_error(None, -32003, "Forbidden: labelchat access is required.")), 403

    payload = request.get_json(silent=True)
    if payload is None:
        return jsonify(_jsonrpc_error(None, -32700, "Parse error: expected JSON body.")), 400

    if isinstance(payload, list):
        if not payload:
            return jsonify(_jsonrpc_error(None, -32600, "Invalid empty batch request.")), 400
        responses: List[Dict[str, Any]] = []
        for item in payload:
            resp, _ = _handle_single_message(item, user)
            if resp is not None:
                responses.append(resp)
        if not responses:
            return Response(status=202)
        return jsonify(responses), 200

    resp, status = _handle_single_message(payload, user)
    if resp is None:
        return Response(status=status)
    return jsonify(resp), status
