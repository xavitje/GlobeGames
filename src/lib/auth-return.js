const KEY = "globegames_auth_return";
const ALLOWED_ROOTS = new Set(["account", "geoguesser", "wikispeedrun"]);

export function sanitizeReturnTo(value) {
  if (!value || typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return "";
  try {
    const url = new URL(value, "https://globegames.local");
    const root = url.pathname.split("/").filter(Boolean)[0];
    if (url.origin !== "https://globegames.local" || !ALLOWED_ROOTS.has(root) || url.pathname === "/account") return "";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "";
  }
}

export function accountSignInPath(returnTo) {
  const safe = sanitizeReturnTo(returnTo);
  return safe ? `/account?returnTo=${encodeURIComponent(safe)}` : "/account";
}

export function rememberAuthReturn(returnTo) {
  const safe = sanitizeReturnTo(returnTo);
  try {
    if (safe) sessionStorage.setItem(KEY, safe);
    else sessionStorage.removeItem(KEY);
  } catch {}
  return safe;
}

export function pendingAuthReturn() {
  const queryValue = new URLSearchParams(location.search).get("returnTo");
  const fromQuery = sanitizeReturnTo(queryValue);
  if (fromQuery) rememberAuthReturn(fromQuery);
  try { return fromQuery || sanitizeReturnTo(sessionStorage.getItem(KEY)); }
  catch { return fromQuery; }
}

export function takeAuthReturn() {
  const destination = pendingAuthReturn();
  try { sessionStorage.removeItem(KEY); } catch {}
  return destination;
}
