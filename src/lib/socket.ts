import { Server as HTTPServer } from "http";
import { Server } from "socket.io";

let io: Server | null = null;

export function initSocket(server: HTTPServer) {
  if (io) return io;

  io = new Server(server, {
    path: "/api/socket",
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
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
