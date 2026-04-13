/**
 * GeoSphere WB+ — Routing Module
 * 
 * Handles start/end point selection, route calculation via OSRM,
 * route display with Leaflet Routing Machine, and step-by-step directions.
 */

const GeoRouting = (() => {
    const API_BASE = window.location.origin;
    let map = null;
    let routeControl = null;
    let startPoint = null;
    let endPoint = null;
    let startMarker = null;
    let endMarker = null;
    let selectingPoint = null;   // 'start' or 'end'

    const startInput  = document.getElementById('route-start');
    const endInput    = document.getElementById('route-end');
    const swapBtn     = document.getElementById('route-swap');
    const getRouteBtn = document.getElementById('btn-get-route');
    const clearRouteBtn = document.getElementById('btn-clear-route');
    const routeInfo   = document.getElementById('route-info');
    const routeSteps  = document.getElementById('route-steps');

    // Maneuver icons
    const maneuverIcons = {
        'turn': '↱', 'new name': '→', 'depart': '↑', 'arrive': '■',
        'merge': '⤵', 'fork': '⑂', 'roundabout': '⟳',
        'continue': '→', 'end of road': '⊥', 'use lane': '⇶',
        'default': '➤',
    };

    function init(leafletMap) {
        map = leafletMap;

        // Click on input to enable map-click selection
        startInput.addEventListener('focus', () => { selectingPoint = 'start'; showToast('Click on the map to set the start point', 'info'); });
        endInput.addEventListener('focus', () => { selectingPoint = 'end'; showToast('Click on the map to set the end point', 'info'); });

        swapBtn.addEventListener('click', swapPoints);
        getRouteBtn.addEventListener('click', getRoute);
        clearRouteBtn.addEventListener('click', clearRoute);

        // Profile buttons
        document.querySelectorAll('.profile-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.profile-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            });
        });
    }

    /**
     * Set a waypoint from a map click (called by app.js)
     */
    function setPointFromMap(latlng) {
        if (!selectingPoint) return false;

        if (selectingPoint === 'start') {
            setStartPoint(latlng);
        } else {
            setEndPoint(latlng);
        }

        selectingPoint = null;
        return true;
    }

    function setStartPoint(latlng) {
        startPoint = latlng;
        startInput.value = `${latlng.lat.toFixed(5)}, ${latlng.lng.toFixed(5)}`;

        if (startMarker) map.removeLayer(startMarker);
        startMarker = L.circleMarker([latlng.lat, latlng.lng], {
            radius: 8, color: '#10b981', fillColor: '#10b981', fillOpacity: 0.9, weight: 2,
        }).addTo(map).bindPopup('Start Point');

        // Reverse geocode for label
        reverseGeocode(latlng, (name) => {
            startInput.value = name;
        });
    }

    function setEndPoint(latlng) {
        endPoint = latlng;
        endInput.value = `${latlng.lat.toFixed(5)}, ${latlng.lng.toFixed(5)}`;

        if (endMarker) map.removeLayer(endMarker);
        endMarker = L.circleMarker([latlng.lat, latlng.lng], {
            radius: 8, color: '#f43f5e', fillColor: '#f43f5e', fillOpacity: 0.9, weight: 2,
        }).addTo(map).bindPopup('End Point');

        reverseGeocode(latlng, (name) => {
            endInput.value = name;
        });
    }

    async function reverseGeocode(latlng, callback) {
        try {
            const res = await fetch(`${API_BASE}/api/reverse?lat=${latlng.lat}&lon=${latlng.lng}`);
            const data = await res.json();
            if (data.display_name) callback(data.display_name.split(',').slice(0, 3).join(', '));
        } catch (e) { /* keep coordinates */ }
    }

    function swapPoints() {
        const tmpPoint = startPoint;
        const tmpVal = startInput.value;

        startPoint = endPoint;
        startInput.value = endInput.value;

        endPoint = tmpPoint;
        endInput.value = tmpVal;

        // Swap markers
        if (startMarker) { map.removeLayer(startMarker); }
        if (endMarker) { map.removeLayer(endMarker); }

        if (startPoint) {
            startMarker = L.circleMarker([startPoint.lat, startPoint.lng], {
                radius: 8, color: '#10b981', fillColor: '#10b981', fillOpacity: 0.9, weight: 2,
            }).addTo(map);
        }
        if (endPoint) {
            endMarker = L.circleMarker([endPoint.lat, endPoint.lng], {
                radius: 8, color: '#f43f5e', fillColor: '#f43f5e', fillOpacity: 0.9, weight: 2,
            }).addTo(map);
        }
    }

    async function getRoute() {
        if (!startPoint || !endPoint) {
            showToast('Please set both start and end points by clicking on the map.', 'warning');
            return;
        }

        const profile = document.querySelector('.profile-btn.active')?.dataset.profile || 'driving';

        getRouteBtn.textContent = 'Calculating...';
        getRouteBtn.disabled = true;

        try {
            const res = await fetch(
                `${API_BASE}/api/route?startLat=${startPoint.lat}&startLon=${startPoint.lng}&endLat=${endPoint.lat}&endLon=${endPoint.lng}&profile=${profile}`
            );
            const data = await res.json();

            if (data.error) {
                showToast(data.error, 'error');
                return;
            }

            displayRoute(data);
            showToast('Route calculated successfully!', 'success');
        } catch (err) {
            showToast('Failed to calculate route.', 'error');
            console.error('[Routing]', err);
        } finally {
            getRouteBtn.textContent = 'Get Directions';
            getRouteBtn.disabled = false;
        }
    }

    function displayRoute(data) {
        if (!data.routes || data.routes.length === 0) return;

        const route = data.routes[0];

        // Remove existing route line
        if (routeControl) map.removeLayer(routeControl);

        // Draw route polyline
        const coords = route.geometry.coordinates.map(c => [c[1], c[0]]);
        routeControl = L.polyline(coords, {
            color: '#2563eb',
            weight: 5,
            opacity: 0.85,
            smoothFactor: 1,
            className: 'route-line',
        }).addTo(map);

        // Fit map to route
        map.fitBounds(routeControl.getBounds(), { padding: [60, 60] });

        // Show route info
        routeInfo.classList.remove('hidden');
        routeInfo.innerHTML = `
            <div class="route-info-grid">
                <div class="route-stat">
                    <div class="route-stat-value">${route.distance_km}</div>
                    <div class="route-stat-label">Kilometers</div>
                </div>
                <div class="route-stat">
                    <div class="route-stat-value">${route.duration_min}</div>
                    <div class="route-stat-label">Minutes</div>
                </div>
            </div>
        `;

        // Show steps
        if (route.legs && route.legs[0]?.steps) {
            routeSteps.classList.remove('hidden');
            routeSteps.innerHTML = route.legs[0].steps.map(step => {
                const icon = maneuverIcons[step.instruction] || maneuverIcons.default;
                const dist = step.distance_m >= 1000
                    ? `${(step.distance_m / 1000).toFixed(1)} km`
                    : `${step.distance_m} m`;
                return `
                    <div class="route-step">
                        <div class="route-step-icon">${icon}</div>
                        <div>
                            <div>${step.modifier ? capitalize(step.modifier) : ''} ${step.instruction ? '— ' + step.instruction : ''}</div>
                            <div class="route-step-dist">${step.name} · ${dist}</div>
                        </div>
                    </div>
                `;
            }).join('');
        }

        clearRouteBtn.classList.remove('hidden');
    }

    function clearRoute() {
        if (routeControl) { map.removeLayer(routeControl); routeControl = null; }
        if (startMarker)  { map.removeLayer(startMarker); startMarker = null; }
        if (endMarker)    { map.removeLayer(endMarker); endMarker = null; }

        startPoint = null;
        endPoint = null;
        startInput.value = '';
        endInput.value = '';
        routeInfo.classList.add('hidden');
        routeSteps.classList.add('hidden');
        clearRouteBtn.classList.add('hidden');
        routeInfo.innerHTML = '';
        routeSteps.innerHTML = '';
    }

    /**
     * Programmatically set start or end (used by context menu).
     */
    function setFrom(latlng) {
        setStartPoint(latlng);
        // Switch to route panel
        document.getElementById('tab-route').click();
    }

    function setTo(latlng) {
        setEndPoint(latlng);
        document.getElementById('tab-route').click();
    }

    function capitalize(s) {
        return s.charAt(0).toUpperCase() + s.slice(1);
    }

    function isSelecting() {
        return selectingPoint !== null;
    }

    return { init, setPointFromMap, setFrom, setTo, clearRoute, isSelecting };
})();
