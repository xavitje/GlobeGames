import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { COUNTRY_DATA } from "../data/countries.js";
import { GEO_POINTS } from "../data/geoPoints.js";
import { ALL_NAMES, haversineKm, flagEmoji, topbar } from "../core.js";

const MAPILLARY_TOKEN = import.meta.env.VITE_MAPILLARY_TOKEN || "";

let app,
  gg = null;

function weightedRandomPoint() {
  const countries = ALL_NAMES.filter(
    (n) => GEO_POINTS[n] && GEO_POINTS[n].length,
  );
  const country = countries[Math.floor(Math.random() * countries.length)];
  const pts = GEO_POINTS[country];
  const weighted = [];
  pts.forEach((p, i) => {
    const w = i === 0 ? 3 : 1;
    for (let k = 0; k < w; k++) weighted.push(p);
  });
  return { country, ...weighted[Math.floor(Math.random() * weighted.length)] };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchMapillaryImage(lon, lat) {
  const r = 0.045;
  const jLon = lon + (Math.random() - 0.5) * r;
  const jLat = lat + (Math.random() - 0.5) * r;
  const bbox = [jLon - r, jLat - r, jLon + r, jLat + r].join(",");
  const url = `https://graph.mapillary.com/images?access_token=${encodeURIComponent(MAPILLARY_TOKEN)}&fields=id,computed_geometry,thumb_2048_url,is_pano&bbox=${bbox}&limit=3`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const items = (data && data.data) || [];
    if (items.length) {
      const pick = items[Math.floor(Math.random() * items.length)];
      const coords =
        pick.computed_geometry && pick.computed_geometry.coordinates;
      if (coords && pick.thumb_2048_url) {
        return {
          imageUrl: pick.thumb_2048_url,
          lon: coords[0],
          lat: coords[1],
          isPano: !!pick.is_pano,
        };
      }
    }
  } catch (e) {
    // ignore, try next attempt
  }
  return null;
}

export function renderGeoGuesser(rootEl) {
  app = rootEl;
  if (!MAPILLARY_TOKEN) {
    app.innerHTML = `${topbar()}
      <div class="gametitle"><div><h2>📍 GeoGuesser</h2><div class="desc">Even instellen voordat je kunt spelen.</div></div></div>
      <div class="card" style="cursor:default;">
        <span class="icon">🔑</span>
        <h3>Mapillary-token ontbreekt</h3>
        <p style="margin-bottom:10px;">Dit spel gebruikt gratis straatfoto's van <a class="linklike" href="https://www.mapillary.com/developer" target="_blank" rel="noopener">Mapillary</a>. Maak daar gratis een account + app aan, kopieer de <em>Client Token</em> en zet die in <code>.env</code> (lokaal) of bij je Vercel project als omgevingsvariabele:</p>
        <div class="small" style="background:var(--panel2); padding:10px 12px; border-radius:10px; font-family:monospace;">VITE_MAPILLARY_TOKEN=MLY|jouw-token</div>
        <p class="small" style="margin-top:10px;">Na het instellen: lokaal opnieuw <code>npm run dev</code> starten, of op Vercel opnieuw deployen.</p>
      </div>
    `;
    return;
  }
  if (gg && gg.map) {
    gg.map.remove();
    gg.map = null;
  }
  gg = {
    round: 0,
    totalScore: 0,
    history: [],
    current: null,
    guess: null,
    map: null,
  };
  drawLoading();
  nextRound();
}

function drawLoading() {
  if (gg.map) {
    gg.map.remove();
    gg.map = null;
  }
  app.innerHTML = `
    ${topbar()}
    <div class="gametitle">
      <div><h2>📍 GeoGuesser</h2><div class="desc">Ronde ${gg.round + 1} van 5</div></div>
      <div class="pillrow"><span class="pill">Score: <span class="n">${gg.totalScore}</span></span></div>
    </div>
    <div class="ggphoto-wrap loading">
      <div class="ggspinner"></div>
      <div class="small">Straatfoto zoeken...</div>
    </div>
  `;
}

async function findRound(attempts = 8) {
  for (let i = 0; i < attempts; i++) {
    const p = weightedRandomPoint();
    const img = await fetchMapillaryImage(p.lon, p.lat);
    if (img) return { ...img, countryHint: p.country };
    await sleep(200);
  }
  return null;
}

async function nextRound() {
  gg.round++;
  gg.guess = null;
  gg.submitted = false;
  drawLoading();
  const round = await findRound();
  if (!round) {
    app.innerHTML = `${topbar()}
      <div class="gametitle"><div><h2>📍 GeoGuesser</h2></div></div>
      <div class="card" style="cursor:default;">
        <span class="icon">📡</span>
        <h3>Geen straatfoto's gevonden</h3>
        <p>Er kon geen Mapillary-dekking gevonden worden na meerdere pogingen. Probeer het nog eens.</p>
        <button class="btn primary" onclick="ggNewGame()" style="margin-top:10px;">Opnieuw proberen</button>
      </div>`;
    return;
  }
  gg.current = round;
  app.innerHTML = `
    ${topbar()}
    <div class="gametitle">
      <div><h2>📍 GeoGuesser</h2><div class="desc">Waar op aarde is deze foto genomen?</div></div>
      <div class="pillrow">
        <span class="pill">Ronde <span class="n">${gg.round}</span>/5</span>
        <span class="pill">Score: <span class="n">${gg.totalScore}</span></span>
      </div>
    </div>
    <div class="ggphoto-wrap">
      <img src="${gg.current.imageUrl}" alt="Straatfoto" />
      ${gg.current.isPano ? '<span class="ggpano-badge">360° foto</span>' : ""}
    </div>
    <div class="small" style="margin:8px 0 4px;">Klik op de kaart om je gok te plaatsen.</div>
    <div class="ggmap-wrap">
      <div id="ggLeafletMap"></div>
      <div class="gg-layer-toggle" id="ggLayerToggle">
        <button data-layer="street" class="active">Kaart</button>
        <button data-layer="satellite">Satelliet</button>
      </div>
    </div>
    <div class="footerrow">
      <div class="small" id="ggGuessInfo">${gg.guess ? "Gok geplaatst ✓" : "Nog geen gok geplaatst"}</div>
      <button class="btn primary" id="ggSubmitBtn" ${gg.guess ? "" : "disabled"} onclick="ggSubmitGuess()">Bevestig gok</button>
    </div>
  `;
  initMap();
}

function initMap() {
  const container = document.getElementById("ggLeafletMap");
  const map = L.map(container, {
    center: [20, 10],
    zoom: 2,
    minZoom: 1,
    worldCopyJump: true,
  });
  gg.map = map;

  const streetLayer = L.tileLayer(
    "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    {
      attribution: "© OpenStreetMap",
      maxZoom: 19,
    },
  );
  const satelliteLayer = L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    { attribution: "Tiles © Esri", maxZoom: 19 },
  );
  streetLayer.addTo(map);
  gg.activeLayer = streetLayer;
  gg.streetLayer = streetLayer;
  gg.satelliteLayer = satelliteLayer;

  const toggle = document.getElementById("ggLayerToggle");
  toggle.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-layer]");
    if (!btn) return;
    const kind = btn.dataset.layer;
    [...toggle.querySelectorAll("button")].forEach((b) =>
      b.classList.toggle("active", b === btn),
    );
    if (gg.activeLayer) map.removeLayer(gg.activeLayer);
    gg.activeLayer = kind === "satellite" ? gg.satelliteLayer : gg.streetLayer;
    gg.activeLayer.addTo(map);
  });

  gg.markersLayer = L.layerGroup().addTo(map);

  map.on("click", (e) => {
    if (gg.submitted) return;
    gg.guess = [e.latlng.lng, e.latlng.lat];
    renderMarkers();
    document.getElementById("ggGuessInfo").textContent = "Gok geplaatst ✓";
    document.getElementById("ggSubmitBtn").removeAttribute("disabled");
  });

  renderMarkers();
  setTimeout(() => map.invalidateSize(), 50);
}

function renderMarkers() {
  if (!gg.markersLayer) return;
  gg.markersLayer.clearLayers();
  if (gg.guess) {
    L.circleMarker([gg.guess[1], gg.guess[0]], {
      radius: 7,
      color: "#fff",
      weight: 1.5,
      fillColor: "#7c5cff",
      fillOpacity: 1,
    }).addTo(gg.markersLayer);
  }
  if (gg.submitted) {
    L.circleMarker([gg.current.lat, gg.current.lon], {
      radius: 7,
      color: "#fff",
      weight: 1.5,
      fillColor: "#2ecc71",
      fillOpacity: 1,
    }).addTo(gg.markersLayer);
    if (gg.guess) {
      L.polyline(
        [
          [gg.guess[1], gg.guess[0]],
          [gg.current.lat, gg.current.lon],
        ],
        { color: "#fff", weight: 1.5, dashArray: "4 3", opacity: 0.85 },
      ).addTo(gg.markersLayer);
    }
  }
}

window.ggSubmitGuess = function () {
  if (!gg.guess) return;
  gg.submitted = true;
  const km = haversineKm(gg.guess, [gg.current.lon, gg.current.lat]);
  const pts = scoreForDistance(km);
  gg.totalScore += pts;
  gg.history.push({ km, pts, country: gg.current.countryHint });
  renderMarkers();
  document.getElementById("ggSubmitBtn").outerHTML = "";
  document.getElementById("ggGuessInfo").innerHTML =
    `📏 ${Math.round(km).toLocaleString()} km van de juiste plek — <strong>${pts} punten</strong>`;
  const footer = document.querySelector(".footerrow");
  const btn = document.createElement("button");
  btn.className = "btn primary";
  btn.textContent = gg.round < 5 ? "Volgende ronde →" : "Bekijk eindscore";
  btn.onclick = () => (gg.round < 5 ? nextRound() : showFinalScore());
  footer.appendChild(btn);
};

function scoreForDistance(km) {
  if (km < 20) return 5000;
  return Math.max(0, Math.round(5000 * Math.exp(-km / 2000)));
}

function showFinalScore() {
  if (gg.map) {
    gg.map.remove();
    gg.map = null;
  }
  const avg = Math.round(gg.totalScore / 5);
  app.innerHTML = `
    ${topbar()}
    <div class="gametitle"><div><h2>📍 GeoGuesser</h2><div class="desc">Eindresultaat</div></div></div>
    <div class="card" style="cursor:default; text-align:center;">
      <span class="icon">🏁</span>
      <h3>${gg.totalScore} / 25000 punten</h3>
      <p>Gemiddeld ${avg} punten per ronde.</p>
    </div>
    <div class="guesslist" style="margin-top:14px;">
      ${gg.history
        .map(
          (h, i) => `<div class="gitem">
          <div class="name">Ronde ${i + 1} · ${h.country}</div>
          <div class="dist">${Math.round(h.km).toLocaleString()} km</div>
          <div></div>
          <div class="prox">${h.pts} pts</div>
        </div>`,
        )
        .join("")}
    </div>
    <div class="footerrow">
      <div></div>
      <button class="btn primary" onclick="ggNewGame()">🔄 Nieuw spel</button>
    </div>
  `;
}

window.ggNewGame = function () {
  renderGeoGuesser(app);
};
