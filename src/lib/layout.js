import { icon } from "../core.js";
import { getLanguage, t } from "./i18n.js";
import { getProfile } from "./profile.js";
import { avatarHtml } from "./avatar.js";

export function appHeader({ compact = false } = {}) {
  const lang = getLanguage();
  const profile = getProfile();
  return `<header class="atlas-header${compact ? " atlas-header-compact" : ""}">
    <a class="atlas-brand" href="/" aria-label="GlobeGames home">
      <span class="atlas-brand-object">${icon("globe", { size: "sm" })}</span>
      <span>Globe<span>Games</span></span>
    </a>
    <nav class="atlas-main-nav" aria-label="Main navigation">
      <a href="/">${t("games")}</a>
      <a href="/geoguesser/daily">${t("daily")}</a>
    </nav>
    <div class="atlas-header-actions">
      <button class="atlas-language" type="button" data-language-toggle aria-label="${lang === "en" ? "Switch to Dutch" : "Schakel naar Engels"}">
        <span class="${lang === "en" ? "active" : ""}">EN</span><span class="${lang === "nl" ? "active" : ""}">NL</span>
      </button>
      <a class="atlas-account-link" href="/account">${profile.name ? avatarHtml({ ...profile, name: profile.name, className: "mini" }) : icon("user", { size: "sm" })}<span>${t("account")}</span></a>
    </div>
  </header>`;
}

export function topbar() {
  return `${appHeader({ compact: true })}<div class="game-back-row"><a class="navbtn" href="/">${icon("chevronLeft", { size: "sm" })}<span>${t("backToGames")}</span></a></div>`;
}
