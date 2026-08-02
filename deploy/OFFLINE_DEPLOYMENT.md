# Offline Deployment Guide (No-Outbound Environment)

This guide provides instructions for deploying `askFDALabel` in an air-gapped or no-outbound environment where internet access (including `pip install`, `npm install`, and Hugging Face model fetching) is unavailable.

To avoid internet access during deployment, the application is packaged as pre-built Docker images on an internet-connected build machine, exported to a compressed archive, and then loaded onto the target offline machine.

SentenceTransformer and embedding-related dependencies have been removed from the core server runtime to ensure a lightweight and self-contained footprint (reducing image size by multiple gigabytes).

---

## 🛠️ Step 1: Package Images (On Internet-Connected Machine)

On a machine with internet access and Docker installed:

1. Clone or copy the `askFDALabel` repository.
2. Execute the packaging script depending on your OS:
   - **Windows:** Run `deploy\pack_images.bat`
   - **Linux/macOS:** Run `deploy/pack_images.sh` (ensure it is executable: `chmod +x deploy/pack_images.sh`)

This script will:
- Pull the third-party database image `ankane/pgvector:latest` and Redis image `redis:alpine`.
- Tag them for production deployment as `askfdalabel-db:latest` and `askfdalabel-redis:latest`.
- Build the core backend (`askfdalabel-backend:latest`), frontend (`askfdalabel-frontend:latest`), and nginx proxy (`askfdalabel-nginx:latest`) images using the production configuration.
- Export and compress these five images into separate archives in the `deploy/` directory (e.g. `askfdalabel-backend.tar.gz`, `askfdalabel-frontend.tar.gz`, etc.).

---

## 🚚 Step 2: Transfer Files to the Target Offline Machine

Transfer the following files from the build machine to the target offline machine (e.g., via USB drive, secure file transfer, or internal network share):

1. The image archives `deploy/askfdalabel-*.tar.gz` (you only need to transfer the ones that have been updated)
2. `.env` (configured for the target environment)
3. `docker-compose.prod.yml` and/or `docker-compose.efficient.yml` (at the root of the project)
4. `deploy/load_images.bat` (Windows) or `deploy/load_images.sh` (Linux)

Keep the directory structure intact:
```text
/your-deployment-folder/
├── docker-compose.prod.yml
├── docker-compose.efficient.yml
├── .env
└── deploy/
    ├── askfdalabel-backend.tar.gz
    ├── askfdalabel-frontend.tar.gz
    ├── askfdalabel-nginx.tar.gz
    ├── askfdalabel-db.tar.gz
    ├── askfdalabel-redis.tar.gz
    ├── load_images.bat
    └── load_images.sh
```

---

## 📥 Step 3: Load Images on Target Offline Machine

On the target offline machine:

1. Navigate to the deployment folder.
2. Run the load script:
   - **Windows:** Run `deploy\load_images.bat` (or specify a single component to update: `deploy\load_images.bat backend`)
   - **Linux/macOS:** Run `deploy/load_images.sh` (ensure it is executable: `chmod +x deploy/load_images.sh`, or specify a single component: `./deploy/load_images.sh backend`)

By default, the script scans for all available `.tar.gz` image archives in the `deploy/` directory and loads them. If an image name is specified as an argument (valid targets: `backend`, `frontend`, `nginx`, `db`, `redis`), it will load only that specific image.

---

## 🚀 Step 4: Start Services

> [!IMPORTANT]
> **Low-Memory Host Server Recommendation**: If you are deploying on a small virtual machine (such as a `t3.small` instance with 2 GB RAM), it is highly recommended to configure at least **2 GB to 4 GB of swap space** on the host. Without swap, container startup or background processes may crash due to Out-Of-Memory (OOM) conditions.

Once images are loaded, start the application containers using one of the following commands:

- **For Standard Production Deployments (Recommended for servers with >= 4 GB RAM):**
  ```bash
  docker compose -f docker-compose.prod.yml up -d
  ```

- **For Resource-Constrained Environments (Recommended for servers with 2 GB RAM, e.g. `t3.small`):**
  This profile runs fewer backend workers, a single Celery concurrency worker, and limits PostgreSQL shared memory/connections to minimize footprint.
  ```bash
  docker compose -f docker-compose.efficient.yml up -d
  ```

Verify that the containers are healthy:
```bash
docker compose -f docker-compose.prod.yml ps
# or
docker compose -f docker-compose.efficient.yml ps
```

---

## ⚙️ Step 5: Configure AI & Offline Database Settings

In the `.env` file on the target offline machine, adjust configurations to reflect the no-outbound environment:

### 1. Database & Queries
- Keep `LABEL_DB=POSTGRES` (default).
- Keep `LOCAL_QUERY=True` to run queries against the PostgreSQL database instead of external CDER or DailyMed production systems.
- **Database Connection Switch (Local vs. Standalone):** 
  To toggle between using the local PostgreSQL container (running via Docker Compose) and a standalone/external PostgreSQL server, edit the `DATABASE_URL` in your `.env` file:
  - **Local container database:**
    ```ini
    # Default local container database (host = db)
    DATABASE_URL=postgresql://afd_user:afd_password@db:5432/askfdalabel
    ```
  - **External/Standalone database:**
    ```ini
    # External connection string (specify actual host/IP, port, and credentials)
    DATABASE_URL=postgresql://your_user:your_password@your-external-host:5432/your_db
    ```
  - *Note: Docker Compose is configured to automatically forward the `.env` `DATABASE_URL` value to the backend. If `DATABASE_URL` is omitted, it defaults to the local container database.*

### 2. AI & LLM Provider
Since external API calls to Google Gemini (`GOOGLE_API_KEY`) will fail without outbound access, configure the app to use a **self-hosted or internal LLM** (e.g., Ollama or vLLM running on your local network):

- Set the provider to `llama`:
  ```ini
  # In your database or user profile preferences, set AI provider to 'llama'
  ```
- Configure the internal LLM endpoint:
  ```ini
  LLM_URL=http://<internal-llm-host>:<port>/v1
  LLM_KEY=your-internal-api-key-if-applicable
  LLM_MODEL=meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8  # or any internal model name
  ```

### 3. Embeddings
Since local SentenceTransformer embeddings are disabled in this mode, set:
```ini
EMBEDDING_PROVIDER=local
```
This will run the semantic search retriever in fallback mode (routing queries through keywords/exact matches) safely without hitting Hugging Face or failing.
