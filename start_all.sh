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

echo ""
echo "╔═══════════════════════════════════════════════════════════╗"
echo "║           GeoSphere WB+ — Starting All Services          ║"
echo "╚═══════════════════════════════════════════════════════════╝"

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
if systemctl is-active --quiet geoserver 2>/dev/null; then
    ok "GeoServer is running."
elif [[ -f /usr/share/geoserver/bin/startup.sh ]]; then
    echo "  ▶ Starting GeoServer..."
    sudo systemctl start geoserver 2>/dev/null || true
    sleep 5
    if curl -s -o /dev/null "http://localhost:8080/geoserver/web/"; then
        ok "GeoServer started (http://localhost:8080/geoserver)."
    else
        err "GeoServer may still be starting. Check: systemctl status geoserver"
    fi
else
    err "GeoServer not installed. Run: ./setup_geoserver.sh"
fi

# ─── 3. OSRM ───────────────────────────────────────────────────────────────
log "3/5 — OSRM (Docker)"
if command -v docker &>/dev/null; then
    if sudo docker ps --format '{{.Names}}' | grep -q "geosphere-osrm"; then
        ok "OSRM container is running."
    elif sudo docker ps -a --format '{{.Names}}' | grep -q "geosphere-osrm"; then
        echo "  ▶ Starting OSRM container..."
        sudo docker start geosphere-osrm
        sleep 2
        ok "OSRM started (http://localhost:5000)."
    else
        err "OSRM container not found. Run: ./setup_osrm.sh"
    fi
else
    err "Docker not installed. Run: ./setup_osrm.sh"
fi

# ─── 4. Nominatim ──────────────────────────────────────────────────────────
log "4/5 — Nominatim (Docker)"
if command -v docker &>/dev/null; then
    if sudo docker ps --format '{{.Names}}' | grep -q "geosphere-nominatim"; then
        ok "Nominatim container is running."
    elif sudo docker ps -a --format '{{.Names}}' | grep -q "geosphere-nominatim"; then
        echo "  ▶ Starting Nominatim container..."
        sudo docker start geosphere-nominatim
        sleep 2
        ok "Nominatim started (http://localhost:8088)."
    else
        err "Nominatim container not found. Run: ./setup_nominatim.sh"
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
    echo "  ▶ Starting API in background..."
    nohup node server/src/index.js > logs/api-out.log 2> logs/api-error.log &
    ok "API server started (PID: $!)."
fi

# ─── Summary ────────────────────────────────────────────────────────────────
echo ""
echo "╔═══════════════════════════════════════════════════════════╗"
echo "║             All Services Status                          ║"
echo "╠═══════════════════════════════════════════════════════════╣"
echo "║  🐘 PostgreSQL    : http://localhost:5432                ║"
echo "║  🗺️  GeoServer     : http://localhost:8080/geoserver     ║"
echo "║  🚗 OSRM          : http://localhost:5000                ║"
echo "║  🔍 Nominatim     : http://localhost:8088                ║"
echo "║  🌐 API + Frontend: http://localhost:4000                ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo ""
echo "  Open http://localhost:4000 in your browser to use GeoSphere WB+"
echo ""
