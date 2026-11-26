import type {
  CollabLiveSyncState,
  OverleafLiveNotice,
  OverleafSettingKey,
  OverleafSettingNotSent,
  OverleafStopReason,
} from "@oleafly/backend-port";
import { create } from "zustand";
import { collabRelive, useOverleafFilling } from "@/lib/collab-live-bridge";
import { logError } from "@/lib/log";
import { overleafLiveKeepCopy, overleafLiveResolve, overleafLiveRetry } from "@/lib/overleaf-live";
import { onOverleafLiveNotice } from "@/lib/tauri-collab";
import { useFilesStore } from "@/store/files";
import { followProject } from "./follow-project";
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

export interface OverleafStopped {
  path: string;
  reason: OverleafStopReason;
}

export interface OverleafSettingNotice {
  setting: OverleafSettingKey;
  reason: OverleafSettingNotSent;
}

interface OverleafNoticesState {
  projectId: string | null;
  maintenance: { message: string; until: number } | null;
  merged: OverleafMerge[];
  reviews: OverleafReview[];
  unsteady: string[];
  stopped: OverleafStopped[];
  external: string[];
  replaced: string | null;
  settings: OverleafSettingNotice[];
  filling: { done: number; total: number } | null;
  slowAck: boolean;
  resolving: string | null;
  failed: string | null;
  dismissMerged: (path: string) => void;
  dismissUnsteady: (path: string) => void;
  dismissExternal: (path: string) => void;
  dismissReplaced: () => void;
  dismissSettings: () => void;
  resolve: (path: string, keep: "mine" | "theirs") => Promise<boolean>;
  tryLiveAgain: (path: string) => Promise<boolean>;
  keepCopy: (path: string) => Promise<boolean>;
}

const EMPTY = {
  maintenance: null,
  merged: [],
  reviews: [],
  unsteady: [],
  stopped: [],
  external: [],
  replaced: null,
  settings: [],
  filling: null,
  slowAck: false,
  resolving: null,
  failed: null,
} satisfies Partial<OverleafNoticesState>;

function replacing<T extends { path: string }>(list: T[], next: T): T[] {
  return [...list.filter((entry) => entry.path !== next.path), next];
}

function adding(list: string[], path: string): string[] {
  return list.includes(path) ? list : [...list, path];
}

export const useOverleafNotices = create<OverleafNoticesState>()((set, get) => {
  const act = async (
    path: string,
    task: string,
    call: (projectId: string) => Promise<void>,
    done: (state: OverleafNoticesState) => Partial<OverleafNoticesState>,
  ): Promise<boolean> => {
    const { projectId } = get();
    if (!projectId) return false;
    set({ resolving: path, failed: null });
    try {
      await call(projectId);
      set(done);
      return true;
    } catch (error) {
      void logError(task, error);
      set({ failed: path });
      return false;
    } finally {
      set({ resolving: null });
    }
  };
  const restart = (path: string, task: string, command: (projectId: string, path: string) => Promise<void>) =>
    act(
      path,
      task,
      async (projectId) => {
        await useFilesStore.getState().saveFile(path);
        await command(projectId, path);
        collabRelive(path);
      },
      (state) => ({ stopped: state.stopped.filter((entry) => entry.path !== path) }),
    );
  return {
    projectId: null,
    ...EMPTY,
    dismissMerged: (path) => set((state) => ({ merged: state.merged.filter((entry) => entry.path !== path) })),
    dismissUnsteady: (path) => set((state) => ({ unsteady: state.unsteady.filter((entry) => entry !== path) })),
    dismissExternal: (path) => set((state) => ({ external: state.external.filter((entry) => entry !== path) })),
    dismissReplaced: () => set({ replaced: null }),
    dismissSettings: () => set({ settings: [] }),
    resolve: (path, keep) =>
      act(
        path,
        "resolve an overleaf review",
        (projectId) => overleafLiveResolve(projectId, path, keep),
        (state) => ({ reviews: state.reviews.filter((entry) => entry.path !== path) }),
      ),
    tryLiveAgain: (path) => restart(path, "try an overleaf file live again", overleafLiveRetry),
    keepCopy: (path) => restart(path, "keep a copy of an overleaf file", overleafLiveKeepCopy),
  };
});

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
      useOverleafNotices.setState({ unsteady: adding(state.unsteady, notice.path) });
      return;
    case "fault":
      useOverleafNotices.setState({ stopped: replacing(state.stopped, notice) });
      return;
    case "external":
      useOverleafNotices.setState({ external: adding(state.external, notice.path) });
      return;
    case "replaced":
      useOverleafNotices.setState({ replaced: notice.path });
      return;
    case "setting_not_sent":
      useOverleafNotices.setState({
        settings: [
          ...state.settings.filter((entry) => entry.setting !== notice.setting),
          { setting: notice.setting, reason: notice.reason },
        ],
      });
      return;
    case "filling":
      useOverleafNotices.setState({ filling: { done: notice.done, total: notice.total } });
      return;
    case "filled":
      useOverleafNotices.setState({ filling: null });
  }
}

const NOT_FILLING: ReadonlySet<CollabLiveSyncState["state"]> = new Set(["offline", "signed_out", "ended"]);

function fillingProject({ filling, projectId }: OverleafNoticesState): string | null {
  return filling && filling.done < filling.total ? projectId : null;
}

function follow(projectId: string | null) {
  if (useOverleafNotices.getState().projectId !== projectId) {
    useOverleafNotices.setState({ projectId, ...EMPTY });
  }
}

export function startOverleafNotices(): () => void {
  const stopFollowing = followProject(useCollabLiveStore, follow);
  const unsubscribe = useCollabLiveStore.subscribe((state, previous) => {
    const now = state.status?.state;
    if (!now || now === previous.status?.state) return;
    if (now === "online") useOverleafNotices.setState({ maintenance: null, slowAck: false });
    if (NOT_FILLING.has(now)) useOverleafNotices.setState({ filling: null });
  });
  const stopFilling = useOverleafNotices.subscribe((state) => {
    const projectId = fillingProject(state);
    if (useOverleafFilling.getState().projectId !== projectId) useOverleafFilling.setState({ projectId });
  });
  const stopListening = onOverleafLiveNotice((notice) => applyOverleafNotice(notice)).catch((error) => {
    void logError("listen for overleaf live notices", error);
    return () => {};
  });
  return () => {
    stopFollowing();
    unsubscribe();
    stopFilling();
    useOverleafFilling.setState({ projectId: null });
    void stopListening.then((unlisten) => unlisten());
  };
}
