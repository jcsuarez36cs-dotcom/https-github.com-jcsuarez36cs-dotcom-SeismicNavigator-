# SeismicNavigator

Mobile-friendly web GIS application for Android local testing.

## Features implemented

- **Core app**: FastAPI backend + static Leaflet frontend, runnable locally (no Docker required).
- **GeoPDF upload**: Upload ArcGIS Pro GeoPDF, extract georeferencing using GDAL (`gdalinfo`), convert to PNG (`gdal_translate`), and place on map using extracted bounds.
- **Shapefile upload**: Upload zipped shapefile (`.zip` with `.shp/.shx/.dbf/.prj`) and display as GeoJSON.
- **Drawing/editing**: Draw, edit, and delete point/line/polygon features via Leaflet.Draw.
- **Export**: Export map vector data to GeoJSON and KMZ.
- **Basemaps**: Esri Imagery and Esri Topo basemaps (online).
- **Offline mode option A**: Pre-download selected map extent + zoom range into local tile cache and switch map to offline cached tiles.
- **Mobile UX**: Control panel and map layout optimized for Android phone viewport.

## Project structure

- `app/main.py` - FastAPI server APIs and tile cache/GeoPDF endpoints
- `static/index.html` - mobile UI and map layout
- `static/app.js` - map logic (uploads, draw/edit, export, offline cache requests)
- `static/styles.css` - responsive styles

## Local run (Linux/macOS/Android Termux)

### 1) Install system dependencies

GeoPDF georeferencing requires GDAL with PDF support:

- Linux (Debian/Ubuntu):
  ```bash
  sudo apt update
  sudo apt install -y gdal-bin
  ```
- Android (Termux): install Python and GDAL from Termux repos/packages as available on your device. If your Termux build lacks GDAL PDF support, preprocess GeoPDF on desktop (see limitations).

### 2) Create venv and install Python deps

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 3) Run server

```bash
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

### 4) Open app

- Same device browser: `http://127.0.0.1:8000`
- Android phone over LAN from another machine: `http://<machine-ip>:8000`

## Usage workflow

1. Choose basemap (imagery/topo, online or offline cache).
2. (Optional offline prep) Pan/zoom to area, set zoom range, click **Download tiles**.
3. Upload ArcGIS Pro GeoPDF and verify georeferenced overlay placement.
4. Upload zipped shapefile.
5. Draw/edit/delete features.
6. Export merged vector data to GeoJSON or KMZ.

## GeoPDF handling constraints and fallback

- GeoPDF placement depends on `gdalinfo` reading georeferencing metadata (`wgs84Extent`) and `gdal_translate` rendering a raster image.
- If GDAL/PDF support is unavailable on Android Termux, the API returns a clear error and fallback guidance.
- Practical fallback: preprocess GeoPDF on a desktop with GDAL, then run the app on Android for viewing/editing/export workflows.

Example desktop preprocess command:

```bash
gdal_translate -of PNG input_georef.pdf output.png
```

## Offline basemap notes (Esri)

- Offline cache endpoint stores tiles under `data/tile_cache/<provider>/<z>/<x>/<y>.png`.
- Large cache requests are restricted (`MAX_TILES_TO_DOWNLOAD=4000`) to keep local runs stable.
- Use Esri services in compliance with Esri terms of use and attribution requirements.

## Data persistence

- Uploaded GeoPDF rasters are stored in `data/geopdf/`.
- Offline tiles are stored in `data/tile_cache/`.
- Drawn/shapefile features are managed client-side and exported on demand.

## Deploy server online (Render)

1. Push this repository to GitHub.
2. In Render, create a **Web Service** connected to this repo.
3. Use:
   - Build command: `pip install -r requirements.txt`
   - Start command: `uvicorn app.main:app --host 0.0.0.0 --port 10000`
4. (Optional) Set `PORT=10000`.
5. Deploy and open the public URL to verify the app loads.

## PWA support added in this repo

- `static/manifest.webmanifest`
- `static/sw.js`
- `static/icons/icon-192.png`
- `static/icons/icon-512.png`
- PWA metadata in `static/index.html`
- Service worker registration in `static/app.js`
- Root routes for `/manifest.webmanifest` and `/sw.js` in `app/main.py`

## Step-by-step: add the code lines one at a time

### 1) Add PWA lines to `static/index.html` `<head>`

Add line 1:

```html
<meta name="theme-color" content="#0f172a" />
```

Add line 2:

```html
<meta name="apple-mobile-web-app-capable" content="yes" />
```

Add line 3:

```html
<meta name="apple-mobile-web-app-status-bar-style" content="default" />
```

Add line 4:

```html
<meta name="apple-mobile-web-app-title" content="SeismicNavigator" />
```

Add line 5:

```html
<link rel="manifest" href="/manifest.webmanifest" />
```

Add line 6:

```html
<link rel="apple-touch-icon" href="/static/icons/icon-192.png" />
```

Add line 7:

```html
<link rel="icon" type="image/png" sizes="192x192" href="/static/icons/icon-192.png" />
```

### 2) Add service worker registration to `static/app.js` (bottom of file)

Add line 1:

```javascript
if ("serviceWorker" in navigator) {
```

Add line 2:

```javascript
  window.addEventListener("load", () => {
```

Add line 3:

```javascript
    navigator.serviceWorker.register("/sw.js").catch((error) => {
```

Add line 4:

```javascript
      console.error("Service worker registration failed:", error);
```

Add line 5:

```javascript
    });
```

Add line 6:

```javascript
  });
```

Add line 7:

```javascript
}
```

### 3) Add manifest file `static/manifest.webmanifest`

Paste this full file:

```json
{
  "name": "SeismicNavigator",
  "short_name": "SeismicNav",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "background_color": "#0f172a",
  "theme_color": "#0f172a",
  "description": "Mobile-friendly web GIS application with GeoPDF, shapefile, and offline tile workflows.",
  "icons": [
    {
      "src": "/static/icons/icon-192.png",
      "sizes": "192x192",
      "type": "image/png"
    },
    {
      "src": "/static/icons/icon-512.png",
      "sizes": "512x512",
      "type": "image/png"
    }
  ]
}
```

### 4) Add service worker file `static/sw.js`

Paste this full file:

```javascript
const CACHE_NAME = "seismicnavigator-v1";
const APP_SHELL_ASSETS = [
  "/",
  "/manifest.webmanifest",
  "/static/styles.css",
  "/static/app.js",
  "/static/icons/icon-192.png",
  "/static/icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") {
    return;
  }

  const isStaticAsset =
    request.url.includes("/static/") ||
    request.url.endsWith("/manifest.webmanifest") ||
    request.mode === "navigate";

  if (!isStaticAsset) {
    return;
  }

  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(request).then((networkResponse) => {
        if (
          !networkResponse ||
          networkResponse.status !== 200 ||
          (networkResponse.type !== "basic" && networkResponse.type !== "cors")
        ) {
          return networkResponse;
        }

        const responseClone = networkResponse.clone();
        event.waitUntil(
          caches
            .open(CACHE_NAME)
            .then((cache) => cache.put(request, responseClone))
            .catch(() => undefined)
        );
        return networkResponse;
      }).catch(() => {
        if (request.mode === "navigate") {
          return caches.match("/").then((response) => response || Response.error());
        }
        return Response.error();
      });
    })
  );
});
```

### 5) Add root PWA routes in `app/main.py`

Add:

```python
@app.get("/manifest.webmanifest")
async def manifest() -> FileResponse:
    return FileResponse(
        STATIC_DIR / "manifest.webmanifest",
        media_type="application/manifest+json",
        headers={"Cache-Control": "public, max-age=3600"},
    )


@app.get("/sw.js")
async def service_worker() -> FileResponse:
    return FileResponse(
        STATIC_DIR / "sw.js",
        media_type="application/javascript",
        headers={"Cache-Control": "no-cache"},
    )
```

## Install as app on phones

### Android (PWA)
1. Open deployed URL in Chrome.
2. Tap menu.
3. Tap **Install app** or **Add to Home Screen**.

### iPhone (PWA)
1. Open deployed URL in Safari.
2. Tap **Share**.
3. Tap **Add to Home Screen**.

## Create a shareable Android APK from the PWA

1. Deploy this app and verify PWA install works.
2. Open [PWABuilder](https://www.pwabuilder.com/).
3. Enter your deployed URL.
4. Build Android package.
5. Download APK (or Android Studio project) and share it.
