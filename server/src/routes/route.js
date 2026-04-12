/**
 * GeoSphere WB+ — Routing Route
 * 
 * GET /api/route?startLat=22.57&startLon=88.36&endLat=22.65&endLon=88.45&profile=driving
 * 
 * Proxies routing requests to the local OSRM instance and returns
 * a structured response with GeoJSON geometry, distance, and duration.
 */

const express = require('express');
const router = express.Router();
const { validateCoords } = require('../middleware/validate');

const OSRM_URL = process.env.OSRM_URL || 'http://localhost:5000';
const OSRM_FALLBACK_URLS = ['http://localhost:5001', 'http://localhost:5000'];

router.get('/', async (req, res, next) => {
    try {
        const { startLat, startLon, endLat, endLon, profile = 'driving', alternatives = 'true', steps = 'true' } = req.query;

        // Validate start and end coordinates
        if (!validateCoords(startLat, startLon) || !validateCoords(endLat, endLon)) {
            return res.status(400).json({
                error: 'Invalid coordinates. Required: startLat, startLon, endLat, endLon.',
            });
        }

        // OSRM expects lon,lat order
        const coords = `${startLon},${startLat};${endLon},${endLat}`;

        const baseCandidates = [OSRM_URL, ...OSRM_FALLBACK_URLS.filter(base => base !== OSRM_URL)];
        let response = null;
        let lastError = null;

        for (const base of baseCandidates) {
            const url = `${base}/route/v1/${profile}/${coords}?overview=full&geometries=geojson&alternatives=${alternatives}&steps=${steps}`;
            try {
                response = await fetch(url);
                if (response.ok) {
                    break;
                }
            } catch (fetchErr) {
                lastError = fetchErr;
            }
        }

        if (!response) {
            throw lastError || new Error('OSRM request failed');
        }

        if (!response.ok) {
            return res.status(response.status).json({ error: 'OSRM routing request failed.' });
        }

        const data = await response.json();

        if (data.code !== 'Ok' || !data.routes || data.routes.length === 0) {
            return res.status(404).json({ error: 'No route found between the given points.' });
        }

        // Transform OSRM response into a cleaner format
        const routes = data.routes.map((route, idx) => ({
            index: idx,
            distance_km: (route.distance / 1000).toFixed(2),
            duration_min: (route.duration / 60).toFixed(1),
            distance_m: Math.round(route.distance),
            duration_s: Math.round(route.duration),
            geometry: route.geometry,
            legs: route.legs.map(leg => ({
                distance_km: (leg.distance / 1000).toFixed(2),
                duration_min: (leg.duration / 60).toFixed(1),
                summary: leg.summary,
                steps: leg.steps?.map(step => ({
                    instruction: step.maneuver?.type,
                    modifier: step.maneuver?.modifier,
                    name: step.name || 'Unnamed road',
                    distance_m: Math.round(step.distance),
                    duration_s: Math.round(step.duration),
                    location: step.maneuver?.location,
                })),
            })),
        }));

        res.json({
            start: { lat: parseFloat(startLat), lon: parseFloat(startLon) },
            end: { lat: parseFloat(endLat), lon: parseFloat(endLon) },
            profile,
            routes,
            waypoints: data.waypoints?.map(wp => ({
                name: wp.name,
                location: [wp.location[1], wp.location[0]],  // Convert to lat,lon
            })),
        });
    } catch (err) {
        next(err);
    }
});

module.exports = router;
