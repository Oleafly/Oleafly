import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import { isTauri } from "@tauri-apps/api/core";
import {
  latexEngineInfo,
  installTinytex,
  deleteTinytex,
  tinytexInstallState,
  tlmgrInstalled,
  tlmgrInstall,
  tlmgrRemove,
  type EngineInfo,
} from "@/lib/tauri";
import { toast } from "@/lib/toast";
import { logError } from "@/lib/log";

export type InstallPhase = "download" | "extract" | "packages";

interface EngineStore {
  info: EngineInfo | null;
  installing: boolean;
  /** Which install phase is running (null when idle). */
  installPhase: InstallPhase | null;
  /** Download percentage when the total size is known. */
  progress: number | null;
  /** Bytes of a previous interrupted download waiting to be resumed. */
  partialDownloadBytes: number;
  /** A compile was requested mid-install; run it when the install lands. */
  compileQueuedDuringInstall: boolean;
  /** "TinyTeX is still downloading" notice (Recompile during install). */
  installWaitNoticeOpen: boolean;
  installed: string[];
  busyPkg: string | null;
  loaded: boolean;
  refresh: () => Promise<void>;
  ensureLoaded: () => Promise<void>;
  refreshPackages: () => Promise<void>;
  install: () => Promise<void>;
  remove: () => Promise<void>;
  addPackage: (name: string) => Promise<void>;
  removePackage: (name: string) => Promise<void>;
  queueCompileAfterInstall: () => void;
  closeInstallWaitNotice: () => void;
}

export const useEngineStore = create<EngineStore>((set, get) => ({
  info: null,
  installing: false,
  installPhase: null,
  progress: null,
  partialDownloadBytes: 0,
  compileQueuedDuringInstall: false,
  installWaitNoticeOpen: false,
  installed: [],
  busyPkg: null,
  loaded: false,

  refresh: async () => {
    if (!isTauri()) return;
    try {
      // Only fetch engine info here. The package list (a slow `tlmgr info` call)
      // is loaded separately by the Settings panel, never on the Preflight path.
      const info = await latexEngineInfo();
      const installState = await tinytexInstallState().catch(() => null);
      set({
        info,
        loaded: true,
        partialDownloadBytes: installState?.partial_download_bytes ?? 0,
      });
    } catch (e) {
      void logError("engine info", e);
    }
  },

  ensureLoaded: async () => {
    if (get().loaded || !isTauri()) return;
    await get().refresh();
  },

  refreshPackages: async () => {
    if (!isTauri()) return;
    try {
      set({ installed: await tlmgrInstalled() });
    } catch {
      // tlmgr may be unavailable (no engine); leave the list empty
    }
  },

  install: async () => {
    if (!isTauri() || get().installing) return;
    // A download must not race a running compile for disk/CPU: stop it first.
    // The compile is re-queued and runs automatically once the install lands.
    try {
      const compile = await import("@/store/compile");
      const compileStore = compile.useCompileStore.getState();
      if (compileStore.status === "compiling") {
        void compileStore.stopCompile();
        get().queueCompileAfterInstall();
      }
    } catch {
      /* compile store unavailable — nothing to pause */
    }
    set({ installing: true, installPhase: "download", progress: 0 });
    const unlisten = await listen<{
      phase: InstallPhase;
      received: number;
      total: number | null;
    }>("tinytex-install-progress", (e) => {
      const { phase, received, total } = e.payload;
      set({
        installPhase: phase,
        progress:
          phase === "download" && total
            ? Math.round((received / total) * 100)
            : null,
      });
    });
    try {
      const info = await installTinytex();
      set({ info, partialDownloadBytes: 0 });
      toast.success("TinyTeX installed.");
      void get().refreshPackages();
      if (get().compileQueuedDuringInstall) {
        set({ compileQueuedDuringInstall: false, installWaitNoticeOpen: false });
        const compile = await import("@/store/compile");
        void compile.useCompileStore.getState().recompile();
      }
    } catch (e) {
      void logError("install tinytex", e);
      const detail = e instanceof Error ? e.message : String(e);
      const state = await tinytexInstallState().catch(() => null);
      set({ partialDownloadBytes: state?.partial_download_bytes ?? 0 });
      // The backend message already says whether progress was kept; show it
      // verbatim instead of a generic apology.
      toast.error(detail || "Could not install TinyTeX.", {
        label: "Install guide",
        onClick: () =>
          void import("@tauri-apps/plugin-shell").then((m) =>
            m.open("https://yihui.org/tinytex/"),
          ),
      });
    } finally {
      unlisten();
      set({ installing: false, installPhase: null, progress: null });
    }
  },

  remove: async () => {
    if (!isTauri()) return;
    try {
      await deleteTinytex();
      toast.success("Removed TinyTeX");
      set({ installed: [], partialDownloadBytes: 0 });
      void get().refresh();
    } catch (e) {
      void logError("delete tinytex", e);
      toast.error("Could not remove TinyTeX");
    }
  },

  addPackage: async (name) => {
    if (!isTauri() || get().busyPkg) return;
    set({ busyPkg: name });
    try {
      await tlmgrInstall([name]);
      set((s) => ({ installed: [...s.installed, name] }));
    } catch (e) {
      void logError("tlmgr install", e);
      toast.error(`Could not install ${name}`);
    } finally {
      set({ busyPkg: null });
    }
  },

  removePackage: async (name) => {
    if (!isTauri() || get().busyPkg) return;
    set({ busyPkg: name });
    try {
      await tlmgrRemove([name]);
      set((s) => ({ installed: s.installed.filter((p) => p !== name) }));
    } catch (e) {
      void logError("tlmgr remove", e);
      toast.error(`Could not remove ${name}`);
    } finally {
      set({ busyPkg: null });
    }
  },

  queueCompileAfterInstall: () => {
    set({ compileQueuedDuringInstall: true, installWaitNoticeOpen: true });
  },

  closeInstallWaitNotice: () => set({ installWaitNoticeOpen: false }),
}));

/** Human label for the current install phase, shared by modal and Settings. */
export function installPhaseLabel(
  phase: InstallPhase | null,
  progress: number | null,
): string {
  switch (phase) {
    case "download":
      return progress != null ? `Downloading… ${progress}%` : "Downloading…";
    case "extract":
      return "Unpacking…";
    case "packages":
      return "Adding packages…";
    default:
      return "Installing…";
  }
}
