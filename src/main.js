import "./style.css";
import { topbar } from "./core.js";
import { renderGeoHunt } from "./games/geohunt.js";
import { renderSilhouette } from "./games/silhouette.js";
import { renderGlobleGame } from "./games/globle.js";
import { renderGeoGuesser } from "./games/geoguesser.js";
import { ensureProfileWidget } from "./lib/profile.js";
import { adSlotHtml, initAdSlots } from "./lib/ads.js";

const app = document.getElementById("app");

function getView() {
  const hash = (location.hash || "#hub").replace("#", "");
  // Support "geoguesser?lobby=XXXX" — extract the base view name
  return hash.split("?")[0];
}

function renderRoute() {
  const view = getView();
  if (view === "geohunt") renderGeoHunt(app);
  else if (view === "silhouette") renderSilhouette(app);
  else if (view === "globle") renderGlobleGame(app);
  else if (view === "geoguesser") renderGeoGuesser(app);
  else {
    app.innerHTML = `
    ${topbar()}
    <div class="hero">
      <h2>Kies een spel</h2>
      <p>Vier manieren om je aardrijkskundekennis te testen: los een landenraster op, herken een land aan zijn vorm, vind het mysterieland op de wereldbol, of raad waar op aarde een straatfoto genomen is.</p>
    </div>
    <div class="cards">
      <div class="card" onclick="go('geohunt')">
        <span class="tag">Raster</span>
        <span class="icon">🧩</span>
        <h3>GeoHunt</h3>
        <p>Vul het 3×3-raster met landen die aan de rij- én kolomcriteria voldoen. Elk land mag maar één keer gebruikt worden — hoe zeldzamer je antwoord, hoe meer punten.</p>
      </div>
      <div class="card" onclick="go('silhouette')">
        <span class="tag">Silhouet</span>
        <span class="icon">🗺️</span>
        <h3>Vorm Raden</h3>
        <p>Alleen de omtrek van een land is zichtbaar. Raad welk land het is — elke gok geeft de afstand en richting naar het juiste antwoord.</p>
      </div>
      <div class="card" onclick="go('globle')">
        <span class="tag">Wereldbol</span>
        <span class="icon">🌐</span>
        <h3>GlobeGuess</h3>
        <p>Raad het mysterieland op de wereldbol. Elke gok kleurt in hoe dichtbij je zit — hoe donkerder, hoe dichter je bij het juiste land bent.</p>
      </div>
      <div class="card" onclick="go('geoguesser')">
        <span class="tag">Straatfoto</span>
        <span class="icon">📍</span>
        <h3>GeoGuesser</h3>
        <p>Een echte straatfoto verschijnt — plaats je pin op de kaart en zie hoe dichtbij je zat. 5 rondes, net als het origineel.</p>
      </div>
    </div>
    ${adSlotHtml("hubFooter")}
  `;
  }
  initAdSlots();
}

window.go = function (view) {
  location.hash = view;
};

window.addEventListener("hashchange", renderRoute);
renderRoute();
ensureProfileWidget();