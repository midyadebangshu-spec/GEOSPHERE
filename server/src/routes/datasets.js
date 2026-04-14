const path = require('path');
const fs = require('fs');
const express = require('express');
const GeoTIFF = require('geotiff');

const router = express.Router();
const tifPath = path.join(__dirname, '../../../ind_pd_2020_1km_UNadj.tif');

let tifCachePromise = null;

function loadTifCache() {
    if (!tifCachePromise) {
        tifCachePromise = (async () => {
            const tiff = await GeoTIFF.fromFile(tifPath);
            const image = await tiff.getImage();
            const bbox = image.getBoundingBox();
            const width = image.getWidth();
            const height = image.getHeight();
            const noData = image.getGDALNoData();

            return { image, bbox, width, height, noData };
        })();
    }
    return tifCachePromise;
}

function isValidLatLon(lat, lon) {
    return Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
}

router.get('/population-density.tif', (req, res) => {
    const filePath = tifPath;

    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Population density TIFF not found.' });
    }

    return res.sendFile(filePath);
});

router.get('/population-density', async (req, res, next) => {
    try {
        const lat = Number.parseFloat(req.query.lat);
        const lon = Number.parseFloat(req.query.lon);

        if (!isValidLatLon(lat, lon)) {
            return res.status(400).json({ error: 'Invalid coordinates. Required: lat, lon.' });
        }

        if (!fs.existsSync(tifPath)) {
            return res.status(404).json({ error: 'Population density TIFF not found.' });
        }

        const { image, bbox, width, height, noData } = await loadTifCache();
        const [minX, minY, maxX, maxY] = bbox;

        if (lon < minX || lon > maxX || lat < minY || lat > maxY) {
            return res.status(404).json({ error: 'Location outside population density raster extent.' });
        }

        const xRes = (maxX - minX) / width;
        const yRes = (maxY - minY) / height;

        const px = Math.min(width - 1, Math.max(0, Math.floor((lon - minX) / xRes)));
        const py = Math.min(height - 1, Math.max(0, Math.floor((maxY - lat) / yRes)));

        const raster = await image.readRasters({ window: [px, py, px + 1, py + 1], width: 1, height: 1 });
        const value = Number(raster?.[0]?.[0]);

        const noDataValue = noData == null ? null : Number(noData);
        if (!Number.isFinite(value) || value < 0 || (Number.isFinite(noDataValue) && value === noDataValue)) {
            return res.status(404).json({ error: 'Population density unavailable at this location.' });
        }

        return res.json({
            lat,
            lon,
            density_per_km2: Math.round(value * 100) / 100,
            unit: 'people/km²',
        });
    } catch (err) {
        return next(err);
    }
});

module.exports = router;
