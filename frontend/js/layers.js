/**
 * GeoSphere WB+ — Layer Management Module
 * 
 * Handles base map switching and WMS overlay layers from GeoServer.
 */

const GeoLayers = (() => {
    const API_BASE = window.GEOSPHERE_API_BASE || window.location.origin;
    const GEOSERVER_WMS = `${API_BASE}/api/tiles/wms`;

    // ─── India Boundary Corrector Setup ───────────────────────────────
    // Extends L.tileLayer with boundary-corrected tiles showing India's
    // official borders (PoK, Aksai Chin within India) per Survey of India.
    if (typeof IndiaBoundaryCorrector !== 'undefined') {
        IndiaBoundaryCorrector.extendLeaflet(L);
    }

    // Use corrected tiles if available, otherwise fall back to standard tiles
    const _tile = (typeof L.tileLayer.indiaBoundaryCorrected === 'function')
        ? L.tileLayer.indiaBoundaryCorrected.bind(L.tileLayer)
        : L.tileLayer.bind(L);

    // ─── Base Map Tile Providers ────────────────────────────────────────
    const baseMaps = {
        osm: _tile('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; <a href="https://carto.com/">CARTO</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
            maxZoom: 19,
            maxNativeZoom: 19,
            subdomains: 'abcd',
        }),
        satellite: _tile('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
            attribution: '&copy; Esri',
            maxZoom: 19,
            maxNativeZoom: 18,
        }),
        terrain: _tile('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; <a href="https://opentopomap.org">OpenTopoMap</a>',
            maxZoom: 19,
            maxNativeZoom: 17,
        }),
    };

    // ─── WMS Overlay Layers ─────────────────────────────────────────────
    const wmsOverlays = {};

    /**
     * Create a WMS tile layer for a given GeoServer layer name.
     */
    function createWMSLayer(layerName) {
        return L.tileLayer.wms(GEOSERVER_WMS, {
            layers: `geosphere_in:${layerName}`,
            format: 'image/png',
            transparent: true,
            version: '1.1.1',
            maxZoom: 19,
            opacity: 0.7,
        });
    }

    /**
     * Initialize layers on the given Leaflet map.
     */
    function init(map) {
        // Start with terrain base
        baseMaps.terrain.addTo(map);

        // Pre-create WMS layers
        const layerNames = ['planet_osm_roads', 'planet_osm_point', 'planet_osm_polygon', 'planet_osm_line'];
        layerNames.forEach(name => {
            wmsOverlays[name] = createWMSLayer(name);
        });

        // ─── Base map radio button listeners ────────────────────────────
        document.querySelectorAll('input[name="basemap"]').forEach(radio => {
            radio.addEventListener('change', (e) => {
                // Remove all base maps
                Object.values(baseMaps).forEach(layer => {
                    if (map.hasLayer(layer)) map.removeLayer(layer);
                });
                // Add selected
                const selected = baseMaps[e.target.value];
                if (selected) selected.addTo(map);
            });
        });

        // ─── WMS overlay checkbox listeners ─────────────────────────────
        document.querySelectorAll('[id^="layer-"]').forEach(checkbox => {
            if (checkbox.type !== 'checkbox') return;
            checkbox.addEventListener('change', (e) => {
                const layerName = e.target.value;
                const wmsLayer = wmsOverlays[layerName];
                if (!wmsLayer) return;

                if (e.target.checked) {
                    wmsLayer.addTo(map);
                } else {
                    map.removeLayer(wmsLayer);
                }
            });
        });
    }

    return { init, baseMaps, wmsOverlays };
})();
