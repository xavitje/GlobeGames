import "./style.css";
import { icon } from "./core.js";
import { appHeader } from "./lib/layout.js";
import { getLanguage, pick, setLanguage } from "./lib/i18n.js";
import { adSlotHtml, initAdSlots } from "./lib/ads.js";
import { AppRouter } from "./lib/router.js";
import { escapeHtml } from "./lib/html.js";

const app = document.getElementById("app");

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
        <a class="atlas-game atlas-game-feature" data-game-modes="solo multi" href="/geoguesser">
          <span class="atlas-feature-copy"><span class="atlas-live"><i></i>LIVE MULTIPLAYER</span><strong>GeoGuesser</strong><small>${pick("Read the road, terrain and atmosphere. Place your pin anywhere on Earth.", "Lees de weg, het terrein en de sfeer. Plaats daarna je pin ergens op aarde.")}</small><span class="atlas-game-meta"><b>${icon("users", { size: "sm" })} 1–8 ${pick("players", "spelers")}</b><b>${icon("clock", { size: "sm" })} 5–20 min</b></span><span class="atlas-start">${pick("Start game", "Start spel")}${icon("chevronRight", { size: "sm" })}</span></span>
          <span class="atlas-geo-scene" aria-hidden="true"><i class="atlas-scene-halo"></i><i class="atlas-scene-orbit one"></i><i class="atlas-scene-orbit two"></i><span class="atlas-sphere"><i class="atlas-land one"></i><i class="atlas-land two"></i><i class="atlas-land three"></i></span><span class="atlas-pin">${icon("pin", { size: "lg" })}</span><i class="atlas-platform"></i></span>
        </a>
        <a class="atlas-game atlas-game-small" data-game-modes="solo" href="/geohunt"><span class="atlas-small-head"><b>01</b><em>${pick("LOGIC", "LOGICA")}</em></span><span class="atlas-cubes" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span><span class="atlas-small-copy"><strong>GeoHunt</strong><small>${pick("Solve the country matrix.", "Los de landenmatrix op.")}</small></span><span class="atlas-open">${icon("chevronRight", { size: "sm" })}</span></a>
        <a class="atlas-game atlas-game-small" data-game-modes="solo" href="/silhouette"><span class="atlas-small-head"><b>02</b><em>${pick("RECOGNITION", "HERKENNEN")}</em></span><span class="atlas-relief" aria-hidden="true"><i></i><i></i><i></i></span><span class="atlas-small-copy"><strong>${pick("Shape Guess", "Vorm Raden")}</strong><small>${pick("Identify a country by form.", "Herken een land aan zijn vorm.")}</small></span><span class="atlas-open">${icon("chevronRight", { size: "sm" })}</span></a>
        <a class="atlas-game atlas-game-small" data-game-modes="solo" href="/globle"><span class="atlas-small-head"><b>03</b><em>${pick("DISTANCE", "AFSTAND")}</em></span><span class="atlas-orb" aria-hidden="true"><i></i><b></b></span><span class="atlas-small-copy"><strong>GlobeGuess</strong><small>${pick("Follow heat and distance.", "Volg warmte en afstand.")}</small></span><span class="atlas-open">${icon("chevronRight", { size: "sm" })}</span></a>
        <a class="atlas-game atlas-game-small" data-game-modes="solo multi" href="/wikispeedrun"><span class="atlas-small-head"><b>04</b><em>${pick("KNOWLEDGE", "KENNIS")}</em></span><span class="atlas-book" aria-hidden="true"><i></i><i></i><i></i><b></b></span><span class="atlas-small-copy"><strong>WikiSpeedrun</strong><small>${pick("Navigate knowledge at speed.", "Navigeer razendsnel door kennis.")}</small></span><span class="atlas-open">${icon("chevronRight", { size: "sm" })}</span></a>
      </section>
      ${adSlotHtml("hubFooter")}
    </main>`;
}

const routeLoaders = {
  geohunt: async () => {
    const module = await import("./games/geohunt.js");
    return { mount: module.renderGeoHunt };
  },
  silhouette: async () => {
    const module = await import("./games/silhouette.js");
    return { mount: module.renderSilhouette };
  },
  globle: async () => {
    const module = await import("./games/globle.js");
    return { mount: module.renderGlobleGame, cleanup: module.cleanupGloble };
  },
  geoguesser: async (segments) => {
    const module = await import("./games/geoguesser.js");
    return { mount: (root) => module.renderGeoGuesser(root, segments), cleanup: module.cleanupGeoGuesser };
  },
  wikispeedrun: async (segments) => {
    const module = await import("./games/wikispeedrun.js");
    return { mount: (root) => module.renderWikiSpeedrun(root, segments), cleanup: module.cleanupWikiSpeedrun };
  },
  account: async () => {
    const module = await import("./account.js");
    return { mount: module.renderAccount };
  },
};

const titles = {
  geohunt: "GeoHunt",
  silhouette: () => pick("Shape Guess", "Vorm Raden"),
  globle: "GlobeGuess",
  geoguesser: "GeoGuesser",
  wikispeedrun: "WikiSpeedrun",
  account: "Account",
};

export const router = new AppRouter({
  root: app,
  routes: Object.fromEntries(Object.entries(routeLoaders).map(([name, loader]) => [name, async (...args) => {
    const page = await loader(...args);
    return {
      ...page,
      mount: async (root) => {
        await page.mount(root);
        initAdSlots();
      },
    };
  }])),
  renderHome(root) {
    root.innerHTML = hubHtml();
    initAdSlots();
    wireGameFilters();
  },
  renderLoading(root) {
    root.innerHTML = `<div class="route-loading"><span class="atlas-loader"></span>${pick("Loading game…", "Spel laden…")}</div>`;
  },
  renderError(root, error) {
    root.innerHTML = `${appHeader()}<div class="route-error"><h2>${pick("This page could not be loaded", "Deze pagina kon niet worden geladen")}</h2><p>${escapeHtml(error.message)}</p><a class="btn primary" href="/">${pick("Back to games", "Terug naar spellen")}</a></div>`;
  },
  setTitle(name) {
    if (!name) {
      document.title = `GlobeGames — ${pick("Five ways to explore the world", "Vijf manieren om de wereld te ontdekken")}`;
      return;
    }
    const value = typeof titles[name] === "function" ? titles[name]() : titles[name];
    document.title = `${value || "GlobeGames"} — GlobeGames`;
  },
});

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

document.addEventListener("click", (event) => {
  if (!event.target.closest("[data-language-toggle]")) return;
  setLanguage(getLanguage() === "en" ? "nl" : "en");
  router.render(true);
});

window.addEventListener("globegames:language", () => router.invalidate());

// Recover OAuth callbacks that were sent to the root fallback URL.
if (location.pathname === "/" && /(?:access_token|refresh_token|error_description)=/.test(location.hash)) {
  history.replaceState(null, "", `/account${location.hash}`);
}
router.start();

// Fill empty lobby fields from the signed-in account while keeping them editable.
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
