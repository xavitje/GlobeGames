// Niet-storende Google AdSense-advertenties. Elke plek in de app heeft zijn
// eigen advertentie-eenheid (responsief, dus nooit groter dan de ruimte die
// ervoor is), en advertenties staan nooit tijdens actief spelen (bv. nooit
// tijdens een lopende GeoGuesser-ronde) — alleen op rustmomenten: start-,
// instellingen-, resultaten-/eind- en lobby-wachtschermen.

const AD_CLIENT = "ca-pub-9333149556787565";

// key -> AdSense data-ad-slot ID. Vul de "null"-waarden aan zodra de
// bijbehorende eenheid is aangemaakt in AdSense (Advertenties > Op
// advertenties gebaseerde eenheid > Display-advertenties > Responsief).
const AD_SLOTS = {
  hubFooter: null, // Hub - footer
  geohuntBoard: null, // GeoHunt - onder raster / na afloop
  silhouetteList: null, // VormRaden - onder gokkenlijst
  globleEnd: null, // GlobeGuess - eindscherm
  geoguesserSettings: null, // GeoGuesser - start-/instellingenscherm
  geoguesserResults: null, // GeoGuesser - resultaten/eindscherm
  geoguesserLobby: null, // GeoGuesser - lobby-wachtscherm
};

// Geeft de HTML voor een advertentieblok terug voor de gegeven plek, of een
// lege string zolang de slot-ID nog niet is ingevuld — dan verschijnt er
// simpelweg niets, in plaats van een kapotte/lege advertentie.
export function adSlotHtml(key) {
  const slot = AD_SLOTS[key];
  if (!slot) return "";
  return `
    <div class="ad-slot">
      <ins class="adsbygoogle"
        style="display:block"
        data-ad-client="${AD_CLIENT}"
        data-ad-slot="${slot}"
        data-ad-format="auto"
        data-full-width-responsive="true"></ins>
    </div>`;
}

// Roep dit aan nadat HTML met .adsbygoogle-elementen in de DOM is gezet
// (dus na app.innerHTML = ...). AdSense scant de pagina alleen automatisch
// bij het eerste laden, niet bij latere innerHTML-updates — zonder deze
// aanroep blijft een nieuw ad-blok leeg.
export function initAdSlots() {
  document.querySelectorAll("ins.adsbygoogle:not([data-ad-status])").forEach(() => {
    try {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    } catch (e) {}
  });
}
