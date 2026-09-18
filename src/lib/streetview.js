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
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(GOOGLE_MAPS_KEY)}&v=weekly&callback=${cbName}`;
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
export async function findNearbyPanorama(maps, lat, lng) {
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
          if (status === maps.StreetViewStatus.OK && data && data.location) {
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

export function createPanorama(maps, el, { lat, lng, pano }) {
  return new maps.StreetViewPanorama(el, {
    position: { lat, lng },
    pano: pano || undefined,
    pov: { heading: Math.random() * 360, pitch: 0 },
    zoom: 0,
    addressControl: false,
    fullscreenControl: false,
    motionTracking: false,
    motionTrackingControl: false,
    showRoadLabels: false,
    linksControl: true,
    panControl: true,
    zoomControl: true,
    clickToGo: true,
  });
}
