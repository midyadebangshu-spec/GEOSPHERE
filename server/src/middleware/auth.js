/**
 * GeoSphere WB+ — JWT Authentication Middleware
 * 
 * Provides optional route-level protection for private API endpoints.
 * Public endpoints can skip this middleware.
 * 
 * Usage:
 *   const { requireAuth } = require('../middleware/auth');
 *   router.get('/private', requireAuth, handler);
 */

const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'geosphere-dev-secret';

/**
 * Middleware: Require a valid JWT in the Authorization header.
 * Format: Authorization: Bearer <token>
 */
function requireAuth(req, res, next) {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Missing or invalid Authorization header.' });
    }

    const token = authHeader.substring(7);

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;   // Attach user payload to request
        next();
    } catch (err) {
        if (err.name === 'TokenExpiredError') {
            return res.status(401).json({ error: 'Token expired.' });
        }
        return res.status(403).json({ error: 'Invalid token.' });
    }
}

/**
 * Generate a JWT token for a user payload.
 * @param {Object} payload — User data to encode
 * @param {string} expiresIn — Token lifetime (default: '24h')
 * @returns {string} Signed JWT
 */
function generateToken(payload, expiresIn = '24h') {
    return jwt.sign(payload, JWT_SECRET, { expiresIn });
}

module.exports = { requireAuth, generateToken };
