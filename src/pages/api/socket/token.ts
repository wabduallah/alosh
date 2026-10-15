import type { NextApiRequest, NextApiResponse } from "next";
import { v4 as uuidv4 } from "uuid";
import { getSession } from "../../../lib/auth";
import { storeSocketToken } from "../../../lib/socketTokens";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();
  const session = await getSession(req);
  if (!session) return res.status(401).json({ error: "NOT_AUTH" });

  // generate a short-lived token the client will use to connect via socket
  const token = uuidv4();
  storeSocketToken(token, session.playerId, 30); // 30s TTL
  return res.status(200).json({ token, ttl: 30 });
}
