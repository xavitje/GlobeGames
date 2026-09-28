import { COUNTRY_DATA } from "./data/countries.js";
import { escapeHtml } from "./lib/html.js";

export const ALL_NAMES = Object.keys(COUNTRY_DATA).sort();
export const MAX_DIST_KM = 20015;

let world = null;
let worldByNameCache = {};
let worldHd = null;
let worldHdByNameCache = {};

function loadGeoJson(path) {
  const buildId = typeof __GEO_BUILD_ID__ !== "undefined" ? __GEO_BUILD_ID__ : Date.now();
  return fetch(`${path}?v=${buildId}`).then((response) => response.json());
}

function indexFeatures(data) {
  return Object.fromEntries(data.features.map((feature) => [feature.properties.name, feature]));
}

export async function loadWorld() {
  if (world) return world;
  world = await loadGeoJson(`${import.meta.env.BASE_URL}world.json`);
  worldByNameCache = indexFeatures(world);
  return world;
}

export function worldByName() {
  return worldByNameCache;
}

export async function loadWorldHD() {
  if (worldHd) return worldHd;
  worldHd = await loadGeoJson(`${import.meta.env.BASE_URL}world_hd.json`);
  worldHdByNameCache = indexFeatures(worldHd);
  return worldHd;
}

export function shapeFeatureFor(name) {
  return worldHdByNameCache[name] || worldByNameCache[name];
}

export function flagEmoji(iso2) {
  if (!iso2 || iso2.length !== 2) return "🏳️";
  const regionalIndicatorA = 127462;
  return String.fromCodePoint(
    regionalIndicatorA + iso2.charCodeAt(0) - 65,
    regionalIndicatorA + iso2.charCodeAt(1) - 65,
  );
}

export function toRad(degrees) {
  return degrees * Math.PI / 180;
}

export function toDeg(radians) {
  return radians * 180 / Math.PI;
}

export function haversineKm(a, b) {
  const deltaLat = toRad(b[1] - a[1]);
  const deltaLon = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const value = Math.sin(deltaLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  return 12742 * Math.asin(Math.min(1, Math.sqrt(value)));
}

export function bearing(a, b) {
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const deltaLon = toRad(b[0] - a[0]);
  const y = Math.sin(deltaLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2)
    - Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

export function compassArrow(degrees) {
  return `<svg class="icon compass-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="transform:rotate(${Math.round(degrees)}deg)"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="6 11 12 5 18 11"/></svg>`;
}

export function proximityPct(km) {
  return Math.max(0, Math.round(100 - km / MAX_DIST_KM * 100));
}

export function attachAutocomplete(input, dropdown, candidatesFn, onPick) {
  const controller = new AbortController();
  const { signal } = controller;
  let items = [];
  let activeIndex = -1;

  function hide() {
    dropdown.style.display = "none";
    dropdown.innerHTML = "";
  }

  function pick(name) {
    input.value = name;
    items = [];
    activeIndex = -1;
    hide();
    onPick(name);
  }

  function render() {
    if (!items.length) {
      hide();
      return;
    }
    dropdown.replaceChildren(...items.map((name, index) => {
      const option = document.createElement("div");
      option.dataset.i = String(index);
      option.className = index === activeIndex ? "active" : "";
      option.textContent = name;
      option.addEventListener("mousedown", (event) => {
        event.preventDefault();
        pick(name);
      }, { signal });
      return option;
    }));
    dropdown.style.display = "block";
  }

  input.addEventListener("input", () => {
    const query = input.value.trim();
    items = query ? candidatesFn(query).slice(0, 8) : [];
    activeIndex = -1;
    render();
  }, { signal });

  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      activeIndex = Math.min(items.length - 1, activeIndex + 1);
      render();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      activeIndex = Math.max(0, activeIndex - 1);
      render();
    } else if (event.key === "Enter" && activeIndex >= 0 && items[activeIndex]) {
      event.preventDefault();
      pick(items[activeIndex]);
    } else if (event.key === "Escape") {
      items = [];
      hide();
    }
  }, { signal });

  document.addEventListener("click", (event) => {
    if (event.target !== input && !dropdown.contains(event.target)) hide();
  }, { signal });

  const observer = new MutationObserver(() => {
    if (input.isConnected) return;
    observer.disconnect();
    controller.abort();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  signal.addEventListener("abort", () => observer.disconnect(), { once: true });

  return () => controller.abort();
}

export { escapeHtml };

const ICONS = {
  chevronLeft: '<polyline points="15 5 8 12 15 19"/>',
  chevronRight: '<polyline points="9 5 16 12 9 19"/>',
  close: '<line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/>',
  check: '<polyline points="5 13 10 18 19 7"/>',
  gear: '<line x1="4" y1="7" x2="20" y2="7"/><circle cx="9" cy="7" r="2"/><line x1="4" y1="17" x2="20" y2="17"/><circle cx="15" cy="17" r="2"/>',
  users: '<circle cx="8" cy="8" r="3"/><path d="M3 20c0-3.2 2.2-5.5 5-5.5s5 2.3 5 5.5"/><circle cx="17" cy="9.5" r="2.4"/><path d="M14.3 20c.3-2.3 1.8-4.1 3.9-4.4"/>',
  key: '<circle cx="8" cy="15.5" r="3.3"/><path d="M10.4 13 20 3.4"/><path d="M15.6 7.8 18.2 10.4"/><path d="M12.8 10.6 14.8 12.6"/>',
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  calendar: '<rect x="4" y="5" width="16" height="15" rx="2.5"/><line x1="4" y1="10" x2="20" y2="10"/><line x1="8" y1="3" x2="8" y2="7"/><line x1="16" y1="3" x2="16" y2="7"/>',
  clipboard: '<rect x="6.5" y="4.5" width="11" height="16" rx="2.2"/><rect x="9" y="3" width="6" height="3" rx="1"/>',
  ruler: '<line x1="4" y1="18" x2="20" y2="6"/><line x1="7" y1="17" x2="9" y2="15"/><line x1="10.5" y1="14" x2="12.5" y2="12"/><line x1="14" y1="11" x2="16" y2="9"/>',
  warning: '<path d="M12 4 3 19h18Z"/><line x1="12" y1="10" x2="12" y2="14.2"/>',
  heart: '<path d="M12 20s-7-4.5-9.3-8.9C1.2 7.9 2.9 5.2 6 5.2c2 0 3.4 1.2 4 2.1.6-.9 2-2.1 4-2.1 3.1 0 4.8 2.7 3.3 5.9C19 15.5 12 20 12 20Z"/>',
  chat: '<path d="M4.5 5.5h15v10.5h-8l-4 3v-3h-3Z"/>',
  flag: '<line x1="6" y1="3" x2="6" y2="21"/><path d="M6 4.2h11.5l-3 4 3 4H6Z"/>',
  chip: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.2"/>',
  flame: '<path d="M12 21c-4 0-6.6-2.6-6.6-6.1 0-3 2-4.7 2.6-7.5.4 1.7 1.4 2.7 2.5 2.7-.4-2.6.4-5.1 3-6.8-.6 2.4.2 4.1 1.8 5.3 2 1.6 3.3 3.5 3.3 6.4 0 3.4-2.6 6-6.6 6Z"/>',
  wifi: '<path d="M4 9a13 13 0 0 1 16 0"/><path d="M7 13a8 8 0 0 1 10 0"/><path d="M10 17a3 3 0 0 1 4 0"/>',
  lockOpen: '<rect x="5" y="11" width="14" height="9" rx="2.2"/><path d="M8 11V7a4 4 0 0 1 7.5-2"/>',
  lockClosed: '<rect x="5" y="11" width="14" height="9" rx="2.2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  globe: '<circle cx="12" cy="12" r="9"/><line x1="3" y1="12" x2="21" y2="12"/><path d="M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
  grid: '<rect x="3" y="3" width="7.5" height="7.5" rx="1.6"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.6"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.6"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.6"/>',
  map: '<path d="M4 6.5 9.5 4.5 14 6.5 20 4.5v13L14 19.5 9.5 17.5 4 19.5Z"/><line x1="9.5" y1="4.5" x2="9.5" y2="17.5"/><line x1="14" y1="6.5" x2="14" y2="19.5"/>',
  pin: '<path d="M12 21s7-6.5 7-12a7 7 0 1 0-14 0c0 5.5 7 12 7 12Z"/><circle cx="12" cy="9" r="2.4"/>',
  refresh: '<path d="M20 12a8 8 0 1 1-3-6.3"/><polyline points="20 3 20 8 15 8"/>',
  trophy: '<path d="M6 4h12v3a6 6 0 0 1-12 0Z"/><path d="M6 5H3a3 3 0 0 0 3 5"/><path d="M18 5h3a3 3 0 0 1-3 5"/><line x1="12" y1="13" x2="12" y2="17.5"/><line x1="8.5" y1="20" x2="15.5" y2="20"/><line x1="12" y1="17.5" x2="12" y2="20"/>',
  user: '<circle cx="12" cy="8.3" r="3.6"/><path d="M4.7 20c0-3.6 3.1-6.3 7.3-6.3s7.3 2.7 7.3 6.3"/>',
  dice: '<rect x="4" y="4" width="16" height="16" rx="3.6"/><circle cx="8.3" cy="8.3" r="1.1"/><circle cx="15.7" cy="8.3" r="1.1"/><circle cx="12" cy="12" r="1.1"/><circle cx="8.3" cy="15.7" r="1.1"/><circle cx="15.7" cy="15.7" r="1.1"/>',
  shuffle: '<path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/>',
  swap: '<path d="M4 8h13"/><polyline points="13 4 17 8 13 12"/><path d="M20 16H7"/><polyline points="11 12 7 16 11 20"/>',
  send: '<line x1="5" y1="12" x2="19" y2="12"/><polyline points="13 6 19 12 13 18"/>',
  clock: '<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15.5 14"/>',
  fastForward: '<polyline points="4 6 11 12 4 18"/><polyline points="12 6 19 12 12 18"/>',
  bookOpen: '<path d="M12 6.2c-2-1.5-4.6-2-7.2-1.5v13c2.6-.5 5.2 0 7.2 1.5 2-1.5 4.6-2 7.2-1.5v-13c-2.6-.5-5.2 0-7.2 1.5Z"/><line x1="12" y1="6.2" x2="12" y2="19.2"/>',
  info: '<circle cx="12" cy="12" r="9"/><line x1="12" y1="11" x2="12" y2="16.5"/><circle cx="12" cy="7.8" r="0.9" fill="currentColor" stroke="none"/>',
};

export function icon(name, opts = {}) {
  const body = ICONS[name];
  if (!body) return "";
  const sizeClass = opts.size ? ` icon-${opts.size}` : "";
  const extra = opts.className ? ` ${opts.className}` : "";
  return `<svg class="icon${sizeClass}${extra}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

export const PLAYER_COLORS = [
  "#7c5cff", "#5c8fff", "#22c1a4", "#e07a5f",
  "#c77dff", "#4f9dde",
];
