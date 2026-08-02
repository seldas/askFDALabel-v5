# scripts/semantic_core/state.py
import datetime
import uuid
from typing import Any, Dict


class AgentState:
    """
    Keep the SAME public fields as V2 so semantic_search can replace search_v2 seamlessly.
    """

    def __init__(self, payload: Dict[str, Any], user=None):
        self.user = user
        self.meta = {
            "session_id": str(uuid.uuid4()),
            "created_at": datetime.datetime.now().isoformat(),
        }
        self.conversation = {
            "user_query": payload.get("query", ""),
            "history": payload.get("chat_history", []) or [],
        }

        # Keep schema identical
        self.intent = {}
        self.retrieval = {
            "plan": {},
            "results": [],
            "generated_sql": "",  # kept for compatibility
        }
        self.evidence = {"snippets": []}
        self.answer = {"response_text": "", "is_final": False}
        self.reasoning = ""
        self.agent_flow = []
        self.trace_log = []

        self.flags = {
            "next_step": "planner",
            "terminate": False,
        }

        self.filters = {
            "labelingTypes": payload.get("labelingTypes", []),
            "applicationTypes": payload.get("applicationTypes", []),
            "labelingSections": payload.get("labelingSections", []),
            "drugNames": payload.get("drugNames", []),
            "adverseEvents": payload.get("adverseEvents", []),
            "ndcs": payload.get("ndcs", []),
        }

        # Configuration and mode
        self.config = {
            "search_mode": payload.get("search_mode", "semantic"),
            "top_k": int(payload.get("top_k", 50) or 50),
            "rerank_k": int(payload.get("rerank_k", 10) or 10),
            "min_score": float(payload.get("min_score", 0.0) or 0.0),
        }

    def to_dict(self):
        return self.__dict__
