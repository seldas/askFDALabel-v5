# 🔍 askFDALabel-Suite: Semantic Search Strategy Review (2026 Enhanced Architecture)

This document provides a comprehensive map of the current search and reasoning strategy following the 2026 multi-agent re-architecture (formerly V3), including precision, diversity, and grounding improvements.

---

# 🏗️ Architectural Pattern: Multi-Agent Orchestration

The system follows a **Controller-Orchestrated Agent State Machine** pattern.

A central `run_controller()` loop manages an `AgentState` object and transitions through specialized agents:

```
Planner → (Keyword | Semantic) → Reranker → Postprocess → Evidence → Composer → Reasoning
```

### Key Properties

* Deterministic state transitions via `state.flags["next_step"]`
* Guardrails prevent infinite loops and missing transitions
* Shared structured retrieval schema across keyword + semantic paths
* Explicit grounding enforcement in generation phase
* Retrieval metadata preserved for explainability

---

# 🚦 Phase 1: Planning & Intent Resolution

**Agent:** `planner.py`

### Responsibilities

* Classifies user intent:

  * `IDENTIFIER`
  * `ENTITY_LOOKUP`
  * `CLINICAL_QA`
  * `CLARIFICATION`
  * `OUT_OF_SCOPE`
* Rewrites follow-up queries into standalone resolved queries
* Extracts potential drug entities
* Detects continuation/coreference patterns

### Guardrails Added

* Deterministic identifier detection (UUID, NDC, NDA/BLA/ANDA regex)
* Strict JSON schema normalization
* Intent validation against allowed categories
* Clarification fallback if ambiguous continuation

### Routing Strategy

| Intent                       | Retrieval Path                                                     |
| ---------------------------- | ------------------------------------------------------------------ |
| IDENTIFIER                   | Keyword-only                                                       |
| ENTITY_LOOKUP                | Keyword-first (may escalate to semantic if clinical cues detected) |
| CLINICAL_QA                  | Semantic path                                                      |
| CLARIFICATION / OUT_OF_SCOPE | Direct to composer                                                 |

**Important Shift:**
`ENTITY_LOOKUP` is treated as a retrieval strategy rather than a rigid intent class. If the query includes clinical cues, the system escalates to semantic retrieval constrained by keyword results.

---

# 🏎️ Phase 2A: Fast-Path Retrieval (Keyword)

**Agent:** `keyword_retriever.py`

### Mechanism

Standard SQL against `labeling.sum_spl`.

### Logic

* IDENTIFIER:

  * Exact `set_id`
  * Pattern-aware NDC matching
  * Approval number lookup
* ENTITY_LOOKUP:

  * `ILIKE` on `product_names` / `generic_names`
  * RLD prioritization
  * Simple relevance ordering

### Clinical Cue Escalation

If:

* Query contains clinical terms (dose, hepatotoxicity, contraindication, etc.)
* AND keyword returns candidate labels

Then:

* Semantic retrieval is invoked
* `filter_set_ids` applied to restrict search to candidate labels

This produces a **hybrid constrained retrieval** pattern.

---

# 🧠 Phase 2B: Semantic Retrieval (Vector)

**Agent:** `semantic_retriever.py`

### Mechanism

pgvector cosine similarity search over `label_embeddings`.

### Core Improvements

1. **Single Distance Computation**

   * Compute `<=>` once as `dist`
   * Score = `1 - dist`, clamped to `[0,1]`

2. **Per-Label Diversity Constraint**

   * `ROW_NUMBER() OVER (PARTITION BY set_id ORDER BY dist)`
   * Enforce `per_label_k` cap (default 3)
   * Prevents single-label domination

3. **Optional Constrained Search**

   * `filter_set_ids` from keyword stage
   * Enables precise "drug + clinical question" behavior

4. **Chunk Quality Filters**

   * Minimum chunk length
   * Optional section include/exclude filtering

### Default Parameters

* `top_k`: 50
* `per_label_k`: 3

---

# 🎯 Phase 3: Precision & Filtering

## 🔎 Reranking

**Agent:** `reranker.py`

### Process

* Top 20 semantic results reranked
* Structured LLM output:

```
[
  {"score": 0-10, "answerable": true/false, "reason": "..."}
]
```

### Final Scoring

```
final_score =
  (0.3 × vector_score)
+ (0.7 × LLM_score)
× answerable_factor
```

* `answerable=false` reduces final score
* Prevents "topical but non-answering" passages

### Improvements

* Temperature = 0 for stability
* Robust JSON parsing
* Per-label cap before reranking
* Structured rubric reduces "vibes scoring"

---

## 🧹 Postprocessing

**Agent:** `postprocess.py`

### Enhancements

1. **Near-Duplicate Removal**

   * Normalize text
   * Strip punctuation
   * Collapse whitespace
   * SHA1 fingerprint of first ~400 chars

2. **Per-Label Cap (Secondary Safety Net)**

   * `max_per_set_id`

3. **Global Cap**

   * `max_total_results`

4. **Min Score Enforcement**

   * Configurable threshold

5. **Field Normalization**

   * Guarantees required fields exist

This significantly reduces:

* Repeated paragraphs
* One-label overrepresentation
* Low-quality tail passages

---

# 📖 Phase 4: Evidence & Grounded Synthesis

## 📌 Evidence Extraction

**Agent:** `evidence_fetcher.py`

### Enhancements

* Stable citation keys (`S1`, `S2`, etc.)
* Header enrichment:

  * Drug name
  * Section title
  * set_id
* Structured snippet schema
* Bound snippet length (~1400 chars)

---

## 🧠 Grounded Answer Generation

**Agent:** `answer_composer.py`

### Strict Grounding Policy

* Must use only provided excerpts
* Must cite using `[S#]`
* Must not combine across different `set_id`s
* Must explicitly state if answer not found:

> "The provided label documents do not contain information to answer this question."

### Anti-Blending Protection

* Explicit rule: no cross-label merging
* Multi-drug answers structured by product
* Conflict detection allowed

### Output

* Concise markdown
* Stable citation mapping

---

# 🔎 Phase 5: Retrieval Transparency

**Agent:** `reasoning_generator.py`

Produces lightweight retrieval summary:

* Pipeline used (keyword / semantic / hybrid)
* Intent classification
* top_k and rerank_k
* Number of labels used
* Top drugs and sections represented
* Whether semantic filtering applied

This provides auditability without revealing chain-of-thought.

---

# 🛠️ Performance & Scalability Design

1. **pgvector Indexing**

   * IVFFlat or HNSW (depending on deployment)
   * Sub-100ms similarity search at scale

2. **Diversity in SQL (not post-hoc)**

   * Window functions for per-label caps
   * Efficient pruning before LLM rerank

3. **Controller Hardening**

   * Default config initialization
   * Max-step guard to prevent infinite loops
   * Guaranteed `plan` structure
   * Error-safe finalization

4. **Streaming UI Support**

   * Real-time agent stage updates
   * Transparent progress visualization

---

# 🎯 Major Quality Levers (Post-Upgrade Reality)

## A) Intent Routing Remains the Primary Lever

Misrouting still affects:

* ENTITY_LOOKUP wrongly sent to semantic
* CLINICAL_QA incorrectly limited to keyword
* Coreference failure

Mitigation now includes:

* Deterministic identifier regex
* Clinical cue escalation
* Constrained semantic retrieval

---

## B) Vector Retrieval Bias Mitigated

Previously:

* One label could dominate top 50
* Brand-heavy embeddings skewed results

Now mitigated by:

* SQL-level per-label diversity
* Secondary postprocess caps
* Section filtering support

---

## C) Reranker Stability Improved

Previously:

* LLM score dominated
* Off-topic passages scored high

Now:

* Structured rubric
* Answerability weighting
* Hard filters before rerank
* Temperature = 0
* JSON schema enforcement

---

## D) Near-Duplicate Chunks Eliminated

Previously:

* Slight formatting differences bypassed dedupe

Now:

* Normalization + hashing
* Aggressive fuzzy filtering
* Multi-layer dedupe (SQL + postprocess)

---

# 🧪 Current Retrieval Pattern Summary

The system now behaves as:

* Deterministic when possible (identifier lookup)
* Hybrid when beneficial (drug + clinical question)
* Diversified at retrieval stage
* Precision-tuned at reranking stage
* Strictly grounded at answer stage
* Transparent at reasoning stage

---

# 🚀 Future Enhancements

* Reciprocal Rank Fusion (true hybrid fusion scoring)
* MMR re-ranking option (non-LLM diversity)
* Section-aware retrieval weighting (e.g., prioritize Contraindications, Warnings)
* Cross-label comparison mode
* Study Mode (aggregate statistics)
