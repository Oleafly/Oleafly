import { useEffect } from "react";
import { create } from "zustand";
import {
  installTypstVersion,
  removeTypstVersion,
  setDefaultTypstVersion,
  typstToolchainStatus,
  type DocumentEngineDescriptor,
  type TypstInstallPhase,
  type TypstInstallProgress,
  type TypstToolchainStatus,
  type TypstVersionEntry,
} from "@/lib/tauri";
import { i18n } from "@/i18n";
import { describeError } from "@/lib/app-error";
import { logError } from "@/lib/log";
import { toast } from "@/lib/toast";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";

export const TYPST_SETTINGS_TARGET = "typst-versions";
const TOOLCHAIN_TOAST_KEY = "typst-toolchain";

export interface TypstInstallState {
  readonly version: string;
  readonly phase: TypstInstallPhase | "starting";
  readonly receivedBytes: number;
  readonly totalBytes: number;
}

interface TypstToolchainStore {
  status: TypstToolchainStatus | null;
  loading: boolean;
  loadFailed: boolean;
  install: TypstInstallState | null;
  busy: boolean;
  refresh: () => Promise<TypstToolchainStatus | null>;
  ensureLoaded: () => Promise<TypstToolchainStatus | null>;
  installVersion: (version: string) => Promise<boolean>;
  removeVersion: (version: string) => Promise<boolean>;
  setDefaultVersion: (version: string | null) => Promise<boolean>;
}

let statusRequest: Promise<TypstToolchainStatus | null> | null = null;
let statusGeneration = 0;

export function typstInstallPercent(install: Pick<TypstInstallState, "receivedBytes" | "totalBytes">): number | null {
  if (install.totalBytes <= 0) return null;
  return Math.max(0, Math.min(100, Math.floor((install.receivedBytes / install.totalBytes) * 100)));
}

export function typstInstallLabel(install: TypstInstallState): string {
  switch (install.phase) {
    case "starting":
      return i18n.t(($) => $.settings.engine.typst.progress.starting);
    case "downloading":
      return i18n.t(($) => $.settings.engine.typst.progress.downloading, {
        percent: typstInstallPercent(install) ?? 0,
      });
    case "verifying":
      return i18n.t(($) => $.settings.engine.typst.progress.verifying);
    case "extracting":
      return i18n.t(($) => $.settings.engine.typst.progress.extracting);
    case "done":
      return i18n.t(($) => $.settings.engine.typst.progress.done);
  }
}

export function installedTypstVersions(status: TypstToolchainStatus): TypstVersionEntry[] {
  return status.versions.filter((entry) => entry.sources.length > 0);
}

export function typstInstallBusy(
  install: TypstInstallState | null,
  status: TypstToolchainStatus | null,
): boolean {
  return install !== null || Boolean(status?.installing);
}

export function openTypstVersionSettings(): void {
  const settings = useSettingsStore.getState();
  settings.setSettingsInitialSection("engine");
  settings.setSettingsScrollTarget(TYPST_SETTINGS_TARGET);
  settings.setSettingsOpen(true);
}

function sameProgress(current: TypstInstallState, progress: TypstInstallProgress): boolean {
  return current.phase === progress.phase && typstInstallPercent(current) === typstInstallPercent(progress);
}

function reportFailure(scope: string, error: unknown, message: string): void {
  void logError(scope, error);
  toast.errorUnique(
    TOOLCHAIN_TOAST_KEY,
    i18n.t(($) => $.settings.engine.packages.error.withDetail, {
      message,
      detail: describeError(error),
    }),
  );
}

async function refreshOpenTypstEngine(): Promise<void> {
  const files = useFilesStore.getState();
  if (!files.projectId || files.engine.source_format !== "typst") return;
  await files.refreshEngine();
}

export const useTypstToolchainStore = create<TypstToolchainStore>((set, get) => {
  const applyStatus = (status: TypstToolchainStatus) => {
    statusGeneration++;
    set({ status, loading: false, loadFailed: false });
  };

  return {
    status: null,
    loading: false,
    loadFailed: false,
    install: null,
    busy: false,

    refresh: () => {
      if (statusRequest) return statusRequest;
      const generation = ++statusGeneration;
      set({ loading: true });
      const request = Promise.resolve()
        .then(() => typstToolchainStatus())
        .then((status) => {
          if (!status) throw new Error("The Typst toolchain status was empty.");
          if (generation === statusGeneration) set({ status, loading: false, loadFailed: false });
          return status;
        })
        .catch((error: unknown) => {
          void logError("read the Typst versions", error);
          if (generation === statusGeneration) set({ loading: false, loadFailed: true });
          return null;
        })
        .finally(() => {
          if (statusRequest === request) statusRequest = null;
        });
      statusRequest = request;
      return request;
    },

    ensureLoaded: () => {
      const { status } = get();
      return status ? Promise.resolve(status) : get().refresh();
    },

    installVersion: async (version) => {
      if (typstInstallBusy(get().install, get().status) || get().busy) return false;
      set({ install: { version, phase: "starting", receivedBytes: 0, totalBytes: 0 } });
      try {
        const status = await installTypstVersion(version, (progress) => {
          const current = get().install;
          if (progress.version !== version || current?.version !== version) return;
          if (sameProgress(current, progress)) return;
          set({
            install: {
              version,
              phase: progress.phase,
              receivedBytes: progress.receivedBytes,
              totalBytes: progress.totalBytes,
            },
          });
        });
        applyStatus(status);
        await refreshOpenTypstEngine();
        return true;
      } catch (error) {
        reportFailure(
          "install a Typst version",
          error,
          i18n.t(($) => $.settings.engine.typst.error.install, { version }),
        );
        void get().refresh();
        return false;
      } finally {
        set({ install: null });
      }
    },

    removeVersion: async (version) => {
      if (get().busy) return false;
      set({ busy: true });
      try {
        applyStatus(await removeTypstVersion(version));
        await refreshOpenTypstEngine();
        return true;
      } catch (error) {
        reportFailure(
          "remove a Typst version",
          error,
          i18n.t(($) => $.settings.engine.typst.error.remove, { version }),
        );
        void get().refresh();
        return false;
      } finally {
        set({ busy: false });
      }
    },

    setDefaultVersion: async (version) => {
      if (get().busy) return false;
      set({ busy: true });
      try {
        applyStatus(await setDefaultTypstVersion(version));
        await refreshOpenTypstEngine();
        return true;
      } catch (error) {
        reportFailure(
          "set the default Typst version",
          error,
          i18n.t(($) => $.settings.engine.typst.error.default),
        );
        void get().refresh();
        return false;
      } finally {
        set({ busy: false });
      }
    },
  };
});

function typstEngineKey(engine: DocumentEngineDescriptor | null | undefined): string | null {
  if (engine?.source_format !== "typst") return null;
  return [engine.typst_version ?? "", engine.typst_resolved?.version ?? "", engine.typst_missing ?? ""].join("|");
}

export function useTypstToolchainFor(
  engine: DocumentEngineDescriptor | null | undefined,
): TypstToolchainStatus | null {
  const status = useTypstToolchainStore((state) => state.status);
  const refresh = useTypstToolchainStore((state) => state.refresh);
  const key = typstEngineKey(engine);
  useEffect(() => {
    if (key !== null) void refresh();
  }, [key, refresh]);
  return key === null ? null : status;
}
