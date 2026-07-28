import { create } from "zustand";
import {
  sameProofreadingIdentity,
  type ProofreadingIdentity,
  type ProofreadingResult,
  type ProofreadingSurface,
} from "@oleafly/editor";

export type ProofreadingPhase =
  | "idle"
  | "loading"
  | "ready"
  | "unavailable"
  | "too_large"
  | "unsupported";

export interface ProofreadingSurfaceState {
  phase: ProofreadingPhase;
  identity: ProofreadingIdentity | null;
  message: string | null;
  diagnosticCount: number;
  truncated: boolean;
}

interface ProofreadingState {
  source: ProofreadingSurfaceState;
  visual: ProofreadingSurfaceState;
  begin: (identity: ProofreadingIdentity) => void;
  complete: (result: ProofreadingResult) => void;
  fail: (identity: ProofreadingIdentity, message: string) => void;
  clear: (surface: ProofreadingSurface, path?: string) => void;
}

const IDLE_STATE: ProofreadingSurfaceState = {
  phase: "idle",
  identity: null,
  message: null,
  diagnosticCount: 0,
  truncated: false,
};

export const useProofreadingStore = create<ProofreadingState>((set) => ({
  source: IDLE_STATE,
  visual: IDLE_STATE,
  begin: (identity) =>
    set({
      [identity.surface]: {
        phase: "loading",
        identity,
        message: null,
        diagnosticCount: 0,
        truncated: false,
      },
    } as Pick<ProofreadingState, ProofreadingSurface>),
  complete: (result) =>
    set((state) => {
      const current = state[result.identity.surface];
      if (
        !current.identity ||
        !sameProofreadingIdentity(current.identity, result.identity)
      ) {
        return state;
      }
      return {
        [result.identity.surface]: {
          phase: result.status,
          identity: result.identity,
          message: result.message ?? null,
          diagnosticCount: result.diagnostics.length,
          truncated: result.truncated ?? false,
        },
      } as Pick<ProofreadingState, ProofreadingSurface>;
    }),
  fail: (identity, message) =>
    set((state) => {
      const current = state[identity.surface];
      if (
        !current.identity ||
        !sameProofreadingIdentity(current.identity, identity)
      ) {
        return state;
      }
      return {
        [identity.surface]: {
          phase: "unavailable",
          identity,
          message,
          diagnosticCount: 0,
          truncated: false,
        },
      } as Pick<ProofreadingState, ProofreadingSurface>;
    }),
  clear: (surface, path) =>
    set((state) => {
      if (path && state[surface].identity?.path !== path) return state;
      return {
        [surface]: { ...IDLE_STATE },
      } as Pick<ProofreadingState, ProofreadingSurface>;
    }),
}));
