import json
import hashlib
from datetime import datetime
from database import db, ComparisonSummary
from dashboard.services.ai_handler import call_llm

def get_comparison_summary(user, set_ids, comparison_data, label_names, force_refresh=False):
    """
    Fetches a cached comparison summary or generates a new one.
    """
    if not set_ids:
        return None
    
    # 1. Check Cache
    sorted_ids = sorted(set_ids)
    ids_str = json.dumps(sorted_ids)
    ids_hash = hashlib.sha256(ids_str.encode('utf-8')).hexdigest()
    
    if not force_refresh:
        cached = ComparisonSummary.query.filter_by(set_ids_hash=ids_hash).first()
        if cached:
            return cached.summary_content

    # 2. Prepare data for AI
    differing_sections = []
    total_chars = 0
    MAX_CHARS_FOR_AI = 100000 # 100k chars limit to prevent timeout

    for section in comparison_data:
        if 'contents' in section:
            if section.get('is_same') is True or section.get('is_empty') is True:
                continue
            contents = [c or 'N/A' for c in section.get('contents', [])]
            differing_sections.append({
                'title': section.get('title'),
                'contents': contents
            })
            total_chars += sum(len(c) for c in contents)

        # Backward compatibility for content1/content2
        elif 'content1' in section and 'content2' in section:
            c1 = section.get('content1') or 'N/A'
            c2 = section.get('content2') or 'N/A'
            differing_sections.append({
                'title': section.get('title'),
                'contents': [c1, c2]
            })
            total_chars += len(c1) + len(c2)
        # Or the full format from backend (contents list)
        elif not section.get('is_same') and not section.get('is_empty'):
            contents = section.get('contents', [])
            if contents:
                c_list = [c or 'N/A' for c in contents]
                differing_sections.append({
                    'title': section.get('title'),
                    'contents': c_list
                })
                total_chars += sum(len(c) for c in c_list)

    if not differing_sections:
        return "<p>No substantive differences were identified between the labels for comparison.</p>"

    # 3. Handle data volume limit
    if total_chars > MAX_CHARS_FOR_AI:
        return f"""
            <div style="padding: 1.5rem; background-color: #fff7ed; border: 1px solid #fed7aa; border-radius: 12px; color: #9a3412;">
                <h3 style="margin-top: 0; color: #9a3412;">Comparison Data Too Large</h3>
                <p>These labeling documents contain a very large amount of differing content ({total_chars:,} characters), which exceeds our automated reasoning limit.</p>
                <p>To analyze these differences, please use the <strong>Export</strong> button below to download the comparison data as a JSON file, which you can then upload to <strong>ELSA</strong> or other specialized analysis tools.</p>
            </div>
        """

    # 4. Generate via AI
    try:
        summary_content = summarize_comparison_logic(user, differing_sections, label_names)
    except Exception as e:
        print(f"AI Summary Error: {str(e)}")
        return f"""
            <div style="padding: 1.5rem; background-color: #fef2f2; border: 1px solid #fee2e2; border-radius: 12px; color: #991b1b;">
                <h3 style="margin-top: 0; color: #991b1b;">AI Analysis Interrupted</h3>
                <p>We encountered an issue while generating the clinical summary (likely a timeout due to complex content).</p>
                <p>Please use the <strong>Export</strong> button to download the raw comparison data for review in <strong>ELSA</strong>.</p>
            </div>
        """
    
    # 5. Update Cache
    existing = ComparisonSummary.query.filter_by(set_ids_hash=ids_hash).first()
    if existing:
        existing.summary_content = summary_content
        existing.timestamp = datetime.utcnow()
    else:
        new_summary = ComparisonSummary(
            set_ids_hash=ids_hash,
            set_ids=ids_str,
            summary_content=summary_content
        )
        db.session.add(new_summary)
    
    db.session.commit()
    return summary_content

def summarize_comparison_logic(user, differing_sections, label_names):
    """
    The actual AI prompt and call logic. Supports multiple labels.
    """
    summary_parts = []
    for section in differing_sections:
        title = section.get('title', 'Unknown Section')
        contents = section.get('contents', [])
        
        summary_parts.append(f"--- Section: {title} ---\n")
        for idx, content in enumerate(contents):
            label_name = label_names[idx] if idx < len(label_names) else f"Label {idx+1}"
            summary_parts.append(f"{label_name}:\n{content}\n\n")

    combined_diff_text = "".join(summary_parts)
    
    label_list_str = ", ".join([f"'{n}'" for n in label_names])
    num_labels = len(label_names)

    system_prompt = f"""
        You are an expert AI analyst for the FDA. Your sole function is to identify and summarize the key substantive differences between {num_labels} drug labeling documents.

        **Core Task:**
        1.  Analyze the provided text, which contains the content of {num_labels} different drug labels: {label_list_str}.
        2.  Identify the most critical differences, focusing on safety, efficacy, indications, contraindications, and warnings.
        3.  Generate a concise "Overall Critical Differences" executive summary.
        4.  Generate a section-by-section summary of notable differences.

        **CRITICAL OUTPUT FORMATTING RULES:**
        -   Your response MUST be ONLY raw HTML.
        -   DO NOT include any preamble, explanation, conversational text, or markdown code blocks (```html). Your response must start directly with the <h3> tag.

        The entire output must follow this exact structure:
        <h3>Overall Critical Differences</h3>
        <ul>
            <li>A summary of the most important difference between the versions.</li>
            <li>Another key difference summary.</li>
        </ul>

        <div class="summary-section">
            <h4>[Section Name, e.g., Indications and Usage]</h4>
            <ul>
                <li>Detail of a difference found in this section across the labels.</li>
            </ul>
        </div>

        If a section has no significant differences, DO NOT include a heading for it.
        If there are no differences at all, output only: <p>No substantive differences were identified between the labels.</p> 
    """
    
    user_message = (
        f"Compare the drug labels for {label_list_str}. "
        f"Generate the HTML summary based on the content below.\n\n"
        f"--- DOCUMENT CONTENT ---\n{combined_diff_text}"
    )
    
    return call_llm(user, system_prompt, user_message)
