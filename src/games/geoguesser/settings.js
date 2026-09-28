import { GEO_POINTS, LOCATION_SETS } from "../../data/geoPoints.js";
import { icon } from "../../core.js";
import { countryName, pick } from "../../lib/i18n.js";

const LOCATION_LABELS = {
  world: ["Worldwide", "Hele wereld"],
  capitals: ["Capital cities", "Hoofdsteden"],
  bigcities: ["Major cities", "Grote steden"],
  europe: ["Europe", "Europa"],
  americas: ["The Americas", "Amerika's"],
  asia: ["Asia", "Azië"],
  africa: ["Africa", "Afrika"],
  oceania: ["Oceania", "Oceanië"],
  netherlands: ["The Netherlands", "Nederland"],
  landmarks: ["Famous landmarks", "Beroemde bezienswaardigheden"],
};

const countries = Object.keys(GEO_POINTS).sort((a, b) => countryName(a).localeCompare(countryName(b)));

function resolveLocationSet(location) {
  if (location?.type === "country" && GEO_POINTS[location.name]) {
    return { label: `${icon("flag", { size: "sm" })} ${countryName(location.name)}`, countries: [location.name], onlyCapital: false };
  }
  return LOCATION_SETS[location] || LOCATION_SETS.world;
}

export function locationSetLabel(location) {
  return resolveLocationSet(location).label;
}

export function buildPointFn(location = "world", random = Math.random) {
  const set = resolveLocationSet(location);
  const eligible = set.countries.filter((country) => GEO_POINTS[country]?.length);
  return function randomPoint() {
    const country = eligible[Math.floor(random() * eligible.length)];
    const points = GEO_POINTS[country];
    if (set.onlyCapital) return { country, ...points[0] };
    const weighted = points.flatMap((point, index) => Array(index === 0 ? 2 : 1).fill(point));
    return { country, ...weighted[Math.floor(random() * weighted.length)] };
  };
}

export function locationSettingHtml(idPrefix, current) {
  const isCountry = current?.type === "country";
  const selectedKey = isCountry ? "country" : current || "world";
  const presetOptions = Object.entries(LOCATION_SETS).map(([key, set]) => {
    const labels = LOCATION_LABELS[key];
    const label = labels ? pick(labels[0], labels[1]) : set.label;
    return `<option value="${key}" ${key === selectedKey ? "selected" : ""}>${label}</option>`;
  }).join("");
  const countryOptions = countries.map((name) => `<option value="${name}" ${isCountry && current.name === name ? "selected" : ""}>${countryName(name)}</option>`).join("");
  return `
    <div class="gg-select-wrap"><select id="${idPrefix}LocationSet" class="gg-select">
      ${presetOptions}
      <option value="country" ${selectedKey === "country" ? "selected" : ""}>${pick("Specific country", "Specifiek land")}</option>
    </select></div>
    <div class="gg-select-wrap" id="${idPrefix}CountryWrap" style="margin-top:8px; ${selectedKey === "country" ? "" : "display:none;"}">
      <select id="${idPrefix}CountrySelect" class="gg-select">${countryOptions}</select>
    </div>`;
}

export function wireLocationSetting(idPrefix) {
  const select = document.getElementById(`${idPrefix}LocationSet`);
  const countryWrap = document.getElementById(`${idPrefix}CountryWrap`);
  if (!select || !countryWrap) return;
  select.addEventListener("change", () => {
    countryWrap.style.display = select.value === "country" ? "" : "none";
  });
}

export function readLocationSetting(idPrefix) {
  const value = document.getElementById(`${idPrefix}LocationSet`)?.value || "world";
  if (value !== "country") return value;
  const name = document.getElementById(`${idPrefix}CountrySelect`)?.value;
  return name ? { type: "country", name } : "world";
}

export function difficultySettingHtml(idPrefix, difficulty = "free", blackwhite = false) {
  return `
    <label class="gg-label" style="margin-top:16px;">${pick("Difficulty", "Moeilijkheidsgraad")}</label>
    <div class="gg-pill-row" id="${idPrefix}DifficultyPills">
      <button class="gg-pill-btn${difficulty === "free" ? " active" : ""}" data-v="free">${pick("Move freely", "Vrij bewegen")}</button>
      <button class="gg-pill-btn${difficulty === "nomove" ? " active" : ""}" data-v="nomove">${pick("No moving", "Niet bewegen")}</button>
      <button class="gg-pill-btn${difficulty === "nmpz" ? " active" : ""}" data-v="nmpz">NMPZ</button>
      <button class="gg-pill-btn${difficulty === "gamble" ? " active" : ""}" data-v="gamble" title="${pick("Move freely, then bank or double your points after every round.", "Vrij bewegen, maar na elke ronde mag je je punten veilig incasseren of verdubbelen bij het rad.")}">${icon("chip", { size: "sm" })} ${pick("Gamble", "Gokken")}</button>
    </div>
    <label style="display:flex; align-items:center; gap:8px; margin-top:14px; font-size:13px; cursor:pointer;">
      <input type="checkbox" id="${idPrefix}BlackWhite" ${blackwhite ? "checked" : ""} /> ${pick("Black and white", "Zwart-wit")}
    </label>`;
}

export function wireDifficultySetting(idPrefix) {
  const row = document.getElementById(`${idPrefix}DifficultyPills`);
  row?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-v]");
    if (!button) return;
    row.querySelectorAll(".gg-pill-btn").forEach((item) => item.classList.toggle("active", item === button));
  });
}

export function readDifficultySetting(idPrefix) {
  const button = document.querySelector(`#${idPrefix}DifficultyPills .gg-pill-btn.active`);
  return {
    difficulty: button?.dataset.v || "free",
    blackwhite: Boolean(document.getElementById(`${idPrefix}BlackWhite`)?.checked),
  };
}

export function timerSettingHtml(idPrefix, seconds) {
  const enabled = seconds != null;
  return `
    <label class="gg-label" style="margin-top:16px;">${pick("Time limit per round", "Tijdslimiet per ronde")}</label>
    <div style="display:flex; align-items:center; gap:10px; margin-top:6px; flex-wrap:wrap;">
      <label style="display:flex; align-items:center; gap:6px; font-size:13px; cursor:pointer;">
        <input type="checkbox" id="${idPrefix}TimerEnabled" ${enabled ? "checked" : ""} /> ${pick("On", "Aan")}
      </label>
      <input type="number" id="${idPrefix}TimerSeconds" min="30" max="180" step="15" value="${seconds || 60}" ${enabled ? "" : "disabled"}
        style="width:80px; padding:8px 10px; border-radius:10px; border:1px solid var(--border); background:var(--panel2); color:inherit; font-size:14px;" />
      <span class="small">${pick("seconds", "seconden")} (30–180)</span>
    </div>`;
}

export function wireTimerSetting(idPrefix) {
  const checkbox = document.getElementById(`${idPrefix}TimerEnabled`);
  const input = document.getElementById(`${idPrefix}TimerSeconds`);
  if (!checkbox || !input) return;
  checkbox.addEventListener("change", () => { input.disabled = !checkbox.checked; });
}

export function readTimerSetting(idPrefix) {
  const checkbox = document.getElementById(`${idPrefix}TimerEnabled`);
  const input = document.getElementById(`${idPrefix}TimerSeconds`);
  if (!checkbox?.checked) return null;
  const value = Number.parseInt(input.value, 10);
  return Math.min(180, Math.max(30, Number.isNaN(value) ? 60 : value));
}

