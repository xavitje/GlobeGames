import { createClient } from "npm:@supabase/supabase-js@2";
import { cleanCode, cleanName, haversineKm, pickOne, rouletteColor, scoreForDistance } from "../_shared/game-rules.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const allowedOrigins = new Set((Deno.env.get("ALLOWED_ORIGINS") || "https://games.drissi.store,http://localhost:5173,http://localhost:5174").split(","));
const service = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const powerups = ["hint", "shield", "5050"] as const;
const sabotages = ["fakehint", "ink", "spin"] as const;

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

function corsHeaders(request: Request) {
  const origin = request.headers.get("origin") || "";
  const allowOrigin = allowedOrigins.has(origin) ? origin : "https://games.drissi.store";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function response(request: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(request), "Content-Type": "application/json" } });
}

async function authenticate(request: Request) {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) throw new HttpError(401, "Sign in to use multiplayer.");
  const authClient = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: authorization } },
  });
  const { data, error } = await authClient.auth.getUser();
  if (error || !data.user) throw new HttpError(401, "Your session is invalid or expired.");
  return data.user;
}

function ensureObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

async function getMatch(codeValue: unknown) {
  const code = cleanCode(codeValue);
  if (code.length < 4) throw new HttpError(400, "Invalid lobby code.");
  const { data, error } = await service.from("multiplayer_matches").select("*").eq("game", "geoguesser").eq("code", code).single();
  if (error || !data) throw new HttpError(404, "Lobby not found.");
  return data;
}

async function getMember(matchId: string, userId: string) {
  const { data, error } = await service.from("multiplayer_players").select("*").eq("match_id", matchId).eq("user_id", userId).single();
  if (error || !data) throw new HttpError(403, "You are not a member of this lobby.");
  return data;
}

function requireHost(match: Record<string, unknown>, userId: string) {
  if (match.host_user_id !== userId) throw new HttpError(403, "Only the host can do this.");
}

function publicMatch(match: Record<string, any>) {
  return { code: match.code, status: match.status, settings: match.settings, round: match.round_number, state: match.state };
}

async function createRoom(user: Record<string, any>, payload: Record<string, unknown>) {
  const code = cleanCode(payload.code);
  if (code.length < 4) throw new HttpError(400, "Invalid lobby code.");
  const settings = ensureObject(payload.settings);
  const { data: match, error } = await service.from("multiplayer_matches").insert({
    game: "geoguesser", code, host_user_id: user.id, settings,
  }).select().single();
  if (error?.code === "23505") throw new HttpError(409, "That lobby code is already in use.");
  if (error || !match) throw error || new Error("Could not create lobby.");
  const player = { match_id: match.id, user_id: user.id, player_id: user.id, name: cleanName(payload.name) };
  const { error: playerError } = await service.from("multiplayer_players").insert(player);
  if (playerError) throw playerError;
  return { match: publicMatch(match), player: { playerId: user.id, name: player.name }, isHost: true };
}

async function joinRoom(user: Record<string, any>, payload: Record<string, unknown>) {
  const match = await getMatch(payload.code);
  if (match.status === "finished") throw new HttpError(409, "This match has finished.");
  const player = { match_id: match.id, user_id: user.id, player_id: user.id, name: cleanName(payload.name) };
  const { error } = await service.from("multiplayer_players").upsert(player, { onConflict: "match_id,user_id" });
  if (error) throw error;
  return { match: publicMatch(match), player: { playerId: user.id, name: player.name }, isHost: match.host_user_id === user.id };
}

async function playerState(user: Record<string, any>, payload: Record<string, unknown>) {
  const match = await getMatch(payload.code);
  const member = await getMember(match.id, user.id);
  return {
    match: publicMatch(match),
    player: {
      playerId: member.player_id, name: member.name, powerup: member.powerup,
      sabotage: member.sabotage, powerupUsed: member.powerup_used, sabotageUsed: member.sabotage_used,
    },
  };
}

async function startMatch(user: Record<string, any>, payload: Record<string, unknown>) {
  const match = await getMatch(payload.code);
  requireHost(match, user.id);
  const settings = ensureObject(payload.settings);
  const teams = ensureObject(payload.teams);
  const { data: players, error: playersError } = await service.from("multiplayer_players").select("*").eq("match_id", match.id);
  if (playersError || !players?.length) throw playersError || new HttpError(409, "No players joined.");
  await Promise.all(players.map((player) => service.from("multiplayer_players").update({
    team: teams[player.player_id] === "A" || teams[player.player_id] === "B" ? teams[player.player_id] : null,
    powerup: settings.powerups === false ? null : pickOne(powerups),
    sabotage: settings.powerups === false ? null : pickOne(sabotages),
    powerup_used: false,
    sabotage_used: false,
  }).eq("match_id", match.id).eq("user_id", player.user_id)));
  await service.from("multiplayer_rounds").delete().eq("match_id", match.id);
  await service.from("multiplayer_wagers").delete().eq("match_id", match.id);
  const scoreboard = Object.fromEntries(players.map((player) => [player.player_id, { name: player.name, total: 0 }]));
  const mode = String(settings.gameMode || "ffa");
  const state = {
    scoreboard,
    hp: mode === "duels" ? Object.fromEntries(players.map((player) => [player.player_id, 5000])) : {},
    teamHp: mode === "teamduels" ? { A: 5000, B: 5000 } : {},
    alive: mode === "br" ? players.map((player) => player.player_id) : [],
    eliminated: [], duelOver: false, history: [],
  };
  const { data, error } = await service.from("multiplayer_matches").update({ status: "active", settings, state, round_number: 0, updated_at: new Date().toISOString() }).eq("id", match.id).select().single();
  if (error || !data) throw error || new Error("Could not start match.");
  return { match: publicMatch(data) };
}

async function startRound(user: Record<string, any>, payload: Record<string, unknown>) {
  const match = await getMatch(payload.code);
  requireHost(match, user.id);
  if (match.status !== "active") throw new HttpError(409, "Match is not active.");
  if (match.round_number > 0) {
    const { data: previous } = await service.from("multiplayer_rounds").select("status").eq("match_id", match.id).eq("round_number", match.round_number).single();
    if (previous?.status === "active") throw new HttpError(409, "Finish the current round first.");
  }
  const roundNumber = match.round_number + 1;
  const lat = Number(payload.lat);
  const lng = Number(payload.lng);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) throw new HttpError(400, "Invalid answer coordinates.");
  const round = {
    match_id: match.id, round_number: roundNumber, pano_id: String(payload.pano || "").slice(0, 250),
    answer_lat: lat, answer_lng: lng, country_hint: String(payload.countryHint || "").slice(0, 120), status: "active",
  };
  if (!round.pano_id || !round.country_hint) throw new HttpError(400, "Round data is incomplete.");
  const { error } = await service.from("multiplayer_rounds").insert(round);
  if (error) throw error;
  await service.from("multiplayer_matches").update({ round_number: roundNumber, updated_at: new Date().toISOString() }).eq("id", match.id);
  return { round: roundNumber, pano: round.pano_id, countryHint: round.country_hint, total: match.settings?.rounds };
}

async function submitGuess(user: Record<string, any>, payload: Record<string, unknown>) {
  const match = await getMatch(payload.code);
  const member = await getMember(match.id, user.id);
  const roundNumber = Number(payload.round);
  const lat = Number(payload.lat);
  const lng = Number(payload.lng);
  if (roundNumber !== match.round_number) throw new HttpError(409, "This round is no longer active.");
  if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) throw new HttpError(400, "Invalid guess coordinates.");
  const { data: round, error: roundError } = await service.from("multiplayer_rounds").select("*").eq("match_id", match.id).eq("round_number", roundNumber).single();
  if (roundError || !round || round.status !== "active") throw new HttpError(409, "This round is closed.");
  const distance = haversineKm(lat, lng, round.answer_lat, round.answer_lng);
  const shield = member.powerup === "shield" && member.powerup_used;
  const points = Math.min(5000, scoreForDistance(distance) + (shield && match.settings?.gameMode !== "duels" ? 1000 : 0));
  const { error } = await service.from("multiplayer_guesses").insert({
    match_id: match.id, round_number: roundNumber, user_id: user.id, player_id: member.player_id,
    name: member.name, lat, lng, distance_km: distance, points, shield,
  });
  if (error?.code === "23505") throw new HttpError(409, "You already submitted this round.");
  if (error) throw error;
  const { count } = await service.from("multiplayer_guesses").select("user_id", { count: "exact", head: true }).eq("match_id", match.id).eq("round_number", roundNumber);
  return { accepted: true, submitted: count || 0 };
}

async function finishRound(user: Record<string, any>, payload: Record<string, unknown>) {
  const match = await getMatch(payload.code);
  requireHost(match, user.id);
  const roundNumber = Number(payload.round);
  const { data: round, error: roundError } = await service.from("multiplayer_rounds").select("*").eq("match_id", match.id).eq("round_number", roundNumber).single();
  if (roundError || !round) throw new HttpError(404, "Round not found.");
  if (round.status !== "active") throw new HttpError(409, "This round was already finished.");
  const { data: rows, error: guessesError } = await service.from("multiplayer_guesses").select("*").eq("match_id", match.id).eq("round_number", roundNumber);
  if (guessesError) throw guessesError;
  const state = ensureObject(match.state) as Record<string, any>;
  const scoreboard = ensureObject(state.scoreboard) as Record<string, any>;
  const guesses = (rows || []).map((row) => ({ playerId: row.player_id, name: row.name, lat: row.lat, lng: row.lng, km: row.distance_km, pts: row.points, shield: row.shield }));
  if (match.settings?.difficulty !== "gamble") {
    guesses.forEach((guess) => {
      scoreboard[guess.playerId] ||= { name: guess.name, total: 0 };
      scoreboard[guess.playerId].name = guess.name;
      scoreboard[guess.playerId].total += guess.pts;
    });
  }
  const mode = match.settings?.gameMode || "ffa";
  const damage: Record<string, number> = {};
  const teamDamage: Record<string, number> = {};
  if (mode === "duels" && guesses.length === 2) {
    const [a, b] = guesses;
    damage[a.playerId] = b.shield ? Math.round(Math.max(0, a.pts - b.pts) / 2) : Math.max(0, a.pts - b.pts);
    damage[b.playerId] = a.shield ? Math.round(Math.max(0, b.pts - a.pts) / 2) : Math.max(0, b.pts - a.pts);
    state.hp[b.playerId] = Math.max(0, (state.hp[b.playerId] ?? 5000) - damage[a.playerId]);
    state.hp[a.playerId] = Math.max(0, (state.hp[a.playerId] ?? 5000) - damage[b.playerId]);
    state.duelOver = state.hp[a.playerId] <= 0 || state.hp[b.playerId] <= 0;
  }
  if (mode === "teamduels") {
    const { data: members } = await service.from("multiplayer_players").select("player_id,team").eq("match_id", match.id);
    const teams = Object.fromEntries((members || []).map((member) => [member.player_id, member.team]));
    const best = (team: string) => guesses.filter((guess) => teams[guess.playerId] === team).sort((a, b) => b.pts - a.pts)[0] || { pts: 0, shield: false };
    const a = best("A"); const b = best("B");
    teamDamage.A = b.shield ? Math.round(Math.max(0, a.pts - b.pts) / 2) : Math.max(0, a.pts - b.pts);
    teamDamage.B = a.shield ? Math.round(Math.max(0, b.pts - a.pts) / 2) : Math.max(0, b.pts - a.pts);
    state.teamHp.B = Math.max(0, (state.teamHp.B ?? 5000) - teamDamage.A);
    state.teamHp.A = Math.max(0, (state.teamHp.A ?? 5000) - teamDamage.B);
    state.duelOver = state.teamHp.A <= 0 || state.teamHp.B <= 0;
  }
  const eliminatedThisRound: string[] = [];
  if (mode === "br") {
    const aliveGuesses = guesses.filter((guess) => state.alive.includes(guess.playerId));
    if (aliveGuesses.length > 1) {
      const minimum = Math.min(...aliveGuesses.map((guess) => guess.pts));
      const worst = aliveGuesses.filter((guess) => guess.pts === minimum);
      if (worst.length < aliveGuesses.length) worst.forEach((guess) => {
        state.alive = state.alive.filter((id: string) => id !== guess.playerId);
        state.eliminated.push(guess.name); eliminatedThisRound.push(guess.name);
      });
    }
  }
  state.scoreboard = scoreboard;
  state.history ||= [];
  state.history.push({ round: roundNumber, country: round.country_hint, guesses });
  await service.from("multiplayer_rounds").update({ status: "finished", finished_at: new Date().toISOString() }).eq("match_id", match.id).eq("round_number", roundNumber);
  const rounds = match.settings?.rounds;
  const finished = (rounds !== "∞" && roundNumber >= Number(rounds)) || state.duelOver || (mode === "br" && state.alive.length <= 1);
  const result = {
    round: roundNumber, total: rounds,
    answer: { lat: round.answer_lat, lng: round.answer_lng, countryHint: round.country_hint },
    guesses, scoreboard, gameMode: mode, damage, hp: state.hp, teamHp: state.teamHp, teamDamage,
    eliminatedThisRound, eliminated: state.eliminated, alive: state.alive, duelOver: state.duelOver, finished,
  };
  state.lastResults = result;
  await service.from("multiplayer_matches").update({ state, status: finished ? "finished" : "active", updated_at: new Date().toISOString() }).eq("id", match.id);
  return result;
}

async function roundResults(user: Record<string, any>, payload: Record<string, unknown>) {
  const match = await getMatch(payload.code);
  await getMember(match.id, user.id);
  const results = match.state?.lastResults;
  if (!results || results.round !== Number(payload.round)) throw new HttpError(409, "Official results are not ready yet.");
  return results;
}

async function usePowerup(user: Record<string, any>, payload: Record<string, unknown>) {
  const match = await getMatch(payload.code);
  const member = await getMember(match.id, user.id);
  if (!member.powerup || member.powerup_used) throw new HttpError(409, "Power-up is unavailable.");
  const { data: round } = await service.from("multiplayer_rounds").select("country_hint").eq("match_id", match.id).eq("round_number", match.round_number).single();
  if (!round) throw new HttpError(409, "No active round.");
  await service.from("multiplayer_players").update({ powerup_used: true }).eq("match_id", match.id).eq("user_id", user.id);
  if (member.powerup === "hint") return { type: "hint", countryHint: round.country_hint };
  if (member.powerup === "5050") {
    const alternatives = ["Canada", "France", "Japan", "Brazil", "Australia", "South Africa", "Mexico", "Iceland"].filter((name) => name !== round.country_hint);
    return { type: "5050", options: Math.random() < 0.5 ? [round.country_hint, pickOne(alternatives)] : [pickOne(alternatives), round.country_hint] };
  }
  return { type: "shield" };
}

async function useSabotage(user: Record<string, any>, payload: Record<string, unknown>) {
  const match = await getMatch(payload.code);
  const member = await getMember(match.id, user.id);
  if (!member.sabotage || member.sabotage_used) throw new HttpError(409, "Sabotage is unavailable.");
  const target = String(payload.target || "");
  if (!target || target === member.player_id) throw new HttpError(400, "Invalid sabotage target.");
  const { data: targetMember } = await service.from("multiplayer_players").select("player_id").eq("match_id", match.id).eq("player_id", target).single();
  if (!targetMember) throw new HttpError(404, "Target is not in this lobby.");
  await service.from("multiplayer_players").update({ sabotage_used: true }).eq("match_id", match.id).eq("user_id", user.id);
  return { target, sabotageType: member.sabotage, fromName: member.name };
}

async function wager(user: Record<string, any>, payload: Record<string, unknown>) {
  const match = await getMatch(payload.code);
  const member = await getMember(match.id, user.id);
  if (match.settings?.difficulty !== "gamble") throw new HttpError(409, "This match is not in gamble mode.");
  const roundNumber = Number(payload.round);
  const { data: guess } = await service.from("multiplayer_guesses").select("points").eq("match_id", match.id).eq("round_number", roundNumber).eq("user_id", user.id).single();
  if (!guess) throw new HttpError(409, "No points are available for this round.");
  const choice = String(payload.choice || "bank");
  if (!["bank", "red", "black", "green"].includes(choice)) throw new HttpError(400, "Invalid wager choice.");
  const number = choice === "bank" ? null : crypto.getRandomValues(new Uint32Array(1))[0] % 37;
  const won = number !== null && rouletteColor(number) === choice;
  const payout = choice === "bank" ? guess.points : won ? guess.points * (choice === "green" ? 5 : 2) : 0;
  const { error } = await service.from("multiplayer_wagers").insert({ match_id: match.id, round_number: roundNumber, user_id: user.id, choice, number, payout });
  if (error?.code === "23505") throw new HttpError(409, "This wager was already resolved.");
  if (error) throw error;
  const state = ensureObject(match.state) as Record<string, any>;
  state.scoreboard ||= {};
  state.scoreboard[member.player_id] ||= { name: member.name, total: 0 };
  state.scoreboard[member.player_id].total += payout;
  await service.from("multiplayer_matches").update({ state, updated_at: new Date().toISOString() }).eq("id", match.id);
  return { number, won, payout, scoreboard: state.scoreboard };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(request) });
  if (request.method !== "POST") return response(request, { error: "Method not allowed." }, 405);
  try {
    const user = await authenticate(request);
    const body = ensureObject(await request.json());
    const action = String(body.action || "");
    const handlers: Record<string, (user: Record<string, any>, payload: Record<string, unknown>) => Promise<unknown>> = {
      "create-room": createRoom, "join-room": joinRoom, "player-state": playerState,
      "start-match": startMatch, "start-round": startRound, "submit-guess": submitGuess,
      "finish-round": finishRound, "round-results": roundResults,
      "use-powerup": usePowerup, "use-sabotage": useSabotage, wager,
    };
    const handler = handlers[action];
    if (!handler) throw new HttpError(400, "Unknown multiplayer action.");
    return response(request, await handler(user, body));
  } catch (error) {
    console.error(error);
    const status = error instanceof HttpError ? error.status : 500;
    return response(request, { error: error instanceof Error ? error.message : "Unexpected server error." }, status);
  }
});
