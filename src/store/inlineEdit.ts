import { create } from "zustand";

export type Phase = "idle" | "prompting" | "streaming" | "reviewing" | "error" | "withdrawn";

export interface Session {
  phase: Phase;
  from: number;
  to: number;
  original: string;
  instruction: string;
  proposed: string;
  error?: string;
  autoRun?: boolean;
}

interface InlineEditState {
  session: Session | null;
  open: (r: {
    from: number;
    to: number;
    original: string;
    instruction?: string;
    autoRun?: boolean;
  }) => void;
  setInstruction: (s: string) => void;
  startStreaming: (original?: string) => void;
  appendProposed: (full: string) => void;
  finishReviewing: () => void;
  fail: (msg: string) => void;
  relocate: (from: number, to: number) => void;
  withdraw: () => void;
  reset: () => void;
}

function active(session: Session | null): session is Session {
  return session !== null && session.phase !== "withdrawn";
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
        instruction: r.instruction ?? "",
        proposed: "",
        autoRun: r.autoRun ?? false,
      },
    }),
  setInstruction: (instruction) =>
    set((st) => (active(st.session) ? { session: { ...st.session, instruction } } : st)),
  startStreaming: (original) =>
    set((st) =>
      active(st.session)
        ? { session: { ...st.session, phase: "streaming", proposed: "", original: original ?? st.session.original } }
        : st,
    ),
  appendProposed: (full) =>
    set((st) => (active(st.session) ? { session: { ...st.session, proposed: full } } : st)),
  finishReviewing: () =>
    set((st) => (active(st.session) ? { session: { ...st.session, phase: "reviewing" } } : st)),
  fail: (error) =>
    set((st) => (active(st.session) ? { session: { ...st.session, phase: "error", error } } : st)),
  relocate: (from, to) =>
    set((st) => (st.session ? { session: { ...st.session, from, to } } : st)),
  withdraw: () =>
    set((st) => (active(st.session) ? { session: { ...st.session, phase: "withdrawn" } } : st)),
  reset: () => set({ session: null }),
}));
