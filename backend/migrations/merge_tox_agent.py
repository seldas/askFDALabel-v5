import re
from app import create_unified_app
from database.models import db, ToxAgent, DrugToxicity
from sqlalchemy import text
from bs4 import BeautifulSoup

def extract_conclusion(html_content):
    if not html_content or '<div class="label-section">' not in html_content:
        raise ValueError("Invalid LLM output format. Generation failed.")

    soup = BeautifulSoup(html_content, "html.parser")
    text = soup.get_text(" ", strip=True).lower()

    # DILI checks
    if "most dili concern" in text:
        return "Most"
    if "less dili concern" in text:
        return "Less"
    if "no dili concern" in text:
        return "No"

    # DICT checks
    if "most dict concern" in text:
        return "Most"
    if "less dict concern" in text:
        return "Less"
    if "no dict concern" in text:
        return "No"

    # DIRI checks
    if "most diri concern" in text:
        return "Most"
    if "less diri concern" in text:
        return "Less"
    if "no diri concern" in text:
        return "No"

    # Precaution checks
    if "precaution" in text:
        return "Precaution"

    # General / partial matches
    if "most" in text and "concern" in text:
        return "Most"
    if "less" in text and "concern" in text:
        return "Less"
    if "no" in text and "concern" in text:
        return "No"

    # Fallback from DILI score badges
    scores = [int(s) for s in re.findall(r'badge-score-(\d+)|score:\s*(\d+)', html_content, re.I) for s in s if s]
    if scores and max(scores) > 3:
        return "Most"
    if scores:
        return "Less"

    # Fallback from DICT level badges
    if "badge-score-severe" in html_content.lower():
        return "Most"
    if "badge-score-moderate" in html_content.lower() or "badge-score-mild" in html_content.lower():
        return "Less"

    # Fallback from DIRI level badges
    if "badge-score-certain" in html_content.lower():
        return "Most"
    if "badge-score-possible" in html_content.lower():
        return "Less"

    # Last resort fallback if we see the words in conclusion text
    if "severe" in text:
        return "Most"
    if "certain" in text:
        return "Most"
    if "moderate" in text or "mild" in text or "possible" in text:
        return "Less"

    raise ValueError("Could not parse toxicity conclusion from LLM output.")

def merge_tox_agent():
    app = create_unified_app()
    with app.app_context():
        # Iterate over ToxAgent records
        agents = ToxAgent.query.all()
        inserted_count = 0
        for agent in agents:
            # We want to create drug_toxicity records for each report
            
            reports = [
                ('DILI', agent.dili_report),
                ('DICT', agent.dict_report),
                ('DIRI', agent.diri_report)
            ]
            
            for tox_type, report in reports:
                if report and report.strip():
                    conclusion = extract_conclusion(report)
                    
                    new_rec = DrugToxicity(
                        SETID=agent.set_id,
                        Trade_Name=agent.brand_name,
                        Generic_Proper_Names=agent.generic_name,
                        Author_Organization=agent.manufacturer,
                        Tox_Type=tox_type,
                        SPL_Effective_Time=agent.spl_effective_time,
                        is_historical=0,
                        Toxicity_Class=conclusion,
                        AI_Summary=report,
                        endpoint="migrated",
                        Update_Notes="Migrated from ToxAgent"
                    )
                    db.session.add(new_rec)
                    inserted_count += 1
        
        db.session.commit()
        print(f"Migrated {inserted_count} reports from ToxAgent to drug_toxicity.")
        
        # Now drop the tables and the Changed column
        try:
            db.session.execute(text('ALTER TABLE drug_toxicity DROP COLUMN IF EXISTS "Changed";'))
            db.session.execute(text('DROP TABLE IF EXISTS tox_agent CASCADE;'))
            db.session.execute(text('DROP TABLE IF EXISTS dili_assessment CASCADE;'))
            db.session.execute(text('DROP TABLE IF EXISTS dict_assessment CASCADE;'))
            db.session.execute(text('DROP TABLE IF EXISTS diri_assessment CASCADE;'))
            db.session.commit()
            print("Dropped legacy tables and Changed column successfully.")
        except Exception as e:
            db.session.rollback()
            print(f"Error dropping tables: {e}")

if __name__ == '__main__':
    merge_tox_agent()
