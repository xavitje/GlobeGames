const GOOGLE_MAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_KEY || "";

let loaderPromise = null;

export function hasGoogleMapsKey() {
  return !!GOOGLE_MAPS_KEY;
}

export function loadGoogleMaps() {
  if (window.google && window.google.maps)
    return Promise.resolve(window.google.maps);
  if (loaderPromise) return loaderPromise;
  loaderPromise = new Promise((resolve, reject) => {
    const cbName = "__ggGoogleMapsCallback";
    window[cbName] = () => {
      delete window[cbName];
      resolve(window.google.maps);
    };
    const script = document.createElement("script");
    // loading=async is Google's recommended loading pattern; without it the
    // API can block/serialize its own startup work, which is likely what
    // caused the slow "black world" first-load.
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(GOOGLE_MAPS_KEY)}&v=weekly&loading=async&callback=${cbName}`;
    script.async = true;
    script.onerror = () => reject(new Error("Kon Google Maps niet laden"));
    document.head.appendChild(script);
  });
  return loaderPromise;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Looks for a real Street View panorama near (lat, lng), trying growing radii.
// Rejects panoramas with no navigable links: those are dead-end/enclosed spots
// (courtyards, building interiors Google mislabels as outdoor, private
// driveways, etc.) where the player can't move and has no clues at all.
export async function findNearbyPanorama(maps, lat, lng, { minLinks = 2 } = {}) {
  // Een hele kleine jitter (ongeveer 50-100 meter) om exact op de marker/indoor spawns te vermijden
  const jitterLat = (Math.random() - 0.5) * 0.001;
  const jitterLng = (Math.random() - 0.5) * 0.001;
  const searchLat = lat + jitterLat;
  const searchLng = lng + jitterLng;

  const sv = new maps.StreetViewService();
  const result = await new Promise((resolve) => {
    sv.getPanorama(
      {
        location: { lat: searchLat, lng: searchLng },
        radius: 5000,
        source: maps.StreetViewSource.OUTDOOR,
      },
      (data, status) => {
        const isOfficial = data && data.copyright && data.copyright.includes("Google");
        if (
          status === maps.StreetViewStatus.OK &&
          data &&
          data.location &&
          (data.links ? data.links.length : 0) >= minLinks &&
          isOfficial
        ) {
          resolve({
            lat: data.location.latLng.lat(),
            lng: data.location.latLng.lng(),
            pano: data.location.pano,
          });
        } else {
          resolve(null);
        }
      },
    );
  });
  return result;
}

// weightedRandomPointFn() -> { country, lat, lon }
export async function findStreetViewRound(
  maps,
  weightedRandomPointFn,
  attempts = 10,
) {
  for (let i = 0; i < attempts; i++) {
    const p = weightedRandomPointFn();
    const found = await findNearbyPanorama(maps, p.lat, p.lon);
    if (found) return { ...found, countryHint: p.country };
    await sleep(60);
  }
  return null;
}

export function createPanorama(maps, el, { lat, lng, pano }, options = {}) {
  const { noMove = false, noPan = false, noZoom = false } = options;
  const panoOptions = {
    pano: pano || undefined,
    pov: { heading: Math.random() * 360, pitch: 0 },
    zoom: 0,
    addressControl: false,
    fullscreenControl: false,
    motionTracking: false,
    motionTrackingControl: false,
    showRoadLabels: false,
    // "Niet bewegen" difficulty: hide the walking arrows and disable click-to-walk
    linksControl: !noMove,
    clickToGo: !noMove,
    // "Niet rondkijken" (NMPZ)
    panControl: !noPan,
    zoomControl: !noZoom,
    scrollwheel: !noZoom,
    disableDoubleClickZoom: noZoom,
    enableCloseUp: false,
  };
  
  // position is only needed if there's no pano ID
  if (pano == null && lat != null && lng != null) panoOptions.position = { lat, lng };
  const panorama = new maps.StreetViewPanorama(el, panoOptions);
  
  if (!noMove) warmNeighboringPanoramas(maps, panorama);

  // Zorg dat je echt niet kunt slepen (pannen) in NMPZ
  if (noPan) {
    panorama.setOptions({ gestureHandling: "none" });
  }

  return panorama;
}

// Quietly asks Google for the panoramas one step away in every direction the
// player could walk. This doesn't put anything in our own cache (Google
// controls that), but it does warm up the connection/DNS/TLS and lets
// Google's own CDN start working on those tiles before the player actually
// clicks, so the next step tends to feel snappier.
function warmNeighboringPanoramas(maps, panorama) {
  // Disabled: fetching all neighboring panoramas on every movement causes API lag
  // and connection limits to be hit, resulting in slow movement.
}
