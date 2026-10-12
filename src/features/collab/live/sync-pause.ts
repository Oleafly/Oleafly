import { create } from "zustand";
import { logError } from "@/lib/log";
import {
  collabSyncDecide,
  onCollabSyncPaused,
  onCollabSyncResumed,
  type CollabSyncDecision,
  type CollabSyncPaused,
  type CollabSyncResumed,
} from "@/lib/tauri";

export interface SyncPauseState {
  waiting: Readonly<Record<string, number>>;
  unavailable: Readonly<Record<string, true>>;
  deciding: { projectId: string; decision: CollabSyncDecision } | null;
  decide: (projectId: string, decision: CollabSyncDecision) => Promise<void>;
}

function without<T>(record: Readonly<Record<string, T>>, key: string): Record<string, T> {
  const next = { ...record };
  delete next[key];
  return next;
}

export const useSyncPauseStore = create<SyncPauseState>((set, get) => ({
  waiting: {},
  unavailable: {},
  deciding: null,
  decide: async (projectId, decision) => {
    if (get().deciding !== null) return;
    set({ deciding: { projectId, decision } });
    try {
      await collabSyncDecide(projectId, decision);
      set((state) => ({ waiting: without(state.waiting, projectId) }));
    } catch (error) {
      void logError("collab sync decision", error);
    } finally {
      set({ deciding: null });
    }
  },
}));

function paused(payload: CollabSyncPaused): void {
  if (payload.reason === "root_unavailable") {
    useSyncPauseStore.setState((state) => ({ unavailable: { ...state.unavailable, [payload.projectId]: true } }));
    return;
  }
  useSyncPauseStore.setState((state) => ({ waiting: { ...state.waiting, [payload.projectId]: payload.changed } }));
}

function resumed(payload: CollabSyncResumed): void {
  useSyncPauseStore.setState((state) => ({ unavailable: without(state.unavailable, payload.projectId) }));
}

export function startSyncPause(): () => void {
  const unlisteners = [onCollabSyncPaused(paused), onCollabSyncResumed(resumed)].map((pending) =>
    pending.catch((error) => {
      void logError("collab sync pause listen", error);
      return () => {};
    }),
  );
  return () => {
    for (const pending of unlisteners) void pending.then((unlisten) => unlisten());
    useSyncPauseStore.setState({ waiting: {}, unavailable: {}, deciding: null });
  };
}
