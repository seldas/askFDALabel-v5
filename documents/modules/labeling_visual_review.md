# Labeling Visual Review

## Purpose and entry points

`/image-review` is a standalone artwork review workbench. The tool registry exposes it in navigation, the tools directory, label toolboxes, and label-selection workflows. LabelComp also links into the workbench. Launch URLs accept up to two repeated `set_ids` and positionally matched `spl_ids`; either side can then select a specific carton, container label, IFU image, or upload.

All UI and review prompts use English. Access uses the `tool_image_review` feature in the backend catalog, frontend registry, and page gate. The default allows personal user accounts and above; guest review creation is excluded because results belong to an account.

## Review modes

| Mode | Review question |
|---|---|
| Artwork Comparison | What visible content/design changed, and could the change matter during medication use? |
| Product Confusion | Do shared visual features obscure important product distinctions, such as name, strength, concentration, or route? |
| Labeling Consistency | Does each image agree with its own labeling reference? Are shared details consistent where product identity and presentation justify comparison? |

Potential medication-error mechanisms are requested in all modes. A signal is a review concern, not proof of a medication error, an error probability, or a clinical safety conclusion.

## Interaction

Reviews now start with a lightweight visual overview using 1,024-pixel JPEG inputs, a short prompt without full labeling text, and a 1,800-token response budget. The model returns 3–5 supported key observations and decides whether corresponding artwork elements exist. If the images are fundamentally different, the task finishes with: "These two images are too different; a detailed point-to-point comparison is not available." Color, strength, crop, and scale differences alone do not justify this decision.

For comparable images, the overview becomes visible while a second pass runs. Detail uses 1,536-pixel inputs, up to 24,000 characters of reference text per side, and a 5,000-token budget. The overview request uses a 45-second timeout; detail uses 90 seconds. Both disable SDK retries and provider fallback. These are provider request timeouts, not guaranteed end-to-end latency, which also includes queueing. If detail times out or returns invalid output, the completed task retains the overview with an explicit limitation; rerunning retries detail. Overview results do not claim localization or image–labeling consistency assessment. The interface displays elapsed time and distinguishes waiting for a worker from active analysis.

Two viewers support fit-to-view, independent or synchronized zoom, and numbered overlays. Selecting a finding locates the corresponding regions. Global theme-color changes are requested as a single finding with one representative region per side; duplicate global color observations without separate risk mechanisms are merged defensively. Safety-specific color/contrast concerns can remain separate.

Findings include visible evidence, category, priority, evidence confidence, potential error mechanism, and verified labeling quotations when available. Reviewers can confirm/dismiss findings, write notes, and adjust or remove highlight rectangles in normalized percentage coordinates. Dismissed findings retain their record but stop drawing overlays.

Export JSON preserves findings, source identifiers/hashes, modified regions, and reviewer decisions. Export annotated report generates standalone HTML with embedded images, numbered regions, evidence, notes, and limitations. Reports can be printed from a browser. Human edits remain in the browser session until exported; raw AI results remain in the user's SystemTask record and comparison cache.

## Sources and version fidelity

Stored artwork comes from the resolved local ZIP or adjacent artwork file associated with the labeling. Explicit version substitutions and mismatched Set-IDs are rejected. The tool does not use a current DailyMed image to fill a missing historical artifact. If the exact artwork is unavailable locally, users can upload it and associate a labeling reference; that association is explicitly unverified.

Inputs are bounded to 12 MiB each and 25 megapixels, orientation-normalized, composited onto white, and downsampled to a maximum 2,048-pixel edge before model submission. GIF/TIFF inputs use the first frame/page; multipage documents are not reviewed in full. Reference sections retain titles and are limited to 90,000 characters per side; truncation is reported. Labeling Consistency requires at least one reference and marks missing references as not assessed.

## Backend and operations

- `GET /api/image-review/labels/<set_id>/images`: discover artwork for optional `spl_id`.
- `GET /api/image-review/labels/<set_id>/images/<image_id>`: serve normalized local artwork.
- `POST /api/image-review/reviews`: multipart `mode`, JSON `left`/`right` descriptors, optional `left_upload`/`right_upload`; returns a SystemTask ID with HTTP 202.
- `GET /api/image-review/reviews/<task_id>`: owner-only progress/results, including an overview during processing.

Review execution uses the existing generic Celery task dispatcher. API-side dispatch uses a producer client and never imports the worker application or repeats schema initialization. Broker failures mark the task failed instead of leaving it pending. Feature-gate defaults are seeded with atomic conflict-ignore inserts so concurrent API/Celery startup cannot race on `ix_feature_gate_key`; existing account rules are retained. Both API and Celery workers must share `UPLOAD_FOLDER` (the standard Docker `/data` bind already does). Pending inputs live in `uploads/image-review/<uuid>` and are removed on task completion/failure or dispatch failure. If a worker never consumes a queued task, inputs remain until the worker runs; account-level concurrent reviews are limited to one pending/processing task.

Vision calls use the existing AI provider routing and usage recording. The current shared `call_llm` image path supports OpenAI-compatible (`llama`, including normalized vLLM/Ollama/custom endpoints) and Elsa providers; the selected model must itself accept images. Gemini vision is not enabled in that shared path. Failures are surfaced to the reviewer rather than falling back to text-only analysis.

The cache key includes account, model/provider, mode, prompt version, artwork hashes, reference hashes, and label/source metadata. Structured output validates finite bounded localized rectangles and checks labeling quotations against the supplied text. Invalid rectangles are omitted and unverified conflicts downgraded. No arbitrary image URLs, executable model HTML, or SQL are accepted.

## Current limits and validation

This first version uses multimodal AI for text interpretation, semantic matching, and estimated localization. It does not implement independent OCR, geometric registration, a calibrated confusion score, physical print-size assessment, or automatic database-wide discovery of look-alike products. Low-resolution images and estimated boxes require visual confirmation.

Verification exercised real Flask endpoints against an isolated SQLite fixture and simulated vision responses, plus the actual Next.js page in the browser using production-style base prefixes. Covered all three modes, upload/selection, version refusal, auth/guest gates, ownership, caching, color grouping, coordinate/evidence validation, decisions/region adjustments, and JSON/embedded-image report exports. Real production PostgreSQL/Oracle, Celery broker execution, and a real vision provider remain to be validated on a configured deployment.
