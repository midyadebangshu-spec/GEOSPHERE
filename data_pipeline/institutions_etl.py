#!/usr/bin/env python3
import argparse
import csv
import hashlib
import json
import math
import re
import unicodedata
from dataclasses import dataclass, field
from difflib import SequenceMatcher
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple
from urllib.parse import urlparse
from urllib.request import urlretrieve

import psycopg2


@dataclass
class Institution:
    id: str
    name: str
    type: str
    subtype: str = ''
    lat: Optional[float] = None
    lon: Optional[float] = None
    address: str = ''
    district: str = ''
    source: str = ''
    source_id: str = ''
    udise_code: Optional[str] = None
    aishe_id: Optional[str] = None
    metadata: Dict = field(default_factory=dict)


def parse_args():
    parser = argparse.ArgumentParser(
        description='West Bengal institutions pipeline: fetch + create table + import + dedup + upsert'
    )

    parser.add_argument('--udise-path', help='Local UDISE CSV path')
    parser.add_argument('--udise-url', help='UDISE CSV download URL')
    parser.add_argument('--aishe-path', help='Local AISHE CSV path')
    parser.add_argument('--aishe-url', help='AISHE CSV download URL')
    parser.add_argument('--wbbse-csv', help='Local WBBSE schools CSV path')
    parser.add_argument('--osm-csv', help='Optional local OSM institutions CSV path')
    parser.add_argument('--skip-osm-db', action='store_true', help='Skip extracting OSM institutions from PostGIS')

    parser.add_argument('--downloads-dir', default='data_pipeline/downloads')
    parser.add_argument('--schema-sql', default='server/sql/institutions_schema.sql')

    parser.add_argument('--db-host', default='localhost')
    parser.add_argument('--db-port', type=int, default=5432)
    parser.add_argument('--db-name', default='osm_wb')
    parser.add_argument('--db-user', default='postgres')
    parser.add_argument('--db-password', default=None)

    args = parser.parse_args()

    if not any([args.udise_path, args.udise_url, args.aishe_path, args.aishe_url, args.wbbse_csv]):
        parser.error('Provide at least one input source (--wbbse-csv, --udise-..., or --aishe-...)')

    return args


def db_connect(args):
    conn_kwargs = {
        'host': args.db_host,
        'port': args.db_port,
        'dbname': args.db_name,
        'user': args.db_user,
    }
    if args.db_password:
        conn_kwargs['password'] = args.db_password

    return psycopg2.connect(**conn_kwargs)


def ensure_schema(conn, schema_sql_path: str):
    sql_path = Path(schema_sql_path)
    if not sql_path.exists():
        raise FileNotFoundError(f'Schema SQL not found: {schema_sql_path}')

    sql = sql_path.read_text(encoding='utf-8')
    with conn:
        with conn.cursor() as cur:
            cur.execute(sql)


def resolve_source_file(local_path: Optional[str], url: Optional[str], downloads_dir: Path, label: str) -> Path:
    if local_path:
        path = Path(local_path)
        if not path.exists():
            raise FileNotFoundError(f'{label} file not found: {local_path}')
        return path

    parsed = urlparse(url)
    filename = Path(parsed.path).name or f'{label.lower()}.csv'
    downloads_dir.mkdir(parents=True, exist_ok=True)
    target = downloads_dir / filename
    print(f'[Fetch] Downloading {label} from {url}')
    urlretrieve(url, target)
    return target


def read_csv(path: Path) -> Iterable[Dict[str, str]]:
    with path.open('r', encoding='utf-8-sig', newline='') as fh:
        reader = csv.DictReader(fh)
        for row in reader:
            out = {}
            for k, v in row.items():
                if k is not None:
                    out[k.strip()] = v.strip() if isinstance(v, str) else ('' if v is None else str(v).strip())
            yield out


def pick(row: Dict[str, str], keys: List[str], default=''):
    lower_map = {k.lower(): v for k, v in row.items()}
    for key in keys:
        value = lower_map.get(key.lower())
        if value:
            return value
    return default


def to_float(value: str) -> Optional[float]:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def infer_type(source_type: str, row: Dict[str, str], default_type: str):
    value = pick(row, ['type', 'institution_type', 'category', 'level'], default='').lower()
    if 'univ' in value:
        return 'university'
    if 'college' in value or 'technical' in value or 'polytechnic' in value:
        return 'college'
    if source_type == 'aishe' and default_type == 'college':
        return 'college'
    return default_type


def clean_name(name: str) -> str:
    name = unicodedata.normalize('NFKD', name or '').encode('ascii', 'ignore').decode('ascii')
    name = name.lower()
    name = re.sub(r'[^a-z0-9\s]', ' ', name)
    name = re.sub(r'\b(school|college|university|wb|west bengal|govt|government|private)\b', ' ', name)
    return re.sub(r'\s+', ' ', name).strip()


def name_similarity(a: str, b: str) -> float:
    return SequenceMatcher(None, clean_name(a), clean_name(b)).ratio()


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    radius = 6371000
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    value = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * radius * math.atan2(math.sqrt(value), math.sqrt(1 - value))


def stable_id(prefix: str, source_id: str, name: str, lat: Optional[float], lon: Optional[float]):
    raw = f'{prefix}|{source_id}|{name}|{lat}|{lon}'
    digest = hashlib.sha1(raw.encode('utf-8')).hexdigest()[:16]
    return f'inst_{digest}'


def map_udise(path: Path) -> List[Institution]:
    out = []
    for row in read_csv(path):
        udise_code = pick(row, ['udise_code', 'udise', 'school_code'])
        name = pick(row, ['school_name', 'name', 'institution_name'])
        if not name:
            continue

        lat = to_float(pick(row, ['lat', 'latitude']))
        lon = to_float(pick(row, ['lon', 'lng', 'longitude']))
        address = pick(row, ['address', 'full_address'])
        district = pick(row, ['district', 'district_name'])
        subtype = pick(row, ['management', 'school_management', 'school_type'])
        management = 'govt' if 'gov' in subtype.lower() or 'government' in subtype.lower() else 'private'
        inst_id = stable_id('udise', udise_code or name, name, lat, lon)

        out.append(Institution(
            id=inst_id,
            name=name,
            type=infer_type('udise', row, 'school'),
            subtype=subtype,
            lat=lat,
            lon=lon,
            address=address,
            district=district,
            source='udise',
            source_id=udise_code or name,
            udise_code=udise_code or None,
            metadata={'management': management, 'raw_source': 'udise'},
        ))
    return out


def map_aishe(path: Path) -> List[Institution]:
    out = []
    for row in read_csv(path):
        aishe_id = pick(row, ['aishe_id', 'aishe_code', 'institution_id'])
        name = pick(row, ['institution_name', 'name', 'college_name'])
        if not name:
            continue

        lat = to_float(pick(row, ['lat', 'latitude']))
        lon = to_float(pick(row, ['lon', 'lng', 'longitude']))
        address = pick(row, ['address', 'full_address'])
        district = pick(row, ['district', 'district_name'])
        subtype = pick(row, ['institute_type', 'subtype'])

        management = pick(row, ['management', 'ownership']).lower()
        if management in ('government', 'govt', 'public'):
            management = 'govt'
        elif management:
            management = 'private'

        inst_id = stable_id('aishe', aishe_id or name, name, lat, lon)

        out.append(Institution(
            id=inst_id,
            name=name,
            type=infer_type('aishe', row, 'college'),
            subtype=subtype,
            lat=lat,
            lon=lon,
            address=address,
            district=district,
            source='aishe',
            source_id=aishe_id or name,
            aishe_id=aishe_id or None,
            metadata={'management': management or 'private', 'raw_source': 'aishe'},
        ))
    return out


def map_wbbse(path: Optional[Path]) -> List[Institution]:
    if not path or not path.exists():
        return []

    out = []
    for row in read_csv(path):
        name = pick(row, ['SchoolName'])
        if not name:
            continue

        district = pick(row, ['DistrictName'])
        subdiv = pick(row, ['SubDivisionName'])
        zone = pick(row, ['ZoneName'])
        wbbse_id = pick(row, ['PreSchoolId', 'SchoolId', 'IndexNo', 'SchoolCode', 'DISECode'])
        
        phone = pick(row, ['PhoneNo', 'MobileNo'])
        address = f"SubDivision: {subdiv}, Zone: {zone}"
        
        designation = pick(row, ['Designation'])
        metadata = {'raw_source': 'wbbse'}
        if phone:
            metadata['phone'] = phone
        if designation:
            metadata['designation'] = designation

        inst_id = stable_id('wbbse', wbbse_id or name, name, None, None)

        out.append(Institution(
            id=inst_id,
            name=name,
            type='school',
            subtype='wbbse_affiliated',
            lat=None,
            lon=None,
            address=address,
            district=district,
            source='wbbse',
            source_id=wbbse_id or name,
            udise_code=pick(row, ['DISECode']) or None,
            metadata=metadata,
        ))
    return out


def map_osm_csv(path: Optional[Path]) -> List[Institution]:
    if not path:
        return []

    out = []
    for row in read_csv(path):
        name = pick(row, ['name'])
        if not name:
            continue

        amenity = pick(row, ['amenity', 'type'])
        if amenity not in ('school', 'college', 'university'):
            continue

        lat = to_float(pick(row, ['lat', 'latitude']))
        lon = to_float(pick(row, ['lon', 'lng', 'longitude']))
        osm_id = pick(row, ['osm_id', 'id'])

        out.append(Institution(
            id=stable_id('osm_csv', osm_id or name, name, lat, lon),
            name=name,
            type=amenity,
            lat=lat,
            lon=lon,
            address=pick(row, ['address', 'addr:full']),
            district=pick(row, ['district', 'addr:district']),
            source='osm',
            source_id=osm_id or name,
            metadata={'management': pick(row, ['management', 'operator:type']), 'raw_source': 'osm_csv'},
        ))
    return out


def fetch_osm_from_db(conn) -> List[Institution]:
    sql = """
        SELECT
            osm_id,
            name,
            tags->'amenity' AS amenity,
            tags->'addr:full' AS addr_full,
            tags->'addr:district' AS addr_district,
            tags->'is_in:state_district' AS state_district,
            tags->'operator:type' AS operator_type,
            ST_Y(ST_Transform(way, 4326)) AS lat,
            ST_X(ST_Transform(way, 4326)) AS lon
        FROM planet_osm_point
        WHERE
            name IS NOT NULL
            AND tags ? 'amenity'
            AND tags->'amenity' IN ('school', 'college', 'university')
    """

    out = []
    with conn.cursor() as cur:
        cur.execute(sql)
        rows = cur.fetchall()

    for row in rows:
        osm_id, name, amenity, addr_full, addr_district, state_district, operator_type, lat, lon = row
        district = addr_district or state_district or ''
        out.append(Institution(
            id=stable_id('osm_db', str(osm_id), name, lat, lon),
            name=name,
            type=amenity,
            lat=float(lat) if lat is not None else None,
            lon=float(lon) if lon is not None else None,
            address=addr_full or '',
            district=district,
            source='osm',
            source_id=str(osm_id),
            metadata={'management': operator_type or '', 'raw_source': 'osm_db'},
        ))
    return out


def fetch_existing_institutions(conn) -> List[Institution]:
    exists_sql = "SELECT to_regclass('public.institutions')"
    with conn.cursor() as cur:
        cur.execute(exists_sql)
        exists = cur.fetchone()[0]

    if not exists:
        return []

    sql = """
        SELECT
            id, name, type, subtype, lat, lon, address, district,
            source, source_id, udise_code, aishe_id, metadata
        FROM institutions
    """

    out = []
    with conn.cursor() as cur:
        cur.execute(sql)
        rows = cur.fetchall()

    for row in rows:
        out.append(Institution(
            id=row[0],
            name=row[1],
            type=row[2],
            subtype=row[3] or '',
            lat=float(row[4]) if row[4] is not None else None,
            lon=float(row[5]) if row[5] is not None else None,
            address=row[6] or '',
            district=row[7] or '',
            source=row[8] or '',
            source_id=row[9] or '',
            udise_code=row[10],
            aishe_id=row[11],
            metadata=row[12] or {},
        ))
    return out


def merge_records(primary: Institution, secondary: Institution) -> Institution:
    govt_sources = {'udise', 'aishe'}

    merged_name = primary.name
    if primary.source not in govt_sources and secondary.source in govt_sources:
        merged_name = secondary.name

    merged_lat = primary.lat
    merged_lon = primary.lon
    if primary.source != 'osm' and secondary.source == 'osm' and secondary.lat is not None and secondary.lon is not None:
        merged_lat = secondary.lat
        merged_lon = secondary.lon

    merged_address = primary.address
    if (not primary.address or primary.source == 'osm') and secondary.source in govt_sources and secondary.address:
        merged_address = secondary.address

    merged_metadata = dict(primary.metadata or {})
    merged_metadata.update(secondary.metadata or {})

    merged_source_set = set(primary.source.split('+')) | set(secondary.source.split('+'))

    return Institution(
        id=primary.id,
        name=merged_name,
        type=primary.type if primary.type != 'school' or secondary.type == 'school' else secondary.type,
        subtype=primary.subtype or secondary.subtype,
        lat=merged_lat if merged_lat is not None else secondary.lat,
        lon=merged_lon if merged_lon is not None else secondary.lon,
        address=merged_address or secondary.address,
        district=primary.district or secondary.district,
        source='+'.join(sorted(filter(None, merged_source_set))),
        source_id=primary.source_id,
        udise_code=primary.udise_code or secondary.udise_code,
        aishe_id=primary.aishe_id or secondary.aishe_id,
        metadata=merged_metadata,
    )


def deduplicate(records: List[Institution]) -> Tuple[List[Institution], int]:
    by_udise = {}
    by_aishe = {}
    merged: List[Institution] = []
    merges = 0

    for record in records:
        if record.udise_code and record.udise_code in by_udise:
            index = by_udise[record.udise_code]
            merged[index] = merge_records(merged[index], record)
            merges += 1
            continue

        if record.aishe_id and record.aishe_id in by_aishe:
            index = by_aishe[record.aishe_id]
            merged[index] = merge_records(merged[index], record)
            merges += 1
            continue

        match_index = None
        for idx, existing in enumerate(merged):
            if existing.lat is None or existing.lon is None or record.lat is None or record.lon is None:
                continue
            if haversine_m(existing.lat, existing.lon, record.lat, record.lon) > 100:
                continue
            if name_similarity(existing.name, record.name) < 0.85:
                continue
            match_index = idx
            break

        if match_index is not None:
            merged[match_index] = merge_records(merged[match_index], record)
            merges += 1
            if merged[match_index].udise_code:
                by_udise[merged[match_index].udise_code] = match_index
            if merged[match_index].aishe_id:
                by_aishe[merged[match_index].aishe_id] = match_index
        else:
            idx = len(merged)
            merged.append(record)
            if record.udise_code:
                by_udise[record.udise_code] = idx
            if record.aishe_id:
                by_aishe[record.aishe_id] = idx

    return merged, merges


def upsert_records(conn, records: List[Institution]):
    sql = """
        INSERT INTO institutions (
            id, name, type, subtype, lat, lon, geom, address, district,
            source, source_id, udise_code, aishe_id, metadata
        ) VALUES (
            %(id)s, %(name)s, %(type)s, %(subtype)s, %(lat)s, %(lon)s,
            CASE
                WHEN %(lon)s IS NOT NULL AND %(lat)s IS NOT NULL
                THEN ST_SetSRID(ST_MakePoint(%(lon)s, %(lat)s), 4326)
                ELSE NULL
            END,
            %(address)s, %(district)s, %(source)s, %(source_id)s,
            %(udise_code)s, %(aishe_id)s, %(metadata)s::jsonb
        )
        ON CONFLICT (id)
        DO UPDATE SET
            name = EXCLUDED.name,
            type = EXCLUDED.type,
            subtype = EXCLUDED.subtype,
            lat = EXCLUDED.lat,
            lon = EXCLUDED.lon,
            geom = EXCLUDED.geom,
            address = EXCLUDED.address,
            district = EXCLUDED.district,
            source = EXCLUDED.source,
            source_id = EXCLUDED.source_id,
            udise_code = EXCLUDED.udise_code,
            aishe_id = EXCLUDED.aishe_id,
            metadata = institutions.metadata || EXCLUDED.metadata,
            updated_at = NOW()
    """

    with conn:
        with conn.cursor() as cur:
            for rec in records:
                cur.execute(sql, {
                    'id': rec.id,
                    'name': rec.name,
                    'type': rec.type,
                    'subtype': rec.subtype,
                    'lat': rec.lat,
                    'lon': rec.lon,
                    'address': rec.address,
                    'district': rec.district,
                    'source': rec.source,
                    'source_id': rec.source_id,
                    'udise_code': rec.udise_code,
                    'aishe_id': rec.aishe_id,
                    'metadata': json.dumps(rec.metadata or {}),
                })


def main():
    args = parse_args()
    downloads_dir = Path(args.downloads_dir)

    udise_file = resolve_source_file(args.udise_path, args.udise_url, downloads_dir, 'UDISE') if (args.udise_path or args.udise_url) else None
    aishe_file = resolve_source_file(args.aishe_path, args.aishe_url, downloads_dir, 'AISHE') if (args.aishe_path or args.aishe_url) else None
    wbbse_file = Path(args.wbbse_csv) if args.wbbse_csv else None
    osm_csv_file = Path(args.osm_csv) if args.osm_csv else None

    conn = db_connect(args)
    try:
        ensure_schema(conn, args.schema_sql)

        existing = fetch_existing_institutions(conn)
        udise_records = map_udise(udise_file) if udise_file else []
        aishe_records = map_aishe(aishe_file) if aishe_file else []
        wbbse_records = map_wbbse(wbbse_file)
        osm_csv_records = map_osm_csv(osm_csv_file)
        osm_db_records = [] if args.skip_osm_db else fetch_osm_from_db(conn)

        incoming = [*udise_records, *aishe_records, *wbbse_records, *osm_csv_records, *osm_db_records]
        combined = [*existing, *incoming]

        deduped, merged_count = deduplicate(combined)
        upsert_records(conn, deduped)

        print('\nInstitutions pipeline complete')
        print(f'  Existing in DB: {len(existing)}')
        print(f'  UDISE fetched: {len(udise_records)}')
        print(f'  AISHE fetched: {len(aishe_records)}')
        print(f'  WBBSE fetched: {len(wbbse_records)}')
        print(f'  OSM CSV fetched: {len(osm_csv_records)}')
        print(f'  OSM DB fetched: {len(osm_db_records)}')
        print(f'  Combined before dedup: {len(combined)}')
        print(f'  Merged duplicates: {merged_count}')
        print(f'  Final unique rows: {len(deduped)}')
    finally:
        conn.close()


if __name__ == '__main__':
    main()
