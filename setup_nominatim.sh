#!/usr/bin/env bash
###############################################################################
# GeoSphere WB+ — Nominatim Setup Script (Docker)
# -------------------------------------------------
# Sets up Nominatim geocoding engine using the official Docker image:
#   1. Checks for Docker
#   2. Imports the West Bengal PBF into Nominatim's own database
#   3. Starts the Nominatim API on port 8088
#
# Prerequisites:
#   • Docker installed
#   • west-bengal-latest.osm.pbf in the project directory
#
# Usage:
#   chmod +x setup_nominatim.sh
#   ./setup_nominatim.sh
###############################################################################

set -euo pipefail
IFS=$'\n\t'

# ─── Configuration ───────────────────────────────────────────────────────────
readonly SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
readonly PBF_FILE="eastern-zone-latest.osm.pbf"
readonly NOM_PORT="8088"
readonly NOM_CONTAINER="geosphere-nominatim"
readonly NOM_IMAGE="mediagis/nominatim:4.4"
readonly NOM_DATA_DIR="${SCRIPT_DIR}/nominatim-data"

# ─── Helpers ─────────────────────────────────────────────────────────────────
log() { echo -e "\n\033[1;34m[$(date '+%H:%M:%S')]\033[0m \033[1m$*\033[0m"; }
warn() { echo -e "\033[1;33m[WARNING]\033[0m $*"; }
err()  { echo -e "\033[1;31m[ERROR]\033[0m $*" >&2; }

# ─── Step 1: Verify Prerequisites ───────────────────────────────────────────
log "Step 1/3 — Verifying prerequisites..."

if ! command -v docker &>/dev/null; then
    err "Docker is not installed. Run setup_osrm.sh first (it installs Docker) or install manually."
    exit 1
fi
echo "  ✓ Docker found."

if [[ ! -f "${SCRIPT_DIR}/${PBF_FILE}" ]]; then
    err "PBF file not found at ${SCRIPT_DIR}/${PBF_FILE}"
    err "Run setup_data_pipeline.sh first."
    exit 1
fi
echo "  ✓ PBF file found."

# Ensure Docker is running
if ! sudo systemctl is-active --quiet docker; then
    sudo systemctl start docker
fi

# Pull image
log "Pulling Nominatim Docker image (this may take a while)..."
sudo docker pull "${NOM_IMAGE}"

# ─── Step 2: Prepare Data Directory ─────────────────────────────────────────
log "Step 2/3 — Preparing data directory..."

mkdir -p "${NOM_DATA_DIR}"

# Copy PBF if not already in the data dir
if [[ ! -f "${NOM_DATA_DIR}/${PBF_FILE}" ]]; then
    echo "  + Copying PBF to Nominatim data directory..."
    cp "${SCRIPT_DIR}/${PBF_FILE}" "${NOM_DATA_DIR}/"
fi

# ─── Step 3: Start Nominatim Container ──────────────────────────────────────
log "Step 3/3 — Starting Nominatim container..."

# Stop existing container if running
if sudo docker ps -a --format '{{.Names}}' | grep -q "^${NOM_CONTAINER}$"; then
    echo "  ↻ Removing existing Nominatim container..."
    sudo docker rm -f "${NOM_CONTAINER}" &>/dev/null || true
fi

echo ""
echo "  ⏳ Nominatim will import the PBF data on first start."
echo "     This can take 15-45 minutes for Eastern Zone data."
echo "     Monitor progress with: docker logs -f ${NOM_CONTAINER}"
echo ""

echo "  + Allocating 4GB temporary swap to prevent Out-Of-Memory (OOM) crashes during import..."
sudo fallocate -l 4G /swapfile_nom || sudo dd if=/dev/zero of=/swapfile_nom bs=1M count=4096 status=none
sudo chmod 600 /swapfile_nom
sudo mkswap /swapfile_nom >/dev/null
sudo swapon /swapfile_nom

sudo docker run -d \
    --name "${NOM_CONTAINER}" \
    --restart unless-stopped \
    -p "${NOM_PORT}:8080" \
    -e PBF_PATH="/nominatim/data/${PBF_FILE}" \
    -e REPLICATION_URL="https://download.geofabrik.de/asia/india/eastern-zone-updates/" \
    -e NOMINATIM_PASSWORD="geosphere_nom_2024" \
    -e IMPORT_STYLE="full" \
    -e THREADS="$(nproc)" \
    -v "${NOM_DATA_DIR}:/nominatim/data" \
    -v "${SCRIPT_DIR}/nominatim-postgres:/var/lib/postgresql/14/main" \
    --shm-size=1g \
    "${NOM_IMAGE}"

echo "  ✓ Nominatim container started."

# Wait for the import to complete and API to be ready
echo ""
echo -n "  Waiting for Nominatim API to become available"
MAX_WAIT=1800    # 30 minutes max wait for import
ELAPSED=0
while ! curl -s "http://localhost:${NOM_PORT}/status.php" 2>/dev/null | grep -q "OK"; do
    sleep 10
    ELAPSED=$((ELAPSED + 10))
    echo -n "."
    if [[ $ELAPSED -ge $MAX_WAIT ]]; then
        echo ""
        warn "Nominatim is still importing after ${MAX_WAIT}s."
        warn "It may still be processing. Monitor with: docker logs -f ${NOM_CONTAINER}"
        break
    fi
done

if curl -s "http://localhost:${NOM_PORT}/status.php" 2>/dev/null | grep -q "OK"; then
    echo " ready!"
fi

echo "  - Removing temporary swap space..."
sudo swapoff /swapfile_nom || true
sudo rm -f /swapfile_nom

log "═══════════════════════════════════════════════════════════════"
log "  Nominatim Setup Complete!"
log "═══════════════════════════════════════════════════════════════"
echo ""
echo "  Container  : ${NOM_CONTAINER}"
echo "  Port       : ${NOM_PORT}"
echo "  Search URL : http://localhost:${NOM_PORT}/search?q=Kolkata&format=json"
echo "  Reverse    : http://localhost:${NOM_PORT}/reverse?lat=22.5726&lon=88.3639&format=json"
echo "  Status     : http://localhost:${NOM_PORT}/status.php"
echo ""
echo "  Manage:"
echo "    docker logs -f ${NOM_CONTAINER}"
echo "    docker stop ${NOM_CONTAINER}"
echo "    docker start ${NOM_CONTAINER}"
echo ""
