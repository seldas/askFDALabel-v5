import os
import sys
import argparse
from datetime import datetime
from zoneinfo import ZoneInfo
from pathlib import Path
from sqlalchemy import text, inspect
import re
import uuid
import pandas as pd

# Add backend to path
backend_dir = Path(__file__).resolve().parent.parent.parent
sys.path.append(str(backend_dir))

from database import db, DrugToxicity, SystemTask
from dashboard import create_app
from dashboard.services.fdalabel_db import FDALabelDBService
from dashboard.services.ai_handler import generate_assessment
from dashboard.prompts import DILI_prompt, DICT_prompt, DIRI_prompt
from bs4 import BeautifulSoup


ENDPOINTS = ("DILI", "DICT", "DIRI")

def log_info(message):
    print(f"  [i] {message}", flush=True)

def log_ok(message):
    print(f"  [OK] {message}", flush=True)

def log_skip(message):
    print(f"  [SKIP] {message}", flush=True)

def log_warn(message):
    print(f"  [WARN] {message}", flush=True)

def log_error(message):
    print(f"  [ERROR] {message}", flush=True)

def get_active_endpoint_status(set_id):
    """Return active DrugToxicity endpoints already written for this SETID.

    This is the resume-safety check. If the process is interrupted after DILI
    succeeds but before DICT/DIRI complete, the next run skips DILI and resumes
    with the missing endpoints.
    """
    rows = (
        db.session.query(DrugToxicity.Tox_Type)
        .filter(DrugToxicity.SETID == set_id)
        .filter(DrugToxicity.is_historical == 0)
        .filter(DrugToxicity.Tox_Type.in_(ENDPOINTS))
        .all()
    )
    return {row[0] for row in rows if row and row[0]}

def endpoint_is_written(set_id, tox_type):
    return (
        db.session.query(DrugToxicity)
        .filter(DrugToxicity.SETID == set_id)
        .filter(DrugToxicity.Tox_Type == tox_type)
        .filter(DrugToxicity.is_historical == 0)
        .first()
        is not None
    )

def mark_previous_endpoint_historical(new_rec):
    """Mark older active rows historical only after the replacement row exists.

    This avoids leaving a SETID with no active rows if generation is interrupted.
    The update is endpoint-scoped, so a DILI failure cannot alter DICT/DIRI rows.
    """
    db.session.flush()
    mapper = inspect(DrugToxicity)
    pk_cols = mapper.primary_key

    query = DrugToxicity.query.filter(DrugToxicity.SETID == new_rec.SETID).filter(
        DrugToxicity.Tox_Type == new_rec.Tox_Type
    )

    for pk_col in pk_cols:
        new_pk_value = getattr(new_rec, pk_col.key, None)
        if new_pk_value is not None:
            query = query.filter(pk_col != new_pk_value)

    query.update({DrugToxicity.is_historical: 1}, synchronize_session=False)
    new_rec.is_historical = 0

def format_endpoint_status(active_endpoints):
    return " | ".join(
        f"{tox_type}:{'done' if tox_type in active_endpoints else 'pending'}"
        for tox_type in ENDPOINTS
    )

def update_progress(task_id, progress, message=None, status='processing'):
    if not task_id: return
    try:
        task = db.session.get(SystemTask, task_id)
        if task:
            if task.status == 'cancelled':
                import sys
                sys.exit(0)
                
            task.progress = progress
            if message: task.message = message
            task.status = status
            task.updated_at = datetime.now(ZoneInfo("America/Chicago")).replace(tzinfo=None)
            if status == 'completed': task.completed_at = datetime.now(ZoneInfo("America/Chicago")).replace(tzinfo=None)
            db.session.commit()
    except Exception as e:
        print(f"Error updating progress: {e}")

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

def extract_summary(html_content):
    if not html_content:
        return "No summary provided."
    match = re.search(r'<div class="toxicity-summary">\s*<strong>Summary:</strong>\s*(.*?)</div>', html_content, re.IGNORECASE | re.DOTALL)
    if match:
        return match.group(1).strip()
    return "No summary provided."

from dashboard.services.fda_client import get_label_xml
try:
    import defusedxml.ElementTree as ET
except ImportError:
    import xml.etree.ElementTree as ET

def get_target_sections_content(set_id, spl_id, force_local=False):
    # get_label_xml/FDALabelDBService can print Oracle config for every label.
    # Keep the batch log readable by suppressing that noise unless DRUGTOX_VERBOSE_DB=1.
    if os.environ.get("DRUGTOX_VERBOSE_DB") == "1":
        xml_content = get_label_xml(set_id, spl_id=spl_id, force_local=force_local)
    else:
        from contextlib import redirect_stdout
        from io import StringIO
        with redirect_stdout(StringIO()):
            xml_content = get_label_xml(set_id, spl_id=spl_id, force_local=force_local)
    if not xml_content:
        return ""

    # LOINC codes for Boxed Warning, Contraindications, Warnings, Adverse Reactions, Drug Interactions, Specific Populations
    try:
        ns = {'v3': 'urn:hl7-org:v3'}
        xml_string_cleaned = xml_content.encode('ascii', 'ignore').decode('ascii')
        root = ET.fromstring(xml_string_cleaned)

        target_code_map = {
            '34066-1': 'Boxed Warning',
            '34070-3': 'Contraindications',
            '34071-1': 'Warnings and Precautions',
            '43685-7': 'Warnings and Precautions',
            '34084-4': 'Adverse Reactions',
            '34073-7': 'Drug Interactions',
            '43684-0': 'Use in Specific Populations'
        }

        aggregated_parts = []
        processed_ids = set()

        for section in root.findall(".//v3:section", ns):
            code_el = section.find("v3:code", ns)
            if code_el is None:
                continue

            code_val = code_el.get('code')
            if code_val not in target_code_map:
                continue

            sec_id = section.get('ID', str(uuid.uuid4()))
            if sec_id in processed_ids:
                continue
            processed_ids.add(sec_id)

            section_name = target_code_map[code_val]
            text_content = " ".join("".join(section.itertext()).split()).strip()

            if len(text_content) > 10:
                aggregated_parts.append(f"### {section_name}\n{text_content}")

        highlights_text = []
        for excerpt in root.findall(".//v3:excerpt", ns):
            for hl in excerpt.findall(".//v3:highlight", ns):
                hl_text = " ".join("".join(hl.itertext()).split()).strip()
                if hl_text:
                    highlights_text.append(hl_text)
        
        if highlights_text:
            aggregated_parts.insert(0, f"### Highlights of Prescribing Information\n" + "\n".join(highlights_text))

        return "\n\n".join(aggregated_parts)
    except Exception as e:
        print(f"Error extracting sections for {set_id}: {e}")
        return ""

def generate_drugtox():
    parser = argparse.ArgumentParser(description='Dynamically Generate DrugToxicity data')
    parser.add_argument('--task-id', type=int)
    parser.add_argument('--local', action='store_true', help='Force use of local Postgres DB instead of Oracle')
    parser.add_argument('--force', action='store_true', help='Force update')
    args = parser.parse_args()

    app = create_app()
    with app.app_context():
        task_id = args.task_id
        try:
            print(f"=== DrugTox AI Generator (Task-Enabled) ===")
            log_info(f"Started at: {datetime.now(ZoneInfo('America/Chicago')).replace(tzinfo=None)}")
            update_progress(task_id, 5, "Initializing DrugTox generation...")
            
            # 1. Fetch existing set_ids and their latest revised_date from DrugToxicity
            log_info("Fetching existing DrugToxicity records...")
            update_progress(task_id, 10, "Fetching existing DrugToxicity records...")
            
            dt_table = DrugToxicity.__tablename__
            existing_query = text(f"""
                SELECT dt."SETID", MAX(REPLACE(s.revised_date, '-', '')) as last_date
                FROM "{dt_table}" dt
                LEFT JOIN labeling.sum_spl s ON LOWER(s.set_id) = LOWER(dt."SETID")
                GROUP BY dt."SETID"
            """)
            existing_records = db.session.execute(existing_query).fetchall()
            existing_map = {row[0].lower(): (row[1] or '0') for row in existing_records if row[0]}
            
            # 2. Fetch single ingredient human Rx labels from FDALabel DB
            log_info("Fetching FDALabel target records...")
            update_progress(task_id, 15, "Fetching FDALabel target records...")
            
            conn = FDALabelDBService.get_connection(force_local=args.local)
            if not conn:
                raise Exception("Failed to connect to FDALabel database")
                
            if not args.local and FDALabelDBService._db_type != 'oracle':
                if hasattr(conn, 'close'):
                    try:
                        conn.close()
                    except: pass
                raise Exception("Failed to connect to primary Oracle database (fell back to Postgres, but --local was not specified)")
                
            cursor = conn.cursor()
            
            if FDALabelDBService._db_type == 'postgres':
                schema = "labeling."
                query = f"""
                    SELECT set_id, spl_id, product_names, generic_names, manufacturer, 
                           revised_date, doc_type, active_ingredients
                    FROM {schema}sum_spl
                    WHERE is_latest = TRUE
                      AND (doc_type ILIKE '%%HUMAN PRESCRIPTION%%' OR doc_type IN ('34391-3', '48401-4', '48402-2'))
                      AND active_ingredients NOT LIKE '%%;%%'
                      AND active_ingredients IS NOT NULL
                      AND active_ingredients != ''
                """
                cursor.execute(query)
                candidates = cursor.fetchall()
                
                if not candidates:
                    df_result = pd.DataFrame(columns=['SETID', 'SPLID', 'Product Name', 'Generic Name', 'Author Organization', 'SPL Effective Time'])
                elif isinstance(candidates[0], dict):
                    df_result = pd.DataFrame(candidates)
                    df_result.rename(columns={
                        'set_id': 'SETID',
                        'spl_id': 'SPLID',
                        'product_names': 'Product Name',
                        'generic_names': 'Generic Name',
                        'manufacturer': 'Author Organization',
                        'revised_date': 'SPL Effective Time'
                    }, inplace=True)
                else:
                    df_result = pd.DataFrame(candidates, columns=['SETID', 'SPLID', 'Product Name', 'Generic Name', 'Author Organization', 'SPL Effective Time', 'doc_type', 'active_ingredients'])
                
                df_result['SPL Effective Time'] = df_result['SPL Effective Time'].fillna('').astype(str).str.replace('-', '')
                df_result.sort_values(by='SPL Effective Time', ascending=False, inplace=True)
                df_toupdate = df_result.drop_duplicates(['Product Name', 'Generic Name', 'Author Organization'])
            else:
                schema = "druglabel."
                query = f"""
                    SELECT l.format_group, l.set_id, l.spl_id, l.product_names, l.PRODUCT_NORMD_GENERIC_NAMES, l.AUTHOR_ORG_NORMD_NAME, l.eff_time
                    FROM {schema}dgv_sum_rx_spl l
                    WHERE l.document_type_loinc_code in ('34390-5', '34391-3', '45129-4')
                      AND l.format_group = 1
                      AND l.num_act_ingrs = 1
                    ORDER BY l.format_group asc, l.eff_time desc
                """
                cursor.execute(query)
                candidates = cursor.fetchall()
                
                if not candidates:
                    df_result = pd.DataFrame(columns=['FORMAT_GROUP', 'SETID', 'SPLID', 'Product Name', 'Generic Name', 'Author Organization', 'SPL Effective Time'])
                else:
                    df_result = pd.DataFrame(candidates, columns=['FORMAT_GROUP', 'SETID', 'SPLID', 'Product Name', 'Generic Name', 'Author Organization', 'SPL Effective Time'])
                
                df_result['SPL Effective Time'] = df_result['SPL Effective Time'].fillna('').astype(str).str.replace('-', '')
                df_toupdate = df_result.drop_duplicates(['Product Name', 'Generic Name', 'Author Organization'])
                
            conn.close()
            
            to_process = []
            
            # Diagnostic counters
            total_candidates = len(df_result)
            not_in_existing = 0
            newer_date = 0
            ignored_same_or_older = 0
            incomplete_existing = 0
            zero_date_in_existing = 0
            
            sample_ignored = []
            sample_incomplete = []
            sample_newer = []
            sample_not_in_existing = []
            
            for index, row in df_toupdate.iterrows():
                set_id = str(row['SETID'])
                spl_id = str(row['SPLID'])
                trade = str(row['Product Name'])
                generic = str(row['Generic Name'])
                mfg = str(row['Author Organization'])
                revised_date = str(row['SPL Effective Time'])
                
                set_id_lower = set_id.lower()
                if set_id_lower not in existing_map:
                    not_in_existing += 1
                    if len(sample_not_in_existing) < 5:
                        sample_not_in_existing.append((set_id, revised_date))
                    to_process.append({
                        'set_id': set_id,
                        'spl_id': spl_id,
                        'revised_date': revised_date,
                        'trade': trade,
                        'generic': generic,
                        'mfg': mfg
                    })
                else:
                    existing_date = existing_map[set_id_lower]
                    if existing_date == '0':
                        zero_date_in_existing += 1
                        
                    if revised_date > existing_date:
                        newer_date += 1
                        if len(sample_newer) < 5:
                            sample_newer.append((set_id, revised_date, existing_date))
                        to_process.append({
                            'set_id': set_id,
                            'spl_id': spl_id,
                            'revised_date': revised_date,
                            'trade': trade,
                            'generic': generic,
                            'mfg': mfg
                        })
                    else:
                        active_endpoints = get_active_endpoint_status(set_id)
                        missing_endpoints = [tox_type for tox_type in ENDPOINTS if tox_type not in active_endpoints]
                        if missing_endpoints:
                            incomplete_existing += 1
                            if len(sample_incomplete) < 5:
                                sample_incomplete.append((set_id, revised_date, existing_date, ",".join(missing_endpoints)))
                            to_process.append({
                                'set_id': set_id,
                                'spl_id': spl_id,
                                'revised_date': revised_date,
                                'trade': trade,
                                'generic': generic,
                                'mfg': mfg
                            })
                        else:
                            ignored_same_or_older += 1
                            if len(sample_ignored) < 5:
                                sample_ignored.append((set_id, revised_date, existing_date))
            
            total_targets = len(to_process)
            
            print("\n=== Candidate Filtering Diagnostics ===")
            print(f"  [d] Total candidates from FDALabel DB: {total_candidates}")
            print(f"  [d] Total distinct SETIDs in existing_map (from drug_toxicity): {len(existing_map)}")
            print(f"  [d] Existing records with zero/null date in existing_map: {zero_date_in_existing}")
            print(f"  [d] Candidates NOT in existing_map (brand new): {not_in_existing}")
            print(f"  [d] Candidates in existing_map but with NEWER date: {newer_date}")
            print(f"  [d] Candidates with same/older date but missing active endpoints: {incomplete_existing}")
            print(f"  [d] Candidates ignored (exists with same or newer date and all endpoints complete): {ignored_same_or_older}")
            
            print("\n  --- Sample Candidates NOT in existing_map ---")
            for s in sample_not_in_existing:
                print(f"    - SETID: {s[0]} (Candidate Date: {s[1]})")
                
            print("\n  --- Sample Candidates with NEWER date ---")
            for s in sample_newer:
                print(f"    - SETID: {s[0]} (Candidate Date: {s[1]}, Existing Date: {s[2]})")
                
            print("\n  --- Sample Candidates with SAME/OLDER date but MISSING endpoints ---")
            for s in sample_incomplete:
                print(f"    - SETID: {s[0]} (Candidate Date: {s[1]}, Existing Date: {s[2]}, Missing: {s[3]})")

            print("\n  --- Sample Candidates IGNORED ---")
            for s in sample_ignored:
                print(f"    - SETID: {s[0]} (Candidate Date: {s[1]}, Existing Date: {s[2]})")
            print("========================================\n")
            
            log_info(f"Found {total_targets} labels needing AI generation or resume checks.")
            update_progress(task_id, 20, f"Found {total_targets} labels needing AI generation.")
            
            if total_targets == 0:
                update_progress(task_id, 100, "No new labels to process. DrugTox generation complete.", status='completed')
                return
                
            # 3. Process targets
            from database import User
            system_user = User.query.filter_by(is_admin=True).first() or User.query.first()
            if system_user:
                system_user.ai_provider = 'llama'
                db.session.commit()
            else:
                system_user = User(username="system_generator_admin", is_admin=True, ai_provider='llama')
                system_user.set_password(os.urandom(8).hex())
                db.session.add(system_user)
                db.session.commit()
            
            completed_count = 0
            endpoint_success_count = 0
            endpoint_skip_count = 0
            endpoint_failure_count = 0
            skipped_no_content_count = 0

            assessments = [
                ('DILI', DILI_prompt),
                ('DICT', DICT_prompt),
                ('DIRI', DIRI_prompt)
            ]

            for i, target in enumerate(to_process, start=1):
                # Check for cancellation
                if (i - 1) % 5 == 0:
                    task = db.session.get(SystemTask, task_id)
                    if task and task.status == 'cancelled':
                        sys.exit(0)

                set_id = target['set_id']
                spl_id = target['spl_id']
                trade = target['trade']
                generic = target['generic']
                mfg = target['mfg']
                revised_date = target['revised_date']

                active_endpoints = get_active_endpoint_status(set_id)
                pending_assessments = [
                    (tox_type, prompt)
                    for tox_type, prompt in assessments
                    if args.force or tox_type not in active_endpoints
                ]

                print("\n" + "-" * 78)
                log_info(f"Label {i}/{total_targets}: {trade}")
                log_info(f"SETID={set_id} | SPLID={spl_id} | Revised={revised_date}")
                log_info(f"Existing endpoint status: {format_endpoint_status(active_endpoints)}")

                if not pending_assessments:
                    log_skip("All endpoints already exist in DrugToxicity; nothing to generate.")
                    endpoint_skip_count += len(ENDPOINTS)
                    completed_count += 1
                    prog = 20 + int(75 * (completed_count / total_targets))
                    update_progress(task_id, prog, f"Skipped {completed_count}/{total_targets}; all endpoints already complete.")
                    continue

                log_info("Endpoints to generate: " + ", ".join(tox_type for tox_type, _ in pending_assessments))

                # Fetch content only when at least one endpoint still needs work.
                content = get_target_sections_content(set_id, spl_id, force_local=args.local)
                if not content.strip():
                    skipped_no_content_count += 1
                    log_warn("No target SPL sections found; skipped this label.")
                    completed_count += 1
                    prog = 20 + int(75 * (completed_count / total_targets))
                    update_progress(task_id, prog, f"Skipped {completed_count}/{total_targets}; no target SPL sections found.")
                    continue

                for tox_type, prompt in pending_assessments:
                    # Re-check immediately before generating so a rerun can continue cleanly
                    # after interruption, and so partial writes in this run are visible.
                    if not args.force and endpoint_is_written(set_id, tox_type):
                        endpoint_skip_count += 1
                        log_skip(f"{tox_type}: already written to DrugToxicity.")
                        continue

                    try:
                        log_info(f"{tox_type}: generating assessment...")
                        html_report = generate_assessment(system_user, prompt, content)
                        conclusion = extract_conclusion(html_report)
                        today_str = datetime.now(ZoneInfo("America/Chicago")).strftime('%Y%m%d')
                        new_rec = DrugToxicity(
                            SETID=set_id,
                            Tox_Type=tox_type,
                            is_historical=0,
                            Toxicity_Class=conclusion,
                            AI_Summary=html_report,
                            endpoint=conclusion,
                            AI_Model="vLLM (Llama-4)",
                            Update_Notes=(
                                f"Updated {datetime.now(ZoneInfo('America/Chicago')).strftime('%m/%d/%Y')} via AI Generator"
                                if db.session.query(DrugToxicity).filter(
                                    DrugToxicity.SETID == set_id,
                                    DrugToxicity.Tox_Type == tox_type
                                ).first() is not None
                                else f"Initialized {datetime.now(ZoneInfo('America/Chicago')).strftime('%m/%d/%Y')} via AI Generator"
                            ),
                            Assessment_Date=today_str
                        )
                        db.session.add(new_rec)
                        mark_previous_endpoint_historical(new_rec)
                        db.session.commit()
                        endpoint_success_count += 1
                        log_ok(f"{tox_type}: saved to DrugToxicity as {conclusion}.")
                    except Exception as e:
                        db.session.rollback()
                        endpoint_failure_count += 1
                        log_error(f"{tox_type}: failed for {set_id}: {e}")

                final_active_endpoints = get_active_endpoint_status(set_id)
                log_info(f"Final endpoint status: {format_endpoint_status(final_active_endpoints)}")

                completed_count += 1
                prog = 20 + int(75 * (completed_count / total_targets))
                update_progress(
                    task_id,
                    prog,
                    f"Processed {completed_count}/{total_targets} labels. Endpoint saves: {endpoint_success_count}; failures: {endpoint_failure_count}.",
                )

            final_message = (
                f"DrugTox generation complete. Labels checked: {completed_count}. "
                f"Endpoint saves: {endpoint_success_count}; skipped existing: {endpoint_skip_count}; "
                f"endpoint failures: {endpoint_failure_count}; labels skipped for missing content: {skipped_no_content_count}."
            )
            update_progress(task_id, 100, final_message, status='completed' if endpoint_failure_count == 0 else 'failed')
            print("\n=== DrugTox AI Generator Summary ===")
            log_ok(final_message if endpoint_failure_count == 0 else final_message)
            
        except Exception as e:
            log_error(f"Fatal error: {e}")
            if task_id:
                try:
                    task = db.session.get(SystemTask, task_id)
                    if task:
                        task.status = 'failed'
                        task.error_details = str(e)
                        db.session.commit()
                except: pass

if __name__ == "__main__":
    generate_drugtox()
