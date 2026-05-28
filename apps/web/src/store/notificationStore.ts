import { create } from "zustand";

export interface AppNotification {
  id: string;
  title: string;
  message?: string;
  type: "info" | "success" | "warning" | "error";
}

interface NotificationState {
  items: AppNotification[];
  push: (n: Omit<AppNotification, "id">) => void;
  dismiss: (id: string) => void;
  clear: () => void;
}

let idCounter = 0;

export const useNotificationStore = create<NotificationState>((set, get) => ({
  items: [],
  push: (n) => {
    idCounter += 1;
    const id = `n-${idCounter}`;
    set({ items: [...get().items, { ...n, id }] });
  },
  dismiss: (id) => set({ items: get().items.filter((i) => i.id !== id) }),
  clear: () => set({ items: [] }),
}));
