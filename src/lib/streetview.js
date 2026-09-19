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
export async function findNearbyPanorama(maps, lat, lng, { minLinks = 1 } = {}) {
  const sv = new maps.StreetViewService();
  const radii = [5000, 20000, 50000];
  for (const radius of radii) {
    const result = await new Promise((resolve) => {
      sv.getPanorama(
        {
          location: { lat, lng },
          radius,
          source: maps.StreetViewSource.OUTDOOR,
        },
        (data, status) => {
          if (
            status === maps.StreetViewStatus.OK &&
            data &&
            data.location &&
            (data.links ? data.links.length : 0) >= minLinks
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
    if (result) return result;
    await sleep(50);
  }
  return null;
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
  const { noMove = false } = options;
  const panorama = new maps.StreetViewPanorama(el, {
    position: { lat, lng },
    pano: pano || undefined,
    pov: { heading: Math.random() * 360, pitch: 0 },
    zoom: 0,
    addressControl: false,
    fullscreenControl: false,
    motionTracking: false,
    motionTrackingControl: false,
    showRoadLabels: false,
    // "Niet bewegen"/NMPZ difficulty: hide the walking arrows and disable
    // click-to-walk, but leave looking around (drag) and zoom intact.
    linksControl: !noMove,
    clickToGo: !noMove,
    panControl: true,
    zoomControl: true,
    // Google normally auto zooms in at intersections when walking, which
    // pulls in extra high-res tiles and is a big part of the "laggy" feel.
    // Keeping the zoom fixed makes movement noticeably snappier.
    enableCloseUp: false,
  });
  if (!noMove) warmNeighboringPanoramas(maps, panorama);
  return panorama;
}

// Quietly asks Google for the panoramas one step away in every direction the
// player could walk. This doesn't put anything in our own cache (Google
// controls that), but it does warm up the connection/DNS/TLS and lets
// Google's own CDN start working on those tiles before the player actually
// clicks, so the next step tends to feel snappier.
function warmNeighboringPanoramas(maps, panorama) {
  const sv = new maps.StreetViewService();
  const warm = () => {
    const links = panorama.getLinks() || [];
    links.forEach((link) => {
      if (!link || !link.pano) return;
      sv.getPanorama({ pano: link.pano }, () => {});
    });
  };
  maps.event.addListener(panorama, "links_changed", warm);
}
