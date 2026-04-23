/**
 * GeoSphere WB+ — Search Module
 * 
 * Handles the search bar with debounced autocomplete,
 * result rendering, and fly-to-location on selection.
 */

const GeoSearch = (() => {
    const API_BASE = window.GEOSPHERE_API_BASE || window.location.origin;
    let map = null;
    let searchMarker = null;
    let debounceTimer = null;

    const input = document.getElementById('search-input');
    const clearBtn = document.getElementById('search-clear');
    const results = document.getElementById('search-results');

    // Category icons
    const typeIcons = {
        city: 'CT', town: 'TN', village: 'VG', hamlet: 'HM',
        residential: 'RS', administrative: 'AD',
        hospital: 'H', school: 'S', university: 'U',
        restaurant: 'R', cafe: 'C', bank: 'B',
        park: 'PK', garden: 'GD', museum: 'M',
        temple: 'T', mosque: 'MS', church: 'CH',
        station: 'ST', bus_station: 'BS', airport: 'AP',
        default: '•',
    };

    function getIcon(type) {
        return typeIcons[type] || typeIcons.default;
    }

    /**
     * Initialize search with a Leaflet map instance.
     */
    function init(leafletMap) {
        map = leafletMap;

        input.addEventListener('input', onInput);
        input.addEventListener('focus', () => {
            if (results.children.length > 0) results.classList.remove('hidden');
        });
        clearBtn.addEventListener('click', clear);

        // Close results on outside click
        document.addEventListener('click', (e) => {
            if (!e.target.closest('#search-container')) {
                results.classList.add('hidden');
            }
        });

        // Keyboard navigation
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                results.classList.add('hidden');
                input.blur();
            }
        });
    }

    function onInput() {
        const q = input.value.trim();
        clearBtn.classList.toggle('hidden', q.length === 0);

        clearTimeout(debounceTimer);

        if (q.length < 2) {
            results.classList.add('hidden');
            results.innerHTML = '';
            return;
        }

        debounceTimer = setTimeout(() => search(q), 350);
    }

    async function search(query) {
        try {
            const res = await fetch(`${API_BASE}/api/search?q=${encodeURIComponent(query)}&limit=8`);
            const data = await res.json();

            if (!data.results || data.results.length === 0) {
                results.innerHTML = '<div class="search-result-item"><span style="color:var(--text-muted)">No results found</span></div>';
                results.classList.remove('hidden');
                return;
            }

            results.innerHTML = data.results.map((r, i) => `
                <div class="search-result-item" data-idx="${i}" data-lat="${r.lat}" data-lon="${r.lon}" data-name="${r.display_name}" data-image="${r.image_url || ''}" data-workers="${encodeURIComponent(JSON.stringify(r.worker_details || []))}">
                    <div class="search-result-icon">${getIcon(r.type)}</div>
                    <div class="search-result-text">
                        <div class="search-result-name">${escapeHtml(r.display_name.split(',')[0])}</div>
                        <div class="search-result-address">${escapeHtml(r.display_name)}</div>
                    </div>
                </div>
            `).join('');

            // Click handlers
            results.querySelectorAll('.search-result-item').forEach(item => {
                item.addEventListener('click', () => {
                    const lat = parseFloat(item.dataset.lat);
                    const lon = parseFloat(item.dataset.lon);
                    const name = item.dataset.name;
                    const imageUrl = item.dataset.image || '';
                    const workersData = item.dataset.workers || '%5B%5D';
                    flyTo(lat, lon, name, imageUrl, workersData);
                });
            });

            results.classList.remove('hidden');
        } catch (err) {
            console.error('[Search] Error:', err);
        }
    }

    function flyTo(lat, lon, name, imageUrl, workersData) {
        results.classList.add('hidden');
        input.value = name.split(',')[0];
        clearBtn.classList.remove('hidden');

        // Remove old marker
        if (searchMarker) map.removeLayer(searchMarker);

        // Fly to location
        map.flyTo([lat, lon], 16, { duration: 1.2 });

        // Build popup content
        let popupHtml = `<h3>${escapeHtml(name.split(',')[0])}</h3>`;

        // Show mandir image if available and not the placeholder SVG
        if (imageUrl && !imageUrl.includes('no-mandir-image')) {
            popupHtml += `
                <div class="popup-image-container">
                    <img src="${imageUrl}" alt="${escapeHtml(name.split(',')[0])}"
                         class="popup-image"
                         onerror="this.parentElement.style.display='none'" />
                </div>`;
        }

        popupHtml += `<div class="popup-detail">${escapeHtml(name)}</div>`;

        // Add worker details if available
        let workers = [];
        try {
            if (workersData) workers = JSON.parse(decodeURIComponent(workersData));
        } catch(e) {}
        
        if (workers && workers.length > 0) {
            popupHtml += `<div class="popup-workers-column"><strong style="display:block; margin-bottom:4px; margin-top:8px; font-size:13px; color:var(--text-secondary);">Worker Details</strong>`;
            workers.forEach(w => {
                const wName = w.f2 || 'Unknown';
                const wPhone = w.f3 || '';
                popupHtml += `
                    <div class="popup-worker-item">
                        <div class="worker-name">${escapeHtml(String(wName))}</div>
                        ${wPhone ? `<div class="worker-phone">📞 ${escapeHtml(String(wPhone))}</div>` : ''}
                    </div>
                `;
            });
            popupHtml += `</div>`;
        }

        // Add marker
        searchMarker = L.marker([lat, lon])
            .addTo(map)
            .bindPopup(popupHtml, { maxWidth: 300, minWidth: 200 })
            .openPopup();

        window.dispatchEvent(new CustomEvent('geosphere:place-selected', {
            detail: { lat, lon, name, imageUrl, workers },
        }));
    }

    function clear() {
        input.value = '';
        clearBtn.classList.add('hidden');
        results.classList.add('hidden');
        results.innerHTML = '';
        if (searchMarker) {
            map.removeLayer(searchMarker);
            searchMarker = null;
        }
    }

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    /**
     * Programmatically set search location (used by context menu).
     */
    function setLocation(lat, lon, name) {
        flyTo(lat, lon, name);
    }

    return { init, clear, setLocation };
})();
