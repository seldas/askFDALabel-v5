#!/usr/bin/env python3
"""
dump_db.py — Dump the FDALabel PostgreSQL database from its Docker container.

Uses `docker exec` to run `pg_dump` inside the running `fdalabel-v3-db`
container and streams the output directly to:

    deploy/rapid_migration/fdalabel_db.dump   (custom format, default)

Custom format (-Fc) is compact and restores cleanly via `pg_restore`.
Use --plain to write a plain-SQL .sql file instead.

Usage
-----
    # From the repo root:
    python deploy/rapid_migration/dump_db.py

    # Explicit options:
    python deploy/rapid_migration/dump_db.py [--plain] [--output PATH]
                                             [--container NAME] [--env-file PATH]
"""

import argparse
import os
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

DEFAULT_OUTPUT = SCRIPT_DIR / "fdalabel_db.dump"
DEFAULT_CONTAINER = "fdalabel-v3-db"
DEFAULT_ENV_FILE = REPO_ROOT / ".env"


# ---------------------------------------------------------------------------
# .env parser (no external dependencies)
# ---------------------------------------------------------------------------
def load_env(env_path: Path) -> dict:
    """Parse a .env file and return a dict of key→value pairs.

    Handles:
    - Comments (#)
    - Inline comments (stripped)
    - Quoted values
    - Variable references like ${VAR:-default}  (simple substitution only)
    - Blank lines
    """
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

            # Strip inline comment (not inside quotes)
            if not (val.startswith('"') or val.startswith("'")):
                val = val.split(" #")[0].strip()

            # Strip surrounding quotes
            if len(val) >= 2 and val[0] in ('"', "'") and val[-1] == val[0]:
                val = val[1:-1]

            raw[key] = val

    # Second pass: expand ${VAR} and ${VAR:-default}
    resolved: dict[str, str] = {}
    for key, val in raw.items():
        resolved[key] = _expand(val, raw)
    return resolved


def _expand(val: str, env: dict) -> str:
    """Expand ${VAR} / ${VAR:-default} references inside a value string."""
    import re

    def replacer(m):
        name = m.group("name")
        default = m.group("default") or ""
        return env.get(name, os.environ.get(name, default))

    return re.sub(
        r"\$\{(?P<name>[^}:]+)(?::-(?P<default>[^}]*))?\}",
        replacer,
        val,
    )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def check_container_running(container: str) -> bool:
    """Return True if the named container is running."""
    result = subprocess.run(
        ["docker", "inspect", "--format", "{{.State.Running}}", container],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    return result.returncode == 0 and result.stdout.strip().lower() == "true"


def run_pg_dump(
    container: str,
    db: str,
    user: str,
    password: str,
    output: Path,
    plain: bool,
) -> None:
    """Stream pg_dump output from the container to a local file."""
    fmt_flag = [] if plain else ["-Fc"]
    pg_dump_cmd = [
        "pg_dump",
        "-U", user,
        "-d", db,
        "--no-password",
        *fmt_flag,
    ]
    docker_cmd = [
        "docker", "exec",
        "-i",                        # keep stdin open (needed for piping)
        "-e", f"PGPASSWORD={password}",
        container,
        *pg_dump_cmd,
    ]

    suffix = ".sql" if plain else ".dump"
    if output.suffix not in (".dump", ".sql"):
        output = output.with_suffix(suffix)

    print(f"[INFO] Container : {container}")
    print(f"[INFO] Database  : {db}  (user: {user})")
    print(f"[INFO] Format    : {'plain SQL' if plain else 'custom (-Fc)'}")
    print(f"[INFO] Output    : {output}")
    print(f"[RUN]  {' '.join(docker_cmd)}")

    output.parent.mkdir(parents=True, exist_ok=True)

    with output.open("wb") as out_fh:
        proc = subprocess.Popen(
            docker_cmd,
            stdout=out_fh,
            stderr=subprocess.PIPE,
        )
        _, stderr = proc.communicate()

    if proc.returncode != 0:
        err_msg = stderr.decode(errors="replace").strip()
        print(f"[ERROR] pg_dump failed (exit {proc.returncode}):\n{err_msg}", file=sys.stderr)
        # Remove empty/partial file
        if output.exists() and output.stat().st_size == 0:
            output.unlink()
        sys.exit(proc.returncode)

    size_mb = output.stat().st_size / (1024 * 1024)
    print(f"[OK]   Dump written: {output}  ({size_mb:.1f} MB)")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main() -> None:
    parser = argparse.ArgumentParser(
        description="Dump the FDALabel PostgreSQL database from its Docker container."
    )
    parser.add_argument(
        "--output", "-o",
        default=str(DEFAULT_OUTPUT),
        help=f"Destination file path (default: {DEFAULT_OUTPUT})",
    )
    parser.add_argument(
        "--container", "-c",
        default=DEFAULT_CONTAINER,
        help=f"Docker container name (default: {DEFAULT_CONTAINER})",
    )
    parser.add_argument(
        "--env-file",
        default=str(DEFAULT_ENV_FILE),
        help=f"Path to the .env file (default: {DEFAULT_ENV_FILE})",
    )
    parser.add_argument(
        "--plain",
        action="store_true",
        default=False,
        help="Write plain SQL instead of custom (-Fc) format.",
    )
    args = parser.parse_args()

    # ---- Load credentials ------------------------------------------------
    env = load_env(Path(args.env_file))

    pg_db   = env.get("PG_DATABASE") or os.environ.get("PG_DATABASE", "askfdalabel")
    pg_user = env.get("PG_USERNAME") or os.environ.get("PG_USERNAME", "afd_user")
    pg_pass = env.get("PG_PASSWORD") or os.environ.get("PG_PASSWORD", "afd_password")

    # ---- Pre-flight checks -----------------------------------------------
    print(f"[INFO] Checking container '{args.container}' is running...")
    if not check_container_running(args.container):
        print(
            f"[ERROR] Container '{args.container}' is not running.\n"
            f"        Start the stack first:  python start_server.py --mode dev",
            file=sys.stderr,
        )
        sys.exit(1)
    print(f"[OK]   Container is running.")

    # ---- Dump ------------------------------------------------------------
    run_pg_dump(
        container=args.container,
        db=pg_db,
        user=pg_user,
        password=pg_pass,
        output=Path(args.output),
        plain=args.plain,
    )


if __name__ == "__main__":
    main()
