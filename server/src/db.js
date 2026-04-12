/**
 * GeoSphere WB+ — PostgreSQL Connection Pool
 * 
 * Manages a shared connection pool to the PostGIS-enabled osm_wb database.
 * All route handlers import `query` from this module.
 */

const { Pool } = require('pg');

const poolConfig = {
    host:     process.env.DB_HOST     || 'localhost',
    port:     process.env.DB_PORT     || 5432,
    database: process.env.DB_NAME     || 'osm_wb',
    user:     process.env.DB_USER     || 'postgres',
    max:      20,              // Max concurrent connections
    idleTimeoutMillis: 30000,  // Close idle clients after 30s
    connectionTimeoutMillis: 5000,
};

if (process.env.DB_PASSWORD) {
    poolConfig.password = process.env.DB_PASSWORD;
}

const pool = new Pool(poolConfig);

// Log pool errors
pool.on('error', (err) => {
    console.error('[DB] Unexpected pool error:', err.message);
});

/**
 * Execute a parameterized SQL query.
 * @param {string} text — SQL query with $1, $2, ... placeholders
 * @param {Array}  params — Parameter values
 * @returns {Promise<import('pg').QueryResult>}
 */
const query = (text, params) => pool.query(text, params);

/**
 * Test database connectivity.
 * @returns {Promise<boolean>}
 */
const testConnection = async () => {
    try {
        const res = await pool.query('SELECT PostGIS_Version() AS version');
        console.log(`[DB] Connected — PostGIS ${res.rows[0].version}`);
        return true;
    } catch (err) {
        console.error('[DB] Connection failed:', err.message);
        return false;
    }
};

module.exports = { query, pool, testConnection };
