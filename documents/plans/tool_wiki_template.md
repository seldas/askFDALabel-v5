# Tool Wiki template

Audience: drug safety scientists and reviewers. Verify the current interface,
backend behavior, and ordinary-user permissions before writing.

## Navigation ownership

Use **tool category → exact catalog tool name → articles**. Each tool article
has one `toolId`; names and workflow categories resolve from the tool registry.
List a tool's usage and methods articles together. Keep Compare, Labeling Visual
Review, Archived Version Track, and FDA Application Profile separate even though
they share a category. Split articles that cover several tools before assigning
ownership; cross-links may point to related tools without merging their guides.

## Usage guide

- **Title and summary:** name the task and expected output.
- **When to use it:** the question the tool helps answer.
- **Start:** entry point, required inputs, and a few steps using actual UI labels.
- **Results:** a short table explaining the main outputs and controls.
- **Keep the result:** supported save/export actions and what they preserve.
- **Before drawing a conclusion:** the tool-specific limits that affect review.

Omit sections that do not apply. Keep each article focused on one task. Link to
existing account, search, and labeling guides rather than repeating them.

## Data and methods (when needed)

Explain source coverage, matching or analysis behavior, interpretation limits,
and the checks needed to support a finding. Keep implementation and deployment
instructions in repository documentation.

## More help (when available)

Link to verified developer-maintained user guides, Wiki, or FAQ. Label the source
and destination clearly. Keep enough guidance in askFDALabel to get started;
do not invent links or add an empty help section when none exists.

## First example: Label Compare

- Guide: `/wiki#compare-guide`
- Methods: `/wiki#comparison-method`
- Checked against `frontend/app/labelcomp/page.tsx`,
  `backend/labelcomp/blueprint.py`, and `backend/labelcomp/compare.py`.
- No separate developer user guide or FAQ identified in the repository.
