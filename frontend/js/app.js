/**
 * GeoSphere WB+ — Main Application Orchestrator
 * 
 * Initializes the Leaflet map, wires up all modules (layers, search,
 * routing, analytics, weather), and handles sidebar navigation,
 * context menu, and user location.
 */

(() => {
    'use strict';

    const API_BASE = window.GEOSPHERE_API_BASE || window.location.origin;

    // ─── West Bengal Center & Bounds ────────────────────────────────────
    const WB_CENTER = [22.9868, 87.855];
    const WB_ZOOM = 8;
    const WB_BOUNDS = L.latLngBounds([21.5, 85.5], [27.2, 89.9]);

    // ─── Map Initialization ─────────────────────────────────────────────
    const map = L.map('map', {
        center: WB_CENTER,
        zoom: WB_ZOOM,
        zoomControl: true,
        preferCanvas: true,
        maxBounds: WB_BOUNDS.pad(0.3),
        minZoom: 6,
        maxZoom: 19,
    });

    // ─── Initialize Modules ─────────────────────────────────────────────
    GeoLayers.init(map);
    GeoSearch.init(map);
    GeoRouting.init(map);
    GeoAnalytics.init(map);
    GeoWeather.init(map);
    GeoRadar.init(map);

    // ─── Nearby Search State ────────────────────────────────────────────
    let nearbyMarkers = [];
    let nearbyCenter = null;

    // ─── Sidebar Navigation ─────────────────────────────────────────────
    const sidebar = document.getElementById('sidebar');
    const sidebarToggle = document.getElementById('sidebar-toggle');

    sidebarToggle.addEventListener('click', () => {
        sidebar.classList.toggle('collapsed');
        // On mobile, toggle 'open' class instead
        if (window.innerWidth <= 768) {
            sidebar.classList.toggle('open');
        }
        // Invalidate map size after transition
        setTimeout(() => map.invalidateSize(), 450);
    });

    document.querySelectorAll('.sidebar-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            // Activate tab
            document.querySelectorAll('.sidebar-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            // Show corresponding panel
            const panelId = tab.dataset.panel;
            document.querySelectorAll('.sidebar-panel').forEach(p => p.classList.remove('active'));
            document.getElementById(panelId)?.classList.add('active');

            // Ensure sidebar is open
            if (sidebar.classList.contains('collapsed')) {
                sidebar.classList.remove('collapsed');
                setTimeout(() => map.invalidateSize(), 450);
            }
            if (window.innerWidth <= 768 && !sidebar.classList.contains('open')) {
                sidebar.classList.add('open');
            }
        });
    });

    // ─── Map Click Handler ──────────────────────────────────────────────
    map.on('click', (e) => {
        // Close context menu
        hideContextMenu();

        // Route point selection
        if (GeoRouting.isSelecting()) {
            GeoRouting.setPointFromMap(e.latlng);
            return;
        }
    });

    // ─── Mouse Move — Coordinate Display ────────────────────────────────
    const coordsLat = document.getElementById('coords-lat');
    const coordsLon = document.getElementById('coords-lon');
    const coordsZoom = document.getElementById('coords-zoom');

    map.on('mousemove', (e) => {
        coordsLat.textContent = `${e.latlng.lat.toFixed(4)}°N`;
        coordsLon.textContent = `${e.latlng.lng.toFixed(4)}°E`;
    });

    map.on('zoomend', () => {
        coordsZoom.textContent = map.getZoom();
    });

    // ─── Context Menu (Right-Click) ─────────────────────────────────────
    const ctxMenu = document.getElementById('context-menu');
    let ctxLatLng = null;

    map.on('contextmenu', (e) => {
        e.originalEvent.preventDefault();
        ctxLatLng = e.latlng;

        ctxMenu.style.left = `${e.originalEvent.clientX}px`;
        ctxMenu.style.top = `${e.originalEvent.clientY}px`;
        ctxMenu.classList.remove('hidden');
    });

    document.addEventListener('click', (e) => {
        if (!e.target.closest('#context-menu')) hideContextMenu();
    });

    function hideContextMenu() {
        ctxMenu.classList.add('hidden');
    }

    document.getElementById('ctx-route-from').addEventListener('click', () => {
        if (ctxLatLng) GeoRouting.setFrom(ctxLatLng);
        hideContextMenu();
    });

    document.getElementById('ctx-route-to').addEventListener('click', () => {
        if (ctxLatLng) GeoRouting.setTo(ctxLatLng);
        hideContextMenu();
    });

    document.getElementById('ctx-nearby').addEventListener('click', () => {
        if (ctxLatLng) {
            nearbyCenter = ctxLatLng;
            document.getElementById('tab-nearby').click();
            searchNearby();
        }
        hideContextMenu();
    });

    document.getElementById('ctx-whatishere').addEventListener('click', async () => {
        if (!ctxLatLng) return;
        hideContextMenu();

        try {
            const res = await fetch(`${API_BASE}/api/reverse?lat=${ctxLatLng.lat}&lon=${ctxLatLng.lng}`);
            const data = await res.json();

            L.popup()
                .setLatLng(ctxLatLng)
                .setContent(`
                    <h3>${data.display_name?.split(',')[0] || 'Unknown'}</h3>
                    <div class="popup-detail">${data.display_name || ''}</div>
                    <div class="popup-detail" style="margin-top:6px; color:var(--accent-cyan);">
                        ${ctxLatLng.lat.toFixed(5)}, ${ctxLatLng.lng.toFixed(5)}
                    </div>
                `)
                .openOn(map);
        } catch (err) {
            showToast('Reverse geocoding failed.', 'error');
        }
    });

    document.getElementById('ctx-aqi').addEventListener('click', async () => {
        if (!ctxLatLng) return;
        hideContextMenu();

        let placeName = `${ctxLatLng.lat.toFixed(5)}, ${ctxLatLng.lng.toFixed(5)}`;

        try {
            const revRes = await fetch(`${API_BASE}/api/reverse?lat=${ctxLatLng.lat}&lon=${ctxLatLng.lng}`);
            const revData = await revRes.json();
            if (revData?.display_name) placeName = revData.display_name;
        } catch (err) {
            console.warn('[AQI] Reverse lookup failed:', err);
        }

        const loadingPopup = L.popup({
            className: 'aqi-popup',
            maxWidth: 320,
        })
            .setLatLng(ctxLatLng)
            .setContent(renderAqiLoading(placeName, ctxLatLng))
            .openOn(map);

        try {
            const res = await fetch(`${API_BASE}/api/aqi?lat=${ctxLatLng.lat}&lon=${ctxLatLng.lng}&radius=25000`);
            const data = await res.json();

            if (!res.ok || data.error) {
                throw new Error(data.error || 'AQI unavailable');
            }

            loadingPopup.setContent(renderAqiCard(placeName, ctxLatLng, data));
        } catch (err) {
            loadingPopup.setContent(renderAqiError(placeName, ctxLatLng, err.message || 'Unknown error'));
            console.error('[AQI]', err);
        }
    });

    document.getElementById('ctx-weather').addEventListener('click', async () => {
        if (!ctxLatLng) return;
        hideContextMenu();

        let placeName = `${ctxLatLng.lat.toFixed(5)}, ${ctxLatLng.lng.toFixed(5)}`;

        try {
            const res = await fetch(`${API_BASE}/api/reverse?lat=${ctxLatLng.lat}&lon=${ctxLatLng.lng}`);
            const data = await res.json();
            if (data?.display_name) placeName = data.display_name;
        } catch (err) {
            console.warn('[Weather] Reverse lookup failed:', err);
        }

        GeoWeather.showWeatherOnly(ctxLatLng.lat, ctxLatLng.lng, placeName);
    });

    // ─── Nearby Search ──────────────────────────────────────────────────
    const nearbyRadiusInput = document.getElementById('nearby-radius');
    const radiusDisplay = document.getElementById('radius-value');
    const nearbyResultsDiv = document.getElementById('nearby-results');

    nearbyRadiusInput.addEventListener('input', () => {
        radiusDisplay.textContent = nearbyRadiusInput.value;
    });

    // Category chip selection
    document.querySelectorAll('.category-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            document.querySelectorAll('.category-chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
        });
    });

    document.getElementById('btn-search-nearby').addEventListener('click', () => {
        // Use map center if no specific center set
        nearbyCenter = nearbyCenter || map.getCenter();
        searchNearby();
    });

    async function searchNearby() {
        const center = nearbyCenter || map.getCenter();
        const type = document.querySelector('.category-chip.active')?.dataset.type || '';
        const radius = parseFloat(nearbyRadiusInput.value) * 1000;  // km → m

        nearbyResultsDiv.innerHTML = '<p style="color:var(--text-muted); font-size:13px;">Searching...</p>';

        try {
            const url = `${API_BASE}/api/nearby?lat=${center.lat}&lon=${center.lng}&radius=${radius}&type=${type}&limit=50`;
            const res = await fetch(url);
            const data = await res.json();

            // Clear old markers
            nearbyMarkers.forEach(m => map.removeLayer(m));
            nearbyMarkers = [];

            if (!data.features || data.features.length === 0) {
                nearbyResultsDiv.innerHTML = '<p style="color:var(--text-muted); font-size:13px;">No places found in this area.</p>';
                return;
            }

            const typeIcons = {
                hospital: 'H', school: 'S', restaurant: 'R', fuel: 'F',
                bank: 'B', pharmacy: 'P', hotel: 'HT', police: 'PL',
                park: 'PK', temple: 'T', cafe: 'C', default: '•',
            };

            nearbyResultsDiv.innerHTML = data.features.map((f, i) => {
                const p = f.properties;
                const cat = p.amenity || p.shop || p.tourism || p.leisure || 'place';
                const icon = typeIcons[cat] || typeIcons.default;
                const dist = p.distance_m >= 1000
                    ? `${(p.distance_m / 1000).toFixed(1)} km`
                    : `${p.distance_m} m`;
                const iconClass = typeIcons[cat] ? cat : 'default';

                return `
                    <div class="nearby-item" data-idx="${i}" data-lat="${f.geometry.coordinates[1]}" data-lon="${f.geometry.coordinates[0]}" data-name="${escapeHtml(p.name)}">
                        <div class="nearby-item-icon ${iconClass}">${icon}</div>
                        <div class="nearby-item-info">
                            <div class="nearby-item-name">${escapeHtml(p.name)}</div>
                            <div class="nearby-item-detail">${cat}${p.street ? ' · ' + p.street : ''}</div>
                        </div>
                        <div class="nearby-item-dist">${dist}</div>
                    </div>
                `;
            }).join('');

            // Add markers to map
            data.features.forEach((f, i) => {
                const p = f.properties;
                const coords = f.geometry.coordinates;
                const cat = p.amenity || p.shop || p.tourism || p.leisure || 'place';
                const icon = typeIcons[cat] || typeIcons.default;

                const marker = L.marker([coords[1], coords[0]])
                    .addTo(map)
                    .bindPopup(`
                        <h3>${escapeHtml(p.name)}</h3>
                        <div class="popup-detail">Type: ${cat}</div>
                        ${p.phone ? `<div class="popup-detail">Phone: ${p.phone}</div>` : ''}
                        ${p.website ? `<div class="popup-detail">Website: <a href="${p.website}" target="_blank">${p.website}</a></div>` : ''}
                        ${p.opening_hours ? `<div class="popup-detail">Hours: ${p.opening_hours}</div>` : ''}
                        <div class="popup-detail" style="margin-top:4px; color:var(--accent-cyan);">${p.distance_m} m away</div>
                    `);

                nearbyMarkers.push(marker);
            });

            // Click to fly to marker
            nearbyResultsDiv.querySelectorAll('.nearby-item').forEach(item => {
                item.addEventListener('click', () => {
                    const lat = parseFloat(item.dataset.lat);
                    const lon = parseFloat(item.dataset.lon);
                    const idx = parseInt(item.dataset.idx);
                    map.flyTo([lat, lon], 16, { duration: 0.8 });
                    nearbyMarkers[idx]?.openPopup();

                    window.dispatchEvent(new CustomEvent('geosphere:place-selected', {
                        detail: { lat, lon, name: item.dataset.name || 'Selected place' },
                    }));
                });
            });

            showToast(`Found ${data.features.length} places nearby`, 'success');

        } catch (err) {
            nearbyResultsDiv.innerHTML = '<p style="color:var(--accent-rose); font-size:13px;">Search failed. Is the API running?</p>';
            console.error('[Nearby]', err);
        }
    }

    // ─── My Location Button ─────────────────────────────────────────────
    let userLocationMarker = null;
    let userLocationPulse = null;

    function resolveUserLocation({
        showStartToast = false,
        showSuccessToast = false,
        centerMap = false,
        applyRouteStartUi = true,
    } = {}) {
        if (!('geolocation' in navigator)) {
            if (showStartToast) showToast('Geolocation not supported.', 'warning');
            return;
        }

        if (showStartToast) showToast('Locating you...', 'info');

        navigator.geolocation.getCurrentPosition(
            (pos) => {
                const lat = pos.coords.latitude;
                const lon = pos.coords.longitude;
                const latlng = [lat, lon];

                GeoRouting.setDefaultStartFromUser({ lat, lng: lon }, { applyToUi: applyRouteStartUi });

                if (userLocationMarker) map.removeLayer(userLocationMarker);
                if (userLocationPulse) map.removeLayer(userLocationPulse);

                userLocationMarker = L.circleMarker(latlng, {
                    radius: 8,
                    color: '#2563eb',
                    fillColor: '#60a5fa',
                    fillOpacity: 0.9,
                    weight: 3,
                }).addTo(map).bindPopup('You are here');

                userLocationPulse = L.circleMarker(latlng, {
                    radius: 24,
                    color: '#2563eb',
                    fillColor: '#2563eb',
                    fillOpacity: 0.1,
                    weight: 1,
                }).addTo(map);

                if (centerMap) {
                    userLocationMarker.openPopup();
                    map.flyTo(latlng, 15, { duration: 1.2 });
                }

                if (showSuccessToast) showToast('Location found!', 'success');
            },
            (err) => {
                if (showStartToast || showSuccessToast) {
                    showToast(`Location error: ${err.message}`, 'error');
                }
            },
            { enableHighAccuracy: true, timeout: 10000 }
        );
    }

    document.getElementById('btn-my-location').addEventListener('click', () => {
        resolveUserLocation({ showStartToast: true, showSuccessToast: true, centerMap: true });
    });

    // Seed routing start point with user location by default.
    resolveUserLocation();

    // ─── Toast Notification System ──────────────────────────────────────
    window.showToast = function (message, type = 'info', duration = 3500) {
        const container = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;

        toast.innerHTML = `${escapeHtml(message)}`;

        container.appendChild(toast);

        // Auto-remove
        setTimeout(() => {
            toast.classList.add('fade-out');
            setTimeout(() => toast.remove(), 300);
        }, duration);
    };

    // ─── Loading Screen Dismiss ─────────────────────────────────────────
    window.addEventListener('load', () => {
        setTimeout(() => {
            document.getElementById('loading-screen').classList.add('hidden');
        }, 1500);
    });

    // ─── Utility: Escape HTML ───────────────────────────────────────────
    function renderAqiLoading(placeName, latlng) {
        return `
            <div class="aqi-popup-card">
                <div class="aqi-place">${escapeHtml(placeName.split(',')[0] || 'Selected place')}</div>
                <div class="aqi-place-sub">${escapeHtml(placeName)}</div>
                <div class="aqi-loading">Loading AQI...</div>
                <div class="aqi-coords">${latlng.lat.toFixed(5)}, ${latlng.lng.toFixed(5)}</div>
            </div>
        `;
    }

    function renderAqiError(placeName, latlng, message) {
        return `
            <div class="aqi-popup-card">
                <div class="aqi-place">${escapeHtml(placeName.split(',')[0] || 'Selected place')}</div>
                <div class="aqi-place-sub">${escapeHtml(placeName)}</div>
                <div class="aqi-loading error">Unable to load AQI right now.</div>
                <div class="aqi-subnote">${escapeHtml(message)}</div>
                <div class="aqi-coords">${latlng.lat.toFixed(5)}, ${latlng.lng.toFixed(5)}</div>
            </div>
        `;
    }

    function renderAqiCard(placeName, latlng, data) {
        const pollutantRows = Array.isArray(data.pollutants) ? data.pollutants : [];
        const rowsHtml = pollutantRows.map((p) => {
            const valueText = formatPollutantValue(p.value);
            const unitText = p.unit ? escapeHtml(p.unit) : '';
            return `
                <div class="aqi-p-row">
                    <div class="aqi-p-name">${escapeHtml(p.label || p.key || '--')}</div>
                    <div class="aqi-p-value-wrap">
                        <span class="aqi-p-value">${valueText}</span>
                        <span class="aqi-p-unit">${unitText}</span>
                    </div>
                    <div class="aqi-p-trend">${renderSparkline(Array.isArray(p.trend) ? p.trend : [])}</div>
                </div>
            `;
        }).join('');

        return `
            <div class="aqi-popup-card">
                <div class="aqi-place">${escapeHtml(placeName.split(',')[0] || 'Selected place')}</div>
                <div class="aqi-place-sub">${escapeHtml(placeName)}</div>
                <div class="aqi-summary">
                    <div class="aqi-score">AQI ${data.aqi}</div>
                    <div class="aqi-cat">${escapeHtml(data.category || 'Unknown')}</div>
                </div>
                <div class="aqi-pollutants">
                    ${rowsHtml}
                </div>
                <div class="aqi-subnote">Based on ${escapeHtml(String(data.basis || '').toUpperCase())}${data.location ? ` · ${escapeHtml(data.location)}` : ''}</div>
                <div class="aqi-coords">${latlng.lat.toFixed(5)}, ${latlng.lng.toFixed(5)}</div>
            </div>
        `;
    }

    function formatPollutantValue(value) {
        const num = Number(value);
        if (!Number.isFinite(num)) return '--';
        if (Math.abs(num) >= 100) return `${Math.round(num)}`;
        if (Math.abs(num) >= 10) return `${num.toFixed(1).replace(/\.0$/, '')}`;
        return `${num.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}`;
    }

    function renderSparkline(values) {
        if (!Array.isArray(values) || values.length < 2) {
            return '<span class="aqi-no-trend">—</span>';
        }

        const width = 76;
        const height = 22;
        const min = Math.min(...values);
        const max = Math.max(...values);
        const range = max - min || 1;

        const points = values.map((value, index) => {
            const x = (index / (values.length - 1)) * (width - 2) + 1;
            const y = height - 1 - ((value - min) / range) * (height - 4) - 1;
            return `${x.toFixed(1)},${y.toFixed(1)}`;
        }).join(' ');

        return `
            <svg viewBox="0 0 ${width} ${height}" class="aqi-sparkline" aria-hidden="true" preserveAspectRatio="none">
                <polyline points="${points}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></polyline>
            </svg>
        `;
    }

    function escapeHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    // ─── Keyboard Shortcuts ─────────────────────────────────────────────
    document.addEventListener('keydown', (e) => {
        // Ctrl+K or / to focus search
        if ((e.ctrlKey && e.key === 'k') || (e.key === '/' && !e.target.closest('input'))) {
            e.preventDefault();
            document.getElementById('search-input').focus();
        }
        // Escape to close sidebar on mobile
        if (e.key === 'Escape') {
            if (window.innerWidth <= 768) {
                sidebar.classList.remove('open');
            }
        }
    });

    // ─── Console Welcome ────────────────────────────────────────────────
    console.log(
        '%cGeoSphere WB+ %cAdvanced Edition',
        'color: #2563eb; font-size: 20px; font-weight: bold;',
        'color: #0ea5e9; font-size: 20px; font-weight: 300;'
    );
    console.log('%cWest Bengal Map Platform — Powered by OpenStreetMap', 'color: #94a3b8; font-size: 12px;');

})();
