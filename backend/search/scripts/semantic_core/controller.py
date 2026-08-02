# scripts/semantic_core/controller.py
from .log import logger

from .agents.planner import run_planner
from .agents.semantic_retriever import run_semantic_retriever
from .agents.keyword_retriever import run_keyword_retriever
from .agents.reranker import run_reranker
from .agents.postprocess import run_postprocess
from .agents.evidence_fetcher import run_evidence_fetcher
from .agents.answer_composer import run_answer_composer
from .agents.reasoning_generator import run_reasoning_generator


DEFAULT_CONFIG = {
    "top_k": 50,
    "rerank_k": 10,
    "min_score": 0.0,
    # optional postprocess caps if you adopt them
    "max_per_set_id": 4,
    "max_total_results": 10,
}

def _init_state_defaults(state):
    # Ensure config exists + defaults
    cfg = getattr(state, "config", None)
    if cfg is None:
        state.config = {}
        cfg = state.config
    for k, v in DEFAULT_CONFIG.items():
        cfg.setdefault(k, v)

    # Ensure retrieval / evidence / answer containers exist
    state.retrieval = state.retrieval or {"plan": {}, "results": [], "generated_sql": ""}
    state.retrieval.setdefault("plan", {})
    state.retrieval.setdefault("results", [])

    state.evidence = state.evidence or {"snippets": []}
    state.evidence.setdefault("snippets", [])

    state.answer = state.answer or {"response_text": "", "is_final": False}

    state.flags = state.flags or {}
    state.flags.setdefault("next_step", "planner")

def run_controller(state, stop_before=None):
    _init_state_defaults(state)

    max_steps = 30  # prevents infinite loops
    steps_run = 0

    while True:
        if state.flags.get("terminate"):
            break

        current_step = state.flags.get("next_step")

        if stop_before and current_step == stop_before:
            return

        if current_step is None or current_step == "end":
            break

        steps_run += 1
        if steps_run > max_steps:
            logger.error("Controller exceeded max_steps; terminating to prevent infinite loop.")
            state.answer["response_text"] = "An internal error occurred during the search process."
            state.answer["is_final"] = True
            state.flags["terminate"] = True
            break

        try:
            if current_step == "planner":
                run_planner(state)

            elif current_step == "keyword_retriever":
                run_keyword_retriever(state)

            elif current_step == "semantic_retriever":
                # Ensure plan exists before semantic writes into it
                state.retrieval.setdefault("plan", {})
                run_semantic_retriever(state)

            elif current_step == "reranker":
                run_reranker(state)

            elif current_step == "postprocess":
                run_postprocess(state)

            elif current_step == "evidence_fetcher":
                run_evidence_fetcher(state)

            elif current_step == "answer_composer":
                run_answer_composer(state)

            elif current_step == "reasoning_generator":
                run_reasoning_generator(state)

            elif current_step == "error":
                state.answer["response_text"] = "An internal error occurred during the search process."
                state.answer["is_final"] = True
                state.flags["terminate"] = True
                break

            else:
                logger.error(f"Unknown step: {current_step}")
                state.answer["response_text"] = "An internal error occurred during the search process."
                state.answer["is_final"] = True
                state.flags["terminate"] = True
                break

            # Safety: if an agent forgot to set next_step, terminate gracefully
            if state.flags.get("next_step") == current_step:
                logger.error(f"Step '{current_step}' did not advance next_step; terminating.")
                state.answer["response_text"] = "An internal error occurred during the search process."
                state.answer["is_final"] = True
                state.flags["terminate"] = True
                break

        except Exception as e:
            logger.error(f"Step failed ({current_step}): {e}", exc_info=True)
            state.flags["next_step"] = "error"