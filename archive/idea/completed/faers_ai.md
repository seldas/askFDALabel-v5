# FAERS AI Logic Documentation

## Overview
The "Ask AI" functionality in the FAERS dashboard allows users to query the AI about adverse events mentioned in the drug labeling. This documentation outlines the current logic and observed issues.

## Frontend Logic
1. The frontend logic is handled in `frontend/public/dashboard/js/faers.js`.
2. When the "?" button next to a reaction term is clicked, the `window.askAiAboutReaction` function is called.
3. This function checks Local Storage for a cached AI result. If found, it updates the UI with the cached result.
4. If not cached, it makes a fetch request to `/api/dashboard/ai_chat` with a detailed prompt and the XML content of the labeling.

## Backend Logic
1. The backend logic is handled in `backend/dashboard/services/ai_handler.py`.
2. The `/api/dashboard/ai_chat` endpoint is handled by the `chat_with_document` function.
3. This function calls the `call_llm` function, which determines the appropriate LLM to use based on user preferences and system configuration.
4. The `call_llm` function supports multiple LLM providers, including OpenAI, Gemini, and Elsa.
5. The AI model is provided with a system prompt and the user's question, along with the relevant XML content.

## Observed Issues
1. The AI functionality may still be problematic due to historical issues during the transition from a pure Flask architecture to a Next.js + Flask architecture.
2. The `faers.js` file contains complex logic for handling different states of the AI response, including caching and error handling.
3. The backend logic in `ai_handler.py` is flexible and supports multiple LLM providers, but this flexibility might also introduce complexity and potential inconsistencies.

## Next Steps
1. Investigate and address the historical issues that may be causing problems with the AI functionality.
2. Review and potentially simplify the frontend and backend logic to improve maintainability and performance.
3. Test the AI functionality thoroughly across different scenarios and user configurations.