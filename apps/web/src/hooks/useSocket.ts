import { useEffect } from "react";
import { io, type Socket } from "socket.io-client";
import { useAuthStore } from "@/store/authStore";

const socketUrl = import.meta.env.VITE_SOCKET_URL ?? "http://localhost:3001";

let socket: Socket | null = null;

export function useSocket(): Socket | null {
  const token = useAuthStore((s) => s.accessToken);

  useEffect(() => {
    if (!token) {
      if (socket) {
        socket.disconnect();
        socket = null;
      }
      return;
    }
    socket = io(socketUrl, {
      withCredentials: true,
      transports: ["websocket", "polling"],
    });
    return () => {
      socket?.disconnect();
      socket = null;
    };
  }, [token]);

  return socket;
}
