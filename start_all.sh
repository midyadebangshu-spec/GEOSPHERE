#!/usr/bin/env bash
###############################################################################
# GeoSphere WB+ — Master Startup Script
# ----------------------------------------
# Starts all services in the correct order:
#   1. PostgreSQL
#   2. GeoServer
#   3. OSRM (Docker container)
#   4. Nominatim (Docker container)
#   5. Express API (via PM2)
#
# Usage:
#   chmod +x start_all.sh
#   ./start_all.sh
###############################################################################

set -euo pipefail

# ─── Helpers ────────────────────────────────────────────────────────────────
log() { echo -e "\n\033[1;34m[$(date '+%H:%M:%S')]\033[0m \033[1m$*\033[0m"; }
ok()  { echo -e "  \033[32m✓\033[0m $*"; }
err() { echo -e "  \033[31m✗\033[0m $*" >&2; }

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DOCKER_BIN=""
GEOSERVER_PORT="8080"
OSRM_PORT="5000"
NOMINATIM_PORT="8088"

update_env_var() {
    local file="$1"
    local key="$2"
    local value="$3"
    if grep -qE "^${key}=" "${file}"; then
        sed -i "s|^${key}=.*|${key}=${value}|" "${file}"
    else
        echo "${key}=${value}" >> "${file}"
    fi
}

container_host_port() {
    local container="$1"
    local container_port="$2"
    local mapped
    mapped=$(sudo "${DOCKER_BIN}" port "${container}" "${container_port}" 2>/dev/null | head -1 | sed -E 's/.*:([0-9]+)$/\1/' || true)
    echo "${mapped}"
}

echo ""
echo "╔═══════════════════════════════════════════════════════════╗"
echo "║           GeoSphere WB+ — Starting All Services          ║"
echo "╚═══════════════════════════════════════════════════════════╝"

if command -v /snap/bin/docker &>/dev/null; then
    DOCKER_BIN="/snap/bin/docker"
elif command -v docker &>/dev/null; then
    DOCKER_BIN="docker"
fi

# ─── 1. PostgreSQL ──────────────────────────────────────────────────────────
log "1/5 — PostgreSQL"
if systemctl is-active --quiet postgresql; then
    ok "PostgreSQL is running."
else
    echo "  ▶ Starting PostgreSQL..."
    sudo systemctl start postgresql
    ok "PostgreSQL started."
fi

# ─── 2. GeoServer ──────────────────────────────────────────────────────────
log "2/5 — GeoServer"
if [[ -f /usr/share/geoserver/start.ini ]]; then
    detected_port=$(grep -E '^jetty\.http\.port=' /usr/share/geoserver/start.ini | tail -1 | cut -d'=' -f2 || true)
    if [[ "${detected_port:-}" =~ ^[0-9]+$ ]]; then
        GEOSERVER_PORT="${detected_port}"
    fi
fi

if systemctl is-active --quiet geoserver 2>/dev/null; then
    ok "GeoServer is running on port ${GEOSERVER_PORT}."
elif [[ -f /usr/share/geoserver/bin/startup.sh ]]; then
    echo "  ▶ Starting GeoServer..."
    sudo systemctl start geoserver 2>/dev/null || true
    sleep 5
    if curl -s -o /dev/null "http://localhost:${GEOSERVER_PORT}/geoserver/web/"; then
        ok "GeoServer started (http://localhost:${GEOSERVER_PORT}/geoserver)."
    else
        err "GeoServer may still be starting. Check: systemctl status geoserver"
    fi
else
    err "GeoServer not installed. Run: ./setup_geoserver.sh"
fi

# ─── 3. OSRM ───────────────────────────────────────────────────────────────
log "3/5 — OSRM (Docker)"
if [[ -n "${DOCKER_BIN}" ]]; then
    if sudo "${DOCKER_BIN}" ps --format '{{.Names}}' | grep -q "geosphere-osrm"; then
        ok "OSRM container is running."
    elif sudo "${DOCKER_BIN}" ps -a --format '{{.Names}}' | grep -q "geosphere-osrm"; then
        echo "  ▶ Starting OSRM container..."
        sudo "${DOCKER_BIN}" start geosphere-osrm
        sleep 2
        ok "OSRM started."
    else
        err "OSRM container not found. Run: ./setup_osrm.sh"
    fi

    osrm_detected_port="$(container_host_port geosphere-osrm 5000/tcp)"
    if [[ "${osrm_detected_port:-}" =~ ^[0-9]+$ ]]; then
        OSRM_PORT="${osrm_detected_port}"
    fi
else
    err "Docker not installed. Run: ./setup_osrm.sh"
fi

# ─── 4. Nominatim ──────────────────────────────────────────────────────────
log "4/5 — Nominatim (Docker)"
if [[ -n "${DOCKER_BIN}" ]]; then
    if sudo "${DOCKER_BIN}" ps --format '{{.Names}}' | grep -q "geosphere-nominatim"; then
        ok "Nominatim container is running."
    elif sudo "${DOCKER_BIN}" ps -a --format '{{.Names}}' | grep -q "geosphere-nominatim"; then
        echo "  ▶ Starting Nominatim container..."
        sudo "${DOCKER_BIN}" start geosphere-nominatim
        sleep 2
        ok "Nominatim started."
    else
        err "Nominatim container not found. Run: ./setup_nominatim.sh"
    fi

    nom_detected_port="$(container_host_port geosphere-nominatim 8080/tcp)"
    if [[ "${nom_detected_port:-}" =~ ^[0-9]+$ ]]; then
        NOMINATIM_PORT="${nom_detected_port}"
    fi
else
    err "Docker not installed."
fi

# ─── 5. Express API (PM2) ──────────────────────────────────────────────────
log "5/5 — Express API"

# Ensure .env exists
if [[ ! -f "${SCRIPT_DIR}/server/.env" ]]; then
    echo "  + Creating .env from template..."
    cp "${SCRIPT_DIR}/server/.env.example" "${SCRIPT_DIR}/server/.env"
    ok ".env created. Edit as needed."
fi

update_env_var "${SCRIPT_DIR}/server/.env" "OSRM_URL" "http://localhost:${OSRM_PORT}"
update_env_var "${SCRIPT_DIR}/server/.env" "NOMINATIM_URL" "http://localhost:${NOMINATIM_PORT}"
update_env_var "${SCRIPT_DIR}/server/.env" "GEOSERVER_URL" "http://localhost:${GEOSERVER_PORT}/geoserver"

# Ensure server dependencies are installed
if [[ ! -d "${SCRIPT_DIR}/server/node_modules" ]] || [[ ! -f "${SCRIPT_DIR}/server/node_modules/dotenv/package.json" ]]; then
    echo "  ▶ Installing server dependencies..."
    cd "${SCRIPT_DIR}/server"
    if [[ -f package-lock.json ]]; then
        npm ci
    else
        npm install
    fi
    ok "Server dependencies installed."
fi

# Check if PM2 is installed
if command -v pm2 &>/dev/null; then
    if pm2 list 2>/dev/null | grep -q "geosphere-api"; then
        echo "  ↻ Restarting API server..."
        pm2 restart geosphere-api
    else
        echo "  ▶ Starting API server with PM2..."
        cd "${SCRIPT_DIR}"
        mkdir -p logs
        pm2 start ecosystem.config.js
    fi
    ok "API server running (http://localhost:4000)."
else
    echo "  PM2 not found. Starting with node directly..."
    cd "${SCRIPT_DIR}"
    mkdir -p logs

    EXISTING_API_PID="$(pgrep -f 'node server/src/index.js' | head -1 || true)"
    if [[ -n "${EXISTING_API_PID}" ]]; then
        echo "  ↻ Stopping existing API process (PID: ${EXISTING_API_PID})..."
        kill "${EXISTING_API_PID}" 2>/dev/null || true
        sleep 1
    fi

    echo "  ▶ Starting API in background..."
    nohup node server/src/index.js > logs/api-out.log 2> logs/api-error.log &
    API_PID=$!

    API_READY=0
    for _ in {1..15}; do
        if curl -s -o /dev/null "http://localhost:4000/"; then
            API_READY=1
            break
        fi
        sleep 1
    done

    if [[ "${API_READY}" -eq 1 ]]; then
        ok "API server started (PID: ${API_PID}) and is reachable at http://localhost:4000."
    else
        err "API process started (PID: ${API_PID}) but is not reachable on port 4000."
        err "Check logs: ${SCRIPT_DIR}/logs/api-error.log"
        exit 1
    fi
fi

# ─── Summary ────────────────────────────────────────────────────────────────
echo ""
echo "╔═══════════════════════════════════════════════════════════╗"
echo "║             All Services Status                          ║"
echo "╠═══════════════════════════════════════════════════════════╣"
echo "║  🐘 PostgreSQL    : http://localhost:5432                ║"
echo "║  🗺️  GeoServer     : http://localhost:${GEOSERVER_PORT}/geoserver     ║"
echo "║  🚗 OSRM          : http://localhost:${OSRM_PORT}                ║"
echo "║  🔍 Nominatim     : http://localhost:${NOMINATIM_PORT}                ║"
echo "║  🌐 API + Frontend: http://localhost:4000                ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo ""
echo "  Open http://localhost:4000 in your browser to use GeoSphere WB+"
echo ""
