import { Pool } from "pg";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

/**
 * Kick a player only from a specific game instance (soft-kick).
 * Replaces hard DELETE with setting kicked=true and kicked_at.
 */
export async function kickPlayerFromGame(
  gameKind: "mafia" | "court",
  gameId: string,
  targetPlayerId: string,
  actorPlayerId: string
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    if (gameKind === "mafia") {
      const g = await client.query(
        "SELECT id, host_id FROM public.mafia_games WHERE id = $1 FOR UPDATE",
        [gameId]
      );
      if (!g.rows.length) throw new Error("GAME_NOT_FOUND");
      if (g.rows[0].host_id !== actorPlayerId) throw new Error("NOT_HOST");

      // soft-kick: mark as kicked instead of delete
      const upd = await client.query(
        `UPDATE public.mafia_players SET kicked = true, kicked_at = now() WHERE game_id = $1 AND player_id = $2 RETURNING id`,
        [gameId, targetPlayerId]
      );
      if (!upd.rows.length) {
        await client.query("ROLLBACK");
        throw new Error("PLAYER_NOT_IN_GAME");
      }

      await client.query("COMMIT");
      return { ok: true, removed: true };
    }

    if (gameKind === "court") {
      const g = await client.query(
        "SELECT id, host_id, state FROM public.court_cases WHERE id = $1 FOR UPDATE",
        [gameId]
      );
      if (!g.rows.length) throw new Error("GAME_NOT_FOUND");
      if (g.rows[0].host_id !== actorPlayerId) throw new Error("NOT_HOST");

      const state = g.rows[0].state ?? {};
      const participants = Array.isArray(state.participants) ? state.participants : [];

      if (!participants.includes(targetPlayerId)) {
        await client.query("ROLLBACK");
        throw new Error("PLAYER_NOT_IN_GAME");
      }

      const newParticipants = participants.filter((p: string) => p !== targetPlayerId);
      const newState = { ...state, participants: newParticipants };

      await client.query(
        "UPDATE public.court_cases SET state = $1 WHERE id = $2",
        [newState, gameId]
      );

      await client.query("COMMIT");
      return { ok: true, removed: true };
    }

    throw new Error("UNSUPPORTED_GAME_KIND");
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch (e) {}
    throw err;
  } finally {
    client.release();
  }
}
