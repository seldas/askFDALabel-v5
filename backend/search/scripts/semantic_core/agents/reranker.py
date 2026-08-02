# scripts/semantic_core/agents/reranker.py
import json
import re
from dashboard.services.ai_handler import call_llm

RERANKER_PROMPT = """
You are a precision reranking agent for FDA drug labeling search.

Score each excerpt for how well it can be used to answer the user's question using ONLY the excerpt text.

Return ONLY valid JSON (no markdown) as a list of objects in the same order:
[
  {"score": 0-10, "answerable": true/false, "reason": "very short"},
  ...
]

Rubric:
- 10: Directly answers the question with specific facts (e.g., dosing, contraindications, monitoring, warning language).
- 7-9: Highly relevant and likely contains the needed detail, but may be partial.
- 4-6: Relevant topic but missing key details needed to answer.
- 1-3: Mentions the drug/topic but not useful for answering.
- 0: Unrelated.
"""

def _safe_json_list(text: str):
    t = text.strip()
    # strip ``` fences if present
    t = re.sub(r"^```(?:json)?\s*", "", t, flags=re.IGNORECASE)
    t = re.sub(r"\s*```$", "", t)
    try:
        return json.loads(t)
    except Exception:
        # fallback: pull first [...] block
        m = re.search(r"\[\s*\{.*\}\s*\]", t, re.DOTALL)
        if m:
            try:
                return json.loads(m.group(0))
            except Exception:
                return None
    return None

def run_reranker(state):
    state.agent_flow.append("reranker")

    candidates = state.retrieval.get("results", []) or []
    if not candidates:
        state.flags["next_step"] = "postprocess"
        return

    query = state.conversation.get("user_query", "") or ""
    rerank_k = state.config.get("rerank_k", 10)

    to_rerank = candidates[:20]

    excerpts_text = ""
    for i, c in enumerate(to_rerank):
        excerpts_text += (
            f"Excerpt {i}:\n"
            f"Drug: {c.get('drug_name','')}\n"
            f"Section: {c.get('section','')}\n"
            f"Text: {(c.get('text','') or '')[:350]}\n\n"
        )

    try:
        response = call_llm(
            user=state.user,
            system_prompt=RERANKER_PROMPT,
            user_message=f"User Query: {query}\n\nExcerpts:\n\n{excerpts_text}",
            temperature=0.0
        )

        items = _safe_json_list(response)
        if not isinstance(items, list):
            raise ValueError("Reranker returned non-list JSON.")

        # combine scores robustly
        for i, item in enumerate(items):
            if i >= len(to_rerank):
                break
            try:
                llm_score_0_10 = float(item.get("score", 0))
                llm_score = max(0.0, min(llm_score_0_10 / 10.0, 1.0))
                answerable = bool(item.get("answerable", False))

                # Slight boost if answerable, slight penalty if not
                answerable_factor = 1.0 if answerable else 0.85

                # Existing semantic score is already ~0..1 (cosine similarity)
                sem = float(to_rerank[i].get("score", 0.0))
                sem = max(0.0, min(sem, 1.0))

                to_rerank[i]["score"] = ((sem * 0.3) + (llm_score * 0.7)) * answerable_factor
                to_rerank[i]["rerank_meta"] = {
                    "llm_score_0_10": llm_score_0_10,
                    "answerable": answerable,
                    "reason": (item.get("reason") or "")[:120]
                }
            except Exception:
                # If any individual item is malformed, leave score unchanged
                continue

        to_rerank.sort(key=lambda x: x.get("score", 0.0), reverse=True)
        reranked = to_rerank[:rerank_k]

        state.trace_log.append(f"Reranker: Re-scored {len(to_rerank)} and kept {len(reranked)}.")
        state.retrieval["results"] = reranked

    except Exception as e:
        state.trace_log.append(f"Reranker error: {str(e)}")
        state.retrieval["results"] = candidates[:rerank_k]

    state.retrieval.setdefault("plan", {})
    state.retrieval["plan"]["semantic_rerank_k"] = rerank_k
    state.flags["next_step"] = "postprocess"