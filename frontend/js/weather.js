/**
 * GeoSphere WB+ — Weather Module
 *
 * Fetches and renders current weather from Open-Meteo
 * for the currently selected place.
 */

const GeoWeather = (() => {
    const API_BASE = window.GEOSPHERE_API_BASE || window.location.origin;
    let map = null;
    let activePopup = null;
    let commonsSwipeTimer = null;

    const weatherCodeMap = {
        0: 'Clear sky',
        1: 'Mainly clear',
        2: 'Partly cloudy',
        3: 'Overcast',
        45: 'Fog',
        48: 'Depositing rime fog',
        51: 'Light drizzle',
        53: 'Moderate drizzle',
        55: 'Dense drizzle',
        56: 'Light freezing drizzle',
        57: 'Dense freezing drizzle',
        61: 'Slight rain',
        63: 'Moderate rain',
        65: 'Heavy rain',
        66: 'Light freezing rain',
        67: 'Heavy freezing rain',
        71: 'Slight snowfall',
        73: 'Moderate snowfall',
        75: 'Heavy snowfall',
        77: 'Snow grains',
        80: 'Slight rain showers',
        81: 'Moderate rain showers',
        82: 'Violent rain showers',
        85: 'Slight snow showers',
        86: 'Heavy snow showers',
        95: 'Thunderstorm',
        96: 'Thunderstorm with slight hail',
        99: 'Thunderstorm with heavy hail',
    };

    function init(leafletMap) {
        map = leafletMap;
        map.on('popupclose', () => {
            clearCommonsAutoSwipe();
        });

        window.addEventListener('geosphere:place-selected', async (evt) => {
            const { lat, lon, name, imageUrl, workers } = evt.detail || {};
            if (!isValidCoord(lat, lon)) return;
            await showAt(lat, lon, name || 'Selected place', imageUrl, workers);
        });
    }

    function isValidCoord(lat, lon) {
        return Number.isFinite(lat) && Number.isFinite(lon);
    }

    function weatherText(code) {
        return weatherCodeMap[code] || 'Unknown weather';
    }

    function formatTime(ts) {
        if (!ts) return '';
        const date = new Date(ts);
        if (Number.isNaN(date.getTime())) return '';
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    async function showAt(lat, lon, placeName = 'Selected place', imageUrl, workersData) {
        if (!map) return;
        clearCommonsAutoSwipe();

        activePopup = L.popup({
            maxWidth: 760,
            className: 'place-insights-popup',
        })
            .setLatLng([lat, lon])
            .setContent(renderLoading(placeName, lat, lon))
            .openOn(map);

        const [weatherResult, aqiResult, populationResult, commonsResult] = await Promise.allSettled([
            fetchWeather(lat, lon),
            fetchAqi(lat, lon),
            fetchPopulationDensity(lat, lon),
            fetchCommonsImages(lat, lon),
        ]);

        const weather = weatherResult.status === 'fulfilled' ? weatherResult.value : null;
        const aqi = aqiResult.status === 'fulfilled' ? aqiResult.value : null;
        const population = populationResult.status === 'fulfilled' ? populationResult.value : null;
        const commonsImages = commonsResult.status === 'fulfilled' ? commonsResult.value : [];
        
        let workers = [];
        try {
            if (workersData) workers = JSON.parse(decodeURIComponent(workersData));
        } catch(e) {}

        activePopup.setContent(renderInsights(placeName, lat, lon, weather, aqi, population, commonsImages, imageUrl, workers));
        startCommonsAutoSwipe();
    }

    async function showWeatherOnly(lat, lon, placeName = 'Selected place') {
        if (!map) return;
        clearCommonsAutoSwipe();

        activePopup = L.popup({
            maxWidth: 280,
            className: 'weather-popup',
        })
            .setLatLng([lat, lon])
            .setContent(renderWeatherOnlyLoading(placeName, lat, lon))
            .openOn(map);

        try {
            const current = await fetchWeather(lat, lon);
            activePopup.setContent(renderWeatherOnly(placeName, lat, lon, current));
        } catch (_err) {
            activePopup.setContent(renderWeatherOnlyError(placeName, lat, lon));
        }
    }

    async function fetchWeather(lat, lon) {
        const params = new URLSearchParams({
            latitude: String(lat),
            longitude: String(lon),
            current: 'temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,wind_speed_10m,weather_code',
            timezone: 'auto',
        });

        const url = `https://api.open-meteo.com/v1/forecast?${params.toString()}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Open-Meteo request failed (${res.status})`);

        const data = await res.json();
        if (!data?.current) throw new Error('No weather data returned');
        return data.current;
    }

    async function fetchAqi(lat, lon) {
        const res = await fetch(`${API_BASE}/api/aqi?lat=${lat}&lon=${lon}&radius=25000`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data.error) throw new Error(data.error || 'AQI unavailable');
        return data;
    }

    async function fetchPopulationDensity(lat, lon) {
        const res = await fetch(`${API_BASE}/api/datasets/population-density?lat=${lat}&lon=${lon}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data.error) throw new Error(data.error || 'Population density unavailable');
        return data;
    }

    async function fetchCommonsImages(lat, lon) {
        const res = await fetch(`${API_BASE}/api/commons?lat=${lat}&lon=${lon}&radius=10000&limit=6`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data.error) throw new Error(data.error || 'Commons images unavailable');
        return Array.isArray(data.images) ? data.images : [];
    }

    function renderLoading(placeName, lat, lon) {
        return `
            <div class="insights-popup-card">
                <div class="insights-place">${escapeHtml(placeName.split(',')[0])}</div>
                <div class="insights-place-sub">${escapeHtml(placeName)}</div>
                <div class="insights-panels">
                    <div class="insights-panel insights-commons-panel">
                        <div class="insights-panel-title">Images</div>
                        <div class="insights-skeleton-box"></div>
                        <div class="insights-skeleton-line"></div>
                    </div>
                    <div class="insights-panel">
                        <div class="insights-panel-title">Weather</div>
                        <div class="insights-skeleton-value"></div>
                        <div class="insights-skeleton-line"></div>
                        <div class="insights-skeleton-grid">
                            <div class="insights-skeleton-line"></div>
                            <div class="insights-skeleton-line"></div>
                            <div class="insights-skeleton-line"></div>
                            <div class="insights-skeleton-line"></div>
                        </div>
                        <div class="insights-skeleton-line"></div>
                    </div>
                    <div class="insights-panel">
                        <div class="insights-panel-title">AQI</div>
                        <div class="insights-skeleton-value"></div>
                        <div class="insights-skeleton-line"></div>
                        <div class="insights-skeleton-line"></div>
                        <div class="insights-skeleton-line"></div>
                    </div>
                </div>
                <div class="weather-coords">${lat.toFixed(5)}, ${lon.toFixed(5)}</div>
            </div>
        `;
    }

    function renderWeatherOnlyLoading(placeName, lat, lon) {
        return `
            <div class="weather-popup-card">
                <div class="weather-place">${escapeHtml(placeName.split(',')[0])}</div>
                <div class="weather-place-sub">${escapeHtml(placeName)}</div>
                <div class="insights-skeleton-value"></div>
                <div class="insights-skeleton-line"></div>
                <div class="insights-skeleton-grid">
                    <div class="insights-skeleton-line"></div>
                    <div class="insights-skeleton-line"></div>
                    <div class="insights-skeleton-line"></div>
                    <div class="insights-skeleton-line"></div>
                </div>
                <div class="weather-coords">${lat.toFixed(5)}, ${lon.toFixed(5)}</div>
            </div>
        `;
    }

    function renderWeatherOnlyError(placeName, lat, lon) {
        return `
            <div class="weather-popup-card">
                <div class="weather-place">${escapeHtml(placeName.split(',')[0])}</div>
                <div class="weather-place-sub">${escapeHtml(placeName)}</div>
                <div class="weather-status error">Unable to load weather right now.</div>
                <div class="weather-coords">${lat.toFixed(5)}, ${lon.toFixed(5)}</div>
            </div>
        `;
    }

    function renderWeatherOnly(placeName, lat, lon, current) {
        const code = Number(current.weather_code);
        return `
            <div class="weather-popup-card">
                <div class="weather-place">${escapeHtml(placeName.split(',')[0])}</div>
                <div class="weather-place-sub">${escapeHtml(placeName)}</div>
                <div class="weather-main">
                    <div class="weather-temp">${Math.round(current.temperature_2m)}°C</div>
                    <div class="weather-cond">${weatherText(code)}</div>
                </div>
                <div class="weather-grid">
                    <div class="weather-metric"><span>Feels</span><strong>${Math.round(current.apparent_temperature)}°C</strong></div>
                    <div class="weather-metric"><span>Humidity</span><strong>${current.relative_humidity_2m}%</strong></div>
                    <div class="weather-metric"><span>Wind</span><strong>${Math.round(current.wind_speed_10m)} km/h</strong></div>
                    <div class="weather-metric"><span>Rain</span><strong>${current.precipitation} mm</strong></div>
                </div>
                <div class="weather-updated">Updated ${formatTime(current.time)}</div>
                <div class="weather-coords">${lat.toFixed(5)}, ${lon.toFixed(5)}</div>
            </div>
        `;
    }

    function renderInsights(placeName, lat, lon, weather, aqi, population, commonsImages, imageUrl, workers) {
        if (imageUrl && !imageUrl.includes('no-mandir-image')) {
            commonsImages.unshift({
                title: placeName,
                thumbnail: imageUrl,
                pageUrl: imageUrl,
                source: 'Mandir Data'
            });
        }

        const weatherHtml = weather
            ? renderWeatherPanel(weather, population)
            : '<div class="weather-status error">Weather unavailable</div>';
        const aqiHtml = aqi
            ? renderAqiPanel(aqi)
            : '<div class="weather-status error">AQI unavailable</div>';
        const commonsHtml = renderCommonsSection(commonsImages);
        
        // Build workers HTML if present
        let workersHtml = '';
        if (workers && workers.length > 0) {
            let workersList = workers.map(w => `
                <div class="insights-aqi-row" style="background:var(--bg-hover); padding:6px 10px; border-radius:var(--radius-sm); border:1px solid var(--border-color); margin-bottom:6px; display:block;">
                    <div style="font-size:13px; font-weight:600; color:var(--text-primary);">${escapeHtml(String(w.f2 || 'Unknown'))}</div>
                    ${w.f3 ? `<div style="font-size:11px; color:var(--accent-cyan); margin-top:2px;">📞 ${escapeHtml(String(w.f3))}</div>` : ''}
                </div>
            `).join('');
            
            workersHtml = `
                <div class="insights-panels" style="margin-top:0; border-top:1px dashed var(--border-color); grid-template-columns: 1fr;">
                    <div class="insights-panel">
                        <div class="insights-panel-title">Worker Details</div>
                        <div style="margin-top:8px;">${workersList}</div>
                    </div>
                </div>
            `;
        }

        return `
            <div class="insights-popup-card">
                <div class="insights-place">${escapeHtml(placeName.split(',')[0])}</div>
                <div class="insights-place-sub">${escapeHtml(placeName)}</div>
                <div class="insights-panels">
                    <div class="insights-panel insights-commons-panel">
                        <div class="insights-panel-title">Images</div>
                        ${commonsHtml}
                    </div>
                    <div class="insights-panel">
                        <div class="insights-panel-title">Weather</div>
                        ${weatherHtml}
                    </div>
                    <div class="insights-panel">
                        <div class="insights-panel-title">AQI</div>
                        ${aqiHtml}
                    </div>
                </div>
                ${workersHtml}
                <div class="weather-coords">${lat.toFixed(5)}, ${lon.toFixed(5)}</div>
            </div>
        `;
    }

    function renderCommonsSection(images) {
        if (!images || images.length === 0) {
            return '<div class="weather-status">No nearby monument/historical/public-building images found.</div>';
        }

        const slides = images.slice(0, 6).map((img, index) => {
            const title = escapeHtml((img.title || '').replace(/^File:/i, ''));
            const thumb = escapeHtml(img.thumbnail || '');
            const href = escapeHtml(img.pageUrl || '#');
            const source = escapeHtml(img.source || 'image');

            return `
                <a class="insights-commons-slide${index === 0 ? ' is-active' : ''}" data-slide-index="${index}" href="${href}" target="_blank" rel="noopener noreferrer">
                    <img src="${thumb}" alt="${title}" loading="lazy" />
                    <span class="insights-commons-caption">${title} · ${source}</span>
                </a>
            `;
        }).join('');

        const dots = images.length > 1
            ? `<div class="insights-commons-dots">${images.slice(0, 6).map((_, index) => `<button type="button" class="insights-commons-dot${index === 0 ? ' is-active' : ''}" data-dot-index="${index}" aria-label="Image ${index + 1}"></button>`).join('')}</div>`
            : '';

        return `<div class="insights-commons-grid"><div class="insights-commons-carousel">${slides}</div>${dots}</div>`;
    }

    function clearCommonsAutoSwipe() {
        if (commonsSwipeTimer) {
            clearInterval(commonsSwipeTimer);
            commonsSwipeTimer = null;
        }
    }

    function startCommonsAutoSwipe() {
        clearCommonsAutoSwipe();
        if (!activePopup || typeof activePopup.getElement !== 'function') return;

        const popupEl = activePopup.getElement();
        if (!popupEl) return;

        const slides = Array.from(popupEl.querySelectorAll('.insights-commons-slide'));
        const dots = Array.from(popupEl.querySelectorAll('.insights-commons-dot'));

        if (slides.length <= 1) return;

        let currentIndex = 0;
        const activate = (nextIndex) => {
            currentIndex = nextIndex;
            slides.forEach((slide, index) => {
                slide.classList.toggle('is-active', index === currentIndex);
            });
            dots.forEach((dot, index) => {
                dot.classList.toggle('is-active', index === currentIndex);
            });
        };

        dots.forEach((dot, index) => {
            dot.addEventListener('click', () => {
                activate(index);
            });
        });

        commonsSwipeTimer = setInterval(() => {
            const nextIndex = (currentIndex + 1) % slides.length;
            activate(nextIndex);
        }, 3500);
    }

    function renderWeatherPanel(current, population) {
        const code = Number(current.weather_code);
        const densityValue = Number(population?.density_per_km2);
        const densityText = Number.isFinite(densityValue)
            ? `${Math.round(densityValue).toLocaleString()} ${escapeHtml(population.unit || 'people/km²')}`
            : 'Unavailable';

        return `
            <div class="insights-main-value">${Math.round(current.temperature_2m)}°C</div>
            <div class="insights-sub-value">${weatherText(code)}</div>
            <div class="insights-grid">
                <div class="insights-metric"><span>Feels</span><strong>${Math.round(current.apparent_temperature)}°C</strong></div>
                <div class="insights-metric"><span>Humidity</span><strong>${current.relative_humidity_2m}%</strong></div>
                <div class="insights-metric"><span>Wind</span><strong>${Math.round(current.wind_speed_10m)} km/h</strong></div>
                <div class="insights-metric"><span>Rain</span><strong>${current.precipitation} mm</strong></div>
            </div>
            <div class="weather-updated">Updated ${formatTime(current.time)}</div>
            <div class="insights-pop-density">
                <div class="insights-pop-heading">POPULATION</div>
                <div class="insights-pop-value insights-main-value">${densityText}</div>
            </div>
        `;
    }

    function renderAqiPanel(aqi) {
        const pollutants = Array.isArray(aqi.pollutants) ? aqi.pollutants : [];
        const rows = pollutants.slice(0, 4).map(p => {
            const value = Number.isFinite(Number(p.value))
                ? Number(p.value).toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1')
                : '--';
            return `
                <div class="insights-aqi-row">
                    <span class="insights-aqi-name">${escapeHtml(p.label || p.key || '--')}</span>
                    <strong class="insights-aqi-value">${value}${p.unit ? ` ${escapeHtml(p.unit)}` : ''}</strong>
                    <span class="insights-aqi-trend">${renderSparkline(Array.isArray(p.trend) ? p.trend : [])}</span>
                </div>
            `;
        }).join('');

        return `
            <div class="insights-main-value">AQI ${aqi.aqi}</div>
            <div class="insights-sub-value">${escapeHtml(aqi.category || 'Unknown')}</div>
            <div class="insights-aqi-list">${rows}</div>
            ${aqi.observed_at ? `<div class="weather-updated">Observed ${new Date(aqi.observed_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>` : ''}
        `;
    }

    function renderSparkline(values) {
        if (!Array.isArray(values) || values.length < 2) {
            return '<span class="insights-no-trend">—</span>';
        }

        const width = 74;
        const height = 20;
        const min = Math.min(...values);
        const max = Math.max(...values);
        const range = max - min || 1;

        const points = values.map((value, index) => {
            const x = (index / (values.length - 1)) * (width - 2) + 1;
            const y = height - 1 - ((value - min) / range) * (height - 4) - 1;
            return `${x.toFixed(1)},${y.toFixed(1)}`;
        }).join(' ');

        return `
            <svg viewBox="0 0 ${width} ${height}" class="insights-sparkline" aria-hidden="true" preserveAspectRatio="none">
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

    return { init, showAt, showWeatherOnly };
})();
