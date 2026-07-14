import { create } from "zustand";
import type { Update } from "@tauri-apps/plugin-updater";

// Tracks the result of the automatic (startup) update check:
//
//  - `lastCheckFailed` / `lastCheckAt` power the "last check failed" indicator
//    in the About panel, surfacing an otherwise-silent startup failure.
//  - `available` / `version` record what the last check found (the dedicated
//    `UpdateWindow` re-checks to get its own install handle).
//
// `dismissed` remembers versions the user clicked "Later" on within a session
// (not persisted across restarts).
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
    // Respect an earlier "Later" for this exact version: record the check, but
    // don't re-open the prompt.
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
