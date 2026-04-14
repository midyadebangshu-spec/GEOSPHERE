const express = require('express');

const router = express.Router();

const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
const FLICKR_API = 'https://www.flickr.com/services/rest/';
const MATCH_KEYWORDS = [
    'monument', 'historic', 'historical', 'heritage', 'public building',
    'government building', 'town hall', 'palace', 'fort', 'memorial',
    'museum', 'statue', 'clock tower',
];
const CACHE_TTL_MS = 10 * 60 * 1000;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 40;

const responseCache = new Map();
const requestBuckets = new Map();

function toNumber(value, fallback) {
    const num = Number(value);
    return Number.isFinite(num) ? num : fallback;
}

function isValidLatLon(lat, lon) {
    return Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
}

function includesKeyword(text) {
    const normalized = String(text || '').toLowerCase();
    return MATCH_KEYWORDS.some(keyword => normalized.includes(keyword));
}

function clientKey(req) {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.trim()) {
        return forwarded.split(',')[0].trim();
    }
    return req.ip || 'unknown';
}

function isRateLimited(req) {
    const key = clientKey(req);
    const now = Date.now();
    const bucket = requestBuckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
        requestBuckets.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
        return { limited: false, retryAfterSeconds: 0 };
    }

    if (bucket.count >= RATE_LIMIT_MAX) {
        return {
            limited: true,
            retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
        };
    }

    bucket.count += 1;
    return { limited: false, retryAfterSeconds: 0 };
}

function cacheKey(lat, lon, radius, limit) {
    return `${lat.toFixed(4)}:${lon.toFixed(4)}:${radius}:${limit}`;
}

function getCached(key) {
    const hit = responseCache.get(key);
    if (!hit) return null;
    if (hit.expiresAt <= Date.now()) {
        responseCache.delete(key);
        return null;
    }
    return hit.payload;
}

function setCached(key, payload) {
    responseCache.set(key, {
        expiresAt: Date.now() + CACHE_TTL_MS,
        payload,
    });
}

async function fetchWikimediaImages(lat, lon, radius) {
    const searchParams = new URLSearchParams({
        action: 'query',
        format: 'json',
        list: 'geosearch',
        gscoord: `${lat}|${lon}`,
        gsradius: String(radius),
        gslimit: '50',
        origin: '*',
    });

    const searchRes = await fetch(`${COMMONS_API}?${searchParams.toString()}`);
    const searchData = await searchRes.json().catch(() => ({}));

    const geosearch = Array.isArray(searchData?.query?.geosearch) ? searchData.query.geosearch : [];
    if (geosearch.length === 0) {
        return [];
    }

    const pageIds = geosearch.map(item => item.pageid).filter(Boolean);
    const distanceById = new Map(geosearch.map(item => [item.pageid, item.dist]));

    const pageParams = new URLSearchParams({
        action: 'query',
        format: 'json',
        pageids: pageIds.join('|'),
        prop: 'pageimages|info|categories|description',
        inprop: 'url',
        pithumbsize: '900',
        pilicense: 'any',
        cllimit: 'max',
        origin: '*',
    });

    const pageRes = await fetch(`${COMMONS_API}?${pageParams.toString()}`);
    const pageData = await pageRes.json().catch(() => ({}));
    const pagesObj = pageData?.query?.pages || {};
    const pages = Object.values(pagesObj);

    const withThumb = pages.filter(page => !!page?.thumbnail?.source);

    const toImage = (page) => ({
        source: 'wikimedia',
        title: page.title || 'Untitled',
        description: page.description || '',
        thumbnail: page.thumbnail?.source || null,
        pageUrl: page.fullurl || null,
        distance_m: distanceById.get(page.pageid) ?? null,
    });

    const nearbyByDistance = withThumb
        .map(toImage)
        .sort((a, b) => (a.distance_m ?? Number.MAX_SAFE_INTEGER) - (b.distance_m ?? Number.MAX_SAFE_INTEGER));

    return nearbyByDistance;
}

async function fetchFlickrImages(lat, lon, radiusMeters) {
    const apiKey = process.env.FLICKR_API_KEY;
    if (!apiKey) return [];

    const radiusKm = Math.max(1, Math.min(32, Math.round(radiusMeters / 1000)));
    const params = new URLSearchParams({
        method: 'flickr.photos.search',
        api_key: apiKey,
        lat: String(lat),
        lon: String(lon),
        radius: String(radiusKm),
        radius_units: 'km',
        per_page: '30',
        page: '1',
        format: 'json',
        nojsoncallback: '1',
        content_type: '1',
        media: 'photos',
        safe_search: '1',
        sort: 'relevance',
        extras: 'description,tags,url_l,url_c,url_m,owner_name,geo',
        text: 'monument historic heritage memorial museum palace fort public building government building statue landmark',
    });

    const response = await fetch(`${FLICKR_API}?${params.toString()}`);
    const data = await response.json().catch(() => ({}));
    const photos = Array.isArray(data?.photos?.photo) ? data.photos.photo : [];

    const withThumb = photos.filter(item => !!(item.url_l || item.url_c || item.url_m));
    const toImage = (item) => ({
        source: 'flickr',
        title: item.title || 'Untitled',
        description: item.description?._content || '',
        thumbnail: item.url_l || item.url_c || item.url_m || null,
        pageUrl: item.owner && item.id ? `https://www.flickr.com/photos/${item.owner}/${item.id}` : null,
        distance_m: null,
    });

    const keywordMatched = withThumb
        .filter((item) => {
            const title = item.title || '';
            const description = item.description?._content || '';
            const tags = item.tags || '';
            return includesKeyword(`${title} ${description} ${tags}`);
        })
        .map(toImage);

    if (keywordMatched.length >= 4) {
        return keywordMatched;
    }

    return withThumb.map(toImage);
}

function mergeImages(wikimediaImages, flickrImages, limit) {
    const seen = new Set();
    const merged = [...wikimediaImages, ...flickrImages].filter((item) => {
        const key = item.pageUrl || item.thumbnail;
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
    });

    merged.sort((a, b) => {
        const distA = Number.isFinite(a.distance_m) ? a.distance_m : Number.MAX_SAFE_INTEGER;
        const distB = Number.isFinite(b.distance_m) ? b.distance_m : Number.MAX_SAFE_INTEGER;
        return distA - distB;
    });

    return merged.slice(0, limit);
}

router.get('/', async (req, res, next) => {
    try {
        const lat = toNumber(req.query.lat, null);
        const lon = toNumber(req.query.lon, null);
        const radius = Math.max(100, Math.min(10000, toNumber(req.query.radius, 4000)));
        const limit = Math.max(1, Math.min(12, toNumber(req.query.limit, 6)));

        if (!isValidLatLon(lat, lon)) {
            return res.status(400).json({ error: 'Invalid coordinates. Required: lat, lon.' });
        }

        const throttle = isRateLimited(req);
        if (throttle.limited) {
            res.setHeader('Retry-After', String(throttle.retryAfterSeconds));
            return res.status(429).json({ error: 'Too many image requests. Try again shortly.' });
        }

        const key = cacheKey(lat, lon, radius, limit);
        const cached = getCached(key);
        if (cached) {
            return res.json(cached);
        }

        const [wikimediaImages, flickrImages] = await Promise.all([
            fetchWikimediaImages(lat, lon, radius).catch(() => []),
            fetchFlickrImages(lat, lon, radius).catch(() => []),
        ]);

        const images = mergeImages(wikimediaImages, flickrImages, limit);
        const payload = {
            images,
            sources: {
                wikimedia: wikimediaImages.length,
                flickr: flickrImages.length,
            },
        };

        setCached(key, payload);
        return res.json(payload);
    } catch (err) {
        return next(err);
    }
});

module.exports = router;
