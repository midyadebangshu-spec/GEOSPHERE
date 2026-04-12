/**
 * GeoSphere WB+ — Forward Geocoding / Search Route
 * 
 * GET /api/search?q=Victoria+Memorial&limit=10
 * 
 * Proxies search queries to the local Nominatim instance.
 * Results are bounded to the West Bengal bounding box for relevance.
 */

const express = require('express');
const router  = express.Router();

const NOMINATIM_URL = process.env.NOMINATIM_URL || 'http://localhost:8088';

// West Bengal bounding box (approximate)
const WB_VIEWBOX = '85.5,27.2,89.9,21.5';

router.get('/', async (req, res, next) => {
    try {
        const { q, limit = 10, bounded = 1 } = req.query;

        if (!q || q.trim().length === 0) {
            return res.status(400).json({ error: 'Missing search query parameter "q".' });
        }

        const maxResults = Math.min(parseInt(limit) || 10, 50);

        const url = `${NOMINATIM_URL}/search?` + new URLSearchParams({
            q: q.trim(),
            format: 'jsonv2',
            addressdetails: '1',
            limit: maxResults.toString(),
            viewbox: WB_VIEWBOX,
            bounded: bounded.toString(),
            countrycodes: 'in',
        }).toString();

        const response = await fetch(url, {
            headers: { 'User-Agent': 'GeoSphereWB/1.0' },
        });

        if (!response.ok) {
            return res.status(response.status).json({ error: 'Nominatim search failed.' });
        }

        const data = await response.json();

        const results = data.map(item => ({
            osm_id: item.osm_id,
            osm_type: item.osm_type,
            display_name: item.display_name,
            lat: parseFloat(item.lat),
            lon: parseFloat(item.lon),
            type: item.type,
            category: item.category,
            importance: item.importance,
            address: item.address,
            boundingbox: item.boundingbox?.map(Number),
        }));

        res.json({
            query: q.trim(),
            count: results.length,
            results,
        });
    } catch (err) {
        next(err);
    }
});

module.exports = router;
