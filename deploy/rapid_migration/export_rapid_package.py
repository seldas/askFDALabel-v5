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
import shutil
from pathlib import Path

# Base paths
SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parents[1] if (SCRIPT_DIR.name == "rapid_migration" and SCRIPT_DIR.parent.name == "deploy") else SCRIPT_DIR.parent

IMAGES_TO_EXPORT = [
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

def build_images():
    """Builds all project docker images."""
    print("\n--- Building Docker Images ---")

    # 1. Backend
    print("[BUILD] Building backend image...")
    run_cmd(["docker", "build", "-t", "fdalabel-v3-backend:latest", "./backend"])

    # 2. Frontend
    print("[BUILD] Building frontend image...")
    run_cmd(["docker", "build", "-t", "fdalabel-v3-frontend:latest", "--build-arg", "BUILD_ENV=production", "./frontend"])

    # 3. Nginx
    print("[BUILD] Building Nginx image...")
    run_cmd(["docker", "build", "-t", "fdalabel-v3-nginx:latest", "./deploy/nginx"])

    # 4. DB Image (ankane/pgvector:latest -> fdalabel-v3-db:latest)
    check_or_prepare_image("fdalabel-v3-db:latest", "ankane/pgvector:latest")

    # 5. Redis Image (bitnami/redis:latest or redis:alpine -> fdalabel-v3-redis:latest)
    if not check_or_prepare_image("fdalabel-v3-redis:latest", "bitnami/redis:latest"):
        check_or_prepare_image("fdalabel-v3-redis:latest", "redis:alpine")

def export_images(target_dir):
    """Saves each required docker image to its own individual tar archive."""
    print("\n--- Saving Docker Images to Individual Tar Archives ---")
    for img in IMAGES_TO_EXPORT:
        # e.g., fdalabel-v3-backend:latest -> image_backend.tar
        service_name = img.split(":")[0].replace("fdalabel-v3-", "")
        tar_name = f"image_{service_name}.tar"
        tar_path = target_dir / tar_name
        print(f"[SAVE] Exporting '{img}' -> {tar_name}...")
        cmd = ["docker", "save", "-o", str(tar_path), img]
        run_cmd(cmd)
        print(f"  + Exported: {tar_path}")

def archive_files(zip_path, files_to_include, dirs_to_include):
    """Helper to write specified files and directory trees into a zip archive."""
    print(f"[ZIP] Creating archive: {zip_path.name}...")
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for rel_file in files_to_include:
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
        ".env",
        ".env.template",
        "AGENTS.md",
        "README.md"
    ]
    dirs = [
        "deploy/nginx",
        "backend/webtest/results",
        "backend/webtest/history",
        "frontend/public",
    ]
    archive_files(zip_path, files, dirs)
    print(f"[SUCCESS] Created config archive: {zip_path}")

def export_data_folder(target_dir):
    """Packages data/ directory into data.zip."""
    print("\n--- Packaging Data Directory ---")
    zip_path = target_dir / "data.zip"
    dirs = ["data"]
    archive_files(zip_path, [], dirs)
    print(f"[SUCCESS] Created data archive: {zip_path}")

def main():
    parser = argparse.ArgumentParser(description="Export Docker images and migration packages for RAPID deployment.")
    parser.add_argument("--include-data", action="store_true", default=False,
                        help="Include data/ directory archive (data.zip). Default is False.")
    parser.add_argument("--skip-build", action="store_true", default=False,
                        help="Skip docker build step and use existing local images.")
    parser.add_argument("--output-dir", default=str(SCRIPT_DIR),
                        help="Destination directory for output archives (default: deploy/rapid_migration).")

    args = parser.parse_args()
    target_dir = Path(args.output_dir).resolve()
    target_dir.mkdir(parents=True, exist_ok=True)

    print(f"==================================================")
    print(f" RAPID Migration Package Exporter")
    print(f"  Repo Root:   {REPO_ROOT}")
    print(f"  Output Dir:  {target_dir}")
    print(f"  Include Data:{args.include_data}")
    print(f"  Skip Build:  {args.skip_build}")
    print(f"==================================================")

    if not args.skip_build:
        build_images()
    else:
        print("[INFO] Skipping build step (--skip-build flag set).")

    export_images(target_dir)
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
