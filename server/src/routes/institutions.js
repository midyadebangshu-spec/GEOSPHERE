/**
 * GeoSphere WB+ — Educational Institutions Route
 *
 * Endpoints:
 *   GET /api/institutions
 *   GET /api/institutions/:id
 *
 * Query params:
 *   type=school|college|university
 *   district=<district>
 *   management=govt|private  (read from metadata)
 *   q=<name query>
 *   near=<lat,lon>
 *   radius=<meters>
 *   limit=<n>
 *   offset=<n>
 */

const express = require('express');
const router = express.Router();
const { query } = require('../db');
const { validateCoords, validateBbox, validatePositiveNum, sanitizeLike } = require('../middleware/validate');

const VALID_TYPES = new Set(['school', 'college', 'university']);
const VALID_MANAGEMENT = new Set(['govt', 'government', 'private']);

router.get('/', async (req, res, next) => {
    try {
        const {
            type,
            district,
            management,
            q,
            near,
            minLat,
            minLon,
            maxLat,
            maxLon,
            radius = 2000,
            limit = 100,
            offset = 0,
        } = req.query;

        const maxResults = Math.min(validatePositiveNum(limit, 100, 500), 500);
        const safeOffset = Math.max(parseInt(offset, 10) || 0, 0);

        const where = ['1=1'];
        const params = [];
        let idx = 1;

        let useDistanceSort = false;
        let lat = null;
        let lon = null;
        let radiusM = null;

        if (type && VALID_TYPES.has(String(type).toLowerCase())) {
            where.push(`type = $${idx++}`);
            params.push(String(type).toLowerCase());
        }

        if (district) {
            where.push(`district ILIKE $${idx++}`);
            params.push(`%${sanitizeLike(String(district).trim())}%`);
        }

        if (minLat !== undefined || minLon !== undefined || maxLat !== undefined || maxLon !== undefined) {
            const bbox = validateBbox(minLat, minLon, maxLat, maxLon);
            if (!bbox) {
                return res.status(400).json({
                    error: 'Invalid bbox. Required: minLat,minLon,maxLat,maxLon',
                });
            }

            where.push(`geom && ST_MakeEnvelope($${idx++}, $${idx++}, $${idx++}, $${idx++}, 4326)`);
            params.push(bbox.minLon, bbox.minLat, bbox.maxLon, bbox.maxLat);
        }

        if (management && VALID_MANAGEMENT.has(String(management).toLowerCase())) {
            const normalizedManagement = String(management).toLowerCase() === 'government' ? 'govt' : String(management).toLowerCase();
            where.push(`COALESCE(metadata->>'management', '') ILIKE $${idx++}`);
            params.push(normalizedManagement);
        }

        if (q && String(q).trim().length > 0) {
            const pattern = `%${sanitizeLike(String(q).trim())}%`;
            where.push(`name ILIKE $${idx++} ESCAPE '\\\\'`);
            params.push(pattern);
        }

        if (near) {
            const [nearLat, nearLon] = String(near).split(',').map(v => parseFloat(v.trim()));
            if (!validateCoords(nearLat, nearLon)) {
                return res.status(400).json({ error: 'Invalid near format. Use near=lat,lon' });
            }

            lat = nearLat;
            lon = nearLon;
            radiusM = validatePositiveNum(radius, 2000, 50000);
            useDistanceSort = true;

            where.push(`geom IS NOT NULL`);
            where.push(`ST_DWithin(geom::geography, ST_SetSRID(ST_MakePoint($${idx++}, $${idx++}), 4326)::geography, $${idx++})`);
            params.push(lon, lat, radiusM);
        }

        const distanceSelect = useDistanceSort
            ? `,
               ST_Distance(
                    geom::geography,
                    ST_SetSRID(ST_MakePoint($${idx - 3}, $${idx - 2}), 4326)::geography
               ) AS distance_m`
            : ', NULL::double precision AS distance_m';

        const orderBy = useDistanceSort
            ? 'ORDER BY distance_m ASC, name ASC'
            : 'ORDER BY name ASC';

        const sql = `
            SELECT
                id,
                name,
                type,
                subtype,
                lat,
                lon,
                address,
                district,
                source,
                source_id,
                udise_code,
                aishe_id,
                metadata,
                created_at,
                updated_at
                ${distanceSelect}
            FROM institutions
            WHERE ${where.join(' AND ')}
            ${orderBy}
            LIMIT $${idx++}
            OFFSET $${idx++}
        `;

        params.push(maxResults, safeOffset);

        const result = await query(sql, params);

        const rows = result.rows.map(row => ({
            ...row,
            lat: row.lat !== null ? parseFloat(row.lat) : null,
            lon: row.lon !== null ? parseFloat(row.lon) : null,
            distance_m: row.distance_m !== null ? Math.round(row.distance_m) : null,
        }));

        res.json({
            count: rows.length,
            filters: {
                type: type || null,
                district: district || null,
                management: management || null,
                q: q || null,
                near: near || null,
                bbox: (minLat !== undefined || minLon !== undefined || maxLat !== undefined || maxLon !== undefined)
                    ? { minLat, minLon, maxLat, maxLon }
                    : null,
                radius: radiusM,
                limit: maxResults,
                offset: safeOffset,
            },
            results: rows,
        });
    } catch (err) {
        next(err);
    }
});

router.get('/:id', async (req, res, next) => {
    try {
        const { id } = req.params;

        const sql = `
            SELECT
                id,
                name,
                type,
                subtype,
                lat,
                lon,
                address,
                district,
                source,
                source_id,
                udise_code,
                aishe_id,
                metadata,
                created_at,
                updated_at
            FROM institutions
            WHERE id = $1
            LIMIT 1
        `;

        const result = await query(sql, [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Institution not found.' });
        }

        const row = result.rows[0];
        res.json({
            ...row,
            lat: row.lat !== null ? parseFloat(row.lat) : null,
            lon: row.lon !== null ? parseFloat(row.lon) : null,
        });
    } catch (err) {
        next(err);
    }
});

module.exports = router;
