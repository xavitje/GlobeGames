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
    this.handlePopState = () => this.render(true);
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

