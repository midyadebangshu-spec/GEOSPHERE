const { Server } = require('socket.io');
const Redis = require('ioredis');

// Redis connections (Data & Pub/Sub need separate connections)
const redisHost = process.env.REDIS_HOST || '127.0.0.1';
const redisPort = process.env.REDIS_PORT || 6379;

const redisClient = new Redis(redisPort, redisHost);
const redisSubscriber = new Redis(redisPort, redisHost);

redisClient.on('error', err => console.error('[Radar] Redis Client Error:', err.message));
redisSubscriber.on('error', err => console.error('[Radar] Redis Subscriber Error:', err.message));

const rateLimiter = {};

function checkRateLimit(socketId, limit = 5, windowMs = 5000) {
    const now = Date.now();
    if (!rateLimiter[socketId]) {
        rateLimiter[socketId] = [];
    }
    
    rateLimiter[socketId] = rateLimiter[socketId].filter(timestamp => now - timestamp < windowMs);
    
    if (rateLimiter[socketId].length >= limit) {
        return false;
    }
    
    rateLimiter[socketId].push(now);
    return true;
}

// Fetch dynamic config from Redis hash, fallback to defaults
async function getAppConfig() {
    try {
        const config = await redisClient.hgetall('app_config');
        return {
            distance_filter_meters: parseFloat(config?.distance_filter_meters) || 5,
            search_radius_km: parseFloat(config?.search_radius_km) || 2,
            max_users_returned: parseInt(config?.max_users_returned, 10) || 50,
            refresh_interval_ms: parseInt(config?.refresh_interval_ms, 10) || 5000
        };
    } catch (err) {
        console.error('[Radar] Error fetching config:', err);
        return { distance_filter_meters: 5, search_radius_km: 2, max_users_returned: 50, refresh_interval_ms: 5000 };
    }
}

// Ensure defaults exist upon startup to assist admin CLI
async function ensureConfigDefaults() {
    const exists = await redisClient.exists('app_config');
    if (!exists) {
        await redisClient.hset('app_config', {
            distance_filter_meters: 5,
            search_radius_km: 2,
            max_users_returned: 50,
            refresh_interval_ms: 5000
        });
        console.log('[Radar] Initialized default app_config in Redis.');
    }
}

function initializeRadar(server) {
    const io = new Server(server, {
        cors: {
            origin: "*",
            methods: ["GET", "POST"]
        }
    });

    ensureConfigDefaults();

    // Setup Admin Pub/Sub listener
    redisSubscriber.subscribe('admin_alerts', (err, count) => {
        if (err) {
            console.error('[Radar] Failed to subscribe to admin_alerts:', err);
        } else {
            console.log('[Radar] Subscribed to admin_alerts channel.');
        }
    });

    redisSubscriber.on('message', async (channel, message) => {
        if (channel === 'admin_alerts' && message === 'config_updated') {
            console.log('[Radar] Received config update alert from Admin.');
            const newConfig = await getAppConfig();
            io.emit('config_updated', newConfig);
        }
    });

    io.on('connection', async (socket) => {
        console.log(`[Radar] Client connected: ${socket.id}`);
        
        // 1. Send active global configuration to client
        const config = await getAppConfig();
        socket.emit('initial_config', config);

        // 2. Handle location updates
        socket.on('updateLocation', async (data) => {
            if (!checkRateLimit(socket.id, 20, 10000)) {
                // Rate limited (more than 20 requests per 10 seconds)
                return socket.emit('error', { message: 'Rate limit exceeded' });
            }

            const { lat, lng, name, phone } = data;
            
            if (!lat || !lng) return;

            try {
                console.log(`[Radar] Updating location for ${socket.id} (${name}): ${lat}, ${lng}`);
                // Upsert Geospatial Index
                await redisClient.geoadd('active_users_locations', lng, lat, socket.id);
                // Save user metadata
                await redisClient.hset(`user_data:${socket.id}`, { name: name || 'Anonymous', phone: phone || ''});
                // Ensure data expires cleanly if the process hard-crashes (failsafe for Ghost Users)
                await redisClient.expire(`user_data:${socket.id}`, 3600); // 1 hour TTL
            } catch (err) {
                console.error('[Radar] Failed to update location:', err);
            }
        });

        // 3. Search for nearby active users
        socket.on('findNearby', async () => {
            if (!checkRateLimit(socket.id, 10, 10000)) {
                return socket.emit('error', { message: 'Rate limit exceeded' });
            }

            try {
                // Need to know where the requester is first
                const pos = await redisClient.geopos('active_users_locations', socket.id);
                if (!pos || !pos[0]) {
                    console.log(`[Radar] Cannot findNearby for ${socket.id}: no location registered yet.`);
                    // Start by sending an empty set if location isn't registered yet
                    return socket.emit('nearby_users', []);
                }

                const [reqLng, reqLat] = pos[0];
                const currentConfig = await getAppConfig();
                
                console.log(`[Radar] findNearby triggered by ${socket.id}. Radius: ${currentConfig.search_radius_km}km`);

                // Search radius command
                // ioredis syntax for GEOSEARCH: key, FROMMEMBER/FROMLONLAT, ... BYRADIUS, radius, unit, WITHCOORD
                const results = await redisClient.geosearch(
                    'active_users_locations',
                    'FROMLONLAT', reqLng, reqLat,
                    'BYRADIUS', currentConfig.search_radius_km, 'km',
                    'WITHCOORD', 
                    'ASC',
                    'COUNT', currentConfig.max_users_returned
                );

                const nearbyUsers = [];
                for (const res of results) {
                    const userId = res[0];
                    const [resLng, resLat] = res[1];

                    if (userId === socket.id) continue; // Don't return self

                    // Fetch metadata
                    const meta = await redisClient.hgetall(`user_data:${userId}`);

                    nearbyUsers.push({
                        id: userId,
                        lat: parseFloat(resLat),
                        lng: parseFloat(resLng),
                        name: meta.name || 'Anonymous',
                        phone: meta.phone || ''
                    });
                }

                socket.emit('nearby_users', nearbyUsers);

            } catch (err) {
                console.error('[Radar] Failed to find nearby users:', err);
            }
        });

        // 4. Client Disconnect
        socket.on('disconnect', async () => {
            console.log(`[Radar] Client disconnected: ${socket.id}`);
            try {
                await redisClient.zrem('active_users_locations', socket.id);
                await redisClient.del(`user_data:${socket.id}`);
                delete rateLimiter[socket.id];
            } catch (err) {
                console.error('[Radar] Clean-up failed on disconnect:', err);
            }
        });
    });
}

module.exports = { initializeRadar };
