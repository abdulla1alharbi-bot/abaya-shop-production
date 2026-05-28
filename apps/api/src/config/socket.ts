import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { logger } from "../utils/logger.js";

let io: Server | null = null;

export function initSocket(httpServer: HttpServer, frontendUrl: string): Server {
  io = new Server(httpServer, {
    cors: {
      origin: frontendUrl,
      credentials: true,
    },
  });
  io.on("connection", (socket) => {
    logger.debug("Socket connected", { id: socket.id });
  });
  return io;
}

export function getIo(): Server | null {
  return io;
}
