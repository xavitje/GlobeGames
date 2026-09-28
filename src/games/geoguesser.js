import { ALL_NAMES, haversineKm, attachAutocomplete, icon, PLAYER_COLORS } from "../core.js";
import { topbar } from "../lib/layout.js";
import { countryName, findCountryByAnyName, getLanguage, localizedCountryCandidates, pick } from "../lib/i18n.js";
import { buildDailyShareText, getDailyKey, getDailyResult, getStreakBest, hashStringToSeed, mulberry32, saveDailyResult, scoreForDistance, setStreakBest } from "./geoguesser/challenge-utils.js";
import { bonusLabel } from "./geoguesser/bonuses.js";
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
} from "../lib/multiplayer.js";
import { getProfile, saveProfile } from "../lib/profile.js";
import { adSlotHtml, initAdSlots } from "../lib/ads.js";
import { escapeHtml } from "../lib/html.js";
import { ActionController } from "../lib/actions.js";
import { getSession } from "../lib/auth.js";
import { MultiplayerServer } from "../lib/multiplayer-server.js";
import { accountSignInPath, rememberAuthReturn } from "../lib/auth-return.js";
import { buildPointFn, difficultySettingHtml, locationSetLabel, locationSettingHtml, readDifficultySetting, readLocationSetting, readTimerSetting, timerSettingHtml, wireDifficultySetting, wireLocationSetting, wireTimerSetting } from "./geoguesser/settings.js";
import { router } from "../main.js";

let app;
let gg = null;
let actionController = null;
let pendingReconnect = null;
let soloReplayPrefill = null;

const GG_CHEAT_WORD = "xyzzy";
let ggCheatBuffer = "";
let ggCheatOn = false;
function handleCheatKeydown(e) {
  if (!e.key || e.key.length !== 1 || !/[a-z]/i.test(e.key)) return;
  ggCheatBuffer = (ggCheatBuffer + e.key.toLowerCase()).slice(-GG_CHEAT_WORD.length);
  if (ggCheatBuffer === GG_CHEAT_WORD) {
    ggCheatOn = !ggCheatOn;
    ggCheatBuffer = "";
    updateCheatHint();
    ggCheatToast(ggCheatOn ? icon("lockOpen", { size: "sm" }) : icon("lockClosed", { size: "sm" }));
  }
}

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
    if (gg.isHost) setTimeout(hostFinishRound, 1500);
  } else if (gg.mode === "solo" || gg.mode === "daily") {
    if (gg.submitted) return;
    if (gg.guess) submitSoloGuess();
    else forceSoloTimeout();
  } else if (gg.mode === "streak") {
    if (gg.streakLocked) return;
    forceStreakTimeout();
  }
}

// An unanswered solo round scores zero points.
function forceSoloTimeout() {
  gg.submitted = true;
  gg.history.push({ km: null, pts: 0, country: gg.current.countryHint });
  showSoloResultOverlay(null, 0);
}

// An unanswered streak round ends the streak.
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

export function cleanupGeoGuesser() {
  teardown();
  actionController?.destroy();
  actionController = null;
  window.removeEventListener("keydown", handleCheatKeydown, true);
}

// Persist lobby identity so a page reload can reconnect.

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

// Reflect internal screens in replaceable, shareable URLs.
function setUrlPath(path) {
  history.replaceState(null, "", path);
  // See the matching comment in wikispeedrun.js's setUrlPath: without this,
  // the router's own bookkeeping of "the current path" drifts out of sync
  // with the real URL, and a later popstate gets mistaken for a real
  // navigation, force-rerendering the whole route and losing round/lobby
  // state.
  router.syncPath();
}
function setLobbyInUrl(code) {
  setUrlPath(code ? `/geoguesser/multiplayer/${code.toUpperCase()}` : "/geoguesser/multiplayer");
}
function clearLobbyFromUrl() { setUrlPath("/geoguesser"); }

// Route segments describe the path after /geoguesser.
export function renderGeoGuesser(rootEl, routeSegments = []) {
  actionController?.destroy();
  window.removeEventListener("keydown", handleCheatKeydown, true);
  window.addEventListener("keydown", handleCheatKeydown, true);
  app = rootEl;
  // Full-screen overlays (#ggFullscreenWrap round HUD, chat widget, reconnect
  // banner, wager overlay) are appended straight to document.body so they can
  // escape #app's centered max-width layout — they live outside `app`'s DOM
  // subtree. Binding the controller to document.body (instead of just `app`)
  // means its `root.contains(control)` check still matches clicks on those
  // overlays' data-action buttons (the round HUD's close/reroll/powerup/
  // sabotage buttons, chat close, wager buttons, ...), which were previously
  // silently swallowed because they fell outside the `app` subtree — this is
  // why clicking the round's X (exit-to-start) did nothing.
  actionController = new ActionController(document.body, GEO_ACTIONS);
  teardown();
  gg = null;

  if (!hasGoogleMapsKey()) {
    app.innerHTML = `${topbar()}
      <div class="gametitle"><div><h2>${icon("pin", { size: "sm" })} GeoGuesser</h2><div class="desc">${pick("One setup step before you can play.", "Even instellen voordat je kunt spelen.")}</div></div></div>
      <div class="card" style="cursor:default;">
        ${icon("key", { size: "xl" })}
        <h3>${pick("Google Maps key is missing", "Google Maps-key ontbreekt")}</h3>
        <p style="margin-bottom:10px;">${pick("This game uses real", "Dit spel gebruikt echte")} <a class="linklike" href="https://developers.google.com/maps/documentation/javascript/streetview" target="_blank" rel="noopener">Google Street View</a> ${pick("panoramas. Create an API key and add it to", "panorama's. Maak een API-key aan en zet 'm in")} <code>.env</code>:</p>
        <div class="small" style="background:var(--panel2); padding:10px 12px; border-radius:10px; font-family:monospace;">VITE_GOOGLE_MAPS_KEY=${pick("your-key", "jouw-key")}</div>
      </div>`;
    return;
  }

  // Warm the Maps connection before the first round starts.
  loadGoogleMaps().catch(() => {});

  const [section, subCode] = routeSegments;
  const savedLobby = hasMultiplayerConfig() ? getLobbySession() : null;

  if (section === "singleplayer") { ggShowSoloSettings(); return; }
  if (section === "daily") { ggStartDaily(); return; }

  if (section === "multiplayer" && subCode) {
    if (subCode === "host") {
      openProtectedMultiplayer("/geoguesser/multiplayer/host", () => ggShowMpHostSettings());
      return;
    }
    if (subCode === "join") {
      openProtectedMultiplayer("/geoguesser/multiplayer/join", () => ggShowMpJoin());
      return;
    }
    const code = subCode.toUpperCase();
    if (hasMultiplayerConfig()) {
      openProtectedMultiplayer(`/geoguesser/multiplayer/${code}`, () => {
        if (savedLobby && savedLobby.code === code) drawReconnectPrompt(savedLobby);
        else drawAutoJoinScreen(code);
      });
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

async function openProtectedMultiplayer(returnTo, onReady) {
  app.innerHTML = `${topbar()}<div class="route-loading"><span class="atlas-loader"></span>${pick("Checking your account…", "Je account controleren…")}</div>`;
  try {
    if (await getSession()) {
      onReady();
      return;
    }
  } catch {}
  rememberAuthReturn(returnTo);
  location.assign(accountSignInPath(returnTo));
}

function drawReconnectPrompt(saved) {
  app.innerHTML = `
    ${topbar()}
    <div class="gametitle"><div><h2>${icon("users", { size: "sm" })} ${pick("Reconnect?", "Opnieuw verbinden?")}</h2><div class="desc">${pick("You were still in a lobby.", "Je zat nog in een lobby.")}</div></div></div>
    <div class="card" style="cursor:default; text-align:center;">
      ${icon("wifi", { size: "xl" })}
      <h3>${pick("Reconnect to lobby", "Opnieuw verbinden met lobby")} ${saved.code}?</h3>
      <p>${pick("You were connected as", "Je was verbonden als")} <strong>${escapeHtml(saved.name)}</strong>.</p>
    </div>
    <div class="footerrow">
      <button class="btn" data-action="dismiss-reconnect">${pick("No, back to menu", "Nee, terug naar menu")}</button>
      <button class="btn primary" data-action="reconnect-lobby">${pick("Yes, reconnect", "Ja, opnieuw verbinden")} ${icon("chevronRight", { size: "sm" })}</button>
    </div>`;
  pendingReconnect = saved;
}

const ggDismissReconnect = function () {
  clearLobbySession();
  pendingReconnect = null;
  drawStartScreen();
};

const ggReconnectLobby = async function () {
  const saved = pendingReconnect;
  pendingReconnect = null;
  if (!saved) { drawStartScreen(); return; }
  await enterLobby(saved.code, saved.name, saved.isHost, null, saved.playerId);
};

function drawAutoJoinScreen(code) {
  app.innerHTML = `
    ${topbar()}
    <div class="gametitle"><div><h2>${icon("users", { size: "sm" })} ${pick("Join lobby", "Lobby joinen")}</h2><div class="desc">${pick("You were invited to lobby", "Je bent uitgenodigd voor lobby")} <strong>${code.toUpperCase()}</strong>.</div></div></div>
    <div class="card" style="cursor:default;">
      <h3 style="margin-bottom:10px;">${pick("Your name", "Jouw naam")}</h3>
      <input id="ggAutoJoinName" type="text" placeholder="${pick("Enter your name…", "Typ je naam…")}" maxlength="18" value="${escapeHtml(getProfile().name || "")}"
        style="width:100%; padding:10px 12px; border-radius:10px; border:1px solid var(--border); background:var(--panel2); color:inherit; font-size:14px;" />
    </div>
    <div class="footerrow">
      <button class="btn" data-action="show-start">${icon("chevronLeft", { size: "sm" })} ${pick("Back", "Terug")}</button>
      <button class="btn primary" data-action="auto-join" data-code="${escapeHtml(code)}">${pick("Join", "Joinen")} ${icon("chevronRight", { size: "sm" })}</button>
    </div>`;
}

const ggAutoJoin = async function (code) {
  const input = document.getElementById("ggAutoJoinName");
  const typed = (input?.value.trim()) || "";
  if (typed) {
    const p = getProfile();
    if (p.name !== typed) saveProfile({ ...p, name: typed });
  }
  const name = typed || pick("Player", "Speler") + Math.floor(Math.random() * 900 + 100);
  await enterLobby(code, name, false, null);
};

function drawStartScreen() {
  clearLobbyFromUrl();
  const mpAvailable = hasMultiplayerConfig();
  const streakBest = getStreakBest();
  const dailyResult = getDailyResult();
  app.innerHTML = `
    ${topbar()}
    <div class="gametitle"><div><h2>${icon("pin", { size: "sm" })} GeoGuesser</h2><div class="desc">${pick("Where on Earth is this?", "Waar op aarde is dit?")}</div></div></div>
    <div class="game-mode-grid">
    <button type="button" class="card game-mode-card" data-action="show-solo-settings">
      ${icon("user", { size: "lg" })}<h3>${pick("Play solo", "Solo spelen")}</h3>
      <p>${pick("Choose rounds, locations and difficulty.", "Kies je rondes, locaties en moeilijkheidsgraad.")}</p>
    </button>
    <button type="button" class="card game-mode-card" data-action="start-streak">
      ${icon("flame", { size: "lg" })}<h3>Streak</h3>
      <p>${pick("Guess countries in a row for as long as you can. Best streak:", "Raad landen op rij, zo lang je kan. Beste streak:")} <strong>${streakBest}</strong></p>
    </button>
    <button type="button" class="card game-mode-card" data-action="start-daily">
      ${icon("calendar", { size: "lg" })}<h3>${pick("Daily challenge", "Dagelijkse challenge")}</h3>
      <p>${dailyResult ? pick(`Already played today: <strong>${dailyResult.totalScore} pts</strong> — view your result.`, `Vandaag al gespeeld: <strong>${dailyResult.totalScore} pts</strong> — bekijk je resultaat.`) : pick("5 fixed rounds, identical for everyone each day.", "5 vaste rondes, elke dag hetzelfde voor iedereen.")}</p>
    </button>
    <button type="button" class="card game-mode-card" ${mpAvailable ? 'data-action="show-multiplayer-menu"' : "disabled"}>
      ${icon("users", { size: "lg" })}<h3>${pick("Play with friends", "Met vrienden")} <span class="muted">(multiplayer)</span></h3>
      <p>${mpAvailable ? pick("Create a lobby or join one with a code.", "Maak een lobby of join er een met een code.") : pick("Multiplayer is not configured yet.", "Multiplayer is nog niet ingesteld.")}</p>
    </button></div>
    ${adSlotHtml("geoguesserSettings")}`;
  initAdSlots();
}


const ggShowSoloSettings = function (prefill = {}) {
  setUrlPath("/geoguesser/singleplayer");
  const ar = prefill.rounds || 5;
  app.innerHTML = `
    ${topbar()}
    <div class="gametitle"><div><h2>${icon("user", { size: "sm" })} ${pick("Play solo", "Solo spelen")}</h2><div class="desc">${pick("Choose your settings.", "Kies je instellingen.")}</div></div></div>
    <div class="card" style="cursor:default;">
      <h3 style="margin-bottom:14px;">${pick("Settings", "Instellingen")}</h3>
      <label class="gg-label">${pick("Number of rounds", "Aantal rondes")}</label>
      <div class="gg-pill-row" id="soloRoundPills">
        ${[3,5,7,10].map(n => `<button class="gg-pill-btn${n===ar?" active":""}" data-v="${n}">${n}</button>`).join("")}
      </div>
      <label class="gg-label" style="margin-top:16px;">${pick("Locations", "Locaties")}</label>
      ${locationSettingHtml("solo", prefill.locationSet)}
      <label class="gg-label" style="margin-top:16px;">${pick("Difficulty", "Moeilijkheidsgraad")}</label>
      <div class="gg-pill-row" id="soloDifficultyPills">
        <button class="gg-pill-btn${(prefill.difficulty || "free") === "free" ? " active" : ""}" data-v="free">${pick("Move freely", "Vrij bewegen")}</button>
        <button class="gg-pill-btn${prefill.difficulty === "nomove" ? " active" : ""}" data-v="nomove">${pick("No moving", "Niet bewegen")}</button>
        <button class="gg-pill-btn${prefill.difficulty === "nmpz" ? " active" : ""}" data-v="nmpz">NMPZ</button>
        <button class="gg-pill-btn${prefill.difficulty === "gamble" ? " active" : ""}" data-v="gamble" title="${pick("Move freely, then bank or double your points after every round.", "Vrij bewegen, maar na elke ronde mag je je punten veilig incasseren of verdubbelen bij het rad.")}">${icon("chip", { size: "sm" })} ${pick("Gamble", "Gokken")}</button>
      </div>
      <label style="display:flex; align-items:center; gap:8px; margin-top:14px; font-size:13px; cursor:pointer;">
        <input type="checkbox" id="soloBlackWhite" ${prefill.blackwhite ? "checked" : ""} /> ${pick("Black and white", "Zwart-wit")}
      </label>
    </div>
    ${adSlotHtml("geoguesserSettings")}
    <div class="footerrow">
      <button class="btn" data-action="show-start">${icon("chevronLeft", { size: "sm" })} ${pick("Back", "Terug")}</button>
      <button class="btn primary" data-action="start-solo">${pick("Play", "Spelen")} ${icon("chevronRight", { size: "sm" })}</button>
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

const ggShowStart = function () { drawStartScreen(); };

const ggStartSolo = function () {
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


function drawFullscreenLoading(roundLabel) {
  const existing = document.getElementById("ggFullscreenWrap");
  if (existing) existing.remove();
  const wrap = document.createElement("div");
  wrap.id = "ggFullscreenWrap";
  wrap.className = "gg-fullscreen-wrap";
  wrap.innerHTML = `
    <div class="gg-pano-container" style="background:var(--panel2); display:flex; flex-direction:column; align-items:center; justify-content:center; gap:14px;">
      <div class="ggspinner"></div>
      <div style="color:#fff; font-size:14px; opacity:0.7;">${pick("Finding a Street View location…", "Street View-locatie zoeken…")}</div>
    </div>
    <div class="gg-hud-top">
      <button class="gg-hud-back-btn" data-action="exit-to-start">${icon("close", { size: "sm" })}</button>
      <span class="gg-hud-pill">${roundLabel}</span>
    </div>`;
  document.body.appendChild(wrap);
}

async function nextSoloRound() {
  gg.round++;
  await loadAndDrawSoloRound();
}

// Replace the current round location without changing its round number.
async function loadAndDrawSoloRound() {
  gg.guess = null;
  gg.submitted = false;
  if (gg.map) { clearGoogleMap(gg.map); gg.map = null; gg.guessMarker = null; }
  if (gg.resultMap) { clearGoogleMap(gg.resultMap); gg.resultMap = null; }
  gg.panorama = null;

  drawFullscreenLoading(`${pick("Round", "Ronde")} ${gg.round} / ${gg.rounds}`);
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
        ${icon("wifi", { size: "xl" })}<h3>${pick("No Street View found", "Geen Street View gevonden")}</h3>
        <p>${pick("Please try again.", "Probeer het opnieuw.")}</p>
        <button class="btn primary" data-action="start-solo" style="margin-top:10px;">${pick("Try again", "Opnieuw")}</button>
      </div>`;
    return;
  }

  gg.current = round;
  drawRoundScreen({ roundLabel: `${pick("Round", "Ronde")} ${gg.round} / ${gg.rounds}`, scoreLabel: `${gg.totalScore} pts`, onSubmit: submitSoloGuess });
  initPanorama(round);
  initMap(maps);
  startRoundTimer(120);
}

// Reroll an unusable panorama without consuming the round.
const ggRerollRound = function () {
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
  // Gamble mode holds positive round points until the player banks or spins.
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
    ? `${icon("clock", { size: "sm" })} ${pick("Time is up — no guess placed", "Tijd voorbij — geen gok geplaatst")} · <strong>${pts} pts</strong> · ${pick("Total", "Totaal")}: ${gg.totalScore}`
    : pending
      ? `${icon("ruler", { size: "sm" })} ${Math.round(km).toLocaleString()} km · <strong>${pts} pts</strong> ${pick("earned — not banked yet", "verdiend — nog niet ingecasseerd")}`
      : `${icon("ruler", { size: "sm" })} ${Math.round(km).toLocaleString()} km · <strong>${pts} pts</strong> · ${pick("Total", "Totaal")}: ${gg.totalScore}`;
  overlay.innerHTML = `
    <div class="gg-result-header">
      <div class="gg-result-country">${countryName(gg.current.countryHint)}</div>
      <div class="gg-result-stat">${statLine}</div>
    </div>
    <div id="ggResultMap" class="gg-result-map"></div>
    ${pending ? `
    <div class="gg-wager-panel" id="ggWagerPanel">
      <p class="small">${icon("chip", { size: "sm" })} ${pick(`Gamble mode: bank your ${pts} pts or risk them at the wheel for a chance to win more.`, `Gokmodus: incasseer je ${pts} pts veilig, of waag ze bij het rad voor een kans op meer — of alles kwijt.`)}</p>
      <div class="gg-wager-actions">
        <button class="btn" data-action="bank-points">${icon("check", { size: "sm" })} ${pick("Bank safely", "Veilig incasseren")} (+${pts})</button>
        <button class="btn primary" data-action="open-wager">${icon("chip", { size: "sm" })} ${pick("Spin the wheel", "Waag ze bij het rad")}</button>
      </div>
    </div>` : ""}
    ${adSlotHtml("geoguesserResults")}
    <div class="gg-result-footer">
      <button class="btn primary" id="ggNextRoundBtn" style="${pending ? "display:none;" : ""}">
        ${gg.round < gg.rounds ? `${pick("Next round", "Volgende ronde")} ${icon("chevronRight", { size: "sm" })}` : pick("View final score", "Bekijk eindscore")}
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
        title: pick("Your guess", "Jouw gok") });
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
  soloReplayPrefill = { rounds: savedRounds, locationSet: savedLoc };
  app.innerHTML = `
    ${topbar()}
    <div class="gametitle"><div><h2>${icon("pin", { size: "sm" })} GeoGuesser</h2><div class="desc">${pick("Final result", "Eindresultaat")}</div></div></div>
    <div class="card" style="cursor:default; text-align:center;">
      ${icon("flag", { size: "xl" })}
      <h3>${gg.totalScore} / ${gg.rounds * 5000} ${pick("points", "punten")}</h3>
      <p>${pick("Average", "Gemiddeld")} ${avg} ${pick("points per round.", "punten per ronde.")}</p>
    </div>
    <div class="guesslist" style="margin-top:14px;">
      ${gg.history.map((h, i) => `<div class="gitem">
        <div class="name">${pick("Round", "Ronde")} ${i+1} · ${countryName(h.country)}${h.gambled ? (h.gambleWon ? ` ${icon("chip", { size: "sm" })}${icon("check", { size: "sm" })}` : ` ${icon("chip", { size: "sm" })}${icon("close", { size: "sm" })}`) : ""}</div>
        <div class="dist">${h.km == null ? "—" : Math.round(h.km).toLocaleString() + " km"}</div>
        <div></div><div class="prox">${h.pts} pts</div>
      </div>`).join("")}
    </div>
    ${gg.gambleStats?.rounds > 0 ? `
    <div class="card" style="cursor:default; text-align:center; margin-top:12px;">
      ${icon("chip", { size: "xl" })}
      <h3>${pick(`${gg.gambleStats.rounds} gambles`, `${gg.gambleStats.rounds} keer gegokt`)}</h3>
      <p>${gg.gambleStats.staked} pts ${pick("staked", "ingezet")}, ${gg.gambleStats.won} pts ${pick("paid out", "uitbetaald")}.</p>
    </div>` : ""}
    ${adSlotHtml("geoguesserResults")}
    <div class="footerrow">
      <button class="btn" data-action="show-start">${icon("chevronLeft", { size: "sm" })} Menu</button>
      <button class="btn primary" data-action="replay-solo-settings">${icon("refresh", { size: "sm" })} ${pick("Play again", "Opnieuw spelen")}</button>
    </div>`;
  initAdSlots();
}

const ggReplaySoloSettings = function () {
  ggShowSoloSettings(soloReplayPrefill || {});
};

const ggExitToStart = function () { teardown(); drawStartScreen(); };


const ggStartStreak = function () {
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
        ${icon("wifi", { size: "xl" })}<h3>${pick("No Street View found", "Geen Street View gevonden")}</h3>
        <p>${pick("Please try again.", "Probeer het opnieuw.")}</p>
        <button class="btn primary" data-action="start-streak" style="margin-top:10px;">${pick("Try again", "Opnieuw")}</button>
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
      <div class="gg-pano-loading-text">${pick("Loading panorama…", "Panorama laden…")}</div>
    </div>
    <div class="gg-hud-top" id="ggHudTop">
      <button class="gg-hud-back-btn" data-action="exit-to-start">${icon("close", { size: "sm" })}</button>
      <span class="gg-hud-pill">${icon("flame", { size: "sm" })} Streak: ${gg.streak}</span>
      <span class="gg-hud-pill">${pick("Best", "Beste")}: ${gg.best}</span>
      <button class="gg-hud-pill gg-hud-reroll" data-action="reroll-round" title="${pick("Stuck? Get another location.", "Zit je vast? Krijg een andere locatie.")}">${icon("refresh", { size: "sm" })} ${pick("Another location", "Andere locatie")}</button>
    </div>
    <div class="gg-streak-panel" id="ggStreakPanel">
      <div class="gg-map-corner-header"><span class="gg-map-guess-info">${pick("Which country is this?", "Welk land is dit?")}</span></div>
      <div style="padding:0 14px 14px; position:relative;">
        <input id="ggStreakInput" type="text" autocomplete="off" placeholder="${pick("Type a country…", "Typ een land…")}"
          style="width:100%; padding:10px 12px; border-radius:10px; border:1px solid var(--border); background:var(--panel2); color:inherit; font-size:14px;" />
        <div class="autocomplete" id="ggStreakAuto"></div>
      </div>
      <div class="gg-map-footer">
        <button class="btn primary gg-submit-btn" id="ggSubmitBtn">${icon("pin", { size: "sm" })} ${pick("Confirm guess", "Bevestig gok")}</button>
      </div>
    </div>`;
  document.body.appendChild(wrap);

  const input = document.getElementById("ggStreakInput");
  const dd = document.getElementById("ggStreakAuto");
  attachAutocomplete(input, dd, localizedCountryCandidates(ALL_NAMES), () => {});
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") submitStreakGuess(); });
  input.focus();
  document.getElementById("ggSubmitBtn").onclick = submitStreakGuess;
}

function submitStreakGuess() {
  if (gg.streakLocked) return;
  const input = document.getElementById("ggStreakInput");
  const guess = findCountryByAnyName(input?.value || "", ALL_NAMES);
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
    <div class="gametitle"><div><h2>${icon("flame", { size: "sm" })} ${pick("Streak over", "Streak voorbij")}</h2></div></div>
    <div class="card" style="cursor:default; text-align:center;">
      ${icon("warning", { size: "xl" })}
      <h3>Streak: ${gg.streak}</h3>
      <p>${pick("The correct answer was", "Het juiste antwoord was")} <strong>${countryName(gg.current.countryHint)}</strong>, ${pick("you guessed", "jij gokte")} <strong>${countryName(guess)}</strong>.</p>
      <p class="small">${isNewBest ? `${icon("trophy", { size: "sm" })} ${pick("New best streak!", "Nieuwe beste streak!")}` : `${pick("Best streak", "Beste streak")}: ${gg.best}`}</p>
        <button class="btn primary" data-action="start-streak" style="margin-top:10px;">${pick("Try again", "Opnieuw")}</button>
    </div>
    ${adSlotHtml("geoguesserResults")}
    <div class="footerrow"><button class="btn" data-action="show-start">${icon("chevronLeft", { size: "sm" })} Menu</button><div></div></div>`;
  initAdSlots();
}


const ggStartDaily = function () {
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
    <div class="gametitle"><div><h2>${icon("calendar", { size: "sm" })} ${pick("Daily challenge", "Dagelijkse challenge")}</h2><div class="desc">${result.date}</div></div></div>
    <div class="card" style="cursor:default; text-align:center;">
      ${icon("flag", { size: "xl" })}
      <h3>${result.totalScore} / ${result.rounds * 5000} ${pick("points", "punten")}</h3>
      <button class="btn primary" id="ggDailyCopyBtn" style="margin-top:10px;">${icon("clipboard", { size: "sm" })} ${pick("Copy result", "Kopieer resultaat")}</button>
    </div>
    <div class="guesslist" style="margin-top:14px;">
      ${result.history.map((h, i) => `<div class="gitem">
        <div class="name">${pick("Round", "Ronde")} ${i+1} · ${countryName(h.country)}</div>
        <div class="dist">${Math.round(h.km).toLocaleString()} km</div>
        <div></div><div class="prox">${h.pts} pts</div>
      </div>`).join("")}
    </div>
    ${adSlotHtml("geoguesserResults")}
    <div class="footerrow"><button class="btn" data-action="show-start">${icon("chevronLeft", { size: "sm" })} Menu</button><div></div></div>`;
  initAdSlots();
  const copyBtn = document.getElementById("ggDailyCopyBtn");
  if (copyBtn) {
    copyBtn.onclick = () => {
      navigator.clipboard.writeText(shareText).catch(() => {});
      copyBtn.innerHTML = `${icon("check", { size: "sm" })} ${pick("Copied!", "Gekopieerd!")}`;
      setTimeout(() => { copyBtn.innerHTML = `${icon("clipboard", { size: "sm" })} ${pick("Copy result", "Kopieer resultaat")}`; }, 2000);
    };
  }
}

const ggShowMultiplayerMenu = function () {
  setUrlPath("/geoguesser/multiplayer");
  app.innerHTML = `
    ${topbar()}
    <div class="gametitle"><div><h2>${icon("users", { size: "sm" })} GeoGuesser multiplayer</h2><div class="desc">${pick("Play the same rounds with friends in real time.", "Speel dezelfde rondes tegelijk met vrienden.")}</div></div></div>
    <div class="game-mode-grid"><button type="button" class="card game-mode-card" data-action="show-host-settings">
      ${icon("plus", { size: "lg" })}<h3>${pick("Host a lobby", "Lobby hosten")}</h3>
      <p>${pick("Choose the mode and settings, create a room and share the code.", "Stel de spelmodus en instellingen in, maak een kamer aan en deel de code.")}</p>
    </button>
    <button type="button" class="card game-mode-card" data-action="show-mp-join">
      ${icon("key", { size: "lg" })}<h3>${pick("Join a lobby", "Lobby joinen")}</h3>
      <p>${pick("Enter the code you received from a friend.", "Vul hier de code in die je van een vriend kreeg.")}</p>
    </button></div>
    <div class="footerrow">
      <button class="btn" data-action="show-start">${icon("chevronLeft", { size: "sm" })} ${pick("Back", "Terug")}</button><div></div>
    </div>`;
};

const ggShowMpHostSettings = function (prefill = {}) {
  setUrlPath("/geoguesser/multiplayer/host");
  const ar = prefill.rounds || 5;
  app.innerHTML = `
    ${topbar()}
    <div class="gametitle"><div><h2>${icon("plus", { size: "sm" })} ${pick("Host a lobby", "Lobby hosten")}</h2><div class="desc">${pick("Configure your lobby and create it.", "Stel je lobby in en maak 'm aan.")}</div></div></div>
    <div class="card" style="cursor:default;">
      <h3 style="margin-bottom:10px;">${pick("Your name", "Jouw naam")}</h3>
      <input id="ggNameInput" type="text" placeholder="${pick("Enter your name…", "Typ je naam…")}" maxlength="18" value="${escapeHtml(prefill.name || getProfile().name || "")}"
        style="width:100%; padding:10px 12px; border-radius:10px; border:1px solid var(--border); background:var(--panel2); color:inherit; font-size:14px;" />
    </div>
    <div class="card" style="cursor:default; margin-top:12px;">
      <h3 style="margin-bottom:14px;">${icon("gear", { size: "sm" })} ${pick("Lobby settings", "Lobby-instellingen")}</h3>
      <label class="gg-label">${pick("Game mode", "Spelmodus")}</label>
      <div class="gg-select-wrap"><select id="mpGameMode" class="gg-select">${gameModeOptionsHtml(prefill.gameMode || "ffa")}</select></div>
      <label class="gg-label" style="margin-top:16px;">${pick("Number of rounds", "Aantal rondes")}</label>
      <div class="gg-pill-row" id="mpRoundPills">
        ${[3,5,7,10,'∞'].map(n => `<button class="gg-pill-btn${n===ar?" active":""}" data-v="${n}">${n === '∞' ? pick('Until eliminated', 'Tot dood') : n}</button>`).join("")}
      </div>
      <label class="gg-label" style="margin-top:16px;">${pick("Locations", "Locaties")}</label>
      ${locationSettingHtml("mp", prefill.locationSet)}
      ${difficultySettingHtml("mp", prefill.difficulty, prefill.blackwhite)}
      ${timerSettingHtml("mp", prefill.roundTime || null)}
      <label style="display:flex; align-items:center; gap:8px; margin-top:14px; font-size:13px; cursor:pointer;">
        <input type="checkbox" id="mpPowerups" ${prefill.powerups !== false ? "checked" : ""} /> ${pick("Enable power-ups and sabotage", "Powerups & sabotages aan")}
      </label>
    </div>
    ${adSlotHtml("geoguesserSettings")}
    <div class="footerrow">
      <button class="btn" data-action="show-multiplayer-menu">${icon("chevronLeft", { size: "sm" })} ${pick("Back", "Terug")}</button>
      <button class="btn primary" data-action="host-lobby">${pick("Create room", "Kamer aanmaken")} ${icon("chevronRight", { size: "sm" })}</button>
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

// Split the room code into keyboard-friendly character boxes.
const ggShowMpJoin = function (prefill = {}) {
  setUrlPath("/geoguesser/multiplayer/join");
  const codeLen = 4;
  app.innerHTML = `
    ${topbar()}
    <div class="gametitle"><div><h2>${icon("key", { size: "sm" })} ${pick("Join a lobby", "Lobby joinen")}</h2><div class="desc">${pick("Enter the code you received.", "Vul de code in die je hebt gekregen.")}</div></div></div>
    <div class="card" style="cursor:default;">
      <h3 style="margin-bottom:10px;">${pick("Your name", "Jouw naam")}</h3>
      <input id="ggNameInput" type="text" placeholder="${pick("Enter your name…", "Typ je naam…")}" maxlength="18" value="${escapeHtml(prefill.name || getProfile().name || "")}"
        style="width:100%; padding:10px 12px; border-radius:10px; border:1px solid var(--border); background:var(--panel2); color:inherit; font-size:14px;" />
    </div>
    <div class="card" style="cursor:default; text-align:center; margin-top:12px;">
      <h3 style="margin-bottom:16px;">${pick("Lobby code", "Lobby-code")}</h3>
      <div class="gg-code-boxes" id="ggCodeBoxes">
        ${Array.from({ length: codeLen }, (_, i) => `<input class="gg-code-box" maxlength="1" data-i="${i}" autocomplete="off" />`).join("")}
      </div>
      <button class="btn primary" id="ggJoinBtn" style="margin-top:20px; width:100%;">${pick("Join", "Meedoen")}</button>
    </div>
    ${adSlotHtml("geoguesserSettings")}
    <div class="footerrow">
      <button class="btn" data-action="show-multiplayer-menu">${icon("chevronLeft", { size: "sm" })} ${pick("Back", "Terug")}</button><div></div>
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
  if (code.length < 4) { alert(pick("Enter a valid 4-character lobby code.", "Vul een geldige lobby-code van 4 tekens in.")); return; }
  ggJoinLobby(code);
}

function getPlayerName() {
  const input = document.getElementById("ggNameInput");
  const name = (input?.value.trim()) || "";
  if (name) {
    const p = getProfile();
    if (p.name !== name) saveProfile({ ...p, name });
  }
  return name || pick("Player", "Speler") + Math.floor(Math.random() * 900 + 100);
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

// Validate player requirements before the host starts a mode.
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

const ggSetPlayerTeam = function (playerId, team) {
  if (!gg.isHost) return;
  gg.teams = { ...gg.teams, [playerId]: team };
  gg.room.send("teams", { teams: gg.teams });
  drawLobbyWaiting();
};

const ggRandomizeTeams = function () {
  if (!gg.isHost) return;
  const shuffled = [...gg.room.players()].sort(() => Math.random() - 0.5);
  const teams = {};
  shuffled.forEach((p, i) => { teams[p.playerId] = i % 2 === 0 ? "A" : "B"; });
  gg.teams = teams;
  gg.room.send("teams", { teams: gg.teams });
  drawLobbyWaiting();
};

const ggHostLobby = async function () {
  await enterLobby(randomRoomCode(), getPlayerName(), true, getMpSettings());
};
const ggJoinLobby = async function (codeArg) {
  const code = (codeArg || document.getElementById("ggCodeInput")?.value.trim() || "").toUpperCase();
  if (code.length < 4) { alert("Vul een geldige lobby-code van 4 tekens in."); return; }
  await enterLobby(code, getPlayerName(), false, null);
};

async function enterLobby(code, name, isHost, settings, existingPlayerId) {
  app.innerHTML = `${topbar()}
    <div class="gametitle"><div><h2>${icon("users", { size: "sm" })} Lobby ${code.toUpperCase()}</h2><div class="desc">Verbinden...</div></div></div>
    <div class="ggphoto-wrap loading"><div class="ggspinner"></div></div>`;

  const server = new MultiplayerServer(code);
  let registration;
  try {
    const session = await getSession();
    if (!session) throw new Error(pick("Sign in before joining multiplayer.", "Log in voordat je multiplayer speelt."));
    registration = isHost && !existingPlayerId
      ? await server.createRoom(name, settings || {})
      : await server.joinRoom(name);
  } catch (error) {
    app.innerHTML = `${topbar()}
      <div class="card" style="cursor:default; text-align:center;">
        ${icon("lockClosed", { size: "xl" })}<h3>${pick("Sign-in required", "Inloggen vereist")}</h3>
        <p>${escapeHtml(error.message)}</p>
        <a class="btn primary" href="${accountSignInPath(location.pathname)}" style="margin-top:10px;">${pick("Go to account", "Naar account")}</a>
      </div>`;
    return;
  }

  const playerId = registration.player.playerId;
  const room = new GameRoom(code, playerId, registration.player.name);
  isHost = registration.isHost;
  name = registration.player.name;
  if (!settings) settings = registration.match.settings || {};

  gg = { mode: "mp", room, server, isHost, playerId, name, round: 0,
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
        <button class="btn primary" data-action="show-multiplayer-menu" style="margin-top:10px;">Terug</button>
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
  room.on("scoreupdate", onMpScoreUpdateReceived);
  room.on("sabotage", onMpSabotageReceived);

  room.onConnectionChange((status) => {
    if (status === "disconnected") {
      showConnBanner(`${icon("warning", { size: "sm" })} Verbinding verbroken — opnieuw verbinden...`);
    } else if (status === "reconnected") {
      hideConnBanner();
      // Ask the host for state that may have changed while disconnected.
      if (!gg.isHost) gg.room.send("resync", {});
    }
  });

  room.onPresence((players) => {
    // Assign new players to the smaller team.
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
    // Catch late joiners up to the current round.
    if (gg?.isHost && gg.screen === "round" && gg.current) {
      const knownIds = new Set((gg.roundStartPlayers || []).map(p => p.playerId));
      const newPlayers = players.filter(p => !knownIds.has(p.playerId));
      if (newPlayers.length > 0) {
        newPlayers.forEach(p => {
          gg.roundStartPlayers.push(p);
          if (!gg.scoreboard[p.playerId]) gg.scoreboard[p.playerId] = { name: p.name, total: 0 };
        });
        // Send only the panorama ID so coordinates do not reveal the answer.
        gg.room.send("round", { round: gg.round, total: gg.rounds, pano: gg.current.pano, countryHint: gg.current.countryHint });
      }
    }
  });

  gg.screen = "lobby";
  setLobbyInUrl(code);
  saveLobbySession();
  ensureChatWidget();
  drawLobbyWaiting();

  // A full reload needs an explicit state sync after creating its new room.
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
                ${escapeHtml(p.name)}${p.playerId === gg.playerId ? " (jij)" : ""}
                ${gg.isHost ? `<button class="gg-team-swap" data-player-id="${escapeHtml(p.playerId)}" data-team="${team === "A" ? "B" : "A"}" title="Naar team ${team === "A" ? "B" : "A"}">${icon("swap", { size: "sm" })}</button>` : ""}
              </div>`).join("") || `<div class="small" style="opacity:0.6;">Nog niemand</div>`}
          </div>`).join("")}
      </div>
      ${gg.isHost ? `<button class="btn" style="margin-top:10px; width:100%;" data-action="randomize-teams">${icon("dice", { size: "sm" })} Willekeurig verdelen</button>` : ""}
    </div>`;

  app.innerHTML = `
    ${topbar()}
    <div class="gametitle"><div><h2>${icon("users", { size: "sm" })} Lobby ${gg.room.code}</h2><div class="desc">${gg.isHost ? "Deel de link met je vrienden." : "Wachten tot de host het spel start..."}</div></div></div>
    <div class="card" style="cursor:default; text-align:center;">
      <div class="small">Lobby-code</div>
      <h3 style="font-size:32px; letter-spacing:6px; margin:6px 0;">${gg.room.code}</h3>
      <div class="gg-share-row">
        <input class="gg-share-input" id="ggShareUrl" value="${shareUrl}" readonly />
        <button class="btn" data-action="copy-link">${icon("clipboard", { size: "sm" })} Kopieer</button>
      </div>
      <div class="small" style="margin-top:8px;">${icon("gear", { size: "sm" })} ${modeLabel} · ${gg.rounds} rondes · ${setLabel}${gg.roundTime ? ` · ${gg.roundTime}s per ronde` : ""} · Powerups: ${gg.powerups !== false ? "Aan" : "Uit"}</div>
    </div>
    ${teamsHtml}
    <div class="guesslist" style="margin-top:14px;">
      ${players.map(p => `<div class="gitem">
        <div class="name">${escapeHtml(p.name)}${p.playerId === gg.playerId ? " (jij)" : ""}</div>
        <div></div><div></div><div></div>
      </div>`).join("")}
    </div>
    ${gg.isHost && !canStart.ok ? `<div class="small" style="color:var(--danger); margin-top:8px; text-align:center;">${canStart.reason}</div>` : ""}
    ${adSlotHtml("geoguesserLobby")}
    <div class="footerrow">
      <button class="btn" data-action="leave-lobby">${icon("chevronLeft", { size: "sm" })} Lobby verlaten</button>
      ${gg.isHost ? `<button class="btn" data-action="back-to-host-settings">${icon("gear", { size: "sm" })} Instellingen</button>` : ""}
      ${gg.isHost ? `<button class="btn primary" ${canStart.ok ? "" : "disabled"} data-action="start-mp-game">Start spel ${icon("chevronRight", { size: "sm" })}</button>` : "<div></div>"}
    </div>`;
  initAdSlots();
  app.querySelectorAll(".gg-team-swap").forEach((button) => {
    button.addEventListener("click", () => ggSetPlayerTeam(button.dataset.playerId, button.dataset.team));
  });
}

const ggCopyLink = function () {
  const input = document.getElementById("ggShareUrl");
  if (!input) return;
  navigator.clipboard.writeText(input.value).catch(() => { input.select(); document.execCommand("copy"); });
  const btn = input.nextElementSibling;
  if (btn) { btn.innerHTML = `${icon("check", { size: "sm" })} Gekopieerd!`; setTimeout(() => btn.innerHTML = `${icon("clipboard", { size: "sm" })} Kopieer`, 2000); }
};

const ggLeaveLobby = function () { teardown(); clearLobbyFromUrl(); clearLobbySession(); drawStartScreen(); };

const ggBackToHostSettings = function () {
  if (!gg?.isHost) return;
  const prefill = { name: gg.name, rounds: gg.rounds, locationSet: gg.locationSet, gameMode: gg.gameMode, roundTime: gg.roundTime, powerups: gg.powerups };
  teardown();
  clearLobbyFromUrl();
  clearLobbySession();
  ggShowMpHostSettings(prefill);
};


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

// Resend the authoritative host state after a reconnect.
function onMpResyncRequest() {
  if (!gg?.isHost) return;
  // Always restore settings before resending round or result state.
  gg.room.send("settings", { rounds: gg.rounds, locationSet: gg.locationSet, roundTime: gg.roundTime, gameMode: gg.gameMode, difficulty: gg.difficulty, blackwhite: gg.blackwhite });
  gg.room.send("teams", { teams: gg.teams });
  if (gg.screen === "round" && gg.current) {
    // Send only the panorama ID so coordinates do not reveal the answer.
        gg.room.send("round", { round: gg.round, total: gg.rounds, pano: gg.current.pano, countryHint: gg.current.countryHint });
  } else if (gg.screen === "results" && gg.lastResultsPayload) {
    gg.room.send("results", gg.lastResultsPayload);
  } else if (gg.screen === "gameover" && gg.lastGameOverPayload) {
    gg.room.send("gameover", gg.lastGameOverPayload);
  }
}

const ggMpStartGame = async function () {
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
    gg.teamHp = { A: 5000, B: 5000 };
  }
  if (gg.gameMode === "br") {
    gg.alive = new Set(gg.room.players().map(p => p.playerId));
    gg.eliminated = [];
  }

  const settings = { rounds: gg.rounds, locationSet: gg.locationSet, roundTime: gg.roundTime, gameMode: gg.gameMode, difficulty: gg.difficulty, blackwhite: gg.blackwhite, powerups: gg.powerups };
  try {
    const result = await gg.server.startMatch(settings, gg.teams);
    gg.scoreboard = result.match.state.scoreboard || gg.scoreboard;
    gg.hp = result.match.state.hp || gg.hp;
    gg.teamHp = result.match.state.teamHp || gg.teamHp;
    gg.alive = new Set(result.match.state.alive || [...gg.alive]);
  } catch (error) {
    alert(error.message);
    return;
  }

  gg.room.send("settings", settings);
  gg.room.send("teams", { teams: gg.teams });
  hostAdvanceRound();
};


async function hostAdvanceRound() {
  gg.round++;
  const outOfRounds = gg.rounds === '∞' ? false : gg.round > gg.rounds;
  const duelDecided = (gg.gameMode === "duels" || gg.gameMode === "teamduels") && gg.duelOver;
  const brDecided = gg.gameMode === "br" && gg.alive.size <= 1;
  if (outOfRounds || duelDecided || brDecided) {
    gg.room.send("gameover", {
      scoreboard: gg.scoreboard, history: gg.history,
      hp: gg.hp, teamHp: gg.teamHp, eliminated: gg.eliminated, alive: [...gg.alive],
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
  try {
    const publicRound = await gg.server.startRound({ pano: round.pano, lat: round.lat, lng: round.lng, countryHint: round.countryHint });
    gg.round = publicRound.round;
    gg.room.send("round", publicRound);
  } catch (error) {
    gg.round--;
    alert(error.message);
  }
}

async function onMpRoundStart(payload) {
  // Ignore catch-up broadcasts for an already active round.
  if (gg.screen === "round" && gg.round === payload.round) return;
  if (gg.resultMap) { clearGoogleMap(gg.resultMap); gg.resultMap = null; }

  if (payload.round === 1) {
    try {
      const state = await gg.server.playerState();
      gg.myPowerup = state.player.powerup;
      gg.mySabotage = state.player.sabotage;
      gg.usedPowerup = state.player.powerupUsed;
      gg.usedSabotage = state.player.sabotageUsed;
    } catch (error) {
      showConnBanner(`${icon("warning", { size: "sm" })} ${escapeHtml(error.message)}`);
    }
  }
  gg.hasShield = false;
  document.getElementById("ggSabotageInk")?.remove();
  if (gg.panorama) {
    gg.panorama.setOptions({ panControl: !gg.difficulty.includes("nmpz") });
  }

  // Automatically bank unresolved points before a new round starts.
  document.getElementById("ggWagerOverlay")?.remove();
  if (gg.pendingMpWager) {
    try {
      await ggMpSendWagerResult("bank");
      gg.pendingMpWager = null;
    } catch {}
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

async function submitMpGuess() {
  if (!gg.guess) return;
  gg.submitted = true;
  const info = document.getElementById("ggGuessInfo");
  const btn = document.getElementById("ggSubmitBtn");
  if (btn) btn.disabled = true;
  try {
    await gg.server.submitGuess(gg.round, gg.guess[1], gg.guess[0]);
    gg.room.send("guess", { round: gg.round });
    if (info) info.textContent = pick("Guess submitted — waiting for other players…", "Gok verstuurd — wachten op andere spelers...");
  } catch (error) {
    gg.submitted = false;
    if (btn) btn.disabled = false;
    if (info) info.textContent = error.message;
  }
}

function onMpGuessReceived(payload) {
  if (!gg.isHost || payload.round !== gg.round) return;
  gg.currentGuesses[payload.from] = { submitted: true };
  const expected = gg.gameMode === "br"
    ? gg.roundStartPlayers.filter(p => gg.alive.has(p.playerId)).length
    : gg.roundStartPlayers.length;
  if (Object.keys(gg.currentGuesses).length >= (expected || 1)) hostFinishRound();
}

async function hostFinishRound() {
  if (!gg.isHost || gg.finishingRound) return;
  gg.finishingRound = true;
  try {
    const results = await gg.server.finishRound(gg.round);
    gg.room.send("results", { round: results.round, authoritative: true });
  } catch (error) {
    showConnBanner(`${icon("warning", { size: "sm" })} ${escapeHtml(error.message)}`);
  } finally {
    gg.finishingRound = false;
  }
}

async function onMpResults(payload) {
  if (payload.round !== gg.round) return;
  try {
    payload = await gg.server.roundResults(payload.round);
  } catch (error) {
    showConnBanner(`${icon("warning", { size: "sm" })} ${escapeHtml(error.message)}`);
    return;
  }
  clearRoundTimer();
  gg.screen = "results";
  gg.lastResultsPayload = payload;
  gg.scoreboard = payload.scoreboard;
  if (payload.hp) gg.hp = payload.hp;
  if (payload.teamHp) gg.teamHp = payload.teamHp;
  if (payload.alive) gg.alive = new Set(payload.alive);
  if (payload.eliminated) gg.eliminated = payload.eliminated;
  if (payload.duelOver) gg.duelOver = true;
  gg.submitted = true;
  if (gg.map) { clearGoogleMap(gg.map); gg.map = null; gg.guessMarker = null; }
  if (gg.resultMap) { clearGoogleMap(gg.resultMap); gg.resultMap = null; }
  document.getElementById("ggFullscreenWrap")?.remove();

  // Keep local gamble points pending until the player decides.
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
    || ((gg.gameMode === "duels" || gg.gameMode === "teamduels") && gg.duelOver)
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
            <div class="small" style="display:flex; justify-content:space-between;"><span>${escapeHtml(name)}</span><span>${hp} hp${dmg ? ` · +${dmg} schade` : ""}</span></div>
            <div class="gg-hp-track"><div class="gg-hp-fill" style="width:${pct}%;"></div></div>
          </div>`;
        }).join("")}
      </div>`;
    }
    if (gg.gameMode === "teamduels" && payload.teamHp) {
      return `<div class="card" style="cursor:default; margin-top:10px;">
        <h3 style="margin-bottom:10px;">${icon("heart", { size: "sm" })} Team Levens</h3>
        ${["A", "B"].map(team => {
          const hp = payload.teamHp[team];
          const pct = Math.max(0, Math.min(100, Math.round(hp / 5000 * 100)));
          const dmg = payload.teamDamage?.[team] || 0;
          return `<div style="margin-bottom:8px;">
            <div class="small" style="display:flex; justify-content:space-between;"><span>Team ${team}</span><span>${hp} hp${dmg ? ` · +${dmg} schade` : ""}</span></div>
            <div class="gg-hp-track"><div class="gg-hp-fill" style="width:${pct}%;"></div></div>
          </div>`;
        }).join("")}
      </div>`;
    }
    if (gg.gameMode === "br" && payload.eliminatedThisRound?.length) {
      return `<div class="card" style="cursor:default; margin-top:10px; text-align:center;">
        ${icon("close", { size: "xl" })}<h3>Uitgeschakeld</h3>
        <p>${payload.eliminatedThisRound.map(escapeHtml).join(", ")}</p>
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
        <button class="btn" data-action="mp-bank-points">${icon("check", { size: "sm" })} Veilig incasseren (+${gg.pendingMpWager.pts})</button>
        <button class="btn primary" data-action="mp-open-wager">${icon("chip", { size: "sm" })} Waag ze bij het rad</button>
      </div>
    </div>` : ""}
    <div class="guesslist" style="margin-top:10px;">
      ${sorted.map((g, i) => {
        const color = PLAYER_COLORS[i % PLAYER_COLORS.length];
        return `<div class="gitem">
          <div class="name"><span class="gg-player-dot" style="background:${color};"></span>${escapeHtml(g.name)}</div>
          <div class="dist">${Math.round(g.km).toLocaleString()} km</div>
          <div></div><div class="prox">${g.pts} pts</div>
        </div>`;
      }).join("")}
    </div>
    <div class="small" style="margin:10px 0 4px;">Totaalscore</div>
    <div class="guesslist" id="ggMpTotalScoreList">
      ${Object.values(gg.scoreboard).sort((a,b) => b.total - a.total)
        .map(s => `<div class="gitem">
          <div class="name">${escapeHtml(s.name)}</div>
          <div></div><div></div><div class="prox">${s.total} pts</div>
        </div>`).join("")}
    </div>
    ${adSlotHtml("geoguesserResults")}
    <div class="footerrow">
      <div></div>
      ${gg.isHost
        ? `<button class="btn primary" data-action="mp-next">${isLast ? "Bekijk eindscore" : `Volgende ronde ${icon("chevronRight", { size: "sm" })}`}</button>`
        : `<div class="small">Wachten op host...</div>`}
    </div>`;
  initAdSlots();

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
        content: `<div style="font-size:13px; font-weight:600; padding:2px 4px;">${escapeHtml(g.name)}<br><span style="color:#555;">${Math.round(g.km).toLocaleString()} km · ${g.pts} pts</span></div>`
      });
      marker.addListener("click", () => infoWindow.open(rmap, marker));

      new mapsApi.Polyline({ path: [pos, answerPos], map: rmap,
        strokeColor: color, strokeOpacity: 0.8, strokeWeight: 2,
        icons: [{ icon: { path: "M 0,-1 0,1", strokeOpacity: 1, scale: 4 }, offset: "0", repeat: "20px" }] });
    });

    rmap.fitBounds(bounds, 60);
  }, 100);
}

const ggMpNextFromHost = function () {
  if (!gg.isHost) return;
  if (gg.resultMap) { clearGoogleMap(gg.resultMap); gg.resultMap = null; }
  hostAdvanceRound();
};


async function onMpGameOver(payload) {
  gg.screen = "gameover";
  gg.lastGameOverPayload = payload;
  if (gg.resultMap) { clearGoogleMap(gg.resultMap); gg.resultMap = null; }
  document.getElementById("ggWagerOverlay")?.remove();

  // Bank unresolved final-round points before accepting the final scoreboard.
  gg.scoreboard = payload.scoreboard;
  if (gg.pendingMpWager) {
    try {
      const result = await ggMpSendWagerResult("bank");
      gg.scoreboard = result.scoreboard;
      gg.pendingMpWager = null;
    } catch {}
  }
  if (payload.hp) gg.hp = payload.hp;
  if (payload.teamScore) gg.teamScore = payload.teamScore;
  if (payload.alive) gg.alive = new Set(payload.alive);
  if (payload.eliminated) gg.eliminated = payload.eliminated;
  const sorted = Object.values(gg.scoreboard).sort((a, b) => b.total - a.total);

  let winnerText = sorted[0] ? `${escapeHtml(sorted[0].name)} wint!` : "Klaar!";
  let extraWinnerHtml = "";
  if (gg.gameMode === "duels" && payload.hp) {
    const entries = Object.entries(payload.hp);
    const nameFor = (pid) => gg.scoreboard[pid]?.name || "Speler";
    if (entries.length === 2) {
      const [[pidA, hpA], [pidB, hpB]] = entries;
      winnerText = `${escapeHtml(hpA >= hpB ? nameFor(pidA) : nameFor(pidB))} wint het duel!`;
      extraWinnerHtml = `<p class="small">${escapeHtml(nameFor(pidA))}: ${hpA} hp · ${escapeHtml(nameFor(pidB))}: ${hpB} hp</p>`;
    }
  } else if (gg.gameMode === "teamduels" && payload.teamHp) {
    const winTeam = (payload.teamHp.A || 0) >= (payload.teamHp.B || 0) ? "A" : "B";
    winnerText = `Team ${winTeam} wint!`;
    extraWinnerHtml = `<p class="small">Team A: ${payload.teamHp.A || 0} hp · Team B: ${payload.teamHp.B || 0} hp</p>`;
  } else if (gg.gameMode === "br" && payload.alive) {
    const aliveNames = payload.alive.map((pid) => gg.scoreboard[pid]?.name).filter(Boolean);
    if (aliveNames.length === 1) winnerText = `${escapeHtml(aliveNames[0])} wint Battle Royale!`;
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
        <div class="name">${i+1}. ${escapeHtml(s.name)}</div>
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
      <button class="btn" data-action="leave-lobby">${icon("chevronLeft", { size: "sm" })} Menu</button>
      ${gg.isHost ? `<button class="btn primary" data-action="restart-mp-game">${icon("refresh", { size: "sm" })} Nieuw spel in zelfde lobby</button>` : "<div></div>"}
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

const ggMpRestartGame = function () {
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
  ggMpStartGame();
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
      <button class="gg-hud-back-btn" data-action="exit-to-start">${icon("close", { size: "sm" })}</button>
      <span class="gg-hud-pill">${roundLabel}</span>
      <span class="gg-hud-pill gg-hud-score" id="ggHudScore">${scoreLabel}</span>
      ${gg.mode === "solo" || gg.mode === "daily" ? `<button class="gg-hud-pill gg-hud-reroll" data-action="reroll-round" title="Zit je vast? Krijg een andere locatie.">${icon("refresh", { size: "sm" })} Andere locatie</button>` : ""}
    </div>
    ${gg.mode === "mp" && gg.myPowerup ? `
    <div class="gg-hud-left" style="position:absolute; left:20px; top:80px; display:flex; flex-direction:column; gap:10px; z-index:50;">
      <button id="ggBtnPowerup" class="btn primary" style="opacity:${gg.usedPowerup ? "0.5" : "1"}; box-shadow:0 4px 12px rgba(0,0,0,0.3);" data-action="use-powerup" ${gg.usedPowerup ? "disabled" : ""}>
        ${icon("star", { size: "sm" })} Power-up: ${bonusLabel(gg.myPowerup, getLanguage())}
      </button>
      <button id="ggBtnSabotage" class="btn" style="background:#e74c3c; color:white; border:none; opacity:${gg.usedSabotage ? "0.5" : "1"}; box-shadow:0 4px 12px rgba(0,0,0,0.3);" data-action="show-sabotage-menu" ${gg.usedSabotage ? "disabled" : ""}>
        ${icon("alertTriangle", { size: "sm" })} Sabotage: ${bonusLabel(gg.mySabotage, getLanguage())}
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

  // Resize Google Maps after the expanding corner finishes animating.
  const mapCorner = document.getElementById("ggMapCorner");
  const nudgeMapResize = () => {
    if (!gg.map) return;
    window.google.maps.event.trigger(gg.map, "resize");
  };
  mapCorner.addEventListener("mouseenter", () => setTimeout(nudgeMapResize, 310));
  mapCorner.addEventListener("mouseleave", () => setTimeout(nudgeMapResize, 310));
  mapCorner.addEventListener("focus", () => setTimeout(nudgeMapResize, 310));
  mapCorner.addEventListener("blur", () => setTimeout(nudgeMapResize, 310));

  // Give touch users an explicit map expansion control.
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

  // Block all panorama input because Street View has no complete freeze option.
  if (gg.difficulty === "nmpz") {
    const wrap = document.getElementById("ggFullscreenWrap");
    if (wrap && !document.getElementById("ggNmpzBlocker")) {
      const blocker = document.createElement("div");
      blocker.id = "ggNmpzBlocker";
      blocker.className = "gg-nmpz-blocker";
      wrap.insertBefore(blocker, wrap.querySelector(".gg-hud-top") || null);
    }
  }

  // Keep the loader visible until panorama imagery is ready.
  const hideLoading = () => document.getElementById("ggPanoLoading")?.classList.add("gg-hidden");
  maps.event.addListenerOnce(gg.panorama, "status_changed", hideLoading);
  maps.event.addListenerOnce(gg.panorama, "pano_changed", hideLoading);
  // Prevent a stale loader if the Maps events never fire.
  setTimeout(hideLoading, 4000);

  updateCheatHint();
}

// Gamble mode lets players bank points or risk them on the wheel.

const ROULETTE_RED = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);
function rouletteColor(n) {
  if (n === 0) return "green";
  return ROULETTE_RED.has(n) ? "red" : "black";
}

const ggBankPoints = function () {
  if (gg.pendingPts == null) return;
  gg.totalScore += gg.pendingPts;
  gg.history.push({ km: gg.pendingKm, pts: gg.pendingPts, country: gg.current.countryHint });
  gg.pendingPts = null;
  gg.pendingKm = null;
  ggResolveWager();
};

const ggOpenWager = function () {
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
        <button class="btn" data-action="cancel-wager">Terug</button>
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

const ggCancelWager = function () {
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
  actions.innerHTML = `<button class="btn primary" data-action="resolve-wager" style="width:100%;">Verder ${icon("chevronRight", { size: "sm" })}</button>`;
}

const ggResolveWager = function () {
  document.getElementById("ggWagerPanel")?.remove();
  const stat = document.querySelector("#ggResultOverlay .gg-result-stat");
  if (stat) stat.innerHTML = `Totaal: ${gg.totalScore} pts`;
  const nextBtn = document.getElementById("ggNextRoundBtn");
  if (nextBtn) nextBtn.style.display = "";
};

// Update only the live scoreboard so open gamble overlays remain intact.
function onMpScoreUpdateReceived(payload) {
  gg.scoreboard = payload.scoreboard;
  if (gg.screen !== "results") return;
  const list = document.getElementById("ggMpTotalScoreList");
  if (!list) return;
  list.innerHTML = Object.values(gg.scoreboard).sort((a, b) => b.total - a.total)
    .map((s) => `<div class="gitem"><div class="name">${escapeHtml(s.name)}</div><div></div><div></div><div class="prox">${s.total} pts</div></div>`)
    .join("");
}

async function ggMpSendWagerResult(choice = "bank") {
  try {
    const result = await gg.server.wager(gg.round, choice);
    gg.scoreboard = result.scoreboard;
    gg.room.send("scoreupdate", { scoreboard: result.scoreboard });
    onMpScoreUpdateReceived({ scoreboard: result.scoreboard });
    return result;
  } catch (error) {
    showConnBanner(`${icon("warning", { size: "sm" })} ${escapeHtml(error.message)}`);
    throw error;
  }
}

const ggMpBankPoints = async function () {
  if (!gg.pendingMpWager) return;
  try {
    await ggMpSendWagerResult("bank");
    gg.pendingMpWager = null;
    document.getElementById("ggMpWagerPanel")?.remove();
  } catch {}
};

const ggMpOpenWager = function () {
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
        <button class="btn" data-action="cancel-wager">Terug</button>
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

async function ggMpWagerSpin(chosen) {
  const overlay = document.getElementById("ggWagerOverlay");
  if (!overlay || !gg.pendingMpWager) return;
  const numberEl = document.getElementById("ggWagerNumber");
  overlay.querySelectorAll("button").forEach((b) => b.disabled = true);

  let result;
  try {
    result = await ggMpSendWagerResult(chosen);
  } catch {
    overlay.querySelectorAll("button").forEach((button) => { button.disabled = false; });
    return;
  }
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
      const finalN = result.number;
      const finalColor = rouletteColor(finalN);
      numberEl.textContent = finalN;
      numberEl.className = `gg-roulette-number gg-roulette-${finalColor}`;
      const mult = chosen === "green" ? 5 : 2;
      ggMpWagerShowResult(result.won, result.payout, mult);
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
  actions.innerHTML = `<button class="btn primary" data-action="cancel-wager" style="width:100%;">Verder ${icon("chevronRight", { size: "sm" })}</button>`;
}

const ggUsePowerup = async function () {
  if (gg.usedPowerup) return;
  const button = document.getElementById("ggBtnPowerup");
  if (button) button.disabled = true;
  let result;
  try {
    result = await gg.server.usePowerup();
  } catch (error) {
    if (button) button.disabled = false;
    showConnBanner(`${icon("warning", { size: "sm" })} ${escapeHtml(error.message)}`);
    return;
  }
  gg.usedPowerup = true;
  if (button) button.style.opacity = "0.5";

  if (result.type === "shield") {
    gg.hasShield = true;
    showConnBanner(`${icon("star", { size: "sm" })} Schild geactiveerd! (beschermt deels tegen duel schade of geeft score boost)`);
    setTimeout(() => hideConnBanner(), 3000);
  } else if (result.type === "hint") {
    showConnBanner(`💡 Echte Hint: Het is <strong>${escapeHtml(result.countryHint)}</strong>`);
    setTimeout(() => hideConnBanner(), 5000);
  } else if (result.type === "5050") {
    showConnBanner(`💡 50/50: Het is <strong>${result.options.map(escapeHtml).join("</strong> of <strong>")}</strong>`);
    setTimeout(() => hideConnBanner(), 5000);
  }
};

const ggUseSabotageMenu = function () {
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
    return `<button class="btn gg-sabotage-target" data-target="${escapeHtml(pid)}" style="width:100%; margin-bottom:8px;">${escapeHtml(name)}</button>`;
  }).join("");

  overlay.innerHTML = `
    <div class="gg-roulette-modal">
      <h3>Kies een doelwit</h3>
      <p class="small" style="margin-bottom:12px;">Sabotage: ${bonusLabel(gg.mySabotage, getLanguage())}</p>
      ${listHtml}
      <button class="btn" data-action="close-sabotage-menu" style="width:100%; margin-top:8px;">Annuleren</button>
    </div>`;
  wrap.appendChild(overlay);
  overlay.querySelectorAll(".gg-sabotage-target").forEach((button) => {
    button.addEventListener("click", () => ggSendSabotage(button.dataset.target));
  });
};

const ggSendSabotage = async function (targetId) {
  document.getElementById("ggSabotageMenu")?.remove();
  if (gg.usedSabotage) return;
  const targetName = gg.scoreboard[targetId]?.name || pick("Player", "Speler");
  const button = document.getElementById("ggBtnSabotage");
  if (button) button.disabled = true;
  let sabotage;
  try {
    sabotage = await gg.server.useSabotage(targetId);
  } catch (error) {
    if (button) button.disabled = false;
    showConnBanner(`${icon("warning", { size: "sm" })} ${escapeHtml(error.message)}`);
    return;
  }
  gg.usedSabotage = true;
  if (button) button.style.opacity = "0.5";

  gg.room.send("sabotage", sabotage);
  showConnBanner(`${icon("alertTriangle", { size: "sm" })} ${pick("Used", "Sabotage")} '${bonusLabel(gg.mySabotage, getLanguage())}' ${pick("on", "ingezet op")} ${escapeHtml(targetName)}!`);
  setTimeout(() => hideConnBanner(), 3000);
};

function onMpSabotageReceived(payload) {
  if (payload.target !== gg.playerId) return;

  if (payload.sabotageType === "fakehint") {
    const fakes = ["Verenigde Staten", "Frankrijk", "Rusland", "Brazilië", "India", "Zuid-Afrika", "Mexico", "China"];
    let fake = fakes[Math.floor(Math.random() * fakes.length)];
    if (fake === gg.current?.countryHint) fake = "IJsland"; // fallback
    showConnBanner(`💡 HINT: Het is <strong>${fake}</strong>`);
    setTimeout(() => hideConnBanner(), 5000);
  } else if (payload.sabotageType === "ink") {
    const wrap = document.getElementById("ggFullscreenWrap");
    if (wrap) {
      const ink = document.createElement("div");
      ink.id = "ggSabotageInk";
      ink.style.position = "absolute";
      ink.style.inset = "0";
      ink.style.backdropFilter = "blur(15px) contrast(0.8) brightness(0.5)";
      ink.style.zIndex = "999";
      ink.style.pointerEvents = "none";
      const message = document.createElement("div");
      message.className = "gg-sabotage-message";
      message.textContent = pick(`Sabotaged by ${payload.fromName}!`, `Je bent gesaboteerd door ${payload.fromName}!`);
      ink.appendChild(message);
      wrap.appendChild(ink);
      setTimeout(() => ink.remove(), 5000);
    }
  } else if (payload.sabotageType === "spin") {
    if (gg.panorama) {
      const currentPov = gg.panorama.getPov();
      gg.panorama.setPov({ heading: (currentPov.heading + 180) % 360, pitch: -currentPov.pitch });
      showConnBanner(`${icon("alertTriangle", { size: "sm" })} ${escapeHtml(payload.fromName)} ${pick("turned your view around!", "heeft je blik omgedraaid!")}`);
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

const GEO_ACTIONS = {
  "dismiss-reconnect": () => ggDismissReconnect(),
  "reconnect-lobby": () => ggReconnectLobby(),
  "auto-join": (control) => ggAutoJoin(control.dataset.code),
  "show-start": () => ggShowStart(),
  "show-solo-settings": () => ggShowSoloSettings(),
  "start-solo": () => ggStartSolo(),
  "start-streak": () => ggStartStreak(),
  "start-daily": () => ggStartDaily(),
  "exit-to-start": () => ggExitToStart(),
  "reroll-round": () => ggRerollRound(),
  "bank-points": () => ggBankPoints(),
  "open-wager": () => ggOpenWager(),
  "replay-solo-settings": () => ggReplaySoloSettings(),
  "show-multiplayer-menu": () => ggShowMultiplayerMenu(),
  "show-host-settings": () => openProtectedMultiplayer("/geoguesser/multiplayer/host", () => ggShowMpHostSettings()),
  "show-mp-join": () => openProtectedMultiplayer("/geoguesser/multiplayer/join", () => ggShowMpJoin()),
  "host-lobby": () => ggHostLobby(),
  "randomize-teams": () => ggRandomizeTeams(),
  "copy-link": () => ggCopyLink(),
  "leave-lobby": () => ggLeaveLobby(),
  "back-to-host-settings": () => ggBackToHostSettings(),
  "start-mp-game": () => ggMpStartGame(),
  "mp-bank-points": () => ggMpBankPoints(),
  "mp-open-wager": () => ggMpOpenWager(),
  "mp-next": () => ggMpNextFromHost(),
  "restart-mp-game": () => ggMpRestartGame(),
  "use-powerup": () => ggUsePowerup(),
  "show-sabotage-menu": () => ggUseSabotageMenu(),
  "cancel-wager": () => ggCancelWager(),
  "resolve-wager": () => {
    ggCancelWager();
    ggResolveWager();
  },
  "close-sabotage-menu": () => document.getElementById("ggSabotageMenu")?.remove(),
};
