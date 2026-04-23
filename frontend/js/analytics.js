/**
 * GeoSphere WB+ — Analytics Module
 * 
 * Provides spatial analytics: feature counting, category summaries,
 * and heatmap generation for the current map viewport.
 */

const GeoAnalytics = (() => {
    const API_BASE = window.GEOSPHERE_API_BASE || window.location.origin;
    let map = null;
    let heatLayer = null;

    const analyzeBtn = document.getElementById('btn-analyze-viewport');
    const resultsDiv = document.getElementById('analytics-results');
    const heatToggle = document.getElementById('layer-heatmap');

    function init(leafletMap) {
        map = leafletMap;

        analyzeBtn.addEventListener('click', analyzeViewport);

        // Heatmap toggle
        if (heatToggle) {
            heatToggle.addEventListener('change', (e) => {
                if (e.target.checked) {
                    loadHeatmap();
                } else {
                    if (heatLayer) {
                        map.removeLayer(heatLayer);
                        heatLayer = null;
                    }
                }
            });
        }
    }

    /**
     * Analyze features in the current map viewport.
     */
    async function analyzeViewport() {
        const bounds = map.getBounds();
        const bboxStr = [
            bounds.getWest().toFixed(5),
            bounds.getSouth().toFixed(5),
            bounds.getEast().toFixed(5),
            bounds.getNorth().toFixed(5),
        ].join(',');

        analyzeBtn.textContent = 'Analyzing...';
        analyzeBtn.disabled = true;

        try {
            const res = await fetch(`${API_BASE}/api/analytics/summary?bbox=${bboxStr}`);
            const data = await res.json();

            if (data.error) {
                showToast(data.error, 'error');
                return;
            }

            renderSummary(data);
        } catch (err) {
            showToast('Analytics query failed.', 'error');
            console.error('[Analytics]', err);
        } finally {
            analyzeBtn.textContent = 'Analyze Viewport';
            analyzeBtn.disabled = false;
        }
    }

    function renderSummary(data) {
        const top = data.categories.slice(0, 8);
        const maxCount = top.length > 0 ? top[0].count : 1;

        // Category icons
        const icons = {
            hospital: 'H', school: 'S', restaurant: 'R', fuel: 'F',
            bank: 'B', pharmacy: 'P', place_of_worship: 'PW', park: 'PK',
            cafe: 'C', college: 'CL', atm: 'ATM', police: 'PL',
            post_office: 'PO', library: 'L', cinema: 'CN',
            supermarket: 'SM', hotel: 'HT', default: '•',
        };

        resultsDiv.innerHTML = `
            <div class="analytics-grid">
                <div class="analytics-card">
                    <div class="analytics-card-value">${animateNumber(data.total)}</div>
                    <div class="analytics-card-label">Total Features</div>
                </div>
                <div class="analytics-card">
                    <div class="analytics-card-value">${data.categories.length}</div>
                    <div class="analytics-card-label">Categories</div>
                </div>
            </div>
            <h3 style="font-size:13px; color:var(--text-secondary); margin:16px 0 10px;">Top Categories</h3>
            <div class="analytics-bar-chart">
                ${top.map(cat => `
                    <div class="analytics-bar-item">
                        <div class="analytics-bar-label" title="${cat.category}">
                            ${icons[cat.category] || icons.default} ${cat.category}
                        </div>
                        <div class="analytics-bar-track">
                            <div class="analytics-bar-fill" style="width: ${(cat.count / maxCount * 100).toFixed(0)}%"></div>
                        </div>
                        <div class="analytics-bar-count">${cat.count}</div>
                    </div>
                `).join('')}
            </div>
        `;

        // Trigger bar animations
        requestAnimationFrame(() => {
            resultsDiv.querySelectorAll('.analytics-bar-fill').forEach(bar => {
                bar.style.width = bar.style.width; // force reflow
            });
        });
    }

    /**
     * Load heatmap data for the current viewport.
     */
    async function loadHeatmap() {
        const bounds = map.getBounds();
        const bboxStr = [
            bounds.getWest().toFixed(5),
            bounds.getSouth().toFixed(5),
            bounds.getEast().toFixed(5),
            bounds.getNorth().toFixed(5),
        ].join(',');

        try {
            const res = await fetch(`${API_BASE}/api/analytics/density?bbox=${bboxStr}&gridSize=0.005`);
            const data = await res.json();

            if (heatLayer) map.removeLayer(heatLayer);

            if (data.points && data.points.length > 0) {
                const heatData = data.points.map(p => [p.lat, p.lon, p.intensity]);
                heatLayer = L.heatLayer(heatData, {
                    radius: 25,
                    blur: 15,
                    maxZoom: 17,
                    gradient: {
                        0.0: '#dbeafe',
                        0.2: '#93c5fd',
                        0.4: '#3b82f6',
                        0.6: '#0ea5e9',
                        0.8: '#10b981',
                        1.0: '#f59e0b',
                    },
                }).addTo(map);
                showToast(`Heatmap loaded: ${data.points.length} grid cells`, 'success');
            } else {
                showToast('No density data in this area.', 'info');
            }
        } catch (err) {
            showToast('Failed to load heatmap data.', 'error');
            console.error('[Analytics] Heatmap error:', err);
        }
    }

    function animateNumber(num) {
        return num.toLocaleString();
    }

    return { init, analyzeViewport, loadHeatmap };
})();
