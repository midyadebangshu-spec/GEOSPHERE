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
OSRM_PORT_WAS_SET="${OSRM_PORT+x}"
OSRM_PORT="${OSRM_PORT:-5000}"
readonly OSRM_CONTAINER="geosphere-osrm"
readonly OSRM_IMAGE="osrm/osrm-backend"
readonly ROUTING_PROFILE="/opt/car.lua"      # Options: /opt/car.lua, /opt/bicycle.lua, /opt/foot.lua

# ─── Helpers ─────────────────────────────────────────────────────────────────
log() { echo -e "\n\033[1;34m[$(date '+%H:%M:%S')]\033[0m \033[1m$*\033[0m"; }
warn() { echo -e "\033[1;33m[WARNING]\033[0m $*"; }
err()  { echo -e "\033[1;31m[ERROR]\033[0m $*" >&2; }

DOCKER_BIN=""
SWAP_ACTIVE=0
OSRM_FILE="${OSRM_DATA_DIR}/$(basename "${PBF_FILE}" .osm.pbf).osrm"
OSRM_STATE_FILE="${OSRM_DATA_DIR}/.osrm_setup_state"
OSRM_BUILD_MARKER="${OSRM_DATA_DIR}/.osrm_build_info"

cleanup() {
    if [[ "${SWAP_ACTIVE}" -eq 1 ]]; then
        echo "  - Removing temporary swap space..."
        sudo swapoff /swapfile_osrm || true
        sudo rm -f /swapfile_osrm
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

get_pbf_fingerprint() {
    local pbf_path="$1"
    stat -c '%s:%Y' "${pbf_path}" 2>/dev/null || echo "missing"
}

validate_osrm_artifacts() {
    [[ -f "${OSRM_FILE}" && -f "${OSRM_FILE}.cells" && -f "${OSRM_FILE}.cell_metrics" ]]
}

persist_osrm_state() {
    cat > "${OSRM_STATE_FILE}" <<EOF
OSRM_PORT=${OSRM_PORT}
EOF
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

# ─── Step 1: Check Docker ───────────────────────────────────────────────────
log "Step 1/4 — Checking Docker..."

if command -v /snap/bin/docker &>/dev/null; then
    DOCKER_BIN="/snap/bin/docker"
    echo "  ✓ Docker found: $(${DOCKER_BIN} --version)"
elif command -v docker &>/dev/null; then
    DOCKER_BIN="docker"
    echo "  ✓ Docker found: $(${DOCKER_BIN} --version)"
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
    DOCKER_BIN="docker"
    echo "  ✓ Docker installed. You may need to log out/in for group changes."
fi

# Ensure Docker daemon is running
ensure_docker_running

# Pull OSRM image
log "Pulling OSRM Docker image..."
sudo "${DOCKER_BIN}" pull "${OSRM_IMAGE}" || true

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

PBF_FINGERPRINT="$(get_pbf_fingerprint "${OSRM_DATA_DIR}/${PBF_FILE}")"

# ─── Step 3: Process Data (Extract → Partition → Customize) ─────────────────
log "Step 3/4 — Processing OSM data for routing..."

NEED_REBUILD=1
if validate_osrm_artifacts && [[ -f "${OSRM_BUILD_MARKER}" ]]; then
    if grep -q "^PBF_FINGERPRINT=${PBF_FINGERPRINT}$" "${OSRM_BUILD_MARKER}" \
        && grep -q "^ROUTING_PROFILE=${ROUTING_PROFILE}$" "${OSRM_BUILD_MARKER}" \
        && grep -q "^OSRM_IMAGE=${OSRM_IMAGE}$" "${OSRM_BUILD_MARKER}"; then
        NEED_REBUILD=0
    fi
fi

if [[ "${NEED_REBUILD}" -eq 0 ]]; then
    echo "  ✓ OSRM artifacts match current inputs. Skipping preprocessing."
else
    echo "  ↻ Rebuilding OSRM artifacts (first run, changed inputs, or incomplete artifacts)."
    rm -f "${OSRM_DATA_DIR}"/*.osrm*
    echo ""
    echo "  ⏳ This will take 5-15 minutes depending on hardware."
    echo "  + Allocating 4GB temporary swap to prevent Out-Of-Memory (OOM) crashes..."
    sudo fallocate -l 4G /swapfile_osrm || sudo dd if=/dev/zero of=/swapfile_osrm bs=1M count=4096 status=none
    sudo chmod 600 /swapfile_osrm
    sudo mkswap /swapfile_osrm >/dev/null
    sudo swapon /swapfile_osrm
    SWAP_ACTIVE=1

    # Step 3a: Extract
    echo "  [1/3] Extracting routing graph..."
    sudo "${DOCKER_BIN}" run --rm \
        -v "${OSRM_DATA_DIR}:/data" \
        "${OSRM_IMAGE}" \
        osrm-extract -p "${ROUTING_PROFILE}" "/data/${PBF_FILE}"

    # Step 3b: Partition
    echo "  [2/3] Partitioning graph..."
    sudo "${DOCKER_BIN}" run --rm \
        -v "${OSRM_DATA_DIR}:/data" \
        "${OSRM_IMAGE}" \
        osrm-partition "/data/$(basename "${PBF_FILE}" .osm.pbf).osrm"

    # Step 3c: Customize
    echo "  [3/3] Customizing graph..."
    sudo "${DOCKER_BIN}" run --rm \
        -v "${OSRM_DATA_DIR}:/data" \
        "${OSRM_IMAGE}" \
        osrm-customize "/data/$(basename "${PBF_FILE}" .osm.pbf).osrm"

    cat > "${OSRM_BUILD_MARKER}" <<EOF
PBF_FINGERPRINT=${PBF_FINGERPRINT}
ROUTING_PROFILE=${ROUTING_PROFILE}
OSRM_IMAGE=${OSRM_IMAGE}
EOF

    SWAP_ACTIVE=0
    cleanup

    echo "  ✓ OSRM data processing complete."
fi

# ─── Step 4: Start OSRM Router ──────────────────────────────────────────────
log "Step 4/4 — Starting OSRM routing server..."

if [[ -z "${OSRM_PORT_WAS_SET}" ]]; then
    if [[ -f "${OSRM_STATE_FILE}" ]]; then
        saved_port="$(awk -F= '/^OSRM_PORT=/{print $2; exit}' "${OSRM_STATE_FILE}")"
        if [[ "${saved_port:-}" =~ ^[0-9]+$ ]] && [[ "${saved_port}" -ge 1 && "${saved_port}" -le 65535 ]]; then
            OSRM_PORT="${saved_port}"
            echo "  ✓ Reusing previously selected OSRM port ${OSRM_PORT}."
        fi
    fi

    initial_pid="$(get_listener_pid "${OSRM_PORT}")"
    if [[ -n "${initial_pid}" ]]; then
        auto_selected_port=""
        for candidate_port in $(seq $((OSRM_PORT + 1)) 65535); do
            if [[ -z "$(get_listener_pid "${candidate_port}")" ]]; then
                auto_selected_port="${candidate_port}"
                break
            fi
        done

        if [[ -z "${auto_selected_port}" ]]; then
            for candidate_port in $(seq 5000 "${OSRM_PORT}"); do
                if [[ -z "$(get_listener_pid "${candidate_port}")" ]]; then
                    auto_selected_port="${candidate_port}"
                    break
                fi
            done
        fi

        if [[ -z "${auto_selected_port}" ]]; then
            err "No free fallback port was found. Set OSRM_PORT manually and retry."
            exit 1
        fi

        warn "Port ${OSRM_PORT} is busy. Auto-selecting OSRM port ${auto_selected_port}."
        OSRM_PORT="${auto_selected_port}"
    fi
fi

# Stop existing container if running
if sudo "${DOCKER_BIN}" ps -a --format '{{.Names}}' | grep -q "^${OSRM_CONTAINER}$"; then
    echo "  ↻ Removing existing OSRM container..."
    sudo "${DOCKER_BIN}" rm -f "${OSRM_CONTAINER}" &>/dev/null || true
fi

echo "  ▶ Starting osrm-routed on port ${OSRM_PORT}..."
sudo "${DOCKER_BIN}" run -d \
    --name "${OSRM_CONTAINER}" \
    --restart unless-stopped \
    -p "${OSRM_PORT}:5000" \
    -v "${OSRM_DATA_DIR}:/data" \
    "${OSRM_IMAGE}" \
    osrm-routed \
    --algorithm mld \
    --max-table-size 10000 \
    "/data/$(basename "${PBF_FILE}" .osm.pbf).osrm"

persist_osrm_state

# Wait for it to be ready
echo -n "  Waiting for OSRM to become ready"
MAX_WAIT=120
ELAPSED=0
while true; do
    if curl -s "http://localhost:${OSRM_PORT}/route/v1/driving/88.3639,22.5726;88.2636,22.5958" | grep -q '"code":"Ok"'; then
        echo " ready!"
        echo "  ✓ OSRM is running and responding."
        break
    fi

    sleep 2
    ELAPSED=$((ELAPSED + 2))
    echo -n "."

    if [[ ${ELAPSED} -ge ${MAX_WAIT} ]]; then
        echo ""
        warn "OSRM did not become ready within ${MAX_WAIT}s. Check logs: ${DOCKER_BIN} logs ${OSRM_CONTAINER}"
        break
    fi
done

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
echo "    ${DOCKER_BIN} logs ${OSRM_CONTAINER}"
echo "    ${DOCKER_BIN} stop ${OSRM_CONTAINER}"
echo "    ${DOCKER_BIN} start ${OSRM_CONTAINER}"
echo ""
