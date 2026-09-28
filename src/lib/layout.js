import { icon } from "../core.js";
import { getLanguage, t } from "./i18n.js";

export function appHeader({ compact = false } = {}) {
  const lang = getLanguage();
  return `<header class="atlas-header${compact ? " atlas-header-compact" : ""}">
    <a class="atlas-brand" href="/" onclick="event.preventDefault();go('hub')" aria-label="GlobeGames home">
      <span class="atlas-brand-object">${icon("globe", { size: "sm" })}</span>
      <span>Globe<span>Games</span></span>
    </a>
    <nav class="atlas-main-nav" aria-label="Main navigation">
      <a href="/" onclick="event.preventDefault();go('hub')">${t("games")}</a>
      <a href="/geoguesser" onclick="event.preventDefault();go('geoguesser')">${t("daily")}</a>
    </nav>
    <div class="atlas-header-actions">
      <button class="atlas-language" type="button" onclick="ggToggleLanguage()" aria-label="${lang === "en" ? "Switch to Dutch" : "Schakel naar Engels"}">
        <span class="${lang === "en" ? "active" : ""}">EN</span><span class="${lang === "nl" ? "active" : ""}">NL</span>
      </button>
      <a class="atlas-account-link" href="/account" onclick="event.preventDefault();go('account')">${icon("user", { size: "sm" })}<span>${t("account")}</span></a>
    </div>
  </header>`;
}

export function topbar() {
  return `${appHeader({ compact: true })}<div class="game-back-row"><a class="navbtn" href="/" onclick="event.preventDefault();go('hub')">${icon("chevronLeft", { size: "sm" })}<span>${t("backToGames")}</span></a></div>`;
}
