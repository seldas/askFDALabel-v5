# scripts/semantic_core/agents/reasoning_generator.py
from collections import Counter, defaultdict

def run_reasoning_generator(state):
    """
    Produce a lightweight retrieval summary (no chain-of-thought).
    """
    state.agent_flow.append("reasoning_generator")

    intent = (state.intent.get("intent") or "").upper()
    plan = state.retrieval.get("plan", {}) or {}
    results = state.retrieval.get("results", []) or []

    # Determine pipeline used
    next_step = state.flags.get("next_step", "")
    pipeline = plan.get("pipeline") or []
    used_semantic = "semantic_retriever" in pipeline or state.agent_flow.count("semantic_retriever") > 0
    used_keyword = state.agent_flow.count("keyword_retriever") > 0

    if used_semantic and used_keyword:
        pipeline_name = "hybrid (keyword candidate selection + semantic retrieval + reranking)"
    elif used_semantic:
        pipeline_name = "semantic retrieval + reranking"
    elif used_keyword:
        pipeline_name = "keyword lookup"
    else:
        pipeline_name = "direct response (no retrieval)"

    # Aggregate quick stats
    set_ids = []
    drug_names = []
    sections = []
    for r in results:
        src = r.get("source") or {}
        sid = src.get("set_id") or r.get("set_id")
        if sid:
            set_ids.append(sid)
        dn = r.get("drug_name")
        if dn:
            drug_names.append(dn)
        sec = r.get("section")
        if sec:
            sections.append(sec)

    # Keep only top few for brevity
    top_drugs = [d for d, _ in Counter(drug_names).most_common(3)]
    top_sections = [s for s, _ in Counter(sections).most_common(5)]
    unique_labels = len(set(set_ids)) if set_ids else 0

    # Note filters
    filter_set_ids = plan.get("filter_set_ids") or []
    filter_note = ""
    if filter_set_ids:
        filter_note = f" Filtered semantic search to {len(filter_set_ids)} candidate label(s) from keyword lookup."

    # Note rerank params
    top_k = plan.get("semantic_top_k") or plan.get("top_k") or None
    rerank_k = plan.get("semantic_rerank_k") or None

    parts = []
    parts.append(f"Retrieval: {pipeline_name}. Intent={intent or 'UNKNOWN'}.")
    if used_semantic and top_k:
        parts.append(f"Semantic candidates: top_k={top_k}.")
    if used_semantic and rerank_k:
        parts.append(f"Reranked/kept: rerank_k={rerank_k}.")
    parts.append(f"Evidence passages used: {len(results)} from {unique_labels} label(s).")
    if top_drugs:
        parts.append(f"Top drugs in evidence: {', '.join(top_drugs)}.")
    if top_sections:
        parts.append(f"Top sections represented: {', '.join(top_sections)}.")
    if filter_note:
        parts.append(filter_note.strip())

    state.reasoning = " ".join(parts)
    state.flags["next_step"] = "end"