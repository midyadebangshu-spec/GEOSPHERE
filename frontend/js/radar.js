/**
 * GeoSphere WB+ — Real-Time User Radar
 * 
 * Secure, opt-in peer-to-peer tracking utilizing Socket.io and Redis.
 */

const GeoRadar = (() => {
    const API_BASE = window.GEOSPHERE_API_BASE || window.location.origin;
    
    let map = null;
    let socket = null;
    let radarLayer = null;
    
    let isTracking = false;
    let watchId = null;
    let pingInterval = null;
    let currentConfig = {
        distance_filter_meters: 5,
        search_radius_km: 2,
        refresh_interval_ms: 5000
    };

    let lastBroadcastedCoords = null; // {lat, lng}

    // Modal UI elements
    const optInContainer = document.getElementById('radar-opt-in-container');
    const activeContainer = document.getElementById('radar-active-container');
    const inputName = document.getElementById('radar-name');
    const inputPhone = document.getElementById('radar-phone');
    const btnOptIn = document.getElementById('btn-radar-opt-in');
    const btnLeave = document.getElementById('btn-radar-leave');
    const userListContainer = document.getElementById('radar-user-list');

    // Haversine distance formula to natively enforce the config variables
    function calculateDistanceMeters(lat1, lon1, lat2, lon2) {
        const R = 6371e3; // metres
        const φ1 = lat1 * Math.PI / 180;
        const φ2 = lat2 * Math.PI / 180;
        const Δφ = (lat2 - lat1) * Math.PI / 180;
        const Δλ = (lon2 - lon1) * Math.PI / 180;

        const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
                  Math.cos(φ1) * Math.cos(φ2) *
                  Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

        return R * c; 
    }

    function init(mapInstance) {
        map = mapInstance;
        
        // Initialize MarkerCluster
        radarLayer = L.markerClusterGroup({
            maxClusterRadius: 40,
            iconCreateFunction: function(cluster) {
                return L.divIcon({
                    html: `<div><span>${cluster.getChildCount()}</span></div>`,
                    className: 'radar-cluster-icon',
                    iconSize: L.point(40, 40)
                });
            }
        });
        map.addLayer(radarLayer);

        btnOptIn.addEventListener('click', enableRadar);
        btnLeave.addEventListener('click', disableRadar);
    }

    function restartPingInterval() {
        if (pingInterval) {
            clearInterval(pingInterval);
        }
        const interval = currentConfig.refresh_interval_ms || 5000;
        console.log(`[Radar] Auto-ping interval set to ${interval}ms`);
        pingInterval = setInterval(() => {
            if (socket && isTracking) {
                socket.emit('findNearby');
            }
        }, interval);
    }

    function enableRadar() {
        const name = inputName.value.trim();
        if (!name) {
            window.showToast("Please enter a name to enable Radar.", "error");
            return;
        }

        // Establish connection
        socket = io(API_BASE, {
            reconnectionDelayMax: 10000,
        });

        // Socket Listeners
        socket.on('connect', () => {
            isTracking = true;
            optInContainer.classList.add('hidden');
            activeContainer.classList.remove('hidden');
            window.showToast("Radar connected securely.", "success");
            startLocationEngine();
        });

        socket.on('initial_config', (config) => {
            console.log('[Radar] Received initial config:', config);
            currentConfig = config;
            restartPingInterval();
        });

        socket.on('config_updated', (config) => {
            console.log('[Radar] Admin triggered config update:', config);
            currentConfig = config;
            restartPingInterval();
            window.showToast("Live radar config updated by admin.", "info");
        });

        socket.on('nearby_users', (users) => {
            renderNearbyUsers(users);
        });

        socket.on('disconnect', () => {
            window.showToast("Lost connection to radar server.", "warning");
            stopLocationEngine();
        });

        socket.on('error', (err) => {
            window.showToast(err.message, "error");
        });
    }

    function disableRadar() {
        if (pingInterval) {
            clearInterval(pingInterval);
            pingInterval = null;
        }
        if (socket) {
            socket.disconnect();
            socket = null;
        }
        isTracking = false;
        optInContainer.classList.remove('hidden');
        activeContainer.classList.add('hidden');
        radarLayer.clearLayers();
        userListContainer.innerHTML = '';
        stopLocationEngine();
        window.showToast("You are now offline on Radar.", "info");
    }

    function startLocationEngine() {
        if (!('geolocation' in navigator)) return;

        watchId = navigator.geolocation.watchPosition(
            (pos) => {
                const newLat = pos.coords.latitude;
                const newLng = pos.coords.longitude;

                // Enforce dynamically tuned distance_filter_meters
                if (lastBroadcastedCoords) {
                    const dist = calculateDistanceMeters(
                        lastBroadcastedCoords.lat, 
                        lastBroadcastedCoords.lng,
                        newLat,
                        newLng
                    );

                    if (dist < currentConfig.distance_filter_meters) {
                        return; // Did not move far enough, do not hit server rate limiter.
                    }
                }

                lastBroadcastedCoords = { lat: newLat, lng: newLng };

                socket.emit('updateLocation', {
                    lat: newLat,
                    lng: newLng,
                    name: inputName.value.trim(),
                    phone: inputPhone.value.trim()
                });

                // Immediately ping after first location broadcast
                socket.emit('findNearby');
            },
            (err) => console.error('[Radar] GPS Error:', err),
            { enableHighAccuracy: true, maximumAge: 10000, timeout: 5000 }
        );
    }

    function stopLocationEngine() {
        if (watchId !== null) {
            navigator.geolocation.clearWatch(watchId);
            watchId = null;
        }
        lastBroadcastedCoords = null;
    }

    function renderNearbyUsers(users) {
        // Update map markers
        radarLayer.clearLayers();

        users.forEach(user => {
            const markerIcon = L.divIcon({
                className: 'radar-user-pulse',
                iconSize: [20, 20],
                html: '<div class="pulse-ring"></div><div class="pulse-core"></div>'
            });

            const marker = L.marker([user.lat, user.lng], { 
                icon: markerIcon,
                zIndexOffset: 1000 
            });
            
            marker.bindPopup(`
                <div style="text-align:center;">
                    <h3 style="margin:0 0 5px 0;">${user.name}</h3>
                    ${user.phone ? `<div style="font-size:12px; color:var(--text-muted);">${user.phone}</div>` : ''}
                </div>
            `);

            radarLayer.addLayer(marker);
        });

        // Update sidebar user list
        if (users.length === 0) {
            userListContainer.innerHTML = `
                <div class="radar-list-empty">
                    <p>No nearby users found yet…</p>
                </div>
            `;
            return;
        }

        userListContainer.innerHTML = `
            <div class="radar-list-header">
                <span>${users.length} user${users.length > 1 ? 's' : ''} nearby</span>
            </div>
        ` + users.map(user => `
            <div class="radar-user-card" data-lat="${user.lat}" data-lng="${user.lng}">
                <div class="radar-user-avatar">${user.name.charAt(0).toUpperCase()}</div>
                <div class="radar-user-info">
                    <div class="radar-user-name">${user.name}</div>
                    ${user.phone ? `<div class="radar-user-phone">${user.phone}</div>` : '<div class="radar-user-phone" style="opacity:0.4;">No phone shared</div>'}
                </div>
            </div>
        `).join('');

        // Click a card to fly to that user on the map
        userListContainer.querySelectorAll('.radar-user-card').forEach(card => {
            card.addEventListener('click', () => {
                const lat = parseFloat(card.dataset.lat);
                const lng = parseFloat(card.dataset.lng);
                map.flyTo([lat, lng], 17, { duration: 0.8 });
            });
        });
    }

    return {
        init
    };
})();
