import { PLAYER_COLORS, icon } from "./core.js";
import { appHeader } from "./lib/layout.js";
import { getLanguage, pick, setLanguage } from "./lib/i18n.js";
import {
  getSession,
  hasAuthConfig,
  signInWithEmail,
  signInWithGoogle,
  signOut,
  signUpWithEmail,
  updateAccount,
} from "./lib/auth.js";
import { getProfile, saveProfile, syncProfileFromSession } from "./lib/profile.js";
import { AVATAR_PRESETS, avatarHtml, normalizeAvatar } from "./lib/avatar.js";
import { pendingAuthReturn, rememberAuthReturn, takeAuthReturn } from "./lib/auth-return.js";

let root = null;
let session = null;
let authMode = "signin";
let settingsSection = "profile";

const esc = (value) => String(value || "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[char]));

function userName() {
  return session?.user?.user_metadata?.display_name
    || session?.user?.user_metadata?.full_name
    || getProfile().name
    || session?.user?.email?.split("@")[0]
    || "Explorer";
}

function userColor() {
  return session?.user?.user_metadata?.color || getProfile().color || PLAYER_COLORS[0];
}

function userAvatar() {
  return normalizeAvatar(session?.user?.user_metadata?.avatar || getProfile().avatar);
}

function userAvatarUrl() {
  return session?.user?.user_metadata?.avatar_url || session?.user?.user_metadata?.picture || getProfile().avatarUrl || "";
}

function continueAfterAuth() {
  const destination = takeAuthReturn();
  if (!destination) return false;
  location.replace(destination);
  return true;
}

export async function renderAccount(container) {
  root = container;
  root.innerHTML = `${appHeader()}<div class="account-loading"><span class="atlas-loader"></span>${pick("Loading your account…", "Je account laden…")}</div>`;
  try {
    session = await getSession();
    if (session) {
      syncProfileFromSession(session);
      if (continueAfterAuth()) return;
    }
  } catch { session = null; }
  draw();
}

function draw() {
  if (!root) return;
  root.innerHTML = `${appHeader()}${session ? settingsHtml() : authHtml()}`;
  if (session) wireSettings(); else wireAuth();
}

function authHtml() {
  const configured = hasAuthConfig();
  const signUp = authMode === "signup";
  return `<main class="account-auth-shell">
    <section class="account-value">
      <span class="atlas-overline">${pick("YOUR GLOBEGAMES ACCOUNT", "JOUW GLOBEGAMES-ACCOUNT")}</span>
      <h1>${pick("Keep every score, streak and friendship.", "Bewaar iedere score, reeks en vriendschap.")}</h1>
      <p>${pick("Sign in once and continue on any device. Your public player identity and private preferences stay in one place.", "Log één keer in en speel verder op ieder apparaat. Je openbare spelersprofiel en privévoorkeuren blijven op één plek.")}</p>
      <div class="account-benefits">
        <article>${icon("trophy", { size: "sm" })}<span><strong>${pick("Progress that travels", "Voortgang die meegaat")}</strong><small>${pick("Records and daily streaks across devices.", "Records en dagelijkse reeksen op ieder apparaat.")}</small></span></article>
        <article>${icon("users", { size: "sm" })}<span><strong>${pick("A real player identity", "Een echte spelersidentiteit")}</strong><small>${pick("Join friends and lobbies with one profile.", "Speel met vrienden en lobby's vanuit één profiel.")}</small></span></article>
        <article>${icon("gear", { size: "sm" })}<span><strong>${pick("Settings in one place", "Instellingen op één plek")}</strong><small>${pick("Language, privacy, colour and accessibility.", "Taal, privacy, kleur en toegankelijkheid.")}</small></span></article>
      </div>
    </section>
    <section class="account-auth-panel">
      <div class="account-panel-heading"><span>${signUp ? pick("CREATE ACCOUNT", "ACCOUNT MAKEN") : pick("WELCOME BACK", "WELKOM TERUG")}</span><h2>${signUp ? pick("Start exploring", "Begin met ontdekken") : pick("Sign in to continue", "Log in om verder te gaan")}</h2></div>
      ${configured ? "" : `<div class="account-config-note" role="status">${pick("Authentication is not configured. Add the Supabase environment variables to enable sign-in.", "Authenticatie is niet ingesteld. Voeg de Supabase-omgevingsvariabelen toe om inloggen te activeren.")}</div>`}
      <button class="account-google" type="button" id="accountGoogle" ${configured ? "" : "disabled"}><span>G</span>${pick("Continue with Google", "Doorgaan met Google")}</button>
      <div class="account-divider"><span>${pick("or with email", "of met e-mail")}</span></div>
      <form id="accountAuthForm">
        ${signUp ? `<label>${pick("Display name", "Weergavenaam")}<input id="accountName" autocomplete="name" maxlength="30" required placeholder="${pick("How other players see you", "Hoe andere spelers je zien")}"></label>` : ""}
        <label>${pick("Email address", "E-mailadres")}<input id="accountEmail" type="email" autocomplete="email" required placeholder="you@example.com"></label>
        <label>${pick("Password", "Wachtwoord")}<input id="accountPassword" type="password" autocomplete="${signUp ? "new-password" : "current-password"}" minlength="8" required placeholder="${pick("At least 8 characters", "Minimaal 8 tekens")}"></label>
        <div class="account-form-message" id="accountMessage" aria-live="polite"></div>
        <button class="account-primary" type="submit" ${configured ? "" : "disabled"}>${signUp ? pick("Create account", "Account maken") : pick("Sign in", "Inloggen")}${icon("chevronRight", { size: "sm" })}</button>
      </form>
      <p class="account-switch">${signUp ? pick("Already have an account?", "Heb je al een account?") : pick("New to GlobeGames?", "Nieuw bij GlobeGames?")} <button type="button" id="accountMode">${signUp ? pick("Sign in", "Inloggen") : pick("Create account", "Account maken")}</button></p>
    </section>
  </main>`;
}

function wireAuth() {
  document.getElementById("accountMode")?.addEventListener("click", () => {
    authMode = authMode === "signin" ? "signup" : "signin";
    draw();
  });
  document.getElementById("accountGoogle")?.addEventListener("click", async () => {
    setBusy(true);
    rememberAuthReturn(pendingAuthReturn());
    try { await signInWithGoogle(); } catch (error) { showAuthMessage(error.message, true); setBusy(false); }
  });
  document.getElementById("accountAuthForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = document.getElementById("accountEmail").value.trim();
    const password = document.getElementById("accountPassword").value;
    const name = document.getElementById("accountName")?.value.trim();
    setBusy(true);
    try {
      const result = authMode === "signup"
        ? await signUpWithEmail(email, password, name)
        : await signInWithEmail(email, password);
      session = result.session || await getSession();
      if (!session && authMode === "signup") {
        showAuthMessage(pick("Check your inbox to confirm your email address.", "Controleer je inbox om je e-mailadres te bevestigen."));
        setBusy(false);
      } else {
        syncProfileFromSession(session);
        if (!continueAfterAuth()) draw();
      }
    } catch (error) {
      showAuthMessage(error.message, true);
      setBusy(false);
    }
  });
}

function setBusy(busy) {
  root.querySelectorAll("button, input").forEach((element) => { element.disabled = busy; });
}

function showAuthMessage(message, error = false) {
  const element = document.getElementById("accountMessage");
  if (!element) return;
  element.textContent = message;
  element.classList.toggle("error", error);
}

function settingsHtml() {
  const name = userName();
  const color = userColor();
  const avatar = userAvatar();
  const avatarUrl = userAvatarUrl();
  const lang = getLanguage();
  return `<main class="account-settings-shell">
    <section class="account-settings-head">
      <div id="accountHeaderAvatar">${avatarHtml({ avatar, avatarUrl, name })}</div>
      <div><span class="atlas-overline">${pick("SIGNED IN AS", "INGELOGD ALS")}</span><h1>${esc(name)}</h1><p>${esc(session.user.email)}</p></div>
      <button class="account-secondary" id="accountSignOut" type="button">${pick("Sign out", "Uitloggen")}</button>
    </section>
    <div class="account-settings-grid">
      <aside class="account-settings-nav" aria-label="${pick("Account settings", "Accountinstellingen")}">
        <button type="button" data-settings-section="profile" class="${settingsSection === "profile" ? "active" : ""}">${icon("user", { size: "sm" })}${pick("Profile", "Profiel")}</button>
        <button type="button" data-settings-section="security" class="${settingsSection === "security" ? "active" : ""}">${icon("lockClosed", { size: "sm" })}${pick("Account & security", "Account & beveiliging")}</button>
        <button type="button" data-settings-section="preferences" class="${settingsSection === "preferences" ? "active" : ""}">${icon("gear", { size: "sm" })}${pick("Game preferences", "Spelvoorkeuren")}</button>
      </aside>
      <section class="account-settings-panel">
        <div class="settings-pane ${settingsSection === "profile" ? "active" : ""}" data-settings-pane="profile">
          <div class="settings-section-heading"><div><h2>${pick("Public profile", "Openbaar profiel")}</h2><p>${pick("This is how other players see you in lobbies and leaderboards.", "Zo zien andere spelers je in lobby's en ranglijsten.")}</p></div></div>
          <form id="accountSettingsForm">
          <div class="account-avatar-row"><div id="settingsAvatarPreview">${avatarHtml({ avatar, avatarUrl, name, className: "large" })}</div><div><strong id="settingsProfileName">${esc(name)}</strong><small>${pick("Choose a profile image and player colour.", "Kies een profielfoto en spelerskleur.")}</small></div></div>
          <label>${pick("Display name", "Weergavenaam")}<input id="settingsName" maxlength="18" required value="${esc(name)}"></label>
          <fieldset><legend>${pick("Profile picture", "Profielfoto")}</legend><div class="settings-avatars">
            ${avatarUrl ? `<button type="button" data-avatar="google" class="${avatar === "google" ? "active" : ""}" aria-label="Google profile picture">${avatarHtml({ avatar: "google", avatarUrl, name })}<span>Google</span></button>` : ""}
            ${AVATAR_PRESETS.map((item) => `<button type="button" data-avatar="${item.id}" class="${avatar === item.id ? "active" : ""}" aria-label="${item.label}">${avatarHtml({ avatar: item.id, name })}<span>${item.label}</span></button>`).join("")}
          </div></fieldset>
          <fieldset><legend>${pick("Player colour", "Spelerskleur")}</legend><div class="settings-colours">${PLAYER_COLORS.map((item) => `<button type="button" aria-label="${item}" data-color="${item}" class="${item === color ? "active" : ""}" style="--swatch:${item}"></button>`).join("")}</div></fieldset>
          <div class="settings-form-footer"><span id="settingsMessage" aria-live="polite"></span><button class="account-primary" type="submit">${pick("Save changes", "Wijzigingen opslaan")}</button></div>
          </form>
        </div>
        <div class="settings-pane ${settingsSection === "security" ? "active" : ""}" data-settings-pane="security">
          <div class="settings-section-heading"><h2>${pick("Account & security", "Account & beveiliging")}</h2><p>${pick("Your sign-in identity and connected provider.", "Je inlogidentiteit en gekoppelde provider.")}</p></div>
          <div class="settings-detail-list"><div><span>${pick("Email address", "E-mailadres")}</span><strong>${esc(session.user.email)}</strong></div><div><span>${pick("Sign-in method", "Inlogmethode")}</span><strong>${esc(session.user.app_metadata?.provider === "google" ? "Google" : pick("Email and password", "E-mail en wachtwoord"))}</strong></div><div><span>${pick("Account created", "Account gemaakt")}</span><strong>${new Date(session.user.created_at).toLocaleDateString(lang)}</strong></div></div>
        </div>
        <div class="settings-pane ${settingsSection === "preferences" ? "active" : ""}" data-settings-pane="preferences">
          <div class="settings-section-heading"><h2>${pick("Game preferences", "Spelvoorkeuren")}</h2><p>${pick("Choose the language used throughout GlobeGames.", "Kies de taal die in heel GlobeGames wordt gebruikt.")}</p></div>
          <form id="accountLanguageForm"><label>${pick("Interface language", "Interfacetaal")}<select id="settingsLanguage"><option value="en" ${lang === "en" ? "selected" : ""}>English</option><option value="nl" ${lang === "nl" ? "selected" : ""}>Nederlands</option></select></label><div class="settings-form-footer"><span id="languageMessage" aria-live="polite"></span><button class="account-primary" type="submit">${pick("Save preference", "Voorkeur opslaan")}</button></div></form>
        </div>
      </section>
    </div>
  </main>`;
}

function wireSettings() {
  let selectedColor = userColor();
  let selectedAvatar = userAvatar();
  const avatarUrl = userAvatarUrl();
  root.querySelectorAll("[data-settings-section]").forEach((button) => {
    button.addEventListener("click", () => {
      settingsSection = button.dataset.settingsSection;
      root.querySelectorAll("[data-settings-section]").forEach((item) => item.classList.toggle("active", item === button));
      root.querySelectorAll("[data-settings-pane]").forEach((pane) => pane.classList.toggle("active", pane.dataset.settingsPane === settingsSection));
    });
  });
  document.getElementById("accountSignOut")?.addEventListener("click", async () => {
    await signOut();
    session = null;
    draw();
  });
  root.querySelectorAll(".settings-colours button").forEach((button) => {
    button.addEventListener("click", () => {
      selectedColor = button.dataset.color;
      root.querySelectorAll(".settings-colours button").forEach((item) => item.classList.toggle("active", item === button));
    });
  });
  root.querySelectorAll(".settings-avatars button").forEach((button) => {
    button.addEventListener("click", () => {
      selectedAvatar = button.dataset.avatar;
      root.querySelectorAll(".settings-avatars button").forEach((item) => item.classList.toggle("active", item === button));
      document.getElementById("settingsAvatarPreview").innerHTML = avatarHtml({ avatar: selectedAvatar, avatarUrl, name: document.getElementById("settingsName").value, className: "large" });
    });
  });
  document.getElementById("accountSettingsForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = document.getElementById("settingsName").value.trim();
    const message = document.getElementById("settingsMessage");
    try {
      const user = await updateAccount({ displayName: name, color: selectedColor, avatar: selectedAvatar });
      saveProfile({ name, color: selectedColor, avatar: selectedAvatar, avatarUrl });
      session = { ...session, user };
      message.textContent = pick("Saved", "Opgeslagen") + " ✓";
      document.getElementById("settingsProfileName").textContent = name;
      document.querySelector(".account-settings-head h1").textContent = name;
      document.getElementById("accountHeaderAvatar").innerHTML = avatarHtml({ avatar: selectedAvatar, avatarUrl, name });
    } catch (error) {
      message.textContent = error.message;
      message.classList.add("error");
    }
  });
  document.getElementById("accountLanguageForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const language = document.getElementById("settingsLanguage").value;
    const message = document.getElementById("languageMessage");
    setLanguage(language);
    message.textContent = (language === "nl" ? "Opgeslagen" : "Saved") + " ✓";
    setTimeout(() => location.reload(), 350);
  });
}
