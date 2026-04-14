/**
 * GeoSphere WB+ — Educational Institutions Layer Module
 */

const GeoInstitutions = (() => {
    const API_BASE = window.location.origin;

    let map = null;
    let enabled = false;
    let markersLayer = null;

    const controls = {
        toggle: document.getElementById('layer-institutions'),
        filtersWrap: document.getElementById('institutions-filters'),
        summary: document.getElementById('institutions-summary'),
    };

    function init(leafletMap) {
        map = leafletMap;

        markersLayer = L.markerClusterGroup({
            disableClusteringAtZoom: 15,
            maxClusterRadius: 60,
            spiderfyOnMaxZoom: true,
            showCoverageOnHover: false,
        });

        controls.filtersWrap.classList.add('hidden');

        controls.toggle.addEventListener('change', async (e) => {
            enabled = e.target.checked;
            controls.filtersWrap.classList.toggle('hidden', !enabled);

            if (enabled) {
                map.addLayer(markersLayer);
                await fetchAndRender();
            } else {
                map.removeLayer(markersLayer);
                markersLayer.clearLayers();
                controls.summary.textContent = '';
            }
        });

        map.on('moveend', () => {
            if (!enabled) return;
            fetchAndRender();
        });
    }

    async function fetchAndRender() {
        controls.summary.textContent = 'Loading institutions...';

        const bounds = map.getBounds();
        const params = new URLSearchParams({
            minLat: bounds.getSouth().toString(),
            minLon: bounds.getWest().toString(),
            maxLat: bounds.getNorth().toString(),
            maxLon: bounds.getEast().toString(),
            limit: '500',
        });

        try {
            const res = await fetch(`${API_BASE}/api/institutions?${params.toString()}`);
            const data = await res.json();

            if (!res.ok) {
                throw new Error(data.error || 'Failed to load institutions');
            }

            markersLayer.clearLayers();

            const markers = (data.results || [])
                .filter(r => Number.isFinite(r.lat) && Number.isFinite(r.lon))
                .map(buildMarker);

            markers.forEach(m => markersLayer.addLayer(m));

            controls.summary.textContent = `${markers.length} institutions in view`;
        } catch (err) {
            console.error('[Institutions]', err);
            controls.summary.textContent = 'Unable to load institutions';
        }
    }

    function buildMarker(record) {
        const marker = L.marker([record.lat, record.lon]);
        const management = record.metadata?.management || 'n/a';

        marker.bindPopup(`
            <h3>${escapeHtml(record.name)}</h3>
            <div class="popup-detail">Type: ${escapeHtml(record.type)}${record.subtype ? ` · ${escapeHtml(record.subtype)}` : ''}</div>
            <div class="popup-detail">Management: ${escapeHtml(management)}</div>
            ${record.district ? `<div class="popup-detail">District: ${escapeHtml(record.district)}</div>` : ''}
            ${record.address ? `<div class="popup-detail">Address: ${escapeHtml(record.address)}</div>` : ''}
            ${record.udise_code ? `<div class="popup-detail">UDISE: ${escapeHtml(record.udise_code)}</div>` : ''}
            ${record.aishe_id ? `<div class="popup-detail">AISHE: ${escapeHtml(record.aishe_id)}</div>` : ''}
            <div class="popup-detail" style="margin-top:4px; color:var(--accent-cyan);">Source: ${escapeHtml(record.source)}</div>
        `);

        return marker;
    }

    function escapeHtml(value) {
        if (value === null || value === undefined) return '';
        const div = document.createElement('div');
        div.textContent = String(value);
        return div.innerHTML;
    }

    return { init };
})();
