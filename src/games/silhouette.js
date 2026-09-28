import { geoMercator, geoPath, geoCentroid } from "d3-geo";
import { COUNTRY_DATA } from "../data/countries.js";
import { ALL_NAMES, loadWorld, loadWorldHD, worldByName, shapeFeatureFor, flagEmoji, attachAutocomplete, haversineKm, bearing, compassArrow, proximityPct, icon } from "../core.js";
import { topbar } from "../lib/layout.js";
import { countryName, findCountryByAnyName, localizedCountryCandidates, pick } from "../lib/i18n.js";
import { adSlotHtml, initAdSlots } from "../lib/ads.js";

const DIFFICULTIES = [
  { key: "easy", en: "Easy", nl: "Makkelijk", maxGuesses: Infinity, hints: true },
  { key: "normal", en: "Normal", nl: "Normaal", maxGuesses: 6, hints: true },
  { key: "hard", en: "Hard", nl: "Moeilijk", maxGuesses: 3, hints: false },
];

let app;
let game = null;

function currentDifficulty() {
  const saved = localStorage.getItem("gg_silhouette_difficulty");
  return DIFFICULTIES.find((item) => item.key === saved) || DIFFICULTIES[0];
}

export function renderSilhouette(rootElement) {
  app = rootElement;
  app.innerHTML = `${topbar()}<div class="gametitle"><div><h2>${icon("map", { size: "sm" })} ${pick("Shape Guess", "Vorm Raden")}</h2><div class="desc">${pick("Loading countries…", "Landen laden…")}</div></div></div>`;
  Promise.all([loadWorld(), loadWorldHD()]).then(() => {
    const names = ALL_NAMES.filter((name) => worldByName()[name]);
    const difficulty = currentDifficulty();
    game = { target: names[Math.floor(Math.random() * names.length)], guesses: [], over: false, failed: false, difficulty: difficulty.key, maxGuesses: difficulty.maxGuesses, hints: difficulty.hints };
    draw();
  });
}

function shapeSvg() {
  const feature = shapeFeatureFor(game.target);
  const centroid = geoCentroid(feature);
  const projection = geoMercator().rotate([-centroid[0], 0]).fitExtent([[16, 16], [304, 244]], feature);
  return `<svg viewBox="0 0 320 260" width="100%" height="100%" role="img" aria-label="${pick("Mystery country silhouette", "Silhouet van het mysterieland")}"><path d="${geoPath(projection)(feature)}"></path></svg>`;
}

function draw() {
  const guesses = game.guesses.map((guess) => `<div class="gitem ${guess.correct ? "correct" : ""}"><div class="name">${flagEmoji(COUNTRY_DATA[guess.name].i)} ${countryName(guess.name)}</div>${guess.correct ? "<div></div><div></div>" : game.hints ? `<div class="dist">${Math.round(guess.km).toLocaleString()} km</div><div class="arrow">${guess.arrow}</div>` : `<div></div><div>${icon("close", { size: "sm" })}</div>`}<div class="prox">${guess.correct ? icon("check", { size: "sm" }) + " 100%" : game.hints ? guess.prox + "%" : ""}</div></div>`).join("");
  const answer = countryName(game.target);
  app.innerHTML = `${topbar()}
    <div class="gametitle"><div><h2>${icon("map", { size: "sm" })} ${pick("Shape Guess", "Vorm Raden")}</h2><div class="desc">${pick("Which country has this shape?", "Welk land heeft deze vorm?")}</div></div>
      <div class="pillrow"><span class="pill">${pick("Guesses", "Gokken")}: <span class="n">${game.guesses.length}</span>${Number.isFinite(game.maxGuesses) ? `/${game.maxGuesses}` : ""}</span><select id="silDifficulty" class="pill-select" aria-label="${pick("Difficulty", "Moeilijkheid")}">${DIFFICULTIES.map((item) => `<option value="${item.key}" ${item.key === game.difficulty ? "selected" : ""}>${pick(item.en, item.nl)}</option>`).join("")}</select></div></div>
    <div class="shape-wrap ${game.over ? "revealed" : ""}">${shapeSvg()}</div>
    ${game.over ? `<div class="msg ${game.failed ? "bad" : "good"}" style="text-align:center;font-size:16px;">${game.failed ? pick("No guesses left. ", "Helaas, geen gokken meer over. ") : ""}${pick("The answer is", "Het antwoord is")} ${answer}! ${flagEmoji(COUNTRY_DATA[game.target].i)}</div>` : `<div class="inputrow"><input id="silInput" autocomplete="off" placeholder="${pick("Type a country…", "Typ een land…")}"><div class="autocomplete" id="silAuto"></div><button id="silSubmit">${pick("Submit", "Gok")}</button></div>`}
    <div class="guesslist">${guesses}</div>${adSlotHtml("silhouetteList")}
    <div class="footerrow"><div></div><button id="silNewGame" class="btn">${icon("refresh", { size: "sm" })} ${pick("New country", "Nieuw land")}</button></div>`;
  initAdSlots();
  document.getElementById("silDifficulty")?.addEventListener("change", (event) => {
    localStorage.setItem("gg_silhouette_difficulty", event.target.value);
    renderSilhouette(app);
  });
  document.getElementById("silNewGame")?.addEventListener("click", () => renderSilhouette(app));
  if (!game.over) {
    const input = document.getElementById("silInput");
    const names = ALL_NAMES.filter((name) => worldByName()[name]);
    attachAutocomplete(input, document.getElementById("silAuto"), localizedCountryCandidates(names), () => {});
    input.addEventListener("keydown", (event) => { if (event.key === "Enter") submit(); });
    document.getElementById("silSubmit").addEventListener("click", submit);
    input.focus();
  }
}

function submit() {
  const input = document.getElementById("silInput");
  const name = findCountryByAnyName(input.value, ALL_NAMES);
  const world = worldByName();
  if (!name || !world[name] || game.guesses.some((guess) => guess.name === name)) return;
  if (name === game.target) {
    game.guesses.unshift({ name, correct: true });
    game.over = true;
    draw();
    return;
  }
  const from = geoCentroid(world[name]);
  const to = geoCentroid(world[game.target]);
  const km = haversineKm(from, to);
  game.guesses.unshift({ name, km, arrow: compassArrow(bearing(from, to)), prox: proximityPct(km), correct: false });
  game.guesses.sort((a, b) => a.correct ? -1 : b.correct ? 1 : a.km - b.km);
  if (game.guesses.length >= game.maxGuesses) { game.over = true; game.failed = true; }
  draw();
}
