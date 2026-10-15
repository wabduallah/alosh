import { Pool } from "pg";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

/**
 * Kick a player from a room. Only the room host may perform this action.
 * This will DELETE the row from public.room_players which should cascade to
 * game-specific tables (mafia_players etc.) if DB foreign keys use ON DELETE CASCADE.
 *
 * Returns { ok: true } on success or throws an error.
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

    // delete the player from the room. This relies on DB constraints to cascade
    const del = await client.query(
      "DELETE FROM public.room_players WHERE id = $1 AND room_id = $2 RETURNING id",
      [targetPlayerId, roomId],
    );

    if (!del.rows.length) {
      // player not found in this room
      await client.query("ROLLBACK");
      throw new Error("PLAYER_NOT_IN_ROOM");
    }

    // Optionally: tidy up any game state that references the player (best-effort)
    // For example, remove from court_cases.state.participants if present.
    // We do a best-effort JSON update for court_cases.state if the column exists.
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
    try {
      await client.query("ROLLBACK");
    } catch (e) {}
    throw err;
  } finally {
    client.release();
  }
}
