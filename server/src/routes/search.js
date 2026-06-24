/**
 * GeoSphere WB+ — Forward Geocoding / Search Route
 * 
 * GET /api/search?q=Victoria+Memorial&limit=10
 * 
 * Proxies search queries to the local Nominatim instance AND the federated PostGIS database.
 * Results from custom database sources (WBBSE/UDISE/AISHE) are boosted via importance injection.
 * Results bounded to India.
 */

const express = require('express');
const router = express.Router();
const { query: dbQuery } = require('../db');

const NOMINATIM_URL = process.env.NOMINATIM_URL || 'http://localhost:8088';

// India bounding box (approximate)
const INDIA_VIEWBOX = '68.1,37.1,97.4,6.7';

router.get('/', async (req, res, next) => {
    try {
        const { q, limit = 10, bounded = 1 } = req.query;

        if (!q || q.trim().length === 0) {
            return res.status(400).json({ error: 'Missing search query parameter "q".' });
        }

        const maxResults = Math.min(parseInt(limit) || 10, 50);
        const searchQuery = q.trim();

        // 1. Nominatim Promise (API request)
        const nomUrl = `${NOMINATIM_URL}/search?` + new URLSearchParams({
            q: searchQuery,
            format: 'jsonv2',
            addressdetails: '1',
            limit: maxResults.toString(),
            viewbox: INDIA_VIEWBOX,
            bounded: bounded.toString(),
            countrycodes: 'in',
        }).toString();

        const nominatimPromise = fetch(nomUrl, {
            headers: { 'User-Agent': 'GeoSphereWB/1.0' },
        }).then(r => r.ok ? r.json() : []).catch(err => {
            console.error('Nominatim Search Error:', err.message);
            return [];
        });

        // 2. Direct OSM PostGIS search (India-wide from osm_india tables)
        // This provides all-India coverage independent of the local Nominatim instance
        const osmPlacePromise = dbQuery(
            `(SELECT
                osm_id,
                name,
                COALESCE(tags->'place', tags->'amenity', tags->'tourism', tags->'shop', 'place') AS place_type,
                COALESCE(tags->'addr:district', tags->'is_in:district', '') AS district,
                COALESCE(tags->'addr:state', tags->'is_in:state', '') AS state,
                ST_Y(ST_Transform(way, 4326)) AS lat,
                ST_X(ST_Transform(way, 4326)) AS lon
             FROM planet_osm_point
             WHERE name ILIKE $1
             ORDER BY
                CASE
                    WHEN LOWER(name) = LOWER($2) THEN 0
                    WHEN LOWER(name) LIKE LOWER($2) || '%' THEN 1
                    ELSE 2
                END,
                CASE tags->'place'
                    WHEN 'city' THEN 0
                    WHEN 'town' THEN 1
                    WHEN 'suburb' THEN 2
                    WHEN 'village' THEN 3
                    ELSE 4
                END
             LIMIT $3)
            UNION ALL
            (SELECT
                osm_id,
                name,
                COALESCE(tags->'place', tags->'amenity', tags->'tourism', tags->'shop', 'place') AS place_type,
                COALESCE(tags->'addr:district', tags->'is_in:district', '') AS district,
                COALESCE(tags->'addr:state', tags->'is_in:state', '') AS state,
                ST_Y(ST_Centroid(ST_Transform(way, 4326))) AS lat,
                ST_X(ST_Centroid(ST_Transform(way, 4326))) AS lon
             FROM planet_osm_polygon
             WHERE name ILIKE $1
               AND (tags ? 'place' OR tags ? 'amenity' OR building IS NOT NULL)
             ORDER BY
                CASE
                    WHEN LOWER(name) = LOWER($2) THEN 0
                    WHEN LOWER(name) LIKE LOWER($2) || '%' THEN 1
                    ELSE 2
                END,
                CASE tags->'place'
                    WHEN 'city' THEN 0
                    WHEN 'town' THEN 1
                    WHEN 'suburb' THEN 2
                    WHEN 'village' THEN 3
                    ELSE 4
                END
             LIMIT $3)`,
            [`%${searchQuery}%`, searchQuery, maxResults]
        ).then(result => result.rows).catch(err => {
            console.error('OSM Place Search Error:', err.message);
            return [];
        });

        // 3. Institutions Promise (Database query for freshly merged DB sets)
        const postgisPromise = dbQuery(
            `SELECT id, name, type, subtype, address, source, lat, lon
             FROM institutions
             WHERE name ILIKE $1 OR address ILIKE $1
             LIMIT $2`,
            [`%${searchQuery}%`, maxResults]
        ).then(result => result.rows).catch(err => {
            console.error('PostGIS Search Error:', err.message);
            return [];
        });

        // 4. Mandirs Promise (Satsang mandir locations)
        const mandirPromise = dbQuery(
            `SELECT sem_id, name, address, district, state, pincode, image_url, worker_details,
                    ST_Y(geom) AS lat, ST_X(geom) AS lon
             FROM mandirs
             WHERE name ILIKE $1 OR address ILIKE $1
                OR district ILIKE $1 OR state ILIKE $1
             LIMIT $2`,
            [`%${searchQuery}%`, maxResults]
        ).then(result => result.rows).catch(err => {
            console.error('Mandir Search Error:', err.message);
            return [];
        });

        // Execute all queries in parallel
        const [nomData, osmPlaceData, pgData, mandirData] = await Promise.all([
            nominatimPromise, osmPlacePromise, postgisPromise, mandirPromise
        ]);

        // Transform PostGIS rows into Nominatim format arrays guaranteeing exact UI parsing 
        const pgResults = pgData.map(row => {
            const isWbbse = row.source === 'wbbse';
            return {
                osm_id: parseInt(row.id.replace(/\D/g, '') || 0) || row.id, // Fallback integer parsing 
                osm_type: 'node',
                display_name: `${row.name}${row.address ? ', ' + row.address : ''} [${isWbbse ? 'WBBSE School' : 'Institution'}]`,
                lat: row.lat !== null ? parseFloat(row.lat) : 23.5, // Center offset fallback
                lon: row.lon !== null ? parseFloat(row.lon) : 87.5,
                type: row.subtype || 'amenity',
                category: row.type || 'school',
                importance: 0.99, // Float perfectly to the top of standard search
                address: row.address ? { common: row.address } : {},
                boundingbox: row.lat !== null ? [row.lat, row.lat, row.lon, row.lon].map(String) : null
            };
        });

        // Transform Mandir rows into Nominatim format
        const mandirResults = mandirData.map(row => {
            const fullAddress = [row.address, row.district, row.state, row.pincode]
                .filter(Boolean).join(', ');
            return {
                osm_id: row.sem_id,
                osm_type: 'node',
                display_name: `${row.name}${fullAddress ? ', ' + fullAddress : ''} [Mandir]`,
                lat: row.lat !== null ? parseFloat(row.lat) : null,
                lon: row.lon !== null ? parseFloat(row.lon) : null,
                type: 'place_of_worship',
                category: 'amenity',
                importance: 0.98, // High priority, just below institutions
                address: fullAddress ? { common: fullAddress } : {},
                image_url: row.image_url || null,
                worker_details: row.worker_details || null,
                boundingbox: row.lat !== null ? [row.lat, row.lat, row.lon, row.lon].map(String) : null
            };
        }).filter(r => r.lat !== null && r.lon !== null);

        // Transform direct OSM place results (India-wide coverage)
        const placeImportance = {
            city: 0.97, town: 0.93, suburb: 0.88, village: 0.85,
            hamlet: 0.80, locality: 0.78,
        };
        const seenOsmIds = new Set();
        const osmPlaceResults = osmPlaceData
            .filter(row => {
                // Deduplicate — same place can appear in both point and polygon tables
                const key = `${row.osm_id}`;
                if (seenOsmIds.has(key)) return false;
                seenOsmIds.add(key);
                return true;
            })
            .map(row => {
                const location = [row.district, row.state].filter(Boolean).join(', ');
                const isExactMatch = row.name.toLowerCase() === searchQuery.toLowerCase();
                const baseImportance = placeImportance[row.place_type] || 0.70;
                return {
                    osm_id: row.osm_id,
                    osm_type: 'node',
                    display_name: `${row.name}${location ? ', ' + location : ''}, India`,
                    lat: parseFloat(row.lat),
                    lon: parseFloat(row.lon),
                    type: row.place_type,
                    category: 'place',
                    importance: isExactMatch ? Math.min(baseImportance + 0.02, 0.99) : baseImportance,
                    address: location ? { common: location } : {},
                    boundingbox: [row.lat, row.lat, row.lon, row.lon].map(String),
                };
            });

        // Transform Nominatim elements ensuring consistent types
        const nomResults = nomData.map(item => ({
            osm_id: item.osm_id,
            osm_type: item.osm_type,
            display_name: item.display_name,
            lat: parseFloat(item.lat),
            lon: parseFloat(item.lon),
            type: item.type,
            category: item.category,
            importance: item.importance || 0.5,
            address: item.address,
            boundingbox: item.boundingbox?.map(Number),
        }));

        // Merge all sources and sort by importance
        const combined = [...osmPlaceResults, ...pgResults, ...mandirResults, ...nomResults];
        combined.sort((a, b) => b.importance - a.importance);

        const finalResults = combined.slice(0, maxResults);

        res.json({
            query: searchQuery,
            count: finalResults.length,
            results: finalResults,
        });
    } catch (err) {
        next(err);
    }
});

module.exports = router;
