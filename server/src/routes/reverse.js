/**
 * GeoSphere WB+ — Reverse Geocoding Route
 * 
 * GET /api/reverse?lat=22.5726&lon=88.3639
 * 
 * Proxies reverse geocoding requests to the local Nominatim instance.
 */

const express = require('express');
const router  = express.Router();
const { validateCoords } = require('../middleware/validate');

const NOMINATIM_URL = process.env.NOMINATIM_URL || 'http://localhost:8088';

router.get('/', async (req, res, next) => {
    try {
        const { lat, lon, zoom = 18 } = req.query;

        if (!validateCoords(lat, lon)) {
            return res.status(400).json({ error: 'Invalid or missing lat/lon parameters.' });
        }

        const url = `${NOMINATIM_URL}/reverse?lat=${lat}&lon=${lon}&zoom=${zoom}&format=jsonv2&addressdetails=1`;

        const response = await fetch(url, {
            headers: { 'User-Agent': 'GeoSphereWB/1.0' },
        });

        if (!response.ok) {
            return res.status(response.status).json({ error: 'Nominatim reverse geocoding failed.' });
        }

        const data = await response.json();

        res.json({
            lat: parseFloat(data.lat),
            lon: parseFloat(data.lon),
            display_name: data.display_name,
            address: data.address,
            osm_type: data.osm_type,
            osm_id: data.osm_id,
            type: data.type,
            category: data.category,
        });
    } catch (err) {
        next(err);
    }
});

module.exports = router;
