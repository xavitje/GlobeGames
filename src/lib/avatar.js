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
  return value === "google" || value === "custom" || AVATAR_PRESETS.some((item) => item.id === value) ? value : "atlas";
}

// Reads a locally-picked image file, center-crops it to a square, downsizes
// it, and returns a compressed JPEG data: URL — small enough to store inline
// in the account's metadata (no storage bucket / backend needed).
export function compressImageToDataUrl(file, maxSize = 160, quality = 0.82) {
  return new Promise((resolve, reject) => {
    if (!file || !String(file.type || "").startsWith("image/")) {
      reject(new Error("Please choose an image file."));
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      reject(new Error("That image is too large (max 8MB)."));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read that file."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Could not read that image."));
      img.onload = () => {
        try {
          const side = Math.min(img.naturalWidth, img.naturalHeight);
          const sx = (img.naturalWidth - side) / 2;
          const sy = (img.naturalHeight - side) / 2;
          const canvas = document.createElement("canvas");
          canvas.width = maxSize;
          canvas.height = maxSize;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, sx, sy, side, side, 0, 0, maxSize, maxSize);
          resolve(canvas.toDataURL("image/jpeg", quality));
        } catch (e) {
          reject(new Error("Could not process that image."));
        }
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

export function avatarHtml({ avatar, avatarUrl, name, className = "" }) {
  const selected = normalizeAvatar(avatar);
  const classes = `account-avatar account-profile-image ${className}`.trim();
  if ((selected === "google" || selected === "custom") && avatarUrl) {
    return `<span class="${classes} account-avatar-photo"><img src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(name || "Profile")}"></span>`;
  }
  const preset = AVATAR_PRESETS.find((item) => item.id === selected) || AVATAR_PRESETS[0];
  return `<span class="${classes}" style="--avatar-from:${preset.from};--avatar-to:${preset.to}">${icon(preset.icon, { size: "lg" })}</span>`;
}
