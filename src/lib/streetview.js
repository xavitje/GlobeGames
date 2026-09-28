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
    // Use Google's async loading mode to avoid blocking the first render.
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

// Reject panoramas without enough navigable exits.
export async function findNearbyPanorama(maps, lat, lng, { minLinks = 2 } = {}) {
  // Offset the search slightly to avoid marker and indoor spawns.
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
    linksControl: !noMove,
    clickToGo: !noMove,
    panControl: !noPan,
    zoomControl: !noZoom,
    scrollwheel: !noZoom,
    disableDoubleClickZoom: noZoom,
    enableCloseUp: false,
  };
  // A position is only needed when no panorama ID is available.
  if (pano == null && lat != null && lng != null) panoOptions.position = { lat, lng };
  const panorama = new maps.StreetViewPanorama(el, panoOptions);

  if (noPan) {
    panorama.setOptions({ gestureHandling: "none" });
  }

  return panorama;
}
