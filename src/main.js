import "./style.css";
import { topbar, icon } from "./core.js";
import { renderGeoHunt } from "./games/geohunt.js";
import { renderSilhouette } from "./games/silhouette.js";
import { renderGlobleGame } from "./games/globle.js";
import { renderGeoGuesser } from "./games/geoguesser.js";
import { renderWikiSpeedrun } from "./games/wikispeedrun.js";
import { ensureProfileWidget } from "./lib/profile.js";
import { adSlotHtml, initAdSlots } from "./lib/ads.js";

const app = document.getElementById("app");

// Echte pad-routing (geen hash meer): "/geoguesser/multiplayer/LFFW" e.d.
// werkt nu als een normale, deelbare/ververbare URL. Op Vercel zorgt
// vercel.json ervoor dat elk pad index.html serveert, zodat deze
// client-side router het daarna overneemt.
function getPathSegments() {
  return location.pathname.split("/").filter(Boolean);
}

function renderRoute() {
  const [view, ...rest] = getPathSegments();
  if (view === "geohunt") renderGeoHunt(app);
  else if (view === "silhouette") renderSilhouette(app);
  else if (view === "globle") renderGlobleGame(app);
  else if (view === "geoguesser") renderGeoGuesser(app, rest);
  else if (view === "wikispeedrun") renderWikiSpeedrun(app, rest);
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
        ${icon("grid", { size: "lg" })}
        <h3>GeoHunt</h3>
        <p>Vul het 3×3-raster met landen die aan de rij- én kolomcriteria voldoen. Elk land mag maar één keer gebruikt worden — hoe zeldzamer je antwoord, hoe meer punten.</p>
      </div>
      <div class="card" onclick="go('silhouette')">
        <span class="tag">Silhouet</span>
        ${icon("chip", { size: "lg" })}
        <h3>Vorm Raden</h3>
        <p>Alleen de omtrek van een land is zichtbaar. Raad welk land het is — elke gok geeft de afstand en richting naar het juiste antwoord.</p>
      </div>
      <div class="card" onclick="go('globle')">
        <span class="tag">Wereldbol</span>
        ${icon("globe", { size: "lg" })}
        <h3>GlobeGuess</h3>
        <p>Raad het mysterieland op de wereldbol. Elke gok kleurt in hoe dichtbij je zit — hoe donkerder, hoe dichter je bij het juiste land bent.</p>
      </div>
      <div class="card" onclick="go('geoguesser')">
        <span class="tag">Straatfoto</span>
        ${icon("pin", { size: "lg" })}
        <h3>GeoGuesser</h3>
        <p>Een echte straatfoto verschijnt — plaats je pin op de kaart en zie hoe dichtbij je zat. 5 rondes, net als het origineel.</p>
      </div>
      <div class="card" onclick="go('wikispeedrun')">
        <span class="tag">Lezen</span>
        ${icon("bookOpen", { size: "lg" })}
        <h3>WikiSpeedrun</h3>
        <p>Race van het startartikel naar het eindartikel. Navigeer enkel door op links te klikken, in zo min mogelijk clicks!</p>
      </div>
    </div>
    ${adSlotHtml("hubFooter")}
  `;
  }
  initAdSlots();
}

// Navigatie tussen spellen (vanaf de hub of de "Alle spellen"-knop): pusht
// een nieuwe geschiedenis-entry zodat de terug-knop weer bij de hub uitkomt,
// net als voorheen met hash-navigatie.
window.go = function (view) {
  history.pushState(null, "", view === "hub" ? "/" : `/${view}`);
  renderRoute();
};

window.addEventListener("popstate", renderRoute);
renderRoute();
ensureProfileWidget();