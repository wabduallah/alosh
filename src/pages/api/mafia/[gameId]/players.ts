import type { NextApiRequest, NextApiResponse } from "next";
import { getSession } from "../../../../lib/auth";
import { getGamePlayers } from "../../../../lib/gameHost";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).end();

  const { gameId } = req.query as { gameId: string };
  const session = await getSession(req);
  if (!session) return res.status(401).json({ error: "NOT_AUTH" });

  try {
    const players = await getGamePlayers("mafia", gameId);
    return res.status(200).json({ players });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || String(err) });
  }
}
