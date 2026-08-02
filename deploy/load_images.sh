#!/bin/bash
set -e

echo "==================================================="
echo "askFDALabel: Loading Docker Images (Linux/Unix)"
echo "==================================================="
echo

# Get directory of this script
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR/.."

# Define the set of possible images
ALL_IMAGES=("backend" "frontend" "nginx" "db" "redis")
IMAGES_TO_LOAD=()

# Parse arguments
SPECIFIED_TARGET=$1

if [ -n "$SPECIFIED_TARGET" ]; then
    # Convert to lowercase
    TARGET_LOWER=$(echo "$SPECIFIED_TARGET" | tr '[:upper:]' '[:lower:]')
    
    # Check if target is valid
    VALID=false
    for img in "${ALL_IMAGES[@]}"; do
        if [ "$TARGET_LOWER" == "$img" ]; then
            VALID=true
            IMAGES_TO_LOAD+=("$img")
            break
        fi
    done
    
    if [ "$VALID" == "false" ]; then
        echo "[ERROR] Invalid target: '$SPECIFIED_TARGET'. Valid choices are: backend, frontend, nginx, db, redis"
        exit 1
    fi
else
    # Default: Load all images whose archives are present
    for img in "${ALL_IMAGES[@]}"; do
        ARCHIVE_GZ="deploy/askfdalabel-$img.tar.gz"
        if [ -f "$ARCHIVE_GZ" ]; then
            IMAGES_TO_LOAD+=("$img")
        fi
    done
fi

if [ ${#IMAGES_TO_LOAD[@]} -eq 0 ]; then
    echo "[WARNING] No image archives found to load in deploy/ directory."
    exit 0
fi

echo "[INFO] Target images to load: ${IMAGES_TO_LOAD[*]}"
echo

for img in "${IMAGES_TO_LOAD[@]}"; do
    ARCHIVE_GZ="deploy/askfdalabel-$img.tar.gz"
    if [ -f "$ARCHIVE_GZ" ]; then
        echo "[INFO] Loading '$img' image from $ARCHIVE_GZ..."
        gunzip -c "$ARCHIVE_GZ" | docker load
    else
        echo "[ERROR] Archive not found: $ARCHIVE_GZ"
        exit 1
    fi
done

echo
echo "==================================================="
echo "Images loaded successfully!"
echo
echo "Next steps:"
echo "1. Ensure your .env file is configured correctly."
echo "2. Start the application stack:"
echo "   - For standard production deployment:"
echo "     python3 start_server.py --mode prod"
echo "   - For resource-efficient deployment (low-memory/t3.small):"
echo "     python3 start_server.py --mode prod --efficient"
echo "==================================================="
