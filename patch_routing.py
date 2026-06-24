import re

with open("frontend/js/routing.js", "r") as f:
    content = f.read()

# 1. Add routePolylines and initialization
init_target = """                if (routesByProfile[profile]) {
                    displayRouteForProfile(profile);
                }
            });
        });
    }"""
init_replace = """                if (routesByProfile[profile]) {
                    displayRouteForProfile(profile);
                }
            });
        });

        const now = new Date();
        const routeDate = document.getElementById('route-date');
        const routeTime = document.getElementById('route-time');
        if (routeDate) routeDate.value = now.toISOString().split('T')[0];
        if (routeTime) routeTime.value = now.toTimeString().split(' ')[0].substring(0, 5);
    }

    let routePolylines = [];
"""
content = content.replace(init_target, init_replace)

# 2. Replace getRoute
getroute_match = re.search(r'async function getRoute\(\) \{.*?(?=function displayRouteForProfile)', content, re.DOTALL)
if getroute_match:
    getroute_new = """async function getRoute() {
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

            // Add Transit Request (OTP)
            let endP = endPoint;
            if (!endPoint && typedDestination) {
                 // Try to geocode first using nominatim if no end point
                 const geoRes = await fetch(`${API_BASE}/api/search?q=${encodeURIComponent(typedDestination)}&limit=1`);
                 const geoData = await geoRes.json();
                 if(geoData && geoData.results && geoData.results.length > 0) {
                     endP = { lat: parseFloat(geoData.results[0].lat), lng: parseFloat(geoData.results[0].lon) };
                 }
            }

            if (endP) {
                const rDate = document.getElementById('route-date')?.value || new Date().toISOString().split('T')[0];
                const rTime = document.getElementById('route-time')?.value || new Date().toTimeString().split(' ')[0].substring(0, 5);
                const otpBaseUrl = `http://${window.location.hostname}:8080/otp/routers/default/plan`;
                const otpParams = new URLSearchParams({
                    fromPlace: `${startPoint.lat},${startPoint.lng}`,
                    toPlace: `${endP.lat},${endP.lng}`,
                    date: rDate,
                    time: rTime,
                    mode: 'TRANSIT,WALK',
                    maxWalkDistance: 2000
                });
                requests.push(
                    fetch(`${otpBaseUrl}?${otpParams.toString()}`)
                    .then(res => res.json())
                    .then(data => {
                        if (data.plan && data.plan.itineraries && data.plan.itineraries.length > 0) {
                            return { profile: 'transit', data: data.plan.itineraries[0], isOTP: true };
                        }
                        return null;
                    })
                    .catch(() => null)
                );
            }

            const settled = await Promise.allSettled(requests);
            const results = settled
                .filter(result => result.status === 'fulfilled')
                .map(result => result.value);
            routesByProfile = {};

            results.forEach((result) => {
                if (!result) return;
                if (result.isOTP) {
                    routesByProfile[result.profile] = { isOTP: true, data: result.data };
                } else {
                    routesByProfile[result.profile] = result.data.routes[0];
                }
            });

            const firstResolved = results.find(result => result && !result.isOTP && result.data?.end)?.data;
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
            } else if (!endPoint && endP) {
                setEndPoint(endP);
            }

            const availableProfiles = Object.keys(routesByProfile);
            if (availableProfiles.length === 0) {
                showToast('No route found for the selected points.', 'error');
                return;
            }

            const selectedProfile = document.querySelector('.profile-btn.active')?.dataset.profile || 'driving';
            const profileToDisplay = routesByProfile[selectedProfile] ? selectedProfile : availableProfiles[0];
            document.querySelectorAll('.profile-btn').forEach(b => {
                b.classList.remove('active');
                if(b.dataset.profile === profileToDisplay) b.classList.add('active');
            });
            displayRouteForProfile(profileToDisplay);

            const missing = 4 - availableProfiles.length;
            if (missing > 0) {
                showToast(`Directions calculated for ${availableProfiles.length}/4 profiles.`, 'warning');
            } else {
                showToast('Directions calculated for all profiles.', 'success');
            }
        } catch (err) {
            showToast('Failed to calculate route.', 'error');
            console.error('[Routing]', err);
        } finally {
            getRouteBtn.textContent = 'Get Directions';
            getRouteBtn.disabled = false;
        }
    }

    """
    content = content[:getroute_match.start()] + getroute_new + content[getroute_match.end():]

# 3. Replace displayRouteForProfile
display_match = re.search(r'function displayRouteForProfile\(profile\) \{.*?(?=function clearRoute\(\) \{)', content, re.DOTALL)
if display_match:
    display_new = """function displayRouteForProfile(profile) {
        const routeObj = routesByProfile[profile];
        if (!routeObj) return;

        if (routeControl) { map.removeLayer(routeControl); routeControl = null; }
        if (routePolylines) { routePolylines.forEach(l => map.removeLayer(l)); routePolylines = []; }
        
        const timelineContainer = document.getElementById('route-timeline');
        const timelineSegments = document.getElementById('timeline-segments');
        const timelineLabels = document.getElementById('timeline-labels');
        const tableContainer = document.getElementById('route-table-container');
        const tableBody = document.getElementById('route-table-body');
        
        if(timelineContainer) timelineContainer.classList.add('hidden');
        if(tableContainer) tableContainer.classList.add('hidden');
        routeSteps.classList.add('hidden');

        if (routeObj.isOTP) {
            const route = routeObj.data;
            let totalDurationStr = formatDuration(route.duration, 0).value;
            
            if(timelineSegments) timelineSegments.innerHTML = '';
            if(timelineLabels) timelineLabels.innerHTML = '';
            if(tableBody) tableBody.innerHTML = '';
            
            let totalTime = route.duration;
            let bounds = L.latLngBounds();
            
            const colorMap = {
                'WALK': '#22c55e',
                'BUS': '#eab308',
                'RAIL': '#3b82f6',
                'TRAM': '#f97316',
                'SUBWAY': '#a855f7',
                'FERRY': '#06b6d4',
                'AIRPLANE': '#ec4899',
            };

            route.legs.forEach(leg => {
                const coords = decodePolyline(leg.legGeometry.points);
                const color = colorMap[leg.mode] || '#64748b';
                
                const pline = L.polyline(coords, {
                    color: color,
                    weight: 6,
                    opacity: 0.85,
                    dashArray: leg.mode === 'WALK' ? '5, 10' : null,
                    className: 'route-line',
                }).addTo(map);
                routePolylines.push(pline);
                bounds.extend(pline.getBounds());
                
                const percent = (leg.duration / totalTime) * 100;
                if(timelineSegments) timelineSegments.innerHTML += `<div style="width: ${percent}%; background: ${color}; height: 100%;" title="${leg.mode}"></div>`;
                
                const startTime = new Date(leg.startTime).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
                const endTime = new Date(leg.endTime).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
                const fromName = leg.from.name === 'Origin' ? 'Start' : leg.from.name;
                const toName = leg.to.name === 'Destination' ? 'End' : leg.to.name;
                
                if(tableBody) tableBody.innerHTML += `
                    <tr style="border-bottom: 1px solid var(--border-color);">
                        <td style="padding: 8px 4px; font-weight: 600; color: ${color};">${capitalize(leg.mode)}</td>
                        <td style="padding: 8px 4px;">${fromName}</td>
                        <td style="padding: 8px 4px;">${toName}</td>
                        <td style="padding: 8px 4px;">${startTime} - ${endTime}</td>
                    </tr>
                `;
            });
            
            if(timelineLabels) {
                timelineLabels.innerHTML = `
                    <span>${new Date(route.startTime).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                    <span>${new Date(route.endTime).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                `;
            }
            
            if(bounds.isValid()) map.fitBounds(bounds, { padding: [60, 60] });

            routeInfo.classList.remove('hidden');
            routeInfo.innerHTML = `
                <div class="route-info-grid">
                    <div class="route-stat">
                        <div class="route-stat-value">${route.transfers}</div>
                        <div class="route-stat-label">Transfers</div>
                    </div>
                    <div class="route-stat">
                        <div class="route-stat-value">${totalDurationStr}</div>
                        <div class="route-stat-label">Duration</div>
                    </div>
                </div>
            `;
            
            if(timelineContainer) timelineContainer.classList.remove('hidden');
            if(tableContainer) tableContainer.classList.remove('hidden');
            clearRouteBtn.classList.remove('hidden');
            
        } else {
            const route = routeObj;
            const durationView = formatDuration(route.duration_s, route.duration_min);

            const coords = route.geometry.coordinates.map(c => [c[1], c[0]]);
            routeControl = L.polyline(coords, {
                color: '#2563eb',
                weight: 5,
                opacity: 0.85,
                smoothFactor: 1,
                className: 'route-line',
            }).addTo(map);

            map.fitBounds(routeControl.getBounds(), { padding: [60, 60] });

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
    }

    // Google Polyline Decoder Helper
    function decodePolyline(str, precision) {
        var index = 0, lat = 0, lng = 0, coordinates = [], shift = 0, result = 0, byte = null, latitude_change, longitude_change, factor = Math.pow(10, precision !== undefined ? precision : 5);
        while (index < str.length) {
            byte = null; shift = 0; result = 0;
            do {
                byte = str.charCodeAt(index++) - 63;
                result |= (byte & 0x1f) << shift;
                shift += 5;
            } while (byte >= 0x20);
            latitude_change = ((result & 1) ? ~(result >> 1) : (result >> 1));
            shift = result = 0;
            do {
                byte = str.charCodeAt(index++) - 63;
                result |= (byte & 0x1f) << shift;
                shift += 5;
            } while (byte >= 0x20);
            longitude_change = ((result & 1) ? ~(result >> 1) : (result >> 1));
            lat += latitude_change;
            lng += longitude_change;
            coordinates.push([lat / factor, lng / factor]);
        }
        return coordinates;
    }

    """
    content = content[:display_match.start()] + display_new + content[display_match.end():]

# 4. Replace clearRoute
clear_target = """    function clearRoute() {
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
        routeSteps.innerHTML = '';"""
clear_replace = """    function clearRoute() {
        if (routeControl) { map.removeLayer(routeControl); routeControl = null; }
        if (routePolylines) { routePolylines.forEach(l => map.removeLayer(l)); routePolylines = []; }
        if (startMarker) { map.removeLayer(startMarker); startMarker = null; }
        if (endMarker) { map.removeLayer(endMarker); endMarker = null; }

        startPoint = null;
        endPoint = null;
        routesByProfile = {};
        endInput.value = '';
        routeInfo.classList.add('hidden');
        routeSteps.classList.add('hidden');
        clearRouteBtn.classList.add('hidden');
        
        const timelineContainer = document.getElementById('route-timeline');
        const tableContainer = document.getElementById('route-table-container');
        if(timelineContainer) timelineContainer.classList.add('hidden');
        if(tableContainer) tableContainer.classList.add('hidden');
        
        routeInfo.innerHTML = '';
        routeSteps.innerHTML = '';"""
content = content.replace(clear_target, clear_replace)

with open("frontend/js/routing.js", "w") as f:
    f.write(content)

