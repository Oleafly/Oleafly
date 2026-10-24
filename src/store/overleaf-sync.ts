import { create } from "zustand";
import { AppError } from "@/lib/app-error";
import { isOverleafError } from "@/lib/overleaf";
import {
  overleafGitTokenSet,
  overleafSyncCheck,
  overleafSyncLink,
  overleafSyncNow,
  overleafSyncSetAuto,
  overleafSyncStatus,
  overleafSyncUnlink,
  type OverleafSyncReport,
  type OverleafSyncStatus,
  type SyncSide,
} from "@/lib/overleaf-sync";
import { logError } from "@/lib/log";
import { runWithEditorMutationLease, useFilesStore } from "@/store/files";

export type OverleafSyncPhase = "idle" | "linking" | "syncing";

interface OverleafSyncState {
  projectId: string | null;
  status: OverleafSyncStatus | null;
  phase: OverleafSyncPhase;
  conflicts: string[];
  resolutions: Record<string, SyncSide>;
  choice: string[];
  error: unknown;
  lastReport: OverleafSyncReport | null;
  refresh(projectId: string): Promise<void>;
  saveToken(token: string): Promise<boolean>;
  link(prefer?: SyncSide | null): Promise<OverleafSyncReport | null>;
  sync(resolutions?: Record<string, SyncSide> | null, mode?: "manual" | "auto"): Promise<OverleafSyncReport | null>;
  setAuto(auto: boolean): Promise<void>;
  unlink(): Promise<void>;
  dismissChoice(): void;
}

class ProjectChangedError extends Error {}

async function runMutation(
  projectId: string,
  operation: (generation: number) => Promise<OverleafSyncReport>,
): Promise<OverleafSyncReport> {
  if (useFilesStore.getState().projectId !== projectId) throw new ProjectChangedError();
  return runWithEditorMutationLease(projectId, async () => {
    const generation = await useFilesStore.getState().prepareExternalMutation(projectId);
    if (useFilesStore.getState().projectId !== projectId) throw new ProjectChangedError();
    const report = await operation(generation);
    if (report.state) await useFilesStore.getState().applyProjectStateChanged(report.state);
    return report;
  });
}

async function checkThenMerge(
  projectId: string,
  resolutions: Record<string, SyncSide> | null,
): Promise<OverleafSyncReport> {
  if (!resolutions) {
    const checked = await overleafSyncCheck(projectId);
    if (checked.outcome !== "needs-merge") return checked;
  }
  return runMutation(projectId, (generation) => overleafSyncNow(projectId, generation, resolutions, !resolutions));
}

function quiet(error: unknown): boolean {
  return error instanceof ProjectChangedError || isOverleafError(error, "sync_busy");
}

export const useOverleafSyncStore = create<OverleafSyncState>((set, get) => ({
  projectId: null,
  status: null,
  phase: "idle",
  conflicts: [],
  resolutions: {},
  choice: [],
  error: null,
  lastReport: null,

  async refresh(projectId) {
    if (get().projectId !== projectId) {
      set({ projectId, status: null, conflicts: [], resolutions: {}, choice: [], error: null, lastReport: null, phase: "idle" });
    }
    try {
      const status = await overleafSyncStatus(projectId);
      if (get().projectId === projectId) set({ status });
    } catch (error) {
      void logError("overleaf sync status", error);
    }
  },

  async saveToken(token) {
    const status = get().status;
    if (!status) return false;
    try {
      await overleafGitTokenSet(status.server, token);
      set({ status: { ...status, tokenSaved: true }, error: null });
      return true;
    } catch (error) {
      set({ error });
      return false;
    }
  },

  async link(prefer = null) {
    const { projectId, status, phase } = get();
    const remoteId = status?.remoteId ?? status?.importedFrom?.projectId;
    if (!projectId || !status || !remoteId || phase !== "idle") return null;
    set({ phase: "linking", error: null });
    try {
      const report = await runMutation(projectId, (generation) =>
        overleafSyncLink(projectId, generation, status.importedFrom?.server ?? status.server, remoteId, prefer),
      );
      if (get().projectId !== projectId) return report;
      set({ choice: report.outcome === "needs-choice" ? report.files : [], lastReport: report });
      set({ phase: "idle" });
      await get().refresh(projectId);
      if (report.outcome === "linked") await get().sync(null, "manual");
      return report;
    } catch (error) {
      if (get().projectId !== projectId) return null;
      if (!quiet(error)) {
        void logError("overleaf sync link", error);
        set({ error });
      }
      set({ phase: "idle" });
      return null;
    }
  },

  async sync(resolutions = null, mode = "manual") {
    const { projectId, status, phase } = get();
    if (!projectId || !status?.linked || phase !== "idle") return null;
    set({ phase: "syncing", error: mode === "manual" ? null : get().error });
    const chosen = resolutions ? { ...get().resolutions, ...resolutions } : null;
    try {
      const report = await checkThenMerge(projectId, chosen);
      if (get().projectId !== projectId) return report;
      const clashing = report.outcome === "conflicts";
      set({
        conflicts: clashing ? report.files : [],
        resolutions: clashing ? (chosen ?? get().resolutions) : {},
        lastReport: report,
        error: null,
      });
      set({ phase: "idle" });
      await get().refresh(projectId);
      return report;
    } catch (error) {
      if (get().projectId !== projectId) return null;
      set({ phase: "idle" });
      if (!quiet(error)) {
        void logError("overleaf sync", error);
        set({ error });
      }
      return null;
    }
  },

  async setAuto(auto) {
    const projectId = get().projectId;
    if (!projectId) return;
    try {
      set({ status: await overleafSyncSetAuto(projectId, auto) });
    } catch (error) {
      set({ error });
    }
  },

  async unlink() {
    const projectId = get().projectId;
    if (!projectId || get().phase !== "idle") return;
    try {
      const status = await overleafSyncUnlink(projectId);
      // The sync panel's status line says where the replaced files went.
      const kept = status.backupsFolder
        ? new AppError("overleaf.sync_backups_saved", { folder: status.backupsFolder }, null)
        : null;
      set({ status, conflicts: [], resolutions: {}, choice: [], error: kept, lastReport: null });
    } catch (error) {
      set({ error });
    }
  },

  dismissChoice() {
    set({ choice: [] });
  },
}));
