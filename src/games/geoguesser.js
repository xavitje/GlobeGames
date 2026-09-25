import { GEO_POINTS, LOCATION_SETS } from "../data/geoPoints.js";
import { ALL_NAMES, haversineKm, topbar, attachAutocomplete, candidateNames, findCountryByLoose, icon, PLAYER_COLORS } from "../core.js";
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
import { getProfile, saveProfile } from "../lib/profile.js";
import { adSlotHtml, initAdSlots } from "../lib/ads.js";

let app;
let gg = null;

// ---------- Geheime hint (alleen voor mij) ----------
// Typ dit woord ergens tijdens een ronde (het maakt niet uit waar de focus
// staat) om een klein antwoordje in de hoek aan/uit te zetten. Niemand
// anders komt hier per ongeluk achter — de knop bestaat nergens in de UI.
// Listener staat op de capture-fase van window, zodat ook een handler die
// ergens anders stopPropagation() aanroept 'm niet kan blokkeren.
const GG_CHEAT_WORD = "xyzzy";
let ggCheatBuffer = "";
let ggCheatOn = false;
window.addEventListener("keydown", (e) => {
  if (!e.key || e.key.length !== 1 || !/[a-z]/i.test(e.key)) return;
  ggCheatBuffer = (ggCheatBuffer + e.key.toLowerCase()).slice(-GG_CHEAT_WORD.length);
  if (ggCheatBuffer === GG_CHEAT_WORD) {
    ggCheatOn = !ggCheatOn;
    ggCheatBuffer = "";
    updateCheatHint();
    ggCheatToast(ggCheatOn ? icon("lockOpen", { size: "sm" }) : icon("lockClosed", { size: "sm" }));
  }
}, true);

// Piepklein bevestigingsvinkje rechtsboven zodra je het woord typt, zodat je
// weet dat het geschakeld is zelfs als je de hint zelf niet meteen ziet
// (bv. omdat er nog geen ronde loopt). Verdwijnt vanzelf na een seconde.
function ggCheatToast(symbol) {
  document.getElementById("ggCheatToast")?.remove();
  const el = document.createElement("div");
  el.id = "ggCheatToast";
  el.className = "gg-cheat-toast";
  el.innerHTML = symbol;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1000);
}

function updateCheatHint() {
  const wrap = document.getElementById("ggFullscreenWrap");
  document.getElementById("ggCheatHint")?.remove();
  if (!ggCheatOn || !wrap || !gg?.current?.countryHint) return;
  const hint = document.createElement("div");
  hint.id = "ggCheatHint";
  hint.className = "gg-cheat-hint";
  hint.textContent = gg.current.countryHint;
  wrap.appendChild(hint);
}

// Gedeelde speler-kleuren (PLAYER_COLORS) komen nu uit core.js i.p.v. een
// eigen "snoep"-set hier.

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

// All landen waar we punten voor hebben, gesorteerd — voor de "specifiek
// land"-kiezer (solo én multiplayer).
const ALL_GEO_COUNTRIES = Object.keys(GEO_POINTS).sort((a, b) => a.localeCompare(b, "nl"));

// `loc` is ofwel een bestaande preset-key ("world", "europe", ...) ofwel
// een object { type: "country", name } voor een door de speler gekozen land.
function resolveLocationSet(loc) {
  if (loc && typeof loc === "object" && loc.type === "country" && GEO_POINTS[loc.name]) {
    return { label: `${icon("flag", { size: "sm" })} ${loc.name}`, countries: [loc.name], onlyCapital: false };
  }
  return LOCATION_SETS[loc] || LOCATION_SETS["world"];
}

function locationSetLabel(loc) {
  return resolveLocationSet(loc).label;
}

function buildPointFn(loc = "world", rng = Math.random) {
  const set = resolveLocationSet(loc);
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

// Herbruikbare "Locaties"-instelling: de bestaande presets plus een
// "Specifiek land"-optie met een tweede dropdown van alle beschikbare landen.
function locationSettingHtml(idPrefix, current) {
  const isCountry = current && typeof current === "object" && current.type === "country";
  const selectedKey = isCountry ? "country" : (current || "world");
  const presetOptions = Object.entries(LOCATION_SETS)
    .map(([key, s]) => `<option value="${key}" ${key === selectedKey ? "selected" : ""}>${s.label}</option>`)
    .join("");
  const countryOptions = ALL_GEO_COUNTRIES
    .map((name) => `<option value="${name}" ${isCountry && current.name === name ? "selected" : ""}>${name}</option>`)
    .join("");
  return `
    <div class="gg-select-wrap"><select id="${idPrefix}LocationSet" class="gg-select">
      ${presetOptions}
      <option value="country" ${selectedKey === "country" ? "selected" : ""}>Specifiek land</option>
    </select></div>
    <div class="gg-select-wrap" id="${idPrefix}CountryWrap" style="margin-top:8px; ${selectedKey === "country" ? "" : "display:none;"}">
      <select id="${idPrefix}CountrySelect" class="gg-select">${countryOptions}</select>
    </div>`;
}

function wireLocationSetting(idPrefix) {
  const sel = document.getElementById(`${idPrefix}LocationSet`);
  const wrap = document.getElementById(`${idPrefix}CountryWrap`);
  if (!sel || !wrap) return;
  sel.addEventListener("change", () => {
    wrap.style.display = sel.value === "country" ? "" : "none";
  });
}

function readLocationSetting(idPrefix) {
  const sel = document.getElementById(`${idPrefix}LocationSet`);
  const val = sel?.value || "world";
  if (val === "country") {
    const name = document.getElementById(`${idPrefix}CountrySelect`)?.value;
    return name ? { type: "country", name } : "world";
  }
  return val;
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
  return `GlobeGames Daily #${dailyDayNumber()} — ${result.totalScore}/${result.rounds * 5000} pts\n${blocks}\n${location.origin}/geoguesser`;
}

function scoreForDistance(km) {
  if (km < 20) return 5000;
  return Math.max(0, Math.round(5000 * Math.exp(-km / 2000)));
}

// ---------- Multiplayer round timer (host-configurable) ----------

// ---------- Moeilijkheidsgraad + zwart-wit (gedeeld tussen solo en mp) ----------

function difficultySettingHtml(idPrefix, difficulty, blackwhite) {
  const d = difficulty || "free";
  return `
    <label class="gg-label" style="margin-top:16px;">Moeilijkheidsgraad</label>
    <div class="gg-pill-row" id="${idPrefix}DifficultyPills">
      <button class="gg-pill-btn${d === "free" ? " active" : ""}" data-v="free">Vrij bewegen</button>
      <button class="gg-pill-btn${d === "nomove" ? " active" : ""}" data-v="nomove">Niet bewegen</button>
      <button class="gg-pill-btn${d === "nmpz" ? " active" : ""}" data-v="nmpz">NMPZ</button>
      <button class="gg-pill-btn${d === "gamble" ? " active" : ""}" data-v="gamble" title="Vrij bewegen, maar na elke ronde mag je je punten veilig incasseren of verdubbelen bij het rad.">${icon("chip", { size: "sm" })} Gokken</button>
    </div>
    <label style="display:flex; align-items:center; gap:8px; margin-top:14px; font-size:13px; cursor:pointer;">
      <input type="checkbox" id="${idPrefix}BlackWhite" ${blackwhite ? "checked" : ""} /> Zwart-wit
    </label>`;
}

function wireDifficultySetting(idPrefix) {
  const row = document.getElementById(`${idPrefix}DifficultyPills`);
  if (!row) return;
  row.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-v]"); if (!btn) return;
    row.querySelectorAll(".gg-pill-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
  });
}

function readDifficultySetting(idPrefix) {
  const btn = document.querySelector(`#${idPrefix}DifficultyPills .gg-pill-btn.active`);
  return {
    difficulty: btn ? btn.dataset.v : "free",
    blackwhite: !!document.getElementById(`${idPrefix}BlackWhite`)?.checked,
  };
}

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
      pill.innerHTML = `${icon("clock", { size: "sm" })} ${m}:${String(s).padStart(2, "0")}`;
      pill.classList.toggle("gg-hud-timer-low", remain <= 10);
    }
    if (remain <= 0) { clearRoundTimer(); onRoundTimeUp(); }
  };
  tick();
  gg.roundTimer = setInterval(tick, 250);
}

function onRoundTimeUp() {
  if (!gg) return;
  if (gg.mode === "mp") {
    if (gg.screen !== "round") return;
    if (!gg.submitted) {
      if (gg.guess) {
        submitMpGuess();
      } else {
        gg.submitted = true;
        const btn = document.getElementById("ggSubmitBtn");
        if (btn) btn.disabled = true;
        const info = document.getElementById("ggGuessInfo");
        if (info) info.textContent = "Tijd voorbij — geen gok geplaatst";
      }
    }
    if (gg.isHost) hostFinishRound();
  } else if (gg.mode === "solo" || gg.mode === "daily") {
    if (gg.submitted) return;
    if (gg.guess) submitSoloGuess();
    else forceSoloTimeout();
  } else if (gg.mode === "streak") {
    if (gg.streakLocked) return;
    forceStreakTimeout();
  }
}

// Ronde niet op tijd afgemaakt (solo/dagelijkse challenge): telt als 0 punten,
// net als een gok die te ver van de juiste plek af zit.
function forceSoloTimeout() {
  gg.submitted = true;
  gg.history.push({ km: null, pts: 0, country: gg.current.countryHint });
  showSoloResultOverlay(null, 0);
}

// Ronde niet op tijd afgemaakt (streak): telt als een fout antwoord, streak eindigt.
function forceStreakTimeout() {
  gg.streakLocked = true;
  showStreakGameOver("(geen antwoord)");
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
  document.getElementById("ggChatWidget")?.remove();
  document.getElementById("ggConnBanner")?.remove();
}

// ---------- Reconnect: onthoud lobby-sessie zodat een page-reload 'm terugvindt ----------

function saveLobbySession() {
  if (!gg?.room) return;
  try {
    sessionStorage.setItem("gg_lobby_session", JSON.stringify({
      code: gg.room.code, playerId: gg.playerId, name: gg.name, isHost: gg.isHost,
    }));
  } catch (e) {}
}
function clearLobbySession() {
  try { sessionStorage.removeItem("gg_lobby_session"); } catch (e) {}
}
function getLobbySession() {
  try {
    const raw = sessionStorage.getItem("gg_lobby_session");
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

// ---------- URL helpers ----------
// Elk scherm van GeoGuesser is bereikbaar via een eigen, deelbaar pad:
// /geoguesser, /geoguesser/singleplayer, /geoguesser/multiplayer, en
// /geoguesser/multiplayer/<CODE> om direct een lobby te joinen/herverbinden.
// We gebruiken replaceState (geen pushState) zodat elke klik door de menu's
// niet de terug-knop van de browser vult met tientallen tussenstappen — de
// URL volgt gewoon waar je bent, zonder een nieuwe geschiedenis-entry.
function setUrlPath(path) {
  history.replaceState(null, "", path);
}
function setLobbyInUrl(code) {
  setUrlPath(code ? `/geoguesser/multiplayer/${code.toUpperCase()}` : "/geoguesser/multiplayer");
}
function clearLobbyFromUrl() { setUrlPath("/geoguesser"); }

// ---------- Entry point ----------

// `routeSegments` komt van main.js' router: het deel van het pad na
// "/geoguesser", bijv. [] voor "/geoguesser", ["singleplayer"], of
// ["multiplayer", "LFFW"].
export function renderGeoGuesser(rootEl, routeSegments = []) {
  app = rootEl;
  teardown();
  gg = null;

  if (!hasGoogleMapsKey()) {
    app.innerHTML = `${topbar()}
      <div class="gametitle"><div><h2>${icon("pin", { size: "sm" })} GeoGuesser</h2><div class="desc">Even instellen voordat je kunt spelen.</div></div></div>
      <div class="card" style="cursor:default;">
        ${icon("key", { size: "xl" })}
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

  // Route: [] -> startscherm, ["singleplayer"] -> direct naar solo-
  // instellingen, ["multiplayer"] -> multiplayer-menu, ["multiplayer", CODE]
  // -> direct joinen/herverbinden met die lobby (vervangt de oude
  // "?lobby="-query, die toch nooit werkte voor gedeelde hash-links).
  const [section, subCode] = routeSegments;
  const savedLobby = hasMultiplayerConfig() ? getLobbySession() : null;

  if (section === "singleplayer") { ggShowSoloSettings(); return; }

  if (section === "multiplayer" && subCode) {
    const code = subCode.toUpperCase();
    if (hasMultiplayerConfig()) {
      if (savedLobby && savedLobby.code === code) drawReconnectPrompt(savedLobby);
      else drawAutoJoinScreen(code);
    } else {
      drawStartScreen();
    }
    return;
  }

  if (section === "multiplayer") {
    if (hasMultiplayerConfig()) ggShowMultiplayerMenu();
    else drawStartScreen();
    return;
  }

  if (savedLobby) { drawReconnectPrompt(savedLobby); return; }
  drawStartScreen();
}

function drawReconnectPrompt(saved) {
  app.innerHTML = `
    ${topbar()}
    <div class="gametitle"><div><h2>${icon("users", { size: "sm" })} Opnieuw verbinden?</h2><div class="desc">Je zat nog in een lobby.</div></div></div>
    <div class="card" style="cursor:default; text-align:center;">
      ${icon("wifi", { size: "xl" })}
      <h3>Opnieuw verbinden met lobby ${saved.code}?</h3>
      <p>Je was verbonden als <strong>${saved.name}</strong>.</p>
    </div>
    <div class="footerrow">
      <button class="btn" onclick="ggDismissReconnect()">Nee, terug naar menu</button>
      <button class="btn primary" onclick="ggReconnectLobby()">Ja, opnieuw verbinden ${icon("chevronRight", { size: "sm" })}</button>
    </div>`;
  window.__ggPendingReconnect = saved;
}

window.ggDismissReconnect = function () {
  clearLobbySession();
  window.__ggPendingReconnect = null;
  drawStartScreen();
};

window.ggReconnectLobby = async function () {
  const saved = window.__ggPendingReconnect;
  window.__ggPendingReconnect = null;
  if (!saved) { drawStartScreen(); return; }
  await enterLobby(saved.code, saved.name, saved.isHost, null, saved.playerId);
};

function drawAutoJoinScreen(code) {
  app.innerHTML = `
    ${topbar()}
    <div class="gametitle"><div><h2>${icon("users", { size: "sm" })} Lobby joinen</h2><div class="desc">Je bent uitgenodigd voor lobby <strong>${code.toUpperCase()}</strong>.</div></div></div>
    <div class="card" style="cursor:default;">
      <h3 style="margin-bottom:10px;">Jouw naam</h3>
      <input id="ggAutoJoinName" type="text" placeholder="Typ je naam..." maxlength="18" value="${getProfile().name || ''}"
        style="width:100%; padding:10px 12px; border-radius:10px; border:1px solid var(--border); background:var(--panel2); color:inherit; font-size:14px;" />
    </div>
    <div class="footerrow">
      <button class="btn" onclick="ggShowStart()">${icon("chevronLeft", { size: "sm" })} Terug</button>
      <button class="btn primary" onclick="ggAutoJoin('${code}')">Joinen ${icon("chevronRight", { size: "sm" })}</button>
    </div>`;
}

window.ggAutoJoin = async function (code) {
  const input = document.getElementById("ggAutoJoinName");
  const typed = (input?.value.trim()) || "";
  if (typed) {
    const p = getProfile();
    if (p.name !== typed) saveProfile({ ...p, name: typed });
  }
  const name = typed || "Speler" + Math.floor(Math.random() * 900 + 100);
  await enterLobby(code, name, false, null);
};

function drawStartScreen() {
  clearLobbyFromUrl();
  const mpAvailable = hasMultiplayerConfig();
  const streakBest = getStreakBest();
  const dailyResult = getDailyResult();
  app.innerHTML = `
    ${topbar()}
    <div class="gametitle"><div><h2>${icon("pin", { size: "sm" })} GeoGuesser</h2><div class="desc">Waar op aarde is dit?</div></div></div>
    <div class="card" style="cursor:pointer;" onclick="ggShowSoloSettings()">
      ${icon("user", { size: "lg" })}<h3>Solo spelen</h3>
      <p>Kies je rondes, locaties en moeilijkheidsgraad.</p>
    </div>
    <div class="card" style="cursor:pointer; margin-top:12px;" onclick="ggStartStreak()">
      ${icon("flame", { size: "lg" })}<h3>Streak</h3>
      <p>Raad landen op rij, zo lang je kan. Beste streak: <strong>${streakBest}</strong></p>
    </div>
    <div class="card" style="cursor:pointer; margin-top:12px;" onclick="ggStartDaily()">
      ${icon("calendar", { size: "lg" })}<h3>Dagelijkse challenge</h3>
      <p>${dailyResult ? `Vandaag al gespeeld: <strong>${dailyResult.totalScore} pts</strong> — bekijk je resultaat.` : "5 vaste rondes, elke dag hetzelfde voor iedereen."}</p>
    </div>
    <div class="card" style="cursor:${mpAvailable ? "pointer" : "default"}; opacity:${mpAvailable ? "1" : "0.55"}; margin-top:12px;"
      ${mpAvailable ? 'onclick="ggShowMultiplayerMenu()"' : ""}>
      ${icon("users", { size: "lg" })}<h3>Met vrienden (multiplayer)</h3>
      <p>${mpAvailable ? "Maak een lobby of join er een met een code." : "Multiplayer niet ingesteld (Supabase-variabelen ontbreken)."}</p>
    </div>
    ${adSlotHtml("geoguesserSettings")}`;
  initAdSlots();
}

// ---------- Solo settings ----------

window.ggShowSoloSettings = function (prefill = {}) {
  setUrlPath("/geoguesser/singleplayer");
  const ar = prefill.rounds || 5;
  app.innerHTML = `
    ${topbar()}
    <div class="gametitle"><div><h2>${icon("user", { size: "sm" })} Solo spelen</h2><div class="desc">Kies je instellingen.</div></div></div>
    <div class="card" style="cursor:default;">
      <h3 style="margin-bottom:14px;">Instellingen</h3>
      <label class="gg-label">Aantal rondes</label>
      <div class="gg-pill-row" id="soloRoundPills">
        ${[3,5,7,10].map(n => `<button class="gg-pill-btn${n===ar?" active":""}" data-v="${n}">${n}</button>`).join("")}
      </div>
      <label class="gg-label" style="margin-top:16px;">Locaties</label>
      ${locationSettingHtml("solo", prefill.locationSet)}
      <label class="gg-label" style="margin-top:16px;">Moeilijkheidsgraad</label>
      <div class="gg-pill-row" id="soloDifficultyPills">
        <button class="gg-pill-btn${(prefill.difficulty || "free") === "free" ? " active" : ""}" data-v="free">Vrij bewegen</button>
        <button class="gg-pill-btn${prefill.difficulty === "nomove" ? " active" : ""}" data-v="nomove">Niet bewegen</button>
        <button class="gg-pill-btn${prefill.difficulty === "nmpz" ? " active" : ""}" data-v="nmpz">NMPZ</button>
        <button class="gg-pill-btn${prefill.difficulty === "gamble" ? " active" : ""}" data-v="gamble" title="Vrij bewegen, maar na elke ronde mag je je punten veilig incasseren of verdubbelen bij het rad.">${icon("chip", { size: "sm" })} Gokken</button>
      </div>
      <label style="display:flex; align-items:center; gap:8px; margin-top:14px; font-size:13px; cursor:pointer;">
        <input type="checkbox" id="soloBlackWhite" ${prefill.blackwhite ? "checked" : ""} /> Zwart-wit
      </label>
    </div>
    ${adSlotHtml("geoguesserSettings")}
    <div class="footerrow">
      <button class="btn" onclick="ggShowStart()">${icon("chevronLeft", { size: "sm" })} Terug</button>
      <button class="btn primary" onclick="ggStartSolo()">Spelen ${icon("chevronRight", { size: "sm" })}</button>
    </div>`;
  initAdSlots();
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
  wireLocationSetting("solo");
};

window.ggShowStart = function () { drawStartScreen(); };

window.ggStartSolo = function () {
  const roundBtn = document.querySelector("#soloRoundPills .gg-pill-btn.active");
  const rounds = roundBtn ? parseInt(roundBtn.dataset.v, 10) : 5;
  const locSet = readLocationSetting("solo");
  const diffBtn = document.querySelector("#soloDifficultyPills .gg-pill-btn.active");
  const difficulty = diffBtn ? diffBtn.dataset.v : "free";
  const blackwhite = !!document.getElementById("soloBlackWhite")?.checked;
  gg = { mode: "solo", round: 0, totalScore: 0, rounds, locationSet: locSet, difficulty, blackwhite,
    pointFn: buildPointFn(locSet), usedPanos: new Set(), history: [],
    current: null, guess: null, map: null, guessMarker: null, resultMap: null, panorama: null,
    pendingPts: null, pendingKm: null, gambleStats: { rounds: 0, staked: 0, won: 0 } };
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
      <button class="gg-hud-back-btn" onclick="ggExitToStart()">${icon("close", { size: "sm" })}</button>
      <span class="gg-hud-pill">${roundLabel}</span>
    </div>`;
  document.body.appendChild(wrap);
}

async function nextSoloRound() {
  gg.round++;
  await loadAndDrawSoloRound();
}

// Haal een nieuwe locatie op voor de HUIDIGE ronde (ronde-nummer blijft gelijk).
// Gebruikt voor zowel "volgende ronde" (na ++) als de "andere locatie"-knop,
// voor het geval iemand toch nog in een onspeelbare plek (bv. een gebouw
// zonder uitgang) terechtkomt ondanks het filter op navigeerbare links.
async function loadAndDrawSoloRound() {
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
      <div class="gametitle"><div><h2>${icon("pin", { size: "sm" })} GeoGuesser</h2></div></div>
      <div class="card" style="cursor:default;">
        ${icon("wifi", { size: "xl" })}<h3>Geen Street View gevonden</h3>
        <p>Probeer het opnieuw.</p>
        <button class="btn primary" onclick="ggStartSolo()" style="margin-top:10px;">Opnieuw</button>
      </div>`;
    return;
  }

  gg.current = round;
  drawRoundScreen({ roundLabel: `Ronde ${gg.round} / ${gg.rounds}`, scoreLabel: `${gg.totalScore} pts`, onSubmit: submitSoloGuess });
  initPanorama(round);
  initMap(maps);
  startRoundTimer(120);
}

// Zit je vast (bv. binnen in een gebouw zonder uitgang, of een technische
// glitch waarbij lopen/draaien niet meer werkt)? Haal een nieuwe locatie op
// voor dezelfde ronde, zonder dat dit als een gok telt.
window.ggRerollRound = function () {
  if (!gg) return;
  if ((gg.mode === "solo" || gg.mode === "daily") && !gg.submitted) {
    loadAndDrawSoloRound();
  } else if (gg.mode === "streak" && !gg.streakLocked) {
    nextStreakRound();
  }
};

function submitSoloGuess() {
  if (!gg.guess) return;
  clearRoundTimer();
  gg.submitted = true;
  const km = haversineKm(gg.guess, [gg.current.lng, gg.current.lat]);
  const pts = scoreForDistance(km);
  // Gokmodus: de punten van deze ronde worden pas bijgeschreven nadat je
  // kiest om ze veilig te incasseren of te verdubbelen bij het rad — zie
  // ggBankPoints()/ggOpenWager() hieronder. Bij 0 punten valt er niets te
  // wagen, dus dan telt de ronde meteen mee zoals normaal.
  if (gg.difficulty === "gamble" && pts > 0) {
    gg.pendingPts = pts;
    gg.pendingKm = km;
    showSoloResultOverlay(km, pts, { pending: true });
  } else {
    gg.totalScore += pts;
    gg.history.push({ km, pts, country: gg.current.countryHint });
    showSoloResultOverlay(km, pts);
  }
}

function showSoloResultOverlay(km, pts, opts = {}) {
  const pending = !!opts.pending;
  const corner = document.getElementById("ggMapCorner");
  if (corner) corner.style.display = "none";
  if (gg.map) { clearGoogleMap(gg.map); gg.map = null; gg.guessMarker = null; }

  const wrap = document.getElementById("ggFullscreenWrap");
  if (!wrap) return;

  const overlay = document.createElement("div");
  overlay.id = "ggResultOverlay";
  overlay.className = "gg-result-overlay";
  const statLine = km == null
    ? `${icon("clock", { size: "sm" })} Tijd voorbij — geen gok geplaatst · <strong>${pts} pts</strong> · Totaal: ${gg.totalScore}`
    : pending
      ? `${icon("ruler", { size: "sm" })} ${Math.round(km).toLocaleString()} km · <strong>${pts} pts</strong> verdiend — nog niet ingecasseerd`
      : `${icon("ruler", { size: "sm" })} ${Math.round(km).toLocaleString()} km · <strong>${pts} pts</strong> · Totaal: ${gg.totalScore}`;
  overlay.innerHTML = `
    <div class="gg-result-header">
      <div class="gg-result-country">${gg.current.countryHint}</div>
      <div class="gg-result-stat">${statLine}</div>
    </div>
    <div id="ggResultMap" class="gg-result-map"></div>
    ${pending ? `
    <div class="gg-wager-panel" id="ggWagerPanel">
      <p class="small">${icon("chip", { size: "sm" })} Gokmodus: incasseer je ${pts} pts veilig, of waag ze bij het rad voor een kans op meer — of alles kwijt.</p>
      <div class="gg-wager-actions">
        <button class="btn" onclick="ggBankPoints()">${icon("check", { size: "sm" })} Veilig incasseren (+${pts})</button>
        <button class="btn primary" onclick="ggOpenWager()">${icon("chip", { size: "sm" })} Waag ze bij het rad</button>
      </div>
    </div>` : ""}
    ${adSlotHtml("geoguesserResults")}
    <div class="gg-result-footer">
      <button class="btn primary" id="ggNextRoundBtn" style="${pending ? "display:none;" : ""}">
        ${gg.round < gg.rounds ? `Volgende ronde ${icon("chevronRight", { size: "sm" })}` : "Bekijk eindscore"}
      </button>
    </div>`;
  wrap.appendChild(overlay);
  initAdSlots();

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
  window.__ggSoloReplayPrefill = { rounds: savedRounds, locationSet: savedLoc };
  app.innerHTML = `
    ${topbar()}
    <div class="gametitle"><div><h2>${icon("pin", { size: "sm" })} GeoGuesser</h2><div class="desc">Eindresultaat</div></div></div>
    <div class="card" style="cursor:default; text-align:center;">
      ${icon("flag", { size: "xl" })}
      <h3>${gg.totalScore} / ${gg.rounds * 5000} punten</h3>
      <p>Gemiddeld ${avg} punten per ronde.</p>
    </div>
    <div class="guesslist" style="margin-top:14px;">
      ${gg.history.map((h, i) => `<div class="gitem">
        <div class="name">Ronde ${i+1} · ${h.country}${h.gambled ? (h.gambleWon ? ` ${icon("chip", { size: "sm" })}${icon("check", { size: "sm" })}` : ` ${icon("chip", { size: "sm" })}${icon("close", { size: "sm" })}`) : ""}</div>
        <div class="dist">${h.km == null ? "—" : Math.round(h.km).toLocaleString() + " km"}</div>
        <div></div><div class="prox">${h.pts} pts</div>
      </div>`).join("")}
    </div>
    ${gg.gambleStats?.rounds > 0 ? `
    <div class="card" style="cursor:default; text-align:center; margin-top:12px;">
      ${icon("chip", { size: "xl" })}
      <h3>${gg.gambleStats.rounds} keer gegokt</h3>
      <p>${gg.gambleStats.staked} pts ingezet, ${gg.gambleStats.won} pts uitbetaald.</p>
    </div>` : ""}
    ${adSlotHtml("geoguesserResults")}
    <div class="footerrow">
      <button class="btn" onclick="ggShowStart()">${icon("chevronLeft", { size: "sm" })} Menu</button>
      <button class="btn primary" onclick="ggReplaySoloSettings()">${icon("refresh", { size: "sm" })} Opnieuw spelen</button>
    </div>`;
  initAdSlots();
}

window.ggReplaySoloSettings = function () {
  ggShowSoloSettings(window.__ggSoloReplayPrefill || {});
};

window.ggExitToStart = function () { teardown(); drawStartScreen(); };

// ---------- Streak mode ----------

window.ggStartStreak = function () {
  gg = { mode: "streak", streak: 0, best: getStreakBest(), difficulty: "free", blackwhite: false,
    streakLocked: false,
    pointFn: buildPointFn("world"), usedPanos: new Set(), current: null, panorama: null };
  nextStreakRound();
};

async function nextStreakRound() {
  gg.panorama = null;
  gg.streakLocked = false;
  drawFullscreenLoading(`${icon("flame", { size: "sm" })} Streak: ${gg.streak}`);
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
      <div class="gametitle"><div><h2>${icon("flame", { size: "sm" })} Streak</h2></div></div>
      <div class="card" style="cursor:default;">
        ${icon("wifi", { size: "xl" })}<h3>Geen Street View gevonden</h3>
        <p>Probeer het opnieuw.</p>
        <button class="btn primary" onclick="ggStartStreak()" style="margin-top:10px;">Opnieuw</button>
      </div>`;
    return;
  }

  gg.current = round;
  drawStreakRoundScreen();
  initPanorama(round);
  startRoundTimer(120);
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
      <button class="gg-hud-back-btn" onclick="ggExitToStart()">${icon("close", { size: "sm" })}</button>
      <span class="gg-hud-pill">${icon("flame", { size: "sm" })} Streak: ${gg.streak}</span>
      <span class="gg-hud-pill">Beste: ${gg.best}</span>
      <button class="gg-hud-pill gg-hud-reroll" onclick="ggRerollRound()" title="Zit je vast? Krijg een andere locatie.">${icon("refresh", { size: "sm" })} Andere locatie</button>
    </div>
    <div class="gg-streak-panel" id="ggStreakPanel">
      <div class="gg-map-corner-header"><span class="gg-map-guess-info">Welk land is dit?</span></div>
      <div style="padding:0 14px 14px; position:relative;">
        <input id="ggStreakInput" type="text" autocomplete="off" placeholder="Typ een land..."
          style="width:100%; padding:10px 12px; border-radius:10px; border:1px solid var(--border); background:var(--panel2); color:inherit; font-size:14px;" />
        <div class="autocomplete" id="ggStreakAuto"></div>
      </div>
      <div class="gg-map-footer">
        <button class="btn primary gg-submit-btn" id="ggSubmitBtn">${icon("pin", { size: "sm" })} Bevestig gok</button>
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
  if (gg.streakLocked) return;
  const input = document.getElementById("ggStreakInput");
  const guess = findCountryByLoose(input?.value || "");
  if (!guess) { input?.focus(); return; }
  gg.streakLocked = true;
  clearRoundTimer();
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
    <div class="gametitle"><div><h2>${icon("flame", { size: "sm" })} Streak voorbij</h2></div></div>
    <div class="card" style="cursor:default; text-align:center;">
      ${icon("warning", { size: "xl" })}
      <h3>Streak: ${gg.streak}</h3>
      <p>Het juiste antwoord was <strong>${gg.current.countryHint}</strong>, jij gokte <strong>${guess}</strong>.</p>
      <p class="small">${isNewBest ? `${icon("trophy", { size: "sm" })} Nieuwe beste streak!` : `Beste streak: ${gg.best}`}</p>
      <button class="btn primary" onclick="ggStartStreak()" style="margin-top:10px;">Opnieuw</button>
    </div>
    ${adSlotHtml("geoguesserResults")}
    <div class="footerrow"><button class="btn" onclick="ggShowStart()">${icon("chevronLeft", { size: "sm" })} Menu</button><div></div></div>`;
  initAdSlots();
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
    <div class="gametitle"><div><h2>${icon("calendar", { size: "sm" })} Dagelijkse challenge</h2><div class="desc">${result.date}</div></div></div>
    <div class="card" style="cursor:default; text-align:center;">
      ${icon("flag", { size: "xl" })}
      <h3>${result.totalScore} / ${result.rounds * 5000} punten</h3>
      <button class="btn primary" id="ggDailyCopyBtn" style="margin-top:10px;">${icon("clipboard", { size: "sm" })} Kopieer resultaat</button>
    </div>
    <div class="guesslist" style="margin-top:14px;">
      ${result.history.map((h, i) => `<div class="gitem">
        <div class="name">Ronde ${i+1} · ${h.country}</div>
        <div class="dist">${Math.round(h.km).toLocaleString()} km</div>
        <div></div><div class="prox">${h.pts} pts</div>
      </div>`).join("")}
    </div>
    ${adSlotHtml("geoguesserResults")}
    <div class="footerrow"><button class="btn" onclick="ggShowStart()">${icon("chevronLeft", { size: "sm" })} Menu</button><div></div></div>`;
  initAdSlots();
  const copyBtn = document.getElementById("ggDailyCopyBtn");
  if (copyBtn) {
    copyBtn.onclick = () => {
      navigator.clipboard.writeText(shareText).catch(() => {});
      copyBtn.innerHTML = `${icon("check", { size: "sm" })} Gekopieerd!`;
      setTimeout(() => { copyBtn.innerHTML = `${icon("clipboard", { size: "sm" })} Kopieer resultaat`; }, 2000);
    };
  }
}

// ---------- Multiplayer: menu ----------

// Kiezen tussen zelf hosten of joinen met een code (net als OpenGuessr).
window.ggShowMultiplayerMenu = function () {
  setUrlPath("/geoguesser/multiplayer");
  app.innerHTML = `
    ${topbar()}
    <div class="gametitle"><div><h2>${icon("users", { size: "sm" })} GeoGuesser multiplayer</h2><div class="desc">Speel dezelfde rondes tegelijk met vrienden.</div></div></div>
    <div class="card" style="cursor:pointer;" onclick="ggShowMpHostSettings()">
      ${icon("plus", { size: "lg" })}<h3>Lobby hosten</h3>
      <p>Stel de spelmodus en instellingen in, maak een kamer aan en deel de code.</p>
    </div>
    <div class="card" style="cursor:pointer; margin-top:12px;" onclick="ggShowMpJoin()">
      ${icon("key", { size: "lg" })}<h3>Lobby joinen</h3>
      <p>Heb je een code van een vriend gekregen? Vul 'm hier in.</p>
    </div>
    <div class="footerrow">
      <button class="btn" onclick="ggShowStart()">${icon("chevronLeft", { size: "sm" })} Terug</button><div></div>
    </div>`;
};

window.ggShowMpHostSettings = function (prefill = {}) {
  const ar = prefill.rounds || 5;
  app.innerHTML = `
    ${topbar()}
    <div class="gametitle"><div><h2>${icon("plus", { size: "sm" })} Lobby hosten</h2><div class="desc">Stel je lobby in en maak 'm aan.</div></div></div>
    <div class="card" style="cursor:default;">
      <h3 style="margin-bottom:10px;">Jouw naam</h3>
      <input id="ggNameInput" type="text" placeholder="Typ je naam..." maxlength="18" value="${prefill.name || getProfile().name || ''}"
        style="width:100%; padding:10px 12px; border-radius:10px; border:1px solid var(--border); background:var(--panel2); color:inherit; font-size:14px;" />
    </div>
    <div class="card" style="cursor:default; margin-top:12px;">
      <h3 style="margin-bottom:14px;">${icon("gear", { size: "sm" })} Lobby-instellingen</h3>
      <label class="gg-label">Spelmodus</label>
      <div class="gg-select-wrap"><select id="mpGameMode" class="gg-select">${gameModeOptionsHtml(prefill.gameMode || "ffa")}</select></div>
      <label class="gg-label" style="margin-top:16px;">Aantal rondes</label>
      <div class="gg-pill-row" id="mpRoundPills">
        ${[3,5,7,10,'∞'].map(n => `<button class="gg-pill-btn${n===ar?" active":""}" data-v="${n}">${n === '∞' ? 'Tot dood' : n}</button>`).join("")}
      </div>
      <label class="gg-label" style="margin-top:16px;">Locaties</label>
      ${locationSettingHtml("mp", prefill.locationSet)}
      ${difficultySettingHtml("mp", prefill.difficulty, prefill.blackwhite)}
      ${timerSettingHtml("mp", prefill.roundTime || null)}
      <label style="display:flex; align-items:center; gap:8px; margin-top:14px; font-size:13px; cursor:pointer;">
        <input type="checkbox" id="mpPowerups" ${prefill.powerups !== false ? "checked" : ""} /> Powerups & sabotages aan
      </label>
    </div>
    ${adSlotHtml("geoguesserSettings")}
    <div class="footerrow">
      <button class="btn" onclick="ggShowMultiplayerMenu()">${icon("chevronLeft", { size: "sm" })} Terug</button>
      <button class="btn primary" onclick="ggHostLobby()">Kamer aanmaken ${icon("chevronRight", { size: "sm" })}</button>
    </div>`;
  initAdSlots();
  document.getElementById("mpRoundPills").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-v]"); if (!btn) return;
    document.querySelectorAll("#mpRoundPills .gg-pill-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
  });
  wireLocationSetting("mp");
  wireDifficultySetting("mp");
  wireTimerSetting("mp");
};

// Code-invoer met losse vakjes per teken, zoals OpenGuessr dat doet.
window.ggShowMpJoin = function (prefill = {}) {
  const codeLen = 4;
  app.innerHTML = `
    ${topbar()}
    <div class="gametitle"><div><h2>${icon("key", { size: "sm" })} Lobby joinen</h2><div class="desc">Vul de code in die je hebt gekregen.</div></div></div>
    <div class="card" style="cursor:default;">
      <h3 style="margin-bottom:10px;">Jouw naam</h3>
      <input id="ggNameInput" type="text" placeholder="Typ je naam..." maxlength="18" value="${prefill.name || getProfile().name || ''}"
        style="width:100%; padding:10px 12px; border-radius:10px; border:1px solid var(--border); background:var(--panel2); color:inherit; font-size:14px;" />
    </div>
    <div class="card" style="cursor:default; text-align:center; margin-top:12px;">
      <h3 style="margin-bottom:16px;">Lobby-code</h3>
      <div class="gg-code-boxes" id="ggCodeBoxes">
        ${Array.from({ length: codeLen }, (_, i) => `<input class="gg-code-box" maxlength="1" data-i="${i}" autocomplete="off" />`).join("")}
      </div>
      <button class="btn primary" id="ggJoinBtn" style="margin-top:20px; width:100%;">Join</button>
    </div>
    ${adSlotHtml("geoguesserSettings")}
    <div class="footerrow">
      <button class="btn" onclick="ggShowMultiplayerMenu()">${icon("chevronLeft", { size: "sm" })} Terug</button><div></div>
    </div>`;
  initAdSlots();

  const boxes = Array.from(document.querySelectorAll(".gg-code-box"));
  boxes.forEach((box, i) => {
    box.addEventListener("input", () => {
      box.value = box.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
      if (box.value && boxes[i + 1]) boxes[i + 1].focus();
    });
    box.addEventListener("keydown", (e) => {
      if (e.key === "Backspace" && !box.value && boxes[i - 1]) boxes[i - 1].focus();
      if (e.key === "Enter") ggSubmitMpJoin();
    });
    box.addEventListener("paste", (e) => {
      e.preventDefault();
      const text = (e.clipboardData.getData("text") || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
      text.split("").forEach((ch, j) => { if (boxes[i + j]) boxes[i + j].value = ch; });
      (boxes[Math.min(i + text.length, boxes.length - 1)])?.focus();
    });
  });
  boxes[0]?.focus();
  document.getElementById("ggJoinBtn").onclick = ggSubmitMpJoin;
};

function ggSubmitMpJoin() {
  const code = Array.from(document.querySelectorAll(".gg-code-box")).map((b) => b.value).join("");
  if (code.length < 4) { alert("Vul een geldige lobby-code van 4 tekens in."); return; }
  window.ggJoinLobby(code);
}

function getPlayerName() {
  const input = document.getElementById("ggNameInput");
  const name = (input?.value.trim()) || "";
  if (name) {
    const p = getProfile();
    if (p.name !== name) saveProfile({ ...p, name });
  }
  return name || "Speler" + Math.floor(Math.random() * 900 + 100);
}

function getMpSettings() {
  const roundBtn = document.querySelector("#mpRoundPills .gg-pill-btn.active");
  const { difficulty, blackwhite } = readDifficultySetting("mp");
  return {
    rounds: roundBtn ? (roundBtn.dataset.v === '∞' ? '∞' : parseInt(roundBtn.dataset.v, 10)) : 5,
    locationSet: readLocationSetting("mp"),
    roundTime: readTimerSetting("mp"),
    gameMode: document.getElementById("mpGameMode")?.value || "ffa",
    powerups: !!document.getElementById("mpPowerups")?.checked,
    difficulty, blackwhite,
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
window.ggJoinLobby = async function (codeArg) {
  const code = (codeArg || document.getElementById("ggCodeInput")?.value.trim() || "").toUpperCase();
  if (code.length < 4) { alert("Vul een geldige lobby-code van 4 tekens in."); return; }
  await enterLobby(code, getPlayerName(), false, null);
};

async function enterLobby(code, name, isHost, settings, existingPlayerId) {
  app.innerHTML = `${topbar()}
    <div class="gametitle"><div><h2>${icon("users", { size: "sm" })} Lobby ${code.toUpperCase()}</h2><div class="desc">Verbinden...</div></div></div>
    <div class="ggphoto-wrap loading"><div class="ggspinner"></div></div>`;

  const playerId = existingPlayerId || randomPlayerId();
  const room = new GameRoom(code, playerId, name);

  gg = { mode: "mp", room, isHost, playerId, name, round: 0,
    rounds: settings?.rounds ?? 5, locationSet: settings?.locationSet ?? "world",
    roundTime: settings?.roundTime ?? null,
    difficulty: settings?.difficulty ?? "free", blackwhite: settings?.blackwhite ?? false,
    powerups: settings?.powerups ?? true,
    gameMode: settings?.gameMode ?? "ffa", teams: {}, hp: {}, alive: new Set(), eliminated: [],
    teamScore: { A: 0, B: 0 },
    pointFn: buildPointFn(settings?.locationSet ?? "world"),
    usedPanos: new Set(), scoreboard: {}, history: [], guess: null, submitted: false,
    map: null, guessMarker: null, resultMap: null, panorama: null,
    pendingMpWager: null,
    currentGuesses: {}, roundStartPlayers: [], roundTimer: null };

  try { await room.connect(); }
  catch (e) {
    app.innerHTML = `${topbar()}
      <div class="card" style="cursor:default;">
        ${icon("warning", { size: "xl" })}<h3>Kon niet verbinden</h3>
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
  room.on("chat", onMpChatReceived);
  room.on("resync", onMpResyncRequest);
  room.on("wager", onMpWagerReceived);
  room.on("scoreupdate", onMpScoreUpdateReceived);
  room.on("sabotage", onMpSabotageReceived);

  room.onConnectionChange((status) => {
    if (status === "disconnected") {
      showConnBanner(`${icon("warning", { size: "sm" })} Verbinding verbroken — opnieuw verbinden...`);
    } else if (status === "reconnected") {
      hideConnBanner();
      // Vraag de host om de huidige rondestatus opnieuw te sturen, zodat we
      // niets gemist hebben tijdens de onderbreking (hergebruikt de
      // bestaande "late-joiner catch-up"-aanpak).
      if (!gg.isHost) gg.room.send("resync", {});
    }
  });

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
        // Alleen de pano-id gaat mee, niet de ruwe lat/lng: anders zou iedereen
        // in de lobby het antwoord al in het Network-tabblad (WS-berichten) kunnen
        // lezen voordat er gegokt is. Elke client zoekt de panorama zelf op via
        // de pano-id (zie createPanorama in streetview.js).
        gg.room.send("round", { round: gg.round, total: gg.rounds, pano: gg.current.pano, countryHint: gg.current.countryHint });
      }
    }
  });

  gg.screen = "lobby";
  setLobbyInUrl(code);
  saveLobbySession();
  ensureChatWidget();
  drawLobbyWaiting();

  // Een pagina-herlaad (via ggReconnectLobby) maakt hier een gloednieuwe
  // GameRoom/verbinding aan — dat is niet dezelfde "reconnected"-tak
  // hierboven in onConnectionChange (die vuurt alleen bij een kortstondig
  // verbroken/hersteld WebSocket binnen dezelfde pagina, niet bij een echte
  // refresh). Zonder dit bleef een herverbonden speler altijd op het
  // lobby-scherm hangen, ook als het spel al bezig was: vraag de host hier
  // ook expliciet om de huidige rondestatus.
  if (!isHost && existingPlayerId) {
    gg.room.send("resync", {});
  }
}

function onMpSettingsReceived(payload) {
  if (gg.isHost) return;
  gg.rounds = payload.rounds; gg.locationSet = payload.locationSet;
  gg.roundTime = payload.roundTime ?? null;
  gg.gameMode = payload.gameMode ?? "ffa";
  gg.difficulty = payload.difficulty ?? "free";
  gg.blackwhite = payload.blackwhite ?? false;
  gg.powerups = payload.powerups ?? true;
  gg.pointFn = buildPointFn(payload.locationSet);
}

function drawLobbyWaiting() {
  const players = gg.room.players();
  const setLabel = locationSetLabel(gg.locationSet);
  const modeLabel = (GAME_MODES[gg.gameMode] || GAME_MODES.ffa).label;
  const shareUrl = `${location.origin}/geoguesser/multiplayer/${gg.room.code}`;
  const isTeamDuels = gg.gameMode === "teamduels";
  const canStart = checkCanStartGame();

  const teamsHtml = !isTeamDuels ? "" : `
    <div class="card" style="cursor:default; margin-top:12px;">
      <h3 style="margin-bottom:10px;">${icon("users", { size: "sm" })} Teams</h3>
      <div class="gg-team-cols">
        ${["A", "B"].map(team => `
          <div class="gg-team-col">
            <div class="gg-team-col-title">Team ${team}</div>
            ${players.filter(p => gg.teams?.[p.playerId] === team).map(p => `
              <div class="gg-team-chip">
                ${p.name}${p.playerId === gg.playerId ? " (jij)" : ""}
                ${gg.isHost ? `<button class="gg-team-swap" onclick="ggSetPlayerTeam('${p.playerId}','${team === "A" ? "B" : "A"}')" title="Naar team ${team === "A" ? "B" : "A"}">${icon("swap", { size: "sm" })}</button>` : ""}
              </div>`).join("") || `<div class="small" style="opacity:0.6;">Nog niemand</div>`}
          </div>`).join("")}
      </div>
      ${gg.isHost ? `<button class="btn" style="margin-top:10px; width:100%;" onclick="ggRandomizeTeams()">${icon("dice", { size: "sm" })} Willekeurig verdelen</button>` : ""}
    </div>`;

  app.innerHTML = `
    ${topbar()}
    <div class="gametitle"><div><h2>${icon("users", { size: "sm" })} Lobby ${gg.room.code}</h2><div class="desc">${gg.isHost ? "Deel de link met je vrienden." : "Wachten tot de host het spel start..."}</div></div></div>
    <div class="card" style="cursor:default; text-align:center;">
      <div class="small">Lobby-code</div>
      <h3 style="font-size:32px; letter-spacing:6px; margin:6px 0;">${gg.room.code}</h3>
      <div class="gg-share-row">
        <input class="gg-share-input" id="ggShareUrl" value="${shareUrl}" readonly />
        <button class="btn" onclick="ggCopyLink()">${icon("clipboard", { size: "sm" })} Kopieer</button>
      </div>
      <div class="small" style="margin-top:8px;">${icon("gear", { size: "sm" })} ${modeLabel} · ${gg.rounds} rondes · ${setLabel}${gg.roundTime ? ` · ${gg.roundTime}s per ronde` : ""} · Powerups: ${gg.powerups !== false ? "Aan" : "Uit"}</div>
    </div>
    ${teamsHtml}
    <div class="guesslist" style="margin-top:14px;">
      ${players.map(p => `<div class="gitem">
        <div class="name">${p.name}${p.playerId === gg.playerId ? " (jij)" : ""}</div>
        <div></div><div></div><div></div>
      </div>`).join("")}
    </div>
    ${gg.isHost && !canStart.ok ? `<div class="small" style="color:var(--danger); margin-top:8px; text-align:center;">${canStart.reason}</div>` : ""}
    ${adSlotHtml("geoguesserLobby")}
    <div class="footerrow">
      <button class="btn" onclick="ggLeaveLobby()">${icon("chevronLeft", { size: "sm" })} Lobby verlaten</button>
      ${gg.isHost ? `<button class="btn" onclick="ggBackToHostSettings()">${icon("gear", { size: "sm" })} Instellingen</button>` : ""}
      ${gg.isHost ? `<button class="btn primary" ${canStart.ok ? "" : "disabled"} onclick="ggMpStartGame()">Start spel ${icon("chevronRight", { size: "sm" })}</button>` : "<div></div>"}
    </div>`;
  initAdSlots();
}

window.ggCopyLink = function () {
  const input = document.getElementById("ggShareUrl");
  if (!input) return;
  navigator.clipboard.writeText(input.value).catch(() => { input.select(); document.execCommand("copy"); });
  const btn = input.nextElementSibling;
  if (btn) { btn.innerHTML = `${icon("check", { size: "sm" })} Gekopieerd!`; setTimeout(() => btn.innerHTML = `${icon("clipboard", { size: "sm" })} Kopieer`, 2000); }
};

window.ggLeaveLobby = function () { teardown(); clearLobbyFromUrl(); clearLobbySession(); drawStartScreen(); };

window.ggBackToHostSettings = function () {
  if (!gg?.isHost) return;
  const prefill = { name: gg.name, rounds: gg.rounds, locationSet: gg.locationSet, gameMode: gg.gameMode, roundTime: gg.roundTime, powerups: gg.powerups };
  teardown();
  clearLobbyFromUrl();
  clearLobbySession();
  ggShowMpHostSettings(prefill);
};

// ---------- Chat (blijft bestaan over alle scherm-wissels in de lobby heen) ----------

function ensureChatWidget() {
  if (!gg?.room || document.getElementById("ggChatWidget")) return;
  const widget = document.createElement("div");
  widget.id = "ggChatWidget";
  widget.className = "gg-chat-widget";
  widget.innerHTML = `
    <button class="gg-chat-toggle" id="ggChatToggle" title="Chat">${icon("chat", { size: "lg" })}</button>
    <div class="gg-chat-panel" id="ggChatPanel">
      <div class="gg-chat-header">
        <span>${icon("chat", { size: "sm" })} Chat</span>
        <button class="gg-chat-close" id="ggChatClose">${icon("close", { size: "sm" })}</button>
      </div>
      <div class="gg-chat-messages" id="ggChatMessages"></div>
      <form class="gg-chat-form" id="ggChatForm">
        <input id="ggChatInput" type="text" maxlength="200" autocomplete="off" placeholder="Typ een bericht..." />
        <button type="submit" class="gg-chat-send">${icon("send", { size: "sm" })}</button>
      </form>
    </div>`;
  document.body.appendChild(widget);

  document.getElementById("ggChatToggle").onclick = () => {
    const isOpen = document.getElementById("ggChatWidget")?.classList.contains("open");
    toggleChatPanel(!isOpen);
  };
  document.getElementById("ggChatClose").onclick = () => toggleChatPanel(false);
  document.getElementById("ggChatForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const input = document.getElementById("ggChatInput");
    const text = (input.value || "").trim();
    if (!text || !gg?.room) return;
    input.value = "";
    appendChatMessage(gg.name, text, true);
    gg.room.send("chat", { name: gg.name, text });
  });
}

function toggleChatPanel(open) {
  const panel = document.getElementById("ggChatPanel");
  const widget = document.getElementById("ggChatWidget");
  if (!panel || !widget) return;
  widget.classList.toggle("open", open);
  if (open) {
    gg.chatUnread = 0;
    updateChatBadge();
    document.getElementById("ggChatInput")?.focus();
  }
}

function appendChatMessage(name, text, isMe) {
  const list = document.getElementById("ggChatMessages");
  if (list) {
    const row = document.createElement("div");
    row.className = "gg-chat-msg" + (isMe ? " me" : "");
    const nameEl = document.createElement("span");
    nameEl.className = "gg-chat-name";
    nameEl.textContent = name;
    const textEl = document.createElement("span");
    textEl.className = "gg-chat-text";
    textEl.textContent = text;
    row.appendChild(nameEl);
    row.appendChild(textEl);
    list.appendChild(row);
    list.scrollTop = list.scrollHeight;
  }
  const isOpen = document.getElementById("ggChatWidget")?.classList.contains("open");
  if (!isMe && !isOpen) {
    gg.chatUnread = (gg.chatUnread || 0) + 1;
    updateChatBadge();
  }
}

function updateChatBadge() {
  const toggle = document.getElementById("ggChatToggle");
  if (!toggle) return;
  let badge = document.getElementById("ggChatBadge");
  if (gg.chatUnread > 0) {
    if (!badge) {
      badge = document.createElement("span");
      badge.id = "ggChatBadge";
      badge.className = "gg-chat-badge";
      toggle.appendChild(badge);
    }
    badge.textContent = gg.chatUnread > 9 ? "9+" : String(gg.chatUnread);
  } else if (badge) {
    badge.remove();
  }
}

function onMpChatReceived(payload) {
  if (payload.from === gg.playerId) return; // eigen bericht is al lokaal getoond
  appendChatMessage(payload.name, payload.text, false);
}

// ---------- Reconnect: verbindingsbanner + host stuurt huidige stand opnieuw ----------

function showConnBanner(text) {
  let banner = document.getElementById("ggConnBanner");
  if (!banner) {
    banner = document.createElement("div");
    banner.id = "ggConnBanner";
    banner.className = "gg-conn-banner";
    document.body.appendChild(banner);
  }
  banner.innerHTML = text;
}

function hideConnBanner() {
  document.getElementById("ggConnBanner")?.remove();
}

// Host-only: een herverbonden speler kan gemist hebben wat er gebeurde —
// stuur de huidige rondestatus (of resultaten/eindstand) opnieuw, net als
// bij een laatkomer die de lobby binnenkomt.
function onMpResyncRequest() {
  if (!gg?.isHost) return;
  // Instellingen altijd meesturen, ongeacht het huidige scherm: een
  // herverbonden speler krijgt na een refresh een gloednieuwe gg-state met
  // de standaardinstellingen (difficulty "free", enz.) — zonder dit blijft
  // bijvoorbeeld gokmodus ("gamble") na een refresh op "free" staan, waardoor
  // het gok-paneel bij de resultaten nooit meer terugkomt, ook al klopt de
  // rest van de rondestatus weer.
  gg.room.send("settings", { rounds: gg.rounds, locationSet: gg.locationSet, roundTime: gg.roundTime, gameMode: gg.gameMode, difficulty: gg.difficulty, blackwhite: gg.blackwhite });
  gg.room.send("teams", { teams: gg.teams });
  if (gg.screen === "round" && gg.current) {
    // Alleen de pano-id gaat mee, niet de ruwe lat/lng: anders zou iedereen
        // in de lobby het antwoord al in het Network-tabblad (WS-berichten) kunnen
        // lezen voordat er gegokt is. Elke client zoekt de panorama zelf op via
        // de pano-id (zie createPanorama in streetview.js).
        gg.room.send("round", { round: gg.round, total: gg.rounds, pano: gg.current.pano, countryHint: gg.current.countryHint });
  } else if (gg.screen === "results" && gg.lastResultsPayload) {
    gg.room.send("results", gg.lastResultsPayload);
  } else if (gg.screen === "gameover" && gg.lastGameOverPayload) {
    gg.room.send("gameover", gg.lastGameOverPayload);
  }
}

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

  gg.room.send("settings", { rounds: gg.rounds, locationSet: gg.locationSet, roundTime: gg.roundTime, gameMode: gg.gameMode, difficulty: gg.difficulty, blackwhite: gg.blackwhite, powerups: gg.powerups });
  gg.room.send("teams", { teams: gg.teams });
  hostAdvanceRound();
};

// ---------- Multiplayer game loop ----------

async function hostAdvanceRound() {
  gg.round++;
  const outOfRounds = gg.rounds === '∞' ? false : gg.round > gg.rounds;
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
  gg.hostAnswer = round;
  // Zie hierboven: bewust geen lat/lng mee, alleen de pano-id.
  gg.room.send("round", { round: gg.round, total: gg.rounds, pano: round.pano, countryHint: round.countryHint });
}

function onMpRoundStart(payload) {
  // Idempotency: existing players ignore re-broadcasts (for late-joiner catch-up)
  if (gg.screen === "round" && gg.round === payload.round) return;
  if (gg.resultMap) { clearGoogleMap(gg.resultMap); gg.resultMap = null; }

  // Powerups & Sabotages
  if (payload.round === 1) {
    if (gg.powerups !== false) {
      const powerups = ["hint", "shield", "5050"];
      const sabotages = ["fakehint", "ink", "nocompass"];
      gg.myPowerup = powerups[Math.floor(Math.random() * powerups.length)];
      gg.mySabotage = sabotages[Math.floor(Math.random() * sabotages.length)];
    } else {
      gg.myPowerup = null;
      gg.mySabotage = null;
    }
    gg.usedPowerup = false;
    gg.usedSabotage = false;
  }
  gg.hasShield = false;
  document.getElementById("ggSabotageInk")?.remove();
  if (gg.panorama) {
    gg.panorama.setOptions({ panControl: !gg.difficulty.includes("nmpz") });
  }

  // Nog niet incasseren/gokken gekozen voor de vorige ronde? Dan schrijf je
  // 'm automatisch veilig bij zodat je niets kwijtraakt door de nieuwe
  // ronde te missen. Sluit ook een eventueel nog open rad-scherm.
  document.getElementById("ggWagerOverlay")?.remove();
  if (gg.pendingMpWager) {
    const pts = gg.pendingMpWager.pts;
    gg.pendingMpWager = null;
    ggMpSendWagerResult(pts);
  }

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
      btn.innerHTML = `${icon("fastForward", { size: "sm" })} Forceer`;
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
  gg.room.send("guess", { round: gg.round, name: gg.name, lat: gg.guess[1], lng: gg.guess[0], shield: gg.hasShield });
  const info = document.getElementById("ggGuessInfo");
  if (info) info.textContent = "Gok verstuurd — wachten op andere spelers...";
  const btn = document.getElementById("ggSubmitBtn");
  if (btn) btn.disabled = true;
}

function onMpGuessReceived(payload) {
  if (!gg.isHost || payload.round !== gg.round) return;
  gg.currentGuesses[payload.from] = { name: payload.name, lat: payload.lat, lng: payload.lng, shield: payload.shield };
  const expected = gg.gameMode === "br"
    ? gg.roundStartPlayers.filter(p => gg.alive.has(p.playerId)).length
    : gg.roundStartPlayers.length;
  if (Object.keys(gg.currentGuesses).length >= (expected || 1)) hostFinishRound();
}

function hostFinishRound() {
  if (!gg.isHost || gg.finishingRound) return;
  gg.finishingRound = true;
  const answer = { lat: gg.hostAnswer.lat, lng: gg.hostAnswer.lng, countryHint: gg.hostAnswer.countryHint };
  const guesses = Object.entries(gg.currentGuesses).map(([playerId, g]) => {
    const km = haversineKm([g.lng, g.lat], [answer.lng, answer.lat]);
    let pts = scoreForDistance(km);
    if (g.shield && gg.gameMode !== "duels") pts = Math.min(5000, pts + 1000);
    if (!gg.scoreboard[playerId]) gg.scoreboard[playerId] = { name: g.name, total: 0 };
    // Gokmodus: de ronde-punten gaan pas op het scorebord als de speler zelf
    // kiest om ze veilig te incasseren of te verdubbelen bij het rad (zie
    // ggMpBankPoints()/ggMpOpenWager() + onMpWagerReceived hieronder) — net
    // als in solo. Andere spelmodi (duels/team duels/BR) blijven altijd op
    // de ruwe ronde-punten rekenen, ongeacht of iemand nog aan het gokken is.
    if (!(gg.difficulty === "gamble" && pts > 0)) {
      gg.scoreboard[playerId].total += pts;
    }
    gg.scoreboard[playerId].name = g.name;
    return { playerId, name: g.name, lat: g.lat, lng: g.lng, km, pts };
  });

  // Duels: distance-based damage to the opponent (real-GeoGuessr style HP).
  let damage = {};
  if (gg.gameMode === "duels" && guesses.length === 2) {
    const [a, b] = guesses;
    const aDmg = Math.max(0, a.pts - b.pts);
    const bDmg = Math.max(0, b.pts - a.pts);
    damage[a.playerId] = a.shield ? Math.round(aDmg / 2) : aDmg;
    damage[b.playerId] = b.shield ? Math.round(bDmg / 2) : bDmg;
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
  gg.screen = "results";
  gg.lastResultsPayload = payload;
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

  // Gokmodus: eigen ronde-punten (nog niet op het scorebord) staan klaar om
  // veilig in te casseren of te wagen — zie ggMpBankPoints()/ggMpOpenWager().
  if (gg.difficulty === "gamble") {
    const own = payload.guesses.find((g) => g.playerId === gg.playerId);
    gg.pendingMpWager = own && own.pts > 0 ? { round: payload.round, pts: own.pts } : null;
  } else {
    gg.pendingMpWager = null;
  }

  drawMpResultsScreen(payload);
}

function drawMpResultsScreen(payload) {
  const sorted = [...payload.guesses].sort((a, b) => b.pts - a.pts);
  const isLast = (gg.rounds !== '∞' && gg.round >= gg.rounds)
    || (gg.gameMode === "duels" && gg.duelOver)
    || (gg.gameMode === "br" && gg.alive.size <= 1);

  const modeExtraHtml = (() => {
    if (gg.gameMode === "duels" && payload.hp) {
      return `<div class="card" style="cursor:default; margin-top:10px;">
        <h3 style="margin-bottom:10px;">${icon("heart", { size: "sm" })} Levens</h3>
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
        <h3 style="margin-bottom:10px;">${icon("users", { size: "sm" })} Teamscore</h3>
        <div style="display:flex; justify-content:center; gap:24px; font-size:18px; font-weight:700;">
          <span>Team A: ${payload.teamScore.A || 0}</span><span>Team B: ${payload.teamScore.B || 0}</span>
        </div>
      </div>`;
    }
    if (gg.gameMode === "br" && payload.eliminatedThisRound?.length) {
      return `<div class="card" style="cursor:default; margin-top:10px; text-align:center;">
        ${icon("close", { size: "xl" })}<h3>Uitgeschakeld</h3>
        <p>${payload.eliminatedThisRound.join(", ")}</p>
        <p class="small">Nog over: ${payload.alive.length}</p>
      </div>`;
    }
    return "";
  })();

  app.innerHTML = `
    ${topbar()}
    <div class="gametitle"><div><h2>${icon("pin", { size: "sm" })} GeoGuesser</h2><div class="desc">Ronde ${gg.round}/${gg.rounds} · resultaten</div></div></div>
    <div class="card" style="cursor:default; padding:0; overflow:hidden;">
      <div id="ggMpResultMap" style="height:300px; border-radius:var(--radius);"></div>
    </div>
    <div class="card" style="cursor:default; margin-top:10px; text-align:center;">
      ${icon("pin", { size: "lg" })}
      <strong style="margin-left:8px;">${payload.answer.countryHint}</strong>
    </div>
    ${modeExtraHtml}
    ${gg.pendingMpWager && gg.pendingMpWager.round === payload.round ? `
    <div class="gg-wager-panel" id="ggMpWagerPanel" style="margin-top:10px;">
      <p class="small">${icon("chip", { size: "sm" })} Gokmodus: incasseer je ${gg.pendingMpWager.pts} pts veilig, of waag ze bij het rad voor een kans op meer — of alles kwijt. Alleen jouw punten, niet die van anderen.</p>
      <div class="gg-wager-actions">
        <button class="btn" onclick="ggMpBankPoints()">${icon("check", { size: "sm" })} Veilig incasseren (+${gg.pendingMpWager.pts})</button>
        <button class="btn primary" onclick="ggMpOpenWager()">${icon("chip", { size: "sm" })} Waag ze bij het rad</button>
      </div>
    </div>` : ""}
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
    <div class="guesslist" id="ggMpTotalScoreList">
      ${Object.values(gg.scoreboard).sort((a,b) => b.total - a.total)
        .map(s => `<div class="gitem">
          <div class="name">${s.name}</div>
          <div></div><div></div><div class="prox">${s.total} pts</div>
        </div>`).join("")}
    </div>
    ${adSlotHtml("geoguesserResults")}
    <div class="footerrow">
      <div></div>
      ${gg.isHost
        ? `<button class="btn primary" onclick="ggMpNextFromHost()">${isLast ? "Bekijk eindscore" : `Volgende ronde ${icon("chevronRight", { size: "sm" })}`}</button>`
        : `<div class="small">Wachten op host...</div>`}
    </div>`;
  initAdSlots();

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
  gg.screen = "gameover";
  gg.lastGameOverPayload = payload;
  if (gg.resultMap) { clearGoogleMap(gg.resultMap); gg.resultMap = null; }
  document.getElementById("ggWagerOverlay")?.remove();

  // Spel afgelopen terwijl je nog niet had gekozen om je laatste ronde-punten
  // te incasseren of te wagen? Schrijf ze veilig bij, zodat ze niet
  // verdwijnen. payload.scoreboard is de laatste stand van de host, die dit
  // (nog niet verstuurde) bedrag nog niet kent — dus lokaal erbij optellen
  // en alsnog naar de host sturen zodat iedereen dezelfde stand ziet.
  gg.scoreboard = payload.scoreboard;
  if (gg.pendingMpWager) {
    const pts = gg.pendingMpWager.pts;
    gg.pendingMpWager = null;
    if (!gg.scoreboard[gg.playerId]) gg.scoreboard[gg.playerId] = { name: gg.name, total: 0 };
    gg.scoreboard[gg.playerId].total += pts;
    gg.room.send("wager", { round: gg.round, playerId: gg.playerId, name: gg.name, delta: pts });
  }
  if (payload.hp) gg.hp = payload.hp;
  if (payload.teamScore) gg.teamScore = payload.teamScore;
  if (payload.alive) gg.alive = new Set(payload.alive);
  if (payload.eliminated) gg.eliminated = payload.eliminated;
  const sorted = Object.values(gg.scoreboard).sort((a, b) => b.total - a.total);

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
    <div class="gametitle"><div><h2>${icon("pin", { size: "sm" })} GeoGuesser</h2><div class="desc">Eindresultaat · Lobby ${gg.room.code}</div></div></div>
    <div class="card" style="cursor:default; text-align:center;">
      ${icon("flag", { size: "xl" })}
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
      <h3 style="margin-bottom:14px;">${icon("gear", { size: "sm" })} Instellingen voor nieuw spel</h3>
      <label class="gg-label">Aantal rondes</label>
      <div class="gg-pill-row" id="restartRoundPills">
        ${[3,5,7,10].map(n => `<button class="gg-pill-btn${n===gg.rounds?" active":""}" data-v="${n}">${n}</button>`).join("")}
      </div>
      <label class="gg-label" style="margin-top:16px;">Locaties</label>
      ${locationSettingHtml("restart", gg.locationSet)}
      ${difficultySettingHtml("restart", gg.difficulty, gg.blackwhite)}
      ${timerSettingHtml("restart", gg.roundTime)}
    </div>` : `<div class="card" style="cursor:default; margin-top:14px; text-align:center;">
      <div class="small">Wachten tot de host een nieuw spel start...</div>
    </div>`}
    ${adSlotHtml("geoguesserResults")}
    <div class="footerrow">
      <button class="btn" onclick="ggLeaveLobby()">${icon("chevronLeft", { size: "sm" })} Menu</button>
      ${gg.isHost ? `<button class="btn primary" onclick="ggMpRestartGame()">${icon("refresh", { size: "sm" })} Nieuw spel in zelfde lobby</button>` : "<div></div>"}
    </div>`;
  initAdSlots();

  if (gg.isHost) {
    document.getElementById("restartRoundPills").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-v]"); if (!btn) return;
      document.querySelectorAll("#restartRoundPills .gg-pill-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
    });
    wireLocationSetting("restart");
    wireDifficultySetting("restart");
    wireTimerSetting("restart");
  }
}

window.ggMpRestartGame = function () {
  if (!gg.isHost) return;
  const roundBtn = document.querySelector("#restartRoundPills .gg-pill-btn.active");
  const rounds = roundBtn ? parseInt(roundBtn.dataset.v, 10) : gg.rounds;
  const locSet = readLocationSetting("restart");
  const roundTime = readTimerSetting("restart");
  const { difficulty, blackwhite } = readDifficultySetting("restart");
  gg.rounds = rounds; gg.locationSet = locSet; gg.roundTime = roundTime; gg.pointFn = buildPointFn(locSet);
  gg.difficulty = difficulty; gg.blackwhite = blackwhite;
  gg.room.send("restart", { rounds, locationSet: locSet, roundTime, gameMode: gg.gameMode, difficulty, blackwhite });
  gg.room.send("settings", { rounds, locationSet: locSet, roundTime, gameMode: gg.gameMode, difficulty, blackwhite });
  window.ggMpStartGame();
};

function onMpRestart(payload) {
  if (gg.isHost) return;
  gg.rounds = payload.rounds; gg.locationSet = payload.locationSet;
  gg.roundTime = payload.roundTime ?? null;
  gg.gameMode = payload.gameMode ?? gg.gameMode;
  gg.difficulty = payload.difficulty ?? "free";
  gg.blackwhite = payload.blackwhite ?? false;
  gg.powerups = payload.powerups ?? true;
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
      <button class="gg-hud-back-btn" onclick="ggExitToStart()">${icon("close", { size: "sm" })}</button>
      <span class="gg-hud-pill">${roundLabel}</span>
      <span class="gg-hud-pill gg-hud-score" id="ggHudScore">${scoreLabel}</span>
      ${gg.mode === "solo" || gg.mode === "daily" ? `<button class="gg-hud-pill gg-hud-reroll" onclick="ggRerollRound()" title="Zit je vast? Krijg een andere locatie.">${icon("refresh", { size: "sm" })} Andere locatie</button>` : ""}
    </div>
    ${gg.mode === "mp" && gg.myPowerup ? `
    <div class="gg-hud-left" style="position:absolute; left:20px; top:80px; display:flex; flex-direction:column; gap:10px; z-index:50;">
      <button id="ggBtnPowerup" class="btn primary" style="opacity:${gg.usedPowerup ? "0.5" : "1"}; box-shadow:0 4px 12px rgba(0,0,0,0.3);" onclick="ggUsePowerup()" ${gg.usedPowerup ? "disabled" : ""}>
        ${icon("star", { size: "sm" })} Power-up: ${gg.myPowerup}
      </button>
      <button id="ggBtnSabotage" class="btn" style="background:#e74c3c; color:white; border:none; opacity:${gg.usedSabotage ? "0.5" : "1"}; box-shadow:0 4px 12px rgba(0,0,0,0.3);" onclick="ggUseSabotageMenu()" ${gg.usedSabotage ? "disabled" : ""}>
        ${icon("alertTriangle", { size: "sm" })} Sabotage: ${gg.mySabotage}
      </button>
    </div>
    ` : ""}
    <div class="gg-map-corner" id="ggMapCorner" tabindex="0">
      <div class="gg-map-corner-header">
        <span id="ggGuessInfo" class="gg-map-guess-info">Klik op de kaart om te gokken</span>
        <button class="gg-map-expand-btn" id="ggMapExpandBtn" title="Kaart vergroten/verkleinen">⤢</button>
      </div>
      <div class="gg-map-inner">
        <div id="ggGuessMap" class="gg-guess-map"></div>
        <div class="gg-map-type-toggle" id="ggMapTypeToggle">
          <button data-type="roadmap" class="active">Kaart</button>
          <button data-type="satellite">Satelliet</button>
        </div>
      </div>
      <div class="gg-map-footer">
        <button class="btn primary gg-submit-btn" id="ggSubmitBtn" disabled>${icon("pin", { size: "sm" })} Bevestig gok</button>
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
    window.google.maps.event.trigger(gg.map, "resize");
  };
  mapCorner.addEventListener("mouseenter", () => setTimeout(nudgeMapResize, 310));
  mapCorner.addEventListener("mouseleave", () => setTimeout(nudgeMapResize, 310));
  mapCorner.addEventListener("focus", () => setTimeout(nudgeMapResize, 310));
  mapCorner.addEventListener("blur", () => setTimeout(nudgeMapResize, 310));

  // Hover/focus-within werkt niet betrouwbaar op touch-schermen, dus een
  // expliciete tik-knop om de kaart te vergroten/verkleinen (ook handig op
  // desktop als je niet aan het hoveren wil zitten).
  document.getElementById("ggMapExpandBtn")?.addEventListener("click", (e) => {
    e.stopPropagation();
    mapCorner.classList.toggle("gg-expanded");
    e.currentTarget.blur();
    setTimeout(nudgeMapResize, 310);
  });
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

  updateCheatHint();
}

// ---------- Gokmodus: waag je rondepunten bij het rad ----------
// Bewegen/rondkijken is in deze modus helemaal vrij — het gokaspect zit 'm
// puur in de score: na elke ronde mag je je verdiende punten veilig
// incasseren, of ze wagen bij een roulette-rad voor een kans op meer
// (rood/zwart = x2, groen = x5, mis = die ronde 0 punten).

const ROULETTE_RED = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);
function rouletteColor(n) {
  if (n === 0) return "green";
  return ROULETTE_RED.has(n) ? "red" : "black";
}

window.ggBankPoints = function () {
  if (gg.pendingPts == null) return;
  gg.totalScore += gg.pendingPts;
  gg.history.push({ km: gg.pendingKm, pts: gg.pendingPts, country: gg.current.countryHint });
  gg.pendingPts = null;
  gg.pendingKm = null;
  ggResolveWager();
};

window.ggOpenWager = function () {
  const wrap = document.getElementById("ggFullscreenWrap");
  if (!wrap || gg.pendingPts == null || document.getElementById("ggWagerOverlay")) return;
  const pts = gg.pendingPts;
  const overlay = document.createElement("div");
  overlay.id = "ggWagerOverlay";
  overlay.className = "gg-roulette-overlay";
  overlay.innerHTML = `
    <div class="gg-roulette-modal">
      <h3>${icon("chip", { size: "sm" })} Waag je ${pts} pts</h3>
      <p class="small">Rood of zwart geraden = ×2. Groen (0) geraden = ×5, maar kleine kans. Mis = deze ronde 0 pts.</p>
      <div class="gg-roulette-number" id="ggWagerNumber">?</div>
      <div class="gg-roulette-colors" id="ggWagerColors">
        <button class="gg-roulette-color-btn gg-roulette-red" data-c="red">Rood ×2</button>
        <button class="gg-roulette-color-btn gg-roulette-black" data-c="black">Zwart ×2</button>
        <button class="gg-roulette-color-btn gg-roulette-green" data-c="green">Groen ×5</button>
      </div>
      <div class="gg-roulette-actions" id="ggWagerActions">
        <button class="btn" onclick="ggCancelWager()">Terug</button>
        <button class="btn primary" id="ggWagerSpinBtn" disabled>${icon("refresh", { size: "sm" })} Draai</button>
      </div>
    </div>`;
  wrap.appendChild(overlay);

  let chosen = null;
  overlay.querySelectorAll(".gg-roulette-color-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      overlay.querySelectorAll(".gg-roulette-color-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      chosen = btn.dataset.c;
      document.getElementById("ggWagerSpinBtn").disabled = false;
    });
  });
  document.getElementById("ggWagerSpinBtn").addEventListener("click", () => {
    if (!chosen) return;
    ggWagerSpin(chosen);
  });
};

window.ggCancelWager = function () {
  document.getElementById("ggWagerOverlay")?.remove();
};

function ggWagerSpin(chosen) {
  const overlay = document.getElementById("ggWagerOverlay");
  if (!overlay) return;
  const numberEl = document.getElementById("ggWagerNumber");
  overlay.querySelectorAll("button").forEach((b) => b.disabled = true);

  const pts = gg.pendingPts;
  gg.gambleStats.rounds++;
  gg.gambleStats.staked += pts;

  let ticks = 0;
  const spinTimer = setInterval(() => {
    const n = Math.floor(Math.random() * 37);
    numberEl.textContent = n;
    numberEl.className = `gg-roulette-number gg-roulette-${rouletteColor(n)}`;
    ticks++;
    if (ticks > 16) {
      clearInterval(spinTimer);
      const finalN = Math.floor(Math.random() * 37);
      const finalColor = rouletteColor(finalN);
      numberEl.textContent = finalN;
      numberEl.className = `gg-roulette-number gg-roulette-${finalColor}`;
      const won = finalColor === chosen;
      const mult = chosen === "green" ? 5 : 2;
      const payout = won ? pts * mult : 0;
      gg.gambleStats.won += payout;
      gg.totalScore += payout;
      gg.history.push({ km: gg.pendingKm, pts: payout, country: gg.current.countryHint, gambled: true, gambleWon: won });
      gg.pendingPts = null;
      gg.pendingKm = null;
      ggWagerShowResult(won, payout, mult);
    }
  }, 80);
}

function ggWagerShowResult(won, payout, mult) {
  const overlay = document.getElementById("ggWagerOverlay");
  if (!overlay) return;
  const actions = document.getElementById("ggWagerActions");
  const modal = overlay.querySelector(".gg-roulette-modal");
  const msg = document.createElement("p");
  msg.className = won ? "msg good" : "msg bad";
  msg.style.textAlign = "center";
  msg.innerHTML = won ? `${icon("check", { size: "sm" })} Geraakt (×${mult})! +${payout} pts` : `${icon("close", { size: "sm" })} Mis — deze ronde 0 pts.`;
  modal.insertBefore(msg, actions);
  actions.innerHTML = `<button class="btn primary" onclick="ggCancelWager(); ggResolveWager();" style="width:100%;">Verder ${icon("chevronRight", { size: "sm" })}</button>`;
}

// Let op: wordt ook aangeroepen vanuit een inline onclick-attribuut (de
// "Verder"-knop hierboven), dat in de globale scope draait, niet in de
// scope van deze module — daarom moet dit een window-functie zijn, anders
// gooit de browser een stille ReferenceError en blijft het gokpaneel hangen.
window.ggResolveWager = function () {
  document.getElementById("ggWagerPanel")?.remove();
  const stat = document.querySelector("#ggResultOverlay .gg-result-stat");
  if (stat) stat.innerHTML = `Totaal: ${gg.totalScore} pts`;
  const nextBtn = document.getElementById("ggNextRoundBtn");
  if (nextBtn) nextBtn.style.display = "";
};

// ---------- Gokmodus in multiplayer: zelfde idee, maar de uitkomst gaat via
// de host naar het gedeelde scorebord (elke speler waagt alleen zijn eigen
// punten — nooit die van een ander). ----------

// Host-only: verwerkt de definitieve uitkomst van een speler die zijn
// ronde-punten heeft ingecasseerd of gewaagd, telt 'm bij het scorebord op
// en stuurt de bijgewerkte stand naar iedereen door.
function onMpWagerReceived(payload) {
  if (!gg.isHost) return;
  if (!gg.scoreboard[payload.playerId]) gg.scoreboard[payload.playerId] = { name: payload.name || "Speler", total: 0 };
  gg.scoreboard[payload.playerId].total += payload.delta;
  gg.room.send("scoreupdate", { scoreboard: gg.scoreboard });
}

// Iedereen (inclusief de host zelf) ontvangt de bijgewerkte stand en werkt
// de zichtbare totaalscore-lijst op het resultatenscherm live bij, zonder
// een eventueel open gokpaneel/rad van een andere speler te verstoren.
function onMpScoreUpdateReceived(payload) {
  gg.scoreboard = payload.scoreboard;
  if (gg.screen !== "results") return;
  const list = document.getElementById("ggMpTotalScoreList");
  if (!list) return;
  list.innerHTML = Object.values(gg.scoreboard).sort((a, b) => b.total - a.total)
    .map((s) => `<div class="gitem"><div class="name">${s.name}</div><div></div><div></div><div class="prox">${s.total} pts</div></div>`)
    .join("");
}

// Stuurt het eindresultaat van je eigen gok (incasseren of gokuitslag) naar
// de host, en werkt je eigen scorebord alvast optimistisch bij zodat het
// niet knippert terwijl het antwoord van de host onderweg is.
function ggMpSendWagerResult(delta) {
  if (!gg.scoreboard[gg.playerId]) gg.scoreboard[gg.playerId] = { name: gg.name, total: 0 };
  gg.scoreboard[gg.playerId].total += delta;
  gg.room.send("wager", { round: gg.round, playerId: gg.playerId, name: gg.name, delta });
  const list = document.getElementById("ggMpTotalScoreList");
  if (list) {
    list.innerHTML = Object.values(gg.scoreboard).sort((a, b) => b.total - a.total)
      .map((s) => `<div class="gitem"><div class="name">${s.name}</div><div></div><div></div><div class="prox">${s.total} pts</div></div>`)
      .join("");
  }
}

window.ggMpBankPoints = function () {
  if (!gg.pendingMpWager) return;
  const pts = gg.pendingMpWager.pts;
  gg.pendingMpWager = null;
  document.getElementById("ggMpWagerPanel")?.remove();
  ggMpSendWagerResult(pts);
};

window.ggMpOpenWager = function () {
  if (!gg.pendingMpWager || document.getElementById("ggWagerOverlay")) return;
  const pts = gg.pendingMpWager.pts;
  const overlay = document.createElement("div");
  overlay.id = "ggWagerOverlay";
  overlay.className = "gg-roulette-overlay";
  overlay.innerHTML = `
    <div class="gg-roulette-modal">
      <h3>${icon("chip", { size: "sm" })} Waag je ${pts} pts</h3>
      <p class="small">Rood of zwart geraden = ×2. Groen (0) geraden = ×5, maar kleine kans. Mis = deze ronde 0 pts.</p>
      <div class="gg-roulette-number" id="ggWagerNumber">?</div>
      <div class="gg-roulette-colors" id="ggWagerColors">
        <button class="gg-roulette-color-btn gg-roulette-red" data-c="red">Rood ×2</button>
        <button class="gg-roulette-color-btn gg-roulette-black" data-c="black">Zwart ×2</button>
        <button class="gg-roulette-color-btn gg-roulette-green" data-c="green">Groen ×5</button>
      </div>
      <div class="gg-roulette-actions" id="ggWagerActions">
        <button class="btn" onclick="ggCancelWager()">Terug</button>
        <button class="btn primary" id="ggWagerSpinBtn" disabled>${icon("refresh", { size: "sm" })} Draai</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  let chosen = null;
  overlay.querySelectorAll(".gg-roulette-color-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      overlay.querySelectorAll(".gg-roulette-color-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      chosen = btn.dataset.c;
      document.getElementById("ggWagerSpinBtn").disabled = false;
    });
  });
  document.getElementById("ggWagerSpinBtn").addEventListener("click", () => {
    if (!chosen) return;
    ggMpWagerSpin(chosen);
  });
};

function ggMpWagerSpin(chosen) {
  const overlay = document.getElementById("ggWagerOverlay");
  if (!overlay || !gg.pendingMpWager) return;
  const numberEl = document.getElementById("ggWagerNumber");
  overlay.querySelectorAll("button").forEach((b) => b.disabled = true);

  const pts = gg.pendingMpWager.pts;
  gg.pendingMpWager = null;
  document.getElementById("ggMpWagerPanel")?.remove();

  let ticks = 0;
  const spinTimer = setInterval(() => {
    const n = Math.floor(Math.random() * 37);
    numberEl.textContent = n;
    numberEl.className = `gg-roulette-number gg-roulette-${rouletteColor(n)}`;
    ticks++;
    if (ticks > 16) {
      clearInterval(spinTimer);
      const finalN = Math.floor(Math.random() * 37);
      const finalColor = rouletteColor(finalN);
      numberEl.textContent = finalN;
      numberEl.className = `gg-roulette-number gg-roulette-${finalColor}`;
      const won = finalColor === chosen;
      const mult = chosen === "green" ? 5 : 2;
      const payout = won ? pts * mult : 0;
      ggMpSendWagerResult(payout);
      ggMpWagerShowResult(won, payout, mult);
    }
  }, 80);
}

function ggMpWagerShowResult(won, payout, mult) {
  const overlay = document.getElementById("ggWagerOverlay");
  if (!overlay) return;
  const actions = document.getElementById("ggWagerActions");
  const modal = overlay.querySelector(".gg-roulette-modal");
  const msg = document.createElement("p");
  msg.className = won ? "msg good" : "msg bad";
  msg.style.textAlign = "center";
  msg.innerHTML = won ? `${icon("check", { size: "sm" })} Geraakt (×${mult})! +${payout} pts` : `${icon("close", { size: "sm" })} Mis — deze ronde 0 pts.`;
  modal.insertBefore(msg, actions);
  actions.innerHTML = `<button class="btn primary" onclick="ggCancelWager()" style="width:100%;">Verder ${icon("chevronRight", { size: "sm" })}</button>`;
}

// ---------- Power-ups & Sabotages ----------
window.ggUsePowerup = function () {
  if (gg.usedPowerup) return;
  gg.usedPowerup = true;
  document.getElementById("ggBtnPowerup").disabled = true;
  document.getElementById("ggBtnPowerup").style.opacity = "0.5";

  if (gg.myPowerup === "shield") {
    gg.hasShield = true;
    showConnBanner(`${icon("star", { size: "sm" })} Schild geactiveerd! (beschermt deels tegen duel schade of geeft score boost)`);
    setTimeout(() => hideConnBanner(), 3000);
  } else if (gg.myPowerup === "hint") {
    showConnBanner(`💡 Echte Hint: Het is <strong>${gg.current.countryHint}</strong>`);
    setTimeout(() => hideConnBanner(), 5000);
  } else if (gg.myPowerup === "5050") {
    const others = ["Nederland", "België", "Duitsland", "Frankrijk", "Spanje", "Italië", "Verenigde Staten", "Japan", "Brazilië", "Australië", "Zuid-Afrika"];
    let other = others[Math.floor(Math.random() * others.length)];
    if (other === gg.current.countryHint) other = "Canada"; // fallback
    const options = [gg.current.countryHint, other].sort(() => Math.random() - 0.5);
    showConnBanner(`💡 50/50: Het is <strong>${options[0]}</strong> of <strong>${options[1]}</strong>`);
    setTimeout(() => hideConnBanner(), 5000);
  }
};

window.ggUseSabotageMenu = function () {
  if (gg.usedSabotage) return;
  const wrap = document.getElementById("ggFullscreenWrap");
  if (!wrap) return;

  const overlay = document.createElement("div");
  overlay.className = "gg-wager-overlay";
  overlay.id = "ggSabotageMenu";

  const alivePlayers = Object.keys(gg.scoreboard).filter(id => id !== gg.playerId);
  if (alivePlayers.length === 0) {
    alert("Geen tegenstanders over om te saboteren!");
    return;
  }

  const listHtml = alivePlayers.map(pid => {
    const name = gg.scoreboard[pid]?.name || "Speler";
    return `<button class="btn" style="width:100%; margin-bottom:8px;" onclick="ggSendSabotage('${pid}', '${name}')">${name}</button>`;
  }).join("");

  overlay.innerHTML = `
    <div class="gg-roulette-modal">
      <h3>Kies een doelwit</h3>
      <p class="small" style="margin-bottom:12px;">Sabotage: ${gg.mySabotage}</p>
      ${listHtml}
      <button class="btn" onclick="document.getElementById('ggSabotageMenu').remove()" style="width:100%; margin-top:8px;">Annuleren</button>
    </div>`;
  wrap.appendChild(overlay);
};

window.ggSendSabotage = function (targetId, targetName) {
  document.getElementById("ggSabotageMenu")?.remove();
  if (gg.usedSabotage) return;
  gg.usedSabotage = true;
  document.getElementById("ggBtnSabotage").disabled = true;
  document.getElementById("ggBtnSabotage").style.opacity = "0.5";

  gg.room.send("sabotage", { target: targetId, type: gg.mySabotage, fromName: gg.name });
  showConnBanner(`${icon("alertTriangle", { size: "sm" })} Sabotage '${gg.mySabotage}' ingezet op ${targetName}!`);
  setTimeout(() => hideConnBanner(), 3000);
};

function onMpSabotageReceived(payload) {
  if (payload.target !== gg.playerId) return;

  if (payload.type === "fakehint") {
    const fakes = ["Verenigde Staten", "Frankrijk", "Rusland", "Brazilië", "India", "Zuid-Afrika", "Mexico", "China"];
    let fake = fakes[Math.floor(Math.random() * fakes.length)];
    if (fake === gg.current?.countryHint) fake = "IJsland"; // fallback
    showConnBanner(`💡 HINT: Het is <strong>${fake}</strong>`);
    setTimeout(() => hideConnBanner(), 5000);
  } else if (payload.type === "ink") {
    const wrap = document.getElementById("ggFullscreenWrap");
    if (wrap) {
      const ink = document.createElement("div");
      ink.id = "ggSabotageInk";
      ink.style.position = "absolute";
      ink.style.inset = "0";
      ink.style.backdropFilter = "blur(15px) contrast(0.8) brightness(0.5)";
      ink.style.zIndex = "999";
      ink.style.pointerEvents = "none";
      ink.innerHTML = `<div style="position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); color:white; font-size:24px; font-weight:bold; text-align:center; text-shadow: 2px 2px 4px rgba(0,0,0,0.8);">Je bent gesaboteerd door ${payload.fromName}! (Inktvlek)</div>`;
      wrap.appendChild(ink);
      setTimeout(() => ink.remove(), 5000);
    }
  } else if (payload.type === "nocompass") {
    if (gg.panorama) {
      gg.panorama.setOptions({ panControl: false });
      showConnBanner(`${icon("alertTriangle", { size: "sm" })} \${payload.fromName} heeft je kompas kapot gemaakt voor deze ronde!`);
      setTimeout(() => hideConnBanner(), 5000);
    }
  }
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
    if (info) info.innerHTML = `Gok geplaatst ${icon("check", { size: "sm" })}`;
    const btn = document.getElementById("ggSubmitBtn");
    if (btn) btn.removeAttribute("disabled");
  });
}
