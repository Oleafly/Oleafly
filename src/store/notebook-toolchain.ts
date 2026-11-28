import { create } from "zustand";
import {
  installLanguageRuntime,
  installNotebookTool,
  installPythonPackages,
  installRPackages,
  notebookToolchainStatus,
  recheckNotebookToolchain,
  removeNotebookTool,
  type InstallableRuntime,
  type LanguageRuntime,
  type LanguageRuntimeName,
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

export type RuntimeTask = InstallableRuntime | "r-packages" | "python-packages";

export interface RuntimeTaskState {
  readonly phase: NotebookInstallPhase | "starting" | "opening" | "installing";
  readonly receivedBytes: number;
  readonly totalBytes: number;
}

type RuntimeTasks = Readonly<Partial<Record<RuntimeTask, RuntimeTaskState>>>;

export const RUNTIME_LABELS: Readonly<Record<LanguageRuntimeName, string>> = {
  r: "R",
  python: "Python",
  julia: "Julia",
};

export function runtimeIn(
  status: NotebookToolchainStatus | null,
  name: LanguageRuntimeName,
): LanguageRuntime | undefined {
  return status?.runtimes?.find((runtime) => runtime.name === name);
}

export function missingRuntimePackages(runtime: LanguageRuntime | undefined): string[] {
  return (runtime?.packages ?? []).filter((entry) => !entry.installed).map((entry) => entry.name);
}

export function runtimeTaskLabel(task: RuntimeTaskState): string {
  const { phase, receivedBytes, totalBytes } = task;
  if (phase === "opening") return i18n.t(($) => $.settings.engine.notebook.progress.opening);
  if (phase === "installing") return i18n.t(($) => $.settings.engine.notebook.progress.installing);
  return notebookInstallLabel({ tool: "quarto", phase, receivedBytes, totalBytes });
}

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
  runtimeTasks: RuntimeTasks;
  awaitingInstaller: readonly InstallableRuntime[];
  installRuntime: (runtime: InstallableRuntime) => Promise<boolean>;
  installRuntimePackages: (
    runtime: InstallableRuntime,
    packages: readonly string[],
    projectId?: string | null,
  ) => Promise<boolean>;
  recheck: () => Promise<NotebookToolchainStatus | null>;
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

function withoutTask(tasks: RuntimeTasks, task: RuntimeTask): RuntimeTasks {
  const next = { ...tasks };
  delete next[task];
  return next;
}

function reportRuntimeFailure(task: RuntimeTask, scope: string, error: unknown, message: string): void {
  void logError(scope, error);
  toast.errorUnique(
    `${TOOLCHAIN_TOAST_KEY}:${task}`,
    i18n.t(($) => $.settings.engine.packages.error.withDetail, {
      message,
      detail: describeError(error),
    }),
  );
}

let recheckOnFocus: (() => void) | null = null;
let lastFocusRecheck = 0;
const FOCUS_RECHECK_GAP_MS = 5_000;

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
    runtimeTasks: {},
    awaitingInstaller: [],

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

    recheck: async () => {
      try {
        const next = await recheckNotebookToolchain();
        applyStatus(next);
        const awaiting = get().awaitingInstaller.filter((runtime) => !runtimeIn(next, runtime)?.path);
        set({ awaitingInstaller: awaiting });
        if (awaiting.length === 0 && recheckOnFocus) {
          window.removeEventListener("focus", recheckOnFocus);
          recheckOnFocus = null;
        }
        return next;
      } catch (error) {
        void logError("check the notebook languages again", error);
        return null;
      }
    },

    installRuntime: async (runtime) => {
      if (get().runtimeTasks[runtime]) return false;
      const begin: RuntimeTaskState = { phase: "starting", receivedBytes: 0, totalBytes: 0 };
      set({ runtimeTasks: { ...get().runtimeTasks, [runtime]: begin } });
      try {
        await installLanguageRuntime(runtime, (progress) => {
          if (progress.runtime !== runtime || !get().runtimeTasks[runtime]) return;
          const phase = progress.phase === "done" ? "opening" : progress.phase;
          set({
            runtimeTasks: {
              ...get().runtimeTasks,
              [runtime]: { phase, receivedBytes: progress.receivedBytes, totalBytes: progress.totalBytes },
            },
          });
        });
        if (!get().awaitingInstaller.includes(runtime)) {
          set({ awaitingInstaller: [...get().awaitingInstaller, runtime] });
        }
        if (!recheckOnFocus) {
          recheckOnFocus = () => {
            const now = Date.now();
            if (now - lastFocusRecheck < FOCUS_RECHECK_GAP_MS) return;
            lastFocusRecheck = now;
            void get().recheck();
          };
          window.addEventListener("focus", recheckOnFocus);
        }
        return true;
      } catch (error) {
        reportRuntimeFailure(
          runtime,
          "download a language installer",
          error,
          i18n.t(($) => $.settings.engine.notebook.error.install, { tool: RUNTIME_LABELS[runtime] }),
        );
        return false;
      } finally {
        set({ runtimeTasks: withoutTask(get().runtimeTasks, runtime) });
      }
    },

    installRuntimePackages: async (runtime, packages, projectId = null) => {
      const task: RuntimeTask = runtime === "r" ? "r-packages" : "python-packages";
      if (get().runtimeTasks[task] || packages.length === 0) return false;
      const working: RuntimeTaskState = { phase: "installing", receivedBytes: 0, totalBytes: 0 };
      set({ runtimeTasks: { ...get().runtimeTasks, [task]: working } });
      try {
        applyStatus(
          runtime === "r" ? await installRPackages(projectId, packages) : await installPythonPackages(projectId, packages),
        );
        return true;
      } catch (error) {
        reportRuntimeFailure(
          task,
          "install packages for a notebook language",
          error,
          i18n.t(($) => $.settings.engine.notebook.error.install, { tool: packages.join(", ") }),
        );
        void get().refresh();
        return false;
      } finally {
        set({ runtimeTasks: withoutTask(get().runtimeTasks, task) });
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
