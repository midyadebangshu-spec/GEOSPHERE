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
git clone https://github.com/midyadebangshu-spec/GEOSPHERE
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

### Optional: Enable AQI (OpenAQ)

To show AQI from the map context menu (`Know AQI`), set an OpenAQ API key:

```bash
cp server/.env.example server/.env  # if not already created
```

Then edit `server/.env` and set:

```dotenv
OPENAQ_API_KEY=your_openaq_api_key
```

Restart the API after updating `.env`.

### Optional: Enable Flickr images in place popup

The place insights popup always tries Wikimedia images. To include Flickr images as well, set:

```dotenv
FLICKR_API_KEY=your_flickr_api_key
```

The image API uses in-memory caching and per-client rate limiting to reduce upstream API usage.

## Service endpoints (typical)

Ports may auto-shift if occupied; `start_all.sh` prints the final active ports.

- PostgreSQL: `localhost:5432`
- GeoServer: `http://localhost:<geoserver-port>/geoserver`
- OSRM: `http://localhost:<osrm-port>`
- Nominatim: `http://localhost:<nominatim-port>`
- API + Frontend: `http://localhost:4000`

## Educational Institutions Integration (West Bengal)

This repo now includes a dedicated institutions data model and API for schools, colleges, and universities.

### 1) Create the institutions table

```bash
psql -h localhost -U postgres -d osm_wb -f server/sql/institutions_schema.sql
```

### 2) Ingest WBBSE schools (+ optional OSM export)

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r data_pipeline/requirements.txt

chmod +x data_pipeline/run_school_pipeline.sh

WBBSE_CSV="/absolute/path/to/wbbse_schools.csv" \
DB_HOST=localhost DB_PORT=5432 DB_NAME=osm_wb DB_USER=postgres DB_PASSWORD=... \
./data_pipeline/run_school_pipeline.sh
```

If `WBBSE_CSV` is not provided, the runner attempts to scrape and save the source file into `data_pipeline/downloads/wbbse_schools.csv`. It then imports and deduplicates against existing rows in `institutions`.

### 3) API endpoints

- `GET /api/institutions`
- `GET /api/institutions?type=school`
- `GET /api/institutions?near=22.57,88.36&radius=2000`
- `GET /api/institutions/:id`

Supported filters include `type`, `management`, `district`, `q`, and viewport bbox (`minLat`, `minLon`, `maxLat`, `maxLon`).

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
