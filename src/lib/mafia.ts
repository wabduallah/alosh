import pg from "pg";
import { Pool } from "pg";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export async function getGameForUpdate(gameId: string) {
  const client = await pool.connect();
  try {
    const res = await client.query(
      "SELECT id, host_id, state FROM public.mafia_games WHERE id = $1 FOR UPDATE",
      [gameId],
    );
    if (!res.rows.length) {
      client.release();
      return null;
    }
    return { client, row: res.rows[0] };
  } catch (err) {
    client.release();
    throw err;
  }
}

/** Record an action (mafia vote, doctor save, detective check) */
export async function recordAction(
  gameId: string,
  actorPlayerId: string,
  role: string,
  actionTargetId: string,
) {
  const ctx = await getGameForUpdate(gameId);
  if (!ctx) throw new Error("GAME_NOT_FOUND");
  const { client, row } = ctx;
  try {
    const state = row.state ?? {};
    state.nightActions = state.nightActions ?? {};

    if (role === "mafia") {
      state.nightActions.mafiaVotes = state.nightActions.mafiaVotes ?? {};
      state.nightActions.mafiaVotes[actionTargetId] = state.nightActions.mafiaVotes[actionTargetId] ?? [];
      if (!state.nightActions.mafiaVotes[actionTargetId].includes(actorPlayerId)) {
        // remove previous vote by this mafia (if any) — ensure single vote per mafia
        for (const t of Object.keys(state.nightActions.mafiaVotes)) {
          const arr = state.nightActions.mafiaVotes[t] as string[];
          const idx = arr.indexOf(actorPlayerId);
          if (idx !== -1) arr.splice(idx, 1);
        }
        state.nightActions.mafiaVotes[actionTargetId].push(actorPlayerId);
      }
    } else if (role === "doctor") {
      state.nightActions.doctorSave = { by: actorPlayerId, target: actionTargetId };
    } else if (role === "detective") {
      state.nightActions.detectiveCheck = { by: actorPlayerId, target: actionTargetId, result: null };
    } else {
      throw new Error("INVALID_ROLE");
    }

    await client.query("UPDATE public.mafia_games SET state = $1 WHERE id = $2", [state, gameId]);
    await client.query("COMMIT");
    return state;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch (e) {
      // ignore
    }
    throw err;
  } finally {
    client.release();
  }
}

export async function finalizeNight(gameId: string) {
  const ctx = await getGameForUpdate(gameId);
  if (!ctx) throw new Error("GAME_NOT_FOUND");
  const { client, row } = ctx;
  try {
    const state = row.state ?? {};
    state.nightActions = state.nightActions ?? {};

    const mafiaVotes = state.nightActions.mafiaVotes ?? {};
    let mafiaTarget: string | null = null;
    let max = 0;
    for (const [target, voters] of Object.entries(mafiaVotes)) {
      const count = Array.isArray(voters) ? voters.length : 0;
      if (count > max) {
        max = count;
        mafiaTarget = target;
      }
    }

    const doctorSave = state.nightActions.doctorSave?.target ?? null;
    const detectiveCheck = state.nightActions.detectiveCheck?.target ?? null;

    let killed: string | null = null;
    if (mafiaTarget && mafiaTarget !== doctorSave) killed = mafiaTarget;

    let detectiveResult = null;
    if (detectiveCheck) {
      const r = await client.query(
        "SELECT role FROM public.mafia_players WHERE game_id = (SELECT id FROM public.mafia_games WHERE id=$1) AND player_id = $2 LIMIT 1",
        [gameId, detectiveCheck],
      );
      if (r.rows[0]) detectiveResult = { targetId: detectiveCheck, role: r.rows[0].role };
    }

    if (killed) {
      await client.query(
        "UPDATE public.mafia_players SET alive = false WHERE game_id = (SELECT id FROM public.mafia_games WHERE id=$1) AND player_id = $2",
        [gameId, killed],
      );
    }

    state.nightActions.resolved = {
      mafiaTarget,
      mafiaVotes,
      doctorSave,
      detectiveCheck,
      detectiveResult,
      killed,
    };

    await client.query("UPDATE public.mafia_games SET state = $1 WHERE id = $2", [state, gameId]);
    await client.query("COMMIT");
    return state.nightActions.resolved;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch (e) {}
    throw err;
  } finally {
    client.release();
  }
}

export async function getNarratorView(gameId: string) {
  const res = await pool.query("SELECT host_id, state FROM public.mafia_games WHERE id = $1", [gameId]);
  if (!res.rows.length) return null;
  return res.rows[0].state?.nightActions ?? {};
}
