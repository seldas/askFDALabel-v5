#!/usr/bin/env bash
# Start or manage AskFDALabel on the dedicated RRC compute node from a login node.
#
# This script is intentionally a thin SLURM wrapper around:
#   python3 start_server.py --runtime apptainer [arguments]
# It therefore accepts the same operational arguments, for example:
#   ./start_fdalabelv3.sh --mode dev --build
#   ./start_fdalabelv3.sh --mode dev --down

set -euo pipefail

TARGET_NODE="ncshpcgpu01"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"

# These can be adjusted by the submitting user without changing the script.
# They reserve enough capacity for building images and starting the web stack.
SLURM_CPUS_PER_TASK="${ASKFDALABEL_CPUS_PER_TASK:-8}"
SLURM_MEMORY="${ASKFDALABEL_MEMORY:-32G}"
SLURM_TIME="${ASKFDALABEL_TIME:-02:00:00}"
BUILD_TMPDIR="${ASKFDALABEL_APPTAINER_TMPDIR:-/tempfs001/users/${USER}/apptainer}"

if ! command -v srun >/dev/null 2>&1; then
    echo "[ERROR] srun is required. Run this script from an RRC login node." >&2
    exit 1
fi

if [[ ! -f "${SCRIPT_DIR}/start_server.py" ]]; then
    echo "[ERROR] start_server.py was not found beside this script: ${SCRIPT_DIR}" >&2
    exit 1
fi

echo "[INFO] Requesting ${TARGET_NODE} through SLURM."
echo "[INFO] Running: python3 start_server.py --runtime apptainer $*"

srun \
    --nodes=1 \
    --ntasks=1 \
    --nodelist="${TARGET_NODE}" \
    --cpus-per-task="${SLURM_CPUS_PER_TASK}" \
    --mem="${SLURM_MEMORY}" \
    --time="${SLURM_TIME}" \
    --export="ALL,ASKFDALABEL_PROJECT_DIR=${SCRIPT_DIR},ASKFDALABEL_BUILD_TMPDIR=${BUILD_TMPDIR},ASKFDALABEL_TARGET_NODE=${TARGET_NODE}" \
    bash -lc '
        set -euo pipefail

        if [[ "$(hostname -s)" != "${ASKFDALABEL_TARGET_NODE}" ]]; then
            echo "[ERROR] SLURM did not place this run on ${ASKFDALABEL_TARGET_NODE}." >&2
            exit 1
        fi

        module load apptainer
        mkdir -p "${ASKFDALABEL_BUILD_TMPDIR}"
        export APPTAINER_TMPDIR="${ASKFDALABEL_BUILD_TMPDIR}"

        cd "${ASKFDALABEL_PROJECT_DIR}"
        exec python3 start_server.py --runtime apptainer "$@"
    ' bash "$@"
