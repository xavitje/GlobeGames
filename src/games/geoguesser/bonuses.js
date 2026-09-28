const POWERUPS = ["hint", "shield", "5050"];
const SABOTAGES = ["fakehint", "ink", "spin"];

const LABELS = {
  hint: ["Country hint", "Landhint"],
  shield: ["Shield", "Schild"],
  "5050": ["50/50", "50/50"],
  fakehint: ["False hint", "Valse hint"],
  ink: ["Blackout", "Inktvlek"],
  spin: ["Disorient", "Desoriënteer"],
};

export function randomPowerup(random = Math.random) {
  return POWERUPS[Math.floor(random() * POWERUPS.length)];
}

export function randomSabotage(random = Math.random) {
  return SABOTAGES[Math.floor(random() * SABOTAGES.length)];
}

export function bonusLabel(type, language = "en") {
  const labels = LABELS[type] || [type, type];
  return language === "nl" ? labels[1] : labels[0];
}

