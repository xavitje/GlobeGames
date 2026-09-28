export function hashStringToSeed(value) {
  let hash = 1779033703 ^ value.length;
  for (let index = 0; index < value.length; index++) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 3432918353);
    hash = (hash << 13) | (hash >>> 19);
  }
  return hash >>> 0;
}

export function mulberry32(seed) {
  let state = seed >>> 0;
  return function random() {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function getDailyKey(date = new Date()) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

export function getDailyResult() {
  try {
    const raw = localStorage.getItem("gg_daily_" + getDailyKey());
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function saveDailyResult(result) {
  try { localStorage.setItem("gg_daily_" + getDailyKey(), JSON.stringify(result)); } catch {}
}

export function dailyDayNumber() {
  const epoch = Date.UTC(2026, 0, 1);
  return Math.max(1, Math.floor((Date.now() - epoch) / 86400000) + 1);
}

export function buildDailyShareText(result) {
  const blocks = result.history.map((round) => round.pts >= 4500 ? "🟩" : round.pts >= 2500 ? "🟨" : "🟥").join("");
  return `GlobeGames Daily #${dailyDayNumber()} — ${result.totalScore}/${result.rounds * 5000} pts\n${blocks}\n${location.origin}/geoguesser`;
}

export function scoreForDistance(km) {
  if (km < 20) return 5000;
  return Math.max(0, Math.round(5000 * Math.exp(-km / 2000)));
}

export function getStreakBest() {
  try { return parseInt(localStorage.getItem("gg_streak_best") || "0", 10) || 0; }
  catch { return 0; }
}

export function setStreakBest(value) {
  try { localStorage.setItem("gg_streak_best", String(value)); } catch {}
}
