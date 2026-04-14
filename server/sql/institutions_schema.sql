CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS institutions (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('school', 'college', 'university')),
    subtype TEXT,
    lat DOUBLE PRECISION,
    lon DOUBLE PRECISION,
    geom geometry(Point, 4326),
    address TEXT,
    district TEXT,
    source TEXT NOT NULL,
    source_id TEXT,
    udise_code TEXT,
    aishe_id TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_institutions_geom ON institutions USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_institutions_name_trgm ON institutions USING GIN (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_institutions_type ON institutions (type);
CREATE INDEX IF NOT EXISTS idx_institutions_district ON institutions (district);
CREATE INDEX IF NOT EXISTS idx_institutions_udise ON institutions (udise_code);
CREATE INDEX IF NOT EXISTS idx_institutions_aishe ON institutions (aishe_id);
CREATE INDEX IF NOT EXISTS idx_institutions_metadata_gin ON institutions USING GIN (metadata);

CREATE OR REPLACE FUNCTION set_institutions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_set_institutions_updated_at ON institutions;
CREATE TRIGGER trg_set_institutions_updated_at
BEFORE UPDATE ON institutions
FOR EACH ROW
EXECUTE FUNCTION set_institutions_updated_at();
