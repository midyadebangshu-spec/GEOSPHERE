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
NOM_PORT_WAS_SET="${NOM_PORT+x}"
NOM_PORT="${NOM_PORT:-8088}"
NOM_PASSWORD_WAS_SET="${NOMINATIM_PASSWORD+x}"
NOMINATIM_PASSWORD="${NOMINATIM_PASSWORD:-}"
readonly NOM_CONTAINER="geosphere-nominatim"
readonly NOM_IMAGE="mediagis/nominatim:4.4"
readonly NOM_DATA_DIR="${SCRIPT_DIR}/nominatim-data"
readonly NOM_PG_HOST_DIR="${SCRIPT_DIR}/nominatim-postgres"
readonly NOM_PG_TARGET_DIR="${NOM_PG_TARGET_DIR:-/var/lib/postgresql/14/main}"

# ─── Helpers ─────────────────────────────────────────────────────────────────
log() { echo -e "\n\033[1;34m[$(date '+%H:%M:%S')]\033[0m \033[1m$*\033[0m"; }
warn() { echo -e "\033[1;33m[WARNING]\033[0m $*"; }
err()  { echo -e "\033[1;31m[ERROR]\033[0m $*" >&2; }

DOCKER_BIN=""
SWAP_ACTIVE=0
NOM_STATE_FILE="${NOM_DATA_DIR}/.nominatim_setup_state"

cleanup() {
    if [[ "${SWAP_ACTIVE}" -eq 1 ]]; then
        echo "  - Removing temporary swap space..."
        sudo swapoff /swapfile_nom || true
        sudo rm -f /swapfile_nom
    fi
}
trap cleanup EXIT

get_listener_pid() {
    local port="$1"
    local pid=""

    if command -v ss &>/dev/null; then
        pid=$(sudo ss -ltnp "( sport = :${port} )" 2>/dev/null | awk -F'pid=' 'NR>1 && /pid=/ {split($2,a,","); print a[1]; exit}')
    fi

    if [[ -z "${pid}" ]] && command -v lsof &>/dev/null; then
        pid=$(sudo lsof -t -iTCP:"${port}" -sTCP:LISTEN 2>/dev/null | head -1 || true)
    fi

    echo "${pid}"
}

persist_nom_state() {
    cat > "${NOM_STATE_FILE}" <<EOF
NOM_PORT=${NOM_PORT}
NOMINATIM_PASSWORD=${NOMINATIM_PASSWORD}
EOF
}

is_nominatim_ready() {
    local body
    body=$(curl -fsS "http://localhost:${NOM_PORT}/status.php" 2>/dev/null || true)
    [[ "${body}" =~ (^|[^A-Za-z])OK([^A-Za-z]|$) ]]
}

generate_password() {
    local generated=""
    set +o pipefail
    generated="$(tr -dc 'A-Za-z0-9' </dev/urandom | head -c 24)"
    set -o pipefail
    if [[ -z "${generated}" ]]; then
        err "Failed to generate random password. Set NOMINATIM_PASSWORD and rerun."
        exit 1
    fi
    printf '%s' "${generated}"
}

ensure_docker_running() {
    if sudo "${DOCKER_BIN}" info >/dev/null 2>&1; then
        return 0
    fi

    if systemctl list-unit-files 2>/dev/null | grep -q '^docker\.service'; then
        sudo systemctl start docker
        sudo systemctl enable docker
    elif systemctl list-unit-files 2>/dev/null | grep -q '^snap\.docker\.dockerd\.service'; then
        sudo systemctl start snap.docker.dockerd
        sudo systemctl enable snap.docker.dockerd >/dev/null 2>&1 || true
    elif command -v snap >/dev/null 2>&1; then
        sudo snap start docker >/dev/null 2>&1 || true
        sudo snap start --enable docker >/dev/null 2>&1 || true
    fi

    if ! sudo "${DOCKER_BIN}" info >/dev/null 2>&1; then
        err "Docker daemon is not running or not reachable with ${DOCKER_BIN}."
        err "Start Docker manually (e.g. 'sudo snap start docker' for snap installs) and rerun."
        exit 1
    fi
}

# ─── Step 1: Verify Prerequisites ───────────────────────────────────────────
log "Step 1/3 — Verifying prerequisites..."

if command -v /snap/bin/docker &>/dev/null; then
    DOCKER_BIN="/snap/bin/docker"
    echo "  ✓ Docker found: $(${DOCKER_BIN} --version)"
elif command -v docker &>/dev/null; then
    DOCKER_BIN="docker"
    echo "  ✓ Docker found: $(${DOCKER_BIN} --version)"
else
    err "Docker is not installed. Run setup_osrm.sh first (it installs Docker) or install manually."
    exit 1
fi

if [[ ! -f "${SCRIPT_DIR}/${PBF_FILE}" ]]; then
    err "PBF file not found at ${SCRIPT_DIR}/${PBF_FILE}"
    err "Run setup_data_pipeline.sh first."
    exit 1
fi
echo "  ✓ PBF file found."

# Ensure Docker is running
ensure_docker_running

# Pull image
log "Pulling Nominatim Docker image (this may take a while)..."
sudo "${DOCKER_BIN}" pull "${NOM_IMAGE}"

# ─── Step 2: Prepare Data Directory ─────────────────────────────────────────
log "Step 2/3 — Preparing data directory..."

mkdir -p "${NOM_DATA_DIR}"
mkdir -p "${NOM_PG_HOST_DIR}"

if [[ -z "${NOM_PORT_WAS_SET}" && -f "${NOM_STATE_FILE}" ]]; then
    saved_port="$(awk -F= '/^NOM_PORT=/{print $2; exit}' "${NOM_STATE_FILE}")"
    if [[ "${saved_port:-}" =~ ^[0-9]+$ ]] && [[ "${saved_port}" -ge 1 && "${saved_port}" -le 65535 ]]; then
        NOM_PORT="${saved_port}"
        echo "  ✓ Reusing previously selected Nominatim port ${NOM_PORT}."
    fi
fi

if [[ -z "${NOM_PASSWORD_WAS_SET}" && -f "${NOM_STATE_FILE}" ]]; then
    saved_password="$(awk -F= '/^NOMINATIM_PASSWORD=/{print substr($0, index($0,$2)); exit}' "${NOM_STATE_FILE}")"
    if [[ -n "${saved_password:-}" ]]; then
        NOMINATIM_PASSWORD="${saved_password}"
        echo "  ✓ Reusing persisted Nominatim DB password from state file."
    fi
fi

if [[ -z "${NOMINATIM_PASSWORD}" ]]; then
    NOMINATIM_PASSWORD="$(generate_password)"
    warn "NOMINATIM_PASSWORD not set; generated a random password and persisted it to ${NOM_STATE_FILE}."
fi

# Copy PBF if not already in the data dir
if [[ ! -f "${NOM_DATA_DIR}/${PBF_FILE}" ]]; then
    echo "  + Copying PBF to Nominatim data directory..."
    cp "${SCRIPT_DIR}/${PBF_FILE}" "${NOM_DATA_DIR}/"
fi

# ─── Step 3: Start Nominatim Container ──────────────────────────────────────
log "Step 3/3 — Starting Nominatim container..."

if [[ -z "${NOM_PORT_WAS_SET}" ]]; then
    initial_pid="$(get_listener_pid "${NOM_PORT}")"
    if [[ -n "${initial_pid}" ]]; then
        auto_selected_port=""
        for candidate_port in $(seq $((NOM_PORT + 1)) 65535); do
            if [[ -z "$(get_listener_pid "${candidate_port}")" ]]; then
                auto_selected_port="${candidate_port}"
                break
            fi
        done

        if [[ -z "${auto_selected_port}" ]]; then
            for candidate_port in $(seq 8088 "${NOM_PORT}"); do
                if [[ -z "$(get_listener_pid "${candidate_port}")" ]]; then
                    auto_selected_port="${candidate_port}"
                    break
                fi
            done
        fi

        if [[ -z "${auto_selected_port}" ]]; then
            err "No free fallback port was found for Nominatim. Set NOM_PORT manually and retry."
            exit 1
        fi

        warn "Port ${NOM_PORT} is busy. Auto-selecting Nominatim port ${auto_selected_port}."
        NOM_PORT="${auto_selected_port}"
    fi
fi

# Stop existing container if running
REUSE_CONTAINER=0
if sudo "${DOCKER_BIN}" ps -a --format '{{.Names}}' | grep -q "^${NOM_CONTAINER}$"; then
    existing_image="$(sudo "${DOCKER_BIN}" inspect -f '{{.Config.Image}}' "${NOM_CONTAINER}" 2>/dev/null || true)"
    existing_port="$(sudo "${DOCKER_BIN}" port "${NOM_CONTAINER}" 8080/tcp 2>/dev/null | head -1 | sed -E 's/.*:([0-9]+)$/\1/' || true)"

    if [[ "${existing_image}" == "${NOM_IMAGE}" && "${existing_port}" == "${NOM_PORT}" ]]; then
        REUSE_CONTAINER=1
        running_state="$(sudo "${DOCKER_BIN}" inspect -f '{{.State.Running}}' "${NOM_CONTAINER}" 2>/dev/null || echo false)"
        if [[ "${running_state}" == "true" ]]; then
            echo "  ✓ Existing Nominatim container already matches desired config."
        else
            echo "  ▶ Starting existing Nominatim container..."
            sudo "${DOCKER_BIN}" start "${NOM_CONTAINER}" >/dev/null
        fi
    else
        echo "  ↻ Existing Nominatim container differs from desired config; recreating..."
        sudo "${DOCKER_BIN}" rm -f "${NOM_CONTAINER}" &>/dev/null || true
    fi
fi

echo ""
echo "  ⏳ Nominatim will import the PBF data on first start."
echo "     This can take 15-45 minutes for Eastern Zone data."
echo "     Monitor progress with: ${DOCKER_BIN} logs -f ${NOM_CONTAINER}"
echo ""

if [[ "${REUSE_CONTAINER}" -eq 0 ]]; then
    echo "  + Allocating 4GB temporary swap to prevent Out-Of-Memory (OOM) crashes during import..."
    sudo fallocate -l 4G /swapfile_nom || sudo dd if=/dev/zero of=/swapfile_nom bs=1M count=4096 status=none
    sudo chmod 600 /swapfile_nom
    sudo mkswap /swapfile_nom >/dev/null
    sudo swapon /swapfile_nom
    SWAP_ACTIVE=1

    sudo "${DOCKER_BIN}" run -d \
        --name "${NOM_CONTAINER}" \
        --restart unless-stopped \
        -p "${NOM_PORT}:8080" \
        -e PBF_PATH="/nominatim/data/${PBF_FILE}" \
        -e REPLICATION_URL="https://download.geofabrik.de/asia/india/eastern-zone-updates/" \
        -e NOMINATIM_PASSWORD="${NOMINATIM_PASSWORD}" \
        -e IMPORT_STYLE="full" \
        -e THREADS="$(nproc)" \
        -v "${NOM_DATA_DIR}:/nominatim/data" \
        -v "${NOM_PG_HOST_DIR}:${NOM_PG_TARGET_DIR}" \
        --shm-size=1g \
        "${NOM_IMAGE}"
fi

persist_nom_state

echo "  ✓ Nominatim container started."

# Wait for the import to complete and API to be ready
echo ""
echo -n "  Waiting for Nominatim API to become available"
MAX_WAIT=1800    # 30 minutes max wait for import
ELAPSED=0
while ! is_nominatim_ready; do
    sleep 10
    ELAPSED=$((ELAPSED + 10))
    echo -n "."
    if [[ $ELAPSED -ge $MAX_WAIT ]]; then
        echo ""
        warn "Nominatim is still importing after ${MAX_WAIT}s."
        warn "It may still be processing. Monitor with: ${DOCKER_BIN} logs -f ${NOM_CONTAINER}"
        break
    fi
done

if is_nominatim_ready; then
    echo " ready!"
fi

SWAP_ACTIVE=0
cleanup

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
echo "    ${DOCKER_BIN} logs -f ${NOM_CONTAINER}"
echo "    ${DOCKER_BIN} stop ${NOM_CONTAINER}"
echo "    ${DOCKER_BIN} start ${NOM_CONTAINER}"
echo ""
