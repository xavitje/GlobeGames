import { getSupabase, hasSupabaseConfig } from "./supabase.js";
const ROOM_PREFIX = "globegames-gg-";
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function normalizePlayerName(value, fallback = "Player") {
  const name = String(value || "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 18);
  return name || fallback;
}

export function hasMultiplayerConfig() {
  return hasSupabaseConfig();
}

function getClient() {
  return getSupabase();
}

export function randomRoomCode() {
  let code = "";
  for (let i = 0; i < 4; i++) {
    code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return code;
}

export function randomPlayerId() {
  return (
    "p_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
  );
}

// Own one Supabase Realtime room and its connection lifecycle.
export class GameRoom {
  constructor(code, playerId, name) {
    this.code = String(code).toUpperCase().replace(/[^A-Z2-9]/g, "").slice(0, 6);
    this.playerId = playerId;
    this.name = normalizePlayerName(name);
    this.channel = null;
    this.listeners = {};
    this.presenceListeners = [];
    this.connectionListeners = [];
    this.reconnectAttempts = 0;
    this.reconnectTimer = null;
    this.intentionalLeave = false;
  }

  on(type, handler) {
    (this.listeners[type] = this.listeners[type] || []).push(handler);
    return this;
  }

  onPresence(handler) {
    this.presenceListeners.push(handler);
    return this;
  }

  // Report connection changes after the initial connection succeeds.
  onConnectionChange(handler) {
    this.connectionListeners.push(handler);
    return this;
  }

  players() {
    if (!this.channel) return [];
    const state = this.channel.presenceState();
    const out = [];
    Object.values(state).forEach((entries) => {
      entries.forEach((entry) => {
        if (typeof entry.playerId !== "string") return;
        out.push({ playerId: entry.playerId.slice(0, 80), name: normalizePlayerName(entry.name) });
      });
    });
    // Reconnects can briefly create duplicate presence entries.
    const seen = new Map();
    out.forEach((p) => seen.set(p.playerId, p));
    return [...seen.values()];
  }

  connect() {
    return this._subscribe(true);
  }

  _subscribe(isInitial) {
    const supabase = getClient();
    const channel = supabase.channel(ROOM_PREFIX + this.code, {
      config: { presence: { key: this.playerId }, broadcast: { self: true } },
    });
    this.channel = channel;

    channel.on("presence", { event: "sync" }, () => {
      this.presenceListeners.forEach((fn) => fn(this.players()));
    });

    channel.on("broadcast", { event: "game" }, ({ payload }) => {
      const handlers = this.listeners[payload.type] || [];
      handlers.forEach((fn) => fn(payload));
    });

    return new Promise((resolve, reject) => {
      channel.subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await channel.track({ playerId: this.playerId, name: this.name });
          this.reconnectAttempts = 0;
          if (isInitial) {
            resolve(this);
          } else {
            this.connectionListeners.forEach((fn) => fn("reconnected"));
          }
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          if (isInitial) {
            reject(new Error("Kon geen verbinding maken met de lobby"));
          } else if (!this.intentionalLeave) {
            this.connectionListeners.forEach((fn) => fn("disconnected"));
            this._scheduleReconnect();
          }
        }
      });
    });
  }

  // Reuse the player ID during exponential-backoff reconnects.
  _scheduleReconnect() {
    if (this.intentionalLeave || this.reconnectTimer) return;
    this.reconnectAttempts++;
    const delay = Math.min(1000 * 2 ** (this.reconnectAttempts - 1), 10000);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.intentionalLeave) return;
      if (this.channel) { getClient().removeChannel(this.channel); this.channel = null; }
      this._subscribe(false).catch(() => { this._scheduleReconnect(); });
    }, delay);
  }

  send(type, data) {
    if (!this.channel) return;
    if (!/^[a-z][a-z0-9-]{0,31}$/.test(type)) throw new Error("Invalid multiplayer event type");
    this.channel.send({
      type: "broadcast",
      event: "game",
      payload: { ...(data || {}), type, from: this.playerId },
    });
  }

  leave() {
    this.intentionalLeave = true;
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    if (this.channel) {
      getClient().removeChannel(this.channel);
      this.channel = null;
    }
    this.listeners = {};
    this.presenceListeners = [];
    this.connectionListeners = [];
  }
}
