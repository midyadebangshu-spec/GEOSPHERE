#!/usr/bin/env bash
###############################################################################
# GeoSphere WB+ — GeoServer Setup Script
# ----------------------------------------
# Installs GeoServer (standalone binary with embedded Jetty), configures it
# as a systemd service, and publishes the PostGIS osm_wb layers via the
# REST API.
#
# Prerequisites:
#   • PostgreSQL running with osm_wb database populated (run setup_data_pipeline.sh first)
#   • sudo privileges
#
# Usage:
#   chmod +x setup_geoserver.sh
#   ./setup_geoserver.sh
###############################################################################

set -euo pipefail
IFS=$'\n\t'

# ─── Configuration ───────────────────────────────────────────────────────────
readonly GEOSERVER_VERSION="2.26.2"
readonly GEOSERVER_URL="https://sourceforge.net/projects/geoserver/files/GeoServer/${GEOSERVER_VERSION}/geoserver-${GEOSERVER_VERSION}-bin.zip/download"
readonly GEOSERVER_HOME="/usr/share/geoserver"
GEOSERVER_PORT_WAS_SET="${GEOSERVER_PORT+x}"
GEOSERVER_PORT="${GEOSERVER_PORT:-8080}"
readonly GEOSERVER_STARTUP_TIMEOUT="${GEOSERVER_STARTUP_TIMEOUT:-180}"

# Credentials — override via environment variables for production use
readonly GEOSERVER_USER="${GEOSERVER_USER:-admin}"
readonly GEOSERVER_PASS="${GEOSERVER_PASS:-geoserver}"

readonly WORKSPACE="geosphere_wb"
readonly STORE_NAME="osm_wb_store"
readonly DB_NAME="osm_wb"
readonly DB_HOST="localhost"
readonly DB_PORT="5432"
DB_USER="${DB_USER:-postgres}"
DB_PASS="${DB_PASS:-}"

readonly SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
readonly CURRENT_USER="$(whoami)"
SERVICE_USER="${SUDO_USER:-${USER:-${CURRENT_USER}}}"

# ─── Helpers ─────────────────────────────────────────────────────────────────
log() { echo -e "\n\033[1;34m[$(date '+%H:%M:%S')]\033[0m \033[1m$*\033[0m"; }
warn() { echo -e "\033[1;33m[WARNING]\033[0m $*" >&2; }
err()  { echo -e "\033[1;31m[ERROR]\033[0m $*" >&2; }

if [[ "${SERVICE_USER}" == "root" ]]; then
    warn "Script invoked as root; using dedicated 'geoserver' service user for safer runtime."
    SERVICE_USER="geoserver"
fi

wait_for_geoserver() {
    local max_wait="${GEOSERVER_STARTUP_TIMEOUT}"
    local elapsed=0
    echo -n "  Waiting for GeoServer to start..."
    while ! curl -s -o /dev/null -w "%{http_code}" "http://localhost:${GEOSERVER_PORT}/geoserver/rest" 2>/dev/null | grep -qE "200|401"; do
        sleep 2
        elapsed=$((elapsed + 2))
        echo -n "."
        if [[ $elapsed -ge $max_wait ]]; then
            echo ""
            err "GeoServer did not start within ${max_wait}s. Check logs at ${GEOSERVER_HOME}/data_dir/logs/"
            exit 1
        fi
    done
    echo " ready!"
}

rest_exists() {
    local url="$1"
    local http_code
    http_code=$(curl -s -o /dev/null -w "%{http_code}" \
        -u "${GEOSERVER_USER}:${GEOSERVER_PASS}" \
        "${url}")
    [[ "${http_code}" == "200" ]]
}

get_listener_pid() {
    local port="${1:-${GEOSERVER_PORT}}"
    local pid=""

    if command -v ss &>/dev/null; then
        pid=$(sudo ss -ltnp "( sport = :${port} )" 2>/dev/null | awk -F'pid=' 'NR>1 && /pid=/ {split($2,a,","); print a[1]; exit}')
    fi

    if [[ -z "${pid}" ]] && command -v lsof &>/dev/null; then
        pid=$(sudo lsof -t -iTCP:"${port}" -sTCP:LISTEN 2>/dev/null | head -1 || true)
    fi

    echo "${pid}"
}

build_store_json() {
    local passwd_line=""
    if [[ -n "${DB_PASS}" ]]; then
        passwd_line="                {\"@key\": \"passwd\",   \"\$\": \"${DB_PASS}\"},"
    else
        warn "DB_PASS is empty. GeoServer datastore auth may fail unless PostgreSQL allows passwordless auth from localhost."
    fi

    cat <<EOF
{
    "dataStore": {
        "name": "${STORE_NAME}",
        "type": "PostGIS",
        "connectionParameters": {
            "entry": [
                {"@key": "host",     "$": "${DB_HOST}"},
                {"@key": "port",     "$": "${DB_PORT}"},
                {"@key": "database", "$": "${DB_NAME}"},
                {"@key": "user",     "$": "${DB_USER}"},
${passwd_line}
                {"@key": "dbtype",   "$": "postgis"},
                {"@key": "schema",   "$": "public"}
            ]
        }
    }
}
EOF
}

build_layer_json() {
    local table="$1"
    cat <<EOF
{
    "featureType": {
        "name": "${table}",
        "nativeName": "${table}",
        "title": "${table}",
        "srs": "EPSG:3857",
        "nativeCRS": "EPSG:3857"
    }
}
EOF
}

prepare_db_credentials() {
    if [[ -n "${DB_PASS}" ]]; then
        return 0
    fi

    warn "DB_PASS is empty. Auto-provisioning a GeoServer read-only DB user for PostGIS access."

    local auto_user="${GEOSERVER_DB_USER:-geoserver_app}"
    local auto_pass="${GEOSERVER_DB_PASS:-$(tr -dc 'A-Za-z0-9' </dev/urandom | head -c 24)}"

    if [[ ! "${auto_user}" =~ ^[a-zA-Z_][a-zA-Z0-9_]*$ ]]; then
        err "GEOSERVER_DB_USER '${auto_user}' contains unsafe characters for SQL identifier usage."
        return 1
    fi

    sudo -u postgres psql -d postgres -v ON_ERROR_STOP=1 <<SQL >/dev/null
DO
\$\$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${auto_user}') THEN
        CREATE ROLE ${auto_user} LOGIN PASSWORD '${auto_pass}';
    ELSE
        ALTER ROLE ${auto_user} LOGIN PASSWORD '${auto_pass}';
    END IF;
END
\$\$;
SQL

    sudo -u postgres psql -d "${DB_NAME}" -v ON_ERROR_STOP=1 <<SQL >/dev/null
GRANT CONNECT ON DATABASE ${DB_NAME} TO ${auto_user};
GRANT USAGE ON SCHEMA public TO ${auto_user};
GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${auto_user};
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO ${auto_user};
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO ${auto_user};
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON SEQUENCES TO ${auto_user};
SQL

    DB_USER="${auto_user}"
    DB_PASS="${auto_pass}"
    echo "  ✓ Using auto-provisioned DB credentials for GeoServer datastore user '${DB_USER}'."
}

# Helper: execute a REST API call and verify success
rest_call() {
    local method="$1"
    local url="$2"
    local data="${3:-}"
    local http_code

    if [[ -n "${data}" ]]; then
        http_code=$(curl -s -o /dev/null -w "%{http_code}" \
            -u "${GEOSERVER_USER}:${GEOSERVER_PASS}" \
            -X "${method}" "${url}" \
            -H "Content-Type: application/json" \
            -d "${data}")
    else
        http_code=$(curl -s -o /dev/null -w "%{http_code}" \
            -u "${GEOSERVER_USER}:${GEOSERVER_PASS}" \
            -X "${method}" "${url}")
    fi

    if [[ "${http_code}" =~ ^2[0-9]{2}$ ]]; then
        return 0
    else
        err "REST API call failed: ${method} ${url} → HTTP ${http_code}"
        return 1
    fi
}

# ─── Step 1: Install Java 17 ────────────────────────────────────────────────
log "Step 1/5 — Checking Java installation..."

if command -v java &>/dev/null; then
    JAVA_VER=$(java -version 2>&1 | head -1 | awk -F'"' '{print $2}' | cut -d'.' -f1)
    if [[ "${JAVA_VER}" -ge 17 ]]; then
        echo "  ✓ Java ${JAVA_VER} found."
    else
        warn "Java ${JAVA_VER} found but GeoServer requires ≥17. Installing OpenJDK 17..."
        sudo apt-get update -qq
        sudo apt-get install -y openjdk-17-jdk
    fi
else
    log "Installing OpenJDK 17..."
    sudo apt-get update -qq
    sudo apt-get install -y openjdk-17-jdk
fi

# Also need unzip and curl
for pkg in unzip curl; do
    if ! command -v "$pkg" &>/dev/null; then
        sudo apt-get install -y "$pkg"
    fi
done

# ─── Step 2: Download & Install GeoServer ────────────────────────────────────
log "Step 2/5 — Installing GeoServer ${GEOSERVER_VERSION}..."

if [[ -d "${GEOSERVER_HOME}/bin" ]]; then
    echo "  ✓ GeoServer already installed at ${GEOSERVER_HOME}. Skipping."
else
    ZIPFILE="${SCRIPT_DIR}/geoserver-${GEOSERVER_VERSION}-bin.zip"

    if [[ ! -f "${ZIPFILE}" ]]; then
        echo "  ↓ Downloading GeoServer ${GEOSERVER_VERSION}..."
        # SourceForge /download URLs return 302 redirects; curl -L follows them
        curl -L --progress-bar --retry 3 --retry-delay 5 \
             --connect-timeout 60 \
             -o "${ZIPFILE}" \
             "${GEOSERVER_URL}"
    fi

    # Verify the zip is not empty / corrupt
    if ! unzip -t "${ZIPFILE}" &>/dev/null; then
        err "Downloaded ZIP is corrupt. Delete '${ZIPFILE}' and re-run."
        exit 1
    fi

    echo "  ↗ Extracting to ${GEOSERVER_HOME}..."
    # GeoServer ZIPs extract to a nested geoserver-<version>/ directory.
    # Some releases are nested (geoserver-<version>/...), others are flat.
    # Extract to a temp dir first, then detect actual GeoServer root.
    TMPDIR_GS=$(mktemp -d)
    unzip -q -o "${ZIPFILE}" -d "${TMPDIR_GS}"

    # Determine GeoServer root folder: either temp root (flat ZIP) or nested dir.
    EXTRACTED_DIR=""
    if [[ -d "${TMPDIR_GS}/bin" && -f "${TMPDIR_GS}/bin/startup.sh" ]]; then
        EXTRACTED_DIR="${TMPDIR_GS}"
    else
        EXTRACTED_DIR=$(find "${TMPDIR_GS}" -mindepth 1 -maxdepth 3 -type f -path '*/bin/startup.sh' -printf '%h\n' | sed 's#/bin$##' | head -1)
    fi

    if [[ -z "${EXTRACTED_DIR}" || ! -f "${EXTRACTED_DIR}/bin/startup.sh" ]]; then
        err "Unexpected ZIP structure — could not locate GeoServer bin/startup.sh inside archive."
        rm -rf "${TMPDIR_GS}"
        exit 1
    fi

    sudo mkdir -p "${GEOSERVER_HOME}"
    sudo cp -a "${EXTRACTED_DIR}/." "${GEOSERVER_HOME}/"
    rm -rf "${TMPDIR_GS}"

    # Verify the install before deleting the ZIP
    if [[ -d "${GEOSERVER_HOME}/bin" ]]; then
        rm -f "${ZIPFILE}"
        echo "  ✓ GeoServer installed."
    else
        err "Installation verification failed — ${GEOSERVER_HOME}/bin not found."
        echo "  ZIP file retained at: ${ZIPFILE}"
        exit 1
    fi
fi

# Set ownership
if [[ "${SERVICE_USER}" == "geoserver" ]] && ! id -u geoserver >/dev/null 2>&1; then
    sudo useradd --system --home "${GEOSERVER_HOME}" --shell /usr/sbin/nologin geoserver
fi
sudo chown -R "${SERVICE_USER}:${SERVICE_USER}" "${GEOSERVER_HOME}"

# ─── Step 3: Enable CORS in GeoServer ───────────────────────────────────────
log "Step 3/5 — Enabling CORS..."

# NOTE: CORS is configured to allow ALL origins (*) for development convenience.
# For production, replace '*' with your specific domain(s) to avoid security risks.
GS_WEBXML="${GEOSERVER_HOME}/webapps/geoserver/WEB-INF/web.xml"
EXPECTED_CORS_CLASS="org.eclipse.jetty.servlets.CrossOriginFilter"

if [[ ! -f "${GS_WEBXML}" ]]; then
    err "GeoServer web.xml not found at ${GS_WEBXML}. Is GeoServer installed correctly?"
    exit 1
fi

if grep -q "CorsFilter" "${GS_WEBXML}" 2>/dev/null && grep -q "${EXPECTED_CORS_CLASS}" "${GS_WEBXML}" 2>/dev/null; then
    echo "  ✓ CORS already configured correctly."
else
    if grep -q "CorsFilter" "${GS_WEBXML}" 2>/dev/null; then
        echo "  ↻ Existing CORS config appears incomplete/incorrect; replacing..."
        sudo sed -i '/<filter-name>CorsFilter<\/filter-name>/,/<\/filter-mapping>/d' "${GS_WEBXML}"
    else
        echo "  + Adding CORS filter to web.xml..."
    fi
    # Insert CORS filter before </web-app>
    sudo sed -i '/<\/web-app>/i \
    <!-- CORS Filter (change allowedOrigins for production!) -->\
    <filter>\
        <filter-name>CorsFilter</filter-name>\
        <filter-class>org.eclipse.jetty.servlets.CrossOriginFilter</filter-class>\
        <init-param>\
            <param-name>allowedOrigins</param-name>\
            <param-value>*</param-value>\
        </init-param>\
        <init-param>\
            <param-name>allowedMethods</param-name>\
            <param-value>GET,POST,PUT,DELETE,HEAD,OPTIONS</param-value>\
        </init-param>\
        <init-param>\
            <param-name>allowedHeaders</param-name>\
            <param-value>*</param-value>\
        </init-param>\
    </filter>\
    <filter-mapping>\
        <filter-name>CorsFilter</filter-name>\
        <url-pattern>/*</url-pattern>\
    </filter-mapping>' "${GS_WEBXML}"
    echo "  ✓ CORS filter configured."
fi

# ─── Step 4: Create systemd Service ─────────────────────────────────────────
log "Step 4/5 — Creating systemd service..."

if [[ "${GEOSERVER_PORT}" == "8080" ]]; then
    INITIAL_PID="$(get_listener_pid "${GEOSERVER_PORT}")"
    if [[ -n "${INITIAL_PID}" ]]; then
        AUTO_SELECTED_PORT=""
        for candidate_port in $(seq 8081 65535); do
            if [[ -z "$(get_listener_pid "${candidate_port}")" ]]; then
                AUTO_SELECTED_PORT="${candidate_port}"
                break
            fi
        done

        if [[ -z "${AUTO_SELECTED_PORT}" ]]; then
            err "Port 8080 is busy and no free fallback port was found. Set GEOSERVER_PORT manually and retry."
            exit 1
        fi

        warn "Port 8080 is busy. Auto-selecting GeoServer port ${AUTO_SELECTED_PORT}."
        GEOSERVER_PORT="${AUTO_SELECTED_PORT}"
    fi
fi

GS_START_INI="${GEOSERVER_HOME}/start.ini"
if [[ ! -f "${GS_START_INI}" ]]; then
    err "GeoServer start.ini not found at ${GS_START_INI}."
    exit 1
fi

if grep -q '^jetty\.http\.port=' "${GS_START_INI}"; then
    sudo sed -i "s/^jetty\.http\.port=.*/jetty.http.port=${GEOSERVER_PORT}/" "${GS_START_INI}"
else
    echo "jetty.http.port=${GEOSERVER_PORT}" | sudo tee -a "${GS_START_INI}" > /dev/null
fi

SERVICE_FILE="/etc/systemd/system/geoserver.service"
TMP_SERVICE_FILE="$(mktemp)"
SERVICE_UPDATED=0
cat > "${TMP_SERVICE_FILE}" <<EOF
[Unit]
Description=GeoServer ${GEOSERVER_VERSION}
After=network.target postgresql.service

[Service]
Type=simple
User=${SERVICE_USER}
Group=${SERVICE_USER}
Environment="GEOSERVER_HOME=${GEOSERVER_HOME}"
Environment="JAVA_OPTS=-Djetty.http.port=${GEOSERVER_PORT} -Xms256m -Xmx2g -XX:+UseG1GC"
ExecStart=${GEOSERVER_HOME}/bin/startup.sh
ExecStop=${GEOSERVER_HOME}/bin/shutdown.sh
Restart=on-failure
RestartSec=10
TimeoutStartSec=${GEOSERVER_STARTUP_TIMEOUT}
TimeoutStopSec=120

[Install]
WantedBy=multi-user.target
EOF

if [[ -f "${SERVICE_FILE}" ]] && cmp -s "${TMP_SERVICE_FILE}" "${SERVICE_FILE}"; then
    echo "  ✓ Service file already exists and is up to date."
else
    sudo cp "${TMP_SERVICE_FILE}" "${SERVICE_FILE}"
    sudo systemctl daemon-reload
    SERVICE_UPDATED=1
    echo "  ✓ Service file created/updated."
fi
rm -f "${TMP_SERVICE_FILE}"

sudo systemctl reset-failed geoserver 2>/dev/null || true

# Start GeoServer
if sudo systemctl is-active --quiet geoserver; then
    if [[ "${SERVICE_UPDATED}" -eq 1 ]]; then
        echo "  ↻ Service definition changed; restarting GeoServer..."
        sudo systemctl restart geoserver
    else
        echo "  ✓ GeoServer is already running."
    fi
else
    PORT_PID="$(get_listener_pid)"
    if [[ -n "${PORT_PID}" ]]; then
        PORT_CMDLINE="$(tr '\0' ' ' < "/proc/${PORT_PID}/cmdline" 2>/dev/null || true)"

        if [[ "${PORT_CMDLINE}" == *"geoserver"* || "${PORT_CMDLINE}" == *"start.jar"* ]]; then
            warn "Port ${GEOSERVER_PORT} is occupied by an unmanaged GeoServer-like process (PID ${PORT_PID}). Attempting graceful shutdown..."
            if [[ -x "${GEOSERVER_HOME}/bin/shutdown.sh" ]]; then
                "${GEOSERVER_HOME}/bin/shutdown.sh" >/dev/null 2>&1 || true
            fi

            for _ in {1..20}; do
                sleep 1
                [[ -z "$(get_listener_pid)" ]] && break
            done

            PORT_PID="$(get_listener_pid)"
            if [[ -n "${PORT_PID}" ]]; then
                err "Port ${GEOSERVER_PORT} is still in use by PID ${PORT_PID}. Stop it and rerun, or change GEOSERVER_PORT."
                exit 1
            fi
        else
            err "Port ${GEOSERVER_PORT} is already in use by PID ${PORT_PID} (${PORT_CMDLINE}). Stop that process or change GEOSERVER_PORT."
            exit 1
        fi
    fi

    echo "  ▶ Starting GeoServer..."
    sudo systemctl start geoserver
fi
sudo systemctl enable geoserver 2>/dev/null || true

wait_for_geoserver

# ─── Step 5: Configure Workspace, Store & Layers via REST API ────────────────
log "Step 5/5 — Publishing PostGIS layers via REST API..."

if ! prepare_db_credentials; then
    err "Failed to prepare database credentials for GeoServer datastore."
    exit 1
fi

GS_REST="http://localhost:${GEOSERVER_PORT}/geoserver/rest"

# 5a. Create workspace
if rest_exists "${GS_REST}/workspaces/${WORKSPACE}.json"; then
    echo "  ✓ Workspace '${WORKSPACE}' exists."
else
    echo "  + Creating workspace '${WORKSPACE}'..."
    if rest_call POST "${GS_REST}/workspaces" \
        "{\"workspace\":{\"name\":\"${WORKSPACE}\"}}"; then
        echo "  ✓ Workspace created."
    else
        err "Failed to create workspace '${WORKSPACE}'."
        exit 1
    fi
fi

# 5b. Create PostGIS data store
if rest_exists "${GS_REST}/workspaces/${WORKSPACE}/datastores/${STORE_NAME}.json"; then
    echo "  ↻ Data store '${STORE_NAME}' exists. Reconciling configuration..."
    STORE_JSON="$(build_store_json)"
    if rest_call PUT "${GS_REST}/workspaces/${WORKSPACE}/datastores/${STORE_NAME}" "${STORE_JSON}"; then
        echo "  ✓ Data store updated."
    else
        err "Failed to update data store '${STORE_NAME}'."
        exit 1
    fi
else
    echo "  + Creating PostGIS data store '${STORE_NAME}'..."
    STORE_JSON="$(build_store_json)"
    if rest_call POST "${GS_REST}/workspaces/${WORKSPACE}/datastores" "${STORE_JSON}"; then
        echo "  ✓ Data store created."
    else
        err "Failed to create data store '${STORE_NAME}'."
        exit 1
    fi
fi

# 5c. Publish OSM layers
OSM_TABLES=("planet_osm_point" "planet_osm_line" "planet_osm_polygon" "planet_osm_roads")

for TABLE in "${OSM_TABLES[@]}"; do
    if rest_exists "${GS_REST}/workspaces/${WORKSPACE}/datastores/${STORE_NAME}/featuretypes/${TABLE}.json"; then
        echo "  ↻ Layer '${TABLE}' exists. Reconciling configuration..."
        LAYER_JSON="$(build_layer_json "${TABLE}")"
        if rest_call PUT "${GS_REST}/workspaces/${WORKSPACE}/datastores/${STORE_NAME}/featuretypes/${TABLE}" "${LAYER_JSON}"; then
            echo "  ✓ Layer '${TABLE}' updated."
        else
            warn "Failed to update layer '${TABLE}'. Continuing with remaining layers."
        fi
    else
        echo "  + Publishing layer '${TABLE}'..."
        LAYER_JSON="$(build_layer_json "${TABLE}")"
        if rest_call POST "${GS_REST}/workspaces/${WORKSPACE}/datastores/${STORE_NAME}/featuretypes" "${LAYER_JSON}"; then
            echo "  ✓ Layer '${TABLE}' published."
        else
            warn "Failed to publish layer '${TABLE}'. Continuing with remaining layers."
        fi
    fi
done

log "═══════════════════════════════════════════════════════════════"
log "  GeoServer Setup Complete!"
log "═══════════════════════════════════════════════════════════════"
echo ""
echo "  Web UI  : http://localhost:${GEOSERVER_PORT}/geoserver/web/"
echo "  Login   : ${GEOSERVER_USER} / ********"
echo "  WMS URL : http://localhost:${GEOSERVER_PORT}/geoserver/${WORKSPACE}/wms"
echo ""
if [[ "${GEOSERVER_PASS}" == "geoserver" ]]; then
    echo "  ⚠  You are using the DEFAULT admin password!"
    echo "     Change it immediately or set GEOSERVER_PASS env var before running this script."
fi
echo ""
