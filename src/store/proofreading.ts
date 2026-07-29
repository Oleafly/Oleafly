import { create } from "zustand";
import {
  sameProofreadingIdentity,
  type ProofreadingDiagnostic,
  type ProofreadingIdentity,
  type ProofreadingResult,
  type ProofreadingSurface,
} from "@oleafly/editor";

export const PROOFREADING_PRESENTATION_PAGE_SIZE = 250;

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
  presentationPage: number;
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
  setPresentationPage: (
    surface: ProofreadingSurface,
    page: number,
  ) => void;
  clear: (surface: ProofreadingSurface, path?: string) => void;
}

const IDLE_STATE: ProofreadingSurfaceState = {
  phase: "idle",
  identity: null,
  message: null,
  diagnosticCount: 0,
  diagnostics: [],
  presentationPage: 0,
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
          presentationPage: sameDocument
            ? previous.presentationPage
            : 0,
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
      const pageCount = Math.max(
        1,
        Math.ceil(
          result.diagnostics.length /
            PROOFREADING_PRESENTATION_PAGE_SIZE,
        ),
      );
      return {
        [result.identity.surface]: {
          phase: result.status,
          identity: result.identity,
          message: result.message ?? null,
          diagnosticCount: result.diagnostics.length,
          diagnostics: result.diagnostics,
          presentationPage: Math.min(
            current.presentationPage,
            pageCount - 1,
          ),
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
          presentationPage: 0,
          truncated: false,
          activeDictionaryLocale: null,
        },
      } as unknown as Pick<
        ProofreadingState,
        ProofreadingSurface
      >;
    }),
  setPresentationPage: (surface, page) =>
    set((state) => {
      const current = state[surface];
      const pageCount = Math.max(
        1,
        Math.ceil(
          current.diagnosticCount /
            PROOFREADING_PRESENTATION_PAGE_SIZE,
        ),
      );
      const presentationPage = Math.max(
        0,
        Math.min(Math.trunc(page), pageCount - 1),
      );
      if (presentationPage === current.presentationPage) return state;
      return {
        [surface]: { ...current, presentationPage },
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

/**
 * Workers and the store retain every finding. Editor surfaces consume one
 * deterministic page at a time so an adversarial document cannot allocate
 * hundreds of thousands of DOM/CodeMirror decorations on the main thread.
 */
export function proofreadingPresentationDiagnostics(
  result: ProofreadingResult,
): ProofreadingDiagnostic[] {
  const state =
    useProofreadingStore.getState()[result.identity.surface];
  const hasAuthoritativeDocumentResult =
    (state.phase === "ready" || state.phase === "partial") &&
    state.identity?.projectId === result.identity.projectId &&
    state.identity.path === result.identity.path &&
    state.identity.surface === result.identity.surface;
  // A presentation repaint can be seeded by an older worker response for the
  // exact same document text after CodeMirror replaces its immutable Text
  // object. Always render the central store's newer authoritative diagnostics
  // for that document so request-generation churn cannot reset the page to 0.
  const diagnostics = hasAuthoritativeDocumentResult
    ? state.diagnostics
    : result.diagnostics;
  const page = hasAuthoritativeDocumentResult
    ? state.presentationPage
    : 0;
  const from = page * PROOFREADING_PRESENTATION_PAGE_SIZE;
  return diagnostics.slice(
    from,
    from + PROOFREADING_PRESENTATION_PAGE_SIZE,
  );
}
