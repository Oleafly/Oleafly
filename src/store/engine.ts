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
import { i18n } from "@/i18n";
import type { CompileOrigin } from "@/store/compile";

export type PackageErrorKind = "install" | "read" | "remove";

export interface PackageError {
  kind: PackageErrorKind;
  name: string;
  detail: string;
}

function errorDetail(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "";
}

function packageError(error: unknown, kind: PackageErrorKind, name = ""): PackageError {
  return { kind, name, detail: errorDetail(error).trim() };
}

function packageErrorHeadline(error: PackageError): string {
  if (error.kind === "read") return i18n.t(($) => $.settings.engine.packages.error.read);
  if (error.kind === "install") {
    return i18n.t(($) => $.settings.engine.packages.error.install, { name: error.name });
  }
  return i18n.t(($) => $.settings.engine.packages.error.remove, { name: error.name });
}

export function packageErrorMessage(error: PackageError): string {
  const message = packageErrorHeadline(error);
  return error.detail
    ? i18n.t(($) => $.settings.engine.packages.error.withDetail, { message, detail: error.detail })
    : message;
}

let packageReadRequest = 0;

async function backendNotices(outcome: string): Promise<string[]> {
  const compile = await import("@/store/compile");
  return compile.installerNotices(outcome);
}

export type InstallPhase = "download" | "extract" | "packages";

export const TINYTEX_INSTALL_TOAST_KEY = "tinytex-install";
const TINYTEX_REMOVE_TOAST_KEY = "tinytex-remove";

interface EngineStore {
  info: EngineInfo | null;
  installing: boolean;
  removing: boolean;
  /** Which install phase is running (null when idle). */
  installPhase: InstallPhase | null;
  /** Download percentage when the total size is known. */
  progress: number | null;
  /** Bytes of a previous interrupted download waiting to be resumed. */
  partialDownloadBytes: number;
  /** A compile was requested mid-install; run it when the install lands. */
  compileQueuedDuringInstall: boolean;
  compileQueuedExplicitly: boolean;
  /** "TinyTeX is still downloading" notice (Recompile during install). */
  installWaitNoticeOpen: boolean;
  installWaitNoticeShown: boolean;
  installed: string[];
  userInstalled: string[];
  systemInstalled: string[];
  packageNotice: string | null;
  busyPkg: string | null;
  packageError: PackageError | null;
  loaded: boolean;
  refresh: () => Promise<void>;
  ensureLoaded: () => Promise<void>;
  refreshPackages: () => Promise<void>;
  install: () => Promise<void>;
  remove: () => Promise<void>;
  addPackage: (name: string) => Promise<void>;
  removePackage: (name: string) => Promise<void>;
  queueCompileAfterInstall: (origin?: CompileOrigin) => void;
  closeInstallWaitNotice: () => void;
}

export const useEngineStore = create<EngineStore>((set, get) => ({
  info: null,
  installing: false,
  removing: false,
  installPhase: null,
  progress: null,
  partialDownloadBytes: 0,
  compileQueuedDuringInstall: false,
  compileQueuedExplicitly: false,
  installWaitNoticeOpen: false,
  installWaitNoticeShown: false,
  installed: [],
  userInstalled: [],
  systemInstalled: [],
  packageNotice: null,
  busyPkg: null,
  packageError: null,
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
    const request = ++packageReadRequest;
    const manager = get().info?.tlmgr;
    if (!manager) {
      set({ installed: [], userInstalled: [], systemInstalled: [], packageError: null });
      return;
    }
    try {
      const [system, user] = await Promise.all([
        tlmgrInstalled(),
        tlmgrInstalled(true).catch(() => [] as string[]),
      ]);
      if (request === packageReadRequest && get().info?.tlmgr === manager) {
        set({
          installed: [...new Set([...system, ...user])],
          userInstalled: [...new Set(user)],
          systemInstalled: [...new Set(system)],
          packageError: null,
        });
      }
    } catch (error) {
      if (request === packageReadRequest && get().info?.tlmgr === manager) {
        set({
          installed: [],
          userInstalled: [],
          systemInstalled: [],
          packageError: packageError(error, "read"),
        });
      }
    }
  },

  install: async () => {
    if (!isTauri() || get().installing) return;
    set({
      installing: true,
      installPhase: "download",
      progress: 0,
      installWaitNoticeOpen: false,
      installWaitNoticeShown: false,
    });
    try {
      const compile = await import("@/store/compile");
      if (compile.stopRunningCompileQuietly()) get().queueCompileAfterInstall();
    } catch (error) {
      void logError("pause compile for install", error);
    }
    let unlisten: (() => void) | null = null;
    try {
      unlisten = await listen<{
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
      const info = await installTinytex();
      set({ info, partialDownloadBytes: 0 });
      toast.successUnique(TINYTEX_INSTALL_TOAST_KEY, i18n.t(($) => $.core.tinytex.installed));
      void get().refreshPackages();
      if (get().compileQueuedDuringInstall) {
        const origin: CompileOrigin = get().compileQueuedExplicitly ? "explicit" : "automatic";
        set({
          compileQueuedDuringInstall: false,
          compileQueuedExplicitly: false,
          installWaitNoticeOpen: false,
        });
        const compile = await import("@/store/compile");
        void compile.useCompileStore.getState().recompile({ origin });
      }
    } catch (e) {
      void logError("install tinytex", e);
      const detail = e instanceof Error ? e.message : String(e);
      const state = await tinytexInstallState().catch(() => null);
      set({ partialDownloadBytes: state?.partial_download_bytes ?? 0 });
      // The backend message already says whether progress was kept; show it
      // verbatim instead of a generic apology.
      toast.errorUnique(
        TINYTEX_INSTALL_TOAST_KEY,
        detail || i18n.t(($) => $.core.tinytex.installFailed),
        {
          label: i18n.t(($) => $.core.tinytex.installGuide),
          onClick: () =>
            void import("@tauri-apps/plugin-shell").then((m) =>
              m.open("https://yihui.org/tinytex/"),
            ),
        },
      );
    } finally {
      unlisten?.();
      set({ installing: false, installPhase: null, progress: null });
    }
  },

  remove: async () => {
    if (!isTauri() || get().removing) return;
    set({ removing: true });
    try {
      await deleteTinytex();
      toast.successUnique(TINYTEX_REMOVE_TOAST_KEY, i18n.t(($) => $.core.tinytex.removed));
      set({ installed: [], userInstalled: [], systemInstalled: [], partialDownloadBytes: 0 });
      void get().refresh();
    } catch (e) {
      void logError("delete tinytex", e);
      toast.errorUnique(TINYTEX_REMOVE_TOAST_KEY, i18n.t(($) => $.core.tinytex.removeFailed));
    } finally {
      set({ removing: false });
    }
  },

  addPackage: async (name) => {
    if (!isTauri() || get().busyPkg) return;
    packageReadRequest += 1;
    set({ busyPkg: name, packageError: null, packageNotice: null });
    try {
      const outcome = await tlmgrInstall([name]);
      const notice = outcome ? ((await backendNotices(outcome))[0] ?? null) : null;
      if (notice) set({ packageNotice: notice });
      await get().refreshPackages();
    } catch (e) {
      void logError("tlmgr install", e);
      set({ packageError: packageError(e, "install", name) });
    } finally {
      set({ busyPkg: null });
    }
  },

  removePackage: async (name) => {
    if (!isTauri() || get().busyPkg) return;
    packageReadRequest += 1;
    const fromUserTree = get().userInstalled.includes(name);
    set({ busyPkg: name, packageError: null, packageNotice: null });
    try {
      await tlmgrRemove([name], fromUserTree);
      await get().refreshPackages();
    } catch (e) {
      void logError("tlmgr remove", e);
      set({ packageError: packageError(e, "remove", name) });
    } finally {
      set({ busyPkg: null });
    }
  },

  queueCompileAfterInstall: (origin = "explicit") => {
    const explicit = origin === "explicit";
    const compileQueuedExplicitly = get().compileQueuedExplicitly || explicit;
    if (!explicit || get().installWaitNoticeShown) {
      set({ compileQueuedDuringInstall: true, compileQueuedExplicitly });
      return;
    }
    set({
      compileQueuedDuringInstall: true,
      compileQueuedExplicitly,
      installWaitNoticeOpen: true,
      installWaitNoticeShown: true,
    });
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
      return progress != null
        ? i18n.t(($) => $.core.tinytex.phase.downloadingPercent, { progress })
        : i18n.t(($) => $.core.tinytex.phase.downloading);
    case "extract":
      return i18n.t(($) => $.core.tinytex.phase.unpacking);
    case "packages":
      return i18n.t(($) => $.core.tinytex.phase.addingPackages);
    default:
      return i18n.t(($) => $.core.tinytex.phase.installing);
  }
}
