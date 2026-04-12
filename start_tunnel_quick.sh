#!/usr/bin/env bash
set -euo pipefail

URL="${1:-http://localhost:4000}"

if ! command -v cloudflared >/dev/null 2>&1; then
  echo "[ERROR] cloudflared is not installed."
  echo "Install: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"
  exit 1
fi

echo "Starting quick Cloudflare Tunnel for ${URL}"
echo "Press Ctrl+C to stop."
cloudflared tunnel --url "${URL}"
