import L from "leaflet";
import "leaflet/dist/leaflet.css";
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
let gg = null; // shared mutable game state for the currently rendered screen

// ---------- Location set helpers ----------

/**
 * Build a function that returns a random {country, lat, lon} point
 * from the given location-set key (e.g. "world", "europe", "bigcities").
 */
function buildPointFn(setKey = "world") {
  const set = LOCATION_SETS[setKey] || LOCATION_SETS["world"];
  const eligible = set.countries.filter(
    (c) => GEO_POINTS[c] && GEO_POINTS[c].length,
  );
  return function randomPoint() {
    const country = eligible[Math.floor(Math.random() * eligible.length)];
    const pts = GEO_POINTS[country];
    if (set.onlyCapital) {
      return { country, ...pts[0] };
    }
    // Weight the first entry (capital/most-known city) slightly higher
    const weighted = [];
    pts.forEach((p, i) => {
      const w = i === 0 ? 2 : 1;
      for (let k = 0; k < w; k++) weighted.push(p);
    });
    return { country, ...weighted[Math.floor(Math.random() * weighted.length)] };
  };
}

function scoreForDistance(km) {
  if (km < 20) return 5000;
  return Math.max(0, Math.round(5000 * Math.exp(-km / 2000)));
}

function teardown() {
  if (gg && gg.panorama) gg.panorama = null;
  if (gg && gg.map) {
    gg.map.remove();
    gg.map = null;
  }
  if (gg && gg.room) {
    gg.room.leave();
    gg.room = null;
  }
  if (gg && gg.roundTimer) {
    clearTimeout(gg.roundTimer);
    gg.roundTimer = null;
  }
  // Remove fullscreen wrapper if present
  const wrap = document.getElementById("ggFullscreenWrap");
  if (wrap) wrap.remove();
}

// ---------- Entry point / start screen ----------

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
        <p style="margin-bottom:10px;">Dit spel gebruikt echte, interactieve <a class="linklike" href="https://developers.google.com/maps/documentation/javascript/streetview" target="_blank" rel="noopener">Google Street View</a>-panorama's. Maak gratis een Google Cloud-project, zet de <em>Maps JavaScript API</em> aan, maak een API-key en beperk 'm tot je eigen domein. Zet 'm dan in <code>.env</code> (lokaal) of bij je Vercel project:</p>
        <div class="small" style="background:var(--panel2); padding:10px 12px; border-radius:10px; font-family:monospace;">VITE_GOOGLE_MAPS_KEY=jouw-key</div>
        <p class="small" style="margin-top:10px;">Google geeft $200 gratis tegoed per maand — voor spelen met vrienden kom je daar niet overheen.</p>
      </div>
    `;
    return;
  }

  drawStartScreen();
}

function drawStartScreen() {
  const mpAvailable = hasMultiplayerConfig();
  app.innerHTML = `
    ${topbar()}
    <div class="gametitle">
      <div><h2>📍 GeoGuesser</h2><div class="desc">Waar op aarde is dit?</div></div>
    </div>
    <div class="card" style="cursor:pointer;" onclick="ggShowSoloSettings()">
      <span class="icon">🧍</span>
      <h3>Solo spelen</h3>
      <p>Kies je rondes en locaties, speel op je eigen tempo.</p>
    </div>
    <div class="card" style="cursor:${mpAvailable ? "pointer" : "default"}; opacity:${mpAvailable ? "1" : "0.55"};" ${mpAvailable ? 'onclick="ggShowMultiplayerMenu()"' : ""}>
      <span class="icon">👥</span>
      <h3>Met vrienden (multiplayer)</h3>
      <p>${mpAvailable ? "Maak een lobby of join er een met een code, en speel dezelfde rondes tegelijk." : "Multiplayer is nog niet ingesteld (Supabase-omgevingsvariabelen ontbreken)."}</p>
    </div>
  `;
}

// ---------- Solo settings screen ----------

window.ggShowSoloSettings = function () {
  const setOptions = Object.entries(LOCATION_SETS)
    .map(
      ([key, s]) =>
        `<option value="${key}">${s.label}</option>`,
    )
    .join("");

  app.innerHTML = `
    ${topbar()}
    <div class="gametitle"><div><h2>🧍 Solo spelen</h2><div class="desc">Kies je instellingen.</div></div></div>

    <div class="card" style="cursor:default;">
      <h3 style="margin-bottom:14px;">Instellingen</h3>

      <label class="gg-label">Aantal rondes</label>
      <div class="gg-pill-row" id="soloRoundPills">
        <button class="gg-pill-btn" data-v="3">3</button>
        <button class="gg-pill-btn active" data-v="5">5</button>
        <button class="gg-pill-btn" data-v="7">7</button>
        <button class="gg-pill-btn" data-v="10">10</button>
      </div>

      <label class="gg-label" style="margin-top:16px;">Locaties</label>
      <div class="gg-select-wrap">
        <select id="soloLocationSet" class="gg-select">
          ${setOptions}
        </select>
      </div>
    </div>

    <div class="footerrow">
      <button class="btn" onclick="ggShowStart()">← Terug</button>
      <button class="btn primary" onclick="ggStartSolo()">Spelen →</button>
    </div>
  `;

  // Pill toggle logic
  document.getElementById("soloRoundPills").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-v]");
    if (!btn) return;
    document
      .querySelectorAll("#soloRoundPills .gg-pill-btn")
      .forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
  });
};

window.ggShowStart = function () {
  drawStartScreen();
};

window.ggStartSolo = function () {
  const roundBtn = document.querySelector("#soloRoundPills .gg-pill-btn.active");
  const rounds = roundBtn ? parseInt(roundBtn.dataset.v, 10) : 5;
  const locSet = document.getElementById("soloLocationSet")?.value || "world";

  gg = {
    mode: "solo",
    round: 0,
    totalScore: 0,
    rounds,
    locationSet: locSet,
    pointFn: buildPointFn(locSet),
    history: [],
    current: null,
    guess: null,
    map: null,
    panorama: null,
  };
  nextSoloRound();
};

// ---------- Solo mode ----------

function drawFullscreenLoading(roundLabel) {
  // Remove any existing fullscreen wrap
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
      <button class="gg-hud-back-btn" onclick="ggExitToStart()">← Stoppen</button>
      <span class="gg-hud-pill">${roundLabel}</span>
    </div>
  `;
  document.body.appendChild(wrap);
}

async function nextSoloRound() {
  gg.round++;
  gg.guess = null;
  gg.submitted = false;

  if (gg.map) {
    gg.map.remove();
    gg.map = null;
  }
  gg.panorama = null;

  drawFullscreenLoading(`Ronde ${gg.round} / ${gg.rounds}`);

  const maps = await loadGoogleMaps();
  const round = await findStreetViewRound(maps, gg.pointFn);

  if (!round) {
    const wrap = document.getElementById("ggFullscreenWrap");
    if (wrap) wrap.remove();
    app.innerHTML = `${topbar()}
      <div class="gametitle"><div><h2>📍 GeoGuesser</h2></div></div>
      <div class="card" style="cursor:default;">
        <span class="icon">📡</span>
        <h3>Geen Street View-dekking gevonden</h3>
        <p>Er kon geen panorama gevonden worden na meerdere pogingen. Probeer het nog eens.</p>
        <button class="btn primary" onclick="ggStartSolo()" style="margin-top:10px;">Opnieuw proberen</button>
      </div>`;
    return;
  }

  gg.current = round;
  drawRoundScreen({
    roundLabel: `Ronde ${gg.round} / ${gg.rounds}`,
    scoreLabel: `${gg.totalScore} pts`,
    onSubmit: submitSoloGuess,
  });
  initPanorama(round);
  initMap();
}

function submitSoloGuess() {
  if (!gg.guess) return;
  gg.submitted = true;
  const km = haversineKm(gg.guess, [gg.current.lng, gg.current.lat]);
  const pts = scoreForDistance(km);
  gg.totalScore += pts;
  gg.history.push({ km, pts, country: gg.current.countryHint });
  renderMarkers();
  showRoundResult(km, pts, gg.round < gg.rounds ? nextSoloRound : showSoloFinalScore);
}

function showSoloFinalScore() {
  teardown();
  const avg = Math.round(gg.totalScore / gg.rounds);
  app.innerHTML = `
    ${topbar()}
    <div class="gametitle"><div><h2>📍 GeoGuesser</h2><div class="desc">Eindresultaat</div></div></div>
    <div class="card" style="cursor:default; text-align:center;">
      <span class="icon">🏁</span>
      <h3>${gg.totalScore} / ${gg.rounds * 5000} punten</h3>
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
      <button class="btn" onclick="ggShowStart()">← Menu</button>
      <button class="btn primary" onclick="ggShowSoloSettings()">🔄 Nieuw spel</button>
    </div>
  `;
}

window.ggExitToStart = function () {
  teardown();
  drawStartScreen();
};

// ---------- Multiplayer: menu ----------

window.ggShowMultiplayerMenu = function () {
  const setOptions = Object.entries(LOCATION_SETS)
    .map(([key, s]) => `<option value="${key}">${s.label}</option>`)
    .join("");

  app.innerHTML = `
    ${topbar()}
    <div class="gametitle"><div><h2>👥 GeoGuesser multiplayer</h2><div class="desc">Speel dezelfde rondes tegelijk met vrienden.</div></div></div>

    <div class="card" style="cursor:default;">
      <h3 style="margin-bottom:10px;">Jouw naam</h3>
      <input id="ggNameInput" class="ggtext-input" type="text" placeholder="Bijv. Rafi" maxlength="18"
        style="width:100%; padding:10px 12px; border-radius:10px; border:1px solid var(--border); background:var(--panel2); color:inherit; font-size:14px;" />
    </div>

    <div class="card" style="cursor:default; margin-top:12px;">
      <h3 style="margin-bottom:14px;">🎮 Lobby-instellingen <span class="small">(voor nieuwe lobby)</span></h3>

      <label class="gg-label">Aantal rondes</label>
      <div class="gg-pill-row" id="mpRoundPills">
        <button class="gg-pill-btn" data-v="3">3</button>
        <button class="gg-pill-btn active" data-v="5">5</button>
        <button class="gg-pill-btn" data-v="7">7</button>
        <button class="gg-pill-btn" data-v="10">10</button>
      </div>

      <label class="gg-label" style="margin-top:16px;">Locaties</label>
      <div class="gg-select-wrap">
        <select id="mpLocationSet" class="gg-select">
          ${setOptions}
        </select>
      </div>
    </div>

    <div class="card" style="cursor:pointer; margin-top:12px;" onclick="ggHostLobby()">
      <span class="icon">➕</span>
      <h3>Nieuwe lobby maken</h3>
      <p>Jij bent host en start het spel voor iedereen.</p>
    </div>

    <div class="card" style="cursor:default; margin-top:12px;">
      <span class="icon">🔑</span>
      <h3>Lobby joinen</h3>
      <div style="display:flex; gap:8px; margin-top:8px;">
        <input id="ggCodeInput" type="text" placeholder="CODE" maxlength="4"
          style="flex:1; text-transform:uppercase; padding:10px 12px; border-radius:10px; border:1px solid var(--border); background:var(--panel2); color:inherit; font-size:14px; letter-spacing:2px; text-align:center;" />
        <button class="btn primary" onclick="ggJoinLobby()">Join</button>
      </div>
    </div>

    <div class="footerrow">
      <button class="btn" onclick="ggShowStart()">← Terug</button>
      <div></div>
    </div>
  `;

  document.getElementById("mpRoundPills").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-v]");
    if (!btn) return;
    document
      .querySelectorAll("#mpRoundPills .gg-pill-btn")
      .forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
  });
};

function getPlayerName() {
  const input = document.getElementById("ggNameInput");
  const name = (input && input.value.trim()) || "";
  return name || "Speler" + Math.floor(Math.random() * 900 + 100);
}

function getMpSettings() {
  const roundBtn = document.querySelector("#mpRoundPills .gg-pill-btn.active");
  const rounds = roundBtn ? parseInt(roundBtn.dataset.v, 10) : 5;
  const locSet = document.getElementById("mpLocationSet")?.value || "world";
  return { rounds, locationSet: locSet };
}

window.ggHostLobby = async function () {
  const name = getPlayerName();
  const settings = getMpSettings();
  const code = randomRoomCode();
  await enterLobby(code, name, true, settings);
};

window.ggJoinLobby = async function () {
  const name = getPlayerName();
  const codeInput = document.getElementById("ggCodeInput");
  const code = (codeInput && codeInput.value.trim()) || "";
  if (code.length < 4) {
    alert("Vul een geldige lobby-code van 4 tekens in.");
    return;
  }
  await enterLobby(code, name, false, null);
};

async function enterLobby(code, name, isHost, settings) {
  app.innerHTML = `${topbar()}
    <div class="gametitle"><div><h2>👥 Lobby ${code.toUpperCase()}</h2><div class="desc">Verbinden...</div></div></div>
    <div class="ggphoto-wrap loading"><div class="ggspinner"></div></div>`;

  const playerId = randomPlayerId();
  const room = new GameRoom(code, playerId, name);

  gg = {
    mode: "mp",
    room,
    isHost,
    playerId,
    name,
    round: 0,
    rounds: settings ? settings.rounds : 5,
    locationSet: settings ? settings.locationSet : "world",
    pointFn: settings ? buildPointFn(settings.locationSet) : buildPointFn("world"),
    scoreboard: {},
    history: [],
    guess: null,
    submitted: false,
    map: null,
    panorama: null,
    currentGuesses: {},
    roundStartPlayers: [],
  };

  try {
    await room.connect();
  } catch (e) {
    app.innerHTML = `${topbar()}
      <div class="card" style="cursor:default;">
        <span class="icon">⚠️</span>
        <h3>Kon niet verbinden</h3>
        <p>${e.message}</p>
        <button class="btn primary" onclick="ggShowMultiplayerMenu()" style="margin-top:10px;">Terug</button>
      </div>`;
    return;
  }

  room.on("round", onMpRoundStart);
  room.on("guess", onMpGuessReceived);
  room.on("results", onMpResults);
  room.on("gameover", onMpGameOver);
  room.on("settings", onMpSettingsReceived); // host broadcasts settings to joiners
  room.onPresence(() => {
    if (gg && gg.screen === "lobby") drawLobbyWaiting();
  });

  gg.screen = "lobby";
  drawLobbyWaiting();
}

function onMpSettingsReceived(payload) {
  // Non-host players receive host settings when host starts the game
  if (gg.isHost) return;
  gg.rounds = payload.rounds;
  gg.locationSet = payload.locationSet;
  gg.pointFn = buildPointFn(payload.locationSet);
}

function drawLobbyWaiting() {
  const players = gg.room.players();
  const setLabel = LOCATION_SETS[gg.locationSet]?.label || gg.locationSet;
  app.innerHTML = `
    ${topbar()}
    <div class="gametitle"><div><h2>👥 Lobby ${gg.room.code}</h2><div class="desc">${gg.isHost ? "Deel deze code met je vrienden." : "Wachten tot de host het spel start..."}</div></div></div>
    <div class="card" style="cursor:default; text-align:center;">
      <div class="small">Lobby-code</div>
      <h3 style="font-size:32px; letter-spacing:6px; margin:6px 0;">${gg.room.code}</h3>
      ${gg.isHost ? `<div class="small" style="margin-top:8px;">⚙️ ${gg.rounds} rondes · ${setLabel}</div>` : ""}
    </div>
    <div class="guesslist" style="margin-top:14px;">
      ${players
        .map(
          (p) => `<div class="gitem">
          <div class="name">${p.name}${p.playerId === gg.playerId ? " (jij)" : ""}</div>
          <div></div><div></div><div></div>
        </div>`,
        )
        .join("")}
    </div>
    <div class="footerrow">
      <button class="btn" onclick="ggLeaveLobby()">← Lobby verlaten</button>
      ${gg.isHost ? '<button class="btn primary" onclick="ggMpStartGame()">Start spel →</button>' : "<div></div>"}
    </div>
  `;
}

window.ggLeaveLobby = function () {
  teardown();
  drawStartScreen();
};

window.ggMpStartGame = function () {
  if (!gg.isHost) return;
  gg.scoreboard = {};
  gg.room.players().forEach((p) => {
    gg.scoreboard[p.playerId] = { name: p.name, total: 0 };
  });
  // Broadcast settings to all non-host players
  gg.room.send("settings", { rounds: gg.rounds, locationSet: gg.locationSet });
  hostAdvanceRound();
};

// ---------- Multiplayer: game loop (host drives round progression) ----------

async function hostAdvanceRound() {
  gg.round++;
  if (gg.round > gg.rounds) {
    const history = gg.history;
    const scoreboard = gg.scoreboard;
    gg.room.send("gameover", { scoreboard, history });
    return;
  }
  gg.screen = "loading";

  drawFullscreenLoading(`Ronde ${gg.round} / ${gg.rounds} — locatie zoeken...`);

  const maps = await loadGoogleMaps();
  const round = await findStreetViewRound(maps, gg.pointFn);
  if (!round) {
    gg.round--;
    return hostAdvanceRound();
  }
  gg.currentGuesses = {};
  gg.finishingRound = false;
  gg.roundStartPlayers = gg.room.players();
  gg.room.send("round", {
    round: gg.round,
    total: gg.rounds,
    lat: round.lat,
    lng: round.lng,
    pano: round.pano,
    countryHint: round.countryHint,
  });
}

function onMpRoundStart(payload) {
  gg.round = payload.round;
  gg.current = payload;
  gg.guess = null;
  gg.submitted = false;
  gg.screen = "round";

  // Update rounds count from payload (in case joiner had different value)
  if (payload.total) gg.rounds = payload.total;

  drawRoundScreen({
    roundLabel: `Ronde ${payload.round} / ${payload.total}`,
    scoreLabel: `${playerScore()} pts`,
    onSubmit: submitMpGuess,
  });
  initPanorama(payload);
  initMap();

  if (gg.isHost) {
    // Inject "Forceer" button into the HUD
    const hud = document.getElementById("ggHudTop");
    if (hud) {
      const forceBtn = document.createElement("button");
      forceBtn.className = "gg-hud-pill gg-hud-force";
      forceBtn.textContent = "⏩ Forceer";
      forceBtn.onclick = () => hostFinishRound();
      hud.appendChild(forceBtn);
    }
  }
}

function playerScore() {
  const entry = gg.scoreboard && gg.scoreboard[gg.playerId];
  return entry ? entry.total : 0;
}

function submitMpGuess() {
  if (!gg.guess) return;
  gg.submitted = true;
  gg.room.send("guess", {
    round: gg.round,
    name: gg.name,
    lat: gg.guess[1],
    lng: gg.guess[0],
  });
  const info = document.getElementById("ggGuessInfo");
  if (info) info.textContent = "Gok verstuurd — wachten op andere spelers...";
  const submitBtn = document.getElementById("ggSubmitBtn");
  if (submitBtn) submitBtn.disabled = true;
}

function onMpGuessReceived(payload) {
  if (!gg.isHost) return;
  if (payload.round !== gg.round) return;
  gg.currentGuesses[payload.from] = {
    name: payload.name,
    lat: payload.lat,
    lng: payload.lng,
  };
  const expected = gg.roundStartPlayers.length || 1;
  const got = Object.keys(gg.currentGuesses).length;
  if (got >= expected) hostFinishRound();
}

function hostFinishRound() {
  if (!gg.isHost || gg.finishingRound) return;
  gg.finishingRound = true;
  const answer = {
    lat: gg.current.lat,
    lng: gg.current.lng,
    countryHint: gg.current.countryHint,
  };
  const guesses = Object.entries(gg.currentGuesses).map(([playerId, g]) => {
    const km = haversineKm([g.lng, g.lat], [answer.lng, answer.lat]);
    const pts = scoreForDistance(km);
    if (!gg.scoreboard[playerId])
      gg.scoreboard[playerId] = { name: g.name, total: 0 };
    gg.scoreboard[playerId].total += pts;
    gg.scoreboard[playerId].name = g.name;
    return { playerId, name: g.name, lat: g.lat, lng: g.lng, km, pts };
  });
  gg.history.push({ round: gg.round, country: answer.countryHint, guesses });
  gg.room.send("results", {
    round: gg.round,
    total: gg.rounds,
    answer,
    guesses,
    scoreboard: gg.scoreboard,
  });
  gg.finishingRound = false;
}

function onMpResults(payload) {
  if (payload.round !== gg.round) return;
  gg.scoreboard = payload.scoreboard;
  gg.submitted = true;
  // Remove fullscreen round wrap
  const wrap = document.getElementById("ggFullscreenWrap");
  if (wrap) wrap.remove();
  if (gg.map) { gg.map.remove(); gg.map = null; }
  drawMpResultsScreen(payload);
}

function drawMpResultsScreen(payload) {
  const sorted = [...payload.guesses].sort((a, b) => b.pts - a.pts);
  const isLast = gg.round >= gg.rounds;
  app.innerHTML = `
    ${topbar()}
    <div class="gametitle"><div><h2>📍 GeoGuesser</h2><div class="desc">Ronde ${gg.round}/${gg.rounds} · resultaten</div></div></div>
    <div class="card" style="cursor:default; text-align:center;">
      <span class="icon">📍</span>
      <h3>${payload.answer.countryHint}</h3>
    </div>
    <div class="guesslist" style="margin-top:14px;">
      ${sorted
        .map(
          (g) => `<div class="gitem">
          <div class="name">${g.name}</div>
          <div class="dist">${Math.round(g.km).toLocaleString()} km</div>
          <div></div>
          <div class="prox">${g.pts} pts</div>
        </div>`,
        )
        .join("")}
    </div>
    <div class="small" style="margin:10px 0 4px;">Totaalscore</div>
    <div class="guesslist">
      ${Object.values(payload.scoreboard)
        .sort((a, b) => b.total - a.total)
        .map(
          (s) => `<div class="gitem">
          <div class="name">${s.name}</div>
          <div></div><div></div>
          <div class="prox">${s.total} pts</div>
        </div>`,
        )
        .join("")}
    </div>
    <div class="footerrow">
      <div></div>
      ${gg.isHost ? `<button class="btn primary" onclick="ggMpNextFromHost()">${isLast ? "Bekijk eindscore" : "Volgende ronde →"}</button>` : `<div class="small">Wachten op host...</div>`}
    </div>
  `;
}

window.ggMpNextFromHost = function () {
  if (!gg.isHost) return;
  hostAdvanceRound();
};

function onMpGameOver(payload) {
  teardown();
  const sorted = Object.values(payload.scoreboard).sort(
    (a, b) => b.total - a.total,
  );
  app.innerHTML = `
    ${topbar()}
    <div class="gametitle"><div><h2>📍 GeoGuesser</h2><div class="desc">Eindresultaat</div></div></div>
    <div class="card" style="cursor:default; text-align:center;">
      <span class="icon">🏁</span>
      <h3>${sorted[0] ? sorted[0].name + " wint!" : "Klaar!"}</h3>
    </div>
    <div class="guesslist" style="margin-top:14px;">
      ${sorted
        .map(
          (s, i) => `<div class="gitem">
          <div class="name">${i + 1}. ${s.name}</div>
          <div></div><div></div>
          <div class="prox">${s.total} pts</div>
        </div>`,
        )
        .join("")}
    </div>
    <div class="footerrow">
      <button class="btn" onclick="ggShowStart()">← Menu</button>
      <button class="btn primary" onclick="ggShowMultiplayerMenu()">🔄 Nieuw spel</button>
    </div>
  `;
}

// ---------- Shared: fullscreen round screen ----------

function drawRoundScreen({ roundLabel, scoreLabel, onSubmit }) {
  // Remove any existing fullscreen wrap
  const existing = document.getElementById("ggFullscreenWrap");
  if (existing) existing.remove();

  const wrap = document.createElement("div");
  wrap.id = "ggFullscreenWrap";
  wrap.className = "gg-fullscreen-wrap";
  wrap.innerHTML = `
    <!-- Street View fills entire screen -->
    <div id="ggStreetView" class="gg-pano-container"></div>

    <!-- Top HUD -->
    <div class="gg-hud-top" id="ggHudTop">
      <button class="gg-hud-back-btn" onclick="ggExitToStart()">✕</button>
      <span class="gg-hud-pill">${roundLabel}</span>
      <span class="gg-hud-pill gg-hud-score" id="ggHudScore">${scoreLabel}</span>
    </div>

    <!-- Map corner (bottom-right) -->
    <div class="gg-map-corner" id="ggMapCorner">
      <div class="gg-map-corner-header">
        <span id="ggGuessInfo" class="gg-map-guess-info">Klik op de kaart om te gokken</span>
        <button class="gg-map-expand-btn" id="ggExpandBtn" title="Vergroot kaart">⤢</button>
      </div>
      <div class="gg-map-inner">
        <div id="ggLeafletMap" class="gg-leaflet-map"></div>
        <div class="gg-layer-toggle" id="ggLayerToggle">
          <button data-layer="street" class="active">Kaart</button>
          <button data-layer="satellite">Satelliet</button>
        </div>
      </div>
      <div class="gg-map-footer">
        <button class="btn primary gg-submit-btn" id="ggSubmitBtn" disabled>📍 Bevestig gok</button>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);

  gg.onSubmitHandler = onSubmit;
  document.getElementById("ggSubmitBtn").onclick = () => gg.onSubmitHandler();

  // Expand toggle
  document.getElementById("ggExpandBtn").addEventListener("click", () => {
    const corner = document.getElementById("ggMapCorner");
    corner.classList.toggle("expanded");
    document.getElementById("ggExpandBtn").textContent = corner.classList.contains("expanded") ? "⤡" : "⤢";
  });
}

async function initPanorama(round) {
  const maps = await loadGoogleMaps();
  const el = document.getElementById("ggStreetView");
  if (!el) return;
  gg.panorama = createPanorama(maps, el, round);
}

function initMap() {
  const container = document.getElementById("ggLeafletMap");
  if (!container) return;
  const map = L.map(container, {
    center: [20, 10],
    zoom: 2,
    minZoom: 1,
    worldCopyJump: true,
    zoomControl: false,
  });
  gg.map = map;

  L.control.zoom({ position: "bottomleft" }).addTo(map);

  const streetLayer = L.tileLayer(
    "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    { attribution: "© OpenStreetMap", maxZoom: 19 },
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
    const info = document.getElementById("ggGuessInfo");
    if (info) info.textContent = "Gok geplaatst ✓";
    const btn = document.getElementById("ggSubmitBtn");
    if (btn) btn.removeAttribute("disabled");
  });

  renderMarkers();
  setTimeout(() => map.invalidateSize(), 50);
}

function renderMarkers() {
  if (!gg.markersLayer) return;
  gg.markersLayer.clearLayers();
  if (gg.guess) {
    L.circleMarker([gg.guess[1], gg.guess[0]], {
      radius: 8,
      color: "#fff",
      weight: 2,
      fillColor: "#7c5cff",
      fillOpacity: 1,
    }).addTo(gg.markersLayer);
  }
  if (gg.mode === "solo" && gg.submitted && gg.current) {
    L.circleMarker([gg.current.lat, gg.current.lng], {
      radius: 8,
      color: "#fff",
      weight: 2,
      fillColor: "#2ecc71",
      fillOpacity: 1,
    }).addTo(gg.markersLayer);
    if (gg.guess) {
      L.polyline(
        [
          [gg.guess[1], gg.guess[0]],
          [gg.current.lat, gg.current.lng],
        ],
        { color: "#fff", weight: 2, dashArray: "5 4", opacity: 0.9 },
      ).addTo(gg.markersLayer);
    }
  }
}

function showRoundResult(km, pts, nextFn) {
  const submitBtn = document.getElementById("ggSubmitBtn");
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = `${Math.round(km).toLocaleString()} km — ${pts} pts`;
  }
  const info = document.getElementById("ggGuessInfo");
  if (info) {
    info.innerHTML = `📏 ${Math.round(km).toLocaleString()} km · <strong>${pts} pts</strong>`;
  }
  // Add next-round button in map footer
  const footer = document.querySelector(".gg-map-footer");
  if (footer) {
    const btn = document.createElement("button");
    btn.className = "btn primary gg-submit-btn";
    btn.style.marginTop = "6px";
    btn.textContent = gg.round < gg.rounds ? "Volgende ronde →" : "Bekijk eindscore";
    btn.onclick = nextFn;
    footer.appendChild(btn);
  }
}
