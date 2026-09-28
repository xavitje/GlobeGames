import { geoOrthographic, geoPath, geoCentroid } from "d3-geo";
import { interpolateRgb } from "d3-interpolate";
import { COUNTRY_DATA } from "../data/countries.js";
import { ALL_NAMES, loadWorld, worldByName, flagEmoji, attachAutocomplete, haversineKm, proximityPct, MAX_DIST_KM, icon } from "../core.js";
import { topbar } from "../lib/layout.js";
import { countryName, findCountryByAnyName, localizedCountryCandidates, pick } from "../lib/i18n.js";
import { adSlotHtml, initAdSlots } from "../lib/ads.js";

let app;
let game = null;
let cleanupDrag = null;

export function renderGlobleGame(rootElement) {
  app = rootElement;
  cleanupGloble();
  app.innerHTML = `${topbar()}<div class="gametitle"><div><h2>${icon("globe", { size: "sm" })} GlobeGuess</h2><div class="desc">${pick("Loading world…", "Wereld laden…")}</div></div></div>`;
  loadWorld().then(() => {
    const names = ALL_NAMES.filter((name) => worldByName()[name]);
    game = { target: names[Math.floor(Math.random() * names.length)], guesses: [], rotate: [10, -15], scale: 190, over: false, projection: null, pathGen: null, pathEls: null, sphereEl: null, svg: null };
    draw();
  });
}

export function cleanupGloble() {
  if (cleanupDrag) cleanupDrag();
  cleanupDrag = null;
}

function mountGlobe(container) {
  cleanupGloble();
  const rootStyle = getComputedStyle(document.documentElement);
  const oceanHi = rootStyle.getPropertyValue("--ocean-hi").trim() || "#eaf4fb";
  const oceanLo = rootStyle.getPropertyValue("--ocean-lo").trim() || "#9fc6e0";
  container.innerHTML = `<svg id="glSvg" viewBox="0 0 520 420" width="100%" style="max-height:420px;cursor:grab" role="img" aria-label="${pick("Interactive world globe", "Interactieve wereldbol")}"><defs><radialGradient id="glOceanGrad" cx="32%" cy="28%" r="75%"><stop offset="0%" stop-color="${oceanHi}"></stop><stop offset="100%" stop-color="${oceanLo}"></stop></radialGradient></defs><path id="glSphere" fill="url(#glOceanGrad)"></path><g id="glCountries"></g></svg>`;
  const svg = container.querySelector("#glSvg");
  const group = container.querySelector("#glCountries");
  game.svg = svg;
  game.sphereEl = container.querySelector("#glSphere");
  game.pathEls = Object.values(worldByName()).map((feature) => {
    const element = document.createElementNS("http://www.w3.org/2000/svg", "path");
    element.setAttribute("class", "country");
    group.appendChild(element);
    return { el: element, f: feature };
  });
  game.projection = geoOrthographic().scale(game.scale).translate([260, 210]).rotate(game.rotate).clipAngle(90);
  game.pathGen = geoPath(game.projection);
  applyGeometry();
  game.pathEls.forEach(({ el, f }) => {
    const guess = game.guesses.find((item) => item.name === f.properties.name);
    if (!guess) return;
    el.classList.add("guessed");
    const closeness = Math.max(0, Math.min(1, 1 - guess.km / MAX_DIST_KM));
    el.style.fill = f.properties.name === game.target ? "#1fa971" : interpolateRgb("#c9cedb", "#e2482f")(closeness ** 1.35);
  });

  let dragging = false;
  let last = null;
  let velocity = [0, 0];
  let momentum = null;
  const cancelMomentum = () => { if (momentum) cancelAnimationFrame(momentum); momentum = null; };
  const down = (x, y) => { cancelMomentum(); dragging = true; last = [x, y]; velocity = [0, 0]; svg.classList.add("dragging"); };
  const move = (x, y) => {
    if (!dragging) return;
    const dx = x - last[0], dy = y - last[1];
    game.rotate = [game.rotate[0] + dx * 0.35, Math.max(-90, Math.min(90, game.rotate[1] - dy * 0.35))];
    velocity = [dx * 0.35, -dy * 0.35];
    last = [x, y];
    applyGeometry();
  };
  const startMomentum = () => {
    let [vx, vy] = velocity;
    const frame = () => {
      vx *= 0.93; vy *= 0.93;
      if (Math.hypot(vx, vy) < 0.02) { momentum = null; return; }
      game.rotate = [game.rotate[0] + vx, Math.max(-90, Math.min(90, game.rotate[1] + vy))];
      applyGeometry();
      momentum = requestAnimationFrame(frame);
    };
    if (Math.hypot(vx, vy) >= 0.02) momentum = requestAnimationFrame(frame);
  };
  const up = () => { if (dragging) { dragging = false; svg.classList.remove("dragging"); startMomentum(); } };
  const mouseDown = (event) => { down(event.clientX, event.clientY); event.preventDefault(); };
  const mouseMove = (event) => move(event.clientX, event.clientY);
  const touchStart = (event) => down(event.touches[0].clientX, event.touches[0].clientY);
  const touchMove = (event) => { move(event.touches[0].clientX, event.touches[0].clientY); event.preventDefault(); };
  const wheel = (event) => { event.preventDefault(); game.scale = Math.max(140, Math.min(280, game.scale - event.deltaY * 0.25)); applyGeometry(); };
  svg.addEventListener("mousedown", mouseDown);
  window.addEventListener("mousemove", mouseMove);
  window.addEventListener("mouseup", up);
  svg.addEventListener("touchstart", touchStart, { passive: true });
  svg.addEventListener("touchmove", touchMove, { passive: false });
  svg.addEventListener("touchend", up);
  svg.addEventListener("wheel", wheel, { passive: false });
  cleanupDrag = () => {
    cancelMomentum();
    svg.removeEventListener("mousedown", mouseDown);
    window.removeEventListener("mousemove", mouseMove);
    window.removeEventListener("mouseup", up);
    svg.removeEventListener("touchstart", touchStart);
    svg.removeEventListener("touchmove", touchMove);
    svg.removeEventListener("touchend", up);
    svg.removeEventListener("wheel", wheel);
  };
}

function applyGeometry() {
  if (!game?.projection) return;
  game.projection.rotate(game.rotate).scale(game.scale);
  game.sphereEl.setAttribute("d", game.pathGen({ type: "Sphere" }));
  game.pathEls.forEach(({ el, f }) => {
    const path = game.pathGen(f);
    if (path) { el.setAttribute("d", path); el.style.display = ""; } else el.style.display = "none";
  });
}

function draw() {
  const guesses = game.guesses.map((guess) => `<div class="gitem ${guess.correct ? "correct" : ""}"><div class="name">${flagEmoji(COUNTRY_DATA[guess.name].i)} ${countryName(guess.name)}</div><div class="dist">${guess.correct ? "" : Math.round(guess.km).toLocaleString() + " km"}</div><div></div><div class="prox">${guess.correct ? icon("check", { size: "sm" }) : guess.prox + "%"}</div></div>`).join("");
  app.innerHTML = `${topbar()}<div class="gametitle"><div><h2>${icon("globe", { size: "sm" })} GlobeGuess</h2><div class="desc">${pick("Find the mystery country — warmer colours mean you are closer.", "Raad het mysterieland — hoe warmer de kleur, hoe dichterbij.")}</div></div><div class="pillrow"><span class="pill">${pick("Guesses", "Gokken")}: <span class="n">${game.guesses.length}</span></span></div></div>
    <div class="globe-wrap" id="globeContainer"></div>
    ${game.over ? `<div class="msg good" style="text-align:center;font-size:16px;">${pick("The mystery country is", "Het mysterieland is")} ${countryName(game.target)}! ${flagEmoji(COUNTRY_DATA[game.target].i)}</div>` : `<div class="inputrow"><input id="glInput" autocomplete="off" placeholder="${pick("Type a country…", "Typ een land…")}"><div class="autocomplete" id="glAuto"></div><button id="glSubmit">${pick("Submit", "Gok")}</button></div>`}
    ${game.over ? adSlotHtml("globleEnd") : ""}<div class="guesslist">${guesses}</div><div class="footerrow"><div class="small">${pick("Drag to rotate · scroll to zoom", "Sleep om te draaien · scroll om te zoomen")}</div><button id="glNewGame" class="btn">${icon("refresh", { size: "sm" })} ${pick("New country", "Nieuw land")}</button></div>`;
  mountGlobe(document.getElementById("globeContainer"));
  initAdSlots();
  document.getElementById("glNewGame")?.addEventListener("click", () => renderGlobleGame(app));
  if (!game.over) {
    const input = document.getElementById("glInput");
    const names = ALL_NAMES.filter((name) => worldByName()[name] && !game.guesses.some((guess) => guess.name === name));
    attachAutocomplete(input, document.getElementById("glAuto"), localizedCountryCandidates(names), () => {});
    input.addEventListener("keydown", (event) => { if (event.key === "Enter") submit(); });
    document.getElementById("glSubmit").addEventListener("click", submit);
    input.focus();
  }
}

function submit() {
  const input = document.getElementById("glInput");
  const name = findCountryByAnyName(input.value, ALL_NAMES);
  const world = worldByName();
  if (!name || !world[name] || game.guesses.some((guess) => guess.name === name)) return;
  const from = geoCentroid(world[name]);
  const to = geoCentroid(world[game.target]);
  const km = haversineKm(from, to);
  const correct = name === game.target;
  game.guesses.unshift({ name, km, prox: proximityPct(km), correct });
  game.guesses.sort((a, b) => a.correct ? -1 : b.correct ? 1 : a.km - b.km);
  game.rotate = [-from[0], -from[1] * 0.6];
  if (correct) game.over = true;
  draw();
}
