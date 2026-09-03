#!/usr/bin/env python3
import os
import sys
import argparse
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent
APPTAINER_DIR = ROOT / 'deploy' / 'apptainer'
APPTAINER_IMAGES = APPTAINER_DIR / 'images'

# Keep the Apptainer instance names aligned with Docker's long-standing
# `container_name` values.  The askfdalabel-* names were used only by the
# first Apptainer implementation and are retained below solely for migration.
APPTAINER_INSTANCES = {
    'frontend': 'fdalabel-v3-frontend',
    'backend': 'fdalabel-v3-backend',
    'celery': 'fdalabel-v3-celery',
    'redis': 'fdalabel-v3-redis',
    'db': 'fdalabel-v3-db',
}
LEGACY_APPTAINER_INSTANCES = {
    service: f'askfdalabel-{service}'
    for service in APPTAINER_INSTANCES
}


def _run(command, dry_run=False, check=True):
    print(f"Running command: {' '.join(map(str, command))}")
    if not dry_run:
        subprocess.run(command, check=check)


def _apptainer_instance_exists(name):
    """Return whether a named Apptainer instance is currently registered."""
    result = subprocess.run(
        ['apptainer', 'instance', 'list'],
        check=False,
        capture_output=True,
        text=True,
    )
    return result.returncode == 0 and re.search(rf'(?<![\w-]){re.escape(name)}(?![\w-])', result.stdout) is not None


def _start_apptainer_instance(command, name, args, restart_on_build=False):
    """Start an instance once, reusing a healthy already-running instance."""
    if args.dry_run:
        _run(command, dry_run=True)
        return

    if _apptainer_instance_exists(name):
        if restart_on_build and args.build:
            print(f"[INFO] Replacing {name} because its image was rebuilt.")
            _run(['apptainer', 'instance', 'stop', name], check=False)
        else:
            print(f"[INFO] Reusing existing Apptainer instance: {name}")
            return
    _run(command)


def run_apptainer(args, env_vars, local_db):
    """Start rootless Apptainer instances using host-owned persistent data."""
    if not args.dry_run:
        try:
            subprocess.run(['apptainer', '--version'], check=True, stdout=subprocess.DEVNULL)
        except FileNotFoundError:
            print("[ERROR] 'apptainer' was not found. Install Apptainer on the Linux host or use --runtime docker.")
            sys.exit(1)

    services = ['frontend', 'backend', 'celery', 'redis']
    if local_db:
        services.append('db')
    if args.down:
        # Also clean up the short-lived askfdalabel-* naming scheme used by
        # the initial Apptainer launcher, so --down remains backward-compatible.
        for service in services:
            for name in (APPTAINER_INSTANCES[service], LEGACY_APPTAINER_INSTANCES[service]):
                _run(['apptainer', 'instance', 'stop', name], args.dry_run, check=False)
        return

    APPTAINER_IMAGES.mkdir(parents=True, exist_ok=True)
    backend_image = APPTAINER_IMAGES / 'askfdalabel-backend.sif'
    frontend_image = APPTAINER_IMAGES / 'askfdalabel-frontend.sif'
    if args.build or not backend_image.exists() or not frontend_image.exists():
        _run(['apptainer', 'build', '--fakeroot', str(backend_image), str(APPTAINER_DIR / 'backend.def')], args.dry_run)
        _run(['apptainer', 'build', '--fakeroot', str(frontend_image), str(APPTAINER_DIR / 'frontend.def')], args.dry_run)

    monthly = ROOT / 'data' / 'monthly_updates'
    monthly.mkdir(parents=True, exist_ok=True)
    (monthly / 'archive').mkdir(exist_ok=True)
    data_dir = ROOT / 'data'
    data_dir.mkdir(exist_ok=True)
    pg_data = ROOT / 'database' / 'pgdata'
    if local_db:
        pg_data.mkdir(parents=True, exist_ok=True)
    # Both bind mounts are deliberate: /data keeps existing XML/storage paths
    # working, while monthly_updates is an explicit durable host data contract.
    data_binds = f'{data_dir}:/data,{monthly}:/data/monthly_updates'
    runtime_env = os.environ.copy()
    runtime_env.update(env_vars)
    runtime_env.update({
        'APPTAINERENV_FLASK_ENV': 'development' if args.mode == 'dev' else 'production',
        'APPTAINERENV_BACKEND_PORT': '8842',
        'APPTAINERENV_FRONTEND_PORT': '8841',
        'APPTAINERENV_BACKEND_URL': 'http://127.0.0.1:8842',
        'APPTAINERENV_CELERY_BROKER_URL': env_vars.get('CELERY_BROKER_URL', 'redis://127.0.0.1:6379/0'),
        'APPTAINERENV_CELERY_RESULT_BACKEND': env_vars.get('CELERY_RESULT_BACKEND', 'redis://127.0.0.1:6379/0'),
        'APPTAINERENV_CELERY_CONCURRENCY': '1' if args.efficient else '4',
        'APPTAINERENV_POSTGRES_DB': env_vars.get('PG_DATABASE', 'fdalabel-v3'),
        'APPTAINERENV_POSTGRES_USER': env_vars.get('PG_USERNAME', env_vars.get('PG_USER', 'afd_user')),
        'APPTAINERENV_POSTGRES_PASSWORD': env_vars.get('PG_PASSWORD', 'afd_password'),
    })
    old_env = os.environ.copy()
    os.environ.update(runtime_env)
    try:
        # An Apptainer instance lives beyond this script invocation.  Retire
        # instances from the original naming scheme before launching the
        # canonical fdalabel-v3-* names; host-mounted data is unaffected.
        for service in services:
            legacy_name = LEGACY_APPTAINER_INSTANCES[service]
            if args.dry_run:
                _run(['apptainer', 'instance', 'stop', legacy_name], dry_run=True, check=False)
            elif _apptainer_instance_exists(legacy_name):
                print(f"[INFO] Migrating legacy Apptainer instance: {legacy_name}")
                _run(['apptainer', 'instance', 'stop', legacy_name], check=False)
        if local_db:
            _start_apptainer_instance(
                ['apptainer', 'instance', 'start', '--bind', f'{pg_data}:/var/lib/postgresql/data',
                 'docker://ankane/pgvector:latest', APPTAINER_INSTANCES['db']],
                APPTAINER_INSTANCES['db'], args,
            )
        _start_apptainer_instance(
            ['apptainer', 'instance', 'start', 'docker://redis:7-alpine', APPTAINER_INSTANCES['redis']],
            APPTAINER_INSTANCES['redis'], args,
        )
        _start_apptainer_instance(
            ['apptainer', 'instance', 'start', '--bind', data_binds, str(backend_image), APPTAINER_INSTANCES['backend']],
            APPTAINER_INSTANCES['backend'], args, restart_on_build=True,
        )
        _start_apptainer_instance(
            ['apptainer', 'instance', 'start', '--app', 'celery', '--bind', data_binds, str(backend_image), APPTAINER_INSTANCES['celery']],
            APPTAINER_INSTANCES['celery'], args, restart_on_build=True,
        )
        _start_apptainer_instance(
            ['apptainer', 'instance', 'start', str(frontend_image), APPTAINER_INSTANCES['frontend']],
            APPTAINER_INSTANCES['frontend'], args, restart_on_build=True,
        )
    finally:
        os.environ.clear(); os.environ.update(old_env)
    print('\n[SUCCESS] AskFDALabel is running with Apptainer.')
    print('          UI: http://localhost:8841/fdalabel-v3/')
    print('          Persistent updates: data/monthly_updates/ (host-owned by the launching user)')

def load_env(path=".env"):
    """Loads key-value pairs from a .env file."""
    env = {}
    if not os.path.exists(path):
        return env
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip().strip("'").strip('"')
    return env

def dict_to_yaml(data, indent=0):
    """Converts a Python dictionary/list structure into valid YAML string recursively."""
    lines = []
    spacer = " " * indent
    if isinstance(data, dict):
        for k, v in data.items():
            if v is None:
                lines.append(f"{spacer}{k}:")
            elif isinstance(v, (dict, list)):
                lines.append(f"{spacer}{k}:")
                lines.append(dict_to_yaml(v, indent + 2))
            elif isinstance(v, bool):
                lines.append(f"{spacer}{k}: {str(v).lower()}")
            elif isinstance(v, (int, float)):
                lines.append(f"{spacer}{k}: {v}")
            else:
                v_str = str(v)
                # Quote values containing special characters or resolving to booleans/numbers
                needs_quotes = (
                    any(c in v_str for c in (":", "[", "]", "{", "}", ",", "#", "*", "&", "|", ">", "<", "=", "!")) or
                    v_str == "" or
                    v_str.lower() in ("true", "false", "yes", "no", "null") or
                    v_str.isdigit() or
                    (v_str.startswith("-") and v_str[1:].isdigit())
                )
                if needs_quotes:
                    escaped = v_str.replace('"', '\\"')
                    lines.append(f'{spacer}{k}: "{escaped}"')
                else:
                    lines.append(f"{spacer}{k}: {v_str}")
    elif isinstance(data, list):
        for item in data:
            if isinstance(item, (dict, list)):
                lines.append(f"{spacer}-")
                lines.append(dict_to_yaml(item, indent + 2))
            elif isinstance(item, bool):
                lines.append(f"{spacer}- {str(item).lower()}")
            elif isinstance(item, (int, float)):
                lines.append(f"{spacer}- {item}")
            else:
                item_str = str(item)
                needs_quotes = (
                    any(c in item_str for c in (":", "[", "]", "{", "}", ",", "#", "*", "&", "|", ">", "<", "=", "!")) or
                    item_str == "" or
                    item_str.lower() in ("true", "false", "yes", "no", "null") or
                    item_str.isdigit() or
                    (item_str.startswith("-") and item_str[1:].isdigit())
                )
                if needs_quotes:
                    escaped = item_str.replace('"', '\\"')
                    lines.append(f'{spacer}- "{escaped}"')
                else:
                    lines.append(f"{spacer}- {item_str}")
    return "\n".join(lines)

def generate_compose_dict(mode, efficient, local_db, rapid=False, include_nginx=False):
    """Builds the dictionary representation of docker-compose based on options."""
    services = {}

    # 1. Redis Service
    redis_service = {
        "image": "fdalabel-v3-redis:latest" if mode == "prod" else "bitnami/redis:latest",
        "container_name": "fdalabel-v3-redis",
        "restart": "always",
        "networks": ["default"],
        "environment": {
            "ALLOW_EMPTY_PASSWORD": "yes"
        }
    }
    if mode == "dev":
        redis_service["ports"] = ["6379:6379"]
    services["redis"] = redis_service

    # 2. Optional local DB Service
    if local_db:
        db_service = {
            "image": "fdalabel-v3-db:latest" if mode == "prod" else "ankane/pgvector:latest",
            "container_name": "fdalabel-v3-db",
            "restart": "always",
            "shm_size": "256mb" if efficient else "1gb",
            "volumes": ["./database/pgdata:/var/lib/postgresql/data"],
            "environment": {
                "POSTGRES_DB": "${PG_DATABASE:-fdalabel-v3}",
                "POSTGRES_USER": "${PG_USERNAME:-afd_user}",
                "POSTGRES_PASSWORD": "${PG_PASSWORD:-afd_password}"
            },
            "healthcheck": {
                "test": ["CMD-SHELL", "pg_isready -U $${POSTGRES_USER} -d $${POSTGRES_DB}"],
                "interval": "10s",
                "timeout": "5s",
                "retries": 5
            },
            "logging": {
                "driver": "json-file",
                "options": {
                    "max-size": "50m",
                    "max-file": "3"
                }
            }
        }
        if efficient:
            db_service["command"] = ["postgres", "-c", "max_connections=50", "-c", "shared_buffers=128MB", "-c", "work_mem=4MB"]
        else:
            db_service["command"] = ["postgres", "-c", "max_connections=300"]

        if mode == "dev":
            db_service["ports"] = ["${PG_PORT:-5432}:5432"]
        
        services["db"] = db_service

    # 3. Backend Service
    backend_env = {
        "FLASK_ENV": "development" if mode == "dev" else "production",
        "DATABASE_URL": "${DATABASE_URL:-postgresql://${PG_USERNAME:-afd_user}:${PG_PASSWORD:-afd_password}@${PG_HOST:-db}:${PG_PORT:-5432}/${PG_DATABASE:-fdalabel-v3}}",
        "BACKEND_PORT": 8842,
        "HOST": "0.0.0.0",
        "CELERY_BROKER_URL": "redis://redis:6379/0",
        "CELERY_RESULT_BACKEND": "redis://redis:6379/0"
    }

    if mode == "dev":
        backend_env["FLASK_APP"] = "app.py"
        backend_env["FLASK_DEBUG"] = 1
        backend_env["GUNICORN_WORKERS"] = 4
        backend_env["GUNICORN_THREADS"] = 8
    else:
        if efficient:
            backend_env["GUNICORN_WORKERS"] = 1
            backend_env["GUNICORN_THREADS"] = 2
        else:
            backend_env["GUNICORN_WORKERS"] = 4
            backend_env["GUNICORN_THREADS"] = 8

    backend_volumes = []
    if mode == "dev":
        backend_volumes.append("./backend:/app")
    backend_volumes.extend([
        "./data:/data",
        "./deploy:/deploy",
        "./backend/webtest/results:/app/webtest/results",
        "./backend/webtest/history:/app/webtest/history"
    ])


    backend_service = {
        "image": "fdalabel-v3-backend:latest",
        "container_name": "fdalabel-v3-backend",
        "env_file": ["./.env"],
        "environment": backend_env,
        "volumes": backend_volumes,
        "healthcheck": {
            "test": ["CMD-SHELL", "curl -f http://localhost:8842/health || exit 1"],
            "interval": "30s",
            "timeout": "10s",
            "retries": 5,
            "start_period": "10s"
        },
        "logging": {
            "driver": "json-file",
            "options": {
                "max-size": "50m",
                "max-file": "3"
            }
        },
        "restart": "always"
    }

    if not rapid:
        backend_service["build"] = {
            "context": "./backend",
            "dockerfile": "Dockerfile"
        }

    if mode == "dev":
        backend_service["command"] = ["python", "-m", "flask", "run", "--host=0.0.0.0", "--port=8842", "--reload"]
        backend_service["ports"] = ["8842:8842"]
    elif not include_nginx:
        backend_service["ports"] = ["8842:8842"]
    else:
        backend_service["expose"] = ["8842"]

    services["backend"] = backend_service

    # 4. Celery Worker Service
    celery_volumes = []
    if mode == "dev":
        celery_volumes.append("./backend:/app")
    celery_volumes.append("./data:/data")

    concurrency = 1 if efficient else 4
    celery_service = {
        "image": "fdalabel-v3-backend:latest",
        "container_name": "fdalabel-v3-celery",
        "command": ["sh", "-c", f"celery -A celery_app.celery worker --loglevel=info --concurrency={concurrency}"],
        "depends_on": ["redis"],
        "env_file": ["./.env"],
        "environment": {
            "FLASK_ENV": "production",
            "DATABASE_URL": "${DATABASE_URL:-postgresql://${PG_USERNAME:-afd_user}:${PG_PASSWORD:-afd_password}@${PG_HOST:-db}:${PG_PORT:-5432}/${PG_DATABASE:-fdalabel-v3}}",
            "CELERY_BROKER_URL": "redis://redis:6379/0",
            "CELERY_RESULT_BACKEND": "redis://redis:6379/0"
        },
        "volumes": celery_volumes,
        "restart": "always"
    }
    services["celery_worker"] = celery_service

    # 5. Frontend Service
    frontend_env = {
        "BACKEND_URL": "http://backend:8842",
        "BACKEND_PORT": 8842,
        "HOST": "0.0.0.0",
        "FRONTEND_PORT": 8841,
        "FRONTEND_BASE_PATH": "/fdalabel-v3"
    }
    if mode == "dev":
        frontend_env["NODE_ENV"] = "development"
    else:
        if efficient:
            frontend_env["NODE_OPTIONS"] = "--max-old-space-size=1024"

    frontend_volumes = []
    if mode == "dev":
        frontend_volumes.extend([
            "./frontend:/app",
            "/app/node_modules"
        ])
    frontend_volumes.append("./frontend/public:/app/public")

    frontend_service = {
        "image": "fdalabel-v3-frontend:latest",
        "container_name": "fdalabel-v3-frontend",
        "depends_on": ["backend"],
        "env_file": ["./.env"],
        "environment": frontend_env,
        "volumes": frontend_volumes,
        "healthcheck": {
            "test": ["CMD-SHELL", "curl -f http://localhost:8841/fdalabel-v3/ || exit 1"],
            "interval": "30s",
            "timeout": "10s",
            "retries": 5,
            "start_period": "10s"
        },
        "logging": {
            "driver": "json-file",
            "options": {
                "max-size": "50m",
                "max-file": "3"
            }
        },
        "restart": "always"
    }

    if not rapid:
        frontend_service["build"] = {
            "context": "./frontend",
            "dockerfile": "Dockerfile",
            "args": {
                "BUILD_ENV": "development" if mode == "dev" else "production"
            }
        }

    if mode == "dev":
        frontend_service["command"] = ["npm", "run", "dev"]
        frontend_service["ports"] = ["8841:8841"]
    elif not include_nginx:
        frontend_service["ports"] = ["8841:8841"]
    else:
        frontend_service["expose"] = ["8841"]

    services["frontend"] = frontend_service

    # 6. Nginx Service
    if include_nginx:
        nginx_service = {
            "image": "fdalabel-v3-nginx:latest",
            "build": {
                "context": "./deploy/nginx",
                "dockerfile": "Dockerfile"
            },
            "container_name": "fdalabel-v3-nginx",
            "depends_on": ["frontend", "backend"],
            "ports": ["80:80", "443:443"],
            "healthcheck": {
                "test": ["CMD-SHELL", "curl -f http://localhost/fdalabel-v3/ || exit 1"],
                "interval": "30s",
                "timeout": "5s",
                "retries": 5,
                "start_period": "10s"
            },
            "logging": {
                "driver": "json-file",
                "options": {
                    "max-size": "50m",
                    "max-file": "3"
                }
            },
            "restart": "always"
        }
        services["nginx"] = nginx_service

    compose_dict = {
        "services": services,
        "networks": {
            "default": {
                "name": "fdalabel-network"
            }
        }
    }
    return compose_dict

def check_and_prepare_image(image_name, base_image):
    """
    Checks if a local image exists. If not, attempts to pull the base image and tag it.
    """
    try:
        res = subprocess.run(["docker", "image", "inspect", image_name], 
                             stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        if res.returncode == 0:
            return True
    except Exception:
        # Docker not running or not in PATH; ignore check and let docker compose fail later
        return True

    print(f"[INFO] Production image '{image_name}' not found locally.")
    print(f"       Attempting to pull and tag base image '{base_image}'...")
    
    try:
        pull_res = subprocess.run(["docker", "pull", base_image], check=False)
        if pull_res.returncode != 0:
            return False
            
        tag_res = subprocess.run(["docker", "tag", base_image, image_name], check=False)
        if tag_res.returncode == 0:
            print(f"[SUCCESS] Successfully pulled and tagged '{image_name}'.")
            return True
    except Exception as e:
        print(f"[WARNING] Error preparing image: {e}")
        
    return False

def main():
    # Definition files and Docker compatibility paths are repository-relative.
    os.chdir(ROOT)
    parser = argparse.ArgumentParser(description="AskFDALabel stack orchestrator")
    parser.add_argument("--runtime", choices=["apptainer", "docker"], default="apptainer",
                        help="Runtime to use; Apptainer is the default and Docker Compose remains available explicitly")
    parser.add_argument("--mode", choices=["dev", "prod"], default="dev",
                        help="Deployment mode: 'dev' for local hot-reloaded development, 'prod' for production (default: 'dev')")
    parser.add_argument("--efficient", action="store_true",
                        help="Enable low-resource limits (reduced database connections, fewer gunicorn workers, memory limits)")
    parser.add_argument("--local-db", choices=["true", "false"], default=None,
                        help="Force using local PostgreSQL container ('true') or remote database ('false'). If omitted, read from LOCAL-PG in .env")
    parser.add_argument("--build", action="store_true",
                        help="Pass --build flag to docker compose up")
    parser.add_argument("--down", action="store_true",
                        help="Stop and clean up active containers (docker compose down)")
    parser.add_argument("--dry-run", action="store_true",
                        help="Generate docker-compose.yml but do not execute any docker compose commands")
    parser.add_argument("--rapid", action="store_true",
                        help="Start in rapid mode: no NGINX, no build, uses remote database by default")
    parser.add_argument("--nginx", action="store_true",
                        help="Force include and start Nginx service (under deploy/nginx) in the stack")

    args = parser.parse_args()

    if args.rapid:
        args.mode = "prod"

    # Load environment variables to resolve DB mode
    env_vars = load_env()
    
    # Resolve local-db option
    if args.local_db is not None:
        local_db_active = args.local_db == "true"
    elif args.rapid:
        local_db_active = False
    else:
        # Default to checking .env
        local_pg_val = env_vars.get("LOCAL-PG") or env_vars.get("LOCAL_PG")
        if local_pg_val is not None:
            local_db_active = local_pg_val.lower() in ("true", "1", "yes")
        else:
            local_db_active = True # Default fallback

    include_nginx = args.nginx or (args.mode == "prod" and not args.rapid)

    if args.runtime == 'apptainer':
        run_apptainer(args, env_vars, local_db_active)
        return

    print(f"Generating Docker Compose configuration...")
    print(f"  Mode:       {args.mode.upper()}")
    print(f"  Rapid:      {args.rapid}")
    print(f"  Efficient:  {args.efficient}")
    print(f"  Local DB:   {local_db_active}")
    print(f"  Nginx:      {include_nginx}")

    # Generate dictionary structure
    compose_dict = generate_compose_dict(args.mode, args.efficient, local_db_active, args.rapid, include_nginx)
    
    # Convert to YAML format
    yaml_content = "# Generated dynamically by start_server.py. Do not edit directly.\n"
    yaml_content += dict_to_yaml(compose_dict) + "\n"

    # Write to docker-compose.yml
    compose_file_path = Path("docker-compose.yml")
    compose_file_path.write_text(yaml_content, encoding="utf-8")
    print(f"Successfully generated and wrote {compose_file_path.resolve()}")

    if args.dry_run:
        print("Dry run active. Skipping docker compose execution.")
        return

    # Verify and prepare required images in production mode
    if args.mode == "prod" and not args.down:
        print("Verifying production base images...")
        redis_ok = check_and_prepare_image("fdalabel-v3-redis:latest", "bitnami/redis:latest")
        if not redis_ok:
            redis_ok = check_and_prepare_image("fdalabel-v3-redis:latest", "redis:alpine")
            
        db_ok = True
        if local_db_active:
            db_ok = check_and_prepare_image("fdalabel-v3-db:latest", "ankane/pgvector:latest")
            
        if not redis_ok or not db_ok:
            print("\n[ERROR] Missing required production images.")
            print("        If you are in an air-gapped/offline environment, you must load the")
            print("        packaged images first before running the startup server:")
            print("          - Linux:   ./deploy/load_images.sh")
            print("          - Windows: deploy\\load_images.bat")
            print("        Otherwise, ensure you are connected to the internet to allow automatic pulling.\n")
            sys.exit(1)

    # Construct and run docker compose command
    if args.down:
        cmd = ["docker", "compose", "down"]
    else:
        cmd = ["docker", "compose", "up", "-d"]
        if args.build:
            cmd.append("--build")

    print(f"Running command: {' '.join(cmd)}")
    try:
        subprocess.run(cmd, check=True)
        if not args.down:
            app_url = "http://localhost/fdalabel-v3/" if args.mode == "prod" and include_nginx else "http://localhost:8841/fdalabel-v3/"
            print("\n" + "=" * 60)
            print(f"[SUCCESS] askFDALabel ({args.mode.upper()} mode) is up and running!")
            print(f"          Application UI: {app_url}")
            if args.mode == "dev":
                print(f"          Backend API:    http://localhost:8842/health")
            print("=" * 60)
            print("\n[INFO] You have two standardized ways to manage this stack:")
            print("  Method 1: python start_server.py [--mode dev|prod] [--down] [--build]")
            print("  Method 2: docker compose up -d (using the generated docker-compose.yml)")
            print("            docker compose down  /  docker compose logs -f\n")
        else:
            print("\n[SUCCESS] Stack stopped and cleaned up successfully.")
    except FileNotFoundError:
        print("[ERROR] 'docker' command not found. Make sure Docker is installed and in your PATH.")
        sys.exit(1)
    except subprocess.CalledProcessError as e:
        print(f"[ERROR] Docker Compose command failed with code {e.returncode}")
        sys.exit(e.returncode)

if __name__ == "__main__":
    main()
