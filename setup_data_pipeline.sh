#!/usr/bin/env bash
###############################################################################
# GeoSphere WB+ (Advanced Edition) — Data Pipeline Setup
# -------------------------------------------------------
# Automates:
#   1. Dependency verification & installation (wget, postgresql, postgis, osm2pgsql)
#   2. OSM PBF download for West Bengal (skip if already present)
#   3. PostGIS database creation (idempotent)
#   4. Data import via osm2pgsql
#
# Assumptions:
#   • Ubuntu / Debian host
#   • Script is run with a user that has sudo privileges
#   • PostgreSQL service is (or will be) running locally
#
# Usage:
#   chmod +x setup_data_pipeline.sh
#   ./setup_data_pipeline.sh
###############################################################################

set -euo pipefail   # Exit on error (-e), unset var (-u), pipe fail (-o pipefail)
IFS=$'\n\t'

# ─── Configuration ───────────────────────────────────────────────────────────
# NOTE: Geofabrik no longer provides individual state-level extracts for India.
# West Bengal is included in the Eastern Zone (also covers Bihar, Jharkhand, Odisha).
readonly OSM_URL="https://download.geofabrik.de/asia/india/eastern-zone-latest.osm.pbf"
readonly PBF_FILE="eastern-zone-latest.osm.pbf"
readonly DB_NAME="osm_wb"
readonly DB_USER="postgres"               # PostgreSQL superuser used for DB setup
readonly WORK_DIR="$(cd "$(dirname "$0")" && pwd)"

# osm2pgsql tuning — adjust to match your hardware (see PRD §5)
readonly OSM2PGSQL_CACHE="2048"           # MB of RAM for node cache (raise on 32 GB boxes)
readonly OSM2PGSQL_PROCS="$(nproc)"       # Use all available CPU cores

# ─── Helpers ─────────────────────────────────────────────────────────────────

# Timestamped log helper
log() {
    echo -e "\n\033[1;34m[$(date '+%Y-%m-%d %H:%M:%S')]\033[0m \033[1m$*\033[0m"
}

warn() {
    echo -e "\033[1;33m[WARNING]\033[0m $*"
}

err() {
    echo -e "\033[1;31m[ERROR]\033[0m $*" >&2
}

# ─── Step 0: Pre-flight Checks ──────────────────────────────────────────────
log "Starting GeoSphere WB+ Data Pipeline Setup"
log "Working directory: ${WORK_DIR}"

if [[ $EUID -eq 0 ]]; then
    warn "Running as root. Database commands will use 'sudo -u ${DB_USER}'."
    warn "Consider running as a regular sudo-capable user instead."
fi

# ─── Step 1: Dependency Check & Installation ────────────────────────────────
log "Step 1/4 — Checking dependencies..."

MISSING_PKGS=()

# --- wget ---
if command -v wget &>/dev/null; then
    echo "  ✓ wget found ($(command -v wget))"
else
    warn "  ✗ wget not found — will install"
    MISSING_PKGS+=("wget")
fi

# --- PostgreSQL (psql) ---
if command -v psql &>/dev/null; then
    echo "  ✓ psql found ($(command -v psql))"
else
    warn "  ✗ psql not found — will install postgresql + postgresql-client"
    MISSING_PKGS+=("postgresql")
    MISSING_PKGS+=("postgresql-client")
fi

# --- PostGIS (shp2pgsql) ---
if command -v shp2pgsql &>/dev/null; then
    echo "  ✓ shp2pgsql found ($(command -v shp2pgsql))"
else
    warn "  ✗ shp2pgsql not found — will install postgis"
    MISSING_PKGS+=("postgis")
    # Auto-detect the available postgresql-*-postgis-* package
    # (version varies: could be postgresql-14-postgis-3, -16-, -17-, etc.)
    POSTGIS_PKG=$(apt-cache search --names-only 'postgresql-[0-9]+-postgis-[0-9]+$' 2>/dev/null | head -1 | awk '{print $1}')
    if [[ -n "${POSTGIS_PKG}" ]]; then
        echo "  → Auto-detected PostGIS package: ${POSTGIS_PKG}"
        MISSING_PKGS+=("${POSTGIS_PKG}")
    else
        warn "  Could not auto-detect postgresql-*-postgis-* package. Installing 'postgis' only."
    fi
fi

# --- osm2pgsql ---
if command -v osm2pgsql &>/dev/null; then
    echo "  ✓ osm2pgsql found ($(command -v osm2pgsql))"
else
    warn "  ✗ osm2pgsql not found — will install"
    MISSING_PKGS+=("osm2pgsql")
fi

if [[ ${#MISSING_PKGS[@]} -gt 0 ]]; then
    log "Installing missing packages: ${MISSING_PKGS[*]}"
    sudo apt-get update -qq
    sudo apt-get install -y --no-install-recommends "${MISSING_PKGS[@]}"
    log "Packages installed successfully."
else
    log "All dependencies are already installed."
fi

# ─── Step 2: Ensure PostgreSQL is Running ────────────────────────────────────
log "Step 2/4 — Ensuring PostgreSQL service is active..."

if ! systemctl is-active --quiet postgresql; then
    warn "PostgreSQL is not running. Attempting to start..."
    sudo systemctl start postgresql
    sudo systemctl enable postgresql
    log "PostgreSQL started and enabled."
else
    echo "  ✓ PostgreSQL is active."
fi

# Quick connectivity test
if ! sudo -u "${DB_USER}" psql -c "SELECT 1;" &>/dev/null; then
    err "Cannot connect to PostgreSQL as user '${DB_USER}'. Aborting."
    exit 1
fi

# ─── Step 3: Download OSM PBF Data ──────────────────────────────────────────
log "Step 3/4 — Downloading Eastern Zone OSM data (includes West Bengal)..."

cd "${WORK_DIR}"

if [[ -f "${PBF_FILE}" ]]; then
    echo "  ✓ File '${PBF_FILE}' already exists ($(du -h "${PBF_FILE}" | cut -f1))."
    echo "    Skipping download. Delete the file to force a re-download."
else
    echo "  ↓ Downloading from: ${OSM_URL}"
    echo "    File is ~230 MB — this may take a few minutes."
    # Using curl -L to follow Geofabrik's 302 redirects (wget -O saves the redirect page)
    curl -L --progress-bar --retry 3 --retry-delay 5 \
         --connect-timeout 60 \
         -o "${PBF_FILE}" \
         "${OSM_URL}"
    log "Download complete ($(du -h "${PBF_FILE}" | cut -f1))."
fi

# Sanity check: file should be at least 1 MB
FILE_SIZE=$(stat -c%s "${PBF_FILE}" 2>/dev/null || echo 0)
if [[ "${FILE_SIZE}" -lt 1048576 ]]; then
    err "Downloaded file is suspiciously small (${FILE_SIZE} bytes). It may be corrupt."
    err "Delete '${PBF_FILE}' and re-run the script."
    exit 1
fi

# ─── Step 4: Database Initialization (Idempotent) ───────────────────────────
log "Step 4/4 — Setting up PostGIS database '${DB_NAME}'..."

# 4a. Create the database if it does not already exist
if sudo -u "${DB_USER}" psql -lqt | cut -d \| -f 1 | grep -qw "${DB_NAME}"; then
    echo "  ✓ Database '${DB_NAME}' already exists. Skipping creation."
else
    echo "  + Creating database '${DB_NAME}'..."
    sudo -u "${DB_USER}" createdb "${DB_NAME}"
    echo "  ✓ Database '${DB_NAME}' created."
fi

# 4b. Enable PostGIS extension (idempotent — IF NOT EXISTS)
echo "  + Enabling PostGIS extension..."
sudo -u "${DB_USER}" psql -d "${DB_NAME}" -c "CREATE EXTENSION IF NOT EXISTS postgis;"
echo "  ✓ PostGIS extension enabled."

# 4c. Enable hstore extension (required by osm2pgsql --hstore flag)
echo "  + Enabling hstore extension..."
sudo -u "${DB_USER}" psql -d "${DB_NAME}" -c "CREATE EXTENSION IF NOT EXISTS hstore;"
echo "  ✓ hstore extension enabled."

# ─── Step 5: OSM Data Import via osm2pgsql ──────────────────────────────────
log "Importing OSM data into '${DB_NAME}' with osm2pgsql..."
echo "  Cache     : ${OSM2PGSQL_CACHE} MB"
echo "  Processes : ${OSM2PGSQL_PROCS}"
echo "  PBF File  : ${PBF_FILE}"
echo ""
echo "  This may take 10-30 minutes depending on hardware (see PRD §13)."
echo ""

# Run osm2pgsql as the postgres user so it can write directly to the DB.
# Flags as specified in the PRD:
#   --create         : Drop existing osm2pgsql tables and re-import
#   --database       : Target database
#   --slim           : Store temp data in DB (required for updates & large imports)
#   --hstore         : Import all OSM tags into an hstore column
#   --multi-geometry : Allow multi-geometry features (MULTI* types)
#
# Additional tuning flags:
#   --cache          : RAM cache for node positions (MB)
#   --number-processes : Parallel processing threads
# Grant the current OS user access to the database so we can run osm2pgsql
# without sudo -u postgres (which can't read files in the user's home directory).
# osm2pgsql --create needs to DROP tables, so the user needs SUPERUSER privilege.
CURRENT_USER="$(whoami)"
if [[ "${CURRENT_USER}" != "${DB_USER}" ]]; then
    echo "  + Granting DB superuser access to '${CURRENT_USER}'..."
    sudo -u "${DB_USER}" psql -c "
        DO \$\$
        BEGIN
            IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${CURRENT_USER}') THEN
                CREATE ROLE ${CURRENT_USER} LOGIN SUPERUSER;
            ELSE
                ALTER ROLE ${CURRENT_USER} SUPERUSER LOGIN;
            END IF;
        END
        \$\$;
    "
    # Reassign any existing objects (from prior failed runs) to the current user
    sudo -u "${DB_USER}" psql -d "${DB_NAME}" -c "
        REASSIGN OWNED BY ${DB_USER} TO ${CURRENT_USER};
    " 2>/dev/null || true
    echo "  ✓ User '${CURRENT_USER}' granted superuser access."
fi

# Run osm2pgsql as the CURRENT user (not postgres) so it can read the PBF file.
osm2pgsql \
    --create \
    --database "${DB_NAME}" \
    --slim \
    --hstore \
    --multi-geometry \
    --cache "${OSM2PGSQL_CACHE}" \
    --number-processes "${OSM2PGSQL_PROCS}" \
    "${WORK_DIR}/${PBF_FILE}"

log "osm2pgsql import completed successfully."

# ─── Post-Import Verification ───────────────────────────────────────────────
log "Running post-import verification..."

echo ""
echo "  Table row counts:"
for table in planet_osm_point planet_osm_line planet_osm_polygon planet_osm_roads; do
    COUNT=$(sudo -u "${DB_USER}" psql -d "${DB_NAME}" -tAc "SELECT COUNT(*) FROM ${table};" 2>/dev/null || echo "N/A")
    printf "    %-25s %s rows\n" "${table}" "${COUNT}"
done

echo ""
log "═══════════════════════════════════════════════════════════════"
log "  GeoSphere WB+ Data Pipeline — Setup Complete!"
log "═══════════════════════════════════════════════════════════════"
echo ""
echo "  Database : ${DB_NAME}"
echo "  PBF File : ${WORK_DIR}/${PBF_FILE}"
echo ""
echo "  Next steps:"
echo "    • Configure GeoServer to connect to the '${DB_NAME}' PostGIS store"
echo "    • Extract OSRM graph:  osrm-extract ${PBF_FILE} -p /usr/share/osrm/profiles/car.lua"
echo "    • Set up Nominatim for geocoding"
echo "    • Start the Express API server"
echo ""
