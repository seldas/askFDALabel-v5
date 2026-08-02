#!/bin/bash
set -e

echo "==================================================="
echo "askFDALabel: Packaging Docker Images (Linux/Unix)"
echo "==================================================="
echo

# Get directory of this script
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR/.."

echo "1. Pulling third-party base images..."
docker pull ankane/pgvector:latest
docker pull redis:alpine

echo "Tagging images for production..."
docker tag ankane/pgvector:latest askfdalabel-db:latest
docker tag redis:alpine askfdalabel-redis:latest

echo
echo "2. Generating production docker-compose.yml configuration..."
python3 start_server.py --mode prod --dry-run

echo
echo "3. Building all application images (backend, frontend, nginx)..."
docker compose build

echo
echo "4. Saving and compressing Docker images to separate archives..."
docker save askfdalabel-backend:latest | gzip > deploy/askfdalabel-backend.tar.gz
docker save askfdalabel-frontend:latest | gzip > deploy/askfdalabel-frontend.tar.gz
docker save askfdalabel-nginx:latest | gzip > deploy/askfdalabel-nginx.tar.gz
docker save askfdalabel-db:latest | gzip > deploy/askfdalabel-db.tar.gz
docker save askfdalabel-redis:latest | gzip > deploy/askfdalabel-redis.tar.gz

echo
print_success() {
  echo "==================================================="
  echo "Packaging successful!"
  echo "Transfer the following files/folders"
  echo "to the target no-outbound environment:"
  echo "- deploy/askfdalabel-*.tar.gz"
  echo "- .env"
  echo "- start_server.py"
  echo "- deploy/load_images.sh"
  echo "==================================================="
}
print_success
