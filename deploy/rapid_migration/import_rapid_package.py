#!/usr/bin/env python3
"""
RAPID Migration Package Importer

Loads Docker images from saved tar archives and extracts config/project files
and (optionally) data.zip into the destination folder to overwrite existing files.

Usage:
    python import_rapid_package.py [--include-data] [--source-dir SOURCE_DIR] [--target-dir TARGET_DIR] [--skip-images]
"""

import os
import sys
import argparse
import subprocess
import zipfile
from pathlib import Path

# Base paths
SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parents[1] if (SCRIPT_DIR.name == "rapid_migration" and SCRIPT_DIR.parent.name == "deploy") else SCRIPT_DIR.parent

def run_cmd(cmd, cwd=REPO_ROOT, check=True):
    """Executes a subprocess command with clear logging."""
    cmd_str = " ".join(cmd) if isinstance(cmd, list) else cmd
    print(f"[RUN] {cmd_str}")
    res = subprocess.run(cmd, cwd=cwd, check=False)
    if check and res.returncode != 0:
        print(f"[ERROR] Command failed with exit code {res.returncode}")
        sys.exit(res.returncode)
    return res.returncode == 0

def load_docker_images(source_dir):
    """Loads docker images from individual tar archives in source_dir."""
    print("\n--- Loading Docker Images ---")
    tar_files = sorted(list(source_dir.glob("image_*.tar")) + list(source_dir.glob("images.tar")))
    if not tar_files:
        print(f"[ERROR] No image tar archives found in: {source_dir}")
        sys.exit(1)

    for tar_path in tar_files:
        print(f"[LOAD] Loading Docker image from: {tar_path.name}...")
        run_cmd(["docker", "load", "-i", str(tar_path)])
    print("[SUCCESS] All Docker images loaded successfully.")

def unzip_archive(zip_path, dest_dir):
    """Unzips a zip file into dest_dir, overwriting existing files."""
    if not zip_path.exists():
        print(f"[ERROR] Zip archive not found: {zip_path}")
        sys.exit(1)

    print(f"[UNZIP] Extracting {zip_path.name} to {dest_dir} (overwriting existing files)...")
    dest_dir.mkdir(parents=True, exist_ok=True)
    
    with zipfile.ZipFile(zip_path, "r") as zf:
        for member in zf.infolist():
            # Extract member explicitly to support overwrite
            target_path = dest_dir / member.filename
            if member.is_dir():
                target_path.mkdir(parents=True, exist_ok=True)
            else:
                target_path.parent.mkdir(parents=True, exist_ok=True)
                with zf.open(member) as source, open(target_path, "wb") as target:
                    target.write(source.read())
                print(f"  + Extracted: {member.filename}")

def main():
    parser = argparse.ArgumentParser(description="Import Docker images and migration packages for RAPID deployment.")
    parser.add_argument("--include-data", action="store_true", default=False,
                        help="Unzip data.zip to overwrite data/ directory. Default is False.")
    parser.add_argument("--source-dir", default=str(SCRIPT_DIR),
                        help="Source directory containing archives (default: deploy/rapid_migration).")
    parser.add_argument("--target-dir", default=str(REPO_ROOT),
                        help="Destination directory to extract files into (default: project root).")
    parser.add_argument("--skip-images", action="store_true", default=False,
                        help="Skip loading Docker images.")

    args = parser.parse_args()
    source_dir = Path(args.source_dir).resolve()
    target_dir = Path(args.target_dir).resolve()

    print(f"==================================================")
    print(f" RAPID Migration Package Importer")
    print(f"  Source Dir:   {source_dir}")
    print(f"  Target Dir:   {target_dir}")
    print(f"  Include Data: {args.include_data}")
    print(f"  Skip Images:  {args.skip_images}")
    print(f"==================================================")

    # 1. Load Docker Images
    if not args.skip_images:
        load_docker_images(source_dir)
    else:
        print("[INFO] Skipping Docker image load (--skip-images flag set).")

    # 2. Extract Config & Mounted Files
    rapid_files_zip = source_dir / "rapid_files.zip"
    if rapid_files_zip.exists():
        unzip_archive(rapid_files_zip, target_dir)
    else:
        print(f"[WARNING] {rapid_files_zip.name} not found. Skipping file extraction.")

    # 3. Extract Data (if requested)
    if args.include_data:
        data_zip = source_dir / "data.zip"
        if data_zip.exists():
            unzip_archive(data_zip, target_dir)
        else:
            print(f"[ERROR] {data_zip.name} not found in {source_dir}.")
            sys.exit(1)
    else:
        print("\n[INFO] Data extraction skipped (use --include-data to unpack data.zip).")

    print("\n==================================================")
    print("[COMPLETE] Migration import finished successfully!")
    print("You can now launch RAPID using:")
    print("  python start_server.py --rapid")
    print("==================================================")

if __name__ == "__main__":
    main()
