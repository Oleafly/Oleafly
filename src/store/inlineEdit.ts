import { create } from "zustand";

/**
 * Session state machine for the inline AI edit feature. Single source of truth:
 * the CodeMirror diff plugin and the React overlay both read/drive this store.
 */
export type Phase = "idle" | "prompting" | "streaming" | "reviewing" | "error";

export interface Session {
  phase: Phase;
  /** Document offsets of the target range (the original selection). */
  from: number;
  to: number;
  original: string;
  instruction: string;
  /** The model's replacement text; grows while streaming. */
  proposed: string;
  error?: string;
}

interface InlineEditState {
  session: Session | null;
  open: (r: { from: number; to: number; original: string }) => void;
  setInstruction: (s: string) => void;
  startStreaming: () => void;
  appendProposed: (full: string) => void;
  finishReviewing: () => void;
  fail: (msg: string) => void;
  reset: () => void;
}

export const useInlineEditStore = create<InlineEditState>((set) => ({
  session: null,
  open: (r) =>
    set({
      session: {
        phase: "prompting",
        from: r.from,
        to: r.to,
        original: r.original,
        instruction: "",
        proposed: "",
      },
    }),
  setInstruction: (instruction) =>
    set((st) => (st.session ? { session: { ...st.session, instruction } } : st)),
  startStreaming: () =>
    set((st) => (st.session ? { session: { ...st.session, phase: "streaming", proposed: "" } } : st)),
  appendProposed: (full) =>
    set((st) => (st.session ? { session: { ...st.session, proposed: full } } : st)),
  finishReviewing: () =>
    set((st) => (st.session ? { session: { ...st.session, phase: "reviewing" } } : st)),
  fail: (error) =>
    set((st) => (st.session ? { session: { ...st.session, phase: "error", error } } : st)),
  reset: () => set({ session: null }),
}));
