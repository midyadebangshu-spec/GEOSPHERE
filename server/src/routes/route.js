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
const { query: dbQuery } = require('../db');

const OSRM_URL = process.env.OSRM_URL || 'http://localhost:5000';
const NOMINATIM_URL = process.env.NOMINATIM_URL || 'http://localhost:8088';
const OSRM_FALLBACK_URLS = ['http://localhost:5001', 'http://localhost:5000'];
const WB_VIEWBOX = '85.5,27.2,89.9,21.5';
const PROFILE_CANDIDATES = {
    driving: ['driving', 'car'],
    cycling: ['cycling', 'bicycle', 'bike'],
    walking: ['walking', 'foot'],
};

function normalizeProfile(profile) {
    const safeProfile = String(profile || 'driving').toLowerCase();
    return PROFILE_CANDIDATES[safeProfile] ? safeProfile : 'driving';
}

function estimateCyclingDurationSeconds(distanceMeters) {
    const CYCLING_SPEED_KMPH = 15;
    const distanceKm = distanceMeters / 1000;
    const durationHours = distanceKm / CYCLING_SPEED_KMPH;
    return Math.round(durationHours * 3600);
}

function estimateWalkingDurationSeconds(distanceMeters) {
    const WALKING_SPEED_KMPH = 5;
    const distanceKm = distanceMeters / 1000;
    const durationHours = distanceKm / WALKING_SPEED_KMPH;
    return Math.round(durationHours * 3600);
}

function haversineDistanceMeters(lat1, lon1, lat2, lon2) {
    const toRad = (v) => (Number(v) * Math.PI) / 180;
    const R = 6371000;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return Math.round(R * c);
}

async function resolveEndPointFromQuery(queryText, startLat, startLon) {
    const trimmed = String(queryText || '').trim();
    if (!trimmed) {
        return null;
    }

    const result = await dbQuery(
        `SELECT
            id,
            name,
            address,
            lat,
            lon,
            similarity(name, $1) AS name_similarity,
            ST_DistanceSphere(
                geom,
                ST_SetSRID(ST_MakePoint($2, $3), 4326)
            ) AS distance_m
         FROM institutions
         WHERE geom IS NOT NULL
           AND lat IS NOT NULL
           AND lon IS NOT NULL
           AND (name ILIKE $4 OR address ILIKE $4)
         ORDER BY similarity(name, $1) DESC, distance_m ASC
         LIMIT 1`,
        [trimmed, Number(startLon), Number(startLat), `%${trimmed}%`]
    );

    return result.rows[0] || null;
}

async function resolveEndPointFromNominatim(queryText, startLat, startLon) {
    const trimmed = String(queryText || '').trim();
    if (!trimmed) {
        return null;
    }

    const url = `${NOMINATIM_URL}/search?` + new URLSearchParams({
        q: trimmed,
        format: 'jsonv2',
        addressdetails: '1',
        limit: '8',
        viewbox: WB_VIEWBOX,
        bounded: '1',
        countrycodes: 'in',
    }).toString();

    let data = [];
    try {
        const res = await fetch(url, {
            headers: { 'User-Agent': 'GeoSphereWB/1.0' },
        });
        if (!res.ok) {
            return null;
        }
        data = await res.json();
    } catch (_err) {
        return null;
    }

    if (!Array.isArray(data) || data.length === 0) {
        return null;
    }

    const startLatNum = Number(startLat);
    const startLonNum = Number(startLon);

    const scored = data
        .map((item) => {
            const lat = Number(item.lat);
            const lon = Number(item.lon);
            if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
                return null;
            }
            return {
                item,
                lat,
                lon,
                importance: Number(item.importance || 0),
                distance_m: haversineDistanceMeters(startLatNum, startLonNum, lat, lon),
            };
        })
        .filter(Boolean)
        .sort((a, b) => {
            if (a.distance_m !== b.distance_m) return a.distance_m - b.distance_m;
            return b.importance - a.importance;
        });

    if (scored.length === 0) {
        return null;
    }

    const best = scored[0];
    return {
        id: `${best.item.osm_type || 'osm'}:${best.item.osm_id || 'unknown'}`,
        name: best.item.display_name ? String(best.item.display_name).split(',')[0].trim() : trimmed,
        address: best.item.display_name || null,
        lat: best.lat,
        lon: best.lon,
        distance_m: best.distance_m,
        name_similarity: null,
        source: 'nominatim',
    };
}

router.get('/', async (req, res, next) => {
    try {
        const {
            startLat,
            startLon,
            endLat,
            endLon,
            endQuery,
            profile = 'driving',
            alternatives = 'true',
            steps = 'true',
        } = req.query;
        const requestedProfile = normalizeProfile(profile);

        // Validate start coordinates
        if (!validateCoords(startLat, startLon)) {
            return res.status(400).json({
                error: 'Invalid coordinates. Required: startLat and startLon.',
            });
        }

        let resolvedEndLat = endLat;
        let resolvedEndLon = endLon;
        let matchedPlace = null;

        if (!validateCoords(resolvedEndLat, resolvedEndLon)) {
            if (!endQuery || String(endQuery).trim().length === 0) {
                return res.status(400).json({
                    error: 'Invalid destination. Provide endLat/endLon or endQuery.',
                });
            }

            matchedPlace = await resolveEndPointFromQuery(endQuery, startLat, startLon);

            if (!matchedPlace) {
                matchedPlace = await resolveEndPointFromNominatim(endQuery, startLat, startLon);
            }

            if (!matchedPlace) {
                return res.status(404).json({
                    error: 'No matching destination found in database for the given query.',
                });
            }

            resolvedEndLat = matchedPlace.lat;
            resolvedEndLon = matchedPlace.lon;
        }

        // OSRM expects lon,lat order
        const coords = `${startLon},${startLat};${resolvedEndLon},${resolvedEndLat}`;

        const baseCandidates = [OSRM_URL, ...OSRM_FALLBACK_URLS.filter(base => base !== OSRM_URL)];
        const profileCandidates = [...PROFILE_CANDIDATES[requestedProfile]];
        if (requestedProfile !== 'driving') {
            profileCandidates.push(...PROFILE_CANDIDATES.driving);
        }

        let response = null;
        let lastError = null;
        let resolvedProfile = requestedProfile;

        for (const candidateProfile of profileCandidates) {
            for (const base of baseCandidates) {
                const url = `${base}/route/v1/${candidateProfile}/${coords}?overview=full&geometries=geojson&alternatives=${alternatives}&steps=${steps}`;
                try {
                    response = await fetch(url);
                    if (response.ok) {
                        resolvedProfile = candidateProfile;
                        break;
                    }
                } catch (fetchErr) {
                    lastError = fetchErr;
                }
            }

            if (response?.ok) break;
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
        const routes = data.routes.map((route, idx) => {
            const routeDistanceM = Math.round(route.distance);
            const routeDurationS = requestedProfile === 'cycling'
                ? estimateCyclingDurationSeconds(routeDistanceM)
                : requestedProfile === 'walking'
                    ? estimateWalkingDurationSeconds(routeDistanceM)
                    : Math.round(route.duration);

            return {
                index: idx,
                distance_km: (route.distance / 1000).toFixed(2),
                duration_min: (routeDurationS / 60).toFixed(1),
                distance_m: routeDistanceM,
                duration_s: routeDurationS,
                geometry: route.geometry,
                legs: route.legs.map(leg => {
                    const legDistanceM = Math.round(leg.distance);
                    const legDurationS = requestedProfile === 'cycling'
                        ? estimateCyclingDurationSeconds(legDistanceM)
                        : requestedProfile === 'walking'
                            ? estimateWalkingDurationSeconds(legDistanceM)
                            : Math.round(leg.duration);

                    return {
                        distance_km: (leg.distance / 1000).toFixed(2),
                        duration_min: (legDurationS / 60).toFixed(1),
                        summary: leg.summary,
                        steps: leg.steps?.map(step => ({
                            instruction: step.maneuver?.type,
                            modifier: step.maneuver?.modifier,
                            name: step.name || 'Unnamed road',
                            distance_m: Math.round(step.distance),
                            duration_s: requestedProfile === 'cycling'
                                ? estimateCyclingDurationSeconds(step.distance)
                                : requestedProfile === 'walking'
                                    ? estimateWalkingDurationSeconds(step.distance)
                                    : Math.round(step.duration),
                            location: step.maneuver?.location,
                        })),
                    };
                }),
            };
        });

        res.json({
            start: { lat: parseFloat(startLat), lon: parseFloat(startLon) },
            end: { lat: parseFloat(resolvedEndLat), lon: parseFloat(resolvedEndLon) },
            matched_place: matchedPlace ? {
                id: matchedPlace.id,
                name: matchedPlace.name,
                address: matchedPlace.address,
                lat: parseFloat(matchedPlace.lat),
                lon: parseFloat(matchedPlace.lon),
                distance_m: matchedPlace.distance_m !== null ? Math.round(Number(matchedPlace.distance_m)) : null,
                name_similarity: matchedPlace.name_similarity !== null ? Number(matchedPlace.name_similarity) : null,
                source: matchedPlace.source || 'institutions',
            } : null,
            profile: requestedProfile,
            resolved_profile: resolvedProfile,
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
