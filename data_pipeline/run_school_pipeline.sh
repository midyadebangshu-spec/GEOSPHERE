#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Resolve relative paths before changing directories
[[ -n "${WBBSE_CSV:-}" && -f "$WBBSE_CSV" ]] && WBBSE_CSV="$(readlink -f "$WBBSE_CSV")"
[[ -n "${OSM_CSV:-}" && -f "$OSM_CSV" ]] && OSM_CSV="$(readlink -f "$OSM_CSV")"

cd "$ROOT_DIR"

# Load local .env if present (optional)
if [[ -f "$ROOT_DIR/.env" ]]; then
  set -a
  source "$ROOT_DIR/.env"
  set +a
fi

PYTHON_BIN="${PYTHON_BIN:-python3}"
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-osm_wb}"
DB_USER="${DB_USER:-postgres}"
DB_PASSWORD="${DB_PASSWORD:-}"
if [[ -z "$DB_PASSWORD" && -n "${PGPASSWORD:-}" ]]; then
  DB_PASSWORD="$PGPASSWORD"
fi

WBBSE_CSV_INPUT="${WBBSE_CSV:-}"
DEFAULT_WBBSE_CSV="$SCRIPT_DIR/downloads/wbbse_schools.csv"
WBBSE_CSV="${WBBSE_CSV:-$DEFAULT_WBBSE_CSV}"
OSM_CSV="${OSM_CSV:-}"

if [[ -n "$WBBSE_CSV_INPUT" && ! -f "$WBBSE_CSV_INPUT" ]]; then
  echo "[ERROR] WBBSE_CSV file does not exist: $WBBSE_CSV_INPUT"
  exit 1
fi

validate_csv_path() {
  local label="$1"
  local value="$2"
  if [[ -z "$value" ]]; then return 0; fi
  if [[ ! -f "$value" ]]; then
    echo "[ERROR] ${label}_PATH points to a missing file: $value"
    exit 1
  fi
  if [[ "${value,,}" != *.csv ]]; then
    echo "[ERROR] ${label}_PATH must be a CSV file. Got: $value"
    exit 1
  fi
}

preflight_db_connection() {
  local host="$1"
  local port="$2"
  local dbname="$3"
  local user="$4"
  local password="$5"

  DB_TEST_HOST="$host" \
  DB_TEST_PORT="$port" \
  DB_TEST_NAME="$dbname" \
  DB_TEST_USER="$user" \
  DB_TEST_PASSWORD="$password" \
  python3 - <<'PY'
import os
import sys
import psycopg2

kwargs = {
  'host': os.environ['DB_TEST_HOST'],
  'port': int(os.environ['DB_TEST_PORT']),
  'dbname': os.environ['DB_TEST_NAME'],
  'user': os.environ['DB_TEST_USER'],
}
password = os.environ.get('DB_TEST_PASSWORD', '')
if password:
  kwargs['password'] = password

try:
  conn = psycopg2.connect(**kwargs)
  conn.close()
except Exception as exc:
  print(str(exc))
  sys.exit(1)
PY
}

if [[ ! -d .venv ]]; then
  "$PYTHON_BIN" -m venv .venv
fi
source .venv/bin/activate
pip install -q -r data_pipeline/requirements.txt

if [[ ! -f "$WBBSE_CSV" ]]; then
  echo "[INFO] WBBSE CSV not found at $WBBSE_CSV. Scraping from WBBSE portal..."
  python data_pipeline/fetch_wbbse_schools.py --out-csv "$DEFAULT_WBBSE_CSV"
  if [[ -f "$DEFAULT_WBBSE_CSV" ]]; then
    WBBSE_CSV="$DEFAULT_WBBSE_CSV"
  fi
fi

validate_csv_path "WBBSE" "$WBBSE_CSV"

if [[ ! -f "$WBBSE_CSV" ]]; then
  echo "[ERROR] Missing WBBSE CSV file after scraping attempt."
  exit 1
fi

echo "[INFO] WBBSE source: $WBBSE_CSV"

if [[ -z "$DB_PASSWORD" ]]; then
  if [[ -t 0 ]]; then
    echo "[INFO] DB_PASSWORD not set. Enter PostgreSQL password for user '$DB_USER' (input hidden)."
    read -r -s -p "PostgreSQL password: " DB_PASSWORD
    echo
  else
    echo "[WARN] DB_PASSWORD is empty. If PostgreSQL requires password auth, set DB_PASSWORD before running."
  fi
fi

DB_PREFLIGHT_ERR=""
if ! DB_PREFLIGHT_ERR="$(preflight_db_connection "$DB_HOST" "$DB_PORT" "$DB_NAME" "$DB_USER" "$DB_PASSWORD" 2>&1)"; then
  FALLBACK_SUCCESS=0
  if [[ "$DB_USER" == "postgres" ]]; then
    FALLBACK_USER="$(whoami)"
    FALLBACK_HOST="/var/run/postgresql"
    echo "[WARN] DB preflight failed for DB_USER='postgres'. Trying local socket with DB_USER='${FALLBACK_USER}'..."
    if DB_PREFLIGHT_ERR="$(preflight_db_connection "$FALLBACK_HOST" "$DB_PORT" "$DB_NAME" "$FALLBACK_USER" "" 2>&1)"; then
      DB_USER="$FALLBACK_USER"
      DB_HOST="$FALLBACK_HOST"
      DB_PASSWORD=""
      echo "[INFO] DB fallback succeeded (host=$DB_HOST user=$DB_USER)."
      FALLBACK_SUCCESS=1
    fi
  fi

  if [[ "$FALLBACK_SUCCESS" == "0" ]]; then
    echo "[ERROR] Database preflight connection failed."
    echo "[INFO] host=$DB_HOST port=$DB_PORT db=$DB_NAME user=$DB_USER"
    echo "[INFO] psycopg2 error: $DB_PREFLIGHT_ERR"
    exit 1
  fi
fi

ARGS=(
  --db-host "$DB_HOST"
  --db-port "$DB_PORT"
  --db-name "$DB_NAME"
  --db-user "$DB_USER"
  --wbbse-csv "$WBBSE_CSV"
)

if [[ -n "$DB_PASSWORD" ]]; then ARGS+=(--db-password "$DB_PASSWORD"); fi
if [[ -n "$OSM_CSV" ]]; then validate_csv_path "OSM" "$OSM_CSV"; ARGS+=(--osm-csv "$OSM_CSV"); fi

echo "[INFO] Running school pipeline..."
python data_pipeline/institutions_etl.py "${ARGS[@]}"

echo "[INFO] Done."
