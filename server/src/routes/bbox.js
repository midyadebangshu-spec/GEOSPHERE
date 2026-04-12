/**
 * GeoSphere WB+ — Bounding Box Query Route
 * 
 * GET /api/bbox?minLat=22.5&minLon=88.2&maxLat=22.7&maxLon=88.5&type=hospital
 * 
 * Returns all named features within a bounding box using PostGIS && operator
 * with ST_MakeEnvelope for fast spatial lookups.
 */

const express = require('express');
const router  = express.Router();
const { query } = require('../db');
const { validateBbox } = require('../middleware/validate');

router.get('/', async (req, res, next) => {
    try {
        const { minLat, minLon, maxLat, maxLon, type, table = 'point', limit = 200 } = req.query;

        // Validate bounding box
        const bbox = validateBbox(minLat, minLon, maxLat, maxLon);
        if (!bbox) {
            return res.status(400).json({
                error: 'Invalid bounding box. Required: minLat, minLon, maxLat, maxLon (valid coordinates).',
            });
        }

        // Determine which osm table to query
        const validTables = {
            point: 'planet_osm_point',
            line: 'planet_osm_line',
            polygon: 'planet_osm_polygon',
            roads: 'planet_osm_roads',
        };
        const tableName = validTables[table] || 'planet_osm_point';

        const maxResults = Math.min(parseInt(limit) || 200, 1000);

        // Type filter
        let typeFilter = '';
        const params = [bbox.minLon, bbox.minLat, bbox.maxLon, bbox.maxLat, maxResults];

        if (type) {
            typeFilter = `
                AND (
                    tags->'amenity'  ILIKE $6
                    OR tags->'shop'    ILIKE $6
                    OR tags->'tourism' ILIKE $6
                    OR tags->'leisure' ILIKE $6
                    OR tags->'highway' ILIKE $6
                    OR name ILIKE $6
                )
            `;
            params.push(`%${type}%`);
        }

        // Geometry output depends on table type
        const geomSelect = tableName === 'planet_osm_point'
            ? `ST_Y(ST_Transform(way, 4326)) AS lat,
               ST_X(ST_Transform(way, 4326)) AS lon`
            : `ST_AsGeoJSON(ST_Transform(way, 4326))::json AS geometry`;

        const sql = `
            SELECT
                osm_id,
                name,
                tags->'amenity' AS amenity,
                tags->'shop'    AS shop,
                tags->'tourism' AS tourism,
                tags->'highway' AS highway,
                ${geomSelect}
            FROM ${tableName}
            WHERE
                name IS NOT NULL
                AND way && ST_Transform(
                    ST_MakeEnvelope($1, $2, $3, $4, 4326),
                    3857
                )
                ${typeFilter}
            LIMIT $5
        `;

        const result = await query(sql, params);

        const features = result.rows.map(row => ({
            type: 'Feature',
            properties: {
                osm_id: row.osm_id,
                name: row.name,
                amenity: row.amenity,
                shop: row.shop,
                tourism: row.tourism,
                highway: row.highway,
            },
            geometry: row.geometry
                ? row.geometry
                : { type: 'Point', coordinates: [parseFloat(row.lon), parseFloat(row.lat)] },
        }));

        res.json({
            type: 'FeatureCollection',
            count: features.length,
            bbox: [bbox.minLon, bbox.minLat, bbox.maxLon, bbox.maxLat],
            features,
        });
    } catch (err) {
        next(err);
    }
});

module.exports = router;
