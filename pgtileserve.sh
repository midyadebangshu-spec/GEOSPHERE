#!/usr/bin/env bash
###############################################################################
# GeoSphere India — pg_tileserv Launcher
# -------------------------------------------------------
# Starts pg_tileserv connected to the existing osm_india PostGIS database
#
# Usage:
#   chmod +x pgtileserve.sh
#   ./pgtileserve.sh
#
# The script will:
#   1. Check if PostgreSQL is running
#   2. Verify osm_india database exists and has PostGIS
#   3. Start/stop pg_tileserv Docker container
#   4. Provide useful status information
###############################################################################

set -euo pipefail
IFS=$'\n\t'

# ─── Configuration ───────────────────────────────────────────────────────────
readonly WORK_DIR="$(cd "$(dirname "$0")" && pwd)"
readonly DB_NAME="osm_india"
readonly DB_USER="postgres"
readonly DB_HOST="localhost"
readonly DB_PORT="5432"
readonly PGTILESERV_PORT="7800"
readonly CONTAINER_NAME="pg_tileserv"
readonly TUNNEL_NAME="pgtileserv-tunnel"
readonly TUNNEL_CONFIG_FILE="${WORK_DIR}/pgtileserv-tunnel.yml"

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

success() {
    echo -e "\033[1;32m[SUCCESS]\033[0m $*"
}

# ─── Functions ─────────────────────────────────────────────────────────────

check_postgres() {
    log "Checking PostgreSQL service..."
    
    if ! systemctl is-active --quiet postgresql; then
        warn "PostgreSQL is not running. Attempting to start..."
        sudo systemctl start postgresql
        if systemctl is-active --quiet postgresql; then
            success "PostgreSQL started successfully."
        else
            err "Failed to start PostgreSQL. Please check the service manually."
            exit 1
        fi
    else
        success "PostgreSQL is running."
    fi
}

check_database() {
    log "Checking database '${DB_NAME}'..."
    
    # Check if database exists
    if ! sudo -u "${DB_USER}" psql -lqt | cut -d \| -f 1 | grep -qw "${DB_NAME}"; then
        err "Database '${DB_NAME}' does not exist."
        echo "Please run the data pipeline first:"
        echo "  ./setup_data_pipeline.sh"
        exit 1
    fi
    
    # Check if PostGIS extension is enabled
    local postgis_enabled
    postgis_enabled=$(sudo -u "${DB_USER}" psql -d "${DB_NAME}" -tAc "SELECT 1 FROM pg_extension WHERE extname = 'postgis';" 2>/dev/null || echo "0")
    
    if [[ "${postgis_enabled}" != "1" ]]; then
        warn "PostGIS extension not found. Enabling it..."
        sudo -u "${DB_USER}" psql -d "${DB_NAME}" -c "CREATE EXTENSION IF NOT EXISTS postgis;"
        success "PostGIS extension enabled."
    else
        success "PostGIS extension is enabled."
    fi
}

check_docker() {
    log "Checking Docker..."
    
    if ! command -v docker &>/dev/null; then
        err "Docker is not installed or not in PATH."
        exit 1
    fi
    
    if ! sudo docker info &>/dev/null; then
        err "Cannot connect to Docker daemon. Please check Docker service."
        exit 1
    fi
    
    success "Docker is available."
}

start_pgtileserv() {
    log "Starting pg_tileserv..."
    
    # Stop existing container if running
    if sudo docker ps -q -f name="${CONTAINER_NAME}" | grep -q .; then
        log "Stopping existing pg_tileserv container..."
        sudo docker stop "${CONTAINER_NAME}" || true
        sudo docker rm "${CONTAINER_NAME}" || true
    fi
    
    # Start pg_tileserv container
    sudo docker run -d \
        --name "${CONTAINER_NAME}" \
        --restart unless-stopped \
        --network host \
        -e DATABASE_URL="postgresql://pgtileserv:pgtileserv123@localhost:5432/osm_india" \
        pramsey/pg_tileserv:latest
    
    # Wait a moment for startup
    sleep 3
    
    # Check if container is running
    if sudo docker ps -q -f name="${CONTAINER_NAME}" | grep -q .; then
        success "pg_tileserv started successfully!"
    else
        err "Failed to start pg_tileserv. Checking logs..."
        sudo docker logs "${CONTAINER_NAME}" 2>&1 | tail -10
        exit 1
    fi
}

stop_pgtileserv() {
    log "Stopping pg_tileserv..."
    
    if sudo docker ps -q -f name="${CONTAINER_NAME}" | grep -q .; then
        sudo docker stop "${CONTAINER_NAME}"
        sudo docker rm "${CONTAINER_NAME}"
        success "pg_tileserv stopped and removed."
    else
        warn "pg_tileserv container is not running."
    fi
}

show_status() {
    log "pg_tileserv Status"
    echo "───────────────────────────────────────"
    
    # Container status
    if sudo docker ps -q -f name="${CONTAINER_NAME}" | grep -q .; then
        echo "🟢 Container: Running"
        echo "📡 API URL: http://localhost:${PGTILESERV_PORT}"
        echo "📋 Layers: http://localhost:${PGTILESERV_PORT}/index.json"
    else
        echo "🔴 Container: Not running"
    fi
    
    # Database status
    echo "🗄️  Database: ${DB_NAME}"
    echo "👤 User: ${DB_USER}"
    echo "🌐 Host: ${DB_HOST}:${DB_PORT}"
    
    echo ""
    echo "Available tables with geometry:"
    sudo -u "${DB_USER}" psql -d "${DB_NAME}" -tAc "
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = information_schema.tables.table_name 
            AND data_type IN ('geometry', 'geography')
        )
        ORDER BY table_name;
    " 2>/dev/null | sed 's/^/  • /' || echo "  (No geometry tables found)"
    
    echo ""
}

show_usage() {
    echo "Usage: $0 [COMMAND]"
    echo ""
    echo "Commands:"
    echo "  start                Start pg_tileserv (default)"
    echo "  stop                 Stop pg_tileserv"
    echo "  restart              Restart pg_tileserv"
    echo "  status               Show status information"
    echo "  logs                 Show pg_tileserv logs"
    echo "  tunnel-start         Start temporary Cloudflare tunnel (free)"
    echo "  tunnel-start-permanent Start permanent Cloudflare tunnel (requires CF account)"
    echo "  tunnel-stop          Stop Cloudflare tunnel"
    echo "  tunnel-status        Show tunnel status"
    echo "  help                 Show this help message"
    echo ""
    echo "Environment Variables:"
    echo "  CF_DOMAIN          Your domain for permanent Cloudflare tunnel (e.g., example.com)"
    echo ""
    echo "Examples:"
    echo "  $0                           # Start pg_tileserv"
    echo "  $0 status                    # Show current status"
    echo "  $0 stop                      # Stop pg_tileserv"
    echo "  $0 tunnel-start              # Start temporary tunnel"
    echo "  export CF_DOMAIN=example.com"
    echo "  $0 tunnel-start-permanent    # Start permanent tunnel with custom domain"
    echo "  $0 tunnel-status             # Show tunnel status"
}

show_logs() {
    log "pg_tileserv Logs (last 20 lines)"
    echo "───────────────────────────────────────"
    
    if sudo docker ps -q -f name="${CONTAINER_NAME}" | grep -q .; then
        sudo docker logs "${CONTAINER_NAME}" --tail 20
    else
        warn "pg_tileserv container is not running."
    fi
}

check_cloudflared() {
    log "Checking cloudflared..."
    
    if ! command -v cloudflared &>/dev/null; then
        err "cloudflared is not installed or not in PATH."
        echo "Please install cloudflared:"
        echo "  wget -q https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb"
        echo "  sudo dpkg -i cloudflared-linux-amd64.deb"
        exit 1
    fi
    
    success "cloudflared is available."
}

create_tunnel_config() {
    log "Creating Cloudflare tunnel configuration..."
    
    cat > "${TUNNEL_CONFIG_FILE}" << EOF
tunnel: ${TUNNEL_NAME}
credentials-file: ${HOME}/.cloudflared/${TUNNEL_NAME}.json

ingress:
  - hostname: pgtileserv.${CF_DOMAIN:-your-domain.com}
    service: http://localhost:${PGTILESERV_PORT}
  - service: http_status:404
EOF
    
    success "Tunnel configuration created: ${TUNNEL_CONFIG_FILE}"
}

start_tunnel() {
    log "Starting Cloudflare tunnel..."
    
    # Start temporary tunnel (free service)
    log "Starting temporary Cloudflare tunnel..."
    nohup cloudflared tunnel --url http://localhost:${PGTILESERV_PORT} > "${WORK_DIR}/tunnel.log" 2>&1 &
    local tunnel_pid=$!
    echo "${tunnel_pid}" > "${WORK_DIR}/tunnel.pid"
    
    # Wait for tunnel to start and get URL
    sleep 10
    
    if kill -0 "${tunnel_pid}" 2>/dev/null; then
        # Extract tunnel URL from logs
        local tunnel_url
        tunnel_url=$(grep -o 'https://[^[:space:]]*\.trycloudflare\.com' "${WORK_DIR}/tunnel.log" | head -1)
        
        if [[ -n "${tunnel_url}" ]]; then
            success "Cloudflare tunnel started successfully!"
            echo "🌐 Tunnel URL: ${tunnel_url}"
            echo "📋 API Layers: ${tunnel_url}/index.json"
            echo ""
            echo "📝 Note: This is a temporary tunnel URL."
            echo "   For a permanent custom domain, set up Cloudflare account:"
            echo "   1. Log in: cloudflared tunnel login"
            echo "   2. Set domain: export CF_DOMAIN=your-domain.com"
            echo "   3. Start permanent tunnel: ./pgtileserve.sh tunnel-start-permanent"
        else
            warn "Tunnel started but URL not found in logs. Check:"
            echo "  tail -f ${WORK_DIR}/tunnel.log"
        fi
    else
        err "Failed to start Cloudflare tunnel."
        cat "${WORK_DIR}/tunnel.log" | tail -10
        exit 1
    fi
}

start_tunnel_permanent() {
    log "Starting permanent Cloudflare tunnel..."
    
    # Check if user is logged in
    if ! cloudflared tunnel list &>/dev/null; then
        err "Not logged into Cloudflare. Please run:"
        echo "  cloudflared tunnel login"
        exit 1
    fi
    
    # Check if tunnel already exists
    if cloudflared tunnel list | grep -q "${TUNNEL_NAME}"; then
        log "Tunnel '${TUNNEL_NAME}' already exists."
    else
        log "Creating new tunnel '${TUNNEL_NAME}'..."
        cloudflared tunnel create "${TUNNEL_NAME}"
        success "Tunnel created successfully."
    fi
    
    # Create DNS record if needed
    if [[ -n "${CF_DOMAIN:-}" ]]; then
        log "Creating DNS record for pgtileserv.${CF_DOMAIN}..."
        cloudflared tunnel route dns "${TUNNEL_NAME}" "pgtileserv.${CF_DOMAIN}" || true
    else
        err "CF_DOMAIN environment variable not set."
        echo "Please set your domain:"
        echo "  export CF_DOMAIN=your-domain.com"
        echo "  ./pgtileserve.sh tunnel-start-permanent"
        exit 1
    fi
    
    # Create tunnel config
    create_tunnel_config
    
    # Start tunnel in background
    log "Starting tunnel service..."
    nohup cloudflared tunnel run --config "${TUNNEL_CONFIG_FILE}" "${TUNNEL_NAME}" > "${WORK_DIR}/tunnel.log" 2>&1 &
    local tunnel_pid=$!
    echo "${tunnel_pid}" > "${WORK_DIR}/tunnel.pid"
    
    # Wait a moment for startup
    sleep 5
    
    if kill -0 "${tunnel_pid}" 2>/dev/null; then
        success "Cloudflare tunnel started successfully!"
        echo "🌐 Tunnel URL: https://pgtileserv.${CF_DOMAIN}"
        echo "📋 API Layers: https://pgtileserv.${CF_DOMAIN}/index.json"
    else
        err "Failed to start Cloudflare tunnel."
        cat "${WORK_DIR}/tunnel.log" | tail -10
        exit 1
    fi
}

stop_tunnel() {
    log "Stopping Cloudflare tunnel..."
    
    if [[ -f "${WORK_DIR}/tunnel.pid" ]]; then
        local tunnel_pid
        tunnel_pid=$(cat "${WORK_DIR}/tunnel.pid")
        if kill -0 "${tunnel_pid}" 2>/dev/null; then
            kill "${tunnel_pid}"
            rm -f "${WORK_DIR}/tunnel.pid"
            success "Cloudflare tunnel stopped."
        else
            warn "Tunnel process not found."
            rm -f "${WORK_DIR}/tunnel.pid"
        fi
    else
        warn "No tunnel PID file found."
    fi
}

show_tunnel_status() {
    log "Cloudflare Tunnel Status"
    echo "───────────────────────────────────────"
    
    if [[ -f "${WORK_DIR}/tunnel.pid" ]]; then
        local tunnel_pid
        tunnel_pid=$(cat "${WORK_DIR}/tunnel.pid")
        if kill -0 "${tunnel_pid}" 2>/dev/null; then
            echo "🟢 Tunnel: Running (PID: ${tunnel_pid})"
            
            # Extract actual tunnel URL from logs
            local tunnel_url
            tunnel_url=$(grep -o 'https://[^[:space:]]*\.trycloudflare\.com' "${WORK_DIR}/tunnel.log" 2>/dev/null | head -1)
            
            if [[ -n "${tunnel_url}" ]]; then
                echo "🌐 URL: ${tunnel_url}"
                echo "📋 API: ${tunnel_url}/index.json"
            else
                echo "🌐 URL: https://pgtileserv.${CF_DOMAIN:-your-domain.com}"
                echo "📋 API: https://pgtileserv.${CF_DOMAIN:-your-domain.com}/index.json"
            fi
        else
            echo "🔴 Tunnel: Not running"
        fi
    else
        echo "🔴 Tunnel: Not running"
    fi
    
    echo ""
    echo "To set up tunnel with custom domain:"
    echo "  export CF_DOMAIN=your-domain.com"
    echo "  ./pgtileserve.sh tunnel-start-permanent"
    echo ""
}

# ─── Main ───────────────────────────────────────────────────────────────────

main() {
    local command="${1:-start}"
    
    case "${command}" in
        "start")
            check_docker
            check_postgres
            check_database
            start_pgtileserv
            show_status
            ;;
        "stop")
            stop_pgtileserv
            ;;
        "restart")
            check_docker
            check_postgres
            check_database
            stop_pgtileserv
            start_pgtileserv
            show_status
            ;;
        "status")
            show_status
            ;;
        "logs")
            show_logs
            ;;
        "tunnel-start")
            check_cloudflared
            start_tunnel
            ;;
        "tunnel-start-permanent")
            check_cloudflared
            start_tunnel_permanent
            ;;
        "tunnel-stop")
            stop_tunnel
            ;;
        "tunnel-status")
            show_tunnel_status
            ;;
        "help"|"-h"|"--help")
            show_usage
            ;;
        *)
            err "Unknown command: ${command}"
            echo ""
            show_usage
            exit 1
            ;;
    esac
}

# Run main function with all arguments
main "$@"
