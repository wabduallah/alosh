import type { NextApiRequest, NextApiResponse } from "next";
import { getSession } from "../../../../lib/auth";
import { endGame } from "../../../../lib/gameHost";
import { emitRoomEvent } from "../../../../lib/socket";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  const { gameId } = req.query as { gameId: string };
  const session = await getSession(req);
  if (!session) return res.status(401).json({ error: "NOT_AUTH" });

  try {
    const result = await endGame("mafia", gameId, session.playerId);
    emitRoomEvent(gameId, "game:updated", { gameKind: "mafia", gameId, ...result });
    return res.status(200).json(result);
  } catch (err: any) {
    return res.status(500).json({ error: err.message || String(err) });
  }
}
