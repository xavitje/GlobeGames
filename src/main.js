import "./style.css";
import { icon } from "./core.js";
import { appHeader } from "./lib/layout.js";
import { getLanguage, pick, setLanguage } from "./lib/i18n.js";
import { adSlotHtml, initAdSlots } from "./lib/ads.js";

const app = document.getElementById("app");
let lastPathname = null;
let routeVersion = 0;
let activeCleanup = null;

function getPathSegments() {
  return location.pathname.split("/").filter(Boolean);
}

function hubHtml() {
  return `${appHeader()}
    <main class="atlas-hub">
      <section class="atlas-hub-intro">
        <div>
          <span class="atlas-overline">${pick("EXPLORE WITHOUT LIMITS", "ONTDEK ZONDER GRENZEN")}</span>
          <h1>${pick("Choose your next challenge.", "Kies je volgende uitdaging.")}</h1>
          <p>${pick("Five distinct ways to test your knowledge of the world — solo or together.", "Vijf verschillende manieren om je wereldkennis te testen — alleen of samen.")}</p>
        </div>
        <div class="atlas-hub-stats"><span><small>${pick("Games available", "Beschikbare spellen")}</small><strong>05</strong></span><span><small>${pick("Countries", "Landen")}</small><strong>177</strong></span></div>
      </section>
      <div class="atlas-filter-row"><div><button class="active" type="button" data-game-filter="all">${pick("All", "Alles")}</button><button type="button" data-game-filter="solo">Solo</button><button type="button" data-game-filter="multi">Multiplayer</button></div><span data-game-count>${pick("5 experiences", "5 ervaringen")}</span></div>
      <section class="atlas-games" aria-label="${pick("All games", "Alle spellen")}">
        <a class="atlas-game atlas-game-feature" data-game-modes="solo multi" href="/geoguesser" onclick="event.preventDefault();go('geoguesser')">
          <span class="atlas-feature-copy"><span class="atlas-live"><i></i>LIVE MULTIPLAYER</span><strong>GeoGuesser</strong><small>${pick("Read the road, terrain and atmosphere. Place your pin anywhere on Earth.", "Lees de weg, het terrein en de sfeer. Plaats daarna je pin ergens op aarde.")}</small><span class="atlas-game-meta"><b>${icon("users", { size: "sm" })} 1–8 ${pick("players", "spelers")}</b><b>${icon("clock", { size: "sm" })} 5–20 min</b></span><span class="atlas-start">${pick("Start game", "Start spel")}${icon("chevronRight", { size: "sm" })}</span></span>
          <span class="atlas-geo-scene" aria-hidden="true"><i class="atlas-scene-halo"></i><i class="atlas-scene-orbit one"></i><i class="atlas-scene-orbit two"></i><span class="atlas-sphere"><i class="atlas-land one"></i><i class="atlas-land two"></i><i class="atlas-land three"></i></span><span class="atlas-pin">${icon("pin", { size: "lg" })}</span><i class="atlas-platform"></i></span>
        </a>
        <a class="atlas-game atlas-game-small" data-game-modes="solo" href="/geohunt" onclick="event.preventDefault();go('geohunt')"><span class="atlas-small-head"><b>01</b><em>${pick("LOGIC", "LOGICA")}</em></span><span class="atlas-cubes" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span><span class="atlas-small-copy"><strong>GeoHunt</strong><small>${pick("Solve the country matrix.", "Los de landenmatrix op.")}</small></span><span class="atlas-open">${icon("chevronRight", { size: "sm" })}</span></a>
        <a class="atlas-game atlas-game-small" data-game-modes="solo" href="/silhouette" onclick="event.preventDefault();go('silhouette')"><span class="atlas-small-head"><b>02</b><em>${pick("RECOGNITION", "HERKENNEN")}</em></span><span class="atlas-relief" aria-hidden="true"><i></i><i></i><i></i></span><span class="atlas-small-copy"><strong>${pick("Shape Guess", "Vorm Raden")}</strong><small>${pick("Identify a country by form.", "Herken een land aan zijn vorm.")}</small></span><span class="atlas-open">${icon("chevronRight", { size: "sm" })}</span></a>
        <a class="atlas-game atlas-game-small" data-game-modes="solo" href="/globle" onclick="event.preventDefault();go('globle')"><span class="atlas-small-head"><b>03</b><em>${pick("DISTANCE", "AFSTAND")}</em></span><span class="atlas-orb" aria-hidden="true"><i></i><b></b></span><span class="atlas-small-copy"><strong>GlobeGuess</strong><small>${pick("Follow heat and distance.", "Volg warmte en afstand.")}</small></span><span class="atlas-open">${icon("chevronRight", { size: "sm" })}</span></a>
        <a class="atlas-game atlas-game-small" data-game-modes="solo multi" href="/wikispeedrun" onclick="event.preventDefault();go('wikispeedrun')"><span class="atlas-small-head"><b>04</b><em>${pick("KNOWLEDGE", "KENNIS")}</em></span><span class="atlas-book" aria-hidden="true"><i></i><i></i><i></i><b></b></span><span class="atlas-small-copy"><strong>WikiSpeedrun</strong><small>${pick("Navigate knowledge at speed.", "Navigeer razendsnel door kennis.")}</small></span><span class="atlas-open">${icon("chevronRight", { size: "sm" })}</span></a>
      </section>
      ${adSlotHtml("hubFooter")}
    </main>`;
}

async function renderRoute(force = false) {
  if (!force && lastPathname === location.pathname) return;
  lastPathname = location.pathname;
  const version = ++routeVersion;
  if (activeCleanup) {
    try { activeCleanup(); } catch {}
    activeCleanup = null;
  }
  let [view, ...rest] = getPathSegments();
  // Supabase normally returns to /account. If its Site URL is ever used as a
  // fallback and points at the domain root, recover the callback here instead
  // of leaving credentials visible on the homepage.
  if (!view && /(?:access_token|refresh_token|error_description)=/.test(location.hash)) {
    history.replaceState(null, "", `/account${location.hash}`);
    lastPathname = location.pathname;
    view = "account";
    rest = [];
  }
  if (!view) {
    app.innerHTML = hubHtml();
    initAdSlots();
    wireGameFilters();
    document.title = "GlobeGames — " + pick("Five ways to explore the world", "Vijf manieren om de wereld te ontdekken");
    return;
  }
  app.innerHTML = `<div class="route-loading"><span class="atlas-loader"></span>${pick("Loading game…", "Spel laden…")}</div>`;
  try {
    let module;
    if (view === "geohunt") {
      module = await import("./games/geohunt.js");
      if (version === routeVersion) module.renderGeoHunt(app);
    } else if (view === "silhouette") {
      module = await import("./games/silhouette.js");
      if (version === routeVersion) module.renderSilhouette(app);
    } else if (view === "globle") {
      module = await import("./games/globle.js");
      if (version === routeVersion) module.renderGlobleGame(app);
      activeCleanup = module.cleanupGloble || null;
    } else if (view === "geoguesser") {
      module = await import("./games/geoguesser.js");
      if (version === routeVersion) module.renderGeoGuesser(app, rest);
      activeCleanup = module.cleanupGeoGuesser || null;
    } else if (view === "wikispeedrun") {
      module = await import("./games/wikispeedrun.js");
      if (version === routeVersion) module.renderWikiSpeedrun(app, rest);
      activeCleanup = module.cleanupWikiSpeedrun || null;
    } else if (view === "account") {
      module = await import("./account.js");
      if (version === routeVersion) await module.renderAccount(app);
    } else {
      history.replaceState(null, "", "/");
      lastPathname = null;
      return renderRoute();
    }
    const titles = {
      geohunt: "GeoHunt",
      silhouette: pick("Shape Guess", "Vorm Raden"),
      globle: "GlobeGuess",
      geoguesser: "GeoGuesser",
      wikispeedrun: "WikiSpeedrun",
      account: "Account",
    };
    const title = titles[view] || "GlobeGames";
    document.title = `${title} — GlobeGames`;
    initAdSlots();
  } catch (error) {
    console.error(error);
    if (version === routeVersion) app.innerHTML = `${appHeader()}<div class="route-error"><h2>${pick("This page could not be loaded", "Deze pagina kon niet worden geladen")}</h2><p>${error.message}</p><a class="btn primary" href="/">${pick("Back to games", "Terug naar spellen")}</a></div>`;
  }
}

function wireGameFilters() {
  const buttons = [...document.querySelectorAll("[data-game-filter]")];
  const cards = [...document.querySelectorAll("[data-game-modes]")];
  const count = document.querySelector("[data-game-count]");
  buttons.forEach((button) => button.addEventListener("click", () => {
    const filter = button.dataset.gameFilter;
    buttons.forEach((item) => item.classList.toggle("active", item === button));
    let visible = 0;
    cards.forEach((card) => {
      const show = filter === "all" || card.dataset.gameModes.split(" ").includes(filter);
      card.hidden = !show;
      if (show) visible++;
    });
    if (count) count.textContent = pick(`${visible} experience${visible === 1 ? "" : "s"}`, `${visible} ervaring${visible === 1 ? "" : "en"}`);
  }));
}

window.go = function go(view) {
  const path = view === "hub" ? "/" : `/${view}`;
  if (location.pathname !== path) history.pushState(null, "", path);
  lastPathname = null;
  renderRoute();
};

window.ggToggleLanguage = function ggToggleLanguage() {
  setLanguage(getLanguage() === "en" ? "nl" : "en");
  lastPathname = null;
  renderRoute(true);
};

window.addEventListener("popstate", () => { lastPathname = null; renderRoute(); });
window.addEventListener("globegames:language", () => { lastPathname = null; });
renderRoute();

// Hydrate the lightweight multiplayer profile from the signed-in account in
// the background. Existing fields are only filled while still empty, so a
// player can immediately type a different lobby name if they prefer.
Promise.all([import("./lib/auth.js"), import("./lib/profile.js")])
  .then(async ([auth, profile]) => {
    const session = await auth.getSession();
    if (!session) return;
    const synced = profile.syncProfileFromSession(session);
    ["ggNameInput", "ggAutoJoinName", "wsNameInput"].forEach((id) => {
      const input = document.getElementById(id);
      if (input && !input.value.trim()) input.value = synced.name;
    });
  })
  .catch(() => {});
