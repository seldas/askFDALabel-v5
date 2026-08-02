import os
import sys
import argparse
import logging
import time
from datetime import datetime

# Add the backend directory to the sys.path
sys.path.append(os.path.join(os.path.dirname(__file__), '..', 'backend'))

# Ensure logs directory exists in project root
PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
LOG_DIR = os.path.join(PROJECT_ROOT, 'logs')
os.makedirs(LOG_DIR, exist_ok=True)
LOG_FILE = os.path.join(LOG_DIR, 'tox_update.log')

# Manual SQLAlchemy setup for standalone usage
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, scoped_session
from dashboard.config import Config
from database.models import ToxAgent
from database.extensions import db
from dashboard.services.fdalabel_db import FDALabelDBService
from dashboard.services.fda_client import get_label_xml
from dashboard.services.ai_handler import generate_assessment
from dashboard.prompts import DILI_prompt, DICT_prompt, DIRI_prompt
from dashboard import create_app
import re

# Configure Logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler(LOG_FILE),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

# Initialize standalone session
engine = create_engine(Config.SQLALCHEMY_DATABASE_URI)
Session = scoped_session(sessionmaker(bind=engine))
# Patch the db.session to use our standalone session for models
db.session = Session

# Create a minimal app context for services that might still depend on current_app
app = create_app()
app.app_context().push()

class MockUser:
    """Mocks a user object for AI provider preference."""
    def __init__(self, provider):
        self.ai_provider = provider
        self.is_authenticated = True

def fetch_target_labels():
    """Fetches target labels from FDALabel Oracle DB."""
    if not FDALabelDBService.check_connectivity():
        logger.error("FDALabel Database not connected.")
        return []

    conn = FDALabelDBService.get_connection()
    if not conn:
        return []

    cursor = conn.cursor()
    try:
        # SQL to get latest version of PLR Human RX drugs with single ingredients
        sql = """
            SELECT l.SET_ID, l.PRODUCT_NAMES, l.PRODUCT_NORMD_GENERIC_NAMES, l.AUTHOR_ORG_NORMD_NAME, l.EFF_TIME, l.FORMAT_GROUP
            FROM (
                SELECT SET_ID, PRODUCT_NAMES, PRODUCT_NORMD_GENERIC_NAMES, AUTHOR_ORG_NORMD_NAME, EFF_TIME, FORMAT_GROUP,
                       ROW_NUMBER() OVER (PARTITION BY SET_ID ORDER BY EFF_TIME DESC) as rn
                FROM druglabel.dgv_sum_rx_spl
                WHERE document_type_loinc_code in ('34390-5', '34391-3', '45129-4')
                    AND format_group = 1
                    AND num_act_ingrs = 1
            ) l
            WHERE l.rn = 1
            ORDER BY l.EFF_TIME DESC
        """
        cursor.execute(sql)
        rows = cursor.fetchall()
        
        labels = []
        for row in rows:
            labels.append({
                'set_id': row[0],
                'brand_name': row[1],
                'generic_name': row[2],
                'manufacturer': row[3],
                'eff_time': row[4],
                'is_plr': row[5]
            })
        return labels
    except Exception as e:
        logger.error(f"Error fetching target labels: {e}")
        return []
    finally:
        cursor.close()
        conn.close()

def clean_ai_report(response_text):
    """Extracts the clean HTML block from the AI response."""
    if not response_text:
        return '<!-- AI response was empty. -->'
        
    html_matches = re.findall(r'(<div class="label-section">[\s\S]*?</div>)', response_text, re.DOTALL)
    if html_matches:
        return "\n".join(html_matches)
    
    if '<!-- No DILI evidence found' in response_text or '<!-- No DICT evidence found' in response_text or '<!-- No DIRI evidence found' in response_text:
        return response_text # Keep the comment
        
    return '<!-- AI response did not contain valid HTML report. -->'

def process_label(label, user=None):
    """Processes a single label: fetch XML, run assessments, and save to DB."""
    set_id = label['set_id']
    session = Session()
    
    try:
        # Check if this EXACT version is already processed and is 'current'
        existing_current = session.query(ToxAgent).filter_by(set_id=set_id, current='Yes').first()
        
        if existing_current and existing_current.spl_effective_time == label['eff_time']:
            logger.info(f"Skipping {set_id}, current version is already up to date.")
            return False

        # If we reach here, it's either a brand new set_id or a new version of an existing one
        logger.info(f"Processing {set_id} ({label['brand_name']})...")
        
        # 1. Get XML
        xml_content = get_label_xml(set_id)
        if not xml_content:
            logger.warning(f"Could not retrieve XML for {set_id}")
            return False

        try:
            # Run AI Assessments
            dili_raw = generate_assessment(user, DILI_prompt, xml_content)
            dili_report = clean_ai_report(dili_raw)
            
            dict_raw = generate_assessment(user, DICT_prompt, xml_content)
            dict_report = clean_ai_report(dict_raw)
            
            diri_raw = generate_assessment(user, DIRI_prompt, xml_content)
            diri_report = clean_ai_report(diri_raw)
            
            # If there was a previous 'current' record, mark all as 'No'
            session.query(ToxAgent).filter_by(set_id=set_id).update({"current": "No"})
            
            # Add the new record as 'Yes'
            new_agent = ToxAgent(
                set_id=set_id,
                is_plr=label['is_plr'],
                brand_name=label['brand_name'],
                generic_name=label['generic_name'],
                manufacturer=label['manufacturer'],
                spl_effective_time=label['eff_time'],
                dili_report=dili_report,
                dict_report=dict_report,
                diri_report=diri_report,
                status='completed',
                current='Yes'
            )
            session.add(new_agent)
            
            session.commit()
            logger.info(f"Successfully created new current tox_agent record for {set_id}")
            return True
        except Exception as ai_e:
             logger.error(f"AI Assessment error for {set_id}: {ai_e}")
             session.rollback()
             return False
            
    except Exception as e:
        logger.error(f"Error processing {set_id}: {e}")
        session.rollback()
        return False
    finally:
        Session.remove()

def main():
    parser = argparse.ArgumentParser(description="Update ToxAgent table with pre-computed assessments.")
    parser.add_argument("--test", action="store_true", help="Process only 3 new/updated labels for testing.")
    parser.add_argument("--limit", type=int, default=0, help="Maximum number of labels to process.")
    parser.add_argument("--elsa", action="store_true", help="Use Elsa AI provider.")
    args = parser.parse_args()

    # Ensure tables are created
    ToxAgent.__table__.create(bind=engine, checkfirst=True)
    logger.info("Database tables verified/created.")

    # Set AI provider preference
    user = MockUser('elsa') if args.elsa else None

    logger.info("Fetching target labels from FDALabel...")
    all_labels = fetch_target_labels()
    logger.info(f"Found {len(all_labels)} total target labels.")

    processed_count = 0
    target_count = 3 if args.test else (args.limit if args.limit > 0 else len(all_labels))

    for label in all_labels:
        if processed_count >= target_count:
            break
            
        if process_label(label, user=user):
            processed_count += 1
            # Rate limiting delay
            if processed_count < target_count:
                logger.info("Waiting 3 seconds before next request...")
                time.sleep(3)

    logger.info(f"Batch update completed. Processed {processed_count} labels.")

if __name__ == "__main__":
    main()
