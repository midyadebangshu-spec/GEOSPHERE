/**
 * GeoSphere WB+ — Layer Management Module
 * 
 * Handles base map switching and WMS overlay layers from GeoServer.
 */

const GeoLayers = (() => {
    const API_BASE = window.location.origin;
    const GEOSERVER_WMS = `${API_BASE}/api/tiles/wms`;

    // ─── Base Map Tile Providers ────────────────────────────────────────
    const baseMaps = {
        osm: L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; <a href="https://carto.com/">CARTO</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
            maxZoom: 19,
            subdomains: 'abcd',
        }),
        satellite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
            attribution: '&copy; Esri',
            maxZoom: 18,
        }),
        terrain: L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; <a href="https://opentopomap.org">OpenTopoMap</a>',
            maxZoom: 17,
        }),
    };

    // ─── WMS Overlay Layers ─────────────────────────────────────────────
    const wmsOverlays = {};

    /**
     * Create a WMS tile layer for a given GeoServer layer name.
     */
    function createWMSLayer(layerName) {
        return L.tileLayer.wms(GEOSERVER_WMS, {
            layers: `geosphere_wb:${layerName}`,
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
