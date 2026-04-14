/**
 * GeoSphere WB+ — Forward Geocoding / Search Route
 * 
 * GET /api/search?q=Victoria+Memorial&limit=10
 * 
 * Proxies search queries to the local Nominatim instance AND the federated PostGIS database.
 * Results from custom database sources (WBBSE/UDISE/AISHE) are boosted via importance injection.
 * Results bounded to West Bengal explicitly.
 */

const express = require('express');
const router = express.Router();
const { query: dbQuery } = require('../db');

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
        const searchQuery = q.trim();

        // 1. Nominatim Promise (API request)
        const nomUrl = `${NOMINATIM_URL}/search?` + new URLSearchParams({
            q: searchQuery,
            format: 'jsonv2',
            addressdetails: '1',
            limit: maxResults.toString(),
            viewbox: WB_VIEWBOX,
            bounded: bounded.toString(),
            countrycodes: 'in',
        }).toString();

        const nominatimPromise = fetch(nomUrl, {
            headers: { 'User-Agent': 'GeoSphereWB/1.0' },
        }).then(r => r.ok ? r.json() : []).catch(err => {
            console.error('Nominatim Search Error:', err.message);
            return [];
        });

        // 2. PostGIS Promise (Database query for freshly merged DB sets)
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

        // Execute queries in parallel utilizing full federated logic
        const [nomData, pgData] = await Promise.all([nominatimPromise, postgisPromise]);

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

        // Merge arrays and utilize algorithmic boosting prioritization based on our specific source logic
        const combined = [...pgResults, ...nomResults];
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
