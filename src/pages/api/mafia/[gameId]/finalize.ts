import { NextApiRequest, NextApiResponse } from "next";
import { finalizeNight } from "../../../lib/mafia";
import { getSession } from "../../../lib/auth";
import pg from "pg";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();
  const { gameId } = req.query as { gameId: string };
  const session = await getSession(req);
  if (!session) return res.status(401).json({ error: "NOT_AUTH" });

  // validate host
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const r = await pool.query("SELECT host_id FROM public.mafia_games WHERE id = $1", [gameId]);
  if (!r.rows.length) return res.status(404).json({ error: "GAME_NOT_FOUND" });
  if (r.rows[0].host_id !== session.playerId) return res.status(403).json({ error: "ONLY_HOST" });

  try {
    const resolved = await finalizeNight(gameId);
    // TODO: broadcast via realtime/socket
    return res.status(200).json({ ok: true, resolved });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || String(err) });
  }
}
