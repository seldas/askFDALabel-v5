# Server Management & Deployment Orchestration

## 1. Overview

The platform provides a single standardized orchestration CLI: [`start_server.py`](file:///d:/Coding/askFDALabel_v5/start_server.py). 

This script inspects `.env`, resolves deployment topologies, generates `docker-compose.yml` on the fly, and manages the container lifecycle.

---

## 2. Standard Server Modes

### Mode 1: Development (`--mode dev`)
Hot-reloading enabled for both frontend (Next.js HMR) and backend (Flask reload).
```bash
python start_server.py --mode dev
```
- **Web UI**: `http://localhost:8841`
- **Backend API**: `http://localhost:8842`
- **Mounts**: Mounts `./backend` and `./frontend` directly from the host filesystem.

### Mode 2: Production (`--mode prod`)
Optimized production containers behind Nginx reverse proxy.
```bash
python start_server.py --mode prod
```
- **Web UI & API**: Exposed through Nginx on port `80` (HTTP) or `443` (HTTPS).
- **Paths**: UI on `/fdalabel-v3`, API on `/fdalabel-v3_api`.

### Mode 3: Rapid Migration Mode (`--rapid`)
Used for quick restoration and migration to environments with existing remote databases.
```bash
python start_server.py --rapid
```
- Implies production build (`mode = prod`).
- Bypasses internal Nginx container (allowing host Nginx proxying).
- Automatically sets `local_db = false`, connecting directly to remote PostgreSQL.
- Directly publishes ports `8841:8841` and `8842:8842`.

---

## 3. Command-Line Reference

| Flag | Purpose | Default |
|---|---|---|
| `--mode dev\|prod` | Execution mode (development HMR vs production stack) | `dev` |
| `--rapid` | Start in rapid mode (remote DB, no internal nginx, production containers) | `False` |
| `--efficient` | Lower pool and Celery worker concurrency for constrained hardware | `False` |
| `--local-db true\|false`| Explicitly override `LOCAL-PG` from `.env` | Read from `.env` |
| `--build` | Force rebuild of Docker container images | `False` |
| `--down` | Stop and clean up all active containers | `False` |
| `--dry-run` | Generate `docker-compose.yml` without executing Docker commands | `False` |
| `--nginx` | Force include internal Nginx container even in non-default modes | `False` |
| `--runtime docker\|apptainer` | Target container runtime | `docker` |

### Common Operational Commands:
```bash
# Clean up and stop containers
python start_server.py --mode dev --down

# Rebuild containers after code changes
python start_server.py --mode prod --build

# Generate compose configuration without starting
python start_server.py --mode prod --dry-run
```

---

## 4. Health Checks

- **Backend Health Endpoint**: `http://localhost:8842/health`
- **Container Status**:
  ```bash
  docker compose ps
  docker compose logs -f backend
  ```
