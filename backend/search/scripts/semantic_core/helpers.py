# scripts/semantic_core/helpers.py
from typing import Any, Dict, List


def convert_oracle_to_filtered_results(raw_results: List[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    """
    Keep same behavior as v2 helper: return a dict keyed by some stable key.
    If your v2 version has specific logic, copy it here verbatim.
    """
    out: Dict[str, Dict[str, Any]] = {}
    for i, r in enumerate(raw_results or []):
        key = r.get("id") or r.get("key") or f"r{i}"
        out[key] = r
    return out


def build_debug_stats(state) -> Dict[str, Any]:
    """
    Minimal debug stats; expand as you like.
    """
    return {
        "session_id": state.meta.get("session_id"),
        "steps": list(state.agent_flow),
        "n_results": len(state.retrieval.get("results", [])),
        "n_snippets": len(state.evidence.get("snippets", [])),
    }
