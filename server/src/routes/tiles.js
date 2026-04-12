/**
 * GeoSphere WB+ — Tile Proxy Route
 * 
 * GET /api/tiles/wms?...params...
 * GET /api/tiles/capabilities
 * 
 * Proxies WMS/WMTS requests to the local GeoServer instance.
 * Eliminates CORS issues and centralizes access.
 */

const express = require('express');
const router  = express.Router();

const GEOSERVER_URL = process.env.GEOSERVER_URL || 'http://localhost:8080/geoserver';
const WORKSPACE     = process.env.GEOSERVER_WORKSPACE || 'geosphere_wb';

/**
 * GET /api/tiles/wms — Proxy WMS requests to GeoServer
 * Pass through all query parameters.
 */
router.get('/wms', async (req, res, next) => {
    try {
        const params = new URLSearchParams(req.query).toString();
        const url = `${GEOSERVER_URL}/${WORKSPACE}/wms?${params}`;

        const response = await fetch(url);

        if (!response.ok) {
            return res.status(response.status).json({ error: 'GeoServer WMS request failed.' });
        }

        // Forward content type (image/png, text/xml, etc.)
        const contentType = response.headers.get('content-type');
        res.set('Content-Type', contentType);

        // Stream the response body
        const buffer = await response.arrayBuffer();
        res.send(Buffer.from(buffer));
    } catch (err) {
        next(err);
    }
});

/**
 * GET /api/tiles/wfs — Proxy WFS requests for vector data
 */
router.get('/wfs', async (req, res, next) => {
    try {
        const params = new URLSearchParams(req.query).toString();
        const url = `${GEOSERVER_URL}/${WORKSPACE}/wfs?${params}`;

        const response = await fetch(url);

        if (!response.ok) {
            return res.status(response.status).json({ error: 'GeoServer WFS request failed.' });
        }

        const contentType = response.headers.get('content-type');
        res.set('Content-Type', contentType);

        const buffer = await response.arrayBuffer();
        res.send(Buffer.from(buffer));
    } catch (err) {
        next(err);
    }
});

/**
 * GET /api/tiles/capabilities — Get WMS capabilities
 */
router.get('/capabilities', async (req, res, next) => {
    try {
        const url = `${GEOSERVER_URL}/${WORKSPACE}/wms?service=WMS&version=1.1.1&request=GetCapabilities`;

        const response = await fetch(url);

        if (!response.ok) {
            return res.status(response.status).json({ error: 'Failed to fetch WMS capabilities.' });
        }

        res.set('Content-Type', 'text/xml');
        const text = await response.text();
        res.send(text);
    } catch (err) {
        next(err);
    }
});

/**
 * GET /api/tiles/info — Service info endpoint
 */
router.get('/info', (req, res) => {
    res.json({
        geoserver_url: GEOSERVER_URL,
        workspace: WORKSPACE,
        wms_endpoint: `${GEOSERVER_URL}/${WORKSPACE}/wms`,
        wfs_endpoint: `${GEOSERVER_URL}/${WORKSPACE}/wfs`,
        layers: [
            'planet_osm_point',
            'planet_osm_line',
            'planet_osm_polygon',
            'planet_osm_roads',
        ],
    });
});

module.exports = router;
