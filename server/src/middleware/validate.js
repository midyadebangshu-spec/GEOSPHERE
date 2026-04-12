/**
 * GeoSphere WB+ — Input Validation Helpers
 * 
 * Utility functions for validating coordinates, bounding boxes,
 * and numeric parameters across all route handlers.
 */

/**
 * Validate latitude and longitude values.
 * @param {string|number} lat
 * @param {string|number} lon
 * @returns {boolean} True if both are valid coordinate values
 */
function validateCoords(lat, lon) {
    const la = parseFloat(lat);
    const lo = parseFloat(lon);
    return (
        !isNaN(la) && !isNaN(lo) &&
        la >= -90 && la <= 90 &&
        lo >= -180 && lo <= 180
    );
}

/**
 * Validate a bounding box.
 * @param {string|number} minLat
 * @param {string|number} minLon
 * @param {string|number} maxLat
 * @param {string|number} maxLon
 * @returns {Object|null} Parsed bbox {minLat, minLon, maxLat, maxLon} or null if invalid
 */
function validateBbox(minLat, minLon, maxLat, maxLon) {
    const bbox = {
        minLat: parseFloat(minLat),
        minLon: parseFloat(minLon),
        maxLat: parseFloat(maxLat),
        maxLon: parseFloat(maxLon),
    };

    if (
        isNaN(bbox.minLat) || isNaN(bbox.minLon) ||
        isNaN(bbox.maxLat) || isNaN(bbox.maxLon)
    ) {
        return null;
    }

    if (
        bbox.minLat < -90 || bbox.maxLat > 90 ||
        bbox.minLon < -180 || bbox.maxLon > 180 ||
        bbox.minLat >= bbox.maxLat ||
        bbox.minLon >= bbox.maxLon
    ) {
        return null;
    }

    return bbox;
}

/**
 * Parse and clamp a positive number from a query string value.
 * @param {string|number} val — Input value
 * @param {number} defaultVal — Default if parsing fails
 * @param {number} max — Maximum allowed value (default: 50000)
 * @returns {number}
 */
function validatePositiveNum(val, defaultVal, max = 50000) {
    const num = parseFloat(val);
    if (isNaN(num) || num <= 0) return defaultVal;
    return Math.min(num, max);
}

/**
 * Sanitize a string for safe use in SQL ILIKE patterns.
 * Escapes special characters: %, _, \
 * @param {string} str
 * @returns {string}
 */
function sanitizeLike(str) {
    if (typeof str !== 'string') return '';
    return str.replace(/[%_\\]/g, '\\$&');
}

module.exports = {
    validateCoords,
    validateBbox,
    validatePositiveNum,
    sanitizeLike,
};
