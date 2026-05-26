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
- `arcgis_toolbox/SeismicNavigator.pyt` - ArcGIS Pro Python toolbox (master toolbox)
- `arcgis_toolbox/tools/` - individual tool modules imported by the master toolbox

## ArcGIS Pro toolbox

A consolidated Python toolbox for ArcGIS Pro is provided in `arcgis_toolbox/`.
It exposes the following tools directly from the Geoprocessing pane:

| Tool | Description |
|------|-------------|
| **GeoPDF to Raster** | Convert a georeferenced GeoPDF to PNG and extract WGS-84 bounds (requires GDAL on PATH). |
| **Offline Tile Downloader** | Download Esri imagery/topo basemap tiles for a selected extent and zoom range for offline use. |

See [`arcgis_toolbox/README.md`](arcgis_toolbox/README.md) for setup instructions
and guidance on adding more tools.

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
