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
    let userDefaultStartPoint = null;
    let hasCustomStartPoint = false;
    let startMarker = null;
    let endMarker = null;
    let selectingPoint = null;   // 'start' or 'end'
    let routesByProfile = {};

    const startInput = document.getElementById('route-start');
    const endInput = document.getElementById('route-end');
    const swapBtn = document.getElementById('route-swap');
    const getRouteBtn = document.getElementById('btn-get-route');
    const clearRouteBtn = document.getElementById('btn-clear-route');
    const routeInfo = document.getElementById('route-info');
    const routeSteps = document.getElementById('route-steps');

    // Maneuver icons
    const maneuverIcons = {
        'turn': '↱', 'new name': '→', 'depart': '↑', 'arrive': '■',
        'merge': '⤵', 'fork': '⑂', 'roundabout': '⟳',
        'continue': '→', 'end of road': '⊥', 'use lane': '⇶',
        'default': '➤',
    };

    function init(leafletMap) {
        map = leafletMap;

        startInput.value = '';
        endInput.value = '';

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

                const profile = btn.dataset.profile;
                if (routesByProfile[profile]) {
                    displayRouteForProfile(profile);
                }
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

    function setStartPoint(latlng, options = {}) {
        const { isDefault = false } = options;
        startPoint = latlng;
        hasCustomStartPoint = !isDefault;
        startInput.value = `${latlng.lat.toFixed(5)}, ${latlng.lng.toFixed(5)}`;

        if (startMarker) map.removeLayer(startMarker);
        startMarker = L.circleMarker([latlng.lat, latlng.lng], {
            radius: 8, color: '#10b981', fillColor: '#10b981', fillOpacity: 0.9, weight: 2,
        }).addTo(map).bindPopup('Start Point');

        // Reverse geocode for label
        reverseGeocode(latlng, (name) => {
            startInput.value = isDefault ? `Your location · ${name}` : name;
        });
    }

    function setDefaultStartFromUser(latlng, options = {}) {
        const { applyToUi = true } = options;
        if (!latlng) return;

        userDefaultStartPoint = latlng;

        if (!hasCustomStartPoint || !startPoint) {
            startPoint = latlng;
            if (applyToUi) {
                setStartPoint(latlng, { isDefault: true });
            }
        }
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
        hasCustomStartPoint = !!startPoint;

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
        const typedDestination = endInput.value.trim();

        if (!startPoint) {
            showToast('Please set the start point by clicking on the map.', 'warning');
            return;
        }

        if (!endPoint && !typedDestination) {
            showToast('Set an end point on the map or type a destination name.', 'warning');
            return;
        }

        const profiles = ['driving', 'cycling', 'walking'];

        getRouteBtn.textContent = 'Calculating...';
        getRouteBtn.disabled = true;

        try {
            const requests = profiles.map(async (profile) => {
                const params = new URLSearchParams({
                    startLat: String(startPoint.lat),
                    startLon: String(startPoint.lng),
                    profile,
                });

                if (endPoint) {
                    params.set('endLat', String(endPoint.lat));
                    params.set('endLon', String(endPoint.lng));
                } else {
                    params.set('endQuery', typedDestination);
                }

                const res = await fetch(`${API_BASE}/api/route?${params.toString()}`);
                const data = await res.json();
                if (!res.ok || data.error || !data.routes?.length) return null;
                return { profile, data };
            });

            const settled = await Promise.allSettled(requests);
            const results = settled
                .filter(result => result.status === 'fulfilled')
                .map(result => result.value);
            routesByProfile = {};

            results.forEach((result) => {
                if (!result) return;
                routesByProfile[result.profile] = result.data.routes[0];
            });

            const firstResolved = results.find(result => result?.data?.end)?.data;
            if (!endPoint && firstResolved?.end) {
                const resolvedLatlng = {
                    lat: Number(firstResolved.end.lat),
                    lng: Number(firstResolved.end.lon),
                };
                setEndPoint(resolvedLatlng);
                if (firstResolved.matched_place?.name) {
                    const secondary = firstResolved.matched_place.address
                        ? `, ${firstResolved.matched_place.address}`
                        : '';
                    endInput.value = `${firstResolved.matched_place.name}${secondary}`;
                }
            }

            const availableProfiles = Object.keys(routesByProfile);
            if (availableProfiles.length === 0) {
                showToast('No route found for the selected points.', 'error');
                return;
            }

            const selectedProfile = document.querySelector('.profile-btn.active')?.dataset.profile || 'driving';
            const profileToDisplay = routesByProfile[selectedProfile] ? selectedProfile : availableProfiles[0];
            displayRouteForProfile(profileToDisplay);

            const missing = profiles.length - availableProfiles.length;
            if (missing > 0) {
                showToast(`Directions calculated for ${availableProfiles.length}/3 profiles.`, 'warning');
            } else {
                showToast('Directions calculated for car, cycle, and walking.', 'success');
            }
        } catch (err) {
            showToast('Failed to calculate route.', 'error');
            console.error('[Routing]', err);
        } finally {
            getRouteBtn.textContent = 'Get Directions';
            getRouteBtn.disabled = false;
        }
    }

    function displayRouteForProfile(profile) {
        const route = routesByProfile[profile];
        if (!route) return;
        const durationView = formatDuration(route.duration_s, route.duration_min);

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
                    <div class="route-stat-value">${durationView.value}</div>
                    <div class="route-stat-label">${durationView.label}</div>
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
        if (startMarker) { map.removeLayer(startMarker); startMarker = null; }
        if (endMarker) { map.removeLayer(endMarker); endMarker = null; }

        startPoint = null;
        endPoint = null;
        routesByProfile = {};
        endInput.value = '';
        routeInfo.classList.add('hidden');
        routeSteps.classList.add('hidden');
        clearRouteBtn.classList.add('hidden');
        routeInfo.innerHTML = '';
        routeSteps.innerHTML = '';

        hasCustomStartPoint = false;
        if (userDefaultStartPoint) {
            setStartPoint(userDefaultStartPoint, { isDefault: true });
        } else {
            startInput.value = '';
        }
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

    function formatDuration(durationSeconds, durationMinutesFallback) {
        const fallbackMinutes = Number.parseFloat(durationMinutesFallback || 0);
        const totalSeconds = Number.isFinite(durationSeconds)
            ? Math.max(0, Math.round(durationSeconds))
            : Math.max(0, Math.round(fallbackMinutes * 60));

        const minute = 60;
        const hour = 60 * minute;
        const day = 24 * hour;
        const week = 7 * day;

        if (totalSeconds >= week) {
            const weeks = Math.floor(totalSeconds / week);
            const days = Math.floor((totalSeconds % week) / day);
            const hours = Math.floor((totalSeconds % day) / hour);
            const minutes = Math.floor((totalSeconds % hour) / minute);
            return {
                value: `${weeks}w ${days}d ${hours}h ${minutes}m`,
                label: 'Duration',
            };
        }

        if (totalSeconds >= day) {
            const days = Math.floor(totalSeconds / day);
            const hours = Math.floor((totalSeconds % day) / hour);
            const minutes = Math.floor((totalSeconds % hour) / minute);
            return {
                value: `${days}d ${hours}h ${minutes}m`,
                label: 'Duration',
            };
        }

        if (totalSeconds >= hour) {
            const hours = Math.floor(totalSeconds / hour);
            const minutes = Math.floor((totalSeconds % hour) / minute);
            return {
                value: `${hours}h ${minutes}m`,
                label: 'Duration',
            };
        }

        return {
            value: `${Math.floor(totalSeconds / minute)}m`,
            label: 'Duration',
        };
    }

    function isSelecting() {
        return selectingPoint !== null;
    }

    return { init, setPointFromMap, setFrom, setTo, clearRoute, isSelecting, setDefaultStartFromUser };
})();
