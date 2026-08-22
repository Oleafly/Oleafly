import { create } from "zustand";
import {
  sameProofreadingIdentity,
  type ProofreadingDiagnostic,
  type ProofreadingIdentity,
  type ProofreadingResult,
  type ProofreadingSurface,
} from "@oleafly/editor";

export type ProofreadingPhase =
  | "idle"
  | "loading"
  | "ready"
  | "partial"
  | "error"
  | "unavailable"
  | "too_large"
  | "unsupported";

export interface ProofreadingSurfaceState {
  phase: ProofreadingPhase;
  identity: ProofreadingIdentity | null;
  message: string | null;
  diagnosticCount: number;
  diagnostics: ProofreadingDiagnostic[];
  truncated: boolean;
  activeDictionaryLocale: string | null;
}

interface ProofreadingState {
  source: ProofreadingSurfaceState;
  visual: ProofreadingSurfaceState;
  begin: (identity: ProofreadingIdentity) => void;
  complete: (result: ProofreadingResult) => void;
  fail: (
    identity: ProofreadingIdentity,
    message: string,
    phase?: "error" | "unavailable",
  ) => void;
  clear: (surface: ProofreadingSurface, path?: string) => void;
}

const IDLE_STATE: ProofreadingSurfaceState = {
  phase: "idle",
  identity: null,
  message: null,
  diagnosticCount: 0,
  diagnostics: [],
  truncated: false,
  activeDictionaryLocale: null,
};

export const useProofreadingStore = create<ProofreadingState>((set) => ({
  source: IDLE_STATE,
  visual: IDLE_STATE,
  begin: (identity) =>
    set((state) => {
      const previous = state[identity.surface];
      const sameDocument =
        previous.identity?.projectId === identity.projectId &&
        previous.identity.path === identity.path;
      return {
        [identity.surface]: {
          phase: "loading",
          identity,
          message: null,
          diagnosticCount: sameDocument
            ? previous.diagnosticCount
            : 0,
          diagnostics: sameDocument ? previous.diagnostics : [],
          truncated: false,
          activeDictionaryLocale: sameDocument
            ? previous.activeDictionaryLocale
            : null,
        },
      } as unknown as Pick<
        ProofreadingState,
        ProofreadingSurface
      >;
    }),
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
          diagnostics: result.diagnostics,
          truncated: result.truncated ?? false,
          activeDictionaryLocale:
            result.activeDictionaryLocale ?? null,
        },
      } as unknown as Pick<
        ProofreadingState,
        ProofreadingSurface
      >;
    }),
  fail: (identity, message, phase = "unavailable") =>
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
          phase,
          identity,
          message,
          diagnosticCount: 0,
          diagnostics: [],
          truncated: false,
          activeDictionaryLocale: null,
        },
      } as unknown as Pick<
        ProofreadingState,
        ProofreadingSurface
      >;
    }),
  clear: (surface, path) =>
    set((state) => {
      if (path && state[surface].identity?.path !== path) return state;
      return {
        [surface]: { ...IDLE_STATE },
      } as Pick<ProofreadingState, ProofreadingSurface>;
    }),
}));

/**
 * Workers and the store retain every finding; presentation is unbounded.
 * CodeMirror and ProseMirror only materialize DOM for the visible viewport,
 * and full-set rebuilds are coalesced by the lint debounce, coordinated
 * runs, and the presentation repair guards in the editors.
 */
export function storePresentationDiagnostics(
  surface: ProofreadingSurface,
  projectId: string | null,
  path: string,
): ProofreadingDiagnostic[] | null {
  const state = useProofreadingStore.getState()[surface];
  const authoritative =
    (state.phase === "ready" || state.phase === "partial") &&
    state.identity?.projectId === projectId &&
    state.identity.path === path &&
    state.identity.surface === surface;
  if (!authoritative) return null;
  return state.diagnostics;
}

export function proofreadingPresentationDiagnostics(
  result: ProofreadingResult,
): ProofreadingDiagnostic[] {
  // A presentation repaint can be seeded by an older worker response for the
  // exact same document text after CodeMirror replaces its immutable Text
  // object. Always render the central store's newer authoritative diagnostics
  // for that document so request-generation churn cannot regress the set.
  return (
    storePresentationDiagnostics(
      result.identity.surface,
      result.identity.projectId,
      result.identity.path,
    ) ?? result.diagnostics
  );
}
