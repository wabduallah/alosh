import { Pool } from "pg";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export async function getGamePlayers(gameKind: "mafia" | "court", gameId: string) {
  if (gameKind === "mafia") {
    const res = await pool.query(
      `SELECT mp.player_id as id, rp.display_name as name, mp.role, mp.alive
       FROM public.mafia_players mp
       LEFT JOIN public.room_players rp ON rp.id = mp.player_id
       WHERE mp.game_id = $1
       ORDER BY mp.created_at`,
      [gameId]
    );

    return res.rows.map((row) => ({
      id: row.id,
      name: row.name || "Unknown",
      role: row.role,
      status: row.alive ? "alive" : "dead",
    }));
  }

  if (gameKind === "court") {
    const res = await pool.query(
      `SELECT state->'participants' as participants
       FROM public.court_cases
       WHERE id = $1`,
      [gameId]
    );

    const participants = res.rows[0]?.participants ?? [];
    return participants.map((p: string, index: number) => ({
      id: p,
      name: `Player ${index + 1}`,
      role: "participant",
      status: "in-game",
    }));
  }

  return [];
}

export async function startGame(gameKind: "mafia" | "court", gameId: string, actorPlayerId: string) {
  if (gameKind === "mafia") {
    const res = await pool.query(
      "SELECT host_id FROM public.mafia_games WHERE id = $1",
      [gameId]
    );
    if (!res.rows.length) throw new Error("GAME_NOT_FOUND");
    if (res.rows[0].host_id !== actorPlayerId) throw new Error("NOT_HOST");

    await pool.query(
      "UPDATE public.mafia_games SET state = jsonb_set(state, '{phase}', '\"night\"'::jsonb) WHERE id = $1",
      [gameId]
    );

    return { ok: true, phase: "night" };
  }

  if (gameKind === "court") {
    const res = await pool.query(
      "SELECT host_id FROM public.court_cases WHERE id = $1",
      [gameId]
    );
    if (!res.rows.length) throw new Error("GAME_NOT_FOUND");
    if (res.rows[0].host_id !== actorPlayerId) throw new Error("NOT_HOST");

    await pool.query(
      "UPDATE public.court_cases SET state = jsonb_set(state, '{phase}', '\"case\"'::jsonb) WHERE id = $1",
      [gameId]
    );

    return { ok: true, phase: "case" };
  }

  throw new Error("UNSUPPORTED");
}

export async function endGame(gameKind: "mafia" | "court", gameId: string, actorPlayerId: string) {
  if (gameKind === "mafia") {
    const res = await pool.query(
      "SELECT host_id FROM public.mafia_games WHERE id = $1",
      [gameId]
    );
    if (!res.rows.length) throw new Error("GAME_NOT_FOUND");
    if (res.rows[0].host_id !== actorPlayerId) throw new Error("NOT_HOST");

    await pool.query(
      "UPDATE public.mafia_games SET state = jsonb_set(state, '{phase}', '\"finished\"'::jsonb) WHERE id = $1",
      [gameId]
    );

    return { ok: true, phase: "finished" };
  }

  if (gameKind === "court") {
    const res = await pool.query(
      "SELECT host_id FROM public.court_cases WHERE id = $1",
      [gameId]
    );
    if (!res.rows.length) throw new Error("GAME_NOT_FOUND");
    if (res.rows[0].host_id !== actorPlayerId) throw new Error("NOT_HOST");

    await pool.query(
      "UPDATE public.court_cases SET state = jsonb_set(state, '{phase}', '\"finished\"'::jsonb) WHERE id = $1",
      [gameId]
    );

    return { ok: true, phase: "finished" };
  }

  throw new Error("UNSUPPORTED");
}

export async function restartRound(gameKind: "mafia" | "court", gameId: string, actorPlayerId: string) {
  if (gameKind === "mafia") {
    const res = await pool.query(
      "SELECT host_id FROM public.mafia_games WHERE id = $1",
      [gameId]
    );
    if (!res.rows.length) throw new Error("GAME_NOT_FOUND");
    if (res.rows[0].host_id !== actorPlayerId) throw new Error("NOT_HOST");

    await pool.query(
      "UPDATE public.mafia_games SET state = jsonb_set(jsonb_set(state, '{phase}', '\"lobby\"'::jsonb), '{round}', '1'::jsonb) WHERE id = $1",
      [gameId]
    );

    return { ok: true, phase: "lobby", round: 1 };
  }

  if (gameKind === "court") {
    const res = await pool.query(
      "SELECT host_id FROM public.court_cases WHERE id = $1",
      [gameId]
    );
    if (!res.rows.length) throw new Error("GAME_NOT_FOUND");
    if (res.rows[0].host_id !== actorPlayerId) throw new Error("NOT_HOST");

    await pool.query(
      "UPDATE public.court_cases SET state = jsonb_set(state, '{phase}', '\"lobby\"'::jsonb) WHERE id = $1",
      [gameId]
    );

    return { ok: true, phase: "lobby" };
  }

  throw new Error("UNSUPPORTED");
}
