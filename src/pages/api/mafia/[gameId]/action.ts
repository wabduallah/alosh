import { NextApiRequest, NextApiResponse } from "next";
import { recordAction } from "../../../lib/mafia";
import { getSession } from "../../../lib/auth";
import { emitRoomEvent } from "../../../lib/socket";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();
  const { gameId } = req.query as { gameId: string };
  const session = await getSession(req);
  if (!session) return res.status(401).json({ error: "NOT_AUTH" });

  const { role, targetId } = req.body as { role: string; targetId: string };
  const actorPlayerId = session.playerId;

  // NOTE: caller must validate actor's role/permission elsewhere or implement check here
  try {
    const state = await recordAction(gameId, actorPlayerId, role, targetId);
    // Broadcast the action to the room so host/clients can update (non-sensitive)
    try {
      emitRoomEvent(String(gameId), "night:action", { actor: actorPlayerId, role, targetId });
    } catch (e) {
      // non-fatal
    }
    return res.status(200).json({ ok: true, state });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || String(err) });
  }
}
