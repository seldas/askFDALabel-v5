#!/usr/bin/env python3
"""
Automated Database Update Checker & Synchronizer for FDALabel-v3.

Checks publicly accessible online databases for updates:
  1. FDA Orange Book data files (products.txt)
  2. FDA/DailyMed Pharmacologic Class Indexing (EPC)
  3. DailyMed SPL Drug Labels / Monthly updates

If updates are detected:
  - Downloads updated files into data/downloads/
  - Executes corresponding database import scripts inside container/host
  - Refreshes database mappings and indexes
"""

import os
import sys
import zipfile
import shutil
import argparse
import urllib.request
import urllib.parse
import json
import hashlib
from pathlib import Path
import subprocess

# Setup base paths
CURRENT_DIR = Path(__file__).resolve().parent
REPO_ROOT = CURRENT_DIR
for parent in [CURRENT_DIR] + list(CURRENT_DIR.parents):
    if (parent / '.env').exists() or (parent / 'start_server.py').exists():
        REPO_ROOT = parent
        break

DATA_DIR = REPO_ROOT / 'data'
DOWNLOADS_DIR = DATA_DIR / 'downloads'

ORANGE_BOOK_URL = "https://www.fda.gov/media/76860/download"
DAILYMED_API_URL = "https://dailymed.nlm.nih.gov/dailymed/services/v2/spls.json"
EPC_INDEXING_URL = "https://dailymed.nlm.nih.gov/dailymed/services/v2/spls.json?category=indexing"


def log(msg):
    print(f"[UPDATE_DB] {msg}", flush=True)


def get_file_md5(filepath):
    if not os.path.exists(filepath):
        return None
    md5 = hashlib.md5()
    with open(filepath, 'rb') as f:
        for chunk in iter(lambda: f.read(8192), b""):
            md5.update(chunk)
    return md5.hexdigest()


def check_and_update_orange_book(force=False):
    log("Checking FDA Orange Book for updates...")
    target_dir = DOWNLOADS_DIR / 'OrangeBook' / 'EOB_Latest'
    target_dir.mkdir(parents=True, exist_ok=True)
    products_txt = target_dir / 'products.txt'

    temp_zip = target_dir / 'temp_orange_book.zip'
    updated = False

    try:
        req = urllib.request.Request(ORANGE_BOOK_URL, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=30) as resp, open(temp_zip, 'wb') as out_f:
            out_f.write(resp.read())

        with zipfile.ZipFile(temp_zip, 'r') as zip_ref:
            # Find products.txt in zip
            prod_name = None
            for name in zip_ref.namelist():
                if name.lower().endswith('products.txt'):
                    prod_name = name
                    break

            if prod_name:
                extracted_path = zip_ref.extract(prod_name, path=target_dir)
                new_file = Path(extracted_path)
                
                old_md5 = get_file_md5(products_txt)
                new_md5 = get_file_md5(new_file)

                if force or old_md5 != new_md5:
                    if new_file != products_txt:
                        shutil.move(str(new_file), str(products_txt))
                    log("Orange Book update detected and downloaded.")
                    updated = True
                else:
                    log("Orange Book is up to date.")
                    if new_file != products_txt and new_file.exists():
                        new_file.unlink()
    except Exception as e:
        log(f"Warning: Failed to check/update Orange Book online: {e}")
    finally:
        if temp_zip.exists():
            temp_zip.unlink()

    if updated or force:
        run_import_script('db_04_import_orange_book.py')
    return updated


def check_and_update_epc_indexing(force=False):
    log("Checking FDA Pharmacologic Class Indexing (EPC) files...")
    target_dir = DOWNLOADS_DIR / 'pharmacologic_class_indexing_spl_files'
    target_dir.mkdir(parents=True, exist_ok=True)

    existing_files = set(p.name for p in target_dir.glob('*.zip'))
    log(f"Current local indexing files count: {len(existing_files)}")
    updated = False

    try:
        req = urllib.request.Request(f"{DAILYMED_API_URL}?category=indexing&page=1&pagesize=100", headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode('utf-8'))

        spls = data.get('data', [])
        new_download_count = 0
        for spl in spls:
            set_id = spl.get('set_id')
            if not set_id:
                continue
            zip_filename = f"{set_id}.zip"
            zip_filepath = target_dir / zip_filename

            if not zip_filepath.exists() or force:
                media_url = f"https://dailymed.nlm.nih.gov/dailymed/services/v2/spls/{set_id}.zip"
                try:
                    m_req = urllib.request.Request(media_url, headers={'User-Agent': 'Mozilla/5.0'})
                    with urllib.request.urlopen(m_req, timeout=30) as m_resp, open(zip_filepath, 'wb') as z_out:
                        z_out.write(m_resp.read())
                    new_download_count += 1
                except Exception as ex:
                    log(f"Warning downloading indexing set {set_id}: {ex}")

        if new_download_count > 0:
            log(f"Downloaded {new_download_count} new EPC indexing files.")
            updated = True
        else:
            log("EPC Pharmacologic Class Indexing is up to date.")
    except Exception as e:
        log(f"Warning: Failed to check/update EPC indexing online: {e}")

    if updated or force:
        run_import_script('db_05_import_epc_indexing.py')
    return updated


def check_and_update_dailymed_labels(force=False):
    log("Checking DailyMed SPL Drug Labels for updates...")
    downloads_dailymed = DOWNLOADS_DIR / 'dailymed'
    spl_storage = DATA_DIR / 'spl_storage'
    downloads_dailymed.mkdir(parents=True, exist_ok=True)
    spl_storage.mkdir(parents=True, exist_ok=True)

    updated = False
    try:
        req = urllib.request.Request(f"{DAILYMED_API_URL}?published_date_comparison=eq&page=1&pagesize=50", headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode('utf-8'))

        spls = data.get('data', [])
        new_count = 0
        for spl in spls:
            set_id = spl.get('set_id')
            if not set_id:
                continue
            zip_filename = f"{set_id}.zip"
            storage_path = spl_storage / zip_filename

            if not storage_path.exists() or force:
                media_url = f"https://dailymed.nlm.nih.gov/dailymed/services/v2/spls/{set_id}.zip"
                try:
                    m_req = urllib.request.Request(media_url, headers={'User-Agent': 'Mozilla/5.0'})
                    with urllib.request.urlopen(m_req, timeout=30) as m_resp, open(storage_path, 'wb') as z_out:
                        z_out.write(m_resp.read())
                    new_count += 1
                except Exception as ex:
                    log(f"Warning downloading SPL {set_id}: {ex}")

        if new_count > 0:
            log(f"Downloaded {new_count} updated SPL label files.")
            updated = True
        else:
            log("DailyMed SPL drug labels are up to date.")
    except Exception as e:
        log(f"Warning: Failed to check DailyMed updates: {e}")

    if updated or force:
        args_list = ['--skip-unpack']
        if force:
            args_list.append('--force')
        run_import_script('db_07_import_labels.py', args=args_list)
    return updated


def run_import_script(script_name, args=None):
    script_path = REPO_ROOT / 'backend' / 'database' / 'scripts' / script_name
    log(f"Running database import script: {script_name}...")
    
    # Try running inside running docker container first
    try:
        cmd = ['docker', 'exec', '-e', 'PYTHONPATH=.', 'fdalabel-v3-backend', 'python', f'database/scripts/{script_name}']
        if args:
            cmd.extend(args)
        res = subprocess.run(cmd, cwd=str(REPO_ROOT), check=False)
        if res.returncode == 0:
            log(f"Successfully executed {script_name} inside container.")
            return
    except Exception:
        pass

    # Fallback to local python host execution
    try:
        cmd = [sys.executable, str(script_path)]
        if args:
            cmd.extend(args)
        env = os.environ.copy()
        env['PYTHONPATH'] = str(REPO_ROOT / 'backend')
        res = subprocess.run(cmd, cwd=str(REPO_ROOT), env=env, check=True)
        log(f"Successfully executed {script_name} locally.")
    except Exception as e:
        log(f"Error executing {script_name}: {e}")


def main():
    parser = argparse.ArgumentParser(description="FDALabel Data Transfer & Database Update Agent Skill")
    parser.add_argument('--force', action='store_true', help='Force re-download and re-import all data sources')
    parser.add_argument('--source', choices=['orange', 'epc', 'dailymed', 'all'], default='all', help='Target data source to check')
    args = parser.parse_args()

    log("=== Starting Automated Database Update Check ===")

    if args.source in ('orange', 'all'):
        check_and_update_orange_book(force=args.force)

    if args.source in ('epc', 'all'):
        check_and_update_epc_indexing(force=args.force)

    if args.source in ('dailymed', 'all'):
        check_and_update_dailymed_labels(force=args.force)

    log("=== Database Update Check Completed ===")


if __name__ == '__main__':
    main()
