import { create } from "zustand";
import {
  installNotebookTool,
  notebookToolchainStatus,
  removeNotebookTool,
  type NotebookInstallPhase,
  type NotebookInstallProgress,
  type NotebookTool,
  type NotebookToolchainStatus,
} from "@/lib/notebook-commands";
import { i18n } from "@/i18n";
import { describeError } from "@/lib/app-error";
import { logError } from "@/lib/log";
import { toast } from "@/lib/toast";
import { useSettingsStore } from "@/store/settings";

export const QUARTO_SETTINGS_TARGET = "quarto-engine";
export const CALEPIN_SETTINGS_TARGET = "calepin-engine";

export const NOTEBOOK_TOOL_LABELS: Readonly<Record<NotebookTool, string>> = {
  quarto: "Quarto",
  calepin: "Calepin",
};

const SETTINGS_TARGETS: Readonly<Record<NotebookTool, string>> = {
  quarto: QUARTO_SETTINGS_TARGET,
  calepin: CALEPIN_SETTINGS_TARGET,
};

export function notebookToolForSettingsTarget(target: string | null): NotebookTool | null {
  if (target === QUARTO_SETTINGS_TARGET) return "quarto";
  if (target === CALEPIN_SETTINGS_TARGET) return "calepin";
  return null;
}

export interface NotebookInstallState {
  readonly tool: NotebookTool;
  readonly phase: NotebookInstallPhase | "starting";
  readonly receivedBytes: number;
  readonly totalBytes: number;
}

type NotebookInstalls = Readonly<Partial<Record<NotebookTool, NotebookInstallState>>>;

interface NotebookToolchainStore {
  status: NotebookToolchainStatus | null;
  loading: boolean;
  loadFailed: boolean;
  installs: NotebookInstalls;
  removing: NotebookTool | null;
  refresh: () => Promise<NotebookToolchainStatus | null>;
  ensureLoaded: () => Promise<NotebookToolchainStatus | null>;
  install: (tool: NotebookTool) => Promise<boolean>;
  remove: (tool: NotebookTool) => Promise<boolean>;
}

const TOOLCHAIN_TOAST_KEY = "notebook-toolchain";
let statusRequest: Promise<NotebookToolchainStatus | null> | null = null;
let statusGeneration = 0;

export function notebookInstallPercent(
  install: Pick<NotebookInstallState, "receivedBytes" | "totalBytes">,
): number | null {
  if (install.totalBytes <= 0) return null;
  return Math.max(0, Math.min(100, Math.floor((install.receivedBytes / install.totalBytes) * 100)));
}

export function notebookInstallLabel(install: NotebookInstallState): string {
  switch (install.phase) {
    case "starting":
      return i18n.t(($) => $.settings.engine.notebook.progress.starting);
    case "downloading":
      return i18n.t(($) => $.settings.engine.notebook.progress.downloading, {
        percent: notebookInstallPercent(install) ?? 0,
      });
    case "verifying":
      return i18n.t(($) => $.settings.engine.notebook.progress.verifying);
    case "extracting":
      return i18n.t(($) => $.settings.engine.notebook.progress.extracting);
    case "done":
      return i18n.t(($) => $.settings.engine.notebook.progress.done);
  }
}

export function notebookToolBusy(
  tool: NotebookTool,
  installs: NotebookInstalls,
  status: NotebookToolchainStatus | null,
  removing: NotebookTool | null = null,
): boolean {
  return installs[tool] !== undefined || removing === tool || Boolean(status?.[tool].installing);
}

export function openNotebookToolSettings(tool: NotebookTool): void {
  const settings = useSettingsStore.getState();
  settings.setSettingsInitialSection("engine");
  settings.setSettingsScrollTarget(SETTINGS_TARGETS[tool]);
  settings.setSettingsOpen(true);
}

function sameProgress(current: NotebookInstallState, progress: NotebookInstallProgress): boolean {
  return current.phase === progress.phase && notebookInstallPercent(current) === notebookInstallPercent(progress);
}

function reportFailure(tool: NotebookTool, scope: string, error: unknown, message: string): void {
  void logError(scope, error);
  toast.errorUnique(
    `${TOOLCHAIN_TOAST_KEY}:${tool}`,
    i18n.t(($) => $.settings.engine.packages.error.withDetail, {
      message,
      detail: describeError(error),
    }),
  );
}

function withoutInstall(installs: NotebookInstalls, tool: NotebookTool): NotebookInstalls {
  const next = { ...installs };
  delete next[tool];
  return next;
}

export const useNotebookToolchainStore = create<NotebookToolchainStore>((set, get) => {
  const applyStatus = (status: NotebookToolchainStatus) => {
    statusGeneration++;
    set({ status, loading: false, loadFailed: false });
  };

  return {
    status: null,
    loading: false,
    loadFailed: false,
    installs: {},
    removing: null,

    refresh: () => {
      if (statusRequest) return statusRequest;
      const generation = ++statusGeneration;
      set({ loading: true });
      const request = Promise.resolve()
        .then(() => notebookToolchainStatus())
        .then((status) => {
          if (!status) throw new Error("The notebook toolchain status was empty.");
          if (generation === statusGeneration) set({ status, loading: false, loadFailed: false });
          return status;
        })
        .catch((error: unknown) => {
          void logError("read the notebook tools", error);
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

    install: async (tool) => {
      const { installs, status, removing } = get();
      if (notebookToolBusy(tool, installs, status, removing)) return false;
      set({
        installs: { ...installs, [tool]: { tool, phase: "starting", receivedBytes: 0, totalBytes: 0 } },
      });
      try {
        const next = await installNotebookTool(tool, (progress) => {
          const current = get().installs[tool];
          if (progress.tool !== tool || !current) return;
          if (sameProgress(current, progress)) return;
          set({
            installs: {
              ...get().installs,
              [tool]: {
                tool,
                phase: progress.phase,
                receivedBytes: progress.receivedBytes,
                totalBytes: progress.totalBytes,
              },
            },
          });
        });
        applyStatus(next);
        return true;
      } catch (error) {
        reportFailure(
          tool,
          "install a notebook tool",
          error,
          i18n.t(($) => $.settings.engine.notebook.error.install, { tool: NOTEBOOK_TOOL_LABELS[tool] }),
        );
        void get().refresh();
        return false;
      } finally {
        set({ installs: withoutInstall(get().installs, tool) });
      }
    },

    remove: async (tool) => {
      const { installs, status, removing } = get();
      if (removing !== null || notebookToolBusy(tool, installs, status)) return false;
      set({ removing: tool });
      try {
        applyStatus(await removeNotebookTool(tool));
        return true;
      } catch (error) {
        reportFailure(
          tool,
          "remove a notebook tool",
          error,
          i18n.t(($) => $.settings.engine.notebook.error.remove, { tool: NOTEBOOK_TOOL_LABELS[tool] }),
        );
        void get().refresh();
        return false;
      } finally {
        set({ removing: null });
      }
    },
  };
});
