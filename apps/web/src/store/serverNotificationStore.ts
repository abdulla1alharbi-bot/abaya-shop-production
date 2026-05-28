import { create } from "zustand";
import { api } from "@/lib/api";

export type ServerNotification = {
  id: string;
  type: string;
  title: string;
  message: string;
  link?: string | null;
  isRead: boolean;
  createdAt: string;
};

type Store = {
  unreadCount: number;
  items: ServerNotification[];
  fetch: () => Promise<void>;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
};

export const useServerNotificationStore = create<Store>((set) => ({
  unreadCount: 0,
  items: [],

  fetch: async () => {
    try {
      const [listRes, countRes] = await Promise.all([
        api.get<{ success: boolean; data: { items: ServerNotification[] } }>("/notifications"),
        api.get<{ success: boolean; data: { count: number } }>("/notifications/unread-count"),
      ]);
      set({
        items: listRes.data.data.items,
        unreadCount: countRes.data.data.count,
      });
    } catch {
      // silently fail — bell shows stale count
    }
  },

  markRead: async (id: string) => {
    try {
      await api.post(`/notifications/${id}/read`);
      set((s) => ({
        items: s.items.map((n) => (n.id === id ? { ...n, isRead: true } : n)),
        unreadCount: Math.max(0, s.unreadCount - (s.items.find((n) => n.id === id && !n.isRead) ? 1 : 0)),
      }));
    } catch {
      // ignore
    }
  },

  markAllRead: async () => {
    try {
      await api.post("/notifications/read-all");
      set((s) => ({
        items: s.items.map((n) => ({ ...n, isRead: true })),
        unreadCount: 0,
      }));
    } catch {
      // ignore
    }
  },
}));
