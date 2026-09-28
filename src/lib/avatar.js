import { icon } from "../core.js";
import { escapeHtml } from "./html.js";

export const AVATAR_PRESETS = [
  { id: "atlas", label: "Atlas", icon: "globe", from: "#8176ff", to: "#3047a8" },
  { id: "navigator", label: "Navigator", icon: "map", from: "#48c6ef", to: "#2769b7" },
  { id: "trailblazer", label: "Trailblazer", icon: "pin", from: "#ff9d66", to: "#bf465f" },
  { id: "summit", label: "Summit", icon: "flag", from: "#54d89b", to: "#167a68" },
  { id: "champion", label: "Champion", icon: "trophy", from: "#f5c96b", to: "#a66a24" },
  { id: "orbit", label: "Orbit", icon: "refresh", from: "#b67dff", to: "#5d3bac" },
];

export function normalizeAvatar(value) {
  return value === "google" || AVATAR_PRESETS.some((item) => item.id === value) ? value : "atlas";
}

export function avatarHtml({ avatar, avatarUrl, name, className = "" }) {
  const selected = normalizeAvatar(avatar);
  const classes = `account-avatar account-profile-image ${className}`.trim();
  if (selected === "google" && avatarUrl) {
    return `<span class="${classes} account-avatar-photo"><img src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(name || "Profile")}"></span>`;
  }
  const preset = AVATAR_PRESETS.find((item) => item.id === selected) || AVATAR_PRESETS[0];
  return `<span class="${classes}" style="--avatar-from:${preset.from};--avatar-to:${preset.to}">${icon(preset.icon, { size: "lg" })}</span>`;
}
