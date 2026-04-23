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
echo "Waiting for tunnel URL to update frontend/js/env.js..."

cloudflared tunnel --url "${URL}" 2>&1 | while IFS= read -r line; do
  echo "$line"
  if [[ "$line" =~ (https://[a-zA-Z0-9-]+\.trycloudflare\.com) ]]; then
    # Output to env.js so the frontend and Android app can use it
    echo "window.GEOSPHERE_API_BASE = '${BASH_REMATCH[1]}';" > frontend/js/env.js
    echo "=========================================================="
    echo "--> [SUCCESS] Saved tunnel URL to frontend/js/env.js"
    echo "=========================================================="
  fi
done
