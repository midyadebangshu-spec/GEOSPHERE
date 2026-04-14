# Institutions ETL Pipeline (West Bengal)

This pipeline can fetch institutional datasets from UDISE+ and AISHE, extract OSM institutions from PostGIS, create/update the `institutions` table, and deduplicate against existing records before upsert.

## Install

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r data_pipeline/requirements.txt
```

## Run (single command)

```bash
chmod +x data_pipeline/run_institutions_pipeline.sh

UDISE_URL="https://.../udise.csv" \
AISHE_URL="https://.../aishe.csv" \
DB_HOST=localhost DB_PORT=5432 DB_NAME=osm_wb DB_USER=postgres DB_PASSWORD=... \
./data_pipeline/run_institutions_pipeline.sh
```

If local CSVs are missing, the runner automatically attempts to fetch files from source portal URLs using `data_pipeline/fetch_institutions_sources.py` and saves them into `data_pipeline/downloads/`.

Override portal URLs if needed:

```bash
UDISE_URL="https://your-udise-page" AISHE_URL="https://your-aishe-page" ./data_pipeline/run_institutions_pipeline.sh
```

You can also use local files:

```bash
UDISE_PATH="/path/to/udise.csv" \
AISHE_PATH="/path/to/aishe.csv" \
./data_pipeline/run_institutions_pipeline.sh
```

## Run (direct Python)

```bash
python3 data_pipeline/institutions_etl.py \
  --udise-path path/to/udise.csv \
  --aishe-path path/to/aishe.csv \
  --db-host localhost --db-port 5432 --db-name osm_wb --db-user postgres
```

If your DB has password auth:

```bash
python3 data_pipeline/institutions_etl.py ... --db-password YOUR_PASSWORD
```

## Dedup rules implemented

1. ID match: `udise_code` or `aishe_id` means same entity.
2. Spatial + fuzzy match: distance <= 100m and name similarity >= 0.85.
3. Merge precedence:
   - Name: Govt (UDISE/AISHE) > OSM
   - Coordinates: OSM > Govt
   - Address: Govt > OSM
   - Metadata: merged
4. Existing rows in `institutions` are included in dedup pass to avoid duplicates across reruns.

## Output

- Creates/updates table from `server/sql/institutions_schema.sql`.
- Upserts into `institutions` table.
- Prints fetch, merge, and final row statistics.
