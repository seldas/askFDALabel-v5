#!/usr/bin/env python3
"""
RAPID Migration Package Exporter

Builds Docker images for backend, frontend, nginx, db, and celery/redis services,
saves the images to an archive, and packages project files and (optionally) data
into zip files under deploy/rapid_migration/.

Usage:
    python export_rapid_package.py [--include-data] [--skip-build] [--output-dir OUTPUT_DIR]
"""

import os
import sys
import argparse
import subprocess
import zipfile
import gzip
import shutil
from pathlib import Path

# Base paths
SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parents[1] if (SCRIPT_DIR.name == "rapid_migration" and SCRIPT_DIR.parent.name == "deploy") else SCRIPT_DIR.parent

DEFAULT_RAPID_IMAGES = [
    "fdalabel-v3-backend:latest",
    "fdalabel-v3-frontend:latest",
    "fdalabel-v3-redis:latest",
]

ALL_IMAGES = [
    "fdalabel-v3-backend:latest",
    "fdalabel-v3-frontend:latest",
    "fdalabel-v3-nginx:latest",
    "fdalabel-v3-db:latest",
    "fdalabel-v3-redis:latest",
]

def run_cmd(cmd, cwd=REPO_ROOT, check=True):
    """Executes a subprocess command with clear logging."""
    cmd_str = " ".join(cmd) if isinstance(cmd, list) else cmd
    print(f"[RUN] {cmd_str}")
    res = subprocess.run(cmd, cwd=cwd, check=False)
    if check and res.returncode != 0:
        print(f"[ERROR] Command failed with exit code {res.returncode}")
        sys.exit(res.returncode)
    return res.returncode == 0

def check_or_prepare_image(image_name, base_image):
    """Ensures a base image exists locally, pulling/tagging if missing."""
    res = subprocess.run(["docker", "image", "inspect", image_name],
                         stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if res.returncode == 0:
        print(f"[INFO] Image '{image_name}' exists.")
        return True
    
    print(f"[INFO] Image '{image_name}' not found locally. Pulling base '{base_image}'...")
    if run_cmd(["docker", "pull", base_image], check=False):
        if run_cmd(["docker", "tag", base_image, image_name], check=False):
            print(f"[SUCCESS] Prepared '{image_name}'.")
            return True
    return False

def build_images(images_to_build):
    """Builds required project docker images."""
    print("\n--- Building Docker Images ---")

    # 1. Backend
    if "fdalabel-v3-backend:latest" in images_to_build:
        print("[BUILD] Building backend image...")
        run_cmd(["docker", "build", "-t", "fdalabel-v3-backend:latest", "./backend"])

    # 2. Frontend
    if "fdalabel-v3-frontend:latest" in images_to_build:
        print("[BUILD] Building frontend image...")
        run_cmd(["docker", "build", "-t", "fdalabel-v3-frontend:latest", "--build-arg", "BUILD_ENV=production", "./frontend"])

    # 3. Nginx
    if "fdalabel-v3-nginx:latest" in images_to_build:
        print("[BUILD] Building Nginx image...")
        run_cmd(["docker", "build", "-t", "fdalabel-v3-nginx:latest", "./deploy/nginx"])

    # 4. DB Image (ankane/pgvector:latest -> fdalabel-v3-db:latest)
    if "fdalabel-v3-db:latest" in images_to_build:
        check_or_prepare_image("fdalabel-v3-db:latest", "ankane/pgvector:latest")

    # 5. Redis Image (bitnami/redis:latest or redis:alpine -> fdalabel-v3-redis:latest)
    if "fdalabel-v3-redis:latest" in images_to_build:
        if not check_or_prepare_image("fdalabel-v3-redis:latest", "bitnami/redis:latest"):
            check_or_prepare_image("fdalabel-v3-redis:latest", "redis:alpine")

def export_images(target_dir, images_to_export):
    """Saves each required docker image to its own compressed tar.gz archive."""
    print("\n--- Saving Docker Images to Compressed (.tar.gz) Archives ---")
    for img in images_to_export:
        service_name = img.split(":")[0].replace("fdalabel-v3-", "")
        targz_name = f"image_{service_name}.tar.gz"
        targz_path = target_dir / targz_name
        print(f"[SAVE] Exporting and compressing '{img}' -> {targz_name}...")
        
        proc = subprocess.Popen(["docker", "save", img], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        with gzip.open(targz_path, "wb", compresslevel=6) as gz_out:
            shutil.copyfileobj(proc.stdout, gz_out)
        proc.wait()
        
        if proc.returncode != 0:
            err = proc.stderr.read().decode(errors="replace")
            print(f"[ERROR] Failed to export '{img}': {err}")
            sys.exit(proc.returncode)
            
        size_mb = targz_path.stat().st_size / (1024 * 1024)
        print(f"  + Exported: {targz_path.name} ({size_mb:.1f} MB)")

DATA_EXCLUDE_PATTERNS = [
    "*.tmp",
    "*.temp",
    "*.part",
    "*.crdownload",
    "*.log",
    "__pycache__",
    "*.pyc",
    "*.pyo",
    ".DS_Store",
    "Thumbs.db",
    "cache",
    "data/cache",
    "data/cache/*",
    "data/downloads/*.tmp",
    "data/downloads/tmp*",
    "data/downloads/temp*",
    "data/logs/*",
    "data/uploads/*.tmp",
]

def archive_files(zip_path, files_to_include, dirs_to_include, exclude_patterns=None):
    """Helper to write specified files and directory trees into a zip archive with exclusions."""
    print(f"[ZIP] Creating archive: {zip_path.name}...")
    import fnmatch
    exclude_patterns = exclude_patterns or []

    def should_exclude(rel_path_str: str) -> bool:
        norm_path = rel_path_str.replace("\\", "/")
        path_obj = Path(norm_path)
        for pattern in exclude_patterns:
            if fnmatch.fnmatch(norm_path, pattern):
                return True
            if fnmatch.fnmatch(path_obj.name, pattern):
                return True
            for part in path_obj.parts:
                if fnmatch.fnmatch(part, pattern):
                    return True
        return False

    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for rel_file in files_to_include:
            if should_exclude(str(rel_file)):
                print(f"  - Skipped (excluded): {rel_file}")
                continue
            full_path = REPO_ROOT / rel_file
            if full_path.exists():
                zf.write(full_path, arcname=rel_file)
                print(f"  + Added file: {rel_file}")
            else:
                print(f"  ! Warning: File missing, skipping: {rel_file}")

        for rel_dir in dirs_to_include:
            full_dir = REPO_ROOT / rel_dir
            if full_dir.exists():
                for root, _, files in os.walk(full_dir):
                    for f in files:
                        fp = Path(root) / f
                        arcname = fp.relative_to(REPO_ROOT)
                        if should_exclude(str(arcname)):
                            print(f"  - Skipped (excluded): {arcname}")
                            continue
                        zf.write(fp, arcname=arcname)
                print(f"  + Added directory: {rel_dir}/")
            else:
                print(f"  ! Warning: Directory missing, skipping: {rel_dir}")

def export_mounted_files(target_dir):
    """Packages mounted files, configuration, and scripts into rapid_files.zip."""
    print("\n--- Packaging RAPID Config & Mount Files ---")
    zip_path = target_dir / "rapid_files.zip"
    files = [
        "start_server.py",
        ".env.template",
        ".env.rapid.template",
        "AGENTS.md",
        "README.md",
        "deploy/rapid_migration/restore_db.py",
        "deploy/rapid_migration/dump_db.py",
        "deploy/rapid_migration/README.md",
    ]
    dirs = [
        "deploy/nginx",
        "backend/webtest/results",
        "backend/webtest/history",
        "frontend/public",
    ]
    archive_files(zip_path, files, dirs, exclude_patterns=["*.pyc", "__pycache__", ".DS_Store", "Thumbs.db"])
    print(f"[SUCCESS] Created config archive: {zip_path}")

def export_data_folder(target_dir):
    """Packages data/ directory into data.zip, excluding temporary download caches."""
    print("\n--- Packaging Data Directory (excluding temporary caches) ---")
    zip_path = target_dir / "data.zip"
    dirs = ["data"]
    archive_files(zip_path, [], dirs, exclude_patterns=DATA_EXCLUDE_PATTERNS)
    print(f"[SUCCESS] Created data archive: {zip_path}")

def main():
    parser = argparse.ArgumentParser(description="Export Docker images and migration packages for RAPID deployment.")
    parser.add_argument("--include-data", action="store_true", default=False,
                        help="Include data/ directory archive (data.zip). Default is False.")
    parser.add_argument("--skip-build", action="store_true", default=False,
                        help="Skip docker build step and use existing local images.")
    parser.add_argument("--all-images", action="store_true", default=False,
                        help="Export all images including Nginx and Local DB (default: False, exports only backend, frontend, redis for RAPID).")
    parser.add_argument("--output-dir", default=str(SCRIPT_DIR),
                        help="Destination directory for output archives (default: deploy/rapid_migration).")

    args = parser.parse_args()
    target_dir = Path(args.output_dir).resolve()
    target_dir.mkdir(parents=True, exist_ok=True)

    images_to_process = ALL_IMAGES if args.all_images else DEFAULT_RAPID_IMAGES

    print(f"==================================================")
    print(f" RAPID Migration Package Exporter")
    print(f"  Repo Root:   {REPO_ROOT}")
    print(f"  Output Dir:  {target_dir}")
    print(f"  Include Data:{args.include_data}")
    print(f"  All Images:  {args.all_images} (Count: {len(images_to_process)})")
    print(f"  Skip Build:  {args.skip_build}")
    print(f"==================================================")

    if not args.skip_build:
        build_images(images_to_process)
    else:
        print("[INFO] Skipping build step (--skip-build flag set).")

    export_images(target_dir, images_to_process)
    export_mounted_files(target_dir)

    if args.include_data:
        export_data_folder(target_dir)
    else:
        print("\n[INFO] Data folder packaging skipped (use --include-data to enable).")

    print("\n==================================================")
    print("[COMPLETE] Export finished successfully!")
    print(f"Files saved in: {target_dir}")
    print("==================================================")

if __name__ == "__main__":
    main()
