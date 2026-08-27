#!/usr/bin/env python3
"""
deploy/generate_pv_profiles.py

Batch processor for generating Pharmacovigilance (PV) Side Effect Profiles
for FDA drug labeling records (CDER-CBER dataset, ~155k total labels).

Features:
- Default mode: Filters RLD drugs (~3,310 labels) for token efficiency.
- Mode to run all 155k CDER-CBER labels (--all).
- Resume-safety & Completeness Check: Checks existing rows in `label_pv_profiles`;
  skips if valid and complete, avoiding wasted LLM tokens and API calls.
- Multi-threaded concurrency (--concurrency N) with thread-safe DB transactions.
- Automatic retries with exponential backoff for transient LLM timeouts/errors.
- Direct persistence into PostgreSQL `label_pv_profiles` table.
"""

import os
import sys
import time
import json
import logging
import argparse
from datetime import datetime
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
import threading

# Dynamic path resolution to load backend and .env
current_dir = Path(__file__).resolve().parent
repo_root = current_dir.parent if current_dir.name == 'deploy' else current_dir

for parent in [current_dir] + list(current_dir.parents):
    if (parent / '.env').exists() or (parent / '.env.template.txt').exists():
        repo_root = parent
        break

backend_dir = repo_root / 'backend'
if backend_dir.exists():
    sys.path.insert(0, str(backend_dir))
else:
    sys.path.insert(0, str(repo_root))

# Set up logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger('PVProfileBatch')

# Import app and database models
from database import db, DrugLabel, LabelPvProfile
from dashboard import create_app
from dashboard.services.pv_profile_service import PVProfileService, SEVERITY_TIERS
from dashboard.services.fdalabel_db import FDALabelDBService

# Lock for thread-safe console output and progress accounting
progress_lock = threading.Lock()


def is_profile_complete(profile_row):
    """
    Checks whether an existing LabelPvProfile record in PostgreSQL is complete.
    Returns (is_complete: bool, reason: str).
    """
    if not profile_row or not profile_row.profile_data:
        return False, "No profile_data"

    try:
        data = json.loads(profile_row.profile_data)
        if not isinstance(data, dict):
            return False, "Corrupt JSON"

        # Check for explicit error flags
        if data.get('error') or data.get('status') in ('error', 'failed'):
            return False, f"Status={data.get('status') or 'error'}"

        # Labels with no recognizable safety sections are complete
        if data.get('status') == 'no_safety_sections_found':
            return True, "No safety sections in label"

        # Standard profiles must have items, tier_summary, and soc_summary
        items = data.get('items')
        tier_sum = data.get('tier_summary')
        soc_sum = data.get('soc_summary')

        if items is None or not isinstance(items, list):
            return False, "Missing items list"
        if not isinstance(tier_sum, dict) or not isinstance(soc_sum, list):
            return False, "Missing tier/soc summaries"

        total_aes = data.get('total_adverse_events', len(items))
        return True, f"Complete ({total_aes} AEs)"

    except Exception as e:
        return False, f"Parse error: {e}"


def process_single_label(app, label_info, force=False, max_retries=3):
    """
    Worker function to process a single drug label:
    1. Check completeness.
    2. If incomplete or force=True, generate PV profile via LLM & MedDRA.
    3. Save to PostgreSQL `label_pv_profiles`.
    """
    set_id = label_info['set_id']
    spl_id = label_info.get('spl_id')
    product_name = label_info.get('product_name') or label_info.get('brand_name') or set_id

    with app.app_context():
        try:
            # 1. Check existing record
            if not force:
                existing = db.session.query(LabelPvProfile).filter_by(set_id=set_id).first()
                if existing:
                    complete, reason = is_profile_complete(existing)
                    if complete:
                        return {
                            'status': 'skipped',
                            'set_id': set_id,
                            'product_name': product_name,
                            'reason': reason,
                            'ae_count': len(json.loads(existing.profile_data).get('items', [])) if existing.profile_data else 0
                        }

            # 2. Generation with retries
            last_err = None
            for attempt in range(1, max_retries + 1):
                try:
                    result = PVProfileService.get_or_generate_profile(
                        set_id=set_id,
                        spl_id=spl_id,
                        force_refresh=True,
                        auto_generate=True
                    )

                    if isinstance(result, tuple) and len(result) == 2:
                        res_body, status_code = result
                        if status_code >= 400:
                            raise RuntimeError(f"PVProfileService returned status {status_code}: {res_body}")
                        result = res_body

                    ae_count = len(result.get('items', [])) if isinstance(result, dict) else 0
                    tier_counts = result.get('tier_summary', {}) if isinstance(result, dict) else {}
                    tiers_str = f"T1:{tier_counts.get(1,0)} T2:{tier_counts.get(2,0)} T3:{tier_counts.get(3,0)} T4:{tier_counts.get(4,0)} T5:{tier_counts.get(5,0)}"

                    return {
                        'status': 'success',
                        'set_id': set_id,
                        'product_name': product_name,
                        'ae_count': ae_count,
                        'tiers': tiers_str,
                        'attempts': attempt
                    }

                except Exception as ex:
                    last_err = ex
                    if attempt < max_retries:
                        time.sleep(2 ** attempt)

            return {
                'status': 'failed',
                'set_id': set_id,
                'product_name': product_name,
                'error': str(last_err)
            }

        except Exception as outer_ex:
            return {
                'status': 'failed',
                'set_id': set_id,
                'product_name': product_name,
                'error': str(outer_ex)
            }
        finally:
            db.session.remove()


def main():
    parser = argparse.ArgumentParser(
        description="Batch PV-Profile generation for FDA drug labeling (CDER-CBER dataset)."
    )
    parser.add_argument(
        '--rld-only',
        action='store_true',
        default=True,
        help="Process only Reference Listed Drugs (RLD, ~3,310 labels). (Default: True)"
    )
    parser.add_argument(
        '--all',
        action='store_true',
        help="Process all drug labels in database (~155k labels)."
    )
    parser.add_argument(
        '--set-id',
        type=str,
        help="Process a single specific SET_ID."
    )
    parser.add_argument(
        '--limit',
        type=int,
        default=None,
        help="Limit number of labels to process."
    )
    parser.add_argument(
        '--offset',
        type=int,
        default=0,
        help="Offset from start of query."
    )
    parser.add_argument(
        '--force',
        action='store_true',
        help="Force re-generation even if complete profile already exists."
    )
    parser.add_argument(
        '--concurrency', '-j',
        type=int,
        default=4,
        help="Number of concurrent worker threads (Default: 4)."
    )
    parser.add_argument(
        '--retries',
        type=int,
        default=3,
        help="Maximum retries per label on error (Default: 3)."
    )

    args = parser.parse_args()

    app = create_app()

    with app.app_context():
        print("=" * 75)
        print("  FDA Drug Labeling PV-Profile Batch Processor")
        print("=" * 75)

        # Target label query
        if args.set_id:
            label_row = db.session.query(DrugLabel).filter_by(set_id=args.set_id).first()
            if label_row:
                targets = [{
                    'set_id': label_row.set_id,
                    'spl_id': label_row.spl_id,
                    'product_name': label_row.product_names or label_row.generic_names or label_row.set_id
                }]
            else:
                targets = [{
                    'set_id': args.set_id,
                    'spl_id': None,
                    'product_name': args.set_id
                }]
            print(f" Target: Single SET_ID {args.set_id}")
        else:
            query = db.session.query(
                DrugLabel.set_id,
                DrugLabel.spl_id,
                DrugLabel.product_names,
                DrugLabel.generic_names,
                DrugLabel.is_rld
            )

            # RLD vs ALL filter
            if not args.all:
                query = query.filter(DrugLabel.is_rld == 1)
                scope_name = "RLD Drugs (is_rld = 1)"
            else:
                scope_name = "ALL CDER-CBER Labels (~155k)"

            if args.offset:
                query = query.offset(args.offset)
            if args.limit:
                query = query.limit(args.limit)

            rows = query.all()
            targets = [
                {
                    'set_id': r[0],
                    'spl_id': r[1],
                    'product_name': (r[2] or r[3] or r[0])[:60]
                }
                for r in rows
            ]
            print(f" Scope: {scope_name}")
            print(f" Selected: {len(targets):,} label(s) (Offset: {args.offset}, Limit: {args.limit or 'None'})")

        print(f" Concurrency: {args.concurrency} worker thread(s)")
        print(f" Force Refresh: {args.force}")
        print("=" * 75)

        if not targets:
            print("No labels to process.")
            return

        # Counters
        total_targets = len(targets)
        count_success = 0
        count_skipped = 0
        count_failed = 0
        total_aes = 0
        start_time = time.time()

        # Execute
        print(f"Starting batch generation at {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}...\n")

        with ThreadPoolExecutor(max_workers=args.concurrency) as executor:
            future_to_label = {
                executor.submit(
                    process_single_label,
                    app,
                    label,
                    force=args.force,
                    max_retries=args.retries
                ): label
                for label in targets
            }

            for idx, future in enumerate(as_completed(future_to_label), start=1):
                res = future.result()
                status = res.get('status')
                set_id = res.get('set_id')
                name = res.get('product_name')

                with progress_lock:
                    pct = (idx / total_targets) * 100
                    elapsed = time.time() - start_time
                    avg_speed = idx / elapsed if elapsed > 0 else 0
                    eta_sec = (total_targets - idx) / avg_speed if avg_speed > 0 else 0

                    if status == 'success':
                        count_success += 1
                        total_aes += res.get('ae_count', 0)
                        print(
                            f"[{idx}/{total_targets} - {pct:5.1f}%] [OK] {name} ({set_id[:8]}...) -> "
                            f"{res.get('ae_count')} AEs [{res.get('tiers')}] (ETA: {eta_sec/60:.1f}m)",
                            flush=True
                        )
                    elif status == 'skipped':
                        count_skipped += 1
                        total_aes += res.get('ae_count', 0)
                        print(
                            f"[{idx}/{total_targets} - {pct:5.1f}%] [SKIP] {name} ({set_id[:8]}...) -> "
                            f"{res.get('reason')} (ETA: {eta_sec/60:.1f}m)",
                            flush=True
                        )
                    else:
                        count_failed += 1
                        print(
                            f"[{idx}/{total_targets} - {pct:5.1f}%] [ERROR] {name} ({set_id[:8]}...) -> "
                            f"{res.get('error')}",
                            flush=True
                        )

        # Final Summary
        total_time = time.time() - start_time
        print("\n" + "=" * 75)
        print("  Batch Processing Summary")
        print("=" * 75)
        print(f" Total Labels Processed: {total_targets:,}")
        print(f" - Successfully Generated: {count_success:,}")
        print(f" - Skipped (Complete):     {count_skipped:,}")
        print(f" - Failed:                 {count_failed:,}")
        print(f" Total AEs in Database:    {total_aes:,}")
        print(f" Total Time:               {total_time/60:.2f} minutes ({total_time:.1f}s)")
        if total_targets > 0:
            print(f" Average Rate:             {total_targets / total_time:.2f} labels/sec")
        print("=" * 75)


if __name__ == '__main__':
    main()
