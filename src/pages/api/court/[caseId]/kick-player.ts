import { NextApiRequest, NextApiResponse } from "next";
import { getSession } from "../../../../lib/auth";
import { kickPlayerFromGame } from "../../../../lib/hostGame";
import { emitRoomEvent } from "../../../../lib/socket";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();
  const { caseId } = req.query as { caseId: string };
  const session = await getSession(req);
  if (!session) return res.status(401).json({ error: "NOT_AUTH" });

  const { targetPlayerId } = req.body as { targetPlayerId?: string };
  if (!targetPlayerId) return res.status(400).json({ error: "MISSING_TARGET" });

  try {
    const result = await kickPlayerFromGame("court", caseId, targetPlayerId, session.playerId);
    try { emitRoomEvent(String(caseId), "player:kicked", { playerId: targetPlayerId }); } catch (e) {}
    return res.status(200).json(result);
  } catch (err: any) {
    const msg = err.message || String(err);
    if (msg === "GAME_NOT_FOUND") return res.status(404).json({ error: msg });
    if (msg === "NOT_HOST") return res.status(403).json({ error: msg });
    if (msg === "PLAYER_NOT_IN_GAME") return res.status(400).json({ error: msg });
    return res.status(500).json({ error: msg });
  }
}
