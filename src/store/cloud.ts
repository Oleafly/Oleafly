import { decodeAppError, describeError } from "@/lib/app-error";
import {
  cloudConnectBegin,
  cloudConnectCancel,
  cloudConnectPaste,
  cloudConnectWait,
  cloudDetails,
  cloudDisconnect,
  cloudDownloadProject,
  cloudProjectDismissConflicts,
  cloudProjectRemove,
  cloudProjectReplaceRemote,
  cloudProjectResolveHold,
  cloudProjectSetMode,
  cloudRemoveRemote,
  cloudSetDeviceName,
  cloudSetEnabled,
  cloudSettingsApplied,
  cloudSettingsDefer,
  cloudSettingsKeepLocal,
  cloudSettingsSync,
  cloudState,
  cloudSyncNow,
  type CloudDirtyFile,
  type CloudProgress,
  type CloudProject,
  type CloudSpace,
  type CloudState,
  type CloudStatus,
  type ConnectBegin,
  type SyncProjectReport,
  type SyncReport,
} from "@/lib/cloud";
import { i18n } from "@/i18n";
import { applyCloudSettings, gatherCloudSettings } from "@/lib/cloud-settings";
import { applyFolderChange } from "@/lib/external-file-changes";
import { logError } from "@/lib/log";
import { existingProjectFiles } from "@/lib/tauri";
import { toast } from "@/lib/toast";
import { useFilesStore } from "@/store/files";
import { open } from "@tauri-apps/plugin-shell";
import { create } from "zustand";

export type CloudConnection = "unknown" | CloudStatus;

const AUTO_SYNC_KEY = "oleafly.cloudSync.auto";
const LEGACY_INTERVAL_KEY = "oleafly.cloudSync.interval";

function readAutoSync(): boolean {
  try {
    const stored = localStorage.getItem(AUTO_SYNC_KEY);
    if (stored !== null) return stored !== "off";
    return localStorage.getItem(LEGACY_INTERVAL_KEY) !== "manual";
  } catch {
    return true;
  }
}

export type SettingsImportRequest = "awaitingConnect" | "resume" | null;

export type SettingsNavRequest = "data-cloud" | "general" | null;

export interface SettingsChoice {
  values: Record<string, unknown>;
  stamp: string;
  deferred: boolean;
}

export interface DownloadProgress {
  done: number;
  total: number;
}

interface CloudStoreState {
  navRequest: SettingsNavRequest;
  requestNav: (request: SettingsNavRequest) => void;
  autoSync: boolean;
  setAutoSync: (on: boolean) => void;
  progress: Record<string, CloudProgress>;
  noteProgress: (progress: CloudProgress) => void;
  resumedAt: Record<string, number>;
  status: CloudConnection;
  state: CloudState | null;
  loadError: string | null;
  space: CloudSpace | null;
  remote: CloudProject[];
  detailsLoaded: boolean;
  detailsError: string | null;
  connectFlow: ConnectBegin | null;
  connectBusy: boolean;
  pasteBusy: boolean;
  connectError: string | null;
  disconnecting: boolean;
  syncing: boolean;
  lastReport: SyncReport | null;
  syncError: string | null;
  failureStreak: number;
  applyingSettings: boolean;
  settingsChoice: SettingsChoice | null;
  settingsChoiceBusy: boolean;
  settingsChoiceError: string | null;
  settingsProblem: string | null;
  downloading: string[];
  downloadProgress: DownloadProgress | null;
  busyProjects: string[];
  libraryRevision: number;
  settingsImport: SettingsImportRequest;
  refresh: () => Promise<void>;
  refreshDetails: () => Promise<void>;
  retryDetails: () => Promise<void>;
  watchDetails: () => () => void;
  syncNow: (manual?: boolean) => Promise<void>;
  syncSettings: () => Promise<void>;
  setEnabled: (on: boolean) => Promise<void>;
  setDeviceName: (name: string) => Promise<string | null>;
  setProjectMode: (localId: string, mode: "sync" | "pause") => Promise<void>;
  resolveHold: (localId: string, choice: "restore" | "delete") => Promise<void>;
  dismissConflicts: (localId: string) => Promise<void>;
  replaceRemote: (localId: string) => Promise<void>;
  removeProject: (localId: string) => Promise<void>;
  removeRemote: (cloudId: string) => Promise<void>;
  downloadProject: (cloudId: string) => Promise<void>;
  downloadAll: () => Promise<void>;
  beginConnect: (paste: boolean) => Promise<void>;
  submitPasteCode: (code: string) => Promise<void>;
  cancelConnect: () => void;
  disconnect: () => Promise<boolean>;
  chooseSettings: (choice: "cloud" | "local") => Promise<void>;
  deferSettingsChoice: () => void;
  whileApplyingSettings: <T>(work: () => Promise<T>) => Promise<T>;
  settingsImported: (stamp: string) => Promise<void>;
  requestSettingsImport: () => void;
  takeSettingsImport: () => boolean;
  clearSettingsImport: () => void;
}

function withoutRoundProgress(
  progress: Record<string, CloudProgress>,
  downloading: readonly string[],
): Record<string, CloudProgress> {
  return Object.fromEntries(Object.entries(progress).filter(([cloudId]) => downloading.includes(cloudId)));
}

const SYNC_TOAST = "cloud-sync";
const ACTION_TOAST = "cloud-action";
const DOWNLOAD_TOAST = "cloud-download";
const RETRYABLE_CODES: ReadonlySet<string> = new Set(["cloud.network", "cloud.rate_limited", "cloud.server"]);
const TRANSIENT_CODES: ReadonlySet<string> = new Set([
  ...RETRYABLE_CODES,
  "cloud.local_io",
  "cloud.project_busy",
  "cloud.remote_busy",
  "cloud.verify_failed",
]);
const ACCOUNT_CODES: ReadonlySet<string> = new Set([
  "cloud.revoked",
  "cloud.quota_full",
  "cloud.not_connected",
  "cloud.disabled",
]);

let stateGeneration = 0;
let detailsGeneration = 0;
let accountGeneration = 0;
let flowGeneration = 0;
let syncInFlight: Promise<void> | null = null;
let settingsInFlight: Promise<void> | null = null;
let pasteInFlight = false;
let detailsViewers = 0;
let applyingDepth = 0;
let deferredStamp: string | null = null;

function rawError(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return String(error);
}

export function cloudErrorCode(error: string | null | undefined): string | null {
  if (!error) return null;
  return decodeAppError(error)?.code ?? null;
}

export function isRetryableCloudError(error: string | null | undefined): boolean {
  if (!error) return false;
  const code = cloudErrorCode(error);
  return code === null || RETRYABLE_CODES.has(code);
}

export function isLastingCloudError(error: string | null | undefined): boolean {
  const code = cloudErrorCode(error);
  return code !== null && !TRANSIENT_CODES.has(code);
}

export function projectNeedsAttention(project: CloudProject): boolean {
  return project.mode === "held" || isLastingCloudError(project.error) || project.conflictCopies.length > 0;
}

export function remoteBusyKey(cloudId: string): string {
  return `remote:${cloudId}`;
}

type AttentionSource = Pick<CloudStoreState, "status" | "state" | "settingsChoice" | "settingsProblem">;

export function cloudAttentionReasons(source: AttentionSource): string[] {
  const { status, state } = source;
  if (status === "revoked") return ["revoked"];
  if (status !== "connected" || !state?.enabled) return [];
  const reasons: string[] = [];
  if (state.quotaFull) reasons.push("quotaFull");
  const roundCode = cloudErrorCode(state.lastError);
  if (roundCode && isLastingCloudError(state.lastError) && !ACCOUNT_CODES.has(roundCode)) {
    reasons.push(`round:${roundCode}`);
  }
  if (source.settingsChoice?.deferred) reasons.push(`settings:${source.settingsChoice.stamp}`);
  if (source.settingsProblem) reasons.push(`settingsProblem:${cloudErrorCode(source.settingsProblem)}`);
  for (const project of state.projects) {
    if (!projectNeedsAttention(project)) continue;
    const code = cloudErrorCode(project.error) ?? "";
    reasons.push(`${project.localId ?? project.cloudId}:${project.mode}:${code}:${project.conflictCopies.length}`);
  }
  return reasons;
}

function portablePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.?\//, "");
}

export function collectDirtyFiles(): CloudDirtyFile[] {
  const { projectId, files } = useFilesStore.getState();
  if (!projectId) return [];
  return Object.entries(files)
    .filter(([, file]) => file.dirty)
    .map(([path]) => ({ localId: projectId, path: portablePath(path) }));
}

function dirtyFilesOf(localId: string): CloudDirtyFile[] {
  return collectDirtyFiles().filter((file) => file.localId === localId);
}

function settingsProblemOf(error: unknown): string | null {
  const raw = rawError(error);
  const code = cloudErrorCode(raw);
  return code !== null && isLastingCloudError(raw) && !ACCOUNT_CODES.has(code) ? raw : null;
}

async function applyChangesOnDisk(report: SyncProjectReport | null | undefined): Promise<void> {
  const projectId = useFilesStore.getState().projectId;
  if (!report || !projectId || report.localId !== projectId) return;
  if (!report.changedTruncated && report.changed.length === 0) return;
  const buffers = new Map(Object.keys(useFilesStore.getState().files).map((path) => [portablePath(path), path]));
  const changed = report.changed.map((path) => buffers.get(portablePath(path)) ?? path);
  const open = report.changedTruncated
    ? [...buffers.values()]
    : changed.filter((path) => buffers.has(portablePath(path)));
  const present = new Set(open.length > 0 ? await existingProjectFiles(projectId, open).catch(() => open) : []);
  const files = useFilesStore.getState();
  if (files.projectId !== projectId) return;
  const gone = new Set(open.filter((path) => !present.has(path)));
  for (const path of gone) files.applyExternalDelete(projectId, path);
  applyFolderChange({
    projectId,
    paths: changed.filter((path) => !gone.has(path)),
    rescan: report.changedTruncated,
    structural: true,
  });
}

async function followChangesOnDisk(report: SyncProjectReport | null | undefined): Promise<void> {
  try {
    await applyChangesOnDisk(report);
  } catch (error) {
    void logError("cloud refresh open files", error);
  }
}

function followRound(report: SyncReport | null): Promise<void> {
  const projectId = useFilesStore.getState().projectId;
  return followChangesOnDisk(report?.projects.find((project) => project.localId === projectId));
}

async function openInBrowser(url: string): Promise<void> {
  try {
    await open(url);
  } catch (error) {
    void logError("cloud open sign-in", error);
  }
}

async function cancelFlow(flowId: string): Promise<void> {
  try {
    await cloudConnectCancel(flowId);
  } catch (error) {
    void logError("cloud cancel connect", error);
  }
}

function changedOnThisComputer(report: SyncReport): boolean {
  return report.projects.some(
    (project) =>
      project.downloaded > 0 ||
      project.deletedLocal > 0 ||
      project.conflicts > 0 ||
      project.changed.length > 0 ||
      project.changedTruncated,
  );
}

function without(list: readonly string[], id: string): string[] {
  return list.filter((entry) => entry !== id);
}

export const useCloudStore = create<CloudStoreState>((set, get) => {
  const mutateState = (update: (state: CloudState) => CloudState) => {
    const current = get().state;
    if (!current) return;
    stateGeneration += 1;
    set({ state: update(current) });
  };

  const mutateProject = (localId: string, patch: Partial<CloudProject>) =>
    mutateState((state) => ({
      ...state,
      projects: state.projects.map((project) => (project.localId === localId ? { ...project, ...patch } : project)),
    }));

  const projectOf = (localId: string) => get().state?.projects.find((project) => project.localId === localId);

  const setBusy = (localId: string, busy: boolean) =>
    set((current) => ({
      busyProjects: busy ? [...without(current.busyProjects, localId), localId] : without(current.busyProjects, localId),
    }));

  const refreshLibrary = async () => {
    await useFilesStore
      .getState()
      .refreshProjects()
      .catch((error: unknown) => logError("cloud refresh library", error));
    set((current) => ({ libraryRevision: current.libraryRevision + 1 }));
  };

  const refreshDetailsIfWatched = () => {
    if (detailsViewers > 0) void get().refreshDetails();
  };

  const whileApplying = async <T>(work: () => Promise<T>): Promise<T> => {
    applyingDepth += 1;
    set({ applyingSettings: true });
    try {
      return await work();
    } finally {
      applyingDepth -= 1;
      if (applyingDepth === 0) set({ applyingSettings: false });
    }
  };

  const applyRemoteSettings = (values: Record<string, unknown>, stamp: string) =>
    whileApplying(async () => {
      const after = await applyCloudSettings(values);
      await cloudSettingsApplied(stamp, after);
    });

  const announceRound = (roundError: string | null, report: SyncReport | null) => {
    const problem = roundError ?? report?.projects.find((project) => project.error)?.error ?? null;
    if (problem) {
      toast.errorUnique(SYNC_TOAST, describeError(problem));
      return;
    }
    const held = report?.projects.filter((project) => project.held).length ?? 0;
    if (held > 0) {
      toast.infoUnique(SYNC_TOAST, i18n.t(($) => $.cloud.toast.syncedHeld, { count: held }));
      return;
    }
    toast.successUnique(SYNC_TOAST, i18n.t(($) => $.cloud.toast.synced));
  };

  const runRound = (manual: boolean, includeSettings: boolean): Promise<void> => {
    if (syncInFlight) return syncInFlight;
    const { status, state } = get();
    if (status !== "connected" || !state?.enabled) return Promise.resolve();
    const account = accountGeneration;
    const round = async () => {
      set({ syncing: true });
      let report: SyncReport | null = null;
      let roundError: string | null = null;
      try {
        report = await cloudSyncNow(collectDirtyFiles());
        roundError = report.error;
      } catch (error) {
        void logError("cloud sync", error);
        roundError = rawError(error);
      }
      if (account !== accountGeneration) return;
      const retryable = isRetryableCloudError(roundError);
      set((current) => ({
        lastReport: report ?? current.lastReport,
        syncError: roundError,
        failureStreak: retryable ? current.failureStreak + 1 : 0,
      }));
      if (report && changedOnThisComputer(report)) await refreshLibrary();
      await followRound(report);
      await get().refresh();
      if (includeSettings && !retryable && account === accountGeneration) await get().syncSettings();
      if (manual && account === accountGeneration) announceRound(roundError, report);
      refreshDetailsIfWatched();
    };
    syncInFlight = round().finally(() => {
      syncInFlight = null;
      set((current) => ({ syncing: false, progress: withoutRoundProgress(current.progress, current.downloading) }));
    });
    return syncInFlight;
  };

  const finishConnect = async () => {
    accountGeneration += 1;
    deferredStamp = null;
    set({
      connectFlow: null,
      connectBusy: false,
      pasteBusy: false,
      connectError: null,
      lastReport: null,
      syncError: null,
      failureStreak: 0,
      space: null,
      remote: [],
      detailsLoaded: false,
      detailsError: null,
      settingsChoice: null,
      settingsChoiceError: null,
      settingsProblem: null,
    });
    await get().refresh();
    if (get().settingsImport === "awaitingConnect") set({ settingsImport: "resume" });
    void runRound(false, get().settingsImport !== "resume");
  };

  const failConnect = (error: unknown) => {
    set((current) => ({
      connectFlow: null,
      connectBusy: false,
      pasteBusy: false,
      connectError: rawError(error),
      settingsImport: current.settingsImport === "resume" ? "resume" : null,
    }));
  };

  const downloadOne = async (
    cloudId: string,
  ): Promise<{ ok: true; restored: boolean } | { ok: false; error: string }> => {
    set((current) => ({ downloading: [...without(current.downloading, cloudId), cloudId] }));
    try {
      const done = await cloudDownloadProject(cloudId);
      set((current) => ({ remote: current.remote.filter((project) => project.cloudId !== cloudId) }));
      return { ok: true, restored: done.restored };
    } catch (error) {
      void logError("cloud download project", error);
      return { ok: false, error: rawError(error) };
    } finally {
      set((current) => {
        const { [cloudId]: _finished, ...progress } = current.progress;
        return { downloading: without(current.downloading, cloudId), progress };
      });
    }
  };

  const offerSettingsChoice = (values: Record<string, unknown>, stamp: string, deferred: boolean) => {
    const current = get().settingsChoice;
    if (current && !current.deferred) return;
    set({
      settingsChoice: { values, stamp, deferred: deferred || stamp === deferredStamp },
      settingsChoiceError: current?.stamp === stamp ? get().settingsChoiceError : null,
    });
  };

  const afterDownloads = async () => {
    await refreshLibrary();
    await get().refresh();
    refreshDetailsIfWatched();
  };

  return {
    navRequest: null,
    requestNav: (request) => set({ navRequest: request }),
    autoSync: readAutoSync(),
    setAutoSync: (on) => {
      try {
        localStorage.setItem(AUTO_SYNC_KEY, on ? "on" : "off");
        localStorage.removeItem(LEGACY_INTERVAL_KEY);
      } catch (error) {
        void logError("cloud save auto sync", error);
      }
      set({ autoSync: on });
    },
    progress: {},
    noteProgress: (progress) =>
      set((current) => ({
        progress: { ...current.progress, [progress.projectId ?? progress.cloudId]: progress },
      })),
    resumedAt: {},
    status: "unknown",
    state: null,
    loadError: null,
    space: null,
    remote: [],
    detailsLoaded: false,
    detailsError: null,
    connectFlow: null,
    connectBusy: false,
    pasteBusy: false,
    connectError: null,
    disconnecting: false,
    syncing: false,
    lastReport: null,
    syncError: null,
    failureStreak: 0,
    applyingSettings: false,
    settingsChoice: null,
    settingsChoiceBusy: false,
    settingsChoiceError: null,
    settingsProblem: null,
    downloading: [],
    downloadProgress: null,
    busyProjects: [],
    libraryRevision: 0,
    settingsImport: null,

    refresh: async () => {
      const generation = ++stateGeneration;
      try {
        const state = await cloudState();
        if (generation !== stateGeneration) return;
        set({ state, status: state.status, loadError: null });
      } catch (error) {
        if (generation !== stateGeneration) return;
        void logError("cloud state", error);
        set({ loadError: rawError(error) });
      }
    },

    refreshDetails: async () => {
      if (get().status !== "connected") return;
      const generation = ++detailsGeneration;
      const account = accountGeneration;
      try {
        const details = await cloudDetails();
        if (generation !== detailsGeneration || account !== accountGeneration) return;
        set((current) => ({
          space: details.space ?? (details.error ? current.space : null),
          remote: details.error && details.remote.length === 0 ? current.remote : details.remote,
          detailsLoaded: true,
          detailsError: details.error,
        }));
      } catch (error) {
        if (generation !== detailsGeneration || account !== accountGeneration) return;
        void logError("cloud details", error);
        set({ detailsLoaded: true, detailsError: rawError(error) });
      }
    },

    retryDetails: () => {
      set({ detailsLoaded: false, detailsError: null });
      return get().refreshDetails();
    },

    watchDetails: () => {
      detailsViewers += 1;
      void get().refreshDetails();
      let watching = true;
      return () => {
        if (!watching) return;
        watching = false;
        detailsViewers -= 1;
      };
    },

    syncNow: (manual = false) => runRound(manual, true),

    syncSettings: () => {
      if (settingsInFlight) return settingsInFlight;
      const { status, state, settingsChoice } = get();
      const asking = settingsChoice !== null && !settingsChoice.deferred;
      if (status !== "connected" || !state?.enabled || asking || applyingDepth > 0) {
        return Promise.resolve();
      }
      const account = accountGeneration;
      const exchange = async () => {
        try {
          const sent = await gatherCloudSettings();
          const outcome = await cloudSettingsSync(sent);
          if (account !== accountGeneration) return;
          if (get().settingsProblem) set({ settingsProblem: null });
          if (outcome.outcome === "choose") {
            offerSettingsChoice(outcome.values, outcome.stamp, outcome.deferred);
            return;
          }
          if (get().settingsChoice?.deferred) set({ settingsChoice: null, settingsChoiceError: null });
          if (outcome.outcome !== "apply") return;
          const latest = await gatherCloudSettings();
          if (account !== accountGeneration || JSON.stringify(latest) !== JSON.stringify(sent)) return;
          await applyRemoteSettings(outcome.values, outcome.stamp);
        } catch (error) {
          void logError("cloud settings sync", error);
          const problem = settingsProblemOf(error);
          if (problem && account === accountGeneration) set({ settingsProblem: problem });
        }
      };
      settingsInFlight = exchange().finally(() => {
        settingsInFlight = null;
      });
      return settingsInFlight;
    },

    setEnabled: async (on) => {
      const before = get().state;
      if (!before || before.enabled === on) return;
      mutateState((state) => ({ ...state, enabled: on }));
      try {
        await cloudSetEnabled(on);
      } catch (error) {
        void logError("cloud set enabled", error);
        mutateState((state) => ({ ...state, enabled: before.enabled }));
        toast.errorUnique(ACTION_TOAST, describeError(error));
        return;
      }
      await get().refresh();
      if (on) void get().syncNow(false);
    },

    setDeviceName: async (name) => {
      const before = get().state;
      if (!before) return null;
      const next = name.trim();
      if (next === before.deviceName) return null;
      mutateState((state) => ({ ...state, deviceName: next }));
      try {
        await cloudSetDeviceName(next);
      } catch (error) {
        mutateState((state) => ({ ...state, deviceName: before.deviceName }));
        return rawError(error);
      }
      await get().refresh();
      return null;
    },

    setProjectMode: async (localId, mode) => {
      const before = projectOf(localId);
      if (!before || get().busyProjects.includes(localId)) return;
      mutateProject(localId, { mode });
      setBusy(localId, true);
      try {
        await cloudProjectSetMode(localId, mode);
      } catch (error) {
        void logError("cloud set project mode", error);
        mutateProject(localId, { mode: before.mode });
        toast.errorUnique(ACTION_TOAST, describeError(error));
        return;
      } finally {
        setBusy(localId, false);
      }
      if (mode === "sync") {
        set((current) => ({ resumedAt: { ...current.resumedAt, [localId]: Date.now() } }));
      }
      await get().refresh();
      if (mode === "sync") void get().syncNow(false);
    },

    resolveHold: async (localId, choice) => {
      const project = projectOf(localId);
      if (!project || get().busyProjects.includes(localId)) return;
      setBusy(localId, true);
      try {
        const report = await cloudProjectResolveHold(localId, choice, dirtyFilesOf(localId));
        if (report.error) {
          toast.errorUnique(ACTION_TOAST, describeError(report.error));
        } else {
          toast.successUnique(
            ACTION_TOAST,
            choice === "restore"
              ? i18n.t(($) => $.cloud.toast.filesRestored, { name: project.name })
              : i18n.t(($) => $.cloud.toast.filesDeleted, { name: project.name }),
          );
        }
        if (report.downloaded > 0 || report.deletedLocal > 0) await refreshLibrary();
        await followChangesOnDisk(report);
      } catch (error) {
        void logError("cloud resolve hold", error);
        toast.errorUnique(ACTION_TOAST, describeError(error));
      } finally {
        setBusy(localId, false);
      }
      await get().refresh();
      refreshDetailsIfWatched();
    },

    dismissConflicts: async (localId) => {
      if (!projectOf(localId) || get().busyProjects.includes(localId)) return;
      setBusy(localId, true);
      try {
        await cloudProjectDismissConflicts(localId);
        mutateProject(localId, { conflictCopies: [], conflicts: 0 });
      } catch (error) {
        void logError("cloud dismiss conflict copies", error);
        toast.errorUnique(ACTION_TOAST, describeError(error));
      } finally {
        setBusy(localId, false);
      }
      await get().refresh();
    },

    replaceRemote: async (localId) => {
      const project = projectOf(localId);
      if (!project || get().busyProjects.includes(localId)) return;
      setBusy(localId, true);
      try {
        const report = await cloudProjectReplaceRemote(localId, dirtyFilesOf(localId));
        if (report.error) {
          toast.errorUnique(ACTION_TOAST, describeError(report.error));
        } else {
          toast.successUnique(
            ACTION_TOAST,
            i18n.t(($) => $.cloud.toast.replaced, { name: project.name }),
          );
        }
        await followChangesOnDisk(report);
      } catch (error) {
        void logError("cloud replace remote copy", error);
        toast.errorUnique(ACTION_TOAST, describeError(error));
      } finally {
        setBusy(localId, false);
      }
      await get().refresh();
      refreshDetailsIfWatched();
    },

    removeProject: async (localId) => {
      const project = projectOf(localId);
      if (!project || get().busyProjects.includes(localId)) return;
      setBusy(localId, true);
      try {
        await cloudProjectRemove(localId);
        toast.successUnique(
          ACTION_TOAST,
          i18n.t(($) => $.cloud.toast.removed, { name: project.name }),
        );
      } catch (error) {
        void logError("cloud remove project", error);
        toast.errorUnique(ACTION_TOAST, describeError(error));
      } finally {
        setBusy(localId, false);
      }
      await get().refresh();
      refreshDetailsIfWatched();
    },

    removeRemote: async (cloudId) => {
      const key = remoteBusyKey(cloudId);
      const project = get().remote.find((entry) => entry.cloudId === cloudId);
      if (!project || get().busyProjects.includes(key)) return;
      setBusy(key, true);
      try {
        await cloudRemoveRemote(cloudId);
        set((current) => ({ remote: current.remote.filter((entry) => entry.cloudId !== cloudId) }));
        toast.successUnique(
          ACTION_TOAST,
          i18n.t(($) => $.cloud.toast.removedRemote, { name: project.name }),
        );
      } catch (error) {
        void logError("cloud remove remote project", error);
        toast.errorUnique(ACTION_TOAST, describeError(error));
      } finally {
        setBusy(key, false);
      }
      await get().refresh();
      await get().refreshDetails();
    },

    downloadProject: async (cloudId) => {
      if (get().downloading.length > 0 || get().downloadProgress) return;
      const name = get().remote.find((project) => project.cloudId === cloudId)?.name ?? "";
      const result = await downloadOne(cloudId);
      if (result.ok) {
        toast.successUnique(
          DOWNLOAD_TOAST,
          result.restored
            ? i18n.t(($) => $.cloud.toast.restored, { name })
            : i18n.t(($) => $.cloud.toast.downloaded, { name }),
        );
      } else {
        toast.errorUnique(
          DOWNLOAD_TOAST,
          i18n.t(($) => $.cloud.toast.downloadFailed, {
            name,
            reason: describeError(result.error),
          }),
        );
      }
      await afterDownloads();
    },

    downloadAll: async () => {
      if (get().downloading.length > 0 || get().downloadProgress) return;
      const queue = get()
        .remote.filter((project) => project.mode === "download" && !project.recycled)
        .map((project) => project.cloudId);
      if (queue.length === 0) return;
      const account = accountGeneration;
      const total = queue.length;
      let done = 0;
      let failed = 0;
      set({ downloadProgress: { done, total } });
      await queue.reduce(async (previous, cloudId) => {
        await previous;
        if (account !== accountGeneration) return;
        const result = await downloadOne(cloudId);
        if (!result.ok) failed += 1;
        done += 1;
        set({ downloadProgress: { done, total } });
        if (result.ok) await get().refresh();
      }, Promise.resolve());
      set({ downloadProgress: null });
      if (account !== accountGeneration) return;
      if (failed === 0) {
        toast.successUnique(
          DOWNLOAD_TOAST,
          i18n.t(($) => $.cloud.toast.downloadedAll, { count: total }),
        );
      } else {
        toast.errorUnique(
          DOWNLOAD_TOAST,
          i18n.t(($) => $.cloud.toast.downloadedSome, { count: total, failed }),
        );
      }
      await afterDownloads();
    },

    beginConnect: async (paste) => {
      const generation = ++flowGeneration;
      let previous = get().connectFlow;
      set({ connectError: null, connectBusy: true });
      try {
        const begin = await cloudConnectBegin(paste);
        if (generation !== flowGeneration) {
          void cancelFlow(begin.flowId);
          return;
        }
        if (previous && previous.flowId !== begin.flowId) void cancelFlow(previous.flowId);
        previous = null;
        set({ connectFlow: begin, connectBusy: false });
        void openInBrowser(begin.authUrl);
        if (begin.paste) return;
        await cloudConnectWait(begin.flowId);
        if (generation !== flowGeneration) return;
        await finishConnect();
      } catch (error) {
        if (generation !== flowGeneration) return;
        void logError("cloud connect", error);
        if (previous) void cancelFlow(previous.flowId);
        failConnect(error);
      }
    },

    submitPasteCode: async (code) => {
      const flow = get().connectFlow;
      const trimmed = code.trim();
      if (pasteInFlight || !flow?.paste || !trimmed) return;
      pasteInFlight = true;
      const generation = flowGeneration;
      set({ pasteBusy: true, connectError: null });
      try {
        await cloudConnectPaste(flow.flowId, trimmed);
        if (generation !== flowGeneration) return;
        await finishConnect();
      } catch (error) {
        if (generation !== flowGeneration) return;
        void logError("cloud connect paste", error);
        set({ connectError: rawError(error) });
      } finally {
        pasteInFlight = false;
        if (generation === flowGeneration) set({ pasteBusy: false });
      }
    },

    cancelConnect: () => {
      flowGeneration += 1;
      const flow = get().connectFlow;
      if (flow) void cancelFlow(flow.flowId);
      set({ connectFlow: null, connectBusy: false, pasteBusy: false, connectError: null, settingsImport: null });
    },

    disconnect: async () => {
      if (get().disconnecting) return false;
      set({ disconnecting: true });
      try {
        await cloudDisconnect();
      } catch (error) {
        void logError("cloud disconnect", error);
        set({ disconnecting: false });
        toast.errorUnique(ACTION_TOAST, describeError(error));
        return false;
      }
      accountGeneration += 1;
      detailsGeneration += 1;
      deferredStamp = null;
      set({
        disconnecting: false,
        lastReport: null,
        syncError: null,
        connectError: null,
        failureStreak: 0,
        space: null,
        remote: [],
        detailsLoaded: false,
        detailsError: null,
        settingsChoice: null,
        settingsChoiceError: null,
        settingsProblem: null,
        downloadProgress: null,
        progress: {},
        resumedAt: {},
      });
      await get().refresh();
      return true;
    },

    chooseSettings: async (choice) => {
      const { settingsChoice: pending, settingsProblem, settingsChoiceBusy } = get();
      if (settingsChoiceBusy) return;
      if (choice === "cloud" ? !pending : !pending && !settingsProblem) return;
      set({ settingsChoiceBusy: true, settingsChoiceError: null });
      try {
        if (choice === "cloud" && pending) await applyRemoteSettings(pending.values, pending.stamp);
        else await cloudSettingsKeepLocal(await gatherCloudSettings());
        deferredStamp = null;
        set({ settingsChoice: null, settingsChoiceBusy: false, settingsProblem: null });
      } catch (error) {
        void logError("cloud settings choice", error);
        set({ settingsChoiceBusy: false, settingsChoiceError: rawError(error) });
      }
    },

    deferSettingsChoice: () => {
      const pending = get().settingsChoice;
      if (!pending || pending.deferred || get().settingsChoiceBusy) return;
      deferredStamp = pending.stamp;
      set({ settingsChoice: { ...pending, deferred: true }, settingsChoiceError: null });
      cloudSettingsDefer(pending.stamp).catch((error: unknown) => logError("cloud settings defer", error));
    },

    whileApplyingSettings: whileApplying,

    settingsImported: async (stamp) => {
      try {
        await cloudSettingsApplied(stamp, await gatherCloudSettings());
        deferredStamp = null;
        set({ settingsChoice: null, settingsChoiceError: null, settingsProblem: null });
      } catch (error) {
        void logError("cloud settings applied", error);
      }
    },

    requestSettingsImport: () => set({ settingsImport: "awaitingConnect" }),
    takeSettingsImport: () => {
      if (get().settingsImport !== "resume") return false;
      set({ settingsImport: null });
      return true;
    },
    clearSettingsImport: () => set({ settingsImport: null }),
  };
});
