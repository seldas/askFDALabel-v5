# Idea: AI Response Annotator & Highlighter Snippet

## Overview
This snippet enhances the interaction with Elsa (the AI chat interface) by automatically prompting the AI to structure its responses with semantic tags and then visually highlighting those terms in the UI.

## Core Mechanism

### 1. Prompt Interception (Input)
- **Trigger**: When the user submits a message while the snippet is active.
- **Action**: The snippet hooks into the submission process and appends a "System Instruction" suffix to the user's prompt.
- **Appended Instruction**:
  > "Important: In your response, please wrap specific entities with `<annotation class="CATEGORY">text</annotation>` tags. 
  > Use the following categories:
  > - `drug`: For medication names and active ingredients.
  > - `adverse_events`: For side effects, toxicities, or clinical symptoms.
  > - `temporal`: For durations, frequencies, or time-points (e.g., '3 days', 'twice daily').
  > - `company`: For pharmaceutical manufacturers or organizations."

### 2. UI Monitoring (Output)
- **Trigger**: New message elements appearing in the chat container.
- **Action**: Use a `MutationObserver` to detect when the AI completes a message or as it streams content.
- **Processing**: 
  - Scan the text for `<annotation class="...">` patterns.
  - Convert these tags into styled HTML elements (e.g., `<span>` with specific CSS classes).

### 3. Visual Styling
The snippet will inject a CSS block to style the highlighted terms:
- `.highlight-drug`: Blue/Cyan background with subtle border.
- `.highlight-adverse_events`: Red/Orange tint to signify clinical importance.
- `.highlight-temporal`: Green/Yellow tint for scheduling/timing.
- `.highlight-company`: Purple/Grey for organizational entities.

## Technical Architecture

### File Structure
- `public/snippets/highlights/index.js`: Main logic for prompt hooking and DOM observation.
- `public/snippets/highlights/style.css`: Visual definitions for the annotation classes.

### Integration in Snippet App
- A short loader script will fetch the snippet and initialize the `MutationObserver`.
- The snippet will expose a `toggle()` method to enable/disable the prompt modification.

## Benefits
- **Improved Scannability**: Professionals can quickly identify key drug names and toxicities.
- **Contextual Awareness**: Encourages the AI to be more precise about temporal data.
- **Zero Backend Change**: No modification needed to the core backend API; all logic resides in the snippet layer.
