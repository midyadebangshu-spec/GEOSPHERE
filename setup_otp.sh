#!/usr/bin/env bash
###############################################################################
# GeoSphere WB+ — OpenTripPlanner Setup Script (Docker)
# --------------------------------------------
# Sets up the OpenTripPlanner (OTP) routing engine using Docker:
#   1. Prepares OTP data directory with OSM and GTFS files.
#   2. Builds the multi-modal routing graph (requires significant RAM).
#   3. Starts the OTP server on port 8080.
###############################################################################

set -euo pipefail
IFS=$'\n\t'

# ─── Configuration ───────────────────────────────────────────────────────────
readonly SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
readonly PBF_FILE="india-latest.osm.pbf"
readonly GTFS_FILE="mdb-2867-202605310101.zip"
readonly OTP_DATA_DIR="${SCRIPT_DIR}/otp-data"
readonly OTP_PORT="8080"
readonly OTP_CONTAINER="geosphere-otp"
readonly OTP_IMAGE="docker.io/opentripplanner/opentripplanner:latest"

# ─── Helpers ─────────────────────────────────────────────────────────────────
log() { echo -e "\n\033[1;34m[$(date '+%H:%M:%S')]\033[0m \033[1m$*\033[0m"; }
warn() { echo -e "\033[1;33m[WARNING]\033[0m $*"; }
err()  { echo -e "\033[1;31m[ERROR]\033[0m $*" >&2; }

SWAP_FILE="/swapfile_otp"
SWAP_ACTIVE=0
cleanup_swap() {
    if [[ "${SWAP_ACTIVE}" -eq 1 ]]; then
        echo "  - Removing temporary swap space..."
        swapoff "${SWAP_FILE}" 2>/dev/null || true
        rm -f "${SWAP_FILE}"
        SWAP_ACTIVE=0
    fi
}
trap cleanup_swap EXIT

# ─── Step 1: Check Docker ───────────────────────────────────────────────────
log "Step 1/3 — Checking Docker..."
if command -v docker &>/dev/null; then
    DOCKER_BIN="docker"
else
    err "Docker is not installed. Please run setup_osrm.sh first or install Docker."
    exit 1
fi

# ─── Step 2: Prepare Data ───────────────────────────────────────────────────
log "Step 2/3 — Preparing OTP data directory..."

mkdir -p "${OTP_DATA_DIR}"

if [[ ! -f "${SCRIPT_DIR}/${PBF_FILE}" ]]; then
    err "PBF file not found at ${SCRIPT_DIR}/${PBF_FILE}"
    exit 1
fi

if [[ ! -f "${SCRIPT_DIR}/${GTFS_FILE}" ]]; then
    err "GTFS file not found at ${SCRIPT_DIR}/${GTFS_FILE}"
    exit 1
fi

# Link/Copy files to OTP data directory
echo "  + Preparing PBF file..."
cp -u "${SCRIPT_DIR}/${PBF_FILE}" "${OTP_DATA_DIR}/" || ln -f "${SCRIPT_DIR}/${PBF_FILE}" "${OTP_DATA_DIR}/"

echo "  + Preparing GTFS file..."
# OTP auto-detects .zip files containing GTFS data; rename to include 'gtfs' for clarity
cp -u "${SCRIPT_DIR}/${GTFS_FILE}" "${OTP_DATA_DIR}/india-gtfs.zip" || ln -f "${SCRIPT_DIR}/${GTFS_FILE}" "${OTP_DATA_DIR}/india-gtfs.zip"


# ─── Step 3: Build Graph & Start Server ──────────────────────────────────────
log "Step 3/3 — Building graph and starting OpenTripPlanner..."

echo "  ↻ Pulling OTP image..."
"${DOCKER_BIN}" pull "${OTP_IMAGE}" || warn "Could not pull latest image; using cached version."

# Check if graph already exists (OTP 2.x produces graph.obj)
if [[ ! -f "${OTP_DATA_DIR}/graph.obj" ]]; then
    echo "  ⏳ Building OTP graph. This will use significant RAM and may take 15+ minutes..."
    
    echo "  + Allocating 20GB temporary swap to prevent Out-Of-Memory (OOM) crashes..."
    fallocate -l 20G "${SWAP_FILE}" 2>/dev/null || dd if=/dev/zero of="${SWAP_FILE}" bs=1M count=20480 status=progress
    chmod 600 "${SWAP_FILE}"
    mkswap "${SWAP_FILE}" >/dev/null
    swapon "${SWAP_FILE}"
    SWAP_ACTIVE=1
    echo "  ✓ Swap space activated."

    # Remove any leftover build container from a previous failed run
    "${DOCKER_BIN}" rm -f "${OTP_CONTAINER}_build" &>/dev/null || true

    # Build the graph.
    # We allocate 38G heap. With 32GB physical + 20GB swap this is safe, though it may be slow if it swaps heavily.
    echo "  ▶ Starting OTP graph build (38GB JVM heap)..."
    "${DOCKER_BIN}" run \
        --name "${OTP_CONTAINER}_build" \
        -v "${OTP_DATA_DIR}:/var/opentripplanner" \
        --entrypoint java \
        "${OTP_IMAGE}" \
        -Xmx38G -cp @/app/jib-classpath-file @/app/jib-main-class-file --build --save /var/opentripplanner || true
    
    # Check if graph.obj was successfully created
    if [[ ! -f "${OTP_DATA_DIR}/graph.obj" ]]; then
        echo ""
        err "Graph build failed! Dumping last 30 lines of build logs:"
        echo "─────────────────────────────────────────────────────"
        "${DOCKER_BIN}" logs --tail 30 "${OTP_CONTAINER}_build" 2>&1 || true
        echo "─────────────────────────────────────────────────────"
        err "Full logs: ${DOCKER_BIN} logs ${OTP_CONTAINER}_build"
        cleanup_swap
        exit 1
    fi
    
    "${DOCKER_BIN}" rm "${OTP_CONTAINER}_build" &>/dev/null || true
    
    echo "  ✓ OTP graph build complete."
    cleanup_swap
else
    echo "  ✓ Graph already built. Skipping build phase."
fi

# Stop existing container if running
if "${DOCKER_BIN}" ps -a --format '{{.Names}}' | grep -q "^${OTP_CONTAINER}$"; then
    echo "  ↻ Removing existing OTP container..."
    "${DOCKER_BIN}" rm -f "${OTP_CONTAINER}" &>/dev/null || true
fi

echo "  ▶ Starting OpenTripPlanner on port ${OTP_PORT}..."
# 12G heap for the running server (just loading the pre-built graph)
"${DOCKER_BIN}" run -d \
    --name "${OTP_CONTAINER}" \
    --restart unless-stopped \
    -p "${OTP_PORT}:8080" \
    -v "${OTP_DATA_DIR}:/var/opentripplanner" \
    --entrypoint /bin/bash \
    "${OTP_IMAGE}" \
    -c 'java -Xmx12G -cp @/app/jib-classpath-file @/app/jib-main-class-file /var/opentripplanner/ --load --serve'

echo -n "  Waiting for OTP to become ready"
MAX_WAIT=300
ELAPSED=0
while true; do
    if curl -s "http://localhost:${OTP_PORT}/otp/routers/default/" > /dev/null; then
        echo " ready!"
        echo "  ✓ OTP is running and responding."
        break
    fi

    sleep 5
    ELAPSED=$((ELAPSED + 5))
    echo -n "."

    if [[ ${ELAPSED} -ge ${MAX_WAIT} ]]; then
        echo ""
        warn "OTP did not become ready within ${MAX_WAIT}s. Check logs: ${DOCKER_BIN} logs ${OTP_CONTAINER}"
        break
    fi
done

log "═══════════════════════════════════════════════════════════════"
log "  OpenTripPlanner Setup Complete!"
log "═══════════════════════════════════════════════════════════════"
echo "  Container : ${OTP_CONTAINER}"
echo "  Port      : ${OTP_PORT}"
echo "  Test URL  : http://localhost:${OTP_PORT}/otp/routers/default/"
echo "  Manage:"
echo "    ${DOCKER_BIN} logs -f ${OTP_CONTAINER}"
echo "    ${DOCKER_BIN} stop ${OTP_CONTAINER}"
echo "    ${DOCKER_BIN} start ${OTP_CONTAINER}"
echo ""
