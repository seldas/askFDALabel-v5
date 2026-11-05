# Visual Analysis

Visual Analysis is the single image-tool entry in `frontend/app/platform/registry.ts`.
The existing `/image-review` URL remains canonical; old label-workspace
`image-analysis` URLs redirect with their selected image and SPL version intact.
The label reader adds an action to each available SPL image that opens this tool
in a new window with Read Image selected.

## Layout and state

The workbench has three visible steps: choose a task, prepare images, view results.
The four tasks are Read Image, Labeling Consistency, Artwork Comparison, and
Product Confusion. Their display definitions live in `image-review/types.ts`.
Only the task chooser expands to show all four descriptions. Preparing images
has no empty findings sidebar. A single primary action sits beside the step
navigation. Image-source controls collapse once an image loads; reference IDs,
view options, extracted text, comments, and exports are disclosures.

The image panels stay mounted when switching tasks or opening history. Single-image
tasks hide the second panel without discarding its selection. Each review task
retains its own result, selected finding, and decisions within the workbench;
changing an input invalidates dependent results. Read Image retains its result
independently. Results begin with a summary and compact findings; evidence appears
only after selecting a finding. The layout stacks at smaller widths.

## Permission migration

`tool_visual_analysis` controls all four tasks, media endpoints, reading endpoints,
and Celery execution. Startup seeds its row from the union of the previous
`tool_image_analysis` and `tool_image_review` gates: the lower minimum role wins;
guest access carries over only if a legacy gate actually allowed the user-role
guest. Existing unified settings are never overwritten by a subsequent startup.
Old rows remain for migration/rollback, but only the new entry appears in Function
Control. Old keys resolve to the new gate and remain aliases in the session for
older clients. Gate resolution remains per request, with no process-level cache.

Personal accounts retain queued reviews, saved artwork, history, comments, and
exports. The shared guest can run every analysis when authorized, but reviews and
image identification return synchronously without creating SystemTask rows, saved
images, personal history, or comments. Product-confusion confirmations use expiring,
signed records bound to the identified side and image hash; changing an image
requires identification again. Guest readings also avoid persisted reading caches.

## Backend compatibility

Read Image reuses the existing image-reading prompt and cache for personal
accounts. `/api/image-analysis/read` accepts validated uploads with the same
orientation and transparency normalization as reviews. Legacy image-analysis
API URLs remain available behind the unified gate. Existing saved readings load
with their source image; historical review records remain readable in History.
The older simple comparison UI is removed in favor of Artwork Comparison.

Real review execution still requires the existing vision-capable provider and,
for personal accounts, Celery. UI validation with fixture responses does not
substitute for checking the configured deployment and its actual SPL storage.
