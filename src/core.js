import{COUNTRY_DATA}from"./data/countries.js";export const ALL_NAMES=Object.keys(COUNTRY_DATA).sort();function loadGeoJson(path){return fetch(`${path}?v=${typeof __GEO_BUILD_ID__!=="undefined"?__GEO_BUILD_ID__:Date.now()}`).then(r=>r.json())}let WORLD=null,WORLD_BY_NAME={};export function loadWorld(){return WORLD?Promise.resolve(WORLD):loadGeoJson(`${import.meta.env.BASE_URL}world.json`).then(data=>(WORLD=data,data.features.forEach(f=>WORLD_BY_NAME[f.properties.name]=f),WORLD))}export function worldByName(){return WORLD_BY_NAME}let WORLD_HD=null,WORLD_HD_BY_NAME={};export function loadWorldHD(){return WORLD_HD?Promise.resolve(WORLD_HD):loadGeoJson(`${import.meta.env.BASE_URL}world_hd.json`).then(data=>(WORLD_HD=data,data.features.forEach(f=>WORLD_HD_BY_NAME[f.properties.name]=f),WORLD_HD))}export function shapeFeatureFor(name){return WORLD_HD_BY_NAME[name]||WORLD_BY_NAME[name]}export function flagEmoji(iso2){if(!iso2||2!==iso2.length)return"🏳️";const A=127462;return String.fromCodePoint(A+(iso2.charCodeAt(0)-65))+String.fromCodePoint(A+(iso2.charCodeAt(1)-65))}export function toRad(d){return d*Math.PI/180}export function toDeg(r){return 180*r/Math.PI}export function haversineKm(a,b){const dLat=toRad(b[1]-a[1]),dLon=toRad(b[0]-a[0]),lat1=toRad(a[1]),lat2=toRad(b[1]),h=Math.sin(dLat/2)**2+Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLon/2)**2;return 12742*Math.asin(Math.min(1,Math.sqrt(h)))}export function bearing(a,b){const lat1=toRad(a[1]),lat2=toRad(b[1]),dLon=toRad(b[0]-a[0]),y=Math.sin(dLon)*Math.cos(lat2),x=Math.cos(lat1)*Math.sin(lat2)-Math.sin(lat1)*Math.cos(lat2)*Math.cos(dLon);return(toDeg(Math.atan2(y,x))+360)%360}export function compassArrow(deg){return `<svg class="icon compass-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="transform:rotate(${Math.round(deg)}deg)"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="6 11 12 5 18 11"/></svg>`}export const MAX_DIST_KM=20015;export function proximityPct(km){return Math.max(0,Math.round(100-km/20015*100))}export function findCountryByLoose(name){const q=name.trim().toLowerCase();return ALL_NAMES.find(n=>n.toLowerCase()===q)}export function attachAutocomplete(input,dropdown,candidatesFn,onPick){let items=[],activeIdx=-1;function render(){if(!items.length)return dropdown.style.display="none",void(dropdown.innerHTML="");dropdown.innerHTML=items.map((n,i)=>`<div data-i="${i}" class="${i===activeIdx?"active":""}">${n}</div>`).join(""),dropdown.style.display="block",[...dropdown.children].forEach(el=>{el.addEventListener("mousedown",e=>{e.preventDefault(),pick(items[+el.dataset.i])})})}function pick(name){input.value=name,dropdown.style.display="none",items=[],activeIdx=-1,onPick(name)}input.addEventListener("input",()=>{const q=input.value.trim();items=q.length?candidatesFn(q).slice(0,8):[],activeIdx=-1,render()}),input.addEventListener("keydown",e=>{"ArrowDown"===e.key?(e.preventDefault(),activeIdx=Math.min(items.length-1,activeIdx+1),render()):"ArrowUp"===e.key?(e.preventDefault(),activeIdx=Math.max(0,activeIdx-1),render()):"Enter"===e.key?activeIdx>=0&&items[activeIdx]&&(e.preventDefault(),pick(items[activeIdx])):"Escape"===e.key&&(dropdown.style.display="none",items=[])}),document.addEventListener("click",e=>{e.target===input||dropdown.contains(e.target)||(dropdown.style.display="none")})}export function candidateNames(pool){return q=>pool.filter(n=>n.toLowerCase().includes(q.toLowerCase())).sort((a,b)=>a.toLowerCase().indexOf(q.toLowerCase())-b.toLowerCase().indexOf(q.toLowerCase()))}export function topbar(){return `<div class="topbar">
    <div class="brand" onclick="go('hub')">
      <span class="brand-mark">${icon("globe",{size:"lg"})}</span>
      <h1>Globe<span>Games</span></h1>
    </div>
    <button class="navbtn" onclick="go('hub')">${icon("chevronLeft",{size:"sm"})}<span>Alle spellen</span></button>
  </div>`}

// ---------- Icoon-systeem (geen emoji's) ----------
// Kleine set lijn-iconen op een 24x24 grid, altijd `stroke="currentColor"` met
// ronde lijnuiteinden — bewust dezelfde "nooit scherp"-taal als de rest van het
// design. icon(name, {size, className}) geeft een losse <svg>-string terug die
// direct in een template literal past.

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

// ---------- Gedeelde speler-kleuren ----------
// Eén samenhangende set (gebaseerd op de accentkleur, variërend in tint/
// helderheid) i.p.v. de willekeurige "snoep"-kleuren die eerder verspreid
// stonden over geoguesser.js en profile.js.
export const PLAYER_COLORS = [
  "#7c5cff", "#5c8fff", "#22c1a4", "#e07a5f",
  "#c77dff", "#4f9dde",
];
