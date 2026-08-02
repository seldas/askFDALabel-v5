# scripts/search_v3_core/agents/answer_composer.py
from dashboard.services.ai_handler import call_llm

ANSWER_COMPOSER_SYSTEM_PROMPT = """
You are a highly specialized FDA drug labeling assistant.

You must answer the user's question using ONLY the provided label excerpts.
Do NOT use outside knowledge. Do NOT guess.

Rules:
- If the excerpts do not contain the information needed to answer, say:
  "The provided label documents do not contain information to answer this question."
- Every factual claim must be followed by at least one citation in the form [S#] (example: [S2]).
- Do not combine facts across different products/labels unless the user explicitly asks for a comparison.
  Treat different set_id values as different labels.
- If multiple drugs are present, structure the answer by drug (separate sections per drug).
- If excerpts conflict, explicitly note the conflict and cite both sides.
- If the user's query appears to be just the name of a drug (or drugs) with no specific question, acknowledge it and output the drug name(s) wrapped in the <annotation class="drug"> tag. Tell the user they can click the drug name to filter the results and find its labeling.
- Be concise. No preamble.

In your response, you MUST wrap specific entities with custom XML tags for downstream processing and highlighting.
Categories to tag:
1. <annotation class="drug">Drug Name</annotation> - For all medication and substance names.
2. <annotation class="adverse_events">Reaction</annotation> - For symptoms, side effects, or medical conditions.
3. <annotation class="ndc">NDC Code</annotation> - For National Drug Codes (e.g., "12345-678-90").
4. <annotation class="temporal">Time</annotation> - For durations, dates, or frequencies (e.g., "5 days", "daily").

Example: "The <annotation class="drug">Aspirin</annotation> label (NDC: <annotation class="ndc">0024-0335-01</annotation>) lists <annotation class="adverse_events">headache</annotation> as a side effect lasting <annotation class="temporal">2 days</annotation>."
Do not explain these tags to the user.
"""

def run_answer_composer(state):
    state.agent_flow.append("answer_composer")
    intent_type = (state.intent.get("intent") or "").upper()

    # 1) Out of Scope
    if intent_type == "OUT_OF_SCOPE":
        state.answer["response_text"] = (
            "I can only help with questions that can be answered from FDA drug labeling excerpts. "
            "Ask about indications, dosing, contraindications, warnings/precautions, adverse reactions, interactions, or similar label content."
        )
        state.answer["is_final"] = True
        state.flags["next_step"] = "reasoning_generator"
        return

    # 2) Clarification
    if intent_type == "CLARIFICATION":
        state.answer["response_text"] = state.intent.get(
            "clarification_question",
            "Which drug (brand/generic) are you asking about?"
        )
        state.answer["is_final"] = True
        state.flags["next_step"] = "reasoning_generator"
        return

    query = (state.conversation.get("user_query") or "").strip()
    snippets = state.evidence.get("snippets", []) or []

    if not snippets:
        state.answer["response_text"] = (
            "The provided label documents do not contain information to answer this question."
        )
        state.answer["is_final"] = True
        state.flags["next_step"] = "reasoning_generator"
        return

    # Build excerpts payload with stable citation keys.
    # Prefer cite_key if present; fallback to Excerpt index.
    excerpts_text = []
    for i, s in enumerate(snippets):
        cite_key = s.get("cite_key") or f"S{i+1}"
        drug = (s.get("drug_name") or "").strip()
        section = (s.get("section") or "").strip()
        set_id = (s.get("set_id") or (s.get("source") or {}).get("set_id") or "").strip()
        text = (s.get("snippet") or "").strip()

        # Skip ultra-low-info metadata snippets if present (optional heuristic)
        if (section.lower() == "label metadata") and ("found label" in text.lower()) and len(text) < 250:
            continue

        header_bits = [f"Source {cite_key}"]
        if drug: header_bits.append(f"Drug: {drug}")
        if section: header_bits.append(f"Section: {section}")
        if set_id: header_bits.append(f"set_id: {set_id}")

        excerpts_text.append(
            " | ".join(header_bits) + "\n" + text
        )

    # If we filtered everything out, fall back to original snippets
    if not excerpts_text:
        for i, s in enumerate(snippets):
            cite_key = s.get("cite_key") or f"S{i+1}"
            drug = (s.get("drug_name") or "").strip()
            section = (s.get("section") or "").strip()
            set_id = (s.get("set_id") or (s.get("source") or {}).get("set_id") or "").strip()
            text = (s.get("snippet") or "").strip()

            header_bits = [f"Source {cite_key}"]
            if drug: header_bits.append(f"Drug: {drug}")
            if section: header_bits.append(f"Section: {section}")
            if set_id: header_bits.append(f"set_id: {set_id}")

            excerpts_text.append(" | ".join(header_bits) + "\n" + text)

    user_message = (
        f"User Question:\n{query}\n\n"
        f"Label Excerpts:\n\n" +
        "\n\n---\n\n".join(excerpts_text)
    )

    try:
        response_text = call_llm(
            user=state.user,
            system_prompt=ANSWER_COMPOSER_SYSTEM_PROMPT,
            user_message=user_message,
            temperature=0.0
        )
        state.answer["response_text"] = response_text
        state.trace_log.append("AnswerComposer: Generated grounded answer.")
    except Exception as e:
        state.trace_log.append(f"AnswerComposer error: {str(e)}")
        state.answer["response_text"] = "Error generating answer. Please try again later."

    state.answer["is_final"] = True
    state.flags["next_step"] = "reasoning_generator"