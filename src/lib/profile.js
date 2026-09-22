// Klein lokaal profiel: alleen in deze browser onthouden (localStorage), geen login.
// Zorgt dat je naam niet elke keer opnieuw hoeft te worden ingetypt bij multiplayer.

import { PLAYER_COLORS } from "../core.js";

const KEY = "gg_profile";
const COLORS = PLAYER_COLORS;

export function getProfile() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw);
      return { name: p.name || "", color: p.color || COLORS[0] };
    }
  } catch (e) {}
  return { name: "", color: COLORS[0] };
}

export function saveProfile(profile) {
  try {
    localStorage.setItem(KEY, JSON.stringify(profile));
  } catch (e) {}
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

export function ensureProfileWidget() {
  let el = document.getElementById("gg-profile-widget");
  if (el) el.remove();
  const p = getProfile();
  el = document.createElement("div");
  el.id = "gg-profile-widget";
  el.className = "gg-profile-widget";
  el.innerHTML = `
    <button class="gg-profile-btn" title="Jouw profiel">
      <span class="gg-profile-dot" style="background:${p.color}"></span>
      <span class="gg-profile-name">${p.name ? escapeHtml(p.name) : "Profiel"}</span>
    </button>`;
  el.querySelector(".gg-profile-btn").addEventListener("click", openProfileEditor);
  document.body.appendChild(el);
}

function openProfileEditor() {
  const p = getProfile();
  const overlay = document.createElement("div");
  overlay.className = "gg-profile-overlay";
  overlay.innerHTML = `
    <div class="gg-profile-modal">
      <h3>Jouw profiel</h3>
      <label>Naam</label>
      <input type="text" id="ggProfileNameInput" maxlength="18" placeholder="Typ je naam..." value="${escapeHtml(p.name)}" />
      <label>Kleur</label>
      <div class="gg-profile-colors">
        ${COLORS.map((c) => `<button type="button" class="gg-profile-color-swatch${c === p.color ? " active" : ""}" style="background:${c}" data-color="${c}"></button>`).join("")}
      </div>
      <div class="gg-profile-actions">
        <button class="btn" id="ggProfileCancelBtn">Annuleren</button>
        <button class="btn primary" id="ggProfileSaveBtn">Opslaan</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  let chosenColor = p.color;
  overlay.querySelectorAll(".gg-profile-color-swatch").forEach((sw) => {
    sw.addEventListener("click", () => {
      overlay.querySelectorAll(".gg-profile-color-swatch").forEach((s) => s.classList.remove("active"));
      sw.classList.add("active");
      chosenColor = sw.dataset.color;
    });
  });

  overlay.querySelector("#ggProfileCancelBtn").addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });
  overlay.querySelector("#ggProfileSaveBtn").addEventListener("click", () => {
    const name = overlay.querySelector("#ggProfileNameInput").value.trim();
    saveProfile({ name, color: chosenColor });
    overlay.remove();
    ensureProfileWidget();
  });

  const nameInput = overlay.querySelector("#ggProfileNameInput");
  nameInput.focus();
  nameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") overlay.querySelector("#ggProfileSaveBtn").click();
  });
}
