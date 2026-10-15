import type { NextApiRequest, NextApiResponse } from "next";
import { Server as HTTPServer } from "http";
import { initSocket } from "../../../lib/socket";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!res.socket.server.io) {
    const httpServer = res.socket.server as HTTPServer;
    initSocket(httpServer);
    res.socket.server.io = true as any;
  }

  res.status(200).json({ ok: true });
}
