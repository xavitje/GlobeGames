import { GEO_POINTS, LOCATION_SETS } from "../data/geoPoints.js";
import { ALL_NAMES, haversineKm, topbar, attachAutocomplete, candidateNames, findCountryByLoose } from "../core.js";
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

function buildPointFn(setKey = "world", rng = Math.random) {
  const set = LOCATION_SETS[setKey] || LOCATION_SETS["world"];
  const eligible = set.countries.filter((c) => GEO_POINTS[c]?.length);
  return function randomPoint() {
    const country = eligible[Math.floor(rng() * eligible.length)];
    const pts = GEO_POINTS[country];
    if (set.onlyCapital) return { country, ...pts[0] };
    const weighted = [];
    pts.forEach((p, i) => { const w = i === 0 ? 2 : 1; for (let k = 0; k < w; k++) weighted.push(p); });
    return { country, ...weighted[Math.floor(rng() * weighted.length)] };
  };
}

// ---------- Seeded RNG (for the daily challenge) ----------

function hashStringToSeed(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- Streak: best-score persistence ----------

function getStreakBest() {
  try { return parseInt(localStorage.getItem("gg_streak_best") || "0", 10) || 0; }
  catch (e) { return 0; }
}
function setStreakBest(n) {
  try { localStorage.setItem("gg_streak_best", String(n)); } catch (e) {}
}

// ---------- Daily challenge: seed, persistence, share text ----------

function getDailyKey() {
  const d = new Date();
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function getDailyResult() {
  try {
    const raw = localStorage.getItem("gg_daily_" + getDailyKey());
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}
function saveDailyResult(result) {
  try { localStorage.setItem("gg_daily_" + getDailyKey(), JSON.stringify(result)); } catch (e) {}
}
function dailyDayNumber() {
  const epoch = Date.UTC(2026, 0, 1);
  return Math.max(1, Math.floor((Date.now() - epoch) / 86400000) + 1);
}
function buildDailyShareText(result) {
  const blocks = result.history.map((h) => (h.pts >= 4500 ? "🟩" : h.pts >= 2500 ? "🟨" : "🟥")).join("");
  return `GlobeGames Daily #${dailyDayNumber()} — ${result.totalScore}/${result.rounds * 5000} pts\n${blocks}\n${location.origin}${location.pathname}#geoguesser`;
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
  const streakBest = getStreakBest();
  const dailyResult = getDailyResult();
  app.innerHTML = `
    ${topbar()}
    <div class="gametitle"><div><h2>📍 GeoGuesser</h2><div class="desc">Waar op aarde is dit?</div></div></div>
    <div class="card" style="cursor:pointer;" onclick="ggShowSoloSettings()">
      <span class="icon">🧍</span><h3>Solo spelen</h3>
      <p>Kies je rondes, locaties en moeilijkheidsgraad.</p>
    </div>
    <div class="card" style="cursor:pointer; margin-top:12px;" onclick="ggStartStreak()">
      <span class="icon">🔥</span><h3>Streak</h3>
      <p>Raad landen op rij, zo lang je kan. Beste streak: <strong>${streakBest}</strong></p>
    </div>
    <div class="card" style="cursor:pointer; margin-top:12px;" onclick="ggStartDaily()">
      <span class="icon">📅</span><h3>Dagelijkse challenge</h3>
      <p>${dailyResult ? `Vandaag al gespeeld: <strong>${dailyResult.totalScore} pts</strong> — bekijk je resultaat.` : "5 vaste rondes, elke dag hetzelfde voor iedereen."}</p>
    </div>
    <div class="card" style="cursor:${mpAvailable ? "pointer" : "default"}; opacity:${mpAvailable ? "1" : "0.55"}; margin-top:12px;"
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
      <label class="gg-label" style="margin-top:16px;">Moeilijkheidsgraad</label>
      <div class="gg-pill-row" id="soloDifficultyPills">
        <button class="gg-pill-btn${(prefill.difficulty || "free") === "free" ? " active" : ""}" data-v="free">Vrij bewegen</button>
        <button class="gg-pill-btn${prefill.difficulty === "nomove" ? " active" : ""}" data-v="nomove">Niet bewegen</button>
        <button class="gg-pill-btn${prefill.difficulty === "nmpz" ? " active" : ""}" data-v="nmpz">NMPZ</button>
      </div>
      <label style="display:flex; align-items:center; gap:8px; margin-top:14px; font-size:13px; cursor:pointer;">
        <input type="checkbox" id="soloBlackWhite" ${prefill.blackwhite ? "checked" : ""} /> Zwart-wit
      </label>
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
  document.getElementById("soloDifficultyPills").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-v]"); if (!btn) return;
    document.querySelectorAll("#soloDifficultyPills .gg-pill-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
  });
};

window.ggShowStart = function () { drawStartScreen(); };

window.ggStartSolo = function () {
  const roundBtn = document.querySelector("#soloRoundPills .gg-pill-btn.active");
  const rounds = roundBtn ? parseInt(roundBtn.dataset.v, 10) : 5;
  const locSet = document.getElementById("soloLocationSet")?.value || "world";
  const diffBtn = document.querySelector("#soloDifficultyPills .gg-pill-btn.active");
  const difficulty = diffBtn ? diffBtn.dataset.v : "free";
  const blackwhite = !!document.getElementById("soloBlackWhite")?.checked;
  gg = { mode: "solo", round: 0, totalScore: 0, rounds, locationSet: locSet, difficulty, blackwhite,
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
    else if (gg.mode === "daily") { teardown(); showDailyFinalScore(); }
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

// ---------- Streak mode ----------

window.ggStartStreak = function () {
  gg = { mode: "streak", streak: 0, best: getStreakBest(), difficulty: "free", blackwhite: false,
    pointFn: buildPointFn("world"), usedPanos: new Set(), current: null, panorama: null };
  nextStreakRound();
};

async function nextStreakRound() {
  gg.panorama = null;
  drawFullscreenLoading(`🔥 Streak: ${gg.streak}`);
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
      <div class="gametitle"><div><h2>🔥 Streak</h2></div></div>
      <div class="card" style="cursor:default;">
        <span class="icon">📡</span><h3>Geen Street View gevonden</h3>
        <p>Probeer het opnieuw.</p>
        <button class="btn primary" onclick="ggStartStreak()" style="margin-top:10px;">Opnieuw</button>
      </div>`;
    return;
  }

  gg.current = round;
  drawStreakRoundScreen();
  initPanorama(round);
}

function drawStreakRoundScreen() {
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
      <span class="gg-hud-pill">🔥 Streak: ${gg.streak}</span>
      <span class="gg-hud-pill">Beste: ${gg.best}</span>
    </div>
    <div class="gg-streak-panel" id="ggStreakPanel">
      <div class="gg-map-corner-header"><span class="gg-map-guess-info">Welk land is dit?</span></div>
      <div style="padding:0 14px 14px; position:relative;">
        <input id="ggStreakInput" type="text" autocomplete="off" placeholder="Typ een land..."
          style="width:100%; padding:10px 12px; border-radius:10px; border:1px solid var(--border); background:var(--panel2); color:inherit; font-size:14px;" />
        <div class="autocomplete" id="ggStreakAuto"></div>
      </div>
      <div class="gg-map-footer">
        <button class="btn primary gg-submit-btn" id="ggSubmitBtn">📍 Bevestig gok</button>
      </div>
    </div>`;
  document.body.appendChild(wrap);

  const input = document.getElementById("ggStreakInput");
  const dd = document.getElementById("ggStreakAuto");
  attachAutocomplete(input, dd, candidateNames(ALL_NAMES), () => {});
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") submitStreakGuess(); });
  input.focus();
  document.getElementById("ggSubmitBtn").onclick = submitStreakGuess;
}

function submitStreakGuess() {
  const input = document.getElementById("ggStreakInput");
  const guess = findCountryByLoose(input?.value || "");
  if (!guess) { input?.focus(); return; }
  const correct = guess === gg.current.countryHint;
  if (correct) {
    gg.streak++;
    if (gg.streak > gg.best) { gg.best = gg.streak; setStreakBest(gg.best); }
    nextStreakRound();
  } else {
    showStreakGameOver(guess);
  }
}

function showStreakGameOver(guess) {
  document.getElementById("ggFullscreenWrap")?.remove();
  const isNewBest = gg.streak > 0 && gg.streak >= gg.best;
  app.innerHTML = `${topbar()}
    <div class="gametitle"><div><h2>🔥 Streak voorbij</h2></div></div>
    <div class="card" style="cursor:default; text-align:center;">
      <span class="icon">💥</span>
      <h3>Streak: ${gg.streak}</h3>
      <p>Het juiste antwoord was <strong>${gg.current.countryHint}</strong>, jij gokte <strong>${guess}</strong>.</p>
      <p class="small">${isNewBest ? "🎉 Nieuwe beste streak!" : `Beste streak: ${gg.best}`}</p>
      <button class="btn primary" onclick="ggStartStreak()" style="margin-top:10px;">Opnieuw</button>
    </div>
    <div class="footerrow"><button class="btn" onclick="ggShowStart()">← Menu</button><div></div></div>`;
}

// ---------- Daily challenge ----------

window.ggStartDaily = function () {
  const existing = getDailyResult();
  if (existing) { showDailyResult(existing); return; }
  const rng = mulberry32(hashStringToSeed(getDailyKey()));
  gg = { mode: "daily", round: 0, totalScore: 0, rounds: 5, locationSet: "world",
    difficulty: "free", blackwhite: false,
    pointFn: buildPointFn("world", rng), usedPanos: new Set(), history: [],
    current: null, guess: null, map: null, guessMarker: null, resultMap: null, panorama: null };
  nextSoloRound();
};

function showDailyFinalScore() {
  const result = { date: getDailyKey(), totalScore: gg.totalScore, rounds: gg.rounds, history: gg.history };
  saveDailyResult(result);
  showDailyResult(result);
}

function showDailyResult(result) {
  const shareText = buildDailyShareText(result);
  app.innerHTML = `
    ${topbar()}
    <div class="gametitle"><div><h2>📅 Dagelijkse challenge</h2><div class="desc">${result.date}</div></div></div>
    <div class="card" style="cursor:default; text-align:center;">
      <span class="icon">🏁</span>
      <h3>${result.totalScore} / ${result.rounds * 5000} punten</h3>
      <button class="btn primary" id="ggDailyCopyBtn" style="margin-top:10px;">📋 Kopieer resultaat</button>
    </div>
    <div class="guesslist" style="margin-top:14px;">
      ${result.history.map((h, i) => `<div class="gitem">
        <div class="name">Ronde ${i+1} · ${h.country}</div>
        <div class="dist">${Math.round(h.km).toLocaleString()} km</div>
        <div></div><div class="prox">${h.pts} pts</div>
      </div>`).join("")}
    </div>
    <div class="footerrow"><button class="btn" onclick="ggShowStart()">← Menu</button><div></div></div>`;
  const copyBtn = document.getElementById("ggDailyCopyBtn");
  if (copyBtn) {
    copyBtn.onclick = () => {
      navigator.clipboard.writeText(shareText).catch(() => {});
      copyBtn.textContent = "✓ Gekopieerd!";
      setTimeout(() => { copyBtn.textContent = "📋 Kopieer resultaat"; }, 2000);
    };
  }
}

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
      <label class="gg-label">Spelmodus</label>
      <div class="gg-select-wrap"><select id="mpGameMode" class="gg-select">${gameModeOptionsHtml("ffa")}</select></div>
      <label class="gg-label" style="margin-top:16px;">Aantal rondes</label>
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
    gameMode: document.getElementById("mpGameMode")?.value || "ffa",
  };
}

// ---------- Spelmodi (FFA / Duels / Team Duels / Battle Royale) ----------

const GAME_MODES = {
  ffa: { label: "FFA (iedereen tegelijk)", minPlayers: 2 },
  duels: { label: "Duels (1v1)", minPlayers: 2, exactPlayers: 2 },
  teamduels: { label: "Team Duels (2 teams)", minPlayers: 2 },
  br: { label: "Battle Royale", minPlayers: 3 },
};

function gameModeOptionsHtml(selected) {
  return Object.entries(GAME_MODES)
    .map(([key, m]) => `<option value="${key}" ${key === selected ? "selected" : ""}>${m.label}</option>`)
    .join("");
}

// Whether the host can currently press "Start spel", plus a reason when not.
function checkCanStartGame() {
  const mode = GAME_MODES[gg.gameMode] || GAME_MODES.ffa;
  const players = gg.room.players();
  if (mode.exactPlayers && players.length !== mode.exactPlayers) {
    return { ok: false, reason: `${mode.label} heeft precies ${mode.exactPlayers} spelers nodig — nu: ${players.length}.` };
  }
  if (players.length < mode.minPlayers) {
    return { ok: false, reason: `${mode.label} heeft minstens ${mode.minPlayers} spelers nodig — nu: ${players.length}.` };
  }
  if (gg.gameMode === "teamduels") {
    const teamA = players.filter(p => gg.teams?.[p.playerId] === "A");
    const teamB = players.filter(p => gg.teams?.[p.playerId] === "B");
    if (teamA.length === 0 || teamB.length === 0) {
      return { ok: false, reason: "Beide teams hebben minstens 1 speler nodig." };
    }
  }
  return { ok: true, reason: "" };
}

function onMpTeamsReceived(payload) {
  gg.teams = payload.teams || {};
  if (gg.screen === "lobby") drawLobbyWaiting();
}

// Host-only: toggle one player between team A/B and broadcast the change.
window.ggSetPlayerTeam = function (playerId, team) {
  if (!gg.isHost) return;
  gg.teams = { ...gg.teams, [playerId]: team };
  gg.room.send("teams", { teams: gg.teams });
  drawLobbyWaiting();
};

// Host-only: split everyone currently in the lobby evenly at random.
window.ggRandomizeTeams = function () {
  if (!gg.isHost) return;
  const shuffled = [...gg.room.players()].sort(() => Math.random() - 0.5);
  const teams = {};
  shuffled.forEach((p, i) => { teams[p.playerId] = i % 2 === 0 ? "A" : "B"; });
  gg.teams = teams;
  gg.room.send("teams", { teams: gg.teams });
  drawLobbyWaiting();
};

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
    gameMode: settings?.gameMode ?? "ffa", teams: {}, hp: {}, alive: new Set(), eliminated: [],
    teamScore: { A: 0, B: 0 },
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
  room.on("teams", onMpTeamsReceived);

  room.onPresence((players) => {
    // Auto-assign new players to the smaller team in Team Duels lobbies.
    if (gg?.isHost && gg.gameMode === "teamduels" && gg.screen === "lobby") {
      let changed = false;
      players.forEach((p) => {
        if (!gg.teams[p.playerId]) {
          const aCount = Object.values(gg.teams).filter((t) => t === "A").length;
          const bCount = Object.values(gg.teams).filter((t) => t === "B").length;
          gg.teams[p.playerId] = aCount <= bCount ? "A" : "B";
          changed = true;
        }
      });
      if (changed) gg.room.send("teams", { teams: gg.teams });
    }
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
  gg.gameMode = payload.gameMode ?? "ffa";
  gg.pointFn = buildPointFn(payload.locationSet);
}

function drawLobbyWaiting() {
  const players = gg.room.players();
  const setLabel = LOCATION_SETS[gg.locationSet]?.label || gg.locationSet;
  const modeLabel = (GAME_MODES[gg.gameMode] || GAME_MODES.ffa).label;
  const shareUrl = `${location.origin}${location.pathname}#geoguesser?lobby=${gg.room.code}`;
  const isTeamDuels = gg.gameMode === "teamduels";
  const canStart = checkCanStartGame();

  const teamsHtml = !isTeamDuels ? "" : `
    <div class="card" style="cursor:default; margin-top:12px;">
      <h3 style="margin-bottom:10px;">⚔️ Teams</h3>
      <div class="gg-team-cols">
        ${["A", "B"].map(team => `
          <div class="gg-team-col">
            <div class="gg-team-col-title">Team ${team}</div>
            ${players.filter(p => gg.teams?.[p.playerId] === team).map(p => `
              <div class="gg-team-chip">
                ${p.name}${p.playerId === gg.playerId ? " (jij)" : ""}
                ${gg.isHost ? `<button class="gg-team-swap" onclick="ggSetPlayerTeam('${p.playerId}','${team === "A" ? "B" : "A"}')" title="Naar team ${team === "A" ? "B" : "A"}">⇄</button>` : ""}
              </div>`).join("") || `<div class="small" style="opacity:0.6;">Nog niemand</div>`}
          </div>`).join("")}
      </div>
      ${gg.isHost ? `<button class="btn" style="margin-top:10px; width:100%;" onclick="ggRandomizeTeams()">🎲 Willekeurig verdelen</button>` : ""}
    </div>`;

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
      <div class="small" style="margin-top:8px;">🎮 ${modeLabel} · ${gg.rounds} rondes · ${setLabel}${gg.roundTime ? ` · ⏱ ${gg.roundTime}s per ronde` : ""}</div>
    </div>
    ${teamsHtml}
    <div class="guesslist" style="margin-top:14px;">
      ${players.map(p => `<div class="gitem">
        <div class="name">${p.name}${p.playerId === gg.playerId ? " (jij)" : ""}</div>
        <div></div><div></div><div></div>
      </div>`).join("")}
    </div>
    ${gg.isHost && !canStart.ok ? `<div class="small" style="color:var(--danger); margin-top:8px; text-align:center;">${canStart.reason}</div>` : ""}
    <div class="footerrow">
      <button class="btn" onclick="ggLeaveLobby()">← Lobby verlaten</button>
      ${gg.isHost ? `<button class="btn primary" ${canStart.ok ? "" : "disabled"} onclick="ggMpStartGame()">Start spel →</button>` : "<div></div>"}
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
  const canStart = checkCanStartGame();
  if (!canStart.ok) { alert(canStart.reason); return; }

  gg.scoreboard = {}; gg.usedPanos = new Set(); gg.history = []; gg.round = 0;
  gg.room.players().forEach(p => { gg.scoreboard[p.playerId] = { name: p.name, total: 0 }; });

  gg.duelOver = false;
  if (gg.gameMode === "duels") {
    gg.hp = {};
    gg.room.players().forEach(p => { gg.hp[p.playerId] = 5000; });
  }
  if (gg.gameMode === "teamduels") {
    gg.teamScore = { A: 0, B: 0 };
  }
  if (gg.gameMode === "br") {
    gg.alive = new Set(gg.room.players().map(p => p.playerId));
    gg.eliminated = [];
  }

  gg.room.send("settings", { rounds: gg.rounds, locationSet: gg.locationSet, roundTime: gg.roundTime, gameMode: gg.gameMode });
  gg.room.send("teams", { teams: gg.teams });
  hostAdvanceRound();
};

// ---------- Multiplayer game loop ----------

async function hostAdvanceRound() {
  gg.round++;
  const outOfRounds = gg.round > gg.rounds || gg.round > 15;
  const duelDecided = gg.gameMode === "duels" && gg.duelOver;
  const brDecided = gg.gameMode === "br" && gg.alive.size <= 1;
  if (outOfRounds || duelDecided || brDecided) {
    gg.room.send("gameover", {
      scoreboard: gg.scoreboard, history: gg.history,
      hp: gg.hp, teamScore: gg.teamScore, eliminated: gg.eliminated, alive: [...gg.alive],
    });
    return;
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
  const expected = gg.gameMode === "br"
    ? gg.roundStartPlayers.filter(p => gg.alive.has(p.playerId)).length
    : gg.roundStartPlayers.length;
  if (Object.keys(gg.currentGuesses).length >= (expected || 1)) hostFinishRound();
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

  // Duels: distance-based damage to the opponent (real-GeoGuessr style HP).
  let damage = {};
  if (gg.gameMode === "duels" && guesses.length === 2) {
    const [a, b] = guesses;
    damage[a.playerId] = Math.max(0, a.pts - b.pts);
    damage[b.playerId] = Math.max(0, b.pts - a.pts);
    gg.hp[b.playerId] = Math.max(0, (gg.hp[b.playerId] ?? 5000) - damage[a.playerId]);
    gg.hp[a.playerId] = Math.max(0, (gg.hp[a.playerId] ?? 5000) - damage[b.playerId]);
    if (gg.hp[a.playerId] <= 0 || gg.hp[b.playerId] <= 0) gg.duelOver = true;
  }

  // Team Duels: only the team's best guess this round counts.
  if (gg.gameMode === "teamduels") {
    ["A", "B"].forEach((team) => {
      const teamGuesses = guesses.filter((g) => gg.teams[g.playerId] === team);
      if (teamGuesses.length) gg.teamScore[team] = (gg.teamScore[team] || 0) + Math.max(...teamGuesses.map((g) => g.pts));
    });
  }

  // Battle Royale: whoever guessed worst this round is out (unless everyone tied).
  let eliminatedThisRound = [];
  if (gg.gameMode === "br") {
    const aliveGuesses = guesses.filter((g) => gg.alive.has(g.playerId));
    if (aliveGuesses.length > 1) {
      const minPts = Math.min(...aliveGuesses.map((g) => g.pts));
      const worst = aliveGuesses.filter((g) => g.pts === minPts);
      if (worst.length < aliveGuesses.length) {
        worst.forEach((g) => { gg.alive.delete(g.playerId); gg.eliminated.push(g.name); eliminatedThisRound.push(g.name); });
      }
    }
  }

  gg.history.push({ round: gg.round, country: answer.countryHint, guesses });
  gg.room.send("results", {
    round: gg.round, total: gg.rounds, answer, guesses, scoreboard: gg.scoreboard,
    gameMode: gg.gameMode, damage, hp: gg.hp, teamScore: gg.teamScore,
    eliminatedThisRound, eliminated: gg.eliminated, alive: [...gg.alive], duelOver: gg.duelOver,
  });
  gg.finishingRound = false;
}

function onMpResults(payload) {
  if (payload.round !== gg.round) return;
  clearRoundTimer();
  gg.scoreboard = payload.scoreboard;
  if (payload.hp) gg.hp = payload.hp;
  if (payload.teamScore) gg.teamScore = payload.teamScore;
  if (payload.alive) gg.alive = new Set(payload.alive);
  if (payload.eliminated) gg.eliminated = payload.eliminated;
  if (payload.duelOver) gg.duelOver = true;
  gg.submitted = true;
  if (gg.map) { clearGoogleMap(gg.map); gg.map = null; gg.guessMarker = null; }
  if (gg.resultMap) { clearGoogleMap(gg.resultMap); gg.resultMap = null; }
  document.getElementById("ggFullscreenWrap")?.remove();
  drawMpResultsScreen(payload);
}

function drawMpResultsScreen(payload) {
  const sorted = [...payload.guesses].sort((a, b) => b.pts - a.pts);
  const isLast = gg.round >= gg.rounds
    || (gg.gameMode === "duels" && gg.duelOver)
    || (gg.gameMode === "br" && gg.alive.size <= 1);

  const modeExtraHtml = (() => {
    if (gg.gameMode === "duels" && payload.hp) {
      return `<div class="card" style="cursor:default; margin-top:10px;">
        <h3 style="margin-bottom:10px;">❤️ Levens</h3>
        ${Object.entries(payload.hp).map(([pid, hp]) => {
          const g = payload.guesses.find(x => x.playerId === pid);
          const name = g ? g.name : (gg.scoreboard[pid]?.name || "Speler");
          const pct = Math.max(0, Math.min(100, Math.round(hp / 5000 * 100)));
          const dmg = payload.damage?.[pid] || 0;
          return `<div style="margin-bottom:8px;">
            <div class="small" style="display:flex; justify-content:space-between;"><span>${name}</span><span>${hp} hp${dmg ? ` · +${dmg} schade` : ""}</span></div>
            <div class="gg-hp-track"><div class="gg-hp-fill" style="width:${pct}%;"></div></div>
          </div>`;
        }).join("")}
      </div>`;
    }
    if (gg.gameMode === "teamduels" && payload.teamScore) {
      return `<div class="card" style="cursor:default; margin-top:10px; text-align:center;">
        <h3 style="margin-bottom:10px;">⚔️ Teamscore</h3>
        <div style="display:flex; justify-content:center; gap:24px; font-size:18px; font-weight:700;">
          <span>Team A: ${payload.teamScore.A || 0}</span><span>Team B: ${payload.teamScore.B || 0}</span>
        </div>
      </div>`;
    }
    if (gg.gameMode === "br" && payload.eliminatedThisRound?.length) {
      return `<div class="card" style="cursor:default; margin-top:10px; text-align:center;">
        <span class="icon">❌</span><h3>Uitgeschakeld</h3>
        <p>${payload.eliminatedThisRound.join(", ")}</p>
        <p class="small">Nog over: ${payload.alive.length}</p>
      </div>`;
    }
    return "";
  })();

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
    ${modeExtraHtml}
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
  if (payload.hp) gg.hp = payload.hp;
  if (payload.teamScore) gg.teamScore = payload.teamScore;
  if (payload.alive) gg.alive = new Set(payload.alive);
  if (payload.eliminated) gg.eliminated = payload.eliminated;
  const sorted = Object.values(payload.scoreboard).sort((a, b) => b.total - a.total);
  const setOptions = Object.entries(LOCATION_SETS)
    .map(([key, s]) => `<option value="${key}" ${key === gg.locationSet ? "selected" : ""}>${s.label}</option>`).join("");

  let winnerText = sorted[0] ? sorted[0].name + " wint!" : "Klaar!";
  let extraWinnerHtml = "";
  if (gg.gameMode === "duels" && payload.hp) {
    const entries = Object.entries(payload.hp);
    const nameFor = (pid) => gg.scoreboard[pid]?.name || "Speler";
    if (entries.length === 2) {
      const [[pidA, hpA], [pidB, hpB]] = entries;
      winnerText = `${hpA >= hpB ? nameFor(pidA) : nameFor(pidB)} wint het duel!`;
      extraWinnerHtml = `<p class="small">${nameFor(pidA)}: ${hpA} hp · ${nameFor(pidB)}: ${hpB} hp</p>`;
    }
  } else if (gg.gameMode === "teamduels" && payload.teamScore) {
    const winTeam = (payload.teamScore.A || 0) >= (payload.teamScore.B || 0) ? "A" : "B";
    winnerText = `Team ${winTeam} wint!`;
    extraWinnerHtml = `<p class="small">Team A: ${payload.teamScore.A || 0} · Team B: ${payload.teamScore.B || 0}</p>`;
  } else if (gg.gameMode === "br" && payload.alive) {
    const aliveNames = payload.alive.map((pid) => gg.scoreboard[pid]?.name).filter(Boolean);
    if (aliveNames.length === 1) winnerText = `${aliveNames[0]} wint Battle Royale!`;
  }

  app.innerHTML = `
    ${topbar()}
    <div class="gametitle"><div><h2>📍 GeoGuesser</h2><div class="desc">Eindresultaat · Lobby ${gg.room.code}</div></div></div>
    <div class="card" style="cursor:default; text-align:center;">
      <span class="icon">🏁</span>
      <h3>${winnerText}</h3>
      ${extraWinnerHtml}
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
  gg.room.send("restart", { rounds, locationSet: locSet, roundTime, gameMode: gg.gameMode });
  gg.room.send("settings", { rounds, locationSet: locSet, roundTime, gameMode: gg.gameMode });
  window.ggMpStartGame();
};

function onMpRestart(payload) {
  if (gg.isHost) return;
  gg.rounds = payload.rounds; gg.locationSet = payload.locationSet;
  gg.roundTime = payload.roundTime ?? null;
  gg.gameMode = payload.gameMode ?? gg.gameMode;
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
  const noMove = gg.difficulty === "nomove" || gg.difficulty === "nmpz";
  gg.panorama = createPanorama(maps, el, round, { noMove });
  el.classList.toggle("gg-grayscale", !!gg.blackwhite);

  // NMPZ: no movement, no panning/zooming at all — a transparent blocker
  // absorbs every mouse/touch/scroll event before it reaches the panorama.
  // The Street View API has no "freeze" option, so this is the reliable way.
  if (gg.difficulty === "nmpz") {
    const wrap = document.getElementById("ggFullscreenWrap");
    if (wrap && !document.getElementById("ggNmpzBlocker")) {
      const blocker = document.createElement("div");
      blocker.id = "ggNmpzBlocker";
      blocker.className = "gg-nmpz-blocker";
      wrap.insertBefore(blocker, wrap.querySelector(".gg-hud-top") || null);
    }
  }

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
