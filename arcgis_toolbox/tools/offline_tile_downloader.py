"""Offline Tile Downloader tool for SeismicNavigator.

Downloads Esri basemap tiles for a user-defined extent and zoom range into a
local folder so that the SeismicNavigator web app (or any other consumer) can
serve them without an internet connection.

The tool replicates the logic of the SeismicNavigator FastAPI endpoint
POST /api/offline/download, making the same workflow accessible directly
from the ArcGIS Pro Geoprocessing pane.
"""

from __future__ import annotations

import os
import urllib.request
import urllib.error

ESRI_PROVIDERS: dict[str, str] = {
    "imagery": (
        "https://server.arcgisonline.com/ArcGIS/rest/services/"
        "World_Imagery/MapServer/tile/{z}/{y}/{x}"
    ),
    "topo": (
        "https://server.arcgisonline.com/ArcGIS/rest/services/"
        "World_Topo_Map/MapServer/tile/{z}/{y}/{x}"
    ),
}

MAX_TILES = 4000


def _tiles(west: float, south: float, east: float, north: float,
           zoom_levels: range) -> list[tuple[int, int, int]]:
    """Return a list of (z, x, y) tile coordinates covering the given WGS-84 extent.

    Uses the standard Web Mercator slippy-map tile numbering scheme.
    """
    import math

    def _lon_to_x(lon: float, z: int) -> int:
        return int((lon + 180.0) / 360.0 * (1 << z))

    def _lat_to_y(lat: float, z: int) -> int:
        lat_r = math.radians(lat)
        return int((1.0 - math.log(math.tan(lat_r) + 1.0 / math.cos(lat_r)) / math.pi)
                   / 2.0 * (1 << z))

    result = []
    for z in zoom_levels:
        x_min = _lon_to_x(west, z)
        x_max = _lon_to_x(east, z)
        y_min = _lat_to_y(north, z)   # north → smaller y
        y_max = _lat_to_y(south, z)   # south → larger y
        for x in range(x_min, x_max + 1):
            for y in range(y_min, y_max + 1):
                result.append((z, x, y))
    return result


try:
    import arcpy  # type: ignore[import-untyped]

    class OfflineTileDownloader:
        """Download Esri basemap tiles for offline use in SeismicNavigator.

        Tiles are stored as PNG files under *Output Folder* using the layout::

            <output_folder>/<provider>/<z>/<x>/<y>.png

        which matches the SeismicNavigator tile-cache URL pattern
        ``/api/tiles/{provider}/{z}/{x}/{y}.png``.
        """

        def __init__(self) -> None:
            self.label = "Offline Tile Downloader"
            self.description = (
                "Downloads Esri basemap tiles (imagery or topo) for a "
                "specified extent and zoom range into a local folder for "
                "offline use with SeismicNavigator."
            )
            self.canRunInBackground = True

        def getParameterInfo(self) -> list:
            provider = arcpy.Parameter(
                displayName="Basemap Provider",
                name="provider",
                datatype="GPString",
                parameterType="Required",
                direction="Input",
            )
            provider.filter.type = "ValueList"
            provider.filter.list = list(ESRI_PROVIDERS.keys())
            provider.value = "imagery"

            extent = arcpy.Parameter(
                displayName="Download Extent",
                name="extent",
                datatype="GPExtent",
                parameterType="Required",
                direction="Input",
            )

            min_zoom = arcpy.Parameter(
                displayName="Minimum Zoom Level",
                name="min_zoom",
                datatype="GPLong",
                parameterType="Required",
                direction="Input",
            )
            min_zoom.value = 10

            max_zoom = arcpy.Parameter(
                displayName="Maximum Zoom Level",
                name="max_zoom",
                datatype="GPLong",
                parameterType="Required",
                direction="Input",
            )
            max_zoom.value = 14

            out_folder = arcpy.Parameter(
                displayName="Output Folder",
                name="out_folder",
                datatype="DEFolder",
                parameterType="Required",
                direction="Input",
            )

            return [provider, extent, min_zoom, max_zoom, out_folder]

        def isLicensed(self) -> bool:
            return True

        def updateParameters(self, parameters: list) -> None:
            pass

        def updateMessages(self, parameters: list) -> None:
            min_z = parameters[2].value
            max_z = parameters[3].value
            if min_z is not None and max_z is not None and min_z > max_z:
                parameters[3].setErrorMessage(
                    "Maximum Zoom Level must be ≥ Minimum Zoom Level."
                )

        def execute(self, parameters: list, messages) -> None:
            provider: str = parameters[0].valueAsText
            extent = parameters[1].value        # arcpy.Extent object
            min_zoom: int = int(parameters[2].value)
            max_zoom: int = int(parameters[3].value)
            out_folder: str = parameters[4].valueAsText

            if provider not in ESRI_PROVIDERS:
                messages.addErrorMessage(f"Unknown provider: {provider}")
                raise arcpy.ExecuteError

            # Convert extent to WGS-84 if needed
            sr_wgs84 = arcpy.SpatialReference(4326)
            if extent.spatialReference and extent.spatialReference.factoryCode != 4326:
                poly = arcpy.management.Project(
                    arcpy.Polygon(
                        arcpy.Array([
                            arcpy.Point(extent.XMin, extent.YMin),
                            arcpy.Point(extent.XMax, extent.YMin),
                            arcpy.Point(extent.XMax, extent.YMax),
                            arcpy.Point(extent.XMin, extent.YMax),
                            arcpy.Point(extent.XMin, extent.YMin),
                        ]),
                        extent.spatialReference,
                    ),
                    arcpy.Geometry(),
                    sr_wgs84,
                )
                env = poly.extent
                west, south, east, north = env.XMin, env.YMin, env.XMax, env.YMax
            else:
                west, south, east, north = (
                    extent.XMin, extent.YMin, extent.XMax, extent.YMax
                )

            zoom_levels = range(min_zoom, max_zoom + 1)
            tiles = _tiles(west, south, east, north, zoom_levels)
            tile_count = len(tiles)

            if tile_count > MAX_TILES:
                messages.addErrorMessage(
                    f"Request would download {tile_count} tiles, which exceeds "
                    f"the {MAX_TILES}-tile safety limit. "
                    "Reduce the extent or zoom range."
                )
                raise arcpy.ExecuteError

            messages.addMessage(
                f"Downloading {tile_count} tiles "
                f"(provider={provider}, zoom={min_zoom}–{max_zoom}) …"
            )

            url_template = ESRI_PROVIDERS[provider]
            provider_dir = os.path.join(out_folder, provider)
            downloaded = skipped = failed = 0

            for z, x, y in tiles:
                tile_dir = os.path.join(provider_dir, str(z), str(x))
                os.makedirs(tile_dir, exist_ok=True)
                tile_path = os.path.join(tile_dir, f"{y}.png")

                if os.path.exists(tile_path):
                    skipped += 1
                    continue

                url = url_template.format(z=z, x=x, y=y)
                try:
                    urllib.request.urlretrieve(url, tile_path)
                    downloaded += 1
                except urllib.error.URLError:
                    failed += 1

            messages.addMessage(
                f"Done — downloaded: {downloaded}, "
                f"skipped (cached): {skipped}, failed: {failed}"
            )
            messages.addMessage(
                f"Tiles stored in: {os.path.join(out_folder, provider)}"
            )

except ImportError:
    # arcpy is not available outside ArcGIS Pro.
    class OfflineTileDownloader:  # type: ignore[no-redef]
        """Stub: arcpy is not available in this environment."""

        label = "Offline Tile Downloader"
        description = "Requires ArcGIS Pro / arcpy."
