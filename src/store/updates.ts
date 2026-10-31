import { create } from "zustand";
import type { Update } from "@tauri-apps/plugin-updater";

interface UpdatesStore {
  available: Update | null;
  version: string | null;
  lastCheckAt: number | null;
  lastCheckFailed: boolean;
  dismissed: string[];
  setAvailable: (update: Update) => void;
  setUpToDate: () => void;
  setFailed: () => void;
  dismiss: () => void;
}

export const useUpdatesStore = create<UpdatesStore>((set, get) => ({
  available: null,
  version: null,
  lastCheckAt: null,
  lastCheckFailed: false,
  dismissed: [],

  setAvailable: (update) => {
    const version = update.version;
    if (get().dismissed.includes(version)) {
      set({ lastCheckAt: Date.now(), lastCheckFailed: false });
      return;
    }
    set({ available: update, version, lastCheckAt: Date.now(), lastCheckFailed: false });
  },

  setUpToDate: () =>
    set({ available: null, version: null, lastCheckAt: Date.now(), lastCheckFailed: false }),

  setFailed: () => set({ lastCheckAt: Date.now(), lastCheckFailed: true }),

  dismiss: () =>
    set((s) => ({
      available: null,
      dismissed: s.version ? [...s.dismissed, s.version] : s.dismissed,
    })),
}));
