#!/usr/bin/env python3
"""
restore_db.py — Restore the FDALabel PostgreSQL database from a dump archive.

Restores a custom-format dump (`.dump`) using `pg_restore` or a plain-SQL file
(`.sql`) using `psql` into either:
  1. A remote PostgreSQL database (default for RAPID environment, configured in `.env`), OR
  2. A local Docker container (`fdalabel-v3-db`).

Usage
-----
    # From repo root (reads credentials from .env):
    python deploy/rapid_migration/restore_db.py

    # Explicit input file / options:
    python deploy/rapid_migration/restore_db.py --input deploy/rapid_migration/fdalabel_db.dump
                                                [--clean] [--env-file PATH]
"""

import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = (
    SCRIPT_DIR.parents[1]
    if SCRIPT_DIR.name == "rapid_migration" and SCRIPT_DIR.parent.name == "deploy"
    else SCRIPT_DIR.parent
)

DEFAULT_INPUT = SCRIPT_DIR / "fdalabel_db.dump"
DEFAULT_ENV_FILE = REPO_ROOT / ".env"


# ---------------------------------------------------------------------------
# .env parser (no external dependencies)
# ---------------------------------------------------------------------------
def load_env(env_path: Path) -> dict:
    """Parse a .env file and return a dict of key→value pairs."""
    if not env_path.exists():
        print(f"[WARN] .env file not found at {env_path}; falling back to environment variables.")
        return {}

    raw: dict[str, str] = {}
    with env_path.open() as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" not in line:
                continue
            key, _, val = line.partition("=")
            key = key.strip()
            val = val.strip()

            # Strip inline comment
            if not (val.startswith('"') or val.startswith("'")):
                val = val.split(" #")[0].strip()

            # Strip quotes
            if len(val) >= 2 and val[0] in ('"', "'") and val[-1] == val[0]:
                val = val[1:-1]

            raw[key] = val

    # Second pass: expand ${VAR}
    import re
    def replacer(m):
        name = m.group("name")
        default = m.group("default") or ""
        return raw.get(name, os.environ.get(name, default))

    resolved: dict[str, str] = {}
    for key, val in raw.items():
        resolved[key] = re.sub(
            r"\$\{(?P<name>[^}:]+)(?::-(?P<default>[^}]*))?\}",
            replacer,
            val,
        )
    return resolved


def check_container_running(container: str) -> bool:
    """Return True if the named container is running."""
    result = subprocess.run(
        ["docker", "inspect", "--format", "{{.State.Running}}", container],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    return result.returncode == 0 and result.stdout.strip().lower() == "true"


def restore_via_local_cli(input_path: Path, host: str, port: str, db: str, user: str, password: str, clean: bool) -> None:
    """Restores using locally installed pg_restore or psql."""
    is_custom = input_path.suffix != ".sql"
    env = os.environ.copy()
    env["PGPASSWORD"] = password

    if is_custom:
        cmd = ["pg_restore", "-h", host, "-p", str(port), "-U", user, "-d", db, "--no-owner", "--no-privileges"]
        if clean:
            cmd.extend(["--clean", "--if-exists"])
        cmd.append(str(input_path))
        print(f"[RUN] {' '.join(cmd[:-1])} {input_path.name}")
        res = subprocess.run(cmd, env=env)
    else:
        cmd = ["psql", "-h", host, "-p", str(port), "-U", user, "-d", db]
        print(f"[RUN] {' '.join(cmd)} < {input_path.name}")
        with input_path.open("r") as f:
            res = subprocess.run(cmd, stdin=f, env=env)

    if res.returncode != 0:
        print(f"[ERROR] Restore command finished with code {res.returncode}", file=sys.stderr)
        sys.exit(res.returncode)


def restore_via_docker_exec(input_path: Path, container: str, db: str, user: str, password: str, clean: bool) -> None:
    """Restores by streaming into a running Docker database container."""
    is_custom = input_path.suffix != ".sql"

    if is_custom:
        pg_cmd = ["pg_restore", "-U", user, "-d", db, "--no-owner", "--no-privileges"]
        if clean:
            pg_cmd.extend(["--clean", "--if-exists"])
    else:
        pg_cmd = ["psql", "-U", user, "-d", db]

    docker_cmd = [
        "docker", "exec",
        "-i",
        "-e", f"PGPASSWORD={password}",
        container,
        *pg_cmd,
    ]

    print(f"[INFO] Restoring via container: {container}")
    print(f"[RUN]  {' '.join(docker_cmd)} < {input_path.name}")

    with input_path.open("rb") as in_fh:
        proc = subprocess.Popen(
            docker_cmd,
            stdin=in_fh,
            stderr=subprocess.PIPE,
        )
        _, stderr = proc.communicate()

    if proc.returncode != 0:
        err_msg = stderr.decode(errors="replace").strip()
        print(f"[WARNING] Restore finished with exit code {proc.returncode}:\n{err_msg}", file=sys.stderr)
    else:
        print("[OK]   Restore completed successfully.")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Restore FDALabel PostgreSQL database from a dump archive."
    )
    parser.add_argument(
        "--input", "-i",
        default=str(DEFAULT_INPUT),
        help=f"Source dump/sql file path (default: {DEFAULT_INPUT})",
    )
    parser.add_argument(
        "--env-file",
        default=str(DEFAULT_ENV_FILE),
        help=f"Path to .env file (default: {DEFAULT_ENV_FILE})",
    )
    parser.add_argument(
        "--clean",
        action="store_true",
        default=False,
        help="Drop database objects before recreating them (--clean for pg_restore).",
    )
    parser.add_argument(
        "--container", "-c",
        default="fdalabel-v3-db",
        help="Docker container name if restoring to local DB (default: fdalabel-v3-db)",
    )
    args = parser.parse_args()

    input_path = Path(args.input)
    if not input_path.exists():
        # Try finding .dump or .sql variant
        if input_path.with_suffix(".dump").exists():
            input_path = input_path.with_suffix(".dump")
        elif input_path.with_suffix(".sql").exists():
            input_path = input_path.with_suffix(".sql")
        else:
            print(f"[ERROR] Dump file not found at: {input_path}", file=sys.stderr)
            sys.exit(1)

    env = load_env(Path(args.env_file))

    pg_host = env.get("PG_HOST") or os.environ.get("PG_HOST", "localhost")
    pg_port = env.get("PG_PORT") or os.environ.get("PG_PORT", "5432")
    pg_db   = env.get("PG_DATABASE") or os.environ.get("PG_DATABASE", "askfdalabel")
    pg_user = env.get("PG_USERNAME") or os.environ.get("PG_USERNAME", "afd_user")
    pg_pass = env.get("PG_PASSWORD") or os.environ.get("PG_PASSWORD", "afd_password")
    local_pg = (env.get("LOCAL-PG") or env.get("LOCAL_PG", "false")).lower() in ("true", "1", "yes")

    print(f"==================================================")
    print(f" FDALabel Database Restore Utility")
    print(f"  Input Dump: {input_path} ({input_path.stat().st_size / (1024*1024):.1f} MB)")
    print(f"  Target Host:{pg_host}:{pg_port} (DB: {pg_db}, User: {pg_user})")
    print(f"  Local PG:   {local_pg}")
    print(f"==================================================")

    # Determine execution strategy
    has_local_pg_restore = shutil.which("pg_restore") is not None
    is_container_target = pg_host == "db" or (local_pg and check_container_running(args.container))

    if is_container_target:
        restore_via_docker_exec(
            input_path=input_path,
            container=args.container,
            db=pg_db,
            user=pg_user,
            password=pg_pass,
            clean=args.clean,
        )
    elif has_local_pg_restore:
        restore_via_local_cli(
            input_path=input_path,
            host=pg_host,
            port=pg_port,
            db=pg_db,
            user=pg_user,
            password=pg_pass,
            clean=args.clean,
        )
    else:
        # Fallback: run pg_restore via a temporary postgres docker container pointing to remote host
        print("[INFO] pg_restore not found on host. Running via temporary Docker container...")
        is_custom = input_path.suffix != ".sql"
        pg_cmd = ["pg_restore", "-h", pg_host, "-p", str(pg_port), "-U", pg_user, "-d", pg_db, "--no-owner", "--no-privileges"]
        if args.clean:
            pg_cmd.extend(["--clean", "--if-exists"])
        pg_cmd.append(f"/dump/{input_path.name}")

        docker_cmd = [
            "docker", "run", "--rm",
            "-v", f"{input_path.parent.resolve()}:/dump",
            "-e", f"PGPASSWORD={pg_pass}",
            "--network", "host",
            "ankane/pgvector:latest",
            *pg_cmd
        ]
        print(f"[RUN] {' '.join(docker_cmd[:-1])} ...")
        res = subprocess.run(docker_cmd)
        if res.returncode != 0:
            print(f"[ERROR] Restore via container failed with code {res.returncode}", file=sys.stderr)
            sys.exit(res.returncode)
        print("[OK]   Restore completed successfully.")

    print(f"[COMPLETE] Database restored successfully into {pg_db}@{pg_host}")


if __name__ == "__main__":
    main()
