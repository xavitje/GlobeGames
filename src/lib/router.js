export class AppRouter {
  constructor({ root, routes, renderHome, renderLoading, renderError, setTitle }) {
    this.root = root;
    this.routes = routes;
    this.renderHome = renderHome;
    this.renderLoading = renderLoading;
    this.renderError = renderError;
    this.setTitle = setTitle;
    this.lastPathname = null;
    this.routeVersion = 0;
    this.activeCleanup = null;
    // A same-page anchor jump (e.g. a WikiSpeedrun footnote "^" back-
    // reference) fires a native popstate event too, even though only the
    // #hash changed and the pathname is identical. Forcing a re-render
    // here destroyed in-progress, non-URL-encoded page state (like an
    // active run) on every such click. Real back/forward navigation
    // always changes the pathname, and render()'s own
    // `lastPathname === location.pathname` check already re-renders for
    // that case — so force=true isn't needed here at all.
    this.handlePopState = () => this.render();
    this.handleLinkClick = (event) => {
      if (event.defaultPrevented) return;
      const link = event.target.closest("a[href]");
      if (!link || link.target || link.hasAttribute("download")) return;
      const url = new URL(link.href, location.href);
      if (url.origin !== location.origin) return;
      // A same-page anchor jump (only the #hash differs, e.g. a footnote
      // "^" back-reference inside a WikiSpeedrun article) isn't a route
      // change — let the browser handle it natively. Otherwise this forced
      // a full re-render of the current route on every such click, which
      // for a page holding in-progress, non-URL-encoded state (like an
      // active WikiSpeedrun run) meant losing that state and getting
      // bounced back to the game's menu.
      if (url.pathname === location.pathname && url.search === location.search && url.hash) return;
      event.preventDefault();
      this.navigate(`${url.pathname}${url.search}${url.hash}`);
    };
  }

  start() {
    window.addEventListener("popstate", this.handlePopState);
    document.addEventListener("click", this.handleLinkClick);
    return this.render();
  }

  navigate(path) {
    if (`${location.pathname}${location.search}${location.hash}` !== path) {
      history.pushState(null, "", path);
    }
    return this.render(true);
  }

  invalidate() {
    this.lastPathname = null;
  }

  // A game screen (e.g. WikiSpeedrun/GeoGuesser moving between in-run
  // articles or rounds) reflects its state in the URL with
  // history.replaceState for shareable/bookmarkable links, without that
  // being an actual route change. The router has no other way to learn
  // this happened, so without this call its bookkeeping (`lastPathname`)
  // silently falls out of sync with the real URL. Once that happens, ANY
  // later popstate — including one fired by a same-page anchor click, like
  // a footnote "^" or a table-of-contents link — looks like a genuine
  // navigation to a different page and triggers a full destructive
  // re-render of the route (losing the in-progress run). Games call this
  // right after their own history.replaceState to keep the router's
  // bookkeeping accurate.
  syncPath() {
    this.lastPathname = location.pathname;
  }

  cleanup() {
    this.activeCleanup?.();
    this.activeCleanup = null;
  }

  async render(force = false) {
    if (!force && this.lastPathname === location.pathname) return;
    this.lastPathname = location.pathname;
    const version = ++this.routeVersion;
    this.cleanup();
    const [name, ...segments] = location.pathname.split("/").filter(Boolean);

    if (!name) {
      this.renderHome(this.root);
      this.setTitle(null);
      return;
    }

    const route = this.routes[name];
    if (!route) {
      history.replaceState(null, "", "/");
      this.lastPathname = null;
      return this.render();
    }

    this.renderLoading(this.root);
    try {
      const page = await route(segments);
      if (version !== this.routeVersion) return;
      await page.mount(this.root);
      if (version !== this.routeVersion) {
        page.cleanup?.();
        return;
      }
      this.activeCleanup = page.cleanup || null;
      this.setTitle(name);
    } catch (error) {
      console.error(error);
      if (version === this.routeVersion) this.renderError(this.root, error);
    }
  }
}

