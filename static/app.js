const statusEl = document.getElementById("status");
const setStatus = (message) => {
  statusEl.textContent = message;
};

const map = L.map("map", { zoomControl: true }).setView([34.05, -118.25], 10);

const basemapLayers = {
  "imagery-online": L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
    maxZoom: 19,
    attribution: "Tiles © Esri",
  }),
  "topo-online": L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}", {
    maxZoom: 19,
    attribution: "Tiles © Esri",
  }),
  "imagery-offline": L.tileLayer("/api/tiles/imagery/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "Offline cache from Esri tiles",
  }),
  "topo-offline": L.tileLayer("/api/tiles/topo/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "Offline cache from Esri tiles",
  }),
};

let activeBasemap = basemapLayers["imagery-online"].addTo(map);

const replaceBasemap = (key) => {
  map.removeLayer(activeBasemap);
  activeBasemap = basemapLayers[key];
  activeBasemap.addTo(map);
};

document.getElementById("basemap-select").addEventListener("change", (event) => {
  replaceBasemap(event.target.value);
});

const drawnItems = new L.FeatureGroup().addTo(map);
const uploadedVectorItems = new L.FeatureGroup().addTo(map);
const uploadedFeatures = [];

const drawControl = new L.Control.Draw({
  edit: {
    featureGroup: drawnItems,
    remove: true,
  },
  draw: {
    rectangle: false,
    circle: false,
    circlemarker: false,
  },
});
map.addControl(drawControl);

map.on(L.Draw.Event.CREATED, (event) => {
  drawnItems.addLayer(event.layer);
});

const geoPdfOverlays = [];

async function uploadGeoPdf() {
  const input = document.getElementById("geopdf-input");
  if (!input.files.length) {
    setStatus("Select a GeoPDF before uploading.");
    return;
  }

  const formData = new FormData();
  formData.append("file", input.files[0]);

  setStatus("Uploading GeoPDF...");
  const response = await fetch("/api/upload/geopdf", { method: "POST", body: formData });
  const payload = await response.json();

  if (!response.ok) {
    setStatus(`GeoPDF upload failed: ${JSON.stringify(payload.detail)}`);
    return;
  }

  const overlay = L.imageOverlay(payload.image_url, payload.bounds, { opacity: 0.75 });
  overlay.addTo(map);
  geoPdfOverlays.push(overlay);
  map.fitBounds(payload.bounds);
  setStatus("GeoPDF georeferencing applied and overlay added.");
}

document.getElementById("upload-geopdf").addEventListener("click", () => {
  uploadGeoPdf().catch((error) => setStatus(`GeoPDF upload error: ${error.message}`));
});

document.getElementById("shapefile-input").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) {
    return;
  }

  setStatus("Reading shapefile ZIP...");

  try {
    const geojson = await shp(file);
    const normalized = Array.isArray(geojson)
      ? { type: "FeatureCollection", features: geojson.flatMap((item) => item.features || []) }
      : geojson;

    uploadedFeatures.push(normalized);
    const layer = L.geoJSON(normalized, {
      style: { color: "#f97316", weight: 2 },
      pointToLayer: (_feature, latlng) => L.circleMarker(latlng, { radius: 5, color: "#f97316" }),
    });
    layer.addTo(uploadedVectorItems);
    map.fitBounds(layer.getBounds());
    setStatus(`Loaded shapefile with ${normalized.features.length} features.`);
  } catch (error) {
    setStatus(`Shapefile load failed: ${error.message}`);
  }
});

function collectExportGeoJson() {
  const drawnGeoJson = drawnItems.toGeoJSON();
  const drawnFeatures = drawnGeoJson.features || [];
  const shapeFeatures = uploadedFeatures.flatMap((collection) => collection.features || []);

  return {
    type: "FeatureCollection",
    features: [...shapeFeatures, ...drawnFeatures],
  };
}

function downloadBlob(filename, blob, mimeType) {
  const url = URL.createObjectURL(new Blob([blob], { type: mimeType }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

document.getElementById("export-geojson").addEventListener("click", () => {
  const data = collectExportGeoJson();
  downloadBlob("seismicnavigator-export.geojson", JSON.stringify(data, null, 2), "application/geo+json");
  setStatus(`Exported ${data.features.length} features to GeoJSON.`);
});

document.getElementById("export-kmz").addEventListener("click", async () => {
  const data = collectExportGeoJson();
  const kml = tokml(data);
  const zip = new JSZip();
  zip.file("doc.kml", kml);
  const kmzBlob = await zip.generateAsync({ type: "blob" });
  downloadBlob("seismicnavigator-export.kmz", kmzBlob, "application/vnd.google-earth.kmz");
  setStatus(`Exported ${data.features.length} features to KMZ.`);
});

function bboxFromCurrentMap() {
  const bounds = map.getBounds();
  return {
    west: bounds.getWest(),
    south: bounds.getSouth(),
    east: bounds.getEast(),
    north: bounds.getNorth(),
  };
}

document.getElementById("bbox-from-map").addEventListener("click", () => {
  const bounds = bboxFromCurrentMap();
  setStatus(`Extent captured: W ${bounds.west.toFixed(4)}, S ${bounds.south.toFixed(4)}, E ${bounds.east.toFixed(4)}, N ${bounds.north.toFixed(4)}.`);
});

document.getElementById("download-offline").addEventListener("click", async () => {
  const provider = document.getElementById("offline-provider").value;
  const minZoom = Number.parseInt(document.getElementById("min-zoom").value, 10);
  const maxZoom = Number.parseInt(document.getElementById("max-zoom").value, 10);
  const bbox = bboxFromCurrentMap();

  setStatus("Downloading offline tile cache...");

  const response = await fetch("/api/offline/download", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provider,
      min_zoom: minZoom,
      max_zoom: maxZoom,
      ...bbox,
    }),
  });

  const payload = await response.json();
  if (!response.ok) {
    setStatus(`Offline cache download failed: ${JSON.stringify(payload.detail)}`);
    return;
  }

  setStatus(`Offline cache complete. Downloaded ${payload.downloaded}, skipped ${payload.skipped}, failed ${payload.failed}.`);
});
