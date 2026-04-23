#!/usr/bin/env bash
###############################################################################
# GeoSphere WB+ — Radar Admin CLI Launcher (Idempotent)
# 
# Ensures the Python venv exists, dependencies are installed,
# and launches the radar_cli.py admin tool.
#
# Usage:
#   chmod +x start_radar_admin.sh
#   ./start_radar_admin.sh
###############################################################################

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VENV_DIR="${SCRIPT_DIR}/venv"
REQ_FILE="${SCRIPT_DIR}/requirements.txt"
APP_FILE="${SCRIPT_DIR}/radar_cli.py"

log() { echo -e "\n\033[1;34m[$(date '+%H:%M:%S')]\033[0m \033[1m$*\033[0m"; }
ok()  { echo -e "  \033[32m✓\033[0m $*"; }
err() { echo -e "  \033[31m✗\033[0m $*" >&2; }

# ─── 1. Check Python3 ──────────────────────────────────────────────────────
log "Checking Python3..."
if ! command -v python3 &>/dev/null; then
    err "python3 not found. Please install it first."
    exit 1
fi
ok "python3 found: $(python3 --version)"

# ─── 2. Create venv if missing ─────────────────────────────────────────────
log "Checking virtual environment..."
if [[ ! -d "${VENV_DIR}" ]]; then
    echo "  ▶ Creating virtual environment..."
    python3 -m venv "${VENV_DIR}"
    ok "Virtual environment created at ${VENV_DIR}"
else
    ok "Virtual environment already exists."
fi

# ─── 3. Install/update dependencies ───────────────────────────────────────
log "Checking dependencies..."
if [[ -f "${REQ_FILE}" ]]; then
    "${VENV_DIR}/bin/pip" install --quiet --upgrade -r "${REQ_FILE}"
    ok "All dependencies satisfied."
else
    err "requirements.txt not found at ${REQ_FILE}"
    exit 1
fi

# ─── 4. Launch ─────────────────────────────────────────────────────────────
log "Launching Radar Admin CLI..."
echo ""
exec "${VENV_DIR}/bin/python" "${APP_FILE}"
