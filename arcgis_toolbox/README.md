# SeismicNavigator ArcGIS Pro Toolbox

This folder contains the master **ArcGIS Pro Python Toolbox** (`.pyt`) for the
SeismicNavigator project.

## Directory layout

```
arcgis_toolbox/
├── SeismicNavigator.pyt          ← master toolbox (thin registration layer)
└── tools/
    ├── __init__.py
    ├── geopdf_to_raster.py       ← GeoPDF → georeferenced PNG
    └── offline_tile_downloader.py ← download Esri basemap tiles for offline use
```

## Tools included

| Tool | Description |
|------|-------------|
| **GeoPDF to Raster** | Converts a georeferenced ArcGIS Pro GeoPDF to a PNG raster using GDAL (`gdalinfo` + `gdal_translate`) and reports the extracted WGS-84 bounding box. |
| **Offline Tile Downloader** | Downloads Esri World Imagery or World Topo basemap tiles for a selected extent and zoom range into a local folder compatible with the SeismicNavigator tile-cache URL scheme. |

## Prerequisites

- **ArcGIS Pro 2.x / 3.x** (any license level)
- **GDAL** installed and on the system `PATH` (required only by *GeoPDF to Raster*)
  - Windows: install via [OSGeo4W](https://trac.osgeo.org/osgeo4w/) or the
    standalone GDAL binary package
  - Linux/macOS: `apt install gdal-bin` / `brew install gdal`

## Adding the toolbox to ArcGIS Pro

1. Open the **Catalog** pane.
2. Right-click **Toolboxes** → **Add Toolbox**.
3. Browse to `arcgis_toolbox/SeismicNavigator.pyt` and click **OK**.
4. The toolbox appears under **Toolboxes** with both tools visible.

## Adding a new tool

1. Create a new module in `arcgis_toolbox/tools/`, e.g. `my_analysis.py`.

2. Define your tool class with the standard ArcGIS Pro geoprocessing interface:

   ```python
   # arcgis_toolbox/tools/my_analysis.py
   import arcpy

   class MyAnalysis:
       def __init__(self):
           self.label = "My Analysis"
           self.description = "Does something useful."
           self.canRunInBackground = False

       def getParameterInfo(self):
           param = arcpy.Parameter(
               displayName="Input Features",
               name="in_features",
               datatype="GPFeatureLayer",
               parameterType="Required",
               direction="Input",
           )
           return [param]

       def isLicensed(self):
           return True

       def updateParameters(self, parameters):
           pass

       def updateMessages(self, parameters):
           pass

       def execute(self, parameters, messages):
           in_features = parameters[0].valueAsText
           messages.addMessage(f"Processing {in_features}")
   ```

3. Open `SeismicNavigator.pyt` and add two lines:

   ```python
   from tools.my_analysis import MyAnalysis   # add import

   class Toolbox:
       def __init__(self):
           ...
           self.tools = [
               GeoPDFToRaster,
               OfflineTileDownloader,
               MyAnalysis,               # add here
           ]
   ```

4. In ArcGIS Pro, right-click the toolbox in the **Catalog** pane and choose
   **Refresh** (or remove and re-add the toolbox if it was cached).

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Tool does not appear after adding the toolbox | Check for syntax errors or import failures in `SeismicNavigator.pyt` and the tool modules. Open a Python console and run `import arcgis_toolbox.tools.geopdf_to_raster` to see any error. |
| `gdalinfo` not found | Install GDAL and make sure it is on the system `PATH` accessible from the ArcGIS Pro Python environment. |
| Import error: `No module named 'tools'` | Ensure `arcgis_toolbox/` is used as the working folder, or that `_TOOLBOX_DIR` (the folder containing `SeismicNavigator.pyt`) is on `sys.path`. The `.pyt` adds it automatically. |
| `arcpy` not available | The tool modules include an `ImportError` fallback so they can be imported and inspected outside ArcGIS Pro, but they require a live Pro session to execute. |
