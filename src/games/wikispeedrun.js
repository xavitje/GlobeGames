import { topbar, icon } from "../core.js";
import { hasMultiplayerConfig, GameRoom, randomRoomCode, randomPlayerId } from "../lib/multiplayer.js";

let app;
let ws = null; // WikiSpeedrun state

// --- API Helpers ---

async function fetchWikiRandom() {
  const url = `https://nl.wikipedia.org/w/api.php?action=query&list=random&rnnamespace=0&rnlimit=1&format=json&origin=*`;
  const res = await fetch(url);
  const data = await res.json();
  return data.query.random[0].title;
}

async function fetchWikiSearch(query) {
  if (!query) return [];
  const url = `https://nl.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(query)}&limit=5&namespace=0&format=json&origin=*`;
  const res = await fetch(url);
  const data = await res.json();
  return data[1]; // Array of titles
}

async function fetchWikiPage(title) {
  const url = `https://nl.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(title)}&prop=text&format=json&origin=*`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.error) throw new Error(data.error.info);
  return { title: data.parse.title, html: data.parse.text["*"] };
}

// --- Autocomplete Logic ---

function attachWikiAutocomplete(inputId) {
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
    dropdown.innerHTML = "";
    dropdown.style.display = "none";
    
    const val = input.value.trim();
    if (val.length < 2) {
      if (ws.isHost) syncSettings(); // sync typed text
      return;
    }
    
    timeout = setTimeout(async () => {
      try {
        const matches = await fetchWikiSearch(val);
        if (matches.length > 0) {
          dropdown.innerHTML = matches.map(m => `<div class="gg-autocomplete-item">${m}</div>`).join("");
          dropdown.style.display = "block";
          
          dropdown.querySelectorAll(".gg-autocomplete-item").forEach(item => {
            item.addEventListener("mousedown", (e) => {
              e.preventDefault();
              input.value = item.textContent;
              dropdown.style.display = "none";
              if (ws.isHost) syncSettings();
            });
          });
        }
      } catch (e) {
        console.error("Autocomplete fetch error", e);
      }
    }, 300);
  });
  
  input.addEventListener("blur", () => {
    setTimeout(() => { if (dropdown) dropdown.style.display = "none"; }, 150);
  });
}

// --- Lobby Logic ---

export function renderWikiSpeedrun(container) {
  app = container;
  
  if (ws && ws.room) ws.room.leave();
  if (ws && ws.cleanupCheat) ws.cleanupCheat();
  
  ws = {
    room: null,
    roomId: getLobbyFromUrl(),
    playerId: randomPlayerId(),
    name: localStorage.getItem("gg_player_name") || "",
    isHost: false,
    startPage: "",
    endPage: "",
    players: [],
    gameState: "menu", // menu, lobby, playing, finished
    clicks: 0,
    startTime: null,
    endTime: null,
    history: []
  };

  if (ws.roomId) {
    joinLobby(ws.roomId);
  } else {
    showMenu();
  }
}

function setLobbyInUrl(code) {
  history.replaceState(null, "", `${code ? `/wikispeedrun?lobby=${code.toUpperCase()}` : "/wikispeedrun"}`);
}
function clearLobbyFromUrl() { history.replaceState(null, "", "/wikispeedrun"); }
function getLobbyFromUrl() {
  return new URLSearchParams(location.search).get("lobby") || null;
}

function showMenu() {
  clearLobbyFromUrl();
  ws.gameState = "menu";
  app.innerHTML = `
    ${topbar()}
    <div class="gg-menu">
      <div style="text-align:center; margin-bottom: 24px;">
        <h2>📖 Wikipedia Speedrun</h2>
        <p>Race van het ene artikel naar het andere met zo min mogelijk clicks!</p>
      </div>
      
      <div style="display:flex; flex-direction:column; gap:16px; max-width:300px; margin:0 auto;">
        <input type="text" id="wsPlayerName" class="gg-input" placeholder="Je naam" value="${ws.name}">
        <button class="btn" onclick="wsCreateLobby()">Maak Multiplayer Lobby</button>
        <div style="display:flex; gap:8px;">
          <input type="text" id="wsLobbyCode" class="gg-input" placeholder="Lobby Code" style="flex:1; text-transform:uppercase;">
          <button class="btn" onclick="wsJoinLobbyBtn()">Doe mee</button>
        </div>
      </div>
    </div>
  `;
}

window.wsCreateLobby = function() {
  const name = document.getElementById("wsPlayerName").value.trim() || "Speler";
  localStorage.setItem("gg_player_name", name);
  ws.name = name;
  ws.isHost = true;
  ws.roomId = randomRoomCode();
  joinLobby(ws.roomId);
};

window.wsJoinLobbyBtn = function() {
  const name = document.getElementById("wsPlayerName").value.trim() || "Speler";
  const code = document.getElementById("wsLobbyCode").value.trim().toUpperCase();
  if (!code) return;
  localStorage.setItem("gg_player_name", name);
  ws.name = name;
  joinLobby(code);
};

function joinLobby(code) {
  if (!hasMultiplayerConfig()) {
    alert("Supabase multiplayer is niet geconfigureerd.");
    return showMenu();
  }
  
  ws.gameState = "lobby";
  setLobbyInUrl(code);
  ws.room = new GameRoom("wiki_" + code, ws.playerId, { name: ws.name });
  
  app.innerHTML = `
    ${topbar()}
    <div class="gg-lobby">
      <h2>Lobby: ${code}</h2>
      <div style="display:flex; gap:20px; flex-wrap:wrap; margin-top:20px;">
        <div style="flex:1; min-width:300px;" class="gg-card">
          <h3>Spelers</h3>
          <ul id="wsPlayerList" style="list-style:none; padding:0; margin-top:10px;"></ul>
        </div>
        <div style="flex:1; min-width:300px;" class="gg-card">
          <h3>Instellingen</h3>
          ${ws.isHost ? `
            <div style="margin-top:10px;">
              <label style="display:block; margin-bottom:5px; font-weight:bold;">Start Artikel</label>
              <div style="display:flex; gap:5px; position:relative;">
                <input type="text" id="wsStartPage" class="gg-input" style="flex:1;" placeholder="Zoek of vul in..." autocomplete="off">
                <button class="btn" onclick="wsSetRandom('wsStartPage')" title="Random Artikel" style="padding:0 12px; font-size:20px;">🎲</button>
              </div>
              
              <label style="display:block; margin-top:15px; margin-bottom:5px; font-weight:bold;">Eind Artikel</label>
              <div style="display:flex; gap:5px; position:relative;">
                <input type="text" id="wsEndPage" class="gg-input" style="flex:1;" placeholder="Zoek of vul in..." autocomplete="off">
                <button class="btn" onclick="wsSetRandom('wsEndPage')" title="Random Artikel" style="padding:0 12px; font-size:20px;">🎲</button>
              </div>
              
              <button class="btn" onclick="wsStartGame()" style="width:100%; margin-top:20px; font-size:18px;">Start Spel</button>
            </div>
          ` : `
            <p>Wachten tot de host het spel start...</p>
            <p id="wsHostSettingsView" style="margin-top:10px; font-size:18px;">Start: <strong>...</strong><br><br>Eind: <strong>...</strong></p>
          `}
        </div>
      </div>
    </div>
  `;

  if (ws.isHost) {
    attachWikiAutocomplete("wsStartPage");
    attachWikiAutocomplete("wsEndPage");
  }

  ws.room.on("update", (players) => {
    ws.players = players;
    renderPlayerList();
  });
  
  ws.room.on("settings", (s) => {
    ws.startPage = s.startPage;
    ws.endPage = s.endPage;
    if (!ws.isHost) {
      const view = document.getElementById("wsHostSettingsView");
      if (view) view.innerHTML = `Start: <strong>${s.startPage || "..."}</strong><br><br>Eind: <strong>${s.endPage || "..."}</strong>`;
    }
  });

  ws.room.on("start", (payload) => {
    ws.startPage = payload.startPage;
    ws.endPage = payload.endPage;
    startRun();
  });
  
  ws.room.on("progress", (msg) => renderScoreboard(msg, "progress"));
  ws.room.on("finish", (msg) => renderScoreboard(msg, "finish"));
}

function syncSettings() {
  ws.startPage = document.getElementById("wsStartPage")?.value || "";
  ws.endPage = document.getElementById("wsEndPage")?.value || "";
  ws.room.send("settings", { startPage: ws.startPage, endPage: ws.endPage });
}

window.wsSetRandom = async function(inputId) {
  const input = document.getElementById(inputId);
  if (!input) return;
  input.value = "Zoeken...";
  input.disabled = true;
  try {
    const title = await fetchWikiRandom();
    input.value = title;
    if (ws.isHost) syncSettings();
  } catch(e) {
    input.value = "";
    alert("Fout bij ophalen random artikel.");
  }
  input.disabled = false;
};

window.wsStartGame = function() {
  if (!ws.startPage || !ws.endPage) return alert("Kies een start- en eindartikel!");
  ws.room.send("start", { startPage: ws.startPage, endPage: ws.endPage });
};

function renderPlayerList() {
  const list = document.getElementById("wsPlayerList");
  if (!list) return;
  list.innerHTML = ws.players.map(p => `
    <li style="padding:10px; background:rgba(0,0,0,0.2); margin-bottom:5px; border-radius:4px; display:flex; justify-content:space-between; align-items:center;">
      <span>${p.name} ${p.playerId === ws.playerId ? "(Jij)" : ""}</span>
    </li>
  `).join("");
}

// --- Game Loop ---

async function startRun() {
  ws.gameState = "playing";
  ws.clicks = 0;
  ws.history = [ws.startPage];
  ws.startTime = Date.now();
  ws.endTime = null;
  
  app.innerHTML = `
    <div id="wsHeader" style="position:fixed; top:0; left:0; right:0; height:60px; background:#222; color:white; display:flex; justify-content:space-between; align-items:center; padding:0 20px; z-index:9999; box-shadow:0 2px 10px rgba(0,0,0,0.5);">
      <div style="font-size:14px; flex:1;">
        <div>Doel: <strong>${ws.endPage}</strong></div>
        <div style="color:#aaa;">Vanaf: ${ws.startPage}</div>
      </div>
      <div style="font-size:24px; font-weight:bold; font-family:monospace; flex:1; text-align:center;" id="wsTimer">00:00</div>
      <div style="font-size:18px; flex:1; text-align:right;">Clicks: <strong id="wsClicks">0</strong></div>
    </div>
    
    <!-- Sidebar for multiplayer progress -->
    <div id="wsSidebar" style="position:fixed; top:60px; right:0; width:250px; bottom:0; background:#333; color:white; overflow-y:auto; padding:15px; z-index:9998; border-left:1px solid #444;">
      <h3 style="margin-top:0; font-size:16px;">Spelers</h3>
      <div id="wsPlayerProgress"></div>
    </div>

    <!-- Wiki content container -->
    <div id="wsWikiContainer" style="margin-top:60px; margin-right:250px; padding:20px; background:white; color:black; min-height:calc(100vh - 60px);">
      <h2 style="text-align:center; margin-top:50px;">Artikel laden...</h2>
    </div>
  `;
  
  // Timer loop
  const timerEl = document.getElementById("wsTimer");
  const timerInt = setInterval(() => {
    if (ws.endTime || ws.gameState !== "playing") return clearInterval(timerInt);
    const ms = Date.now() - ws.startTime;
    const m = String(Math.floor(ms / 60000)).padStart(2, "0");
    const s = String(Math.floor((ms % 60000) / 1000)).padStart(2, "0");
    if(timerEl) timerEl.textContent = `${m}:${s}`;
  }, 1000);
  
  // Anti-cheat (Ctrl+F)
  const antiCheat = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      alert("Zoeken (Ctrl+F) is geblokkeerd tijdens Speedruns!");
    }
  };
  window.addEventListener("keydown", antiCheat);
  ws.cleanupCheat = () => window.removeEventListener("keydown", antiCheat);

  renderScoreboard();
  await loadArticle(ws.startPage);
}

window.wsHandleLinkClick = function(e, targetTitle) {
  e.preventDefault();
  if (ws.endTime) return; // already finished
  
  ws.clicks++;
  document.getElementById("wsClicks").textContent = ws.clicks;
  ws.history.push(targetTitle);
  loadArticle(targetTitle);
};

async function loadArticle(title) {
  const container = document.getElementById("wsWikiContainer");
  if (!container) return;
  
  container.innerHTML = `<h2 style="text-align:center; margin-top:50px;">Laden van <em>${title}</em>...</h2>`;
  window.scrollTo(0, 0);
  
  try {
    const page = await fetchWikiPage(title);
    
    // Stuur progressie naar lobby
    ws.room.send("progress", { clicks: ws.clicks, current: page.title });
    
    // Check if won
    if (page.title.toLowerCase() === ws.endPage.toLowerCase()) {
      winGame(page.title);
      return;
    }
    
    // Render HTML directly. We wrap it so we can style it via CSS to look like Wikipedia.
    container.innerHTML = `
      <div class="wiki-content">
        <h1 class="wiki-title">${page.title}</h1>
        <div class="wiki-body">${page.html}</div>
      </div>
    `;
    
    // Clean up wikipedia specific stuff that breaks UI or allows cheating
    container.querySelectorAll(".navbox, .reflist, .infobox, .reference, .mw-editsection, .noprint, #toc").forEach(el => el.remove());
    
    // Hijack internal links
    container.querySelectorAll("a").forEach(a => {
      const href = a.getAttribute("href");
      if (href && href.startsWith("/wiki/") && !href.includes(":")) {
        const targetTitle = decodeURIComponent(href.replace("/wiki/", "")).replace(/_/g, " ").split("#")[0];
        a.href = "#";
        a.onclick = (e) => wsHandleLinkClick(e, targetTitle);
      } else {
        // External links or special namespaces (File:, Category:) are disabled
        a.style.color = "inherit";
        a.style.textDecoration = "none";
        a.style.pointerEvents = "none";
        a.onclick = (e) => e.preventDefault();
      }
    });
    
  } catch(e) {
    container.innerHTML = `<div style="color:red; text-align:center; margin-top:50px;">
      <h2>Fout bij laden van artikel: ${title}</h2>
      <button class="btn" onclick="wsHandleLinkClick(event, '${ws.history[ws.history.length-2]}')">Terug</button>
    </div>`;
  }
}

function winGame(finalTitle) {
  ws.endTime = Date.now();
  if (ws.cleanupCheat) ws.cleanupCheat();
  
  const timeMs = ws.endTime - ws.startTime;
  ws.room.send("finish", { clicks: ws.clicks, time: timeMs });
  
  const container = document.getElementById("wsWikiContainer");
  if (container) {
    container.innerHTML = `
      <div style="text-align:center; padding:50px; background:white; color:black; border-radius:10px; margin:50px auto; max-width:600px; box-shadow:0 4px 20px rgba(0,0,0,0.1);">
        <h1 style="color:#2ecc71; font-size:48px; margin-bottom:10px;">🏁 Gehaald!</h1>
        <p style="font-size:20px;">Je hebt <strong>${ws.endPage}</strong> bereikt in <strong>${ws.clicks}</strong> clicks!</p>
        <p style="font-size:18px; color:#666;">Tijd: ${(timeMs / 1000).toFixed(1)} seconden</p>
        <button class="btn" onclick="renderWikiSpeedrun(document.getElementById('app'))" style="margin-top:30px; font-size:20px; padding:10px 30px;">Terug naar Lobby</button>
      </div>
    `;
  }
}

function renderScoreboard(msgPayload, type) {
  const board = document.getElementById("wsPlayerProgress");
  if (!board) return;
  
  if (msgPayload && msgPayload.playerId) {
    const p = ws.players.find(x => x.playerId === msgPayload.playerId);
    if (p) {
      if (type === "finish") {
        p.finished = true;
        p.finalClicks = msgPayload.clicks;
        p.finalTime = msgPayload.time;
        p.progress = `Klaar! (${msgPayload.clicks} clicks)`;
      } else if (type === "progress") {
        p.progress = `${msgPayload.current} (${msgPayload.clicks} clicks)`;
      }
    }
  }

  // Sort by finish (finished first, then clicks, then time)
  const sorted = [...ws.players].sort((a,b) => {
    if (a.finished && !b.finished) return -1;
    if (!a.finished && b.finished) return 1;
    if (a.finished && b.finished) {
      if (a.finalClicks !== b.finalClicks) return a.finalClicks - b.finalClicks;
      return a.finalTime - b.finalTime;
    }
    return 0;
  });

  board.innerHTML = sorted.map(p => {
    let color = p.finished ? "#2ecc71" : "#fff";
    return `
      <div style="background:rgba(0,0,0,0.3); padding:10px; margin-bottom:10px; border-radius:5px; border-left:4px solid ${color};">
        <strong style="display:block; margin-bottom:4px;">${p.name}</strong>
        <div style="font-size:12px; color:#bbb; line-height:1.4;">
          ${p.progress || 'Startpagina...'}
        </div>
      </div>
    `;
  }).join("");
}
