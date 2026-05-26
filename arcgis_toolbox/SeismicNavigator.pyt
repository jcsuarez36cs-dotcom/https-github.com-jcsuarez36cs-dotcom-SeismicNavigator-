# SeismicNavigator — Master ArcGIS Pro Python Toolbox
#
# This is a *thin registration layer* only.  All tool logic lives in the
# arcgis_toolbox/tools/ package so that individual tools can be imported,
# tested, and reused independently of the toolbox container.
#
# How to add a new tool
# ---------------------
# 1. Create a new module under arcgis_toolbox/tools/, e.g. my_tool.py
# 2. Define a tool class with the standard ArcGIS Pro interface:
#      __init__, getParameterInfo, isLicensed, updateParameters,
#      updateMessages, execute
# 3. Import the class below (see imports section).
# 4. Add the class to the Toolbox.tools list.
# 5. Reload the toolbox in ArcGIS Pro (right-click → Refresh).

import os
import sys

# Ensure the directory that contains the 'tools' package is on sys.path so
# that "from tools.xxx import Yyy" works whether ArcGIS Pro calls this file
# from its own working directory or from the toolbox's actual location.
_TOOLBOX_DIR = os.path.dirname(os.path.abspath(__file__))
if _TOOLBOX_DIR not in sys.path:
    sys.path.insert(0, _TOOLBOX_DIR)

# ---------------------------------------------------------------------------
# Tool imports — add new tool classes here
# ---------------------------------------------------------------------------
from tools.geopdf_to_raster import GeoPDFToRaster
from tools.offline_tile_downloader import OfflineTileDownloader


# ---------------------------------------------------------------------------
# Toolbox definition — do not rename this class; ArcGIS Pro requires it.
# ---------------------------------------------------------------------------
class Toolbox:
    """Master SeismicNavigator toolbox for ArcGIS Pro.

    Consolidates all custom geoprocessing tools for the SeismicNavigator
    project into a single toolbox for easy access from the Catalog and
    Geoprocessing panes.
    """

    def __init__(self) -> None:
        self.label = "SeismicNavigator Tools"
        self.alias = "seismicnavigator"
        self.description = (
            "Master toolbox for the SeismicNavigator project. "
            "Provides tools for GeoPDF conversion and offline tile management."
        )
        # List every tool class that should appear in this toolbox.
        # Order determines the display order in the Catalog pane.
        self.tools = [
            GeoPDFToRaster,
            OfflineTileDownloader,
        ]
