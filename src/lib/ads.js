// Ads only appear on menus, lobbies and result screens.

const AD_CLIENT = "ca-pub-9333149556787565";

// Map placements to their responsive AdSense slot IDs.
const AD_SLOTS = {
  hubFooter: "4584376671", // Hub - footer
  geohuntBoard: "5501961816", // GeoHunt - onder raster / na afloop
  silhouetteList: "7224263716", // VormRaden - onder gokkenlijst
  globleEnd: "9630935201", // GlobeGuess - eindscherm
  geoguesserSettings: "7789124517", // GeoGuesser - start-/instellingenscherm
  geoguesserResults: "5079200691", // GeoGuesser - resultaten/eindscherm
  geoguesserLobby: "2640739610", // GeoGuesser - lobby-wachtscherm
};

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

// Initialize ad nodes added after client-side navigation.
export function initAdSlots() {
  document.querySelectorAll("ins.adsbygoogle:not([data-ad-status])").forEach(() => {
    try {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    } catch (e) {}
  });
}
