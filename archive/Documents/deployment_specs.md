# Server Deployment Specifications

This document outlines the hardware requirements and AWS server recommendations for deploying the AskFDALabel-Suite at scale, specifically optimized for ~100 concurrent users.

## 🧮 The Resource Math

Based on the multi-container Docker architecture, the minimum baseline resources required are **~12GB of RAM** and **4+ CPU Cores**.

1. **Frontend (Next.js):** 
   - We allocate up to `4GB` of RAM (`NODE_OPTIONS="--max-old-space-size=4096"`) to prevent Out-of-Memory errors during heavy Server-Side Rendering (SSR).
2. **Backend (Flask/Gunicorn):** 
   - 4 workers (using the `gthread` worker class with 8 threads each) processing background LLM tasks and data formatting will comfortably consume `2GB - 4GB` of RAM. It requires at least **4 CPU cores** to prevent WSGI bottlenecks.
3. **Database (Postgres + pgvector):** 
   - With `300` max connections configured and vector searching enabled, PostgreSQL requires significant RAM for caching and sorting. It should be allocated at least `4GB`.

---

## ☁️ AWS Server Recommendations

### 1. The "Sweet Spot" (Recommended)
**Instance Type:** `m7i.xlarge` or `m6i.xlarge`
- **Specs:** 4 vCPUs, 16 GB RAM
- **Use Case:** This perfectly aligns with our 4-worker Gunicorn configuration. It provides exactly 1 dedicated CPU core per worker, while leaving 16GB of RAM to comfortably fit the Next.js frontend, Python backend, and PostgreSQL database.

### 2. The "Performance / Heavy-Load" Option
**Instance Type:** `m7i.2xlarge` or `m6i.2xlarge`
- **Specs:** 8 vCPUs, 32 GB RAM
- **Use Case:** If the 100 concurrent users are heavily using the AI search agents (which spawn multiple background threads) or generating massive Adverse Event (AE) reports simultaneously, you will want 8 vCPUs. This ensures the database, Next.js SSR, and background Python threads never have to wait in line for processing power.

---

## 💾 Storage Requirements (EBS Volume)

Regardless of the instance type, attach a **gp3 SSD** (General Purpose SSD) volume. `pgvector` and PostgreSQL database queries require fast disk read/write speeds. 
- **Size:** 250GB - 500GB.
