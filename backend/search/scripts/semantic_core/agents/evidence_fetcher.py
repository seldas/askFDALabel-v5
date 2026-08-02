# scripts/semantic_core/agents/evidence_fetcher.py
def run_evidence_fetcher(state):
    """
    Extract snippets for grounded answering.
    Creates stable citation keys and enriches provenance.
    """
    state.agent_flow.append("evidence_fetcher")

    results = state.retrieval.get("results", []) or []
    snippets = []

    for i, r in enumerate(results):
        text = (r.get("text") or "").strip()
        if not text:
            continue

        source = r.get("source") or {}
        set_id = source.get("set_id") or r.get("set_id") or ""
        spl_id = source.get("spl_id") or r.get("spl_id") or ""

        drug_name = (r.get("drug_name") or "").strip()
        section = (r.get("section") or "").strip()

        cite_key = f"S{i+1}"

        # helpful header to keep contexts separated in the LLM prompt
        header_parts = []
        if drug_name:
            header_parts.append(drug_name)
        if section:
            header_parts.append(section)
        if set_id:
            header_parts.append(f"set_id={set_id}")
        header = " | ".join(header_parts)

        snippets.append({
            "cite_key": cite_key,               # stable short citation id
            "chunk_id": str(r.get("id", "")),   # original chunk id if you need it
            "drug_name": drug_name,
            "section": section,
            "set_id": set_id,
            "spl_id": spl_id,
            "score": r.get("score", None),

            # snippet text (bounded) with context header
            "snippet": (header + "\n" + text)[:1400],

            # keep original source too
            "source": {"set_id": set_id, "spl_id": spl_id, **source},
        })

    state.evidence["snippets"] = snippets
    state.flags["next_step"] = "answer_composer"