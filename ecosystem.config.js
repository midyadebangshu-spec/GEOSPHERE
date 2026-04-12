/**
 * GeoSphere WB+ — PM2 Ecosystem Configuration
 * 
 * Manages the Express API server process.
 * Usage:
 *   pm2 start ecosystem.config.js
 *   pm2 status
 *   pm2 logs geosphere-api
 */

module.exports = {
    apps: [
        {
            name: 'geosphere-api',
            script: './server/src/index.js',
            cwd: __dirname,
            instances: 1,
            autorestart: true,
            watch: false,
            max_memory_restart: '512M',
            env: {
                NODE_ENV: 'production',
                PORT: 4000,
            },
            env_development: {
                NODE_ENV: 'development',
                PORT: 4000,
            },
            error_file: './logs/api-error.log',
            out_file: './logs/api-out.log',
            log_date_format: 'YYYY-MM-DD HH:mm:ss',
            merge_logs: true,
        },
    ],
};
