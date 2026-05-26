"""GeoPDF to Raster tool for SeismicNavigator.

Converts an ArcGIS Pro GeoPDF to a georeferenced PNG raster and reports
the extracted WGS-84 bounding box.  The tool wraps the same GDAL workflow
used by the SeismicNavigator web API (gdalinfo + gdal_translate) so the
output can be loaded directly into an ArcGIS Pro map.
"""

from __future__ import annotations

import json
import os
import subprocess


def _run(cmd: list[str]) -> subprocess.CompletedProcess[str]:
    """Run a subprocess and return the completed-process object."""
    try:
        return subprocess.run(cmd, capture_output=True, text=True, check=False)
    except FileNotFoundError as exc:
        return subprocess.CompletedProcess(cmd, returncode=127, stdout="", stderr=str(exc))


def _parse_bounds(gdal_info: dict) -> tuple[float, float, float, float]:
    """Return (west, south, east, north) from a gdalinfo JSON dict."""
    if "wgs84Extent" not in gdal_info:
        raise ValueError("wgs84Extent not found in gdalinfo output. "
                         "Ensure the input is a georeferenced GeoPDF.")
    ring = gdal_info["wgs84Extent"]["coordinates"][0]
    lons = [c[0] for c in ring]
    lats = [c[1] for c in ring]
    return min(lons), min(lats), max(lons), max(lats)


try:
    import arcpy  # type: ignore[import-untyped]

    class GeoPDFToRaster:
        """Convert a georeferenced GeoPDF to a PNG raster in ArcGIS Pro.

        The tool uses GDAL (gdalinfo + gdal_translate) to extract the
        WGS-84 extent and render the PDF as a raster.  GDAL must be
        installed and accessible on the system PATH.
        """

        def __init__(self) -> None:
            self.label = "GeoPDF to Raster"
            self.description = (
                "Converts a georeferenced GeoPDF to a PNG raster and "
                "reports the WGS-84 bounding box.  Requires GDAL on PATH."
            )
            self.canRunInBackground = False

        def getParameterInfo(self) -> list:
            in_pdf = arcpy.Parameter(
                displayName="Input GeoPDF",
                name="in_pdf",
                datatype="DEFile",
                parameterType="Required",
                direction="Input",
            )
            in_pdf.filter.list = ["pdf"]

            out_png = arcpy.Parameter(
                displayName="Output PNG Raster",
                name="out_png",
                datatype="DEFile",
                parameterType="Required",
                direction="Output",
            )

            return [in_pdf, out_png]

        def isLicensed(self) -> bool:
            return True

        def updateParameters(self, parameters: list) -> None:
            if parameters[0].altered and not parameters[1].altered:
                base = os.path.splitext(parameters[0].valueAsText or "")[0]
                if base:
                    parameters[1].value = base + ".png"

        def updateMessages(self, parameters: list) -> None:
            pass

        def execute(self, parameters: list, messages) -> None:
            in_pdf: str = parameters[0].valueAsText
            out_png: str = parameters[1].valueAsText

            messages.addMessage("Running gdalinfo to extract georeferencing …")
            info_result = _run(["gdalinfo", "-json", in_pdf])
            if info_result.returncode != 0:
                messages.addErrorMessage(
                    "gdalinfo failed. Ensure GDAL is installed and the file "
                    "is a valid GeoPDF.\n" + info_result.stderr.strip()
                )
                raise arcpy.ExecuteError

            try:
                gdal_info = json.loads(info_result.stdout)
                west, south, east, north = _parse_bounds(gdal_info)
            except (json.JSONDecodeError, ValueError) as exc:
                messages.addErrorMessage(f"Failed to parse GeoPDF metadata: {exc}")
                raise arcpy.ExecuteError from exc

            messages.addMessage(
                f"Extracted bounds — West: {west:.6f}, South: {south:.6f}, "
                f"East: {east:.6f}, North: {north:.6f}"
            )

            messages.addMessage("Running gdal_translate to render PNG …")
            trans_result = _run(["gdal_translate", "-of", "PNG", in_pdf, out_png])
            if trans_result.returncode != 0 or not os.path.exists(out_png):
                messages.addErrorMessage(
                    "gdal_translate failed. Install gdal-bin with PDF support.\n"
                    + trans_result.stderr.strip()
                )
                raise arcpy.ExecuteError

            messages.addMessage(f"Raster written to: {out_png}")
            messages.addMessage(
                "To place it on the map, use the Define Projection tool "
                "(WGS 1984) and the extracted bounds above."
            )

except ImportError:
    # arcpy is not available outside ArcGIS Pro.  The module is still
    # importable for testing/inspection without a Pro license.
    class GeoPDFToRaster:  # type: ignore[no-redef]
        """Stub: arcpy is not available in this environment."""

        label = "GeoPDF to Raster"
        description = "Requires ArcGIS Pro / arcpy."
