/**
 * GeoSphere WB+ — AQI Route (OpenAQ)
 *
 * GET /api/aqi?lat=22.57&lon=88.36&radius=10000
 *
 * Queries OpenAQ latest measurements near a coordinate and returns
 * a normalized AQI response for UI display.
 */

const express = require('express');
const router = express.Router();
const { validateCoords } = require('../middleware/validate');

const OPENAQ_BASE_URL = 'https://api.openaq.org/v3';

function toNumber(value) {
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
}

function normalizeParameterName(parameter) {
    if (!parameter) return '';
    if (typeof parameter === 'string') return parameter.toLowerCase();
    if (typeof parameter?.name === 'string') return parameter.name.toLowerCase();
    if (typeof parameter?.displayName === 'string') return parameter.displayName.toLowerCase();
    return '';
}

function normalizeUnit(parameter, measurement) {
    return parameter?.units || parameter?.unit || measurement?.unit || '';
}

function canonicalParameterName(parameterName) {
    const value = String(parameterName || '').toLowerCase();
    if (['pm2.5', 'pm2_5', 'pm25'].includes(value)) return 'pm25';
    if (value === 'black_carbon') return 'bc';
    return value;
}

function aqiCategory(aqi) {
    if (aqi <= 50) return 'Good';
    if (aqi <= 100) return 'Moderate';
    if (aqi <= 150) return 'Unhealthy for Sensitive Groups';
    if (aqi <= 200) return 'Unhealthy';
    if (aqi <= 300) return 'Very Unhealthy';
    return 'Hazardous';
}

function pm25ToAqi(pm25Input) {
    const pm25 = Math.floor(pm25Input * 10) / 10;
    const breakpoints = [
        { cLow: 0.0, cHigh: 9.0, iLow: 0, iHigh: 50 },
        { cLow: 9.1, cHigh: 35.4, iLow: 51, iHigh: 100 },
        { cLow: 35.5, cHigh: 55.4, iLow: 101, iHigh: 150 },
        { cLow: 55.5, cHigh: 125.4, iLow: 151, iHigh: 200 },
        { cLow: 125.5, cHigh: 225.4, iLow: 201, iHigh: 300 },
        { cLow: 225.5, cHigh: 325.4, iLow: 301, iHigh: 400 },
        { cLow: 325.5, cHigh: 500.4, iLow: 401, iHigh: 500 },
    ];

    const bp = breakpoints.find(row => pm25 >= row.cLow && pm25 <= row.cHigh);
    if (!bp) return null;

    const aqi = Math.round(((bp.iHigh - bp.iLow) / (bp.cHigh - bp.cLow)) * (pm25 - bp.cLow) + bp.iLow);
    return aqi;
}

function pm10ToAqi(pm10Input) {
    const pm10 = Math.round(pm10Input);
    const breakpoints = [
        { cLow: 0, cHigh: 54, iLow: 0, iHigh: 50 },
        { cLow: 55, cHigh: 154, iLow: 51, iHigh: 100 },
        { cLow: 155, cHigh: 254, iLow: 101, iHigh: 150 },
        { cLow: 255, cHigh: 354, iLow: 151, iHigh: 200 },
        { cLow: 355, cHigh: 424, iLow: 201, iHigh: 300 },
        { cLow: 425, cHigh: 504, iLow: 301, iHigh: 400 },
        { cLow: 505, cHigh: 604, iLow: 401, iHigh: 500 },
    ];

    const bp = breakpoints.find(row => pm10 >= row.cLow && pm10 <= row.cHigh);
    if (!bp) return null;

    const aqi = Math.round(((bp.iHigh - bp.iLow) / (bp.cHigh - bp.cLow)) * (pm10 - bp.cLow) + bp.iLow);
    return aqi;
}

async function fetchSensorTrend(sensorId, apiKey) {
    try {
        const url = `${OPENAQ_BASE_URL}/sensors/${sensorId}/hours?limit=12`;
        const response = await fetch(url, {
            headers: {
                'X-API-Key': apiKey,
            },
        });

        if (!response.ok) return [];

        const data = await response.json().catch(() => ({}));
        const results = Array.isArray(data.results) ? data.results : [];

        return results
            .map(entry => ({
                value: toNumber(entry.value),
                time: entry?.period?.datetimeFrom?.utc || null,
            }))
            .filter(entry => entry.value !== null)
            .sort((a, b) => {
                const aTime = a.time ? Date.parse(a.time) : 0;
                const bTime = b.time ? Date.parse(b.time) : 0;
                return aTime - bTime;
            })
            .map(entry => entry.value);
    } catch (_err) {
        return [];
    }
}

router.get('/', async (req, res, next) => {
    try {
        const { lat, lon, radius = '10000' } = req.query;

        if (!validateCoords(lat, lon)) {
            return res.status(400).json({ error: 'Invalid coordinates. Required: lat, lon.' });
        }

        const apiKey = process.env.OPENAQ_API_KEY;
        if (!apiKey) {
            return res.status(503).json({
                error: 'OpenAQ API key is not configured. Set OPENAQ_API_KEY in server/.env',
            });
        }

        const parsedRadius = Math.min(25000, Math.max(1, Number.parseInt(radius, 10) || 10000));

        const locationsUrl = new URL(`${OPENAQ_BASE_URL}/locations`);
        locationsUrl.searchParams.set('coordinates', `${lat},${lon}`);
        locationsUrl.searchParams.set('radius', String(parsedRadius));
        locationsUrl.searchParams.set('limit', '10');

        const locationsResponse = await fetch(locationsUrl.toString(), {
            headers: {
                'X-API-Key': apiKey,
            },
        });

        const locationsData = await locationsResponse.json().catch(() => ({}));

        if (!locationsResponse.ok) {
            return res.status(locationsResponse.status).json({
                error: locationsData?.message || locationsData?.detail || 'OpenAQ request failed.',
            });
        }

        const locations = Array.isArray(locationsData.results) ? locationsData.results : [];
        if (locations.length === 0) {
            return res.status(404).json({ error: 'No AQ stations found near this location.' });
        }

        const desiredPollutants = ['pm25', 'pm10', 'o3', 'no2'];
        let selectedLocation = null;
        let fallbackLocation = null;

        for (const location of locations) {
            const locationId = location?.id;
            if (!locationId) continue;

            const sensorById = new Map();
            const sensors = Array.isArray(location.sensors) ? location.sensors : [];
            sensors.forEach(sensor => {
                if (sensor?.id) sensorById.set(sensor.id, sensor);
            });

            const latestUrl = `${OPENAQ_BASE_URL}/locations/${locationId}/latest`;
            const latestResponse = await fetch(latestUrl, {
                headers: {
                    'X-API-Key': apiKey,
                },
            });

            if (!latestResponse.ok) continue;

            const latestData = await latestResponse.json().catch(() => ({}));
            const latestResults = Array.isArray(latestData.results) ? latestData.results : [];

            const locationMeasurements = new Map();

            latestResults.forEach((item) => {
                const sensor = sensorById.get(item.sensorsId) || {};
                const parameterName = canonicalParameterName(normalizeParameterName(sensor.parameter));
                const value = toNumber(item.value);
                if (value === null) return;

                const measurement = {
                    parameterName,
                    value,
                    unit: normalizeUnit(sensor.parameter, item),
                    datetime: item?.datetime?.utc || null,
                    locationName: location.name || 'Unknown location',
                    sensorId: item.sensorsId,
                };

                if (measurement.parameterName === 'aqi' || desiredPollutants.includes(measurement.parameterName)) {
                    if (!locationMeasurements.has(measurement.parameterName)) {
                        locationMeasurements.set(measurement.parameterName, measurement);
                    }
                }
            });

            const canComputeAqi = locationMeasurements.has('aqi')
                || locationMeasurements.has('pm25')
                || locationMeasurements.has('pm10');

            if (locationMeasurements.size > 0 && !fallbackLocation) {
                fallbackLocation = {
                    name: location.name || 'Unknown location',
                    measurements: locationMeasurements,
                };
            }

            if (canComputeAqi) {
                selectedLocation = {
                    name: location.name || 'Unknown location',
                    measurements: locationMeasurements,
                };
                break;
            }
        }

        selectedLocation = selectedLocation || fallbackLocation;

        if (!selectedLocation) {
            return res.status(404).json({ error: 'No AQI measurements found near this location.' });
        }

        const directAqi = selectedLocation.measurements.get('aqi') || null;
        const pm25 = selectedLocation.measurements.get('pm25') || null;
        const pm10 = selectedLocation.measurements.get('pm10') || null;

        let aqi = null;
        let basis = null;
        let pollutantValue = null;
        let pollutantUnit = null;
        let observationTime = null;
        let sourceLocation = null;

        if (directAqi) {
            aqi = Math.round(directAqi.value);
            basis = 'aqi';
            pollutantValue = directAqi.value;
            pollutantUnit = directAqi.unit;
            observationTime = directAqi.datetime;
            sourceLocation = directAqi.locationName;
        } else if (pm25) {
            aqi = pm25ToAqi(pm25.value);
            basis = 'pm25';
            pollutantValue = pm25.value;
            pollutantUnit = pm25.unit;
            observationTime = pm25.datetime;
            sourceLocation = pm25.locationName;
        } else if (pm10) {
            aqi = pm10ToAqi(pm10.value);
            basis = 'pm10';
            pollutantValue = pm10.value;
            pollutantUnit = pm10.unit;
            observationTime = pm10.datetime;
            sourceLocation = pm10.locationName;
        }

        if (aqi === null) {
            return res.status(404).json({
                error: 'AQI/PM2.5/PM10 data not available near this location.',
            });
        }

        const labelMap = {
            pm25: 'PM2.5',
            pm10: 'PM10',
            bc: 'BC',
            o3: 'O₃',
            no2: 'NO₂',
        };

        const pollutantEntries = await Promise.all(desiredPollutants.map(async (key) => {
            const measurement = selectedLocation.measurements.get(key);
            if (!measurement) {
                return {
                    key,
                    label: labelMap[key] || key.toUpperCase(),
                    value: null,
                    unit: null,
                    observed_at: null,
                    trend: [],
                };
            }

            const trend = measurement.sensorId
                ? await fetchSensorTrend(measurement.sensorId, apiKey)
                : [];

            return {
                key,
                label: labelMap[key] || key.toUpperCase(),
                value: measurement.value,
                unit: measurement.unit,
                observed_at: measurement.datetime,
                trend,
            };
        }));

        res.json({
            source: 'OpenAQ',
            aqi,
            category: aqiCategory(aqi),
            basis,
            pollutant: {
                value: pollutantValue,
                unit: pollutantUnit,
            },
            pollutants: pollutantEntries,
            observed_at: observationTime,
            location: sourceLocation || selectedLocation.name,
            query: {
                lat: parseFloat(lat),
                lon: parseFloat(lon),
                radius_m: parsedRadius,
            },
        });
    } catch (err) {
        next(err);
    }
});

module.exports = router;
