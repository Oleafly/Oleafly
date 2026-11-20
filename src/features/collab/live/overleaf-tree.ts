import { create } from "zustand";
import { logError } from "@/lib/log";
import { onOverleafLiveTree, type OverleafTreeNotice, overleafLiveDelete } from "@/lib/overleaf-live";
import { useSettingsStore } from "@/store/settings";
import { treeNoticed, withPaths } from "./file-notices";
import { noteStoredAsFiles } from "./live-store";

const NONE: readonly string[] = [];

interface OverleafTreeState {
  projectId: string | null;
  asking: readonly string[];
  deciding: boolean;
  failed: boolean;
  decide: (onOverleaf: boolean) => Promise<void>;
}

export const useOverleafTree = create<OverleafTreeState>((set, get) => ({
  projectId: null,
  asking: NONE,
  deciding: false,
  failed: false,
  decide: async (onOverleaf) => {
    const { projectId, asking, deciding } = get();
    if (!projectId || asking.length === 0 || deciding) return;
    set({ deciding: true, failed: false });
    try {
      await overleafLiveDelete(projectId, [...asking], onOverleaf);
      set((state) => ({ asking: state.asking.filter((path) => !asking.includes(path)) }));
    } catch (error) {
      void logError("answer a delete on Overleaf", error);
      set({ failed: true });
    } finally {
      set({ deciding: false });
    }
  },
}));

function ask(projectId: string, paths: readonly string[], failed: boolean): void {
  useOverleafTree.setState((state) => ({
    projectId,
    asking: withPaths(state.projectId === projectId ? state.asking : NONE, paths),
    failed: failed || (state.projectId === projectId && state.failed),
  }));
}

export function receiveOverleafTree(notice: OverleafTreeNotice): void {
  if (notice.kind === "stored_as_files") {
    noteStoredAsFiles(notice.projectId, notice.paths);
    return;
  }
  if (notice.kind !== "delete_asked") {
    treeNoticed(notice.projectId, notice.kind, notice.paths);
    return;
  }
  const policy = useSettingsStore.getState().overleafDeletes;
  if (policy !== "ask") {
    overleafLiveDelete(notice.projectId, notice.paths, policy === "always").catch((error: unknown) => {
      void logError("answer a delete on Overleaf", error);
      ask(notice.projectId, notice.paths, true);
    });
    return;
  }
  ask(notice.projectId, notice.paths, false);
}

export function startOverleafTree(): () => void {
  let unlisten: (() => void) | null = null;
  let stopped = false;
  onOverleafLiveTree(receiveOverleafTree).then(
    (stop) => {
      if (stopped) stop();
      else unlisten = stop;
    },
    (error) => logError("listen for Overleaf tree notices", error),
  );
  return () => {
    stopped = true;
    unlisten?.();
  };
}
