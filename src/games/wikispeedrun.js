import { topbar, icon } from "../core.js";
import { hasMultiplayerConfig, GameRoom, randomRoomCode, randomPlayerId } from "../lib/multiplayer.js";
import { getProfile, saveProfile } from "../lib/profile.js";

let app;
let ws = null; // WikiSpeedrun state
let syncTimer = null;

// ---------- Wikipedia API ----------

// Wikipedia's "willekeurig artikel" pikt uit ALLE artikelen — en een groot
// deel daarvan zijn kale, bot-gegenereerde stubs (een dorpje van 3000
// inwoners, een jaartal-lijstje) met bijna geen uitgaande links, waardoor de
// speedrun onspeelbaar wordt. We vragen daarom een handvol willekeurige
// artikelen tegelijk op en kiezen degene met de meeste tekst (in bytes) —
// een grover maar prima werkende indicatie dat een artikel genoeg inhoud en
// links heeft om mee te racen.
async function fetchWikiRandom() {
  const url = `https://nl.wikipedia.org/w/api.php?action=query&list=random&rnnamespace=0&rnlimit=10&format=json&origin=*`;
  const res = await fetch(url);
  const data = await res.json();
  const titles = (data.query?.random || []).map((r) => r.title);
  if (!titles.length) throw new Error("Geen willekeurig artikel gevonden");
  if (titles.length === 1) return titles[0];

  try {
    const infoUrl = `https://nl.wikipedia.org/w/api.php?action=query&prop=info&titles=${encodeURIComponent(titles.join("|"))}&format=json&origin=*`;
    const infoRes = await fetch(infoUrl);
    const infoData = await infoRes.json();
    const pages = Object.values(infoData.query?.pages || {});
    pages.sort((a, b) => (b.length || 0) - (a.length || 0));
    return (pages[0] && pages[0].title) || titles[0];
  } catch (e) {
    return titles[0];
  }
}

async function fetchWikiSearch(query) {
  if (!query) return [];
  const url = `https://nl.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(query)}&limit=6&namespace=0&format=json&origin=*`;
  const res = await fetch(url);
  const data = await res.json();
  return data[1] || [];
}

async function fetchWikiPage(title) {
  const url = `https://nl.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(title)}&redirects=1&prop=text&format=json&origin=*`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.error) throw new Error(data.error.info);
  return { title: data.parse.title, html: data.parse.text["*"] };
}

// Korte inleiding (alleen de eerste alinea's) van een artikel — gebruikt voor
// de hover-info bij het doelartikel én voor de hover-previews op elke blauwe
// link in het artikel (net als Wikipedia's eigen "paginavoorbeelden").
async function fetchWikiIntro(title) {
  const url = `https://nl.wikipedia.org/w/api.php?action=query&prop=extracts&exintro=1&explaintext=1&redirects=1&titles=${encodeURIComponent(title)}&format=json&origin=*`;
  const res = await fetch(url);
  const data = await res.json();
  const page = Object.values(data.query?.pages || {})[0];
  if (!page || page.missing !== undefined) throw new Error("Artikel niet gevonden");
  return (page.extract || "").trim();
}

async function fetchWikiPreviewInfo(title) {
  if (!title) return null;
  try {
    const url = `https://nl.wikipedia.org/w/api.php?action=query&prop=extracts|pageimages&exintro=1&explaintext=1&piprop=thumbnail&pithumbsize=300&redirects=1&titles=${encodeURIComponent(title)}&format=json&origin=*`;
    const res = await fetch(url);
    const data = await res.json();
    const page = Object.values(data.query?.pages || {})[0];
    if (!page || page.missing !== undefined) return null;
    return {
      extract: (page.extract || "").trim(),
      thumbnail: page.thumbnail?.source || null
    };
  } catch (e) {
    return null;
  }
}

// ---------- Hover-preview op elke interne link ----------
// Gecachet per titel zodat je bij het opnieuw hoveren over dezelfde link (of
// een link naar een artikel dat al eens is opgezocht) niet steeds opnieuw
// hoeft te wachten op de Wikipedia-API.
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
  el.innerHTML = `<div class="ws-link-preview-title">${title}</div><div class="ws-link-preview-body">Laden...</div>`;
  el.classList.add("ws-visible");
  positionLinkPreview(el, a.getBoundingClientRect());

  let text = wsIntroCache.get(title);
  if (text === undefined) {
    try {
      text = await fetchWikiIntro(title);
    } catch (e) {
      text = null;
    }
    wsIntroCache.set(title, text);
  }
  if (myToken !== wsPreviewToken) return; // muis is inmiddels ergens anders

  const body = el.querySelector(".ws-link-preview-body");
  if (body) body.textContent = text ? truncateIntro(text, 420) : "Geen samenvatting beschikbaar.";
  positionLinkPreview(el, a.getBoundingClientRect());
}

function hideLinkPreview() {
  wsPreviewToken++; // annuleert een eventuele lopende fetch
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

// ---------- Klein toastje (herbruikt dezelfde stijl als de cheat-toast) ----------

function wsToast(text) {
  document.getElementById("wsToast")?.remove();
  const el = document.createElement("div");
  el.id = "wsToast";
  el.className = "gg-cheat-toast";
  el.textContent = text;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2400);
}

// ---------- Autocomplete ----------
// `onChange` vuurt bij ELKE geldige invoer (niet alleen bij het kiezen uit de
// lijst) — dat was de kern van een bug waarbij een getypte titel die nooit uit
// de dropdown werd aangeklikt onzichtbaar bleef voor de host-sync en de
// start-knop.
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
        const matches = await fetchWikiSearch(val);
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

// ---------- URL-routing ----------
// Zelfde patroon als GeoGuesser: "/wikispeedrun" is het menu, en
// "/wikispeedrun/<CODE>" joint direct een lobby als je een gedeelde link
// opent — een echte, deelbare/ververbare URL i.p.v. de oude "?lobby="-query.
function setUrlPath(path) {
  history.replaceState(null, "", path);
}
function setLobbyInUrl(code) {
  setUrlPath(code ? `/wikispeedrun/${code.toUpperCase()}` : "/wikispeedrun");
}
function clearLobbyFromUrl() { setUrlPath("/wikispeedrun"); }

// ---------- Opruimen ----------
// Zonder dit blijft, als je tijdens een run wegnavigeert (bv. via de "Alle
// spellen"-knop of de browser-terugknop), de Ctrl+F-blokkade voor altijd
// actief op de rest van de site, blijft de klok-interval doortikken en blijft
// de multiplayer-verbinding openstaan.
function teardown() {
  if (ws?.room) { try { ws.room.leave(); } catch (e) {} }
  if (ws?.cleanupCheat) ws.cleanupCheat();
  if (ws?.timerInt) clearInterval(ws.timerInt);
  clearTimeout(syncTimer);
  clearTimeout(wsPreviewTimer);
  document.getElementById("wsLinkPreview")?.remove();
  window.removeEventListener("popstate", handleExternalNavigate);
}
function handleExternalNavigate() {
  if (!location.pathname.startsWith("/wikispeedrun")) teardown();
}

// ---------- Entry point ----------

export function renderWikiSpeedrun(container, routeSegments = []) {
  app = container;
  teardown();

  const [code] = routeSegments;
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
    startTime: null,
    endTime: null,
    history: [],
    timerInt: null,
    cleanupCheat: null,
  };
  window.addEventListener("popstate", handleExternalNavigate);

  if (code) joinByCode(code.toUpperCase());
  else showMenu();
}

// ---------- Menu ----------

function showMenu() {
  clearLobbyFromUrl();
  ws.gameState = "menu";
  const mpAvailable = hasMultiplayerConfig();
  app.innerHTML = `
    ${topbar()}
    <div class="gametitle"><div><h2>${icon("bookOpen", { size: "sm" })} WikiSpeedrun</h2><div class="desc">Race van het startartikel naar het eindartikel, enkel via links.</div></div></div>
    <div class="card" style="cursor:pointer;" onclick="wsShowSoloSetup()">
      ${icon("flag", { size: "lg" })}
      <h3>Solo spelen</h3>
      <p>Kies of loot een start- en eindartikel en race in je eentje tegen de klok.</p>
    </div>
    <div class="card" style="cursor:${mpAvailable ? "pointer" : "default"}; opacity:${mpAvailable ? "1" : "0.55"}; margin-top:12px;" ${mpAvailable ? 'onclick="wsShowMultiplayerMenu()"' : ""}>
      ${icon("users", { size: "lg" })}
      <h3>Multiplayer</h3>
      <p>${mpAvailable ? "Race tegelijk met vrienden in dezelfde lobby." : "Multiplayer is niet geconfigureerd."}</p>
    </div>`;
}
window.wsShowMenu = showMenu;

// ---------- Solo ----------

window.wsShowSoloSetup = function () {
  ws.gameState = "soloSetup";
  app.innerHTML = `
    ${topbar()}
    <div class="gametitle"><div><h2>${icon("flag", { size: "sm" })} Solo instellen</h2><div class="desc">Kies een start- en eindartikel.</div></div></div>
    <div class="card" style="cursor:default; overflow:visible;">
      ${articleFieldHtml("wsStartPage", "Start artikel", ws.startPage)}
      ${articleFieldHtml("wsEndPage", "Eind artikel", ws.endPage)}
      <div id="wsSoloError" class="small" style="color:var(--danger); margin-top:10px; display:none;"></div>
    </div>
    <div class="footerrow">
      <button class="btn" onclick="wsShowMenu()">${icon("chevronLeft", { size: "sm" })} Terug</button>
      <button class="btn primary" onclick="wsStartSolo()">Start ${icon("chevronRight", { size: "sm" })}</button>
    </div>`;
  attachWikiAutocomplete("wsStartPage", (v) => { ws.startPage = v; updateSetupPreview("wsStartPage", v); });
  attachWikiAutocomplete("wsEndPage", (v) => { ws.endPage = v; updateSetupPreview("wsEndPage", v); });
  updateSetupPreview("wsStartPage", ws.startPage);
  updateSetupPreview("wsEndPage", ws.endPage);
};

window.wsStartSolo = function () {
  const start = (document.getElementById("wsStartPage")?.value || "").trim();
  const end = (document.getElementById("wsEndPage")?.value || "").trim();
  const errEl = document.getElementById("wsSoloError");
  const showError = (msg) => { if (errEl) { errEl.textContent = msg; errEl.style.display = "block"; } };
  if (!start || !end) return showError("Kies eerst een start- en eindartikel.");
  if (start.toLowerCase() === end.toLowerCase()) return showError("Start- en eindartikel moeten verschillend zijn.");

  ws.startPage = start;
  ws.endPage = end;
  ws.isHost = false;
  ws.room = null;
  startRun();
};

// Gedeeld tussen de solo-instellingen en de host-instellingen in de lobby.
function articleFieldHtml(id, label, value) {
  return `
    <label class="gg-label" ${id === "wsEndPage" ? 'style="margin-top:16px;"' : ""}>${label}</label>
    <div style="display:flex; gap:8px; position:relative;">
      <input id="${id}" type="text" autocomplete="off" placeholder="Zoek of typ een titel..." value="${value || ""}"
        style="flex:1; padding:10px 12px; border-radius:10px; border:1px solid var(--border); background:var(--panel2); color:inherit; font-size:14px;" />
      <button class="btn" onclick="wsSetRandom('${id}')" title="Willekeurig artikel">${icon("shuffle", { size: "sm" })} Willekeurig</button>
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
  previewEl.innerHTML = `<div style="padding:10px; color:var(--sub); font-size:13px;">Laden...</div>`;
  const info = await fetchWikiPreviewInfo(title);
  if (!info) {
    previewEl.innerHTML = `<div style="padding:10px; color:var(--sub); font-size:13px;">Geen info gevonden.</div>`;
    return;
  }
  previewEl.innerHTML = `
    ${info.thumbnail ? `<img src="${info.thumbnail}" alt="${title}" />` : ""}
    <div class="ws-setup-preview-text">
      <strong>${title}</strong>
      <p>${truncateIntro(info.extract, 150) || "Geen samenvatting."}</p>
    </div>
  `;
}

window.wsSetRandom = async function (inputId) {
  const input = document.getElementById(inputId);
  if (!input) return;
  const prev = input.value;
  input.disabled = true;
  input.value = "Zoeken...";
  try {
    const title = await fetchWikiRandom();
    input.value = title;
    if (inputId === "wsStartPage") ws.startPage = title; else ws.endPage = title;
    updateSetupPreview(inputId, title);
    if (ws.isHost) scheduleSync();
  } catch (e) {
    input.value = prev;
    wsToast("Kon geen willekeurig artikel ophalen.");
  }
  input.disabled = false;
};

// ---------- Multiplayer: menu ----------

window.wsShowMultiplayerMenu = function () {
  if (!hasMultiplayerConfig()) return showMenu();
  ws.gameState = "mpMenu";
  app.innerHTML = `
    ${topbar()}
    <div class="gametitle"><div><h2>${icon("users", { size: "sm" })} WikiSpeedrun multiplayer</h2><div class="desc">Race tegelijk met vrienden.</div></div></div>
    <div class="card" style="cursor:pointer;" onclick="wsShowHostSetup()">
      ${icon("plus", { size: "lg" })}
      <h3>Lobby hosten</h3>
      <p>Maak een lobby aan en kies straks samen het start- en eindartikel.</p>
    </div>
    <div class="card" style="cursor:pointer; margin-top:12px;" onclick="wsShowJoinSetup()">
      ${icon("key", { size: "lg" })}
      <h3>Lobby joinen</h3>
      <p>Heb je een code van een vriend gekregen? Vul 'm hier in.</p>
    </div>
    <div class="footerrow">
      <button class="btn" onclick="wsShowMenu()">${icon("chevronLeft", { size: "sm" })} Terug</button><div></div>
    </div>`;
};

function nameFieldHtml() {
  return `
    <label class="gg-label">Jouw naam</label>
    <input id="wsNameInput" type="text" placeholder="Typ je naam..." maxlength="18" value="${ws.name || ""}"
      style="width:100%; padding:10px 12px; border-radius:10px; border:1px solid var(--border); background:var(--panel2); color:inherit; font-size:14px;" />`;
}

window.wsShowHostSetup = function () {
  app.innerHTML = `
    ${topbar()}
    <div class="gametitle"><div><h2>${icon("plus", { size: "sm" })} Lobby hosten</h2><div class="desc">Kies je naam en maak de lobby aan.</div></div></div>
    <div class="card" style="cursor:default;">${nameFieldHtml()}</div>
    <div class="footerrow">
      <button class="btn" onclick="wsShowMultiplayerMenu()">${icon("chevronLeft", { size: "sm" })} Terug</button>
      <button class="btn primary" onclick="wsHostLobby()">Kamer aanmaken ${icon("chevronRight", { size: "sm" })}</button>
    </div>`;
};

window.wsHostLobby = function () {
  const name = (document.getElementById("wsNameInput")?.value || "").trim() || "Speler";
  saveProfile({ ...getProfile(), name });
  ws.name = name;
  ws.isHost = true;
  enterLobby(randomRoomCode());
};

window.wsShowJoinSetup = function () {
  app.innerHTML = `
    ${topbar()}
    <div class="gametitle"><div><h2>${icon("key", { size: "sm" })} Lobby joinen</h2><div class="desc">Vul je naam en de lobby-code in.</div></div></div>
    <div class="card" style="cursor:default;">
      ${nameFieldHtml()}
      <label class="gg-label" style="margin-top:16px;">Lobby-code</label>
      <input id="wsCodeInput" type="text" placeholder="bv. LFFW" maxlength="6"
        style="width:100%; padding:10px 12px; border-radius:10px; border:1px solid var(--border); background:var(--panel2); color:inherit; font-size:14px; text-transform:uppercase;" />
    </div>
    <div class="footerrow">
      <button class="btn" onclick="wsShowMultiplayerMenu()">${icon("chevronLeft", { size: "sm" })} Terug</button>
      <button class="btn primary" onclick="wsSubmitJoin()">Join ${icon("chevronRight", { size: "sm" })}</button>
    </div>`;
};

window.wsSubmitJoin = function () {
  const name = (document.getElementById("wsNameInput")?.value || "").trim() || "Speler";
  const code = (document.getElementById("wsCodeInput")?.value || "").trim().toUpperCase();
  if (!code) return wsToast("Vul een lobby-code in.");
  saveProfile({ ...getProfile(), name });
  ws.name = name;
  ws.isHost = false;
  enterLobby(code);
};

// Binnenkomst via een gedeelde link ("/wikispeedrun/CODE"): eerst naam vragen,
// net als GeoGuesser's auto-join-scherm.
function joinByCode(code) {
  ws.gameState = "autoJoin";
  app.innerHTML = `
    ${topbar()}
    <div class="gametitle"><div><h2>${icon("users", { size: "sm" })} Lobby joinen</h2><div class="desc">Je bent uitgenodigd voor lobby <strong>${code}</strong>.</div></div></div>
    <div class="card" style="cursor:default;">${nameFieldHtml()}</div>
    <div class="footerrow">
      <button class="btn" onclick="wsShowMenu()">${icon("chevronLeft", { size: "sm" })} Terug</button>
      <button class="btn primary" onclick="wsAutoJoin('${code}')">Joinen ${icon("chevronRight", { size: "sm" })}</button>
    </div>`;
}
window.wsAutoJoin = function (code) {
  const name = (document.getElementById("wsNameInput")?.value || "").trim() || "Speler";
  saveProfile({ ...getProfile(), name });
  ws.name = name;
  ws.isHost = false;
  enterLobby(code);
};

// ---------- Lobby ----------

async function enterLobby(code) {
  code = code.toUpperCase();
  app.innerHTML = `
    ${topbar()}
    <div class="gametitle"><div><h2>${icon("users", { size: "sm" })} Lobby ${code}</h2><div class="desc">Verbinden...</div></div></div>`;

  // Belangrijkste fix in dit bestand: de room werd voorheen nooit echt
  // verbonden (geen connect()-aanroep), en de naam werd als een object
  // i.p.v. een string doorgegeven — daardoor deed multiplayer hier
  // helemaal niets.
  ws.room = new GameRoom("wiki_" + code, ws.playerId, ws.name);
  try {
    await ws.room.connect();
  } catch (e) {
    app.innerHTML = `
      ${topbar()}
      <div class="card" style="cursor:default; text-align:center;">
        ${icon("warning", { size: "xl" })}
        <h3>Kon niet verbinden</h3>
        <p>${e.message || "Onbekende fout."}</p>
        <button class="btn primary" onclick="wsShowMultiplayerMenu()" style="margin-top:10px;">Terug</button>
      </div>`;
    return;
  }

  ws.gameState = "lobby";
  setLobbyInUrl(code);

  // Spelerslijst kwam voorheen via `room.on("update", ...)` binnen, maar
  // GameRoom stuurt presence-updates via `onPresence`, niet via `on()` —
  // die listener vuurde dus nooit.
  ws.room.onPresence((players) => { ws.players = players; renderPlayerList(); });
  ws.room.on("settings", (s) => {
    ws.startPage = s.startPage;
    ws.endPage = s.endPage;
    if (!ws.isHost) updateGuestRouteView();
  });
  ws.room.on("start", (payload) => {
    ws.startPage = payload.startPage;
    ws.endPage = payload.endPage;
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
    ws.room.send("settings", { startPage: ws.startPage, endPage: ws.endPage });
  }, 250);
}

function drawLobby() {
  const shareUrl = `${location.origin}/wikispeedrun/${ws.room.code}`;
  app.innerHTML = `
    ${topbar()}
    <div class="gametitle"><div><h2>${icon("users", { size: "sm" })} Lobby ${ws.room.code}</h2><div class="desc">${ws.isHost ? "Deel de link met je vrienden." : "Wachten tot de host het spel start..."}</div></div></div>
    <div class="card" style="cursor:default; text-align:center;">
      <div class="small">Lobby-code</div>
      <h3 style="font-size:32px; letter-spacing:6px; margin:6px 0;">${ws.room.code}</h3>
      <div class="gg-share-row">
        <input class="gg-share-input" id="wsShareUrl" value="${shareUrl}" readonly />
        <button class="btn" onclick="wsCopyLink()">${icon("clipboard", { size: "sm" })} Kopieer</button>
      </div>
    </div>
    <div class="card" style="cursor:default; margin-top:12px; overflow:visible;">
      <h3 style="margin-bottom:10px;">${icon("flag", { size: "sm" })} Route</h3>
      ${ws.isHost
        ? `${articleFieldHtml("wsStartPage", "Start artikel", ws.startPage)}${articleFieldHtml("wsEndPage", "Eind artikel", ws.endPage)}`
        : `<p id="wsGuestRoute" class="small">Start: <strong>${ws.startPage || "..."}</strong><br>Eind: <strong>${ws.endPage || "..."}</strong></p>`}
    </div>
    <div class="guesslist" style="margin-top:14px;" id="wsPlayerList"></div>
    <div class="footerrow">
      <button class="btn" onclick="wsLeaveLobby()">${icon("chevronLeft", { size: "sm" })} Lobby verlaten</button>
      ${ws.isHost ? `<button class="btn primary" onclick="wsStartGame()">Start spel ${icon("chevronRight", { size: "sm" })}</button>` : "<div></div>"}
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
  if (el) el.innerHTML = `Start: <strong>${ws.startPage || "..."}</strong><br>Eind: <strong>${ws.endPage || "..."}</strong>`;
}

window.wsCopyLink = function () {
  const input = document.getElementById("wsShareUrl");
  if (!input) return;
  navigator.clipboard.writeText(input.value).catch(() => { input.select(); document.execCommand("copy"); });
  const btn = input.nextElementSibling;
  if (btn) {
    btn.innerHTML = `${icon("check", { size: "sm" })} Gekopieerd!`;
    setTimeout(() => { btn.innerHTML = `${icon("clipboard", { size: "sm" })} Kopieer`; }, 2000);
  }
};

window.wsLeaveLobby = function () {
  teardown();
  ws.room = null;
  showMenu();
};

window.wsStartGame = function () {
  // Rechtstreeks uit de velden lezen i.p.v. te vertrouwen op ws.startPage/
  // endPage: die werden voorheen alleen bijgewerkt als je iets uit de
  // dropdown koos, dus een getypte-maar-niet-aangeklikte titel werd hier
  // altijd als "leeg" gezien.
  const start = (document.getElementById("wsStartPage")?.value || ws.startPage || "").trim();
  const end = (document.getElementById("wsEndPage")?.value || ws.endPage || "").trim();
  if (!start || !end) return wsToast("Kies eerst een start- en eindartikel.");
  if (start.toLowerCase() === end.toLowerCase()) return wsToast("Start en eind moeten verschillend zijn.");
  ws.startPage = start;
  ws.endPage = end;
  ws.room.send("start", { startPage: start, endPage: end });
};

function renderPlayerList() {
  const list = document.getElementById("wsPlayerList");
  if (!list) return;
  list.innerHTML = ws.players.map((p) => `
    <div class="gitem">
      <div class="name">${icon("user", { size: "sm" })} ${p.name || "Speler"}${p.playerId === ws.playerId ? " (jij)" : ""}</div>
      <div></div><div></div><div></div>
    </div>`).join("");
}

// ---------- Race ----------

async function startRun() {
  ws.gameState = "playing";
  ws.clicks = 0;
  ws.history = [ws.startPage];
  ws.visited = [];
  ws.goalIntro = null;
  ws.goalIntroError = false;
  ws.startTime = Date.now();
  ws.endTime = null;

  app.innerHTML = `
    <div class="ws-run-header" id="wsHeader">
      <div class="ws-run-info">
        <div class="ws-info-wrap">
          Doel: <strong>${ws.endPage}</strong>
          <span class="ws-info-icon" id="wsGoalInfoIcon" tabindex="0" title="Bekijk doel">${icon("info", { size: "sm" })}</span>
          <div class="ws-info-popover">
            <div class="ws-info-popover-title">${ws.endPage}</div>
            <div id="wsGoalInfoBody">Laden...</div>
          </div>
        </div>
        <div class="small">Vanaf: ${ws.startPage}</div>
      </div>
      <div class="ws-run-timer" id="wsTimer">00:00</div>
      <div class="ws-run-clicks">Clicks: <strong id="wsClicks">0</strong></div>
    </div>
    <div class="ws-trail-bar" id="wsTrailBar"></div>
    ${ws.room ? `
    <div class="ws-sidebar" id="wsSidebar">
      <h3>${icon("users", { size: "sm" })} Spelers</h3>
      <div id="wsPlayerProgress"></div>
    </div>` : ""}
    <div class="ws-wiki-wrap ${ws.room ? "ws-with-sidebar" : ""}" id="wsWikiContainer">
      <h2 style="text-align:center; margin-top:50px;">Artikel laden...</h2>
    </div>
    <div class="ws-drawer" id="wsGoalDrawer">
      <div class="ws-drawer-close" id="wsGoalDrawerClose">${icon("close")}</div>
      <h3>Doel: ${ws.endPage}</h3>
      <div id="wsGoalDrawerBody">Laden...</div>
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
      wsToast("Zoeken (Ctrl+F) is geblokkeerd tijdens de Speedrun!");
    }
  };
  window.addEventListener("keydown", antiCheat);
  ws.cleanupCheat = () => window.removeEventListener("keydown", antiCheat);

  if (ws.room) renderScoreboard();
  await loadArticle(ws.startPage);
}

// Haalt alleen de inleidende alinea('s) van het doelartikel op voor de
// hover-info — los van loadArticle() zodat dit niet de eigenlijke race
// vertraagt en gewoon op de achtergrond kan bijladen.
async function loadGoalIntro() {
  let htmlDrawer = "Geen samenvatting beschikbaar.";
  let htmlPopover = "Geen samenvatting beschikbaar.";
  try {
    const info = await fetchWikiPreviewInfo(ws.endPage);
    if (info) {
      htmlDrawer = `
        ${info.thumbnail ? `<img src="${info.thumbnail}" alt="${ws.endPage}" />` : ""}
        <p>${info.extract || "Geen samenvatting."}</p>
      `;
      htmlPopover = truncateIntro(info.extract, 420) || "Geen samenvatting.";
    }
  } catch (e) {
    htmlDrawer = "Kon geen samenvatting laden.";
    htmlPopover = "Kon geen samenvatting laden.";
  }
  
  const elDrawer = document.getElementById("wsGoalDrawerBody");
  if (elDrawer) elDrawer.innerHTML = htmlDrawer;

  const elPopover = document.getElementById("wsGoalInfoBody");
  if (elPopover) elPopover.textContent = htmlPopover;
}

// Balkje met de route die je tot nu toe hebt afgelegd (de links die je hebt
// gebruikt), zodat je kunt zien waar je vandaan komt tijdens het spelen.
function renderTrail() {
  const bar = document.getElementById("wsTrailBar");
  if (!bar) return;
  bar.innerHTML = ws.visited.map((t, i) => `
    ${i > 0 ? `<span class="ws-trail-sep">${icon("chevronRight", { size: "sm" })}</span>` : ""}
    <span class="ws-trail-item${i === ws.visited.length - 1 ? " ws-trail-current" : ""}">${t}</span>
  `).join("");
  bar.scrollLeft = bar.scrollWidth;
}

// Bouwt zelf een inhoudsopgave op basis van de h2/h3-kopjes in het artikel
// (Wikipedia's parse-API levert die niet meer kant-en-klaar mee), en zet 'm
// vóór de eerste sectiekop — precies waar Wikipedia 'm zelf ook toont.
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
  tocEl.innerHTML = `<div class="toctitle">Inhoud</div><ul>${sections.map(renderItem).join("")}</ul>`;
  headings[0].insertAdjacentElement("beforebegin", tocEl);
}

window.wsHandleLinkClick = function (e, targetTitle) {
  e.preventDefault();
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

  container.innerHTML = `<h2 style="text-align:center; margin-top:50px;">Laden van <em>${title}</em>...</h2>`;
  window.scrollTo(0, 0);

  try {
    const page = await fetchWikiPage(title);

    if (ws.visited[ws.visited.length - 1] !== page.title) ws.visited.push(page.title);
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

    // Alleen de navigatieboxen onderaan (die vaak enorm zijn) en de nutteloze
    // "[bewerken]"-linkjes weghalen. Infobox, inhoudsopgave en de
    // bronnenlijst blijven nu gewoon staan — die hoorden juist bij een echte
    // Wikipedia-pagina en werden hiervoor per ongeluk verwijderd.
    container.querySelectorAll(".navbox, .mw-editsection").forEach((el) => el.remove());

    // Wikipedia's "parse"-API levert bij de moderne skin geen kant-en-klare
    // inhoudsopgave meer mee in de HTML (die wordt tegenwoordig door
    // Wikipedia's eigen frontend-JS opgebouwd, niet in de statische parse-
    // output) — dus bouwen we er zelf een op basis van de kopjes.
    buildTableOfContents(container.querySelector(".wiki-body"));

    // Interne links kapen zodat een klik een nieuwe ronde in het spel start i.p.v. een echte navigatie.
    container.querySelectorAll("a").forEach((a) => {
      const href = a.getAttribute("href");
      if (href && href.startsWith("/wiki/") && !href.includes(":")) {
        const targetTitle = decodeURIComponent(href.replace("/wiki/", "")).replace(/_/g, " ").split("#")[0];
        a.href = "#";
        a.onclick = (e) => wsHandleLinkClick(e, targetTitle);
        attachLinkPreview(a, targetTitle);
      } else if (href && href.startsWith("#")) {
        // Anker binnen dezelfde pagina (inhoudsopgave, voetnoot-terugverwijzing)
        // — laat gewoon native scrollen, telt niet als klik in de race.
      } else if (href) {
        // Externe links en speciale namespaces (Bestand:, Categorie:) mogen
        // best werken — een bronvermelding aanklikken helpt je toch niet
        // richting het doelartikel — maar dan wel in een nieuw tabblad, zodat
        // je lopende run niet verloren gaat. Relatieve Wikipedia-paden (zoals
        // "/wiki/Bestand:...") wijzen anders naar ons eigen domein i.p.v.
        // wikipedia.org, dus die maken we eerst absoluut.
        a.href = href.startsWith("/") ? `https://nl.wikipedia.org${href}` : href;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
      }
    });
  } catch (e) {
    const prevTitle = ws.history.length > 1 ? ws.history[ws.history.length - 2] : null;
    container.innerHTML = `
      <div style="text-align:center; margin-top:50px;">
        <h2 style="color:var(--danger);">Fout bij laden van artikel: ${title}</h2>
        ${prevTitle ? `<button class="btn" onclick="wsHandleLinkClick(event, '${prevTitle}')">${icon("chevronLeft", { size: "sm" })} Terug</button>` : ""}
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
        <h1>Gehaald!</h1>
        <p>Je hebt <strong>${ws.endPage}</strong> bereikt in <strong>${ws.clicks}</strong> clicks!</p>
        <p class="small">Tijd: ${(timeMs / 1000).toFixed(1)} seconden</p>
        <button class="btn primary" onclick="wsBackToMenu()">${icon("chevronLeft", { size: "sm" })} Terug naar menu</button>
      </div>`;
  }
}

window.wsBackToMenu = function () {
  setUrlPath("/wikispeedrun");
  renderWikiSpeedrun(app);
};

function renderScoreboard(msgPayload, type) {
  const board = document.getElementById("wsPlayerProgress");
  if (!board) return;

  // GameRoom.send() stempelt de afzender als `from`, niet als `playerId` —
  // hierdoor werd hier voorheen nooit een speler gevonden en bleef het
  // scorebord altijd leeg.
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
      <strong>${p.name || "Speler"}</strong>
      <div class="small">${p.finished ? `Klaar! (${p.finalClicks} clicks)` : (p.progress ? `${p.progress} (${p.progressClicks} clicks)` : "Startpagina...")}</div>
    </div>`).join("");
}
