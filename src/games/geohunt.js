import { COUNTRY_DATA } from "../data/countries.js";
import { ALL_NAMES, flagEmoji, attachAutocomplete, icon } from "../core.js";
import { topbar } from "../lib/layout.js";
import { countryName, findCountryByAnyName, localizedCountryCandidates, pick } from "../lib/i18n.js";
import { adSlotHtml, initAdSlots } from "../lib/ads.js";

const CRITERIA_POOL = [
  { id: "eu", en: "EU MEMBER", nl: "EU-LIDSTAAT", test: (c) => c.e },
  { id: "olympics", en: "HOSTED THE OLYMPIC\nGAMES", nl: "HEEFT DE OLYMPISCHE\nSPELEN GEHOST", test: (c) => c.o },
  { id: "vowel", en: "NAME STARTS WITH\nA VOWEL", nl: "NAAM BEGINT MET\nEEN KLINKER", test: (c) => c.v },
  { id: "gb", en: "FORMER BRITISH\nCOLONY", nl: "VOORMALIGE BRITSE\nKOLONIE", test: (c) => c.b },
  { id: "landlocked", en: "LANDLOCKED", nl: "LAND ZONDER\nZEETOEGANG", test: (c) => c.l },
  { id: "green", en: "FLAG HAS GREEN", nl: "VLAG BEVAT GROEN", test: (c) => c.f.includes("g") },
  { id: "red", en: "FLAG HAS RED", nl: "VLAG BEVAT ROOD", test: (c) => c.f.includes("r") },
  { id: "blue", en: "FLAG HAS BLUE", nl: "VLAG BEVAT BLAUW", test: (c) => c.f.includes("b") },
  { id: "yellow", en: "FLAG HAS YELLOW", nl: "VLAG BEVAT GEEL", test: (c) => c.f.includes("y") },
  { id: "white", en: "FLAG HAS WHITE", nl: "VLAG BEVAT WIT", test: (c) => c.f.includes("w") },
  { id: "black", en: "FLAG HAS BLACK", nl: "VLAG BEVAT ZWART", test: (c) => c.f.includes("k") },
  { id: "africa", en: "IN AFRICA", nl: "LIGT IN AFRIKA", test: (c) => c.c === "AF" },
  { id: "asia", en: "IN ASIA", nl: "LIGT IN AZIË", test: (c) => c.c === "AS" },
  { id: "europe", en: "IN EUROPE", nl: "LIGT IN EUROPA", test: (c) => c.c === "EU" },
  { id: "samerica", en: "IN SOUTH AMERICA", nl: "LIGT IN ZUID-AMERIKA", test: (c) => c.c === "SA" },
  { id: "namerica", en: "IN NORTH AMERICA", nl: "LIGT IN NOORD-AMERIKA", test: (c) => c.c === "NA" },
  { id: "oceania", en: "IN OCEANIA", nl: "LIGT IN OCEANIË", test: (c) => c.c === "OC" },
];

const DIFFICULTIES = [
  { key: "easy", en: "Easy", nl: "Makkelijk", mistakes: 9 },
  { key: "normal", en: "Normal", nl: "Normaal", mistakes: 6 },
  { key: "hard", en: "Hard", nl: "Moeilijk", mistakes: 3 },
];

let app;
let game;

const criterionLabel = (criterion) => pick(criterion.en, criterion.nl).replace("\n", "<br>");
const difficultyLabel = (difficulty) => pick(difficulty.en, difficulty.nl);

function currentDifficulty() {
  const saved = localStorage.getItem("gg_geohunt_difficulty");
  return DIFFICULTIES.find((item) => item.key === saved) || DIFFICULTIES[1];
}

function createBoard() {
  for (let attempt = 0; attempt < 400; attempt++) {
    const pool = [...CRITERIA_POOL].sort(() => Math.random() - 0.5);
    const rows = pool.slice(0, 3);
    const cols = pool.slice(3, 6);
    const valid = {};
    let possible = true;
    for (let row = 0; row < 3 && possible; row++) {
      for (let col = 0; col < 3; col++) {
        const matches = ALL_NAMES.filter((name) => rows[row].test(COUNTRY_DATA[name]) && cols[col].test(COUNTRY_DATA[name]));
        if (!matches.length) { possible = false; break; }
        valid[`${row}-${col}`] = matches;
      }
    }
    if (possible) return { rows, cols, valid };
  }
  throw new Error("Could not generate a valid board.");
}

export function renderGeoHunt(rootElement) {
  app = rootElement;
  const difficulty = currentDifficulty();
  game = { board: createBoard(), filled: {}, used: new Set(), mistakes: difficulty.mistakes, maxMistakes: difficulty.mistakes, difficulty: difficulty.key, score: 0, activeCell: null, over: false };
  draw();
}

function draw() {
  const { rows, cols } = game.board;
  const cell = (row, col) => {
    const key = `${row}-${col}`;
    const answer = game.filled[key];
    if (answer) return `<div class="gcell filled"><div class="flagemoji">${flagEmoji(answer.iso2)}</div><div>${countryName(answer.name)}</div><div class="pts ${answer.rare ? "rare" : ""}">${answer.pts} pts</div></div>`;
    return `<button type="button" class="gcell answer" data-row="${row}" data-col="${col}" id="cell-${key}" aria-label="${pick("Answer cell", "Antwoordvak")}"></button>`;
  };
  app.innerHTML = `${topbar()}
    <div class="gametitle"><div><h2>${icon("grid", { size: "sm" })} GeoHunt</h2><div class="desc">${pick("Fill every cell with a country that matches its row and column clues.", "Vul elk vakje met een land dat aan de rij- én kolomcriteria voldoet.")}</div></div>
      <div class="pillrow"><span class="pill">${pick("Board", "Bord")} 1</span><select id="ghDifficulty" class="pill-select" aria-label="${pick("Difficulty", "Moeilijkheid")}">${DIFFICULTIES.map((item) => `<option value="${item.key}" ${item.key === game.difficulty ? "selected" : ""}>${difficultyLabel(item)}</option>`).join("")}</select></div></div>
    <div id="inputzone"></div>
    <div class="grid3">
      <div class="gcell corner"><span class="big" id="ghMistakesNum">${game.mistakes}</span><div class="small">${pick(`of ${game.maxMistakes} mistakes left`, `van ${game.maxMistakes} fouten over`)}</div></div>
      ${cols.map((item) => `<div class="gcell criteria">${criterionLabel(item)}</div>`).join("")}
      <div class="gcell criteria">${criterionLabel(rows[0])}</div>${cell(0, 0)}${cell(0, 1)}${cell(0, 2)}
      <div class="gcell criteria">${criterionLabel(rows[1])}</div>${cell(1, 0)}${cell(1, 1)}${cell(1, 2)}
      <div class="gcell criteria">${criterionLabel(rows[2])}</div>${cell(2, 0)}${cell(2, 1)}${cell(2, 2)}
    </div>
    <div class="footerrow"><div class="scorebox"><span class="lbl">Score</span><span class="val">${game.score}</span></div><button id="ghNewGame" class="btn">${icon("refresh", { size: "sm" })} ${pick("New game", "Nieuw spel")}</button></div>
    ${adSlotHtml("geohuntBoard")}`;
  initAdSlots();
  app.querySelectorAll(".gcell.answer").forEach((button) => button.addEventListener("click", () => openCell(Number(button.dataset.row), Number(button.dataset.col))));
  document.getElementById("ghDifficulty")?.addEventListener("change", (event) => changeDifficulty(event.target.value));
  document.getElementById("ghNewGame")?.addEventListener("click", () => renderGeoHunt(app));
}

function submit() {
  if (game.over || !game.activeCell) return;
  const input = document.getElementById("ghInput");
  const message = document.getElementById("ghMsg");
  const [row, col] = game.activeCell;
  const key = `${row}-${col}`;
  const name = findCountryByAnyName(input.value, ALL_NAMES);
  const fail = (text) => {
    message.className = "msg bad";
    message.textContent = text;
    game.mistakes--;
    document.getElementById("ghMistakesNum").textContent = game.mistakes;
    if (game.mistakes <= 0) endGame(false);
  };
  if (!name) return fail(pick("Unknown country. Try again.", "Onbekend land. Probeer opnieuw."));
  if (game.used.has(name)) return fail(pick(`${countryName(name)} is already on the board.`, `${countryName(name)} is al gebruikt op het bord.`));
  const { rows, cols, valid } = game.board;
  if (!rows[row].test(COUNTRY_DATA[name]) || !cols[col].test(COUNTRY_DATA[name])) return fail(pick(`${countryName(name)} does not match both clues.`, `${countryName(name)} voldoet niet aan beide criteria.`));
  const count = valid[key].length;
  const points = Math.max(4, Math.min(99, Math.round(140 / count)));
  game.filled[key] = { name, pts: points, rare: count <= 2, iso2: COUNTRY_DATA[name].i };
  game.used.add(name);
  game.score += points;
  game.activeCell = null;
  if (Object.keys(game.filled).length === 9) endGame(true); else draw();
}

function endGame(won) {
  game.over = true;
  draw();
  const overlay = document.createElement("div");
  overlay.className = "overlay";
  overlay.innerHTML = `<div class="overlaybox"><h3>${won ? icon("check", { size: "sm" }) + " " + pick("Board complete!", "Bord compleet!") : icon("warning", { size: "sm" }) + " " + pick("No mistakes left", "Geen fouten meer over")}</h3><p>${pick("Final score", "Eindscore")}: <strong>${game.score}</strong> ${pick("points", "punten")}</p><button class="btn primary">${pick("New game", "Nieuw spel")}</button></div>`;
  document.body.appendChild(overlay);
  overlay.querySelector("button").addEventListener("click", () => {
    overlay.remove();
    renderGeoHunt(app);
  });
}

function openCell(row, col) {
  if (game.over) return;
  game.activeCell = [row, col];
  document.getElementById("inputzone").innerHTML = `<div class="inputrow"><input id="ghInput" autocomplete="off" placeholder="${pick("Type a country…", "Typ een land…")}"><div class="autocomplete" id="ghAuto"></div><button id="ghSubmit">${pick("Submit", "Gok")}</button></div><div class="msg" id="ghMsg"></div>`;
  const input = document.getElementById("ghInput");
  attachAutocomplete(input, document.getElementById("ghAuto"), localizedCountryCandidates(ALL_NAMES.filter((name) => !game.used.has(name))), () => {});
  input.addEventListener("keydown", (event) => { if (event.key === "Enter") submit(); });
  document.getElementById("ghSubmit").addEventListener("click", submit);
  input.focus();
}

function changeDifficulty(key) {
  localStorage.setItem("gg_geohunt_difficulty", key);
  renderGeoHunt(app);
}
