import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "";
const ROOM_PREFIX = "globegames-gg-";
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

let client = null;

export function hasMultiplayerConfig() {
  return !!(SUPABASE_URL && SUPABASE_ANON_KEY);
}

function getClient() {
  if (!client) client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return client;
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

// A thin wrapper around a Supabase Realtime channel for one game room.
// Handles presence (who's in the lobby) and broadcast messaging (game events).
export class GameRoom {
  constructor(code, playerId, name) {
    this.code = code.toUpperCase();
    this.playerId = playerId;
    this.name = name;
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

  // handler(status) where status is "disconnected" or "reconnected" —
  // fired only after the *initial* connect() has already resolved.
  onConnectionChange(handler) {
    this.connectionListeners.push(handler);
    return this;
  }

  players() {
    if (!this.channel) return [];
    const state = this.channel.presenceState();
    const out = [];
    Object.values(state).forEach((entries) => {
      entries.forEach((e) => out.push({ playerId: e.playerId, name: e.name }));
    });
    // De-dupe by playerId (a player can briefly have >1 presence entry across reconnects)
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

  // Automatic reconnect-after-disconnect with backoff, re-using the same
  // playerId so presence/late-joiner logic recognizes this as the same player.
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
    this.channel.send({
      type: "broadcast",
      event: "game",
      payload: { type, from: this.playerId, ...data },
    });
  }

  leave() {
    this.intentionalLeave = true;
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    if (this.channel) {
      getClient().removeChannel(this.channel);
      this.channel = null;
    }
  }
}
