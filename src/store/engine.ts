import { create } from "zustand";
import { isTauri } from "@tauri-apps/api/core";
import { open as openUrl } from "@tauri-apps/plugin-shell";
import {
  cancelIsolatedCompile,
  latexEngineInfo,
  installTinytex,
  cancelTinytexInstall,
  deleteTinytex,
  tinytexInstallState,
  tlmgrInstalled,
  tlmgrInstall,
  tlmgrRemove,
  withEventListener,
  type EngineInfo,
  type EngineRescan,
} from "@/lib/tauri";
import { toast } from "@/lib/toast";
import { logError } from "@/lib/log";
import { i18n } from "@/i18n";
import { decodeAppError, describeError, errorText } from "@/lib/app-error";
import type { CompileOrigin } from "@/store/compile";

export type PackageErrorKind = "install" | "read" | "remove";

export interface PackageError {
  kind: PackageErrorKind;
  name: string;
  detail: string;
}

function errorDetail(error: unknown): string {
  if (error instanceof Error) return errorText(error.message);
  return typeof error === "string" ? errorText(error) : "";
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
const TINYTEX_INSTALL_CANCELLED = "tex.tinytex_install_cancelled";
const TINYTEX_FAILURES_RETRY_CANNOT_FIX = new Set([
  "tex.tinytex_path_not_ascii",
  "tex.tinytex_unsupported_platform",
]);

function installFailureText(error: unknown): string {
  const message = i18n.t(($) => $.core.tinytex.installFailed);
  if (decodeAppError(error)) {
    return i18n.t(($) => $.settings.engine.packages.error.withDetail, {
      message,
      detail: describeError(error),
    });
  }
  return (error instanceof Error ? error.message : String(error)) || message;
}

function installFailureAction(error: unknown, retry: () => void) {
  const code = decodeAppError(error)?.code;
  if (code && !TINYTEX_FAILURES_RETRY_CANNOT_FIX.has(code)) {
    return { label: i18n.t(($) => $.core.tinytex.tryAgain), onClick: retry };
  }
  return {
    label: i18n.t(($) => $.core.tinytex.installGuide),
    onClick: () => void openUrl("https://yihui.org/tinytex/"),
  };
}

async function releaseWaitingCompile(reason: string): Promise<void> {
  try {
    const compile = await import("@/store/compile");
    compile.endTinytexWait(reason);
  } catch (error) {
    void logError("end compile wait", error);
  }
}

export async function duringPackageOperation<T>(run: () => Promise<T>): Promise<T> {
  useEngineStore.setState((state) => ({ packageOperations: state.packageOperations + 1 }));
  try {
    return await run();
  } finally {
    useEngineStore.setState((state) => ({ packageOperations: Math.max(0, state.packageOperations - 1) }));
  }
}

interface EngineStore {
  info: EngineInfo | null;
  installing: boolean;
  cancellingInstall: boolean;
  removing: boolean;
  installPhase: InstallPhase | null;
  progress: number | null;
  partialDownloadBytes: number;
  compileQueuedDuringInstall: boolean;
  compileQueuedExplicitly: boolean;
  installWaitNoticeOpen: boolean;
  installWaitNoticeShown: boolean;
  installed: string[];
  userInstalled: string[];
  systemInstalled: string[];
  packageNotice: string | null;
  busyPkg: string | null;
  packageOperations: number;
  packageError: PackageError | null;
  loaded: boolean;
  refresh: (options?: { rescan?: EngineRescan }) => Promise<void>;
  ensureLoaded: () => Promise<void>;
  refreshPackages: () => Promise<void>;
  install: () => Promise<void>;
  cancelInstall: () => Promise<void>;
  remove: () => Promise<void>;
  addPackage: (name: string) => Promise<void>;
  removePackage: (name: string) => Promise<void>;
  queueCompileAfterInstall: (origin?: CompileOrigin) => void;
  closeInstallWaitNotice: () => void;
}

export const useEngineStore = create<EngineStore>((set, get) => ({
  info: null,
  installing: false,
  cancellingInstall: false,
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
  packageOperations: 0,
  packageError: null,
  loaded: false,

  refresh: async (options) => {
    if (!isTauri()) return;
    try {
      // Only fetch engine info here. The package list (a slow `tlmgr info` call)
      // is loaded separately by the Settings panel, never on the Preflight path.
      const info = await latexEngineInfo(options?.rescan);
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
      await cancelIsolatedCompile();
    } catch (error) {
      void logError("pause compile for install", error);
    }
    try {
      const info = await withEventListener(
        "tinytex-install-progress",
        ({ phase, received, total }: { phase: InstallPhase; received: number; total: number | null }) => {
          set({
            installPhase: phase,
            progress:
              phase === "download" && total
                ? Math.round((received / total) * 100)
                : null,
          });
        },
        installTinytex,
      );
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
      const cancelled = decodeAppError(e)?.code === TINYTEX_INSTALL_CANCELLED;
      if (!cancelled) void logError("install tinytex", e);
      const state = await tinytexInstallState().catch(() => null);
      set({
        partialDownloadBytes: state?.partial_download_bytes ?? 0,
        compileQueuedDuringInstall: false,
        compileQueuedExplicitly: false,
        installWaitNoticeOpen: false,
      });
      const reason = cancelled ? describeError(e) : installFailureText(e);
      if (cancelled) {
        toast.infoUnique(TINYTEX_INSTALL_TOAST_KEY, reason);
      } else {
        toast.errorUnique(
          TINYTEX_INSTALL_TOAST_KEY,
          reason,
          installFailureAction(e, () => void get().install()),
        );
      }
      await releaseWaitingCompile(reason);
    } finally {
      set({ installing: false, cancellingInstall: false, installPhase: null, progress: null });
    }
  },

  cancelInstall: async () => {
    if (!isTauri() || !get().installing || get().cancellingInstall) return;
    set({ cancellingInstall: true });
    try {
      await cancelTinytexInstall();
    } catch (error) {
      set({ cancellingInstall: false });
      void logError("cancel tinytex install", error);
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
      const outcome = await duringPackageOperation(() => tlmgrInstall([name]));
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
      await duringPackageOperation(() => tlmgrRemove([name], fromUserTree));
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
