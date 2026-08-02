# AskFDALabel AI and Search Architecture Report

**Document type:** Cross-cutting technical architecture report  
**Status:** Living document  
**Implementation basis:** Current repository contents under `backend/search/`, `backend/dashboard/services/`, `backend/dashboard/routes/`, `backend/labelcomp/`, `backend/device/`, `frontend/app/search/`, and `frontend/public/dashboard/js/`  
**Boundary:** This report describes the platform’s AI runtime model, provider abstraction, prompt and inference architecture, search pipeline design, frontend/backend integration points, and current implementation drift. It is intentionally more technical than `Documents/Overview.md` and intentionally less exhaustive than a future endpoint or prompt catalog.

## Abstract

AskFDALabel does not implement “AI” as one isolated feature. The current codebase uses a shared inference layer to support multiple capability families: label-grounded chat, search-term assistance, semantic retrieval over SPL chunks, comparison summarization, adverse-event rematching, toxicity assessment generation, PGx extraction, and selected device-analysis workflows. The architectural center of gravity for that work is `backend/dashboard/services/ai_handler.py`, which acts as the suite’s common model gateway for both text generation and embeddings.

The search subsystem is a separate but related architectural layer. It has its own backend blueprint under `backend/search/`, its own frontend workspace under `frontend/app/search/`, and a new semantic-agent pipeline under `backend/search/scripts/semantic_core/`. That newer pipeline is built as a staged controller over a mutable `AgentState` object and uses planner, retrieval, reranking, evidence, and answer-composition agents. At the same time, the checked-in UI still preserves older chat- and metadata-oriented behavior, and some frontend paths remain wired to routes or modes that do not line up with the current backend surface.

This report documents the current AI and search architecture as it exists in code today, with special attention to subsystem boundaries, shared runtime services, grounding strategy, streaming behavior, storage dependencies, and the specific areas where the current implementation is transitional.

## 1. Architectural position and scope

From an architectural perspective, the AI and search stack sits across three layers:

1. **Shared inference layer** in `dashboard/services/ai_handler.py`  
   This layer hides provider selection, model invocation, streaming, and embedding generation behind a small set of helper functions.

2. **Capability-specific orchestration layers**  
   These include dashboard chat and search-helper routes, search semantic agents, comparison summarization, toxicity and PGx assessments, FAERS semantic rematching, and device-analysis helpers.

3. **User-facing integration layers**  
   These include the App Router search workspace under `frontend/app/search/`, the label-detail AI/chat/agent surfaces that still depend partly on legacy public JavaScript, and selected module-specific React or browser-side flows.

The key design implication is that the suite’s AI behavior is **centralized at the provider/runtime level but decentralized at the orchestration level**. There is one shared way to call models, but many feature-specific prompt and data-shaping layers.

## 2. Shared AI runtime architecture

### 2.1 Core inference gateway

`backend/dashboard/services/ai_handler.py` is the suite’s common AI execution layer. It is responsible for:

- selecting the active model provider,
- constructing provider-specific clients,
- handling text-generation calls,
- handling embedding calls,
- supporting both standard and streaming text generation,
- providing task-level wrappers such as document chat, comparison summarization, assessment generation, and search-helper responses.

This file is therefore both a provider adapter and a policy layer. It contains environment-sensitive defaults and fallback logic rather than being a thin SDK wrapper.

### 2.2 Provider model

The current provider architecture supports four execution modes:

| Provider path | Current role | Trigger condition |
|---|---|---|
| Gemini | Default external text-generation and embedding provider | Default path for most authenticated or local usage |
| Elsa | Internal text-generation path | Selected automatically for unauthenticated internal environments |
| Llama / OpenAI-compatible endpoint | Optional internal or self-hosted inference path | Activated when `ai_provider == "llama"` and `LLM_URL` is configured |
| Local embedding model | Optional embedding-only path | Activated when `EMBEDDING_PROVIDER=local` or a local embedding model is explicitly configured |

A few current runtime details matter operationally:

- the code uses `GOOGLE_API_KEY`, not the older `GEMINI_API_KEY` terminology seen in some historical notes,
- unauthenticated internal execution defaults to **Elsa**, not Gemini,
- explicit Llama selection falls back to Gemini if `LLM_URL` is missing,
- Gemini quota failures attempt a fallback model defined by `FALLBACK_MODEL_ID`,
- embeddings and text generation can be configured independently enough that a text provider and embedding provider may differ.

### 2.3 Embedding architecture

Embeddings are also routed through `ai_handler.py`, via `call_embedding()`. The current implementation supports:

- Gemini embeddings with 768-dimensional output,
- OpenAI-compatible embedding endpoints when the active provider is Llama/OpenAI-style,
- local SentenceTransformer embeddings when local embedding mode is enabled.

This matters because the semantic search pipeline depends on `call_embedding()` rather than on a search-local model client. Search therefore inherits provider configuration and embedding behavior from the same shared service layer used elsewhere.

### 2.4 Invocation patterns

The shared text-generation API is centered on `call_llm(user, system_prompt, user_message, history=None, model_override=None, **kwargs)`.

Architecturally, that interface supports:

- multi-turn chat history,
- system-prompt injection,
- temperature and max-token control,
- streaming and non-streaming generation,
- provider-specific adaptation without changing callers.

The codebase uses that same function in very different ways:

- grounded label chat,
- search intent classification,
- semantic reranking,
- answer composition,
- HTML report generation,
- JSON extraction tasks,
- device-comparison narrative generation.

The architectural benefit is consistency; the tradeoff is that output validation and schema enforcement are handled at the caller level rather than by a more strongly typed inference framework.

## 3. Prompt architecture and output discipline

Prompt logic is distributed across the codebase rather than centralized in one package.

### 3.1 Shared prompt assets

`backend/dashboard/prompts.py` currently houses several major prompt definitions, including:

- `SEARCH_HELPER_PROMPT`,
- `DILI_prompt`,
- `DICT_prompt`,
- `DIRI_prompt`.

These are long-form task prompts intended for structured or semi-structured outputs, including raw HTML reports for toxicology use cases.

### 3.2 Search-local prompts

The newer semantic search stack keeps several prompts close to the agents that use them:

- planner classification prompt in `semantic_core/agents/planner.py`,
- reranker scoring prompt in `semantic_core/agents/reranker.py`,
- answer-composer grounding prompt in `semantic_core/agents/answer_composer.py`.

This local placement makes the search stack self-contained, but it also means prompt governance is currently split between the dashboard service layer and the search package.

### 3.3 Output discipline

A notable design pattern across the AI stack is **task-specific output discipline**:

- search-helper flows expect JSON,
- toxicity assessments expect raw HTML fragments,
- comparison summaries expect HTML,
- semantic search answers require inline source citations like `[S1]`,
- general search and some answer flows require custom `<annotation class="...">...</annotation>` tags,
- refinement flows attempt to preserve and extend existing annotation tags.

This means the suite relies on prompt instructions as part of its effective contract layer. The architecture works, but it is only as reliable as each caller’s post-processing and validation logic.

## 4. AI capability families across the suite

The AI runtime is shared, but orchestration differs by capability family.

| Capability family | Primary entry points | Core service path | Grounding source |
|---|---|---|---|
| Label-grounded chat | `/api/dashboard/ai_chat` | `chat_with_document()` | full XML or SPL content provided by caller |
| Search-term assistance | `/api/dashboard/ai_search_help` | `get_search_helper_response()` | task prompt plus user history |
| Semantic label search | `/api/search/search_agentic_stream` and search-local helpers | `semantic_core` agents plus `call_llm()` and `call_embedding()` | `label_embeddings`, `labeling.sum_spl`, and evidence snippets |
| General search chat | `/api/search/chat` | `search_general()` | active filter context and free-form query |
| Response refinement against one label | `/api/search/refine_chat` | direct `call_llm()` over XML snippet | full XML for one `set_id` |
| Comparison summarization | `/api/dashboard/ai_compare_summary`, `/api/labelcomp/summarize` | `summarize_comparison()` / `get_comparison_summary()` | differing section content |
| Toxicology assessments | `/api/dashboard/dili/assess/*`, `/dict/assess/*`, `/diri/assess/*` | `generate_assessment()` | selected SPL sections |
| PGx assessment | `/api/dashboard/pgx/assess/<set_id>` | `run_pgx_assessment()` | XML-derived pharmacogenomic sections |
| FAERS semantic rematch | `/api/dashboard/faers/ai_rematch` | specialized prompt via `chat_with_document()` | XML plus unresolved FAERS terms |
| Device analysis | `/api/device/analyze`, device services | direct `call_llm()` | MAUDE, recall, IFU, or normalized manufacturer text |

The system is therefore best described as a **shared AI platform inside one application suite**, not as one search-only LLM integration.

## 5. Search subsystem architecture

### 5.1 Position of the search stack

The search subsystem has three distinct layers:

- `backend/search/blueprint.py` for HTTP route orchestration,
- `backend/search/scripts/semantic_core/` for the semantic-agent pipeline,
- `frontend/app/search/` for the current App Router search workspace.

The search package also contains compatibility helpers and older prompt/util files, which indicates the subsystem has been evolved incrementally rather than replaced in one step.

### 5.2 Backend route surface

The active search blueprint currently exposes the following search-related route families:

| Route | Role |
|---|---|
| `POST /api/search/chat` | chat-style answer generation over free-form query and optional filters |
| `POST /api/search/refine_chat` | revises the last assistant answer against one label’s XML |
| `POST /api/search/filter_data` | metadata-only filtering for the results panel |
| `POST /api/search/search_agentic_stream` | NDJSON streaming semantic-agent execution |
| `POST /api/search/get_metadata` | enriches result `set_id` values with metadata |
| `POST /api/search/export_excel` | exports selected labels to Excel |

There is also a separate non-route wrapper, `backend/search/scripts/semantic_search.py`, that packages the semantic-agent response into a non-streaming JSON structure. In the current checked-in backend, that wrapper is imported into `blueprint.py` but is not visibly connected to an HTTP route.

### 5.3 Dual search model

The search subsystem currently contains two architectural styles side by side.

#### A. General chat/search path

`search_general()` in `backend/search/scripts/general_search.py` provides a simpler LLM answer path that:

- accepts the user query,
- appends optional filter context,
- uses a system prompt that restricts scope to labeling analysis,
- returns LLM output with custom annotation tags.

This path is **not** retrieval-grounded to label excerpts.

#### B. Semantic-agent path

The newer search architecture lives in `backend/search/scripts/semantic_core/` and uses a staged agent controller. It is designed for:

- intent classification,
- identifier and entity resolution,
- vector retrieval over label chunks,
- LLM-based reranking,
- evidence extraction,
- grounded answer generation with citations,
- compact retrieval reasoning.

This newer path is the suite’s most structured search implementation.

## 6. Semantic-agent pipeline design

### 6.1 State model

`semantic_core/state.py` defines `AgentState`, the mutable state container for the entire pipeline. It holds:

- conversation state,
- interpreted intent,
- retrieval plan and results,
- evidence snippets,
- final answer,
- reasoning summary,
- trace log,
- execution flags,
- user-selected filters,
- runtime configuration such as `top_k`, `rerank_k`, and `min_score`.

This is a controller-centric architecture rather than a stateless functional pipeline. Each agent mutates the shared state and advances `next_step`.

### 6.2 Controller flow

`semantic_core/controller.py` implements a bounded execution loop with explicit step transitions. The nominal flow is:

```text
planner
  -> keyword_retriever OR semantic_retriever OR answer_composer
  -> reranker
  -> postprocess
  -> evidence_fetcher
  -> answer_composer
  -> reasoning_generator
  -> end
```

The controller also contains safety behavior:

- default configuration injection,
- max-step protection,
- graceful termination when a step fails to advance,
- fallback transition to an error state.

### 6.3 Planner behavior

The planner is an LLM-backed intent classifier with deterministic guardrails.

It distinguishes among:

- `IDENTIFIER`,
- `ENTITY_LOOKUP`,
- `CLINICAL_QA`,
- `CLARIFICATION`,
- `OUT_OF_SCOPE`.

The planner also contains rule-based fast paths:

- active structured filters bypass LLM classification and route to keyword retrieval,
- obvious identifiers such as `set_id`, NDC, and approval-number patterns route directly to keyword retrieval.

This hybrid design reduces unnecessary model calls for highly structured search requests.

### 6.4 Keyword retrieval path

`keyword_retriever.py` operates over `labeling.sum_spl` using direct SQL. It supports three main behaviors:

- metadata filtering when structured search filters are present,
- direct identifier lookup for `set_id`, NDC, and approval numbers,
- name-based label discovery for entity lookup.

An important architectural nuance is that keyword retrieval can also act as a **candidate generator** for semantic retrieval. If the query is classified as `ENTITY_LOOKUP`, contains clinical cues, and produces metadata matches, the retriever constrains the next semantic search step to those candidate `set_id` values.

That makes the pipeline effectively hybrid in some cases:

```text
entity lookup
  -> keyword candidate selection
  -> filtered semantic retrieval
  -> reranking
  -> evidence composition
```

### 6.5 Semantic retrieval path

`semantic_retriever.py` performs vector retrieval against `label_embeddings`, joined back to `labeling.sum_spl` for drug identity data. The key architectural characteristics are:

- query embeddings are produced through the shared `call_embedding()` abstraction,
- retrieval uses pgvector distance on `embedding <=> query_vector`,
- per-label diversity is enforced with `ROW_NUMBER() OVER (PARTITION BY set_id ...)`,
- optional constraints can limit retrieval to candidate `set_id` values,
- results are normalized into frontend-friendly objects with drug, section, text, score, and source metadata.

### 6.6 Reranking and postprocessing

`reranker.py` uses an LLM prompt to score answerability and relevance for the top retrieved excerpts. It then blends that LLM score with the semantic similarity score and keeps the best `rerank_k` excerpts.

`postprocess.py` then normalizes and cleans the result set by:

- applying minimum-score filtering,
- enforcing required fields,
- deduplicating near-identical text,
- capping passages per label,
- capping total retained results.

This means the semantic pipeline is not “retrieve and answer”; it is **retrieve, judge, normalize, dedupe, then answer**.

### 6.7 Evidence and answer composition

`evidence_fetcher.py` converts retrieved passages into bounded snippets with stable `S1`, `S2`, ... citation keys and provenance fields.

`answer_composer.py` then produces the user-facing answer under strict grounding rules:

- answer only from provided excerpts,
- do not guess,
- say so explicitly if excerpts are insufficient,
- cite every factual claim with `[S#]`,
- keep products separated unless comparison is requested,
- preserve or emit custom annotation tags for specific entity classes.

The semantic search subsystem is therefore deliberately designed for **grounded, cited answering**, not free-form conversational synthesis.

### 6.8 Reasoning and debug output

`reasoning_generator.py` produces a lightweight retrieval summary rather than exposing hidden chain-of-thought. The summary includes:

- the pipeline style used,
- the interpreted intent,
- candidate and rerank settings,
- how many labels and passages were used,
- the most represented drugs and sections.

The search stack also tracks:

- `agent_flow`,
- `trace_log`,
- `debug_plan`,
- `debug_stats`.

These are intended for explainability and debugging rather than for end-user narrative reasoning.

## 7. Search data dependencies and grounding model

The current search stack depends on three broad data sources.

### 7.1 Metadata and identifier source

`labeling.sum_spl` is the primary table for:

- product names,
- generic names,
- set IDs,
- SPL IDs,
- approval numbers,
- NDCs,
- RLD status,
- other searchable label metadata.

This table underpins keyword retrieval, metadata enrichment, and parts of the filter UX.

### 7.2 Embedding and passage source

`label_embeddings` is the current semantic search index. The semantic retriever expects it to contain:

- chunk IDs,
- `set_id`,
- `spl_id`,
- section title,
- chunk text,
- vector embedding.

The entire semantic-agent architecture assumes that this embedding table already exists and is populated.

### 7.3 Full-label XML source

Some AI flows bypass chunk retrieval and operate over whole-label XML or large XML excerpts instead. This is true for:

- `refine_chat`,
- dashboard label chat,
- toxicity assessment generation,
- PGx assessment,
- FAERS semantic rematch.

Those paths rely on XML pulled through `FDALabelDBService` and `fda_client` helpers rather than through the semantic passage index.

The architectural consequence is that AskFDALabel uses **two grounding scales**:

- **chunk-scale grounding** for semantic search,
- **document-scale grounding** for label-level analysis and generation tasks.

## 8. Streaming model and response contracts

### 8.1 Semantic streaming protocol

`/api/search/search_agentic_stream` returns NDJSON rather than one final JSON response. The stream includes typed messages such as:

- `status`,
- `answer_start`,
- `chunk`,
- `answer_end`,
- `final`,
- `error`.

The route runs the retrieval pipeline in a background thread, emits humanized progress messages from `trace_log`, and then streams answer tokens separately.

### 8.2 Streaming answer generation nuance

One important implementation detail is that the streaming route does **not** simply call the normal `run_answer_composer()` function and stream its output. Instead, `stream_answer_tokens()` reconstructs the answer-composer prompt and performs a direct streaming `call_llm(..., stream=True)` call.

That means the streaming answer path and the non-streaming answer-composer path are conceptually aligned but not literally the same code path.

### 8.3 Other output contracts

Across the AI stack, the current output contracts include:

- raw JSON for helper and verification tasks,
- raw HTML for assessments and comparison summaries,
- plain text plus inline annotations for some label chat flows,
- metadata-rich semantic-search payloads containing results, reasoning, and debug objects.

Because these contracts vary by endpoint, the frontend and any future API consumers should treat each AI route as task-specific rather than assuming uniform response semantics.

## 9. Frontend integration architecture

### 9.1 App Router search workspace

The current search workspace under `frontend/app/search/` is implemented around:

- `page.tsx`,
- `context/SearchContext.tsx`,
- `components/ChatPanel.tsx`,
- `components/Results.tsx`.

Architecturally, it is a shared-state client-side workspace where the chat panel and results panel collaborate through React context.

### 9.2 Current search frontend behavior

The most important current implementation fact is that the checked-in `ChatPanel.tsx` submits user questions to:

- `POST /api/search/chat`

That is the simpler chat-style route, not the newer semantic streaming endpoint. As a result, the current App Router search UI is not yet fully wired to the semantic-agent pipeline even though the backend contains that pipeline.

### 9.3 Search UI drift already visible in code

Several frontend signals show that the search workspace is mid-transition:

- `SearchContext` defaults `searchMode` to `"semantic"`,
- `Results.tsx` still contains logic keyed on `v1`, `v2`, and `v3`,
- `Results.tsx` calls `/api/search/search` for manual SQL execution, but that route is not present in the current blueprint,
- `Results.tsx` calls `/api/search/export_xml`, but that route is not present in the current blueprint,
- the semantic streaming route exists but is not the primary chat path used by `ChatPanel.tsx`.

This is one of the clearest areas of architectural drift in the repository.

### 9.4 Legacy browser-side AI integrations

Not all AI-facing user interactions have been moved into the App Router React surface. Legacy browser-side scripts still exist under `frontend/public/dashboard/js/`, including:

- `chat.js` for label chat,
- `ai_search.js` for search-term assistance,
- `tox.js` for DILI, DICT, DIRI, and PGx fetch flows,
- `faers.js` for FAERS-assisted label review.

The current frontend architecture is therefore hybrid:

- newer module shells are written in React and Next.js,
- some AI-heavy label-detail interactions still depend on legacy public JavaScript.

## 10. Label-level AI workflows outside the search workspace

Search is not the only AI-heavy user flow. The backend exposes several document-grounded analysis features that operate at the level of a single label or a comparison set.

### 10.1 Label chat

`/api/dashboard/ai_chat` accepts:

- user message,
- conversation history,
- XML content,
- optional chat type.

The backend then calls `chat_with_document()`, which constructs a document-grounded system prompt and routes generation through the shared AI handler.

This is the label-level conversational analysis path used outside the newer search workspace.

### 10.2 Search helper

`/api/dashboard/ai_search_help` is a separate assistance workflow. Its purpose is not to answer a clinical labeling question directly, but to help the user produce a search term that matches the search engine’s input expectations.

Architecturally, this is an example of an **AI-assisted UI affordance** rather than a retrieval system.

### 10.3 Comparison summarization

Comparison summarization is implemented through both dashboard and label-comparison module entry points. The core behavior is:

- prepare differing-section content,
- enforce a size threshold,
- call the shared LLM gateway for HTML summary generation,
- cache the result in `ComparisonSummary`.

This is a document-comparison reasoning workflow rather than a search workflow, but it shares the same provider/runtime layer.

### 10.4 Toxicology and PGx assessments

DILI, DICT, DIRI, and PGx assessments follow a similar architectural pattern:

- extract relevant sections from the label XML,
- aggregate those sections into a task-specific prompt context,
- ask the model for a structured report,
- validate or clean the output,
- cache the result in an assessment table.

These workflows are notable because they produce durable cached analysis artifacts, not merely transient chat responses.

### 10.5 FAERS semantic rematching

The FAERS semantic-rematch workflow takes unresolved adverse-event terms and asks the model to decide whether the concept is semantically present in the label despite not matching via direct string search.

This is a hybrid AI pattern:

- deterministic extraction and counting first,
- LLM-based semantic reconciliation second.

## 11. Cross-cutting design characteristics

A few architectural characteristics recur across the AI and search stack.

### 11.1 Grounding-first behavior is uneven but intentional

Some flows are tightly grounded and citation-oriented, especially semantic search. Others are broader document-analysis tasks over raw XML or section aggregates. The suite therefore has a **spectrum of grounding strictness**, not a single grounding model.

### 11.2 Validation is caller-owned

The backend does not enforce one schema layer across all AI outputs. Each feature performs its own cleanup and validation:

- JSON extraction by regex or parser fallback,
- HTML fragment extraction for assessment routes,
- comparison-summary caching after generation,
- semantic-search citation-key generation before answer composition.

### 11.3 AI preferences are persisted at the user layer

User preferences such as `ai_provider` are saved through dashboard preferences routes and read back during generation. However, the execution path is more complete for provider choice than for per-user credential customization.

### 11.4 Search explainability is retrieval-focused

The search stack explicitly emits `reasoning`, `trace_log`, `agent_flow`, and stats. These are retrieval and process explanations, not full reasoning traces.

## 12. Current architectural drift and technical debt

The following issues are already visible from the checked-in code and should be treated as active documentation and implementation caveats.

### 12.1 Consolidating the `/api/search/chat` declaration

The previous duplication of `POST /chat` in `backend/search/blueprint.py` (which registered both JSON chat/search behavior and form-based document chat) has been resolved. The `/chat` endpoint is now consolidated, removing ambiguous handler ownership and simplifying route validation.

### 12.2 Semantic route exists, but the primary App Router UI still uses the simpler chat path

The most advanced search backend path is `search_agentic_stream`, but `frontend/app/search/components/ChatPanel.tsx` currently posts to `/api/search/chat`. That means the semantic agent stack is present but not clearly the default end-user execution path in the new UI.

### 12.3 Frontend/backend contract drift in search routes

The App Router search results code still references backend routes that are not present in the current blueprint, most notably:

- `/api/search/search`,
- `/api/search/export_xml`.

This suggests either incomplete migration or removed backend functionality that the frontend has not yet been updated to match.

### 12.4 Search mode naming drift

The current frontend stores a default `searchMode` of `"semantic"`, while some result-rendering logic still checks for modes like `v1`, `v2`, and `v3`. That is a small but telling sign that the search UI is carrying forward multiple generations of behavior.

### 12.5 Transitional naming remains in comments and structure

Some search files still carry older naming references such as `search_v2_core` or `search_v3_core` in comments or historical structure. The active implementation is now under `semantic_core`, but the naming drift remains visible.

### 12.6 Shared provider layer is ahead of some per-user configuration plumbing

The dashboard preference route persists fields such as provider choice and OpenAI-style configuration values. The shared AI runtime clearly uses provider choice, but the checked-in execution path does not expose an equally mature per-user credential-selection strategy for all stored fields.

### 12.7 Streaming and non-streaming answer composition are parallel rather than unified

The semantic pipeline uses `run_answer_composer()` in non-streaming contexts, but the streaming route reconstructs and streams the answer prompt separately. This is workable, but it creates two answer-generation paths that must remain behaviorally aligned over time.

## 13. Recommended documentation boundaries

This report should be read alongside the following documents:

- `Documents/Overview.md` for system-level purpose and operating model,
- `Documents/Architecture.md` for suite-wide topology and request flow,
- `Documents/Backend.md` for blueprint and service ownership,
- `Documents/Frontend.md` for App Router and legacy-frontend integration,
- `Documents/Database.md` for `labeling` and assessment-table storage details.

The following future docs would make the AI and search area easier to maintain:

- a prompt catalog grouped by feature and output contract,
- a search API contract reference,
- a semantic indexing and embedding refresh document,
- a label-level AI workflows document covering chat, FAERS semantic rematch, DILI, DICT, DIRI, and PGx in more depth.

## 14. Conclusion

The current AskFDALabel AI architecture is best understood as a shared inference platform with multiple feature-specific orchestration layers. The codebase already contains the foundation for grounded semantic retrieval, cited evidence synthesis, and document-scale analysis over SPL labels. At the same time, the search frontend and route surface show clear signs of transition: legacy chat paths, semantic-agent infrastructure, App Router components, and legacy public JavaScript all coexist.

That coexistence is not merely a cleanup concern; it is the defining architectural characteristic of the current AI and search layer. Any future work in this area should therefore treat alignment between provider runtime, route contracts, frontend wiring, and search mode semantics as a first-class maintenance goal.
