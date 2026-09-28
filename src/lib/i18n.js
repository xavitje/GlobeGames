import { COUNTRY_DATA } from "../data/countries.js";

const LANGUAGE_KEY = "gg_language";
const SUPPORTED = new Set(["en", "nl"]);

export function getLanguage() {
  try {
    const saved = localStorage.getItem(LANGUAGE_KEY);
    return SUPPORTED.has(saved) ? saved : "en";
  } catch {
    return "en";
  }
}

export function setLanguage(language) {
  const next = SUPPORTED.has(language) ? language : "en";
  try { localStorage.setItem(LANGUAGE_KEY, next); } catch {}
  document.documentElement.lang = next;
  window.dispatchEvent(new CustomEvent("globegames:language", { detail: next }));
}

export function pick(en, nl) {
  return getLanguage() === "nl" ? nl : en;
}

const COPY = {
  en: {
    games: "Games",
    daily: "Daily challenge",
    leaderboard: "Leaderboard",
    account: "Account",
    signIn: "Sign in",
    allGames: "All games",
    backToGames: "All games",
  },
  nl: {
    games: "Spellen",
    daily: "Dagelijkse uitdaging",
    leaderboard: "Ranglijst",
    account: "Account",
    signIn: "Inloggen",
    allGames: "Alle spellen",
    backToGames: "Alle spellen",
  },
};

export function t(key) {
  return COPY[getLanguage()]?.[key] || COPY.en[key] || key;
}

const displayNames = new Map();

function countryDisplayNames(language) {
  if (!displayNames.has(language)) {
    displayNames.set(language, typeof Intl.DisplayNames === "function"
      ? new Intl.DisplayNames([language], { type: "region" })
      : null);
  }
  return displayNames.get(language);
}

const DUTCH_OVERRIDES = {
  "The Bahamas": "Bahama's",
  "Ivory Coast": "Ivoorkust",
  "Czech Republic": "Tsjechië",
  "Democratic Republic of the Congo": "Democratische Republiek Congo",
  "Republic of the Congo": "Republiek Congo",
  "East Timor": "Oost-Timor",
  "Republic of Serbia": "Servië",
  "Swaziland": "Eswatini",
  "United Republic of Tanzania": "Tanzania",
  "United States of America": "Verenigde Staten",
  "Northern Cyprus": "Noord-Cyprus",
  "West Bank": "Westelijke Jordaanoever",
};

export function countryName(canonical, language = getLanguage()) {
  if (!canonical) return "";
  if (language === "en") return canonical;
  if (DUTCH_OVERRIDES[canonical]) return DUTCH_OVERRIDES[canonical];
  const iso2 = COUNTRY_DATA[canonical]?.i;
  if (!iso2) return canonical;
  try {
    return countryDisplayNames(language)?.of(iso2) || canonical;
  } catch {
    return canonical;
  }
}

function normalized(value) {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("nl")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function findCountryByAnyName(value, pool = Object.keys(COUNTRY_DATA)) {
  const query = normalized(value);
  if (!query) return undefined;
  return pool.find((canonical) => (
    normalized(canonical) === query || normalized(countryName(canonical, "nl")) === query
  ));
}

export function localizedCountryCandidates(pool) {
  return (query) => {
    const q = normalized(query);
    return pool
      .map((canonical) => ({ canonical, label: countryName(canonical) }))
      .filter(({ canonical, label }) => normalized(canonical).includes(q) || normalized(label).includes(q))
      .sort((a, b) => {
        const ai = Math.min(normalized(a.canonical).indexOf(q), normalized(a.label).indexOf(q));
        const bi = Math.min(normalized(b.canonical).indexOf(q), normalized(b.label).indexOf(q));
        return ai - bi || a.label.localeCompare(b.label, getLanguage());
      })
      .map(({ label }) => label);
  };
}

document.documentElement.lang = getLanguage();
