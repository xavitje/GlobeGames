const ROOT = "/wikispeedrun";

export function wikiLobbyPath(code) {
  return `${ROOT}/multiplayer/${encodeURIComponent(String(code || "").toUpperCase())}`;
}

export function wikiArticlePath(title) {
  const slug = String(title || "").trim().replace(/ /g, "_");
  return `${ROOT}/play/${encodeURIComponent(slug)}`;
}

export function parseWikiRoute(segments = []) {
  if (segments[0] === "multiplayer" && segments[1]) {
    return { type: "lobby", code: decodeURIComponent(segments[1]).toUpperCase() };
  }
  if (segments[0] === "play" && segments[1]) {
    return { type: "article", title: decodeURIComponent(segments.slice(1).join("/")).replace(/_/g, " ") };
  }
  if (segments.length === 1 && segments[0]) {
    return { type: "lobby", code: decodeURIComponent(segments[0]).toUpperCase() };
  }
  return { type: "menu" };
}
