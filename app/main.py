from __future__ import annotations

import json
import subprocess
from pathlib import Path
from uuid import uuid4

import httpx
import mercantile
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

ROOT_DIR = Path(__file__).resolve().parents[1]
STATIC_DIR = ROOT_DIR / "static"
DATA_DIR = ROOT_DIR / "data"
GEOPDF_DIR = DATA_DIR / "geopdf"
TILE_CACHE_DIR = DATA_DIR / "tile_cache"

for path in (DATA_DIR, GEOPDF_DIR, TILE_CACHE_DIR):
    path.mkdir(parents=True, exist_ok=True)

ESRI_PROVIDERS = {
    "imagery": "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    "topo": "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}",
}
MAX_TILES_TO_DOWNLOAD = 4000

app = FastAPI(title="SeismicNavigator", version="1.0.0")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
app.mount("/data", StaticFiles(directory=DATA_DIR), name="data")


class OfflineDownloadRequest(BaseModel):
    provider: str = Field(pattern="^(imagery|topo)$")
    west: float = Field(ge=-180, le=180)
    south: float = Field(ge=-85.0511, le=85.0511)
    east: float = Field(ge=-180, le=180)
    north: float = Field(ge=-85.0511, le=85.0511)
    min_zoom: int = Field(ge=0, le=19)
    max_zoom: int = Field(ge=0, le=19)


@app.get("/")
async def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


def _run_command(command: list[str]) -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(command, capture_output=True, text=True, check=False)
    except FileNotFoundError as exc:
        return subprocess.CompletedProcess(command, returncode=127, stdout="", stderr=str(exc))


def _parse_bounds_from_gdalinfo(gdal_info: dict) -> list[list[float]]:
    if "wgs84Extent" not in gdal_info:
        raise ValueError("wgs84Extent not present in gdalinfo output")

    coordinates = gdal_info["wgs84Extent"]["coordinates"]
    if not coordinates or not coordinates[0]:
        raise ValueError("wgs84Extent coordinates are empty")

    ring = coordinates[0]
    longitudes = [coord[0] for coord in ring]
    latitudes = [coord[1] for coord in ring]
    west, east = min(longitudes), max(longitudes)
    south, north = min(latitudes), max(latitudes)
    return [[south, west], [north, east]]


@app.post("/api/upload/geopdf")
async def upload_geopdf(file: UploadFile = File(...)) -> dict:
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Upload must be a .pdf file.")

    asset_id = str(uuid4())
    source_pdf = GEOPDF_DIR / f"{asset_id}.pdf"
    output_png = GEOPDF_DIR / f"{asset_id}.png"

    source_pdf.write_bytes(await file.read())

    gdal_info_result = _run_command(["gdalinfo", "-json", str(source_pdf)])
    if gdal_info_result.returncode != 0:
        source_pdf.unlink(missing_ok=True)
        raise HTTPException(
            status_code=400,
            detail={
                "message": "Unable to read GeoPDF georeferencing metadata. Ensure GDAL with PDF support is installed.",
                "fallback": "Preprocess the GeoPDF with gdal_translate on desktop and retry on Android/Termux.",
                "stderr": gdal_info_result.stderr.strip(),
            },
        )

    try:
        gdal_info = json.loads(gdal_info_result.stdout)
        bounds = _parse_bounds_from_gdalinfo(gdal_info)
    except (json.JSONDecodeError, ValueError) as exc:
        source_pdf.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail=f"GeoPDF metadata parse failed: {exc}") from exc

    convert_result = _run_command(["gdal_translate", "-of", "PNG", str(source_pdf), str(output_png)])
    if convert_result.returncode != 0 or not output_png.exists():
        source_pdf.unlink(missing_ok=True)
        output_png.unlink(missing_ok=True)
        raise HTTPException(
            status_code=400,
            detail={
                "message": "GeoPDF conversion failed.",
                "fallback": "Install gdal-bin/poppler in Termux or preprocess to a georeferenced raster before upload.",
                "stderr": convert_result.stderr.strip(),
            },
        )

    return {
        "id": asset_id,
        "image_url": f"/data/geopdf/{asset_id}.png",
        "bounds": bounds,
        "metadata": {
            "driver": gdal_info.get("driverShortName"),
            "size": gdal_info.get("size"),
        },
    }


@app.post("/api/offline/download")
async def download_offline_tiles(request: OfflineDownloadRequest) -> dict:
    if request.min_zoom > request.max_zoom:
        raise HTTPException(status_code=400, detail="min_zoom cannot be greater than max_zoom")
    if request.west >= request.east or request.south >= request.north:
        raise HTTPException(status_code=400, detail="Bounding box is invalid")

    provider_url = ESRI_PROVIDERS[request.provider]
    provider_dir = TILE_CACHE_DIR / request.provider
    provider_dir.mkdir(parents=True, exist_ok=True)

    zoom_levels = range(request.min_zoom, request.max_zoom + 1)
    requested_tile_count = sum(1 for _ in mercantile.tiles(request.west, request.south, request.east, request.north, zoom_levels))
    if requested_tile_count > MAX_TILES_TO_DOWNLOAD:
        raise HTTPException(
            status_code=400,
            detail=f"Requested {requested_tile_count} tiles, which exceeds limit of {MAX_TILES_TO_DOWNLOAD}. Reduce area or zoom range.",
        )

    downloaded = 0
    skipped = 0
    failed = 0

    timeout = httpx.Timeout(20.0)
    async with httpx.AsyncClient(timeout=timeout) as client:
        for tile in mercantile.tiles(request.west, request.south, request.east, request.north, zoom_levels):
            destination = provider_dir / str(tile.z) / str(tile.x)
            destination.mkdir(parents=True, exist_ok=True)
            tile_file = destination / f"{tile.y}.png"

            if tile_file.exists():
                skipped += 1
                continue

            tile_url = provider_url.format(z=tile.z, x=tile.x, y=tile.y)
            try:
                response = await client.get(tile_url)
                if response.status_code == 200:
                    tile_file.write_bytes(response.content)
                    downloaded += 1
                else:
                    failed += 1
            except httpx.HTTPError:
                failed += 1

    return {
        "provider": request.provider,
        "requested": requested_tile_count,
        "downloaded": downloaded,
        "skipped": skipped,
        "failed": failed,
        "cache_url_template": f"/api/tiles/{request.provider}/{{z}}/{{x}}/{{y}}.png",
    }


@app.get("/api/tiles/{provider}/{z}/{x}/{y}.png")
async def get_cached_tile(provider: str, z: int, x: int, y: int) -> FileResponse:
    if provider not in ESRI_PROVIDERS:
        raise HTTPException(status_code=404, detail="Unsupported provider")

    tile_file = TILE_CACHE_DIR / provider / str(z) / str(x) / f"{y}.png"
    if not tile_file.exists():
        raise HTTPException(status_code=404, detail="Tile not found in local cache")
    return FileResponse(tile_file)
