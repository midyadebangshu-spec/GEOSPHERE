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
readonly GEOSERVER_PORT="8080"
readonly GEOSERVER_USER="admin"
readonly GEOSERVER_PASS="geoserver"

readonly WORKSPACE="geosphere_wb"
readonly STORE_NAME="osm_wb_store"
readonly DB_NAME="osm_wb"
readonly DB_HOST="localhost"
readonly DB_PORT="5432"
readonly DB_USER="postgres"
readonly DB_PASS=""

readonly SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# ─── Helpers ─────────────────────────────────────────────────────────────────
log() { echo -e "\n\033[1;34m[$(date '+%H:%M:%S')]\033[0m \033[1m$*\033[0m"; }
warn() { echo -e "\033[1;33m[WARNING]\033[0m $*"; }
err()  { echo -e "\033[1;31m[ERROR]\033[0m $*" >&2; }

wait_for_geoserver() {
    local max_wait=60
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
        wget -q --show-progress -O "${ZIPFILE}" "${GEOSERVER_URL}"
    fi

    echo "  ↗ Extracting to ${GEOSERVER_HOME}..."
    sudo mkdir -p "${GEOSERVER_HOME}"
    sudo unzip -q -o "${ZIPFILE}" -d "${GEOSERVER_HOME}"
    rm -f "${ZIPFILE}"

    echo "  ✓ GeoServer installed."
fi

# Set ownership
sudo chown -R "${USER}:${USER}" "${GEOSERVER_HOME}"

# ─── Step 3: Enable CORS in GeoServer ───────────────────────────────────────
log "Step 3/5 — Enabling CORS..."

WEBXML="${GEOSERVER_HOME}/start.jar"
JETTY_WEBXML="${GEOSERVER_HOME}/etc/webdefault.xml"

# Enable CORS in the GeoServer web.xml
GS_WEBXML="${GEOSERVER_HOME}/webapps/geoserver/WEB-INF/web.xml"

if grep -q "CorsFilter" "${GS_WEBXML}" 2>/dev/null; then
    echo "  ✓ CORS already configured."
else
    echo "  + Adding CORS filter to web.xml..."
    # Insert CORS filter before </web-app>
    sudo sed -i '/<\/web-app>/i \
    <!-- CORS Filter -->\
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
    echo "  ✓ CORS filter added."
fi

# ─── Step 4: Create systemd Service ─────────────────────────────────────────
log "Step 4/5 — Creating systemd service..."

SERVICE_FILE="/etc/systemd/system/geoserver.service"

if [[ -f "${SERVICE_FILE}" ]]; then
    echo "  ✓ Service file already exists."
else
    sudo tee "${SERVICE_FILE}" > /dev/null <<EOF
[Unit]
Description=GeoServer ${GEOSERVER_VERSION}
After=network.target postgresql.service

[Service]
Type=simple
User=${USER}
Group=${USER}
Environment="GEOSERVER_HOME=${GEOSERVER_HOME}"
Environment="JAVA_OPTS=-Xms256m -Xmx2g -XX:+UseG1GC"
ExecStart=${GEOSERVER_HOME}/bin/startup.sh
ExecStop=${GEOSERVER_HOME}/bin/shutdown.sh
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF
    sudo systemctl daemon-reload
    echo "  ✓ Service created."
fi

# Start GeoServer
if systemctl is-active --quiet geoserver; then
    echo "  ✓ GeoServer is already running."
else
    echo "  ▶ Starting GeoServer..."
    sudo systemctl start geoserver
    sudo systemctl enable geoserver 2>/dev/null || true
fi

wait_for_geoserver

# ─── Step 5: Configure Workspace, Store & Layers via REST API ────────────────
log "Step 5/5 — Publishing PostGIS layers via REST API..."

GS_REST="http://localhost:${GEOSERVER_PORT}/geoserver/rest"
AUTH="${GEOSERVER_USER}:${GEOSERVER_PASS}"

# 5a. Create workspace
if curl -s -u "${AUTH}" "${GS_REST}/workspaces/${WORKSPACE}.json" 2>/dev/null | grep -q "${WORKSPACE}"; then
    echo "  ✓ Workspace '${WORKSPACE}' exists."
else
    echo "  + Creating workspace '${WORKSPACE}'..."
    curl -s -u "${AUTH}" -XPOST "${GS_REST}/workspaces" \
        -H "Content-Type: application/json" \
        -d "{\"workspace\":{\"name\":\"${WORKSPACE}\"}}"
    echo "  ✓ Workspace created."
fi

# 5b. Create PostGIS data store
if curl -s -u "${AUTH}" "${GS_REST}/workspaces/${WORKSPACE}/datastores/${STORE_NAME}.json" 2>/dev/null | grep -q "${STORE_NAME}"; then
    echo "  ✓ Data store '${STORE_NAME}' exists."
else
    echo "  + Creating PostGIS data store '${STORE_NAME}'..."
    curl -s -u "${AUTH}" -XPOST \
        "${GS_REST}/workspaces/${WORKSPACE}/datastores" \
        -H "Content-Type: application/json" \
        -d "{
            \"dataStore\": {
                \"name\": \"${STORE_NAME}\",
                \"type\": \"PostGIS\",
                \"connectionParameters\": {
                    \"entry\": [
                        {\"@key\": \"host\",     \"\$\": \"${DB_HOST}\"},
                        {\"@key\": \"port\",     \"\$\": \"${DB_PORT}\"},
                        {\"@key\": \"database\", \"\$\": \"${DB_NAME}\"},
                        {\"@key\": \"user\",     \"\$\": \"${DB_USER}\"},
                        {\"@key\": \"passwd\",   \"\$\": \"${DB_PASS}\"},
                        {\"@key\": \"dbtype\",   \"\$\": \"postgis\"},
                        {\"@key\": \"schema\",   \"\$\": \"public\"}
                    ]
                }
            }
        }"
    echo "  ✓ Data store created."
fi

# 5c. Publish OSM layers
OSM_TABLES=("planet_osm_point" "planet_osm_line" "planet_osm_polygon" "planet_osm_roads")

for TABLE in "${OSM_TABLES[@]}"; do
    if curl -s -u "${AUTH}" "${GS_REST}/workspaces/${WORKSPACE}/datastores/${STORE_NAME}/featuretypes/${TABLE}.json" 2>/dev/null | grep -q "${TABLE}"; then
        echo "  ✓ Layer '${TABLE}' already published."
    else
        echo "  + Publishing layer '${TABLE}'..."
        curl -s -u "${AUTH}" -XPOST \
            "${GS_REST}/workspaces/${WORKSPACE}/datastores/${STORE_NAME}/featuretypes" \
            -H "Content-Type: application/json" \
            -d "{
                \"featureType\": {
                    \"name\": \"${TABLE}\",
                    \"nativeName\": \"${TABLE}\",
                    \"title\": \"${TABLE}\",
                    \"srs\": \"EPSG:4326\",
                    \"nativeCRS\": \"EPSG:3857\"
                }
            }"
        echo "  ✓ Layer '${TABLE}' published."
    fi
done

log "═══════════════════════════════════════════════════════════════"
log "  GeoServer Setup Complete!"
log "═══════════════════════════════════════════════════════════════"
echo ""
echo "  Web UI  : http://localhost:${GEOSERVER_PORT}/geoserver/web/"
echo "  Login   : ${GEOSERVER_USER} / ${GEOSERVER_PASS}"
echo "  WMS URL : http://localhost:${GEOSERVER_PORT}/geoserver/${WORKSPACE}/wms"
echo ""
echo "  ⚠  Change the default admin password immediately!"
echo ""
