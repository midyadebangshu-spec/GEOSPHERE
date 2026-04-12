#!/usr/bin/env bash
###############################################################################
# GeoSphere WB+ — OSRM Setup Script (Docker)
# --------------------------------------------
# Sets up the OSRM routing engine using Docker:
#   1. Installs Docker if not present
#   2. Processes West Bengal PBF (extract → partition → customize)
#   3. Starts osrm-routed on port 5000 using the MLD algorithm
#
# Prerequisites:
#   • west-bengal-latest.osm.pbf in the project directory
#
# Usage:
#   chmod +x setup_osrm.sh
#   ./setup_osrm.sh
###############################################################################

set -euo pipefail
IFS=$'\n\t'

# ─── Configuration ───────────────────────────────────────────────────────────
readonly SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
readonly PBF_FILE="eastern-zone-latest.osm.pbf"
readonly OSRM_DATA_DIR="${SCRIPT_DIR}/osrm-data"
readonly OSRM_PORT="5000"
readonly OSRM_CONTAINER="geosphere-osrm"
readonly OSRM_IMAGE="osrm/osrm-backend"
readonly ROUTING_PROFILE="/opt/car.lua"      # Options: /opt/car.lua, /opt/bicycle.lua, /opt/foot.lua

# ─── Helpers ─────────────────────────────────────────────────────────────────
log() { echo -e "\n\033[1;34m[$(date '+%H:%M:%S')]\033[0m \033[1m$*\033[0m"; }
warn() { echo -e "\033[1;33m[WARNING]\033[0m $*"; }
err()  { echo -e "\033[1;31m[ERROR]\033[0m $*" >&2; }

# ─── Step 1: Check Docker ───────────────────────────────────────────────────
log "Step 1/4 — Checking Docker..."

if command -v docker &>/dev/null; then
    echo "  ✓ Docker found: $(docker --version)"
else
    log "Installing Docker..."
    sudo apt-get update -qq
    sudo apt-get install -y ca-certificates curl gnupg
    sudo install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    sudo chmod a+r /etc/apt/keyrings/docker.gpg
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
        sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
    sudo apt-get update -qq
    sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
    sudo usermod -aG docker "${USER}"
    echo "  ✓ Docker installed. You may need to log out/in for group changes."
fi

# Ensure Docker daemon is running
if ! sudo systemctl is-active --quiet docker; then
    sudo systemctl start docker
    sudo systemctl enable docker
fi

# Pull OSRM image
log "Pulling OSRM Docker image..."
sudo docker pull "${OSRM_IMAGE}" || true

# ─── Step 2: Prepare Data ───────────────────────────────────────────────────
log "Step 2/4 — Preparing OSRM data directory..."

mkdir -p "${OSRM_DATA_DIR}"

if [[ ! -f "${SCRIPT_DIR}/${PBF_FILE}" ]]; then
    err "PBF file not found at ${SCRIPT_DIR}/${PBF_FILE}"
    err "Run setup_data_pipeline.sh first to download the OSM data."
    exit 1
fi

# Copy PBF to OSRM data directory (if not already there)
if [[ ! -f "${OSRM_DATA_DIR}/${PBF_FILE}" ]]; then
    echo "  + Copying PBF to OSRM data directory..."
    cp "${SCRIPT_DIR}/${PBF_FILE}" "${OSRM_DATA_DIR}/"
fi

# ─── Step 3: Process Data (Extract → Partition → Customize) ─────────────────
log "Step 3/4 — Processing OSM data for routing..."

OSRM_FILE="${OSRM_DATA_DIR}/$(basename ${PBF_FILE} .osm.pbf).osrm"

if [[ -f "${OSRM_FILE}.cell_metrics" ]]; then
    echo "  ✓ OSRM data already processed. Skipping."
    echo "    Delete ${OSRM_DATA_DIR}/*.osrm* files to force re-processing."
else
    echo ""
    echo "  ⏳ This will take 5-15 minutes depending on hardware."
    echo "  + Allocating 4GB temporary swap to prevent Out-Of-Memory (OOM) crashes..."
    sudo fallocate -l 4G /swapfile_osrm || sudo dd if=/dev/zero of=/swapfile_osrm bs=1M count=4096 status=none
    sudo chmod 600 /swapfile_osrm
    sudo mkswap /swapfile_osrm >/dev/null
    sudo swapon /swapfile_osrm

    # Step 3a: Extract
    echo "  [1/3] Extracting routing graph..."
    sudo docker run --rm \
        -v "${OSRM_DATA_DIR}:/data" \
        "${OSRM_IMAGE}" \
        osrm-extract -p "${ROUTING_PROFILE}" "/data/${PBF_FILE}"

    # Step 3b: Partition
    echo "  [2/3] Partitioning graph..."
    sudo docker run --rm \
        -v "${OSRM_DATA_DIR}:/data" \
        "${OSRM_IMAGE}" \
        osrm-partition "/data/$(basename ${PBF_FILE} .osm.pbf).osrm"

    # Step 3c: Customize
    echo "  [3/3] Customizing graph..."
    sudo docker run --rm \
        -v "${OSRM_DATA_DIR}:/data" \
        "${OSRM_IMAGE}" \
        osrm-customize "/data/$(basename ${PBF_FILE} .osm.pbf).osrm"

    echo "  - Removing temporary swap space..."
    sudo swapoff /swapfile_osrm || true
    sudo rm -f /swapfile_osrm

    echo "  ✓ OSRM data processing complete."
fi

# ─── Step 4: Start OSRM Router ──────────────────────────────────────────────
log "Step 4/4 — Starting OSRM routing server..."

# Stop existing container if running
if sudo docker ps -a --format '{{.Names}}' | grep -q "^${OSRM_CONTAINER}$"; then
    echo "  ↻ Removing existing OSRM container..."
    sudo docker rm -f "${OSRM_CONTAINER}" &>/dev/null || true
fi

echo "  ▶ Starting osrm-routed on port ${OSRM_PORT}..."
sudo docker run -d \
    --name "${OSRM_CONTAINER}" \
    --restart unless-stopped \
    -p "${OSRM_PORT}:5000" \
    -v "${OSRM_DATA_DIR}:/data" \
    "${OSRM_IMAGE}" \
    osrm-routed \
    --algorithm mld \
    --max-table-size 10000 \
    "/data/$(basename ${PBF_FILE} .osm.pbf).osrm"

# Wait for it to be ready
sleep 3
if curl -s "http://localhost:${OSRM_PORT}/route/v1/driving/88.3639,22.5726;88.2636,22.5958" | grep -q "Ok"; then
    echo "  ✓ OSRM is running and responding."
else
    warn "OSRM started but test query didn't return 'Ok'. Check 'docker logs ${OSRM_CONTAINER}'."
fi

log "═══════════════════════════════════════════════════════════════"
log "  OSRM Setup Complete!"
log "═══════════════════════════════════════════════════════════════"
echo ""
echo "  Container : ${OSRM_CONTAINER}"
echo "  Port      : ${OSRM_PORT}"
echo "  Test URL  : http://localhost:${OSRM_PORT}/route/v1/driving/88.3639,22.5726;88.2636,22.5958"
echo "  Profile   : car"
echo ""
echo "  Manage:"
echo "    docker logs ${OSRM_CONTAINER}"
echo "    docker stop ${OSRM_CONTAINER}"
echo "    docker start ${OSRM_CONTAINER}"
echo ""
