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
    addPointsFromCollection(normalized);
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

  if (payload.failed > 0) {
    setStatus(
      `Offline cache partially complete. Downloaded ${payload.downloaded}, skipped ${payload.skipped}, failed ${payload.failed}.`
    );
    return;
  }

  setStatus(`Offline cache complete. Downloaded ${payload.downloaded}, skipped ${payload.skipped}, failed ${payload.failed}.`);
});

// ─── Point Feature Tracking ───────────────────────────────────────────────────

const pointFeatures = [];

const NAME_CANDIDATES = [
  "name", "Name", "NAME",
  "label", "Label", "LABEL",
  "title", "Title", "TITLE",
  "feature_name", "FEATURE_NAME",
  "site", "SITE",
  "location", "LOCATION",
  "description", "DESCRIPTION",
];

function detectDisplayName(feature) {
  const props = feature.properties || {};
  for (const key of NAME_CANDIDATES) {
    if (key in props && props[key] !== null && props[key] !== "") {
      return String(props[key]);
    }
  }
  for (const val of Object.values(props)) {
    if (typeof val === "string" && val) return val;
  }
  return null;
}

function featureToLatLng(feature) {
  const geom = feature.geometry;
  if (!geom) return null;
  if (geom.type === "Point") return L.latLng(geom.coordinates[1], geom.coordinates[0]);
  if (geom.type === "MultiPoint" && geom.coordinates.length) {
    return L.latLng(geom.coordinates[0][1], geom.coordinates[0][0]);
  }
  return null;
}

function addPointsFromCollection(collection) {
  const features = collection.features || [];
  for (const feature of features) {
    const geom = feature.geometry;
    if (!geom || (geom.type !== "Point" && geom.type !== "MultiPoint")) continue;
    const latlng = featureToLatLng(feature);
    if (!latlng) continue;
    const name = detectDisplayName(feature) || `Point ${pointFeatures.length + 1}`;
    pointFeatures.push({ name, latlng, feature });
  }
  populateDestinationSelect();
}

function populateDestinationSelect() {
  const select = document.getElementById("nav-destination");
  select.innerHTML = "";
  if (pointFeatures.length === 0) {
    select.innerHTML = '<option value="">-- Load a point layer first --</option>';
    return;
  }
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "-- Select a destination --";
  select.appendChild(placeholder);
  pointFeatures.forEach((pt, index) => {
    const option = document.createElement("option");
    option.value = index;
    option.textContent = pt.name;
    select.appendChild(option);
  });
}

// ─── Navigation ───────────────────────────────────────────────────────────────

let navigationWatchId = null;
let navigationLine = null;
let userLocationMarker = null;
let selectedDestIndex = null;

function bearingToCardinal(bearing) {
  const dirs = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return dirs[Math.round(bearing / 22.5) % 16];
}

function calcBearing(from, to) {
  const phi1 = (from.lat * Math.PI) / 180;
  const phi2 = (to.lat * Math.PI) / 180;
  const dLambda = ((to.lng - from.lng) * Math.PI) / 180;
  const y = Math.sin(dLambda) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function formatDistance(meters) {
  return meters >= 1000 ? `${(meters / 1000).toFixed(2)} km` : `${Math.round(meters)} m`;
}

function updateNavigationDisplay(userLatLng) {
  if (selectedDestIndex === null) return;
  const dest = pointFeatures[selectedDestIndex];
  if (!dest) return;
  const destLatLng = dest.latlng;

  if (navigationLine) {
    navigationLine.setLatLngs([userLatLng, destLatLng]);
  } else {
    navigationLine = L.polyline([userLatLng, destLatLng], {
      color: "#22c55e",
      weight: 3,
      dashArray: "10,6",
      opacity: 0.9,
    }).addTo(map);
  }

  if (userLocationMarker) {
    userLocationMarker.setLatLng(userLatLng);
  } else {
    userLocationMarker = L.circleMarker(userLatLng, {
      radius: 9,
      color: "#ffffff",
      weight: 2,
      fillColor: "#3b82f6",
      fillOpacity: 1,
    })
      .addTo(map)
      .bindTooltip("You", { permanent: true, direction: "top", offset: [0, -12] });
  }

  const distance = userLatLng.distanceTo(destLatLng);
  const bearing = calcBearing(userLatLng, destLatLng);
  const cardinal = bearingToCardinal(bearing);
  document.getElementById("nav-info").textContent =
    `📍 ${dest.name}\n${formatDistance(distance)} · ${cardinal} (${Math.round(bearing)}°)`;
}

function stopNavigation() {
  if (navigationWatchId !== null) {
    navigator.geolocation.clearWatch(navigationWatchId);
    navigationWatchId = null;
  }
  if (navigationLine) {
    map.removeLayer(navigationLine);
    navigationLine = null;
  }
  if (userLocationMarker) {
    map.removeLayer(userLocationMarker);
    userLocationMarker = null;
  }
  selectedDestIndex = null;
  document.getElementById("nav-info").textContent = "No navigation active.";
  setStatus("Navigation stopped.");
}

document.getElementById("start-navigation").addEventListener("click", () => {
  const select = document.getElementById("nav-destination");
  const idx = select.value;
  if (idx === "") {
    setStatus("Select a destination point first.");
    return;
  }
  if (!navigator.geolocation) {
    setStatus("Geolocation is not supported by this browser.");
    return;
  }
  stopNavigation();
  selectedDestIndex = Number.parseInt(idx, 10);
  setStatus(`Navigating to "${pointFeatures[selectedDestIndex].name}"…`);
  document.getElementById("nav-info").textContent = "Acquiring location…";

  navigationWatchId = navigator.geolocation.watchPosition(
    (pos) => {
      const userLatLng = L.latLng(pos.coords.latitude, pos.coords.longitude);
      updateNavigationDisplay(userLatLng);
    },
    (err) => setStatus(`Geolocation error: ${err.message}`),
    { enableHighAccuracy: true, maximumAge: 5000 }
  );
});

document.getElementById("stop-navigation").addEventListener("click", stopNavigation);

// ─── Search Points ────────────────────────────────────────────────────────────

const FLASH_COUNT = 8;
const FLASH_INTERVAL_MS = 350;

let flashInterval = null;
let flashMarker = null;

function flashPoint(latlng) {
  if (flashInterval !== null) {
    clearInterval(flashInterval);
    flashInterval = null;
  }
  if (flashMarker) {
    map.removeLayer(flashMarker);
    flashMarker = null;
  }
  flashMarker = L.circleMarker(latlng, {
    radius: 18,
    color: "#ef4444",
    weight: 3,
    fillColor: "#fbbf24",
    fillOpacity: 0.6,
  }).addTo(map);

  let count = 0;
  flashInterval = setInterval(() => {
    count++;
    if (count > FLASH_COUNT) {
      clearInterval(flashInterval);
      flashInterval = null;
      if (flashMarker) {
        map.removeLayer(flashMarker);
        flashMarker = null;
      }
      return;
    }
    if (flashMarker._map) {
      map.removeLayer(flashMarker);
    } else {
      flashMarker.addTo(map);
    }
  }, FLASH_INTERVAL_MS);
}

function runPointSearch() {
  const query = document.getElementById("point-search").value.trim().toLowerCase();
  const resultsDiv = document.getElementById("search-results");
  resultsDiv.innerHTML = "";

  if (!query) {
    setStatus("Enter a name to search.");
    return;
  }
  if (pointFeatures.length === 0) {
    setStatus("No point features loaded. Load a shapefile first.");
    return;
  }

  const matches = pointFeatures.filter((pt) => pt.name.toLowerCase().includes(query));
  if (matches.length === 0) {
    resultsDiv.innerHTML = '<p style="color:#f87171;margin:0.3rem 0;font-size:0.85rem">No points found.</p>';
    setStatus(`No points matching "${query}".`);
    return;
  }

  const best = matches[0];
  map.setView(best.latlng, Math.max(map.getZoom(), 14));
  flashPoint(best.latlng);
  setStatus(`Found "${best.name}".`);

  if (matches.length > 1) {
    const list = matches.slice(0, 8);
    list.forEach((pt) => {
      const btn = document.createElement("button");
      btn.className = "search-result-btn";
      btn.textContent = pt.name;
      btn.addEventListener("click", () => {
        map.setView(pt.latlng, Math.max(map.getZoom(), 14));
        flashPoint(pt.latlng);
        setStatus(`Panned to "${pt.name}".`);
      });
      resultsDiv.appendChild(btn);
    });
    if (matches.length > 8) {
      const note = document.createElement("p");
      note.style.cssText = "font-size:0.8rem;color:#9ca3af;margin:0.2rem 0 0";
      note.textContent = `…and ${matches.length - 8} more result(s).`;
      resultsDiv.appendChild(note);
    }
  }
}

document.getElementById("search-point").addEventListener("click", runPointSearch);

document.getElementById("point-search").addEventListener("keydown", (e) => {
  if (e.key === "Enter") runPointSearch();
});
