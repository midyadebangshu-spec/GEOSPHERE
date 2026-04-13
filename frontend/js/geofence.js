/**
 * GeoSphere WB+ — Geofence Module
 * 
 * Draw polygons/circles on the map, track user position,
 * and trigger notifications on enter/exit.
 */

const GeoFence = (() => {
    let map = null;
    let geofenceLayer = null;
    let drawingMode = false;
    let drawPoints = [];
    let drawPolyline = null;
    let watchId = null;
    let isInsideGeofence = false;

    const drawBtn   = document.getElementById('btn-draw-geofence');
    const clearBtn  = document.getElementById('btn-clear-geofence');
    const statusDiv = document.getElementById('geofence-status');

    function init(leafletMap) {
        map = leafletMap;

        drawBtn.addEventListener('click', toggleDrawing);
        clearBtn.addEventListener('click', clearGeofence);
    }

    function toggleDrawing() {
        if (drawingMode) {
            finishDrawing();
        } else {
            startDrawing();
        }
    }

    function startDrawing() {
        drawingMode = true;
        drawPoints = [];
        drawBtn.textContent = 'Finish Drawing';
        drawBtn.style.background = 'linear-gradient(135deg, #10b981, #059669)';
        showToast('Click on the map to add geofence points. Click "Finish Drawing" when done.', 'info');

        // Cursor style
        map.getContainer().style.cursor = 'crosshair';
    }

    /**
     * Add a point to the geofence polygon (called by app.js).
     */
    function addPoint(latlng) {
        if (!drawingMode) return false;

        drawPoints.push(latlng);

        // Update preview polyline
        if (drawPolyline) map.removeLayer(drawPolyline);
        drawPolyline = L.polyline(drawPoints, {
            color: '#f59e0b',
            weight: 2,
            dashArray: '6, 4',
        }).addTo(map);

        // Add vertex marker
        L.circleMarker(latlng, {
            radius: 4,
            color: '#f59e0b',
            fillColor: '#f59e0b',
            fillOpacity: 1,
        }).addTo(map);

        return true;
    }

    function finishDrawing() {
        drawingMode = false;
        map.getContainer().style.cursor = '';
        drawBtn.textContent = 'Draw Geofence';
        drawBtn.style.background = '';

        if (drawPoints.length < 3) {
            showToast('Need at least 3 points for a geofence.', 'warning');
            if (drawPolyline) map.removeLayer(drawPolyline);
            return;
        }

        // Remove preview
        if (drawPolyline) map.removeLayer(drawPolyline);

        // Create polygon
        geofenceLayer = L.polygon(drawPoints, {
            color: '#f59e0b',
            fillColor: '#f59e0b',
            fillOpacity: 0.12,
            weight: 2,
            dashArray: '8, 4',
        }).addTo(map);

        clearBtn.classList.remove('hidden');
        startWatching();

        showToast('Geofence created! Position tracking enabled.', 'success');
    }

    function clearGeofence() {
        if (geofenceLayer) {
            map.removeLayer(geofenceLayer);
            geofenceLayer = null;
        }
        drawPoints = [];
        clearBtn.classList.add('hidden');
        statusDiv.innerHTML = '';
        stopWatching();
    }

    function startWatching() {
        if (!('geolocation' in navigator)) {
            statusDiv.innerHTML = '<div class="geofence-status-card"><div class="geofence-status-label">Geolocation not available</div></div>';
            return;
        }

        watchId = navigator.geolocation.watchPosition(
            (pos) => {
                const latlng = L.latLng(pos.coords.latitude, pos.coords.longitude);
                checkGeofence(latlng);
            },
            (err) => {
                statusDiv.innerHTML = `<div class="geofence-status-card"><div class="geofence-status-label">Location error: ${err.message}</div></div>`;
            },
            { enableHighAccuracy: true, maximumAge: 5000 }
        );
    }

    function stopWatching() {
        if (watchId !== null) {
            navigator.geolocation.clearWatch(watchId);
            watchId = null;
        }
    }

    function checkGeofence(latlng) {
        if (!geofenceLayer) return;

        const inside = isPointInsidePolygon(latlng, geofenceLayer);

        if (inside && !isInsideGeofence) {
            isInsideGeofence = true;
            showToast('Entered geofence zone.', 'success');
            updateStatus(true);
        } else if (!inside && isInsideGeofence) {
            isInsideGeofence = false;
            showToast('Left geofence zone.', 'warning');
            updateStatus(false);
        }
    }

    function updateStatus(inside) {
        statusDiv.innerHTML = `
            <div class="geofence-status-card ${inside ? 'inside' : 'outside'}">
                <div class="geofence-status-label">${inside ? 'Inside Zone' : 'Outside Zone'}</div>
                <div class="geofence-status-detail">Last update: ${new Date().toLocaleTimeString()}</div>
            </div>
        `;
    }

    /**
     * Ray-casting point-in-polygon test.
     */
    function isPointInsidePolygon(latlng, polygon) {
        const polyPoints = polygon.getLatLngs()[0];
        const x = latlng.lat, y = latlng.lng;
        let inside = false;

        for (let i = 0, j = polyPoints.length - 1; i < polyPoints.length; j = i++) {
            const xi = polyPoints[i].lat, yi = polyPoints[i].lng;
            const xj = polyPoints[j].lat, yj = polyPoints[j].lng;

            if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
                inside = !inside;
            }
        }

        return inside;
    }

    function isDrawing() {
        return drawingMode;
    }

    return { init, addPoint, isDrawing, clearGeofence };
})();
