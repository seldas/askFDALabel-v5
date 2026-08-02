from dashboard.services.ai_handler import call_llm
from typing import Optional, Any

# Fixed system prompt to guide the LLM with clinical annotation
SYSTEM_PROMPT = """
You are a highly specialized FDA drug labeling assistant.
Restrict your responses to topics related to labeling analysis or study only.
If the user's query is out of scope, return 'out-of-scope'.

In your response, you MUST wrap specific entities with custom XML tags for downstream processing and highlighting.
Categories to tag:
1. <annotation class="drug">Drug Name</annotation> - For all medication and substance names.
2. <annotation class="adverse_events">Reaction</annotation> - For symptoms, side effects, or medical conditions.
3. <annotation class="ndc">NDC Code</annotation> - For National Drug Codes (e.g., "12345-678-90").
4. <annotation class="temporal">Time</annotation> - For durations, dates, or frequencies (e.g., "5 days", "daily").

Example: "The <annotation class="drug">Aspirin</annotation> label (NDC: <annotation class="ndc">0024-0335-01</annotation>) lists <annotation class="adverse_events">headache</annotation> as a side effect lasting <annotation class="temporal">2 days</annotation>."
Do not explain these tags to the user.
"""

def search_general(user_input: str, user: Optional[Any] = None, filters: Optional[dict] = None, history: Optional[list] = None, is_failed_keyword: bool = False) -> str:
    try:
        # Construct the context from filters if available
        system_prompt = SYSTEM_PROMPT
        if is_failed_keyword:
            system_prompt += "\n\nCRITICAL INSTRUCTION: The user searched for a keyword but found no records in the database. It is highly likely they made a typo. Please politely inform them no results were found, then suggest the correctly spelled drug name, identifier, or keyword. You MUST wrap your suggested correction in an <annotation class=\"drug\"> tag so it can be clicked by the user to trigger a new search."

        filter_context = ""
        if filters:
            if filters.get("drugNames"):
                filter_context += f"\nActive Drug Filters: {', '.join(filters['drugNames'])}"
            if filters.get("adverseEvents"):
                filter_context += f"\nActive Adverse Event Filters: {', '.join(filters['adverseEvents'])}"
            if filters.get("ndcs"):
                filter_context += f"\nActive NDC Filters: {', '.join(filters['ndcs'])}"
            
            # Focus instructions for Rx/RLD
            if filters.get("isRx") or filters.get("isRLD"):
                focus_parts = []
                if filters.get("isRx"): focus_parts.append("Human Prescription drugs")
                if filters.get("isRLD"): focus_parts.append("Reference Listed Drugs (RLD)")
                filter_context += f"\nNote: Your response should focus on {' and '.join(focus_parts)} if available."

        user_message = user_input
        if filter_context:
            user_message = f"User Query: {user_input}\nContext from Active Filters: {filter_context}"

        response_text = call_llm(
            user=user,
            system_prompt=system_prompt,
            user_message=user_message,
            history=history,
            temperature=0.0
        )
        return response_text
    except Exception as e:
        return f"Error generating answer: {str(e)}"

# Example usage
if __name__ == "__main__":
    user_input = "What are the common adverse reactions for Drug X?"
    print(search_general(user_input))

