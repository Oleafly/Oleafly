import { create } from "zustand";
import type { DefaultAppItemId } from "@/lib/tauri";

export type DefaultAppsOfferPhase = "hidden" | "offer" | "applying" | "done" | "failed";

export const DEFAULT_APP_PRESELECTED: ReadonlySet<DefaultAppItemId> = new Set([
  "default_latex",
  "default_typst",
  "default_quarto",
]);

interface DefaultAppsOfferState {
  phase: DefaultAppsOfferPhase;
  offered: DefaultAppItemId[];
  chosen: DefaultAppItemId[];
  open: (offered: DefaultAppItemId[]) => void;
  toggle: (id: DefaultAppItemId, on: boolean) => void;
  setPhase: (phase: DefaultAppsOfferPhase) => void;
}

export const useDefaultAppsOfferStore = create<DefaultAppsOfferState>((set) => ({
  phase: "hidden",
  offered: [],
  chosen: [],
  open: (offered) =>
    set({
      phase: "offer",
      offered,
      chosen: offered.filter((id) => DEFAULT_APP_PRESELECTED.has(id)),
    }),
  toggle: (id, on) =>
    set((state) => ({
      chosen: on
        ? state.offered.filter((item) => item === id || state.chosen.includes(item))
        : state.chosen.filter((item) => item !== id),
    })),
  setPhase: (phase) => set({ phase }),
}));
