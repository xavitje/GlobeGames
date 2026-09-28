import { icon } from "../core.js";
import { topbar } from "../lib/layout.js";
import { hasMultiplayerConfig, GameRoom, randomRoomCode, randomPlayerId } from "../lib/multiplayer.js";
import { getProfile, saveProfile } from "../lib/profile.js";
import { getLanguage, pick } from "../lib/i18n.js";
import { escapeHtml } from "../lib/html.js";
import { fetchWikiIntro, fetchWikiPage, fetchWikiPreviewInfo, fetchWikiRandom, fetchWikiSearch, resolveWikiTitle } from "./wikispeedrun/wiki-api.js";
import { ActionController } from "../lib/actions.js";
import { parseWikiRoute, wikiArticlePath, wikiLobbyPath } from "./wikispeedrun/routes.js";

let app;
let ws = null;
let syncTimer = null;
let actionController = null;

const wsIntroCache = new Map();
let wsPreviewTimer = null;
let wsPreviewToken = 0;

function ensureLinkPreviewEl() {
  let el = document.getElementById("wsLinkPreview");
  if (!el) {
    el = document.createElement("div");
    el.id = "wsLinkPreview";
    el.className = "ws-link-preview";
    document.body.appendChild(el);
  }
  return el;
}

function positionLinkPreview(el, anchorRect) {
  const width = el.offsetWidth || 320;
  const height = el.offsetHeight || 140;
  let left = anchorRect.left;
  let top = anchorRect.bottom + 8;
  if (left + width > window.innerWidth - 12) left = window.innerWidth - width - 12;
  if (top + height > window.innerHeight - 12) top = anchorRect.top - height - 8;
  el.style.left = `${Math.max(12, left)}px`;
  el.style.top = `${Math.max(12, top)}px`;
}

function truncateIntro(text, max) {
  if (text.length <= max) return text;
  return text.slice(0, max).replace(/\s+\S*$/, "") + "…";
}

async function showLinkPreview(a, title) {
  const myToken = ++wsPreviewToken;
  const el = ensureLinkPreviewEl();
  el.innerHTML = `<div class="ws-link-preview-title">${escapeHtml(title)}</div><div class="ws-link-preview-body">${pick("Loading…", "Laden…")}</div>`;
  el.classList.add("ws-visible");
  positionLinkPreview(el, a.getBoundingClientRect());

  let text = wsIntroCache.get(title);
  if (text === undefined) {
    try {
      text = await fetchWikiIntro(ws.lang, title);
    } catch (e) {
      text = null;
    }
    wsIntroCache.set(title, text);
  }
  if (myToken !== wsPreviewToken) return;

  const body = el.querySelector(".ws-link-preview-body");
  if (body) body.textContent = text ? truncateIntro(text, 420) : pick("No summary available.", "Geen samenvatting beschikbaar.");
  positionLinkPreview(el, a.getBoundingClientRect());
}

function hideLinkPreview() {
  clearTimeout(wsPreviewTimer);
  wsPreviewToken++;
  document.getElementById("wsLinkPreview")?.classList.remove("ws-visible");
}

function attachLinkPreview(a, title) {
  a.addEventListener("mouseenter", () => {
    clearTimeout(wsPreviewTimer);
    wsPreviewTimer = setTimeout(() => showLinkPreview(a, title), 250);
  });
  a.addEventListener("mouseleave", () => {
    clearTimeout(wsPreviewTimer);
    hideLinkPreview();
  });
}

function wsToast(text) {
  document.getElementById("wsToast")?.remove();
  const el = document.createElement("div");
  el.id = "wsToast";
  el.className = "gg-cheat-toast";
  el.textContent = text;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2400);
}

// Keep typed values in sync even when no autocomplete option is selected.
function attachWikiAutocomplete(inputId, onChange) {
  const input = document.getElementById(inputId);
  if (!input) return;

  let dropdown = document.getElementById(inputId + "Dropdown");
  if (!dropdown) {
    dropdown = document.createElement("div");
    dropdown.id = inputId + "Dropdown";
    dropdown.className = "gg-autocomplete-dropdown";
    input.parentNode.appendChild(dropdown);
  }

  let timeout;
  input.addEventListener("input", () => {
    clearTimeout(timeout);
    onChange(input.value.trim());

    const val = input.value.trim();
    if (val.length < 2) {
      dropdown.style.display = "none";
      dropdown.innerHTML = "";
      return;
    }

    timeout = setTimeout(async () => {
      try {
        const matches = await fetchWikiSearch(ws.lang, val);
        if (!matches.length) {
          dropdown.style.display = "none";
          return;
        }
        dropdown.innerHTML = matches.map((m) => `<div class="gg-autocomplete-item">${m}</div>`).join("");
        dropdown.style.display = "block";
        dropdown.querySelectorAll(".gg-autocomplete-item").forEach((item) => {
          item.addEventListener("mousedown", (e) => {
            e.preventDefault();
            input.value = item.textContent;
            dropdown.style.display = "none";
            onChange(input.value);
          });
        });
      } catch (e) {
        console.error("Autocomplete fetch error", e);
      }
    }, 300);
  });

  input.addEventListener("blur", () => {
    setTimeout(() => { dropdown.style.display = "none"; }, 150);
  });
}

// Keep lobby and in-game article routes unambiguous.
function setUrlPath(path) {
  history.replaceState(null, "", path);
}
function setLobbyInUrl(code) {
  setUrlPath(code ? wikiLobbyPath(code) : "/wikispeedrun");
}
function clearLobbyFromUrl() { setUrlPath("/wikispeedrun"); }

// Release global race controls and the room when navigating away.
function teardown() {
  if (ws?.room) { try { ws.room.leave(); } catch (e) {} }
  if (ws?.cleanupCheat) ws.cleanupCheat();
  if (ws?.timerInt) clearInterval(ws.timerInt);
  clearTimeout(syncTimer);
  clearTimeout(wsPreviewTimer);
  document.getElementById("wsLinkPreview")?.remove();
  window.removeEventListener("popstate", handleExternalNavigate);
}

export function cleanupWikiSpeedrun() {
  teardown();
  actionController?.destroy();
  actionController = null;
}
function handleExternalNavigate() {
  if (!location.pathname.startsWith("/wikispeedrun")) teardown();
}


export function renderWikiSpeedrun(container, routeSegments = []) {
  actionController?.destroy();
  app = container;
  teardown();
  actionController = new ActionController(app, WIKI_ACTIONS);

  const route = parseWikiRoute(routeSegments);
  ws = {
    room: null,
    playerId: randomPlayerId(),
    name: getProfile().name || "",
    isHost: false,
    startPage: "",
    endPage: "",
    players: [],
    gameState: "menu",
    clicks: 0,
    lang: getLanguage(),
    startTime: null,
    endTime: null,
    history: [],
    timerInt: null,
    cleanupCheat: null,
  };
  window.addEventListener("popstate", handleExternalNavigate);

  if (route.type === "lobby") joinByCode(route.code);
  else showMenu();
}


function showMenu() {
  clearLobbyFromUrl();
  ws.gameState = "menu";
  const mpAvailable = hasMultiplayerConfig();
  app.innerHTML = `
    ${topbar()}
    <div class="gametitle"><div><h2>${icon("bookOpen", { size: "sm" })} WikiSpeedrun</h2><div class="desc">${pick("Race from the start article to the target using links only.", "Race van het startartikel naar het eindartikel, enkel via links.")}</div></div></div>
    <div class="game-mode-grid">
    <button type="button" class="card game-mode-card" data-action="show-solo-setup">
      ${icon("flag", { size: "lg" })}
      <h3>${pick("Play solo", "Solo spelen")}</h3>
      <p>${pick("Choose or draw two articles and race against the clock.", "Kies of loot een start- en eindartikel en race in je eentje tegen de klok.")}</p>
    </button>
    <button type="button" class="card game-mode-card" ${mpAvailable ? 'data-action="show-multiplayer-menu"' : "disabled"}>
      ${icon("users", { size: "lg" })}
      <h3>Multiplayer</h3>
      <p>${mpAvailable ? pick("Race your friends in the same lobby.", "Race tegelijk met vrienden in dezelfde lobby.") : pick("Multiplayer is not configured yet.", "Multiplayer is nog niet ingesteld.")}</p>
    </button></div>`;
}
const wsShowMenu = showMenu;


const wsShowSoloSetup = function () {
  ws.gameState = "soloSetup";
  app.innerHTML = `
    ${topbar()}
    <div class="gametitle"><div><h2>${icon("flag", { size: "sm" })} ${pick("Solo setup", "Solo instellen")}</h2><div class="desc">${pick("Choose a start and target article.", "Kies een start- en eindartikel.")}</div></div></div>
    <div class="card" style="cursor:default; overflow:visible;">
      <label class="gg-label">${pick("Wikipedia language", "Wikipedia-taal")}</label>
      <select id="wsLangSelect" data-change-action="set-language" style="width:100%; padding:10px 12px; border-radius:10px; border:1px solid var(--border); background:var(--panel2); color:inherit; font-size:14px; margin-bottom:16px;">
        <option value="en" ${ws.lang === "en" ? "selected" : ""}>English</option>
        <option value="nl" ${ws.lang === "nl" ? "selected" : ""}>Nederlands</option>
      </select>
      ${articleFieldHtml("wsStartPage", pick("Start article", "Startartikel"), ws.startPage)}
      ${articleFieldHtml("wsEndPage", pick("Target article", "Eindartikel"), ws.endPage)}
      <div id="wsSoloError" class="small" style="color:var(--danger); margin-top:10px; display:none;"></div>
    </div>
    <div class="footerrow">
      <button class="btn" data-action="show-menu">${icon("chevronLeft", { size: "sm" })} ${pick("Back", "Terug")}</button>
      <button class="btn primary" data-action="start-solo">Start ${icon("chevronRight", { size: "sm" })}</button>
    </div>`;
  attachWikiAutocomplete("wsStartPage", (v) => { ws.startPage = v; updateSetupPreview("wsStartPage", v); });
  attachWikiAutocomplete("wsEndPage", (v) => { ws.endPage = v; updateSetupPreview("wsEndPage", v); });
  updateSetupPreview("wsStartPage", ws.startPage);
  updateSetupPreview("wsEndPage", ws.endPage);
};

const wsSetLang = function(lang) {
  ws.lang = lang;
  const sInput = document.getElementById("wsStartPage");
  const eInput = document.getElementById("wsEndPage");
  if (sInput) sInput.value = "";
  if (eInput) eInput.value = "";
  ws.startPage = "";
  ws.endPage = "";
  updateSetupPreview("wsStartPage", "");
  updateSetupPreview("wsEndPage", "");
  if (ws.isHost) scheduleSync();
};

const wsStartSolo = async function () {
  const start = (document.getElementById("wsStartPage")?.value || "").trim();
  const end = (document.getElementById("wsEndPage")?.value || "").trim();
  const errEl = document.getElementById("wsSoloError");
  const showError = (msg) => { if (errEl) { errEl.textContent = msg; errEl.style.display = "block"; } };
  if (!start || !end) return showError(pick("Choose both a start and target article.", "Kies eerst een start- en eindartikel."));
  if (start.toLowerCase() === end.toLowerCase()) return showError(pick("Start and target article must be different.", "Start- en eindartikel moeten verschillend zijn."));

  ws.startPage = await resolveWikiTitle(ws.lang, start);
  ws.endPage = await resolveWikiTitle(ws.lang, end);
  ws.isHost = false;
  ws.room = null;
  startRun();
};

// Render the shared start and target article controls.
function articleFieldHtml(id, label, value) {
  return `
    <label class="gg-label" ${id === "wsEndPage" ? 'style="margin-top:16px;"' : ""}>${label}</label>
    <div style="display:flex; gap:8px; position:relative;">
      <input id="${id}" type="text" autocomplete="off" placeholder="${pick("Search or enter a title…", "Zoek of typ een titel…")}" value="${value || ""}"
        style="flex:1; padding:10px 12px; border-radius:10px; border:1px solid var(--border); background:var(--panel2); color:inherit; font-size:14px;" />
      <button class="btn" data-action="set-random" data-input-id="${escapeHtml(id)}" title="${pick("Random article", "Willekeurig artikel")}">${icon("shuffle", { size: "sm" })} ${pick("Random", "Willekeurig")}</button>
    </div>
    <div id="${id}Preview" class="ws-setup-preview" style="display:none;"></div>`;
}

async function updateSetupPreview(id, title) {
  const previewEl = document.getElementById(id + "Preview");
  if (!previewEl) return;
  if (!title || title.trim().length < 2) {
    previewEl.innerHTML = "";
    previewEl.style.display = "none";
    return;
  }
  previewEl.style.display = "flex";
  previewEl.innerHTML = `<div style="padding:10px; color:var(--sub); font-size:13px;">${pick("Loading…", "Laden…")}</div>`;
  const info = await fetchWikiPreviewInfo(ws.lang, title);
  if (!info) {
    previewEl.innerHTML = `<div style="padding:10px; color:var(--sub); font-size:13px;">${pick("No information found.", "Geen info gevonden.")}</div>`;
    return;
  }
  previewEl.innerHTML = `
    ${info.thumbnail ? `<img src="${info.thumbnail}" alt="${title}" />` : ""}
    <div class="ws-setup-preview-text">
      <strong>${title}</strong>
      <p>${truncateIntro(info.extract, 150) || pick("No summary.", "Geen samenvatting.")}</p>
    </div>
  `;
}

const wsSetRandom = async function (inputId) {
  const input = document.getElementById(inputId);
  if (!input) return;
  const prev = input.value;
  input.disabled = true;
  input.value = pick("Searching…", "Zoeken…");
  try {
    const title = await fetchWikiRandom(ws.lang);
    input.value = title;
    if (inputId === "wsStartPage") ws.startPage = title; else ws.endPage = title;
    updateSetupPreview(inputId, title);
    if (ws.isHost) scheduleSync();
  } catch (e) {
    input.value = prev;
    wsToast(pick("Could not load a random article.", "Kon geen willekeurig artikel ophalen."));
  }
  input.disabled = false;
};


const wsShowMultiplayerMenu = function () {
  if (!hasMultiplayerConfig()) return showMenu();
  ws.gameState = "mpMenu";
  app.innerHTML = `
    ${topbar()}
    <div class="gametitle"><div><h2>${icon("users", { size: "sm" })} WikiSpeedrun multiplayer</h2><div class="desc">${pick("Race your friends in real time.", "Race tegelijk met vrienden.")}</div></div></div>
    <div class="game-mode-grid"><button type="button" class="card game-mode-card" data-action="show-host-setup">
      ${icon("plus", { size: "lg" })}
      <h3>${pick("Host a lobby", "Lobby hosten")}</h3>
      <p>${pick("Create a lobby and choose the start and target together.", "Maak een lobby aan en kies straks samen het start- en eindartikel.")}</p>
    </button>
    <button type="button" class="card game-mode-card" data-action="show-join-setup">
      ${icon("key", { size: "lg" })}
      <h3>${pick("Join a lobby", "Lobby joinen")}</h3>
      <p>${pick("Enter the code you received from a friend.", "Vul hier de code in die je van een vriend kreeg.")}</p>
    </button></div>
    <div class="footerrow">
      <button class="btn" data-action="show-menu">${icon("chevronLeft", { size: "sm" })} ${pick("Back", "Terug")}</button><div></div>
    </div>`;
};

function nameFieldHtml() {
  return `
    <label class="gg-label">${pick("Your name", "Jouw naam")}</label>
    <input id="wsNameInput" type="text" placeholder="${pick("Enter your name…", "Typ je naam…")}" maxlength="18" value="${escapeHtml(ws.name || "")}"
      style="width:100%; padding:10px 12px; border-radius:10px; border:1px solid var(--border); background:var(--panel2); color:inherit; font-size:14px;" />`;
}

const wsShowHostSetup = function () {
  app.innerHTML = `
    ${topbar()}
    <div class="gametitle"><div><h2>${icon("plus", { size: "sm" })} ${pick("Host a lobby", "Lobby hosten")}</h2><div class="desc">${pick("Choose your name and create the lobby.", "Kies je naam en maak de lobby aan.")}</div></div></div>
    <div class="card" style="cursor:default;">${nameFieldHtml()}</div>
    <div class="footerrow">
      <button class="btn" data-action="show-multiplayer-menu">${icon("chevronLeft", { size: "sm" })} Terug</button>
      <button class="btn primary" data-action="host-lobby">${pick("Create room", "Kamer aanmaken")} ${icon("chevronRight", { size: "sm" })}</button>
    </div>`;
};

const wsHostLobby = function () {
  const name = (document.getElementById("wsNameInput")?.value || "").trim() || pick("Player", "Speler");
  saveProfile({ ...getProfile(), name });
  ws.name = name;
  ws.isHost = true;
  enterLobby(randomRoomCode());
};

const wsShowJoinSetup = function () {
  app.innerHTML = `
    ${topbar()}
    <div class="gametitle"><div><h2>${icon("key", { size: "sm" })} ${pick("Join a lobby", "Lobby joinen")}</h2><div class="desc">${pick("Enter your name and lobby code.", "Vul je naam en de lobby-code in.")}</div></div></div>
    <div class="card" style="cursor:default;">
      ${nameFieldHtml()}
      <label class="gg-label" style="margin-top:16px;">${pick("Lobby code", "Lobby-code")}</label>
      <input id="wsCodeInput" type="text" placeholder="bv. LFFW" maxlength="6"
        style="width:100%; padding:10px 12px; border-radius:10px; border:1px solid var(--border); background:var(--panel2); color:inherit; font-size:14px; text-transform:uppercase;" />
    </div>
    <div class="footerrow">
      <button class="btn" data-action="show-multiplayer-menu">${icon("chevronLeft", { size: "sm" })} Terug</button>
      <button class="btn primary" data-action="submit-join">${pick("Join", "Meedoen")} ${icon("chevronRight", { size: "sm" })}</button>
    </div>`;
};

const wsSubmitJoin = function () {
  const name = (document.getElementById("wsNameInput")?.value || "").trim() || pick("Player", "Speler");
  const code = (document.getElementById("wsCodeInput")?.value || "").trim().toUpperCase();
  if (!code) return wsToast(pick("Enter a lobby code.", "Vul een lobby-code in."));
  saveProfile({ ...getProfile(), name });
  ws.name = name;
  ws.isHost = false;
  enterLobby(code);
};

// Ask for a name before joining a shared lobby link.
function joinByCode(code) {
  ws.gameState = "autoJoin";
  app.innerHTML = `
    ${topbar()}
    <div class="gametitle"><div><h2>${icon("users", { size: "sm" })} ${pick("Join a lobby", "Lobby joinen")}</h2><div class="desc">${pick("You were invited to lobby", "Je bent uitgenodigd voor lobby")} <strong>${code}</strong>.</div></div></div>
    <div class="card" style="cursor:default;">${nameFieldHtml()}</div>
    <div class="footerrow">
      <button class="btn" data-action="show-menu">${icon("chevronLeft", { size: "sm" })} Terug</button>
      <button class="btn primary" data-action="auto-join" data-code="${escapeHtml(code)}">${pick("Join", "Joinen")} ${icon("chevronRight", { size: "sm" })}</button>
    </div>`;
}
const wsAutoJoin = function (code) {
  const name = (document.getElementById("wsNameInput")?.value || "").trim() || pick("Player", "Speler");
  saveProfile({ ...getProfile(), name });
  ws.name = name;
  ws.isHost = false;
  enterLobby(code);
};


async function enterLobby(code) {
  code = code.toUpperCase();
  ws.lobbyCode = code;
  app.innerHTML = `
    ${topbar()}
    <div class="gametitle"><div><h2>${icon("users", { size: "sm" })} Lobby ${code}</h2><div class="desc">${pick("Connecting…", "Verbinden…")}</div></div></div>`;

  ws.room = new GameRoom("wiki_" + code, ws.playerId, ws.name);
  try {
    await ws.room.connect();
  } catch (e) {
    app.innerHTML = `
      ${topbar()}
      <div class="card" style="cursor:default; text-align:center;">
        ${icon("warning", { size: "xl" })}
        <h3>${pick("Could not connect", "Kon niet verbinden")}</h3>
        <p>${e.message || pick("Unknown error.", "Onbekende fout.")}</p>
        <button class="btn primary" data-action="show-multiplayer-menu" style="margin-top:10px;">${pick("Back", "Terug")}</button>
      </div>`;
    return;
  }

  ws.gameState = "lobby";
  setLobbyInUrl(code);

  ws.room.onPresence((players) => { ws.players = players; renderPlayerList(); });
  ws.room.on("settings", (s) => {
    ws.startPage = s.startPage;
    ws.endPage = s.endPage;
    if (s.lang) ws.lang = s.lang;
    if (!ws.isHost) updateGuestRouteView();
  });
  ws.room.on("start", (payload) => {
    ws.startPage = payload.startPage;
    ws.endPage = payload.endPage;
    if (payload.lang) ws.lang = payload.lang;
    startRun();
  });
  ws.room.on("progress", (msg) => renderScoreboard(msg, "progress"));
  ws.room.on("finish", (msg) => renderScoreboard(msg, "finish"));

  drawLobby();
}

function scheduleSync() {
  if (!ws.isHost || !ws.room) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    ws.room.send("settings", { startPage: ws.startPage, endPage: ws.endPage, lang: ws.lang });
  }, 250);
}

function drawLobby() {
  const shareUrl = `${location.origin}${wikiLobbyPath(ws.lobbyCode || ws.room.code)}`;
  app.innerHTML = `
    ${topbar()}
    <div class="gametitle"><div><h2>${icon("users", { size: "sm" })} Lobby ${ws.room.code}</h2><div class="desc">${ws.isHost ? pick("Share the link with your friends.", "Deel de link met je vrienden.") : pick("Waiting for the host to start…", "Wachten tot de host het spel start…")}</div></div></div>
    <div class="card" style="cursor:default; text-align:center;">
      <div class="small">${pick("Lobby code", "Lobby-code")}</div>
      <h3 style="font-size:32px; letter-spacing:6px; margin:6px 0;">${ws.room.code}</h3>
      <div class="gg-share-row">
        <input class="gg-share-input" id="wsShareUrl" value="${shareUrl}" readonly />
        <button class="btn" data-action="copy-link">${icon("clipboard", { size: "sm" })} ${pick("Copy", "Kopieer")}</button>
      </div>
    </div>
    <div class="card" style="cursor:default; margin-top:12px; overflow:visible;">
      <h3 style="margin-bottom:10px;">${icon("flag", { size: "sm" })} Route</h3>
      ${ws.isHost
        ? `<label class="gg-label">${pick("Language", "Taal")}</label>
           <select id="wsLangSelect" data-change-action="set-language" style="width:100%; padding:10px 12px; border-radius:10px; border:1px solid var(--border); background:var(--panel2); color:inherit; font-size:14px; margin-bottom:16px;">
             <option value="en" ${ws.lang === "en" ? "selected" : ""}>English</option>
             <option value="nl" ${ws.lang === "nl" ? "selected" : ""}>Nederlands</option>
           </select>
           ${articleFieldHtml("wsStartPage", pick("Start article", "Startartikel"), ws.startPage)}${articleFieldHtml("wsEndPage", pick("Target article", "Eindartikel"), ws.endPage)}`
        : `<p id="wsGuestRoute" class="small">${pick("Language", "Taal")}: <strong>${ws.lang === "en" ? "English" : "Nederlands"}</strong><br>${pick("Start", "Start")}: <strong>${ws.startPage || "..."}</strong><br>${pick("Target", "Eind")}: <strong>${ws.endPage || "..."}</strong></p>`}
    </div>
    <div class="guesslist" style="margin-top:14px;" id="wsPlayerList"></div>
    <div class="footerrow">
      <button class="btn" data-action="leave-lobby">${icon("chevronLeft", { size: "sm" })} ${pick("Leave lobby", "Lobby verlaten")}</button>
      ${ws.isHost ? `<button class="btn primary" data-action="start-game">${pick("Start game", "Start spel")} ${icon("chevronRight", { size: "sm" })}</button>` : "<div></div>"}
    </div>`;

  if (ws.isHost) {
    attachWikiAutocomplete("wsStartPage", (v) => { ws.startPage = v; scheduleSync(); updateSetupPreview("wsStartPage", v); });
    attachWikiAutocomplete("wsEndPage", (v) => { ws.endPage = v; scheduleSync(); updateSetupPreview("wsEndPage", v); });
    updateSetupPreview("wsStartPage", ws.startPage);
    updateSetupPreview("wsEndPage", ws.endPage);
  }
  renderPlayerList();
}

function updateGuestRouteView() {
  const el = document.getElementById("wsGuestRoute");
  if (el) el.innerHTML = `${pick("Language", "Taal")}: <strong>${ws.lang === "en" ? "English" : "Nederlands"}</strong><br>${pick("Start", "Start")}: <strong>${ws.startPage || "..."}</strong><br>${pick("Target", "Eind")}: <strong>${ws.endPage || "..."}</strong>`;
}

const wsCopyLink = function () {
  const input = document.getElementById("wsShareUrl");
  if (!input) return;
  navigator.clipboard.writeText(input.value).catch(() => { input.select(); document.execCommand("copy"); });
  const btn = input.nextElementSibling;
  if (btn) {
    btn.innerHTML = `${icon("check", { size: "sm" })} ${pick("Copied!", "Gekopieerd!")}`;
    setTimeout(() => { btn.innerHTML = `${icon("clipboard", { size: "sm" })} ${pick("Copy", "Kopieer")}`; }, 2000);
  }
};

const wsLeaveLobby = function () {
  teardown();
  ws.room = null;
  showMenu();
};

const wsStartGame = async function () {
  // Read the fields directly so typed values are never stale.
  let start = (document.getElementById("wsStartPage")?.value || ws.startPage || "").trim();
  let end = (document.getElementById("wsEndPage")?.value || ws.endPage || "").trim();
  if (!start || !end) return wsToast(pick("Choose a start and target article.", "Kies eerst een start- en eindartikel."));
  if (start.toLowerCase() === end.toLowerCase()) return wsToast(pick("Start and target must be different.", "Start en eind moeten verschillend zijn."));
  
  start = await resolveWikiTitle(ws.lang, start);
  end = await resolveWikiTitle(ws.lang, end);

  ws.startPage = start;
  ws.endPage = end;
  ws.room.send("start", { startPage: start, endPage: end, lang: ws.lang });
};

function renderPlayerList() {
  const list = document.getElementById("wsPlayerList");
  if (!list) return;
  list.innerHTML = ws.players.map((p) => `
    <div class="gitem">
      <div class="name">${icon("user", { size: "sm" })} ${escapeHtml(p.name || pick("Player", "Speler"))}${p.playerId === ws.playerId ? pick(" (you)", " (jij)") : ""}</div>
      <div></div><div></div><div></div>
    </div>`).join("");
}


async function startRun() {
  ws.gameState = "playing";
  ws.clicks = 0;
  ws.history = [ws.startPage];
  ws.visited = [];
  ws.goalIntro = null;
  ws.goalIntroError = false;
  ws.startTime = Date.now();
  ws.endTime = null;

  if (ws.room) {
    ws.players.forEach((p) => {
      p.finished = false;
      p.finalClicks = null;
      p.finalTime = null;
      p.progress = pick("Start page…", "Startpagina…");
      p.progressClicks = 0;
    });
  }

  app.innerHTML = `
    <div class="ws-run-header" id="wsHeader">
      <div class="ws-run-info">
        <div class="ws-info-wrap">
          ${pick("Target", "Doel")}: <strong>${ws.endPage}</strong>
          <span class="ws-info-icon" id="wsGoalInfoIcon" tabindex="0" title="${pick("View target", "Bekijk doel")}">${icon("info", { size: "sm" })}</span>
          <div class="ws-info-popover">
            <div class="ws-info-popover-title">${ws.endPage}</div>
            <div id="wsGoalInfoBody">${pick("Loading…", "Laden…")}</div>
          </div>
        </div>
        <div class="small">${pick("From", "Vanaf")}: ${ws.startPage}</div>
      </div>
      <div class="ws-run-timer" id="wsTimer">00:00</div>
      <div class="ws-run-clicks" style="display:flex; align-items:center; gap:12px;">
        <div>Clicks: <strong id="wsClicks">0</strong></div>
        <button class="btn small" data-action="give-up">${icon("flag", { size: "sm" })} ${pick("Give up", "Geef op")}</button>
      </div>
    </div>
    <div class="ws-trail-bar" id="wsTrailBar"></div>
    ${ws.room ? `
    <div class="ws-sidebar" id="wsSidebar">
      <h3>${icon("users", { size: "sm" })} ${pick("Players", "Spelers")}</h3>
      <div id="wsPlayerProgress"></div>
    </div>` : ""}
    <div class="ws-wiki-wrap ${ws.room ? "ws-with-sidebar" : ""}" id="wsWikiContainer">
      <h2 style="text-align:center; margin-top:50px;">${pick("Loading article…", "Artikel laden…")}</h2>
    </div>
    <div class="ws-drawer" id="wsGoalDrawer">
      <div class="ws-drawer-close" id="wsGoalDrawerClose">${icon("close")}</div>
      <h3>${pick("Target", "Doel")}: ${ws.endPage}</h3>
      <div id="wsGoalDrawerBody">${pick("Loading…", "Laden…")}</div>
    </div>`;

  const infoIcon = document.getElementById("wsGoalInfoIcon");
  const drawer = document.getElementById("wsGoalDrawer");
  const drawerClose = document.getElementById("wsGoalDrawerClose");
  if (infoIcon && drawer) {
    infoIcon.addEventListener("click", () => drawer.classList.add("open"));
  }
  if (drawerClose && drawer) {
    drawerClose.addEventListener("click", () => drawer.classList.remove("open"));
  }
  loadGoalIntro();

  const timerEl = document.getElementById("wsTimer");
  ws.timerInt = setInterval(() => {
    if (ws.endTime || ws.gameState !== "playing") { clearInterval(ws.timerInt); return; }
    const ms = Date.now() - ws.startTime;
    const m = String(Math.floor(ms / 60000)).padStart(2, "0");
    const s = String(Math.floor((ms % 60000) / 1000)).padStart(2, "0");
    if (timerEl) timerEl.textContent = `${m}:${s}`;
  }, 1000);

  const antiCheat = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
      e.preventDefault();
      wsToast(pick("Search (Ctrl+F) is disabled during the Speedrun!", "Zoeken (Ctrl+F) is geblokkeerd tijdens de Speedrun!"));
    }
    if (e.key === "F12") {
      e.preventDefault();
      wsToast(pick("Developer tools are disabled!", "Inspecteren is geblokkeerd!"));
    }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && ["i", "j", "c"].includes(e.key.toLowerCase())) {
      e.preventDefault();
      wsToast(pick("Developer tools are disabled!", "Inspecteren is geblokkeerd!"));
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "u") {
      e.preventDefault();
      wsToast(pick("Viewing source is disabled!", "Broncode bekijken is geblokkeerd!"));
    }
  };
  const antiContextMenu = (e) => {
    e.preventDefault();
    wsToast(pick("Right-click is disabled!", "Rechtermuisknop is geblokkeerd!"));
  };
  let wikiContentNode = null;
  const antiCheatBlur = () => {
    const container = document.getElementById("wsWikiContainer");
    const content = container?.querySelector(".wiki-content");
    if (content) {
      wikiContentNode = content;
      content.remove();
      
      const warning = document.createElement("h2");
      warning.id = "wsCheatWarning";
      warning.style.cssText = "text-align:center; margin-top:50px; color:var(--danger);";
      warning.textContent = pick("Page hidden to prevent cheating 👀. Click here to continue.", "Pagina verborgen om spieken te voorkomen 👀. Klik hier om verder te gaan.");
      container.appendChild(warning);
    }
  };
  const antiCheatFocus = () => {
    const container = document.getElementById("wsWikiContainer");
    const warning = document.getElementById("wsCheatWarning");
    if (warning) warning.remove();
    if (container && wikiContentNode) {
      container.appendChild(wikiContentNode);
      wikiContentNode = null;
    }
  };
  
  window.addEventListener("keydown", antiCheat);
  window.addEventListener("contextmenu", antiContextMenu);
  window.addEventListener("blur", antiCheatBlur);
  window.addEventListener("focus", antiCheatFocus);
  
  ws.cleanupCheat = () => {
    window.removeEventListener("keydown", antiCheat);
    window.removeEventListener("contextmenu", antiContextMenu);
    window.removeEventListener("blur", antiCheatBlur);
    window.removeEventListener("focus", antiCheatFocus);
    antiCheatFocus();
  };

  if (ws.room) renderScoreboard();
  await loadArticle(ws.startPage);
}

// Load the goal preview without blocking the race.
async function loadGoalIntro() {
  let htmlDrawer = pick("No summary available.", "Geen samenvatting beschikbaar.");
  let htmlPopover = pick("No summary available.", "Geen samenvatting beschikbaar.");
  try {
    const info = await fetchWikiPreviewInfo(ws.lang, ws.endPage);
    if (info) {
      htmlDrawer = `
        ${info.thumbnail ? `<img src="${info.thumbnail}" alt="${ws.endPage}" />` : ""}
        <p>${info.extract || pick("No summary.", "Geen samenvatting.")}</p>
      `;
      htmlPopover = truncateIntro(info.extract, 420) || pick("No summary.", "Geen samenvatting.");
    }
  } catch (e) {
    htmlDrawer = pick("Could not load a summary.", "Kon geen samenvatting laden.");
    htmlPopover = pick("Could not load a summary.", "Kon geen samenvatting laden.");
  }
  
  const elDrawer = document.getElementById("wsGoalDrawerBody");
  if (elDrawer) elDrawer.innerHTML = htmlDrawer;

  const elPopover = document.getElementById("wsGoalInfoBody");
  if (elPopover) elPopover.textContent = htmlPopover;
}

// Show the article path followed during the run.
function renderTrail() {
  const bar = document.getElementById("wsTrailBar");
  if (!bar) return;
  bar.innerHTML = ws.visited.map((t, i) => `
    ${i > 0 ? `<span class="ws-trail-sep">${icon("chevronRight", { size: "sm" })}</span>` : ""}
    <span class="ws-trail-item${i === ws.visited.length - 1 ? " ws-trail-current" : ""}">${t}</span>
  `).join("");
  bar.scrollLeft = bar.scrollWidth;
}

// Rebuild the table of contents because the parse API omits its client-rendered one.
function buildTableOfContents(bodyEl) {
  if (!bodyEl || bodyEl.querySelector(".toc, #toc")) return; // al aanwezig, niet dubbel opbouwen
  const headings = Array.from(bodyEl.querySelectorAll("h2, h3"));
  if (headings.length < 2) return; // te kort artikel, net als op Wikipedia zelf

  const sections = [];
  let current = null;
  let h2Count = 0;
  let h3Count = 0;
  let usedIds = new Set();

  const uniqueId = (base) => {
    let id = base || "sectie";
    let n = 2;
    while (usedIds.has(id)) { id = `${base}_${n++}`; }
    usedIds.add(id);
    return id;
  };

  headings.forEach((h) => {
    const text = (h.textContent || "").trim();
    let id = h.id || h.querySelector("span[id]")?.id;
    if (!id || usedIds.has(id)) id = uniqueId((text || "sectie").replace(/\s+/g, "_"));
    else usedIds.add(id);
    h.id = id;

    if (h.tagName === "H2") {
      h2Count++; h3Count = 0;
      current = { id, number: String(h2Count), text, subs: [] };
      sections.push(current);
    } else {
      h3Count++;
      const sub = { id, number: `${h2Count || 1}.${h3Count}`, text };
      if (current) current.subs.push(sub); else sections.push({ ...sub, subs: [] });
    }
  });

  const renderItem = (item) => `
    <li><a href="#${item.id}"><span class="tocnumber">${item.number}</span>${item.text}</a>
      ${item.subs && item.subs.length ? `<ul>${item.subs.map(renderItem).join("")}</ul>` : ""}
    </li>`;

  const tocEl = document.createElement("div");
  tocEl.className = "toc";
  tocEl.innerHTML = `<div class="toctitle">${pick("Contents", "Inhoud")}</div><ul>${sections.map(renderItem).join("")}</ul>`;
  headings[0].insertAdjacentElement("beforebegin", tocEl);
}

const wsHandleLinkClick = function (e, targetTitle) {
  e.preventDefault();
  e.stopPropagation();
  if (ws.endTime) return; // al klaar

  ws.clicks++;
  const clicksEl = document.getElementById("wsClicks");
  if (clicksEl) clicksEl.textContent = ws.clicks;
  ws.history.push(targetTitle);
  hideLinkPreview();
  loadArticle(targetTitle);
};

async function loadArticle(title) {
  const container = document.getElementById("wsWikiContainer");
  if (!container) return;

  container.innerHTML = `<h2 style="text-align:center; margin-top:50px;">${pick("Loading", "Laden van")} <em>${title}</em>…</h2>`;
  window.scrollTo(0, 0);

  try {
    const page = await fetchWikiPage(ws.lang, title);

    if (ws.visited[ws.visited.length - 1] !== page.title) ws.visited.push(page.title);
    setUrlPath(wikiArticlePath(page.title));
    renderTrail();

    if (ws.room) ws.room.send("progress", { clicks: ws.clicks, current: page.title });

    if (page.title.toLowerCase() === ws.endPage.toLowerCase()) {
      winGame(page.title);
      return;
    }

    container.innerHTML = `
      <div class="wiki-content">
        <h1 class="wiki-title">${page.title}</h1>
        <div class="wiki-body">${page.html}</div>
      </div>`;

    // Edit-section links ("[edit]") aren't useful in-game, but the navbox
    // (e.g. the colorful "State of California" box) is part of what makes
    // an article page look right, so it's kept and styled instead of
    // stripped — see the .wiki-body .navbox rules in style.css.
    container.querySelectorAll(".mw-editsection").forEach((el) => el.remove());

    buildTableOfContents(container.querySelector(".wiki-body"));

    // Interne links kapen zodat een klik een nieuwe ronde in het spel start i.p.v. een echte navigatie.
    container.querySelectorAll("a").forEach((a) => {
      const href = a.getAttribute("href");
      let targetTitle = null;

      if (href) {
        if (href.startsWith("/wiki/")) {
          targetTitle = href.replace("/wiki/", "");
        } else {
          const absolutePrefix = `https://${ws.lang || 'nl'}.wikipedia.org/wiki/`;
          if (href.startsWith(absolutePrefix)) {
            targetTitle = href.replace(absolutePrefix, "");
          }
        }
      }

      if (targetTitle && !targetTitle.includes(":")) {
        try {
          targetTitle = decodeURIComponent(targetTitle);
        } catch (e) {
          // Ignore malformed encoded titles.
        }
        targetTitle = targetTitle.replace(/_/g, " ").split("#")[0];
        if (targetTitle) {
          a.href = "#";
          a.onclick = (e) => wsHandleLinkClick(e, targetTitle);
          attachLinkPreview(a, targetTitle);
        }
      } else if (href && href.startsWith("#")) {
        // Same-page anchors scroll normally and do not count as race clicks.
      } else if (href) {
        // Non-article destinations (Portal:/Wikipedia:/Talk: namespaces,
        // sister-project links to Wiktionary/Commons/Wikiquote/etc., real
        // external sites like government or news pages) aren't part of the
        // race. They used to pop open a new tab — disruptive mid-run and not
        // how the original game behaves. They're inert (the click does
        // nothing, the run stays uninterrupted) and rendered as plain text
        // (no link color/underline/pointer cursor) so they don't look like
        // something the player can click through to.
        a.removeAttribute("target");
        a.removeAttribute("href");
        a.classList.add("ws-inert-link");
        a.onclick = (e) => e.preventDefault();
      }
    });
  } catch (e) {
    console.error(e);
    const prevTitle = ws.history.length > 1 ? ws.history[ws.history.length - 2] : null;
    container.innerHTML = `
      <div style="text-align:center; margin-top:50px;">
        <h2 style="color:var(--danger);">${pick("Error loading article", "Fout bij laden van artikel")}: ${title}</h2>
        <p style="color:var(--text-dim); margin-bottom:16px;">${e.message || String(e)}</p>
        ${prevTitle ? `<button class="btn" data-action="article-back" data-title="${escapeHtml(prevTitle)}">${icon("chevronLeft", { size: "sm" })} ${pick("Back", "Terug")}</button>` : ""}
      </div>`;
  }
}

function winGame(finalTitle) {
  ws.endTime = Date.now();
  ws.gameState = "finished";
  if (ws.cleanupCheat) ws.cleanupCheat();

  const timeMs = ws.endTime - ws.startTime;
  if (ws.room) ws.room.send("finish", { clicks: ws.clicks, time: timeMs });

  const container = document.getElementById("wsWikiContainer");
  if (container) {
    container.innerHTML = `
      <div class="ws-finish-card">
        ${icon("flag", { size: "xl" })}
        <h1>${pick("Finished!", "Gehaald!")}</h1>
        <p>${pick("You reached", "Je hebt")} <strong>${ws.endPage}</strong> ${pick("in", "bereikt in")} <strong>${ws.clicks}</strong> clicks!</p>
        <p class="small">${pick("Time", "Tijd")}: ${(timeMs / 1000).toFixed(1)} ${pick("seconds", "seconden")}</p>
        <button class="btn primary" data-action="back-to-menu">${icon("chevronLeft", { size: "sm" })} ${pick("Back to", "Terug naar")} ${ws.room ? 'lobby' : 'menu'}</button>
      </div>`;
  }
}

const wsBackToMenu = function () {
  if (ws.room) {
    ws.gameState = "lobby";
    drawLobby();
  } else {
    setUrlPath("/wikispeedrun");
    renderWikiSpeedrun(app);
  }
};

const wsGiveUp = function () {
  if (!confirm(pick("Are you sure you want to give up?", "Weet je zeker dat je wilt opgeven?"))) return;
  
  ws.endTime = Date.now();
  ws.gameState = "finished";
  if (ws.cleanupCheat) ws.cleanupCheat();

  if (ws.room) ws.room.send("progress", { clicks: ws.clicks, current: pick("Gave up ❌", "Opgegeven ❌") });

  const container = document.getElementById("wsWikiContainer");
  if (container) {
    container.innerHTML = `
      <div class="ws-finish-card">
        ${icon("warning", { size: "xl" })}
        <h1>${pick("Gave up", "Opgegeven")}</h1>
        <p>${pick("You gave up after", "Je hebt de handdoek in de ring gegooid na")} <strong>${ws.clicks}</strong> clicks.</p>
        <button class="btn primary" data-action="back-to-menu">${icon("chevronLeft", { size: "sm" })} ${pick("Back to", "Terug naar")} ${ws.room ? 'lobby' : 'menu'}</button>
      </div>`;
  }
};

function renderScoreboard(msgPayload, type) {
  const board = document.getElementById("wsPlayerProgress");
  if (!board) return;

  // GameRoom identifies message senders through `from`.
  if (msgPayload && msgPayload.from) {
    const p = ws.players.find((x) => x.playerId === msgPayload.from);
    if (p) {
      if (type === "finish") {
        p.finished = true;
        p.finalClicks = msgPayload.clicks;
        p.finalTime = msgPayload.time;
      } else if (type === "progress") {
        p.progress = msgPayload.current;
        p.progressClicks = msgPayload.clicks;
      }
    }
  }

  const sorted = [...ws.players].sort((a, b) => {
    if (a.finished && !b.finished) return -1;
    if (!a.finished && b.finished) return 1;
    if (a.finished && b.finished) {
      if (a.finalClicks !== b.finalClicks) return a.finalClicks - b.finalClicks;
      return a.finalTime - b.finalTime;
    }
    return 0;
  });

  board.innerHTML = sorted.map((p) => `
    <div class="ws-sidebar-player ${p.finished ? "ws-finished" : ""}">
      <strong>${escapeHtml(p.name || pick("Player", "Speler"))}</strong>
      <div class="small">${p.finished ? `${pick("Finished!", "Klaar!")} (${escapeHtml(p.finalClicks)} clicks)` : (p.progress ? `${escapeHtml(p.progress)} (${escapeHtml(p.progressClicks)} clicks)` : pick("Start page…", "Startpagina…"))}</div>
    </div>`).join("");
}

const WIKI_ACTIONS = {
  "show-menu": () => wsShowMenu(),
  "show-solo-setup": () => wsShowSoloSetup(),
  "show-multiplayer-menu": () => wsShowMultiplayerMenu(),
  "set-language": (control) => wsSetLang(control.value),
  "start-solo": () => wsStartSolo(),
  "set-random": (control) => wsSetRandom(control.dataset.inputId),
  "show-host-setup": () => wsShowHostSetup(),
  "show-join-setup": () => wsShowJoinSetup(),
  "host-lobby": () => wsHostLobby(),
  "submit-join": () => wsSubmitJoin(),
  "auto-join": (control) => wsAutoJoin(control.dataset.code),
  "copy-link": () => wsCopyLink(),
  "leave-lobby": () => wsLeaveLobby(),
  "start-game": () => wsStartGame(),
  "give-up": () => wsGiveUp(),
  "article-back": (control, event) => wsHandleLinkClick(event, control.dataset.title),
  "back-to-menu": () => wsBackToMenu(),
};
