import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { feature } from "topojson-client";
import simplify from "@turf/simplify";
import bbox from "@turf/bbox";
import area from "@turf/area";
import countries10m from "world-atlas/countries-10m.json" with { type: "json" };
import countries50m from "world-atlas/countries-50m.json" with { type: "json" };
import { COUNTRY_DATA } from "../src/data/countries.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, "..", "public");
fs.mkdirSync(outDir, { recursive: true });

const ALIAS = JSON.parse(fs.readFileSync(path.join(__dirname, "name-map.json"), "utf8"));
const OUR_NAMES = Object.keys(COUNTRY_DATA);

function toNamedFeatures(topo) {
  const fc = feature(topo, topo.objects.countries);
  const byUpstreamName = new Map(fc.features.map((f) => [f.properties.name, f]));
  const out = [];
  for (const ourName of OUR_NAMES) {
    const upstreamName = ALIAS[ourName] || ourName;
    const f = byUpstreamName.get(upstreamName);
    if (f) out.push({ ...f, properties: { name: ourName } });
  }
  return out;
}

// A handful of countries (Russia, Fiji, New Zealand, the US via the Aleutians)
// straddle the antimeridian — some of their points sit at ~+179° longitude
// and others, geographically right next door, are stored as ~-179°. As a
// plain list of [lon, lat] pairs (which is all @turf/simplify, @turf/area
// and @turf/bbox see — they don't do spherical geometry) that reads as a
// genuinely huge, self-crossing shape spanning the entire width of the map,
// and comes out corrupted. This can happen two ways, both handled here by
// looking at the antimeridian span across the WHOLE feature at once rather
// than one ring or one polygon part at a time: a single ring can jump from
// +179 to -179 between two adjacent points (Russia), or — Fiji's case — the
// parts can individually stay on one side or the other (some entirely
// ~-179°, others entirely ~+178°) while the feature as a whole still spans
// the seam. Fix: if the feature's overall longitude span is more than 180°,
// it must be wrapping the antimeridian rather than genuinely spanning that
// much of the globe, so shift every negative longitude in it up by 360° —
// e.g. -179 becomes 181 — making the whole feature numerically contiguous.
// d3-geo's projections accept any real-valued longitude and wrap it
// correctly at render time, so this is safe to leave in the shipped data.
function unwrapAntimeridian(f) {
  const geom = f.geometry;
  if (geom.type !== "Polygon" && geom.type !== "MultiPolygon") return f;
  const parts = geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;
  const lons = parts.flat(2).map((p) => p[0]);
  const span = Math.max(...lons) - Math.min(...lons);
  if (span <= 180) return f;
  const shiftRing = (ring) => ring.map(([lon, lat]) => [lon < 0 ? lon + 360 : lon, lat]);
  const shifted = parts.map((poly) => poly.map(shiftRing));
  return { ...f, geometry: { ...geom, coordinates: geom.type === "Polygon" ? shifted[0] : shifted } };
}

function haversineKm([lon1, lat1], [lon2, lat2]) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

function bboxCenter(coords) {
  const [minX, minY, maxX, maxY] = bbox({ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: coords } });
  return [(minX + maxX) / 2, (minY + maxY) / 2];
}

// Drops tiny and/or far-flung outlying polygon parts (specks of rock,
// overseas territories on the other side of the planet) before simplifying.
// This fixes a real bug, not just a visual nicety: @turf/simplify silently
// produces corrupt/self-overlapping geometry for MultiPolygons with a lot of
// parts (seen with Russia [214], Canada [410], the US [346], China [70] —
// anything above roughly 50-100 parts), which then renders as a solid filled
// rectangle instead of a silhouette (that's the "always a square country"
// bug). Countries with few parts (France ~21, Germany ~22) simplified fine
// either way.
//
// Two filters, both relative to the largest part (assumed to be the main
// territory):
// - area: drop anything under 0.5% of the largest part's area. Keeps every
//   country's significant islands (Indonesia, the Philippines, Greece, Japan
//   all still show their full archipelago) while removing the uninhabited
//   dots that were tripping up the simplifier.
// - distance: drop anything over 5000km from the largest part's center, even
//   if it's not tiny. A handful of countries include a whole overseas
//   territory on the other side of the world (French Guiana for France,
//   Bonaire for the Netherlands) that's sizeable enough to pass the area
//   filter, but rendering it next to the mainland just produces two
//   unrelated blobs and — worse — blows up the shared bounding box so much
//   that the actual (recognizable) mainland shrinks to a few invisible
//   pixels. 5000km comfortably keeps genuinely-attached, expected parts of a
//   country's silhouette (Alaska is ~4550km from the mainland US) while
//   dropping the far outliers.
function dropTinyParts(f) {
  if (f.geometry.type !== "MultiPolygon") return f;
  const polys = f.geometry.coordinates;
  const areas = polys.map((coords) =>
    Math.abs(area({ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: coords } })),
  );
  const maxArea = Math.max(...areas);
  const mainCenter = bboxCenter(polys[areas.indexOf(maxArea)]);
  const kept = polys.filter((coords, i) => areas[i] >= maxArea * 0.005 && haversineKm(mainCenter, bboxCenter(coords)) <= 5000);
  // Never end up with zero parts (shouldn't happen: the largest part always
  // passes its own thresholds), but fall back to the original set just in case.
  return { ...f, geometry: { ...f.geometry, coordinates: kept.length ? kept : polys } };
}

function adaptiveSimplify(f, { floor, cap, scale }) {
  const cleaned = dropTinyParts(unwrapAntimeridian(f));
  const [minX, minY, maxX, maxY] = bbox(cleaned);
  const diag = Math.hypot(maxX - minX, maxY - minY);
  const tolerance = Math.min(cap, Math.max(floor, diag * scale));
  try {
    return simplify(cleaned, { tolerance, highQuality: true });
  } catch {
    return cleaned;
  }
}

const world = {
  type: "FeatureCollection",
  features: toNamedFeatures(countries50m).map((f) => adaptiveSimplify(f, { floor: 0.02, cap: 0.35, scale: 0.05 })),
};
fs.writeFileSync(path.join(outDir, "world.json"), JSON.stringify(world));

const worldHD = {
  type: "FeatureCollection",
  features: toNamedFeatures(countries10m).map((f) => adaptiveSimplify(f, { floor: 0.003, cap: 0.06, scale: 0.007 })),
};
fs.writeFileSync(path.join(outDir, "world_hd.json"), JSON.stringify(worldHD));

const missing = OUR_NAMES.filter((n) => !worldHD.features.some((f) => f.properties.name === n));
console.log(
  `[build-geo] world.json: ${world.features.length}/${OUR_NAMES.length} countries, world_hd.json: ${worldHD.features.length}/${OUR_NAMES.length} countries` +
    (missing.length ? ` (missing, falls back to low-res: ${missing.join(", ")})` : ""),
);
