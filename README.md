# GeoSphere WB+

Self-hosted geospatial web app for West Bengal using PostGIS, GeoServer, OSRM, Nominatim, and a Node.js API/frontend.

## What this repo includes

- `frontend/` static UI (served by the Node API)
- `server/` Express API + proxy routes (routing, geocoding, tiles)
- `setup_data_pipeline.sh` downloads OSM data and imports into PostGIS
- `setup_geoserver.sh` installs/configures GeoServer and publishes layers
- `setup_osrm.sh` builds and runs OSRM in Docker
- `setup_nominatim.sh` imports and runs Nominatim in Docker
- `start_all.sh` starts everything in the right order

## Prerequisites

- Linux (Ubuntu/Debian recommended)
- A sudo-capable user
- Internet access (for package/image/data downloads)
- Recommended: 16 GB RAM+ and ~40 GB free disk
- Node.js 18+ and npm

Quick check:

```bash
node -v
npm -v
docker --version || /snap/bin/docker --version
```

## 1) Clone the repository

```bash
git clone <your-repo-url>
cd GEOSPHERE
```

## 2) Run one-time setup (in order)

### Step A — Download OSM and import PostGIS

```bash
chmod +x setup_data_pipeline.sh
./setup_data_pipeline.sh
```

This downloads `eastern-zone-latest.osm.pbf` (includes West Bengal) and imports into database `osm_wb`.

### Step B — Install/configure GeoServer and publish layers

```bash
chmod +x setup_geoserver.sh
./setup_geoserver.sh
```

Optional env overrides (example):

```bash
GEOSERVER_USER=admin GEOSERVER_PASS=geoserver ./setup_geoserver.sh
```

### Step C — Build/start OSRM

```bash
chmod +x setup_osrm.sh
./setup_osrm.sh
```

### Step D — Import/start Nominatim

```bash
chmod +x setup_nominatim.sh
./setup_nominatim.sh
```

## 3) Start the full app

```bash
chmod +x start_all.sh
./start_all.sh
```

`start_all.sh` also:

- Detects actual GeoServer/OSRM/Nominatim ports
- Syncs `server/.env` service URLs
- Installs `server/` dependencies if missing
- Starts API on port `4000`

## 4) Open and verify

Open:

- App UI: http://localhost:4000

Useful checks:

```bash
curl -sS http://localhost:4000/api/health
curl -sSI http://localhost:4000 | head -n 5
```

## Service endpoints (typical)

Ports may auto-shift if occupied; `start_all.sh` prints the final active ports.

- PostgreSQL: `localhost:5432`
- GeoServer: `http://localhost:<geoserver-port>/geoserver`
- OSRM: `http://localhost:<osrm-port>`
- Nominatim: `http://localhost:<nominatim-port>`
- API + Frontend: `http://localhost:4000`

## Re-running safely

These scripts are written to be idempotent/convergent. Re-running them should reconcile state instead of blindly recreating everything.

## Troubleshooting

- API not reachable:

```bash
cat logs/api-error.log
cat logs/api-out.log
```

- GeoServer status:

```bash
sudo systemctl status geoserver --no-pager
```

- Docker containers:

```bash
sudo docker ps -a || sudo /snap/bin/docker ps -a
```

- If a quick Cloudflare tunnel URL stops working (1033), restart tunnel and use the new URL.

## Optional: expose app publicly with Cloudflare Tunnel

See `CLOUDFLARE_TUNNEL.md` and run:

```bash
./start_tunnel_quick.sh
```

## License

See `LICENSE`.
