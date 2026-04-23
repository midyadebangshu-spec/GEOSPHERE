/**
 * GeoSphere WB+ — Express API Entry Point
 * 
 * Central application server providing:
 *   • Spatial query APIs (nearby, bbox, analytics)
 *   • Routing proxy (OSRM)
 *   • Geocoding proxy (Nominatim)
 *   • Tile proxy (GeoServer WMS/WMTS)
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const rateLimit = require('express-rate-limit');

const { testConnection } = require('./db');
const { initializeRadar } = require('./radar');

// Route modules
const nearbyRoutes = require('./routes/nearby');
const bboxRoutes = require('./routes/bbox');
const reverseRoutes = require('./routes/reverse');
const routeRoutes = require('./routes/route');
const searchRoutes = require('./routes/search');
const tilesRoutes = require('./routes/tiles');
const analyticsRoutes = require('./routes/analytics');
const institutionsRoutes = require('./routes/institutions');
const aqiRoutes = require('./routes/aqi');
const datasetsRoutes = require('./routes/datasets');
const commonsRoutes = require('./routes/commons');

const app = express();
const PORT = process.env.PORT || 4000;

app.set('trust proxy', 1);

// ─── Middleware ─────────────────────────────────────────────────────────────

// Security headers
app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: false,  // Relaxed for map tile loading
}));

// CORS — allow frontend
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Compression
app.use(compression());

// Request logging
app.use(morgan(':method :url :status :response-time ms'));

// Body parsing
app.use(express.json({ limit: '1mb' }));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,   // 15 minutes
    max: parseInt(process.env.RATE_LIMIT_MAX) || 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests. Please try again later.' },
});
app.use('/api/', limiter);

// ─── Static Files (Frontend) ───────────────────────────────────────────────
app.use(express.static(path.join(__dirname, '../../frontend')));

// ─── API Routes ─────────────────────────────────────────────────────────────
app.use('/api/nearby', nearbyRoutes);
app.use('/api/bbox', bboxRoutes);
app.use('/api/reverse', reverseRoutes);
app.use('/api/route', routeRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/tiles', tilesRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/institutions', institutionsRoutes);
app.use('/api/aqi', aqiRoutes);
app.use('/api/datasets', datasetsRoutes);
app.use('/api/commons', commonsRoutes);

// ─── Health Check ───────────────────────────────────────────────────────────
app.get('/api/health', async (req, res) => {
    const db = await testConnection();
    res.json({
        status: db ? 'healthy' : 'degraded',
        service: 'GeoSphere WB+ API',
        version: '1.0.0',
        uptime: process.uptime(),
        database: db ? 'connected' : 'disconnected',
        timestamp: new Date().toISOString(),
    });
});

// ─── Fallback: Serve frontend for non-API routes (SPA) ─────────────────────
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../../frontend/index.html'));
});

// ─── Error Handler ──────────────────────────────────────────────────────────
app.use((err, req, res, _next) => {
    console.error('[API Error]', err.stack || err.message);
    res.status(err.status || 500).json({
        error: process.env.NODE_ENV === 'production'
            ? 'Internal server error'
            : err.message,
    });
});

// ─── Start Server ───────────────────────────────────────────────────────────
async function start() {
    // Test DB connection
    await testConnection();

    const server = app.listen(PORT, () => {
        console.log('');
        console.log('╔═══════════════════════════════════════════════════╗');
        console.log('║       GeoSphere WB+ API Server                   ║');
        console.log('╠═══════════════════════════════════════════════════╣');
        console.log(`║  🌐 API:       http://localhost:${PORT}/api        ║`);
        console.log(`║  🗺️  Frontend:  http://localhost:${PORT}            ║`);
        console.log(`║  ❤️  Health:    http://localhost:${PORT}/api/health  ║`);
        console.log('╚═══════════════════════════════════════════════════╝');
        console.log('');
    });

    // Attach real-time radar websocket engine
    initializeRadar(server);
}

start().catch(err => {
    console.error('[FATAL] Failed to start server:', err);
    process.exit(1);
});

module.exports = app;
