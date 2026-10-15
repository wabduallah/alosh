import { Server as HTTPServer } from "http";
import { Server } from "socket.io";
import { consumeSocketToken } from "./socketTokens";

let io: Server | null = null;

export function initSocket(server: HTTPServer) {
  if (io) return io;

  const allowedOrigins = (process.env.SOCKET_ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);

  io = new Server(server, {
    path: "/api/socket",
    cors: {
      origin: allowedOrigins.length ? allowedOrigins : false,
      methods: ["GET", "POST"],
    },
  });

  // middleware: validate token query param
  io.use((socket, next) => {
    const token = (socket.handshake.query && (socket.handshake.query.token as string)) || null;
    if (!token) return next(new Error("Authentication error: missing token"));
    const playerId = consumeSocketToken(token);
    if (!playerId) return next(new Error("Authentication error: invalid or expired token"));
    // attach playerId for later
    (socket as any).playerId = playerId;
    return next();
  });

  io.on("connection", (socket) => {
    socket.on("join-room", (roomId: string) => {
      socket.join(roomId);
    });

    socket.on("leave-room", (roomId: string) => {
      socket.leave(roomId);
    });
  });

  return io;
}

export function emitRoomEvent(roomId: string, event: string, payload: any) {
  if (!io) return;
  io.to(roomId).emit(event, payload);
}
