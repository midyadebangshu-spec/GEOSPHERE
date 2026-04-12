/**
 * GeoSphere WB+ — Analytics Routes
 * 
 * GET /api/analytics/count?type=hospital&bbox=88.2,22.4,88.5,22.7
 *   → Count features of a type within a bounding box
 * 
 * GET /api/analytics/density?type=restaurant&bbox=88.2,22.4,88.5,22.7&gridSize=0.01
 *   → Grid-based density data for heatmap visualization
 * 
 * GET /api/analytics/summary?bbox=88.2,22.4,88.5,22.7
 *   → Aggregate counts by category within a bounding box
 */

const express = require('express');
const router  = express.Router();
const { query } = require('../db');
const { validateBbox } = require('../middleware/validate');

/**
 * GET /api/analytics/count — Count features by type in a bounding box
 */
router.get('/count', async (req, res, next) => {
    try {
        const { type, bbox: bboxStr } = req.query;

        if (!type) {
            return res.status(400).json({ error: 'Missing "type" parameter.' });
        }
        if (!bboxStr) {
            return res.status(400).json({ error: 'Missing "bbox" parameter (format: minLon,minLat,maxLon,maxLat).' });
        }

        const [minLon, minLat, maxLon, maxLat] = bboxStr.split(',').map(Number);
        const bbox = validateBbox(minLat, minLon, maxLat, maxLon);
        if (!bbox) {
            return res.status(400).json({ error: 'Invalid bbox coordinates.' });
        }

        const sql = `
            SELECT COUNT(*) AS count
            FROM planet_osm_point
            WHERE
                (tags->'amenity' ILIKE $5
                 OR tags->'shop' ILIKE $5
                 OR tags->'tourism' ILIKE $5
                 OR tags->'leisure' ILIKE $5)
                AND way && ST_Transform(
                    ST_MakeEnvelope($1, $2, $3, $4, 4326),
                    3857
                )
        `;

        const result = await query(sql, [bbox.minLon, bbox.minLat, bbox.maxLon, bbox.maxLat, `%${type}%`]);

        res.json({
            type,
            bbox: [bbox.minLon, bbox.minLat, bbox.maxLon, bbox.maxLat],
            count: parseInt(result.rows[0].count),
        });
    } catch (err) {
        next(err);
    }
});

/**
 * GET /api/analytics/density — Grid-based density for heatmaps
 */
router.get('/density', async (req, res, next) => {
    try {
        const { type, bbox: bboxStr, gridSize = '0.01' } = req.query;

        if (!bboxStr) {
            return res.status(400).json({ error: 'Missing "bbox" parameter.' });
        }

        const [minLon, minLat, maxLon, maxLat] = bboxStr.split(',').map(Number);
        const bbox = validateBbox(minLat, minLon, maxLat, maxLon);
        if (!bbox) {
            return res.status(400).json({ error: 'Invalid bbox coordinates.' });
        }

        const grid = parseFloat(gridSize) || 0.01;

        let typeFilter = '';
        const params = [bbox.minLon, bbox.minLat, bbox.maxLon, bbox.maxLat, grid];

        if (type) {
            typeFilter = `
                AND (tags->'amenity' ILIKE $6
                     OR tags->'shop' ILIKE $6
                     OR tags->'tourism' ILIKE $6)
            `;
            params.push(`%${type}%`);
        }

        const sql = `
            SELECT
                ROUND(ST_X(ST_Transform(way, 4326))::numeric / $5) * $5 AS grid_lon,
                ROUND(ST_Y(ST_Transform(way, 4326))::numeric / $5) * $5 AS grid_lat,
                COUNT(*) AS intensity
            FROM planet_osm_point
            WHERE
                way && ST_Transform(
                    ST_MakeEnvelope($1, $2, $3, $4, 4326),
                    3857
                )
                ${typeFilter}
            GROUP BY grid_lon, grid_lat
            HAVING COUNT(*) > 0
            ORDER BY intensity DESC
            LIMIT 5000
        `;

        const result = await query(sql, params);

        const points = result.rows.map(row => ({
            lat: parseFloat(row.grid_lat),
            lon: parseFloat(row.grid_lon),
            intensity: parseInt(row.intensity),
        }));

        res.json({
            type: type || 'all',
            bbox: [bbox.minLon, bbox.minLat, bbox.maxLon, bbox.maxLat],
            gridSize: grid,
            count: points.length,
            points,
        });
    } catch (err) {
        next(err);
    }
});

/**
 * GET /api/analytics/summary — Aggregate counts by category
 */
router.get('/summary', async (req, res, next) => {
    try {
        const { bbox: bboxStr } = req.query;

        if (!bboxStr) {
            return res.status(400).json({ error: 'Missing "bbox" parameter.' });
        }

        const [minLon, minLat, maxLon, maxLat] = bboxStr.split(',').map(Number);
        const bbox = validateBbox(minLat, minLon, maxLat, maxLon);
        if (!bbox) {
            return res.status(400).json({ error: 'Invalid bbox coordinates.' });
        }

        const sql = `
            SELECT
                COALESCE(tags->'amenity', tags->'shop', tags->'tourism', tags->'leisure', 'other') AS category,
                COUNT(*) AS count
            FROM planet_osm_point
            WHERE
                name IS NOT NULL
                AND way && ST_Transform(
                    ST_MakeEnvelope($1, $2, $3, $4, 4326),
                    3857
                )
            GROUP BY category
            ORDER BY count DESC
            LIMIT 50
        `;

        const result = await query(sql, [bbox.minLon, bbox.minLat, bbox.maxLon, bbox.maxLat]);

        const categories = result.rows.map(row => ({
            category: row.category,
            count: parseInt(row.count),
        }));

        const total = categories.reduce((sum, c) => sum + c.count, 0);

        res.json({
            bbox: [bbox.minLon, bbox.minLat, bbox.maxLon, bbox.maxLat],
            total,
            categories,
        });
    } catch (err) {
        next(err);
    }
});

module.exports = router;
