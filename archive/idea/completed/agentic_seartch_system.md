### **System Architecture Overview**

This system acts as an **Agentic RAG (Retrieval-Augmented Generation)** pipeline. Unlike linear chains, it uses a central **Router** to dynamically dispatch tasks based on the current state of the conversation and data retrieval process.

To ensure cohesion between agents, we will use a **Shared State Object** passed between all components. This prevents "amnesia" as the request moves from agent to agent.

---

### **1. The Shared State Data Structure**
## Proposed Shared State v2 (more detailed, more efficient)

Below is a more “production-shaped” state. Notice:

* separation of **conversation / intent / retrieval / evidence / answer**
* small “document references” instead of heavy blobs
* explicit **next_step** as a state machine hook
* telemetry for debugging and optimization

```json
{
  "meta": {
    "session_id": "uuid-1234",
    "turn_id": 17,
    "schema_version": "2.0",
    "created_at": "2026-02-03T14:22:10Z"
  },

  "conversation": {
    "user_query": "original user prompt",
    "history": [
      {"role": "user", "text": "..."},
      {"role": "assistant", "text": "..."}
    ],
    "memory_summary": "optional short rolling summary",
    "user_preferences": {
      "verbosity": "medium",
      "show_citations": true
    }
  },

  "intent": {
    "type": "search | qa | compare | browse | chitchat",
    "confidence": 0.0,
    "slots": {
      "drug_name": null,
      "ndc": null,
      "set_id": null,
      "manufacturer": null,
      "date_range": null,
      "sections_requested": []
    },
    "needs_clarification": false,
    "clarifying_question": null
  },

  "retrieval": {
    "plan": {
      "strategy": "structured | hybrid | semantic_fallback",
      "top_k": 5,
      "oversample_k": 20,
      "sort": "relevance | recency",
      "filters": {},
      "relaxation_steps": [
        {"name": "drop_manufacturer_filter", "enabled": true},
        {"name": "fuzzy_title_match", "enabled": true}
      ]
    },

    "db": {
      "sql": null,
      "binds": {},
      "last_error": null,
      "retry_count": 0,
      "timings_ms": {},
      "results": {
        "fetched_k": 0,
        "has_more_than_k": false,
        "candidates": [
          {
            "set_id": "abc",
            "title": "Drug X Label",
            "date": "2025-11-02",
            "manufacturer": "Acme Pharma",
            "score": 0.87,
            "match_reason": "matched drug_name + recency",
            "snippet": "optional short snippet from metadata/full-text index"
          }
        ]
      }
    }
  },

  "evidence": {
    "selected_set_ids": [],
    "snippets": [
      {
        "set_id": "abc",
        "section": "WARNINGS",
        "chunk_id": "abc#warn#03",
        "text": "short extracted text only",
        "start_offset": 12030,
        "end_offset": 12488
      }
    ]
  },

  "answer": {
    "response_text": null,
    "citations": [
      {"set_id": "abc", "section": "WARNINGS", "chunk_id": "abc#warn#03"}
    ],
    "confidence": 0.0
  },

  "flags": {
    "next_step": "planner | db_call | postprocess | evidence_fetch | answer | clarify",
    "answer_ready": false,
    "terminate": false
  },

  "telemetry": {
    "trace": [
      {"step": "planner", "note": "intent=qa, slots missing manufacturer"},
      {"step": "db_call", "note": "ran sql_template=label_search_v2"}
    ],
    "errors": []
  }
}
```

---
## Agent set v2 (fewer LLM calls, better grounding)

### A) Controller (deterministic)

* Reads `flags.next_step`
* Enforces state machine rules
* Never “hallucinates decisions”
* Routes to tools/LLMs

### B) Planner Agent (LLM, single call)

**Replaces**: router intent classification + addition requirements (most cases) + query generator (initial version)

Outputs:

* intent type
* filled slots + missing slots
* retrieval plan (top_k, filters, sort, relaxation)
* *either* a clarification question *or* a SQL plan request

### C) SQL Builder (templated with fill-by-AI)

Strong recommendation for reliability:

* Prefer **templates + slot filling** over free-form SQL
* LLM can choose the template + provide binds

Example: `label_search_by_drug_name`, `label_search_by_set_id`, `label_search_by_ndc`, etc.

### D) DB Executor (tool)

Executes parameterized SQL, returns:

* rows (top_k+1)
* error (if any)
* timing

### E) Postprocess (deterministic)

* dedupe
* compute `has_more_than_k`
* rank fallback (if DB rank weak)
* decide:

  * fetch evidence for top N
  * or ask refinement + show facets
  * or “no results” + try relaxation

### F) Evidence Fetcher (tool + small logic)

* fetch only relevant sections/chunks (not whole documents)
* ideally: section-aware retrieval (WARNINGS, DOSAGE, etc.)

### G) Evidence Extractor (LLM, optional but valuable)

* If chunks are still large/noisy, do one LLM pass:

  * pick the best 3–7 snippets that answer the question
  * output structured citations

### H) Answer Composer (LLM)

* Uses only evidence snippets + metadata
* Produces final response + citations
* Sets `flags.answer_ready = true`

### I) Verifier/Critic (optional, but great for medical-ish domains)

* Checks answer claims are supported by evidence snippets
* If unsupported: either remove claim or request more evidence

---

## Updated workflow v2 (more efficient)

1. **User → Controller**
2. Controller → **Planner (LLM)**

   * If missing required slots → `clarify`
   * Else → produce retrieval plan
3. Controller → **DB Executor** (top_k+1) using safe templates/binds
4. Controller → **Postprocess**

   * 0 results → run 1 relaxation step automatically → DB again
   * > k → show ranked top results + facets + refine prompts (no heavy fetch)
   * 1..k → proceed
5. Controller → **Evidence Fetch** (section/chunk level)
6. Controller → **Answer Composer (LLM)** (+ optional Verifier)
7. Output

This typically becomes **2 LLM calls** for a successful query:

* Planner
* Answer Composer
  (3 if Verifier is on)

---

## “Search labeling documents” specifics you can add (domain detail)

If these are *drug labeling documents* (SPL-style), you can dramatically improve search by modeling labels as structured sections:

* INDICATIONS_AND_USAGE
* DOSAGE_AND_ADMINISTRATION
* CONTRAINDICATIONS
* WARNINGS_AND_PRECAUTIONS
* ADVERSE_REACTIONS
* DRUG_INTERACTIONS
* USE_IN_SPECIFIC_POPULATIONS
* HOW_SUPPLIED

Even if the DB stores the label as one big CLOB, you can:

* pre-parse into sections during ingestion
* store per-section text + embeddings (optional)
* retrieve only sections requested

This gives you:

* faster responses
* cleaner evidence
* better user experience (“Here’s the WARNINGS section relevant to…”, with citations)

---
