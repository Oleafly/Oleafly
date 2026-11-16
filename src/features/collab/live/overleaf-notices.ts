import type { OverleafLiveNotice } from "@oleafly/backend-port";
import { create } from "zustand";
import { logError } from "@/lib/log";
import { overleafLiveResolve } from "@/lib/overleaf-live";
import { onOverleafLiveNotice } from "@/lib/tauri-collab";
import { useCollabLiveStore } from "./live-store";

export interface OverleafMerge {
  path: string;
  before: string;
  after: string;
}

export interface OverleafReview {
  path: string;
  mine: string;
  theirs: string;
}

interface OverleafNoticesState {
  projectId: string | null;
  maintenance: { message: string; until: number } | null;
  merged: OverleafMerge[];
  reviews: OverleafReview[];
  unsteady: string[];
  slowAck: boolean;
  resolving: string | null;
  failed: string | null;
  dismissMerged: (path: string) => void;
  dismissUnsteady: (path: string) => void;
  resolve: (path: string, keep: "mine" | "theirs") => Promise<void>;
}

const EMPTY = {
  maintenance: null,
  merged: [],
  reviews: [],
  unsteady: [],
  slowAck: false,
  resolving: null,
  failed: null,
} satisfies Partial<OverleafNoticesState>;

function replacing<T extends { path: string }>(list: T[], next: T): T[] {
  return [...list.filter((entry) => entry.path !== next.path), next];
}

export const useOverleafNotices = create<OverleafNoticesState>()((set, get) => ({
  projectId: null,
  ...EMPTY,
  dismissMerged: (path) => set((state) => ({ merged: state.merged.filter((entry) => entry.path !== path) })),
  dismissUnsteady: (path) => set((state) => ({ unsteady: state.unsteady.filter((entry) => entry !== path) })),
  resolve: async (path, keep) => {
    const { projectId } = get();
    if (!projectId) return;
    set({ resolving: path, failed: null });
    try {
      await overleafLiveResolve(projectId, path, keep);
      set((state) => ({ reviews: state.reviews.filter((entry) => entry.path !== path) }));
    } catch (error) {
      void logError("resolve an overleaf review", error);
      set({ failed: path });
    } finally {
      set({ resolving: null });
    }
  },
}));

export function applyOverleafNotice(notice: OverleafLiveNotice, now = Date.now()): void {
  const state = useOverleafNotices.getState();
  if (notice.projectId !== state.projectId) return;
  switch (notice.kind) {
    case "merged":
      useOverleafNotices.setState({ merged: replacing(state.merged, notice) });
      return;
    case "needs_review":
      useOverleafNotices.setState({ reviews: replacing(state.reviews, notice) });
      return;
    case "maintenance":
      useOverleafNotices.setState({ maintenance: { message: notice.message, until: now + notice.delayMs } });
      return;
    case "slow_ack":
      useOverleafNotices.setState({ slowAck: notice.waiting });
      return;
    case "unsteady":
      if (!state.unsteady.includes(notice.path)) {
        useOverleafNotices.setState({ unsteady: [...state.unsteady, notice.path] });
      }
  }
}

function follow(projectId: string | null) {
  if (useOverleafNotices.getState().projectId !== projectId) {
    useOverleafNotices.setState({ projectId, ...EMPTY });
  }
}

export function startOverleafNotices(): () => void {
  follow(useCollabLiveStore.getState().projectId);
  const unsubscribe = useCollabLiveStore.subscribe((state, previous) => {
    follow(state.projectId);
    if (state.status?.state === "online" && previous.status?.state !== "online") {
      useOverleafNotices.setState({ maintenance: null, slowAck: false });
    }
  });
  const stopListening = onOverleafLiveNotice((notice) => applyOverleafNotice(notice)).catch((error) => {
    void logError("listen for overleaf live notices", error);
    return () => {};
  });
  return () => {
    unsubscribe();
    void stopListening.then((unlisten) => unlisten());
  };
}
