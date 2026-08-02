# scripts/semantic_core/agents/planner.py
import json
import re
from dashboard.services.ai_handler import call_llm

ALLOWED_INTENTS = {"IDENTIFIER", "ENTITY_LOOKUP", "CLINICAL_QA", "CLARIFICATION", "OUT_OF_SCOPE"}

PLANNER_SYSTEM_PROMPT = """
You are a Search Intent Classifier and Query Resolver for an FDA Drug Labeling system.

You MUST return ONLY a valid JSON object (no markdown, no code fences, no extra text) with this schema:
{
  "intent": "IDENTIFIER|ENTITY_LOOKUP|CLINICAL_QA|CLARIFICATION|OUT_OF_SCOPE",
  "resolved_query": "standalone query",
  "entities": ["drug names or ids"],
  "clarification_question": "question only if intent is CLARIFICATION, else empty string",
  "is_continuation": true/false
}

Rules:
- If the user asks for a specific label by set_id, NDC, NDA/BLA/ANDA, choose IDENTIFIER.
- If the user asks to find a drug label by name (brand/generic), choose ENTITY_LOOKUP.
- If the user asks a clinical/safety question (warnings, contraindications, dosing, hepatotoxicity, interactions), choose CLINICAL_QA.
- If query is ambiguous (pronouns with no clear referent, missing drug), choose CLARIFICATION and ask what drug/strength/formulation.
- If non-drug-label request, choose OUT_OF_SCOPE.
"""

def _strip_fences(text: str) -> str:
    text = text.strip()
    # Remove common ```json ... ``` fences
    text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\s*```$", "", text)
    return text.strip()

def _safe_json_load(text: str):
    t = _strip_fences(text)
    try:
        return json.loads(t)
    except Exception:
        # fallback: substring between first { and last }
        i, j = t.find("{"), t.rfind("}")
        if i != -1 and j != -1 and j > i:
            try:
                return json.loads(t[i:j+1])
            except Exception:
                return None
        return None

def _normalize_intent_data(d: dict, raw_query: str) -> dict:
    intent = str(d.get("intent", "CLINICAL_QA")).upper().strip()
    if intent not in ALLOWED_INTENTS:
        intent = "CLINICAL_QA"

    resolved = str(d.get("resolved_query") or "").strip() or raw_query

    entities = d.get("entities", [])
    if not isinstance(entities, list):
        entities = [str(entities)] if entities else []

    clarification_q = str(d.get("clarification_question") or "").strip()
    is_cont = bool(d.get("is_continuation", False))

    if intent == "CLARIFICATION" and not clarification_q:
        clarification_q = "Which drug (brand/generic) are you referring to?"

    return {
        "intent": intent,
        "resolved_query": resolved,
        "entities": entities,
        "clarification_question": clarification_q if intent == "CLARIFICATION" else "",
        "is_continuation": is_cont,
    }

def _looks_like_identifier(q: str) -> bool:
    q = q.strip()
    # set_id UUID-ish
    if re.search(r"\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b", q, re.I):
        return True
    # NDC patterns
    if re.search(r"\b\d{4,5}-\d{3,4}-\d{1,2}\b", q):
        return True
    # NDA/BLA/ANDA approval numbers (very rough)
    if re.search(r"\b(NDA|BLA|ANDA)\s*\d+\b", q, re.I):
        return True
    return False

def run_planner(state):
    state.agent_flow.append("planner")
    raw_query = (state.conversation.get("user_query") or "").strip()
    history = state.conversation.get("history", []) or []

    if not raw_query:
        state.flags["terminate"] = True
        return

    # NEW: Check if we have active filter terms that force a specific path
    has_active_filters = any([
        state.filters.get("drugNames"),
        state.filters.get("adverseEvents"),
        state.filters.get("ndcs"),
        state.filters.get("labelingTypes"),
        state.filters.get("applicationTypes"),
        state.filters.get("labelingSections")
    ])

    if has_active_filters:
        state.intent = {
            "intent": "ENTITY_LOOKUP", # Or IDENTIFIER if NDC
            "resolved_query": raw_query,
            "entities": state.filters.get("drugNames", []),
            "clarification_question": "",
            "is_continuation": False
        }
        state.flags["next_step"] = "keyword_retriever"
        state.trace_log.append("Planner: Active search filters detected; routing to keyword_retriever for precise matching.")
        return

    # Deterministic guardrail: identifiers always go keyword path
    if _looks_like_identifier(raw_query):
        state.intent = {
            "intent": "IDENTIFIER",
            "resolved_query": raw_query,
            "entities": [],
            "clarification_question": "",
            "is_continuation": False
        }
        state.flags["next_step"] = "keyword_retriever"
        state.trace_log.append("Planner: Detected identifier pattern; routing to keyword_retriever.")
        return

    try:
        response = call_llm(
            user=state.user,
            system_prompt=PLANNER_SYSTEM_PROMPT,
            user_message=json.dumps({"query": raw_query, "history": history}),
            temperature=0.0
        )

        parsed = _safe_json_load(response) or {"intent": "CLINICAL_QA", "resolved_query": raw_query}
        intent_data = _normalize_intent_data(parsed, raw_query)

        state.intent = intent_data
        state.conversation["user_query"] = intent_data["resolved_query"]
        intent_type = intent_data["intent"]

        state.trace_log.append(f"Planner: Classified intent as {intent_type}.")

        if intent_type in ("OUT_OF_SCOPE", "CLARIFICATION"):
            state.flags["next_step"] = "answer_composer"
        elif intent_type in ("IDENTIFIER", "ENTITY_LOOKUP"):
            state.flags["next_step"] = "keyword_retriever"
        else:
            state.flags["next_step"] = "semantic_retriever"
            state.retrieval["plan"] = {
                "pipeline": ["semantic_retriever", "reranker", "postprocess", "evidence_fetcher", "answer_composer"],
                "top_k": state.config.get("top_k", 50)
            }

    except Exception as e:
        state.trace_log.append(f"Planner error: {str(e)}. Defaulting to semantic path.")
        state.flags["next_step"] = "semantic_retriever"
        state.intent = {"intent": "CLINICAL_QA", "resolved_query": raw_query, "entities": [], "clarification_question": "", "is_continuation": False}