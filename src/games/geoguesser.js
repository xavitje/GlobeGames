import { GEO_POINTS, LOCATION_SETS } from "../data/geoPoints.js";
import { ALL_NAMES, haversineKm, topbar } from "../core.js";
import {
  hasGoogleMapsKey,
  loadGoogleMaps,
  findStreetViewRound,
  createPanorama,
} from "../lib/streetview.js";
import {
  hasMultiplayerConfig,
  GameRoom,
  randomRoomCode,
  randomPlayerId,
} from "../lib/multiplayer.js";

let app;
let gg = null;

const PLAYER_COLORS = [
  "#7c5cff", "#ff5c7c", "#ff9f2b", "#2bd6b4",
  "#f7e63b", "#3b82f6", "#e040fb", "#00e676",
];

// Dark blue Google Maps style for the guess map
const DARK_MAP_STYLE = [
  { elementType: "geometry", stylers: [{ color: "#1d2c4d" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#8ec3b9" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#1a3646" }] },
  { featureType: "administrative.country", elementType: "geometry.stroke", stylers: [{ color: "#4b6878" }] },
  { featureType: "administrative.country", elementType: "labels.text.fill", stylers: [{ color: "#aecbca" }] },
  { featureType: "landscape.natural", elementType: "geometry", stylers: [{ color: "#023e58" }] },
  { featureType: "poi", elementType: "geometry", stylers: [{ color: "#283d6a" }] },
  { featureType: "poi.park", elementType: "geometry.fill", stylers: [{ color: "#023e58" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#304a7d" }] },
  { featureType: "road", elementType: "labels.text.fill", stylers: [{ color: "#98a5be" }] },
  { featureType: "road", elementType: "labels.text.stroke", stylers: [{ color: "#1d2c4d" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#2c6675" }] },
  { featureType: "transit.line", elementType: "geometry.fill", stylers: [{ color: "#283d6a" }] },
  { featureType: "transit.station", elementType: "geometry", stylers: [{ color: "#3a4762" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#0e1626" }] },
  { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#4e6d70" }] },
];

// ---------- Location set helpers ----------

function buildPointFn(setKey = "world") {
  const set = LOCATION_SETS[setKey] || LOCATION_SETS["world"];
  const eligible = set.countries.filter((c) => GEO_POINTS[c]?.length);
  return function randomPoint() {
    const country = eligible[Math.floor(Math.random() * eligible.length)];
    const pts = GEO_POINTS[country];
    if (set.onlyCapital) return { country, ...pts[0] };
    const weighted = [];
    pts.forEach((p, i) => { const w = i === 0 ? 2 : 1; for (let k = 0; k < w; k++) weighted.push(p); });
    return { country, ...weighted[Math.floor(Math.random() * weighted.length)] };
  };
}

function scoreForDistance(km) {
  if (km < 20) return 5000;
  return Math.max(0, Math.round(5000 * Math.exp(-km / 2000)));
}

// ---------- Multiplayer round timer (host-configurable) ----------

function timerSettingHtml(idPrefix, seconds) {
  const enabled = seconds != null;
  const val = seconds || 60;
  return `
    <label class="gg-label" style="margin-top:16px;">Tijdslimiet per ronde</label>
    <div style="display:flex; align-items:center; gap:10px; margin-top:6px; flex-wrap:wrap;">
      <label style="display:flex; align-items:center; gap:6px; font-size:13px; cursor:pointer;">
        <input type="checkbox" id="${idPrefix}TimerEnabled" ${enabled ? "checked" : ""} />
        Aan
      </label>
      <input type="number" id="${idPrefix}TimerSeconds" min="30" max="180" step="15" value="${val}"
        ${enabled ? "" : "disabled"}
        style="width:80px; padding:8px 10px; border-radius:10px; border:1px solid var(--border); background:var(--panel2); color:inherit; font-size:14px;" />
      <span class="small">seconden (30–180)</span>
    </div>`;
}

function wireTimerSetting(idPrefix) {
  const checkbox = document.getElementById(`${idPrefix}TimerEnabled`);
  const numInput = document.getElementById(`${idPrefix}TimerSeconds`);
  if (!checkbox || !numInput) return;
  checkbox.addEventListener("change", () => { numInput.disabled = !checkbox.checked; });
}

function readTimerSetting(idPrefix) {
  const checkbox = document.getElementById(`${idPrefix}TimerEnabled`);
  const numInput = document.getElementById(`${idPrefix}TimerSeconds`);
  if (!checkbox || !checkbox.checked) return null;
  let v = parseInt(numInput.value, 10);
  if (Number.isNaN(v)) v = 60;
  return Math.min(180, Math.max(30, v));
}

function clearRoundTimer() {
  if (gg?.roundTimer) { clearInterval(gg.roundTimer); gg.roundTimer = null; }
  document.getElementById("ggHudTimer")?.remove();
}

function startRoundTimer(seconds) {
  clearRoundTimer();
  gg.timerDeadline = Date.now() + seconds * 1000;
  const hud = document.getElementById("ggHudTop");
  if (hud) {
    const pill = document.createElement("span");
    pill.className = "gg-hud-pill gg-hud-timer";
    pill.id = "ggHudTimer";
    hud.appendChild(pill);
  }
  const tick = () => {
    const remain = Math.max(0, Math.ceil((gg.timerDeadline - Date.now()) / 1000));
    const pill = document.getElementById("ggHudTimer");
    if (pill) {
      const m = Math.floor(remain / 60), s = remain % 60;
      pill.textContent = `⏱ ${m}:${String(s).padStart(2, "0")}`;
      pill.classList.toggle("gg-hud-timer-low", remain <= 10);
    }
    if (remain <= 0) { clearRoundTimer(); onRoundTimeUp(); }
  };
  tick();
  gg.roundTimer = setInterval(tick, 250);
}

function onRoundTimeUp() {
  if (!gg || gg.mode !== "mp" || gg.screen !== "round") return;
  if (!gg.submitted) {
    if (gg.guess) {
      submitMpGuess();
    } else {
      gg.submitted = true;
      const btn = document.getElementById("ggSubmitBtn");
      if (btn) btn.disabled = true;
      const info = document.getElementById("ggGuessInfo");
      if (info) info.textContent = "Tijd voorbij — geen gok geplaatst ✗";
    }
  }
  if (gg.isHost) hostFinishRound();
}

function clearGoogleMap(mapRef) {
  if (mapRef && window.google?.maps) {
    window.google.maps.event.clearInstanceListeners(mapRef);
  }
}

function teardown() {
  if (gg?.panorama) gg.panorama = null;
  if (gg?.map) { clearGoogleMap(gg.map); gg.map = null; gg.guessMarker = null; }
  if (gg?.resultMap) { clearGoogleMap(gg.resultMap); gg.resultMap = null; }
  if (gg?.room) { gg.room.leave(); gg.room = null; }
  clearRoundTimer();
  const wrap = document.getElementById("ggFullscreenWrap");
  if (wrap) wrap.remove();
}

// ---------- URL helpers ----------

function setLobbyInUrl(code) {
  history.replaceState(null, "", `#${code ? `geoguesser?lobby=${code.toUpperCase()}` : "geoguesser"}`);
}
function clearLobbyFromUrl() { history.replaceState(null, "", "#geoguesser"); }
function getLobbyFromUrl() {
  const hash = location.hash.replace("#", "");
  const idx = hash.indexOf("?");
  if (idx === -1) return null;
  return new URLSearchParams(hash.slice(idx + 1)).get("lobby") || null;
}

// ---------- Entry point ----------

export function renderGeoGuesser(rootEl) {
  app = rootEl;
  teardown();
  gg = null;

  if (!hasGoogleMapsKey()) {
    app.innerHTML = `${topbar()}
      <div class="gametitle"><div><h2>📍 GeoGuesser</h2><div class="desc">Even instellen voordat je kunt spelen.</div></div></div>
      <div class="card" style="cursor:default;">
        <span class="icon">🔑</span>
        <h3>Google Maps-key ontbreekt</h3>
        <p style="margin-bottom:10px;">Dit spel gebruikt echte <a class="linklike" href="https://developers.google.com/maps/documentation/javascript/streetview" target="_blank" rel="noopener">Google Street View</a>-panorama's. Maak een API-key aan en zet 'm in <code>.env</code>:</p>
        <div class="small" style="background:var(--panel2); padding:10px 12px; border-radius:10px; font-family:monospace;">VITE_GOOGLE_MAPS_KEY=jouw-key</div>
      </div>`;
    return;
  }

  // Fire-and-forget: get the Google Maps script loading/connecting the
  // moment someone opens GeoGuesser, instead of only once a round starts.
  // By the time a round actually needs it, the library is already warm.
  loadGoogleMaps().catch(() => {});

  const urlLobby = getLobbyFromUrl();
  if (urlLobby && hasMultiplayerConfig()) { drawAutoJoinScreen(urlLobby); return; }
  drawStartScreen();
}

function drawAutoJoinScreen(code) {
  app.innerHTML = `
    ${topbar()}
    <div class="gametitle"><div><h2>👥 Lobby joinen</h2><div class="desc">Je bent uitgenodigd voor lobby <strong>${code.toUpperCase()}</strong>.</div></div></div>
    <div class="card" style="cursor:default;">
      <h3 style="margin-bottom:10px;">Jouw naam</h3>
      <input id="ggAutoJoinName" type="text" placeholder="Bijv. Rafi" maxlength="18"
        style="width:100%; padding:10px 12px; border-radius:10px; border:1px solid var(--border); background:var(--panel2); color:inherit; font-size:14px;" />
    </div>
    <div class="footerrow">
      <button class="btn" onclick="ggShowStart()">← Terug</button>
      <button class="btn primary" onclick="ggAutoJoin('${code}')">Joinen →</button>
    </div>`;
}

window.ggAutoJoin = async function (code) {
  const input = document.getElementById("ggAutoJoinName");
  const name = (input?.value.trim()) || "Speler" + Math.floor(Math.random() * 900 + 100);
  await enterLobby(code, name, false, null);
};

function drawStartScreen() {
  clearLobbyFromUrl();
  const mpAvailable = hasMultiplayerConfig();
  app.innerHTML = `
    ${topbar()}
    <div class="gametitle"><div><h2>📍 GeoGuesser</h2><div class="desc">Waar op aarde is dit?</div></div></div>
    <div class="card" style="cursor:pointer;" onclick="ggShowSoloSettings()">
      <span class="icon">🧍</span><h3>Solo spelen</h3>
      <p>Kies je rondes en locaties, speel op je eigen tempo.</p>
    </div>
    <div class="card" style="cursor:${mpAvailable ? "pointer" : "default"}; opacity:${mpAvailable ? "1" : "0.55"};"
      ${mpAvailable ? 'onclick="ggShowMultiplayerMenu()"' : ""}>
      <span class="icon">👥</span><h3>Met vrienden (multiplayer)</h3>
      <p>${mpAvailable ? "Maak een lobby of join er een met een code." : "Multiplayer niet ingesteld (Supabase-variabelen ontbreken)."}</p>
    </div>`;
}

// ---------- Solo settings ----------

window.ggShowSoloSettings = function (prefill = {}) {
  const setOptions = Object.entries(LOCATION_SETS)
    .map(([key, s]) => `<option value="${key}" ${key === (prefill.locationSet || "world") ? "selected" : ""}>${s.label}</option>`)
    .join("");
  const ar = prefill.rounds || 5;
  app.innerHTML = `
    ${topbar()}
    <div class="gametitle"><div><h2>🧍 Solo spelen</h2><div class="desc">Kies je instellingen.</div></div></div>
    <div class="card" style="cursor:default;">
      <h3 style="margin-bottom:14px;">Instellingen</h3>
      <label class="gg-label">Aantal rondes</label>
      <div class="gg-pill-row" id="soloRoundPills">
        ${[3,5,7,10].map(n => `<button class="gg-pill-btn${n===ar?" active":""}" data-v="${n}">${n}</button>`).join("")}
      </div>
      <label class="gg-label" style="margin-top:16px;">Locaties</label>
      <div class="gg-select-wrap"><select id="soloLocationSet" class="gg-select">${setOptions}</select></div>
    </div>
    <div class="footerrow">
      <button class="btn" onclick="ggShowStart()">← Terug</button>
      <button class="btn primary" onclick="ggStartSolo()">Spelen →</button>
    </div>`;
  document.getElementById("soloRoundPills").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-v]"); if (!btn) return;
    document.querySelectorAll("#soloRoundPills .gg-pill-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
  });
};

window.ggShowStart = function () { drawStartScreen(); };

window.ggStartSolo = function () {
  const roundBtn = document.querySelector("#soloRoundPills .gg-pill-btn.active");
  const rounds = roundBtn ? parseInt(roundBtn.dataset.v, 10) : 5;
  const locSet = document.getElementById("soloLocationSet")?.value || "world";
  gg = { mode: "solo", round: 0, totalScore: 0, rounds, locationSet: locSet,
    pointFn: buildPointFn(locSet), usedPanos: new Set(), history: [],
    current: null, guess: null, map: null, guessMarker: null, resultMap: null, panorama: null };
  nextSoloRound();
};

// ---------- Solo mode ----------

function drawFullscreenLoading(roundLabel) {
  const existing = document.getElementById("ggFullscreenWrap");
  if (existing) existing.remove();
  const wrap = document.createElement("div");
  wrap.id = "ggFullscreenWrap";
  wrap.className = "gg-fullscreen-wrap";
  wrap.innerHTML = `
    <div class="gg-pano-container" style="background:var(--panel2); display:flex; flex-direction:column; align-items:center; justify-content:center; gap:14px;">
      <div class="ggspinner"></div>
      <div style="color:#fff; font-size:14px; opacity:0.7;">Street View-locatie zoeken...</div>
    </div>
    <div class="gg-hud-top">
      <button class="gg-hud-back-btn" onclick="ggExitToStart()">✕</button>
      <span class="gg-hud-pill">${roundLabel}</span>
    </div>`;
  document.body.appendChild(wrap);
}

async function nextSoloRound() {
  gg.round++;
  gg.guess = null;
  gg.submitted = false;
  if (gg.map) { clearGoogleMap(gg.map); gg.map = null; gg.guessMarker = null; }
  if (gg.resultMap) { clearGoogleMap(gg.resultMap); gg.resultMap = null; }
  gg.panorama = null;

  drawFullscreenLoading(`Ronde ${gg.round} / ${gg.rounds}`);
  const maps = await loadGoogleMaps();

  let round = null, attempts = 0;
  while (attempts < 20) {
    const candidate = await findStreetViewRound(maps, gg.pointFn);
    if (candidate && !gg.usedPanos.has(candidate.pano)) { round = candidate; gg.usedPanos.add(candidate.pano); break; }
    attempts++;
  }

  if (!round) {
    document.getElementById("ggFullscreenWrap")?.remove();
    app.innerHTML = `${topbar()}
      <div class="gametitle"><div><h2>📍 GeoGuesser</h2></div></div>
      <div class="card" style="cursor:default;">
        <span class="icon">📡</span><h3>Geen Street View gevonden</h3>
        <p>Probeer het opnieuw.</p>
        <button class="btn primary" onclick="ggStartSolo()" style="margin-top:10px;">Opnieuw</button>
      </div>`;
    return;
  }

  gg.current = round;
  drawRoundScreen({ roundLabel: `Ronde ${gg.round} / ${gg.rounds}`, scoreLabel: `${gg.totalScore} pts`, onSubmit: submitSoloGuess });
  initPanorama(round);
  initMap(maps);
}

function submitSoloGuess() {
  if (!gg.guess) return;
  gg.submitted = true;
  const km = haversineKm(gg.guess, [gg.current.lng, gg.current.lat]);
  const pts = scoreForDistance(km);
  gg.totalScore += pts;
  gg.history.push({ km, pts, country: gg.current.countryHint });
  showSoloResultOverlay(km, pts);
}

function showSoloResultOverlay(km, pts) {
  const corner = document.getElementById("ggMapCorner");
  if (corner) corner.style.display = "none";
  if (gg.map) { clearGoogleMap(gg.map); gg.map = null; gg.guessMarker = null; }

  const wrap = document.getElementById("ggFullscreenWrap");
  if (!wrap) return;

  const overlay = document.createElement("div");
  overlay.id = "ggResultOverlay";
  overlay.className = "gg-result-overlay";
  overlay.innerHTML = `
    <div class="gg-result-header">
      <div class="gg-result-country">${gg.current.countryHint}</div>
      <div class="gg-result-stat">📏 ${Math.round(km).toLocaleString()} km · <strong>${pts} pts</strong> · Totaal: ${gg.totalScore}</div>
    </div>
    <div id="ggResultMap" class="gg-result-map"></div>
    <div class="gg-result-footer">
      <button class="btn primary" id="ggNextRoundBtn">
        ${gg.round < gg.rounds ? "Volgende ronde →" : "Bekijk eindscore"}
      </button>
    </div>`;
  wrap.appendChild(overlay);

  document.getElementById("ggNextRoundBtn").onclick = () => {
    if (gg.resultMap) { clearGoogleMap(gg.resultMap); gg.resultMap = null; }
    if (gg.round < gg.rounds) { overlay.remove(); nextSoloRound(); }
    else { teardown(); showSoloFinalScore(); }
  };

  setTimeout(() => {
    const mapEl = document.getElementById("ggResultMap");
    if (!mapEl || !window.google?.maps) return;
    const mapsApi = window.google.maps;
    const answerPos = { lat: gg.current.lat, lng: gg.current.lng };

    const rmap = new mapsApi.Map(mapEl, {
      center: answerPos, zoom: 3,
      mapTypeId: "roadmap",
      streetViewControl: false, fullscreenControl: false, mapTypeControl: false,
      gestureHandling: "greedy",
    });
    gg.resultMap = rmap;

    // Answer marker (green)
    new mapsApi.Marker({ position: answerPos, map: rmap,
      icon: { path: mapsApi.SymbolPath.CIRCLE, scale: 10, fillColor: "#2ecc71", fillOpacity: 1, strokeColor: "#fff", strokeWeight: 2 },
      title: gg.current.countryHint, zIndex: 10 });

    if (gg.guess) {
      const guessPos = { lat: gg.guess[1], lng: gg.guess[0] };
      new mapsApi.Marker({ position: guessPos, map: rmap,
        icon: { path: mapsApi.SymbolPath.CIRCLE, scale: 9, fillColor: PLAYER_COLORS[0], fillOpacity: 1, strokeColor: "#fff", strokeWeight: 2 },
        title: "Jouw gok" });
      new mapsApi.Polyline({ path: [guessPos, answerPos], map: rmap,
        strokeColor: PLAYER_COLORS[0], strokeOpacity: 0.85, strokeWeight: 2,
        icons: [{ icon: { path: "M 0,-1 0,1", strokeOpacity: 1, scale: 4 }, offset: "0", repeat: "20px" }] });

      const bounds = new mapsApi.LatLngBounds();
      bounds.extend(guessPos); bounds.extend(answerPos);
      rmap.fitBounds(bounds, 60);
    }
  }, 100);
}

function showSoloFinalScore() {
  const avg = Math.round(gg.totalScore / gg.rounds);
  const savedLoc = gg.locationSet, savedRounds = gg.rounds;
  app.innerHTML = `
    ${topbar()}
    <div class="gametitle"><div><h2>📍 GeoGuesser</h2><div class="desc">Eindresultaat</div></div></div>
    <div class="card" style="cursor:default; text-align:center;">
      <span class="icon">🏁</span>
      <h3>${gg.totalScore} / ${gg.rounds * 5000} punten</h3>
      <p>Gemiddeld ${avg} punten per ronde.</p>
    </div>
    <div class="guesslist" style="margin-top:14px;">
      ${gg.history.map((h, i) => `<div class="gitem">
        <div class="name">Ronde ${i+1} · ${h.country}</div>
        <div class="dist">${Math.round(h.km).toLocaleString()} km</div>
        <div></div><div class="prox">${h.pts} pts</div>
      </div>`).join("")}
    </div>
    <div class="footerrow">
      <button class="btn" onclick="ggShowStart()">← Menu</button>
      <button class="btn primary" onclick="ggShowSoloSettings(${JSON.stringify({ rounds: savedRounds, locationSet: savedLoc })})">🔄 Opnieuw spelen</button>
    </div>`;
}

window.ggExitToStart = function () { teardown(); drawStartScreen(); };

// ---------- Multiplayer: menu ----------

window.ggShowMultiplayerMenu = function () {
  const setOptions = Object.entries(LOCATION_SETS)
    .map(([key, s]) => `<option value="${key}">${s.label}</option>`).join("");
  app.innerHTML = `
    ${topbar()}
    <div class="gametitle"><div><h2>👥 GeoGuesser multiplayer</h2><div class="desc">Speel dezelfde rondes tegelijk met vrienden.</div></div></div>
    <div class="card" style="cursor:default;">
      <h3 style="margin-bottom:10px;">Jouw naam</h3>
      <input id="ggNameInput" type="text" placeholder="Bijv. Rafi" maxlength="18"
        style="width:100%; padding:10px 12px; border-radius:10px; border:1px solid var(--border); background:var(--panel2); color:inherit; font-size:14px;" />
    </div>
    <div class="card" style="cursor:default; margin-top:12px;">
      <h3 style="margin-bottom:14px;">🎮 Lobby-instellingen <span class="small">(voor nieuwe lobby)</span></h3>
      <label class="gg-label">Aantal rondes</label>
      <div class="gg-pill-row" id="mpRoundPills">
        ${[3,5,7,10].map(n => `<button class="gg-pill-btn${n===5?" active":""}" data-v="${n}">${n}</button>`).join("")}
      </div>
      <label class="gg-label" style="margin-top:16px;">Locaties</label>
      <div class="gg-select-wrap"><select id="mpLocationSet" class="gg-select">${setOptions}</select></div>
      ${timerSettingHtml("mp", null)}
    </div>
    <div class="card" style="cursor:pointer; margin-top:12px;" onclick="ggHostLobby()">
      <span class="icon">➕</span><h3>Nieuwe lobby maken</h3>
      <p>Jij bent host en start het spel voor iedereen.</p>
    </div>
    <div class="card" style="cursor:default; margin-top:12px;">
      <span class="icon">🔑</span><h3>Lobby joinen</h3>
      <div style="display:flex; gap:8px; margin-top:8px;">
        <input id="ggCodeInput" type="text" placeholder="CODE" maxlength="4"
          style="flex:1; text-transform:uppercase; padding:10px 12px; border-radius:10px; border:1px solid var(--border); background:var(--panel2); color:inherit; font-size:14px; letter-spacing:2px; text-align:center;" />
        <button class="btn primary" onclick="ggJoinLobby()">Join</button>
      </div>
    </div>
    <div class="footerrow">
      <button class="btn" onclick="ggShowStart()">← Terug</button><div></div>
    </div>`;
  document.getElementById("mpRoundPills").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-v]"); if (!btn) return;
    document.querySelectorAll("#mpRoundPills .gg-pill-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
  });
  wireTimerSetting("mp");
};

function getPlayerName() {
  const input = document.getElementById("ggNameInput");
  const name = (input?.value.trim()) || "";
  return name || "Speler" + Math.floor(Math.random() * 900 + 100);
}

function getMpSettings() {
  const roundBtn = document.querySelector("#mpRoundPills .gg-pill-btn.active");
  return {
    rounds: roundBtn ? parseInt(roundBtn.dataset.v, 10) : 5,
    locationSet: document.getElementById("mpLocationSet")?.value || "world",
    roundTime: readTimerSetting("mp"),
  };
}

window.ggHostLobby = async function () {
  await enterLobby(randomRoomCode(), getPlayerName(), true, getMpSettings());
};
window.ggJoinLobby = async function () {
  const codeInput = document.getElementById("ggCodeInput");
  const code = (codeInput?.value.trim()) || "";
  if (code.length < 4) { alert("Vul een geldige lobby-code van 4 tekens in."); return; }
  await enterLobby(code, getPlayerName(), false, null);
};

async function enterLobby(code, name, isHost, settings) {
  app.innerHTML = `${topbar()}
    <div class="gametitle"><div><h2>👥 Lobby ${code.toUpperCase()}</h2><div class="desc">Verbinden...</div></div></div>
    <div class="ggphoto-wrap loading"><div class="ggspinner"></div></div>`;

  const playerId = randomPlayerId();
  const room = new GameRoom(code, playerId, name);

  gg = { mode: "mp", room, isHost, playerId, name, round: 0,
    rounds: settings?.rounds ?? 5, locationSet: settings?.locationSet ?? "world",
    roundTime: settings?.roundTime ?? null,
    pointFn: buildPointFn(settings?.locationSet ?? "world"),
    usedPanos: new Set(), scoreboard: {}, history: [], guess: null, submitted: false,
    map: null, guessMarker: null, resultMap: null, panorama: null,
    currentGuesses: {}, roundStartPlayers: [], roundTimer: null };

  try { await room.connect(); }
  catch (e) {
    app.innerHTML = `${topbar()}
      <div class="card" style="cursor:default;">
        <span class="icon">⚠️</span><h3>Kon niet verbinden</h3>
        <p>${e.message}</p>
        <button class="btn primary" onclick="ggShowMultiplayerMenu()" style="margin-top:10px;">Terug</button>
      </div>`;
    return;
  }

  room.on("round", onMpRoundStart);
  room.on("guess", onMpGuessReceived);
  room.on("results", onMpResults);
  room.on("gameover", onMpGameOver);
  room.on("settings", onMpSettingsReceived);
  room.on("restart", onMpRestart);

  room.onPresence((players) => {
    if (gg?.screen === "lobby") drawLobbyWaiting();
    // Late-joiner catch-up
    if (gg?.isHost && gg.screen === "round" && gg.current) {
      const knownIds = new Set((gg.roundStartPlayers || []).map(p => p.playerId));
      const newPlayers = players.filter(p => !knownIds.has(p.playerId));
      if (newPlayers.length > 0) {
        newPlayers.forEach(p => {
          gg.roundStartPlayers.push(p);
          if (!gg.scoreboard[p.playerId]) gg.scoreboard[p.playerId] = { name: p.name, total: 0 };
        });
        gg.room.send("round", { round: gg.round, total: gg.rounds, lat: gg.current.lat, lng: gg.current.lng, pano: gg.current.pano, countryHint: gg.current.countryHint });
      }
    }
  });

  gg.screen = "lobby";
  setLobbyInUrl(code);
  drawLobbyWaiting();
}

function onMpSettingsReceived(payload) {
  if (gg.isHost) return;
  gg.rounds = payload.rounds; gg.locationSet = payload.locationSet;
  gg.roundTime = payload.roundTime ?? null;
  gg.pointFn = buildPointFn(payload.locationSet);
}

function drawLobbyWaiting() {
  const players = gg.room.players();
  const setLabel = LOCATION_SETS[gg.locationSet]?.label || gg.locationSet;
  const shareUrl = `${location.origin}${location.pathname}#geoguesser?lobby=${gg.room.code}`;
  app.innerHTML = `
    ${topbar()}
    <div class="gametitle"><div><h2>👥 Lobby ${gg.room.code}</h2><div class="desc">${gg.isHost ? "Deel de link met je vrienden." : "Wachten tot de host het spel start..."}</div></div></div>
    <div class="card" style="cursor:default; text-align:center;">
      <div class="small">Lobby-code</div>
      <h3 style="font-size:32px; letter-spacing:6px; margin:6px 0;">${gg.room.code}</h3>
      <div class="gg-share-row">
        <input class="gg-share-input" id="ggShareUrl" value="${shareUrl}" readonly />
        <button class="btn" onclick="ggCopyLink()">📋 Kopieer</button>
      </div>
      ${gg.isHost ? `<div class="small" style="margin-top:8px;">⚙️ ${gg.rounds} rondes · ${setLabel}${gg.roundTime ? ` · ⏱ ${gg.roundTime}s per ronde` : ""}</div>` : ""}
    </div>
    <div class="guesslist" style="margin-top:14px;">
      ${players.map(p => `<div class="gitem">
        <div class="name">${p.name}${p.playerId === gg.playerId ? " (jij)" : ""}</div>
        <div></div><div></div><div></div>
      </div>`).join("")}
    </div>
    <div class="footerrow">
      <button class="btn" onclick="ggLeaveLobby()">← Lobby verlaten</button>
      ${gg.isHost ? '<button class="btn primary" onclick="ggMpStartGame()">Start spel →</button>' : "<div></div>"}
    </div>`;
}

window.ggCopyLink = function () {
  const input = document.getElementById("ggShareUrl");
  if (!input) return;
  navigator.clipboard.writeText(input.value).catch(() => { input.select(); document.execCommand("copy"); });
  const btn = input.nextElementSibling;
  if (btn) { btn.textContent = "✓ Gekopieerd!"; setTimeout(() => btn.textContent = "📋 Kopieer", 2000); }
};

window.ggLeaveLobby = function () { teardown(); clearLobbyFromUrl(); drawStartScreen(); };

window.ggMpStartGame = function () {
  if (!gg.isHost) return;
  gg.scoreboard = {}; gg.usedPanos = new Set(); gg.history = []; gg.round = 0;
  gg.room.players().forEach(p => { gg.scoreboard[p.playerId] = { name: p.name, total: 0 }; });
  gg.room.send("settings", { rounds: gg.rounds, locationSet: gg.locationSet, roundTime: gg.roundTime });
  hostAdvanceRound();
};

// ---------- Multiplayer game loop ----------

async function hostAdvanceRound() {
  gg.round++;
  if (gg.round > gg.rounds) {
    gg.room.send("gameover", { scoreboard: gg.scoreboard, history: gg.history }); return;
  }
  gg.screen = "loading";
  drawFullscreenLoading(`Ronde ${gg.round} / ${gg.rounds} — locatie zoeken...`);
  const maps = await loadGoogleMaps();
  let round = null, attempts = 0;
  while (attempts < 20) {
    const candidate = await findStreetViewRound(maps, gg.pointFn);
    if (candidate && !gg.usedPanos.has(candidate.pano)) { round = candidate; gg.usedPanos.add(candidate.pano); break; }
    attempts++;
  }
  if (!round) { gg.round--; return hostAdvanceRound(); }
  gg.currentGuesses = {}; gg.finishingRound = false;
  gg.roundStartPlayers = gg.room.players();
  gg.room.send("round", { round: gg.round, total: gg.rounds, lat: round.lat, lng: round.lng, pano: round.pano, countryHint: round.countryHint });
}

function onMpRoundStart(payload) {
  // Idempotency: existing players ignore re-broadcasts (for late-joiner catch-up)
  if (gg.screen === "round" && gg.round === payload.round) return;
  if (gg.resultMap) { clearGoogleMap(gg.resultMap); gg.resultMap = null; }

  gg.round = payload.round; gg.current = payload; gg.guess = null;
  gg.submitted = false; gg.screen = "round";
  if (payload.total) gg.rounds = payload.total;
  if (payload.pano) gg.usedPanos.add(payload.pano);

  drawRoundScreen({ roundLabel: `Ronde ${payload.round} / ${payload.total}`, scoreLabel: `${playerScore()} pts`, onSubmit: submitMpGuess });

  loadGoogleMaps().then(maps => { initPanorama(payload); initMap(maps); });

  if (gg.isHost) {
    const hud = document.getElementById("ggHudTop");
    if (hud) {
      const btn = document.createElement("button");
      btn.className = "gg-hud-pill gg-hud-force";
      btn.textContent = "⏩ Forceer";
      btn.onclick = () => hostFinishRound();
      hud.appendChild(btn);
    }
  }

  if (gg.roundTime) startRoundTimer(gg.roundTime);
  else clearRoundTimer();
}

function playerScore() {
  const entry = gg.scoreboard?.[gg.playerId];
  return entry ? entry.total : 0;
}

function submitMpGuess() {
  if (!gg.guess) return;
  gg.submitted = true;
  gg.room.send("guess", { round: gg.round, name: gg.name, lat: gg.guess[1], lng: gg.guess[0] });
  const info = document.getElementById("ggGuessInfo");
  if (info) info.textContent = "Gok verstuurd — wachten op andere spelers...";
  const btn = document.getElementById("ggSubmitBtn");
  if (btn) btn.disabled = true;
}

function onMpGuessReceived(payload) {
  if (!gg.isHost || payload.round !== gg.round) return;
  gg.currentGuesses[payload.from] = { name: payload.name, lat: payload.lat, lng: payload.lng };
  if (Object.keys(gg.currentGuesses).length >= (gg.roundStartPlayers.length || 1)) hostFinishRound();
}

function hostFinishRound() {
  if (!gg.isHost || gg.finishingRound) return;
  gg.finishingRound = true;
  const answer = { lat: gg.current.lat, lng: gg.current.lng, countryHint: gg.current.countryHint };
  const guesses = Object.entries(gg.currentGuesses).map(([playerId, g]) => {
    const km = haversineKm([g.lng, g.lat], [answer.lng, answer.lat]);
    const pts = scoreForDistance(km);
    if (!gg.scoreboard[playerId]) gg.scoreboard[playerId] = { name: g.name, total: 0 };
    gg.scoreboard[playerId].total += pts;
    gg.scoreboard[playerId].name = g.name;
    return { playerId, name: g.name, lat: g.lat, lng: g.lng, km, pts };
  });
  gg.history.push({ round: gg.round, country: answer.countryHint, guesses });
  gg.room.send("results", { round: gg.round, total: gg.rounds, answer, guesses, scoreboard: gg.scoreboard });
  gg.finishingRound = false;
}

function onMpResults(payload) {
  if (payload.round !== gg.round) return;
  clearRoundTimer();
  gg.scoreboard = payload.scoreboard;
  gg.submitted = true;
  if (gg.map) { clearGoogleMap(gg.map); gg.map = null; gg.guessMarker = null; }
  if (gg.resultMap) { clearGoogleMap(gg.resultMap); gg.resultMap = null; }
  document.getElementById("ggFullscreenWrap")?.remove();
  drawMpResultsScreen(payload);
}

function drawMpResultsScreen(payload) {
  const sorted = [...payload.guesses].sort((a, b) => b.pts - a.pts);
  const isLast = gg.round >= gg.rounds;
  app.innerHTML = `
    ${topbar()}
    <div class="gametitle"><div><h2>📍 GeoGuesser</h2><div class="desc">Ronde ${gg.round}/${gg.rounds} · resultaten</div></div></div>
    <div class="card" style="cursor:default; padding:0; overflow:hidden;">
      <div id="ggMpResultMap" style="height:300px; border-radius:var(--radius);"></div>
    </div>
    <div class="card" style="cursor:default; margin-top:10px; text-align:center;">
      <span style="font-size:22px;">📍</span>
      <strong style="margin-left:8px;">${payload.answer.countryHint}</strong>
    </div>
    <div class="guesslist" style="margin-top:10px;">
      ${sorted.map((g, i) => {
        const color = PLAYER_COLORS[i % PLAYER_COLORS.length];
        return `<div class="gitem">
          <div class="name"><span class="gg-player-dot" style="background:${color};"></span>${g.name}</div>
          <div class="dist">${Math.round(g.km).toLocaleString()} km</div>
          <div></div><div class="prox">${g.pts} pts</div>
        </div>`;
      }).join("")}
    </div>
    <div class="small" style="margin:10px 0 4px;">Totaalscore</div>
    <div class="guesslist">
      ${Object.values(payload.scoreboard).sort((a,b) => b.total - a.total)
        .map(s => `<div class="gitem">
          <div class="name">${s.name}</div>
          <div></div><div></div><div class="prox">${s.total} pts</div>
        </div>`).join("")}
    </div>
    <div class="footerrow">
      <div></div>
      ${gg.isHost
        ? `<button class="btn primary" onclick="ggMpNextFromHost()">${isLast ? "Bekijk eindscore" : "Volgende ronde →"}</button>`
        : `<div class="small">Wachten op host...</div>`}
    </div>`;

  // Draw Google Maps result map
  setTimeout(() => {
    const mapEl = document.getElementById("ggMpResultMap");
    if (!mapEl || !window.google?.maps) return;
    const mapsApi = window.google.maps;
    const answerPos = { lat: payload.answer.lat, lng: payload.answer.lng };

    const rmap = new mapsApi.Map(mapEl, {
      center: answerPos, zoom: 3, mapTypeId: "roadmap",
      streetViewControl: false, fullscreenControl: false, mapTypeControl: false,
      gestureHandling: "greedy",
    });
    gg.resultMap = rmap;

    const bounds = new mapsApi.LatLngBounds();
    bounds.extend(answerPos);

    // Answer marker (green)
    new mapsApi.Marker({ position: answerPos, map: rmap,
      icon: { path: mapsApi.SymbolPath.CIRCLE, scale: 11, fillColor: "#2ecc71", fillOpacity: 1, strokeColor: "#fff", strokeWeight: 2.5 },
      title: payload.answer.countryHint, zIndex: 100 });

    sorted.forEach((g, i) => {
      const color = PLAYER_COLORS[i % PLAYER_COLORS.length];
      const pos = { lat: g.lat, lng: g.lng };
      bounds.extend(pos);

      const marker = new mapsApi.Marker({ position: pos, map: rmap,
        icon: { path: mapsApi.SymbolPath.CIRCLE, scale: 9, fillColor: color, fillOpacity: 1, strokeColor: "#fff", strokeWeight: 2 },
        title: `${g.name}: ${Math.round(g.km).toLocaleString()} km · ${g.pts} pts` });

      const infoWindow = new mapsApi.InfoWindow({
        content: `<div style="font-size:13px; font-weight:600; padding:2px 4px;">${g.name}<br><span style="color:#555;">${Math.round(g.km).toLocaleString()} km · ${g.pts} pts</span></div>`
      });
      marker.addListener("click", () => infoWindow.open(rmap, marker));

      new mapsApi.Polyline({ path: [pos, answerPos], map: rmap,
        strokeColor: color, strokeOpacity: 0.8, strokeWeight: 2,
        icons: [{ icon: { path: "M 0,-1 0,1", strokeOpacity: 1, scale: 4 }, offset: "0", repeat: "20px" }] });
    });

    rmap.fitBounds(bounds, 60);
  }, 100);
}

window.ggMpNextFromHost = function () {
  if (!gg.isHost) return;
  if (gg.resultMap) { clearGoogleMap(gg.resultMap); gg.resultMap = null; }
  hostAdvanceRound();
};

// ---------- Post-game: restart in same lobby ----------

function onMpGameOver(payload) {
  if (gg.resultMap) { clearGoogleMap(gg.resultMap); gg.resultMap = null; }
  gg.scoreboard = payload.scoreboard;
  const sorted = Object.values(payload.scoreboard).sort((a, b) => b.total - a.total);
  const setOptions = Object.entries(LOCATION_SETS)
    .map(([key, s]) => `<option value="${key}" ${key === gg.locationSet ? "selected" : ""}>${s.label}</option>`).join("");

  app.innerHTML = `
    ${topbar()}
    <div class="gametitle"><div><h2>📍 GeoGuesser</h2><div class="desc">Eindresultaat · Lobby ${gg.room.code}</div></div></div>
    <div class="card" style="cursor:default; text-align:center;">
      <span class="icon">🏁</span>
      <h3>${sorted[0] ? sorted[0].name + " wint!" : "Klaar!"}</h3>
    </div>
    <div class="guesslist" style="margin-top:10px;">
      ${sorted.map((s, i) => `<div class="gitem">
        <div class="name">${i+1}. ${s.name}</div>
        <div></div><div></div><div class="prox">${s.total} pts</div>
      </div>`).join("")}
    </div>
    ${gg.isHost ? `
    <div class="card" style="cursor:default; margin-top:14px;">
      <h3 style="margin-bottom:14px;">⚙️ Instellingen voor nieuw spel</h3>
      <label class="gg-label">Aantal rondes</label>
      <div class="gg-pill-row" id="restartRoundPills">
        ${[3,5,7,10].map(n => `<button class="gg-pill-btn${n===gg.rounds?" active":""}" data-v="${n}">${n}</button>`).join("")}
      </div>
      <label class="gg-label" style="margin-top:16px;">Locaties</label>
      <div class="gg-select-wrap"><select id="restartLocationSet" class="gg-select">${setOptions}</select></div>
      ${timerSettingHtml("restart", gg.roundTime)}
    </div>` : `<div class="card" style="cursor:default; margin-top:14px; text-align:center;">
      <div class="small">Wachten tot de host een nieuw spel start...</div>
    </div>`}
    <div class="footerrow">
      <button class="btn" onclick="ggLeaveLobby()">← Menu</button>
      ${gg.isHost ? '<button class="btn primary" onclick="ggMpRestartGame()">🔄 Nieuw spel in zelfde lobby</button>' : "<div></div>"}
    </div>`;

  if (gg.isHost) {
    document.getElementById("restartRoundPills").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-v]"); if (!btn) return;
      document.querySelectorAll("#restartRoundPills .gg-pill-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
    });
    wireTimerSetting("restart");
  }
}

window.ggMpRestartGame = function () {
  if (!gg.isHost) return;
  const roundBtn = document.querySelector("#restartRoundPills .gg-pill-btn.active");
  const rounds = roundBtn ? parseInt(roundBtn.dataset.v, 10) : gg.rounds;
  const locSet = document.getElementById("restartLocationSet")?.value || gg.locationSet;
  const roundTime = readTimerSetting("restart");
  gg.rounds = rounds; gg.locationSet = locSet; gg.roundTime = roundTime; gg.pointFn = buildPointFn(locSet);
  gg.room.send("restart", { rounds, locationSet: locSet, roundTime });
  gg.room.send("settings", { rounds, locationSet: locSet, roundTime });
  window.ggMpStartGame();
};

function onMpRestart(payload) {
  if (gg.isHost) return;
  gg.rounds = payload.rounds; gg.locationSet = payload.locationSet;
  gg.roundTime = payload.roundTime ?? null;
  gg.pointFn = buildPointFn(payload.locationSet);
}

// ---------- Shared: fullscreen round screen ----------

function drawRoundScreen({ roundLabel, scoreLabel, onSubmit }) {
  document.getElementById("ggFullscreenWrap")?.remove();
  const wrap = document.createElement("div");
  wrap.id = "ggFullscreenWrap";
  wrap.className = "gg-fullscreen-wrap";
  wrap.innerHTML = `
    <div id="ggStreetView" class="gg-pano-container"></div>
    <div class="gg-pano-loading" id="ggPanoLoading">
      <div class="ggspinner"></div>
      <div class="gg-pano-loading-text">Panorama laden...</div>
    </div>
    <div class="gg-hud-top" id="ggHudTop">
      <button class="gg-hud-back-btn" onclick="ggExitToStart()">✕</button>
      <span class="gg-hud-pill">${roundLabel}</span>
      <span class="gg-hud-pill gg-hud-score" id="ggHudScore">${scoreLabel}</span>
    </div>
    <div class="gg-map-corner" id="ggMapCorner" tabindex="0">
      <div class="gg-map-corner-header">
        <span id="ggGuessInfo" class="gg-map-guess-info">Klik op de kaart om te gokken</span>
      </div>
      <div class="gg-map-inner">
        <div id="ggGuessMap" class="gg-guess-map"></div>
        <div class="gg-map-type-toggle" id="ggMapTypeToggle">
          <button data-type="roadmap" class="active">Kaart</button>
          <button data-type="satellite">Satelliet</button>
        </div>
      </div>
      <div class="gg-map-footer">
        <button class="btn primary gg-submit-btn" id="ggSubmitBtn" disabled>📍 Bevestig gok</button>
      </div>
    </div>`;
  document.body.appendChild(wrap);

  gg.onSubmitHandler = onSubmit;
  document.getElementById("ggSubmitBtn").onclick = () => gg.onSubmitHandler();

  // Map corner grows on hover (like OpenGuessr) instead of a toggle button.
  // Google Maps needs an explicit resize nudge once the CSS transition
  // finishes, otherwise the tiles stay cropped to the old size.
  const mapCorner = document.getElementById("ggMapCorner");
  const nudgeMapResize = () => {
    if (!gg.map) return;
    const center = gg.map.getCenter();
    window.google.maps.event.trigger(gg.map, "resize");
    if (center) gg.map.setCenter(center);
  };
  mapCorner.addEventListener("mouseenter", () => setTimeout(nudgeMapResize, 310));
  mapCorner.addEventListener("mouseleave", () => setTimeout(nudgeMapResize, 310));
  mapCorner.addEventListener("focus", () => setTimeout(nudgeMapResize, 310));
  mapCorner.addEventListener("blur", () => setTimeout(nudgeMapResize, 310));
}

async function initPanorama(round) {
  const maps = await loadGoogleMaps();
  const el = document.getElementById("ggStreetView");
  if (!el) return;
  gg.panorama = createPanorama(maps, el, round);
  // Hide the loading overlay once the panorama actually has imagery to show,
  // instead of leaving a bare black screen while the tiles fetch.
  const hideLoading = () => document.getElementById("ggPanoLoading")?.classList.add("gg-hidden");
  maps.event.addListenerOnce(gg.panorama, "status_changed", hideLoading);
  maps.event.addListenerOnce(gg.panorama, "pano_changed", hideLoading);
  // Safety net in case neither event fires for some reason.
  setTimeout(hideLoading, 4000);
}

function initMap(mapsApi) {
  const container = document.getElementById("ggGuessMap");
  if (!container || !mapsApi) return;

  const map = new mapsApi.Map(container, {
    center: { lat: 20, lng: 10 },
    zoom: 2, minZoom: 1,
    mapTypeId: "roadmap",
    // Standard light Google Maps look (like OpenGuessr), not the dark style.
    disableDefaultUI: true,
    zoomControl: true,
    gestureHandling: "greedy",
  });
  gg.map = map;
  gg.guessMarker = null;

  // Wire map type toggle buttons
  document.getElementById("ggMapTypeToggle")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-type]"); if (!btn) return;
    const type = btn.dataset.type;
    document.querySelectorAll("#ggMapTypeToggle button").forEach(b => b.classList.toggle("active", b === btn));
    if (type === "satellite") {
      map.setMapTypeId("hybrid"); // satellite + English labels
    } else {
      map.setMapTypeId("roadmap");
    }
  });

  mapsApi.event.addListener(map, "click", (e) => {
    if (gg.submitted) return;
    const lat = e.latLng.lat(), lng = e.latLng.lng();
    gg.guess = [lng, lat];

    if (gg.guessMarker) gg.guessMarker.setMap(null);
    gg.guessMarker = new mapsApi.Marker({
      position: { lat, lng }, map,
      icon: { path: mapsApi.SymbolPath.CIRCLE, scale: 10, fillColor: PLAYER_COLORS[0], fillOpacity: 1, strokeColor: "#fff", strokeWeight: 2 },
    });

    const info = document.getElementById("ggGuessInfo");
    if (info) info.textContent = "Gok geplaatst ✓";
    const btn = document.getElementById("ggSubmitBtn");
    if (btn) btn.removeAttribute("disabled");
  });
}
