function apiUrl(language, parameters) {
  const query = new URLSearchParams({ ...parameters, format: "json", origin: "*" });
  return `https://${language || "en"}.wikipedia.org/w/api.php?${query}`;
}

async function request(language, parameters) {
  const response = await fetch(apiUrl(language, parameters));
  if (!response.ok) throw new Error(`Wikipedia request failed (${response.status})`);
  return response.json();
}

export async function fetchWikiRandom(language) {
  const data = await request(language, { action: "query", list: "random", rnnamespace: "0", rnlimit: "10" });
  const titles = (data.query?.random || []).map((entry) => entry.title);
  if (!titles.length) throw new Error("No random article found");
  if (titles.length === 1) return titles[0];

  try {
    const info = await request(language, { action: "query", prop: "info", titles: titles.join("|") });
    const pages = Object.values(info.query?.pages || {}).sort((a, b) => (b.length || 0) - (a.length || 0));
    return pages[0]?.title || titles[0];
  } catch {
    return titles[0];
  }
}

export async function fetchWikiSearch(language, query) {
  if (!query) return [];
  const data = await request(language, { action: "opensearch", search: query, limit: "6", namespace: "0" });
  return data[1] || [];
}

export async function fetchWikiPage(language, title) {
  const data = await request(language, { action: "parse", page: title, redirects: "1", prop: "text" });
  if (data.error) throw new Error(data.error.info);
  return { title: data.parse.title, html: data.parse.text["*"] };
}

export async function fetchWikiIntro(language, title) {
  const data = await request(language, { action: "query", prop: "extracts", exintro: "1", explaintext: "1", redirects: "1", titles: title });
  const page = Object.values(data.query?.pages || {})[0];
  if (!page || page.missing !== undefined) throw new Error("Article not found");
  return (page.extract || "").trim();
}

export async function fetchWikiPreviewInfo(language, title) {
  if (!title) return null;
  try {
    const data = await request(language, {
      action: "query",
      prop: "extracts|pageimages",
      exintro: "1",
      explaintext: "1",
      piprop: "thumbnail",
      pithumbsize: "300",
      redirects: "1",
      titles: title,
    });
    const page = Object.values(data.query?.pages || {})[0];
    if (!page || page.missing !== undefined) return null;
    return { extract: (page.extract || "").trim(), thumbnail: page.thumbnail?.source || null };
  } catch {
    return null;
  }
}

export async function resolveWikiTitle(language, title) {
  try {
    const data = await request(language, { action: "query", redirects: "1", titles: title });
    return Object.values(data.query?.pages || {})[0]?.title || title;
  } catch {
    return title;
  }
}

