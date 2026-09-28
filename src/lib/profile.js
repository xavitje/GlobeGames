import { PLAYER_COLORS } from "../core.js";
import { normalizeAvatar } from "./avatar.js";

const KEY = "gg_profile";
const USER_KEY = "gg_profile_user_id";
const COLORS = PLAYER_COLORS;

export function getProfile() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw);
      return { name: p.name || "", color: p.color || COLORS[0], avatar: normalizeAvatar(p.avatar), avatarUrl: p.avatarUrl || "" };
    }
  } catch (e) {}
  return { name: "", color: COLORS[0], avatar: "atlas", avatarUrl: "" };
}

export function saveProfile(profile) {
  try {
    localStorage.setItem(KEY, JSON.stringify(profile));
  } catch (e) {}
}

export function syncProfileFromSession(session) {
  const user = session?.user;
  if (!user) return getProfile();
  const metadata = user.user_metadata || {};
  const accountName = metadata.display_name
    || metadata.full_name
    || metadata.name
    || user.email?.split("@")[0]
    || "";
  const current = getProfile();
  let previousUserId = "";
  try { previousUserId = localStorage.getItem(USER_KEY) || ""; } catch {}

  // Keep lobby edits for the current account, but adopt the name when accounts change.
  const next = {
    name: previousUserId === user.id && current.name ? current.name : accountName,
    color: metadata.color || current.color,
    avatar: normalizeAvatar(metadata.avatar || (previousUserId === user.id && current.avatar) || (metadata.avatar_url ? "google" : "atlas")),
    avatarUrl: metadata.avatar_url || metadata.picture || current.avatarUrl || "",
  };
  saveProfile(next);
  try { localStorage.setItem(USER_KEY, user.id); } catch {}
  return next;
}
