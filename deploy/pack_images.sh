#!/bin/bash
set -e

echo "==================================================="
echo "fdalabel-v3: Packaging Docker Images (Linux/Unix)"
echo "==================================================="
echo

# Get directory of this script
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR/.."

echo "1. Pulling third-party base images..."
docker pull ankane/pgvector:latest
docker pull redis:alpine

echo "Tagging images for production..."
docker tag ankane/pgvector:latest fdalabel-v3-db:latest
docker tag redis:alpine fdalabel-v3-redis:latest

echo
echo "2. Generating production docker-compose.yml configuration..."
python3 start_server.py --mode prod --dry-run

echo
echo "3. Building all application images (backend, frontend, nginx)..."
docker compose build

echo
echo "4. Saving and compressing Docker images to separate archives..."
docker save fdalabel-v3-backend:latest | gzip > deploy/fdalabel-v3-backend.tar.gz
docker save fdalabel-v3-frontend:latest | gzip > deploy/fdalabel-v3-frontend.tar.gz
docker save fdalabel-v3-nginx:latest | gzip > deploy/fdalabel-v3-nginx.tar.gz
docker save fdalabel-v3-db:latest | gzip > deploy/fdalabel-v3-db.tar.gz
docker save fdalabel-v3-redis:latest | gzip > deploy/fdalabel-v3-redis.tar.gz

echo
print_success() {
  echo "==================================================="
  echo "Packaging successful!"
  echo "Transfer the following files/folders"
  echo "to the target no-outbound environment:"
  echo "- deploy/fdalabel-v3-*.tar.gz"
  echo "- .env"
  echo "- start_server.py"
  echo "- deploy/load_images.sh"
  echo "==================================================="
}
print_success
