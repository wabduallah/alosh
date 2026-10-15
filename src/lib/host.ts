import { Pool } from "pg";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

/**
 * Soft-kick a player from a room (mark kicked=true) instead of deleting row.
 */
export async function kickPlayer(roomId: string, targetPlayerId: string, actorPlayerId: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // verify room exists and actor is host
    const r = await client.query("SELECT host_id FROM public.game_rooms WHERE id = $1 FOR UPDATE", [roomId]);
    if (!r.rows.length) throw new Error("ROOM_NOT_FOUND");
    const hostId = r.rows[0].host_id;
    if (hostId !== actorPlayerId) throw new Error("NOT_HOST");

    // soft-kick: mark player as kicked instead of deleting
    const upd = await client.query(
      "UPDATE public.room_players SET kicked = true, kicked_at = now() WHERE id = $1 AND room_id = $2 RETURNING id, player_id",
      [targetPlayerId, roomId],
    );

    if (!upd.rows.length) {
      await client.query("ROLLBACK");
      throw new Error("PLAYER_NOT_IN_ROOM");
    }

    // Best-effort cleanup for game-specific JSON state (example for court_cases participants)
    try {
      await client.query(
        `UPDATE public.court_cases
         SET state = (CASE
           WHEN state ? 'participants' THEN jsonb_set(state, '{participants}', (
              (state->'participants') - to_jsonb($1::text)
           )::jsonb)
           ELSE state END)
         WHERE room_id = $2`,
        [targetPlayerId, roomId],
      );
    } catch (e) {
      // ignore if court_cases or structure doesn't match — not critical
    }

    await client.query("COMMIT");
    return { ok: true };
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch (e) {}
    throw err;
  } finally {
    client.release();
  }
}
