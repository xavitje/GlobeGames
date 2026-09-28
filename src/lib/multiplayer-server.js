import { getSupabase } from "./supabase.js";

export class MultiplayerServer {
  constructor(code) {
    this.code = String(code || "").toUpperCase();
  }

  async invoke(action, payload = {}) {
    const client = getSupabase();
    if (!client) throw new Error("Supabase is not configured.");
    const { data, error } = await client.functions.invoke("multiplayer-action", {
      body: { action, code: this.code, ...payload },
    });
    if (error) throw new Error(data?.error || error.message || "Multiplayer server request failed.");
    if (data?.error) throw new Error(data.error);
    return data;
  }

  createRoom(name, settings) { return this.invoke("create-room", { name, settings }); }
  joinRoom(name) { return this.invoke("join-room", { name }); }
  playerState() { return this.invoke("player-state"); }
  startMatch(settings, teams) { return this.invoke("start-match", { settings, teams }); }
  startRound(round) { return this.invoke("start-round", round); }
  submitGuess(round, lat, lng) { return this.invoke("submit-guess", { round, lat, lng }); }
  finishRound(round) { return this.invoke("finish-round", { round }); }
  roundResults(round) { return this.invoke("round-results", { round }); }
  usePowerup() { return this.invoke("use-powerup"); }
  useSabotage(target) { return this.invoke("use-sabotage", { target }); }
  wager(round, choice) { return this.invoke("wager", { round, choice }); }
}
