# Environment Configuration & `.env` Variable Reference

## 1. Overview

AskFDALabel requires a root `.env` file before importing or starting any backend service. Backend entry points validate database and core credentials at import time via `backend/dashboard/config.py`.

Templates are provided at:
- `.env.template`: Standard configuration template.
- `.env.rapid.template`: Pre-tuned template for rapid deployment connecting to external PostgreSQL.

---

## 2. Variable Dictionary

### 2.1 Core & Security
| Variable | Description | Default / Example |
|---|---|---|
| `SECRET_KEY` | Flask session encryption key. Must be set to a strong random secret in production. | `afd-psw-prod` (in dev) |
| `FLASK_ENV` | Application environment (`development` or `production`). | `development` |
| `NEXT_PUBLIC_APP_BASE` | Base path prefix for frontend UI. | `/fdalabel-v3` |
| `NEXT_PUBLIC_API_BASE` | Base path prefix for backend API behind proxy. | `/fdalabel-v3_api` |

### 2.2 PostgreSQL Database
| Variable | Description | Default / Example |
|---|---|---|
| `LOCAL-PG` / `LOCAL_PG` | Whether to launch internal Docker PostgreSQL (`true`) or use remote DB (`false`). | `true` |
| `DATABASE_URL` | Full PostgreSQL connection URI. | `postgresql://afd_user:afd_password@db:5432/askfdalabel` |
| `PG_HOST` | Hostname or IP of PostgreSQL instance. | `localhost` or `db` |
| `PG_PORT` | PostgreSQL listening port. | `5432` |
| `PG_DATABASE` | Database name. | `askfdalabel` |
| `PG_USERNAME` | Database username. | `afd_user` |
| `PG_PASSWORD` | Database password. | `afd_password` |
| `DB_POOL_SIZE` | SQLAlchemy connection pool size. | `20` |
| `DB_MAX_OVERFLOW` | Maximum overflow connections beyond pool size. | `40` |

### 2.3 Redis & Celery
| Variable | Description | Default / Example |
|---|---|---|
| `CELERY_BROKER_URL` | Redis URL for Celery task queuing. | `redis://redis:6379/0` (or `localhost`) |
| `CELERY_RESULT_BACKEND` | Redis backend for Celery results. | `redis://redis:6379/0` |

### 2.4 AI Model Providers
| Variable | Description | Default / Example |
|---|---|---|
| `ALLOWED_AI_PROVIDERS` | Comma-separated list of permitted AI backends. | `gemini,elsa,llama,vllm,ollama,customized` |
| `DEFAULT_AI_MODEL` | Default provider assigned to new sessions. | `gemini` (external) / `elsa` (internal) |
| `GEMINI_API_KEY` | Google Gemini API key (from Google AI Studio). | `AIzaSy...` |
| `GEMINI_MODEL` | Default Gemini model ID. | `gemini-2.5-flash` |
| `ELSA_API_NAME` | FDA internal ELSA API service name. | `elsa-prod` |
| `ELSA_API_KEY` | FDA internal ELSA API authentication key. | `...` |
| `LLM_URL` | URL for custom OpenAI-compatible endpoint (vLLM / Ollama). | `http://localhost:11434/v1` |
| `LLM_KEY` | Authorization key for custom OpenAI-compatible endpoint. | `EMPTY` |
| `LLM_MODEL` | Target model name for custom OpenAI-compatible endpoint. | `llama-3.3-70b-instruct` |

### 2.5 Oracle FDALabel Connectivity (Optional)
| Variable | Description | Default / Example |
|---|---|---|
| `FDALabel_HOST` | Oracle database host. | `ncsvmscidevl03.fda.gov` |
| `FDALabel_PORT` | Oracle database port. | `1521` |
| `FDALabel_SERVICE`| Oracle service name / SID. | `scidevl3` |
| `FDALabel_USER` | Oracle database username. | `lwu` |
| `FDALabel_PASSWORD`| Oracle database password. | `...` |

### 2.6 Storage Paths
| Variable | Description | Default / Example |
|---|---|---|
| `DATA_DIR` | Absolute or relative path to persistent data root. | `/data` (container) or `./data` |
| `SPL_STORAGE_DIR` | Directory containing primary DailyMed SPL ZIPs. | `DATA_DIR/spl_storage` |
| `SPL_STORAGE_DIR_ARCHIVED` | Directory containing archived SPL XMLs. | `DATA_DIR/spl_storage_archived` |
| `SPL_CACHE_DIR` | Directory for dynamic read-through Oracle SPL XML cache. | `DATA_DIR/spl_cache` |
