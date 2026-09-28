export function cleanName(value: unknown): string {
  const name = String(value || "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 18);
  return name || "Player";
}

export function cleanCode(value: unknown): string {
  return String(value || "").toUpperCase().replace(/[^A-Z2-9]/g, "").slice(0, 6);
}

export function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad;
  const dLng = (bLng - aLng) * rad;
  const value = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

// Same curve as GeoGuessr's world map: 5000 * e^(-d / 1492.7 km), and a
// perfect 5000 only within 25 m. Keep in sync with
// src/games/geoguesser/challenge-utils.js (solo scoring).
export function scoreForDistance(km: number): number {
  if (km <= 0.025) return 5000;
  return Math.max(0, Math.min(4999, Math.round(5000 * Math.exp(-km / 1492.7))));
}

export function rouletteColor(number: number): "red" | "black" | "green" {
  if (number === 0) return "green";
  return [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36].includes(number) ? "red" : "black";
}

export function pickOne<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}
