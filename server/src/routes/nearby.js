/**
 * GeoSphere WB+ — Nearby Search Route
 * 
 * GET /api/nearby?lat=22.57&lon=88.36&type=hospital&radius=2000
 * 
 * Finds POIs within a given radius using PostGIS ST_DWithin.
 * Supports filtering by OSM amenity/shop/tourism tags via hstore.
 */

const express = require('express');
const router  = express.Router();
const { query } = require('../db');
const { validateCoords, validatePositiveNum } = require('../middleware/validate');

router.get('/', async (req, res, next) => {
    try {
        const { lat, lon, type, radius = 1000, limit = 50 } = req.query;

        // Validate required parameters
        if (!validateCoords(lat, lon)) {
            return res.status(400).json({ error: 'Invalid or missing lat/lon parameters.' });
        }

        const radiusM = validatePositiveNum(radius, 1000);
        const maxResults = Math.min(parseInt(limit) || 50, 200);

        // Build the WHERE clause for type filtering
        let typeFilter = '';
        const params = [parseFloat(lon), parseFloat(lat), radiusM, maxResults];

        if (type) {
            // Search across multiple OSM tag categories
            typeFilter = `
                AND (
                    tags->'amenity'  ILIKE $5
                    OR tags->'shop'    ILIKE $5
                    OR tags->'tourism' ILIKE $5
                    OR tags->'leisure' ILIKE $5
                    OR tags->'building' ILIKE $5
                    OR name ILIKE $5
                )
            `;
            params.push(`%${type}%`);
        }

        const sql = `
            SELECT
                osm_id,
                name,
                tags->'amenity'  AS amenity,
                tags->'shop'     AS shop,
                tags->'tourism'  AS tourism,
                tags->'leisure'  AS leisure,
                tags->'phone'    AS phone,
                tags->'website'  AS website,
                tags->'opening_hours' AS opening_hours,
                tags->'addr:street'   AS street,
                tags->'addr:city'     AS city,
                ST_Y(ST_Transform(way, 4326)) AS lat,
                ST_X(ST_Transform(way, 4326)) AS lon,
                ST_Distance(
                    way,
                    ST_Transform(ST_SetSRID(ST_MakePoint($1, $2), 4326), 3857)
                ) AS distance_m
            FROM planet_osm_point
            WHERE
                name IS NOT NULL
                AND ST_DWithin(
                    way,
                    ST_Transform(ST_SetSRID(ST_MakePoint($1, $2), 4326), 3857),
                    $3
                )
                ${typeFilter}
            ORDER BY distance_m ASC
            LIMIT $4
        `;

        const result = await query(sql, params);

        // Return as GeoJSON FeatureCollection
        const geojson = {
            type: 'FeatureCollection',
            count: result.rows.length,
            query: { lat: parseFloat(lat), lon: parseFloat(lon), type, radius: radiusM },
            features: result.rows.map(row => ({
                type: 'Feature',
                properties: {
                    osm_id: row.osm_id,
                    name: row.name,
                    amenity: row.amenity,
                    shop: row.shop,
                    tourism: row.tourism,
                    leisure: row.leisure,
                    phone: row.phone,
                    website: row.website,
                    opening_hours: row.opening_hours,
                    street: row.street,
                    city: row.city,
                    distance_m: Math.round(row.distance_m),
                },
                geometry: {
                    type: 'Point',
                    coordinates: [parseFloat(row.lon), parseFloat(row.lat)],
                },
            })),
        };

        res.json(geojson);
    } catch (err) {
        next(err);
    }
});

module.exports = router;
