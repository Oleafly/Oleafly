import { create } from "zustand";

export type QuickActionOfferPhase =
  | "hidden"
  | "offer"
  | "adding"
  | "added"
  | "addedInQuickActions"
  | "failed";

interface QuickActionOfferState {
  phase: QuickActionOfferPhase;
  setPhase: (phase: QuickActionOfferPhase) => void;
}

export const useQuickActionOfferStore = create<QuickActionOfferState>((set) => ({
  phase: "hidden",
  setPhase: (phase) => set({ phase }),
}));
