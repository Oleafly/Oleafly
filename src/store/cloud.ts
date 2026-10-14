import { describeError } from "@/lib/app-error";
import {
  cloudConnectBegin,
  cloudConnectCancel,
  cloudConnectPaste,
  cloudConnectWait,
  cloudDisconnect,
  cloudDownloadProject,
  cloudProjectSetMode,
  cloudSetDeviceName,
  cloudSetEnabled,
  cloudSettingsSync,
  cloudState,
  cloudSyncNow,
  type CloudState,
  type SyncReport,
} from "@/lib/cloud";
import { i18n } from "@/i18n";
import { applyCloudSettings, gatherCloudSettings } from "@/lib/cloud-settings";
import { toast } from "@/lib/toast";
import { useFilesStore } from "@/store/files";
import { logError } from "@/lib/log";
import { open } from "@tauri-apps/plugin-shell";
import { create } from "zustand";

interface ConnectFlow {
  flowId: string;
  authUrl: string;
  paste: boolean;
}

interface CloudStoreState {
  status: "unknown" | "disconnected" | "connecting" | "connected";
  state: CloudState | null;
  loading: boolean;
  loadError: string | null;
  connectFlow: ConnectFlow | null;
  connectError: string | null;
  syncing: boolean;
  lastReport: SyncReport | null;
  syncError: string | null;
  pendingSettingsImport: boolean;
  requestSettingsImport: () => void;
  clearSettingsImport: () => void;
  refresh: () => Promise<void>;
  syncNow: (manual?: boolean) => Promise<void>;
  setProjectMode: (localId: string, mode: "sync" | "pause") => Promise<void>;
  downloadProject: (cloudId: string, name: string) => Promise<void>;
  beginConnect: (paste: boolean) => Promise<void>;
  submitPasteCode: (code: string) => Promise<void>;
  cancelConnect: () => void;
  disconnect: () => Promise<void>;
  setEnabled: (on: boolean) => Promise<void>;
  setDeviceName: (name: string) => Promise<void>;
}

let refreshInFlight: Promise<void> | null = null;
let syncInFlight: Promise<void> | null = null;
let flowGeneration = 0;

export const useCloudStore = create<CloudStoreState>((set, get) => ({
  status: "unknown",
  state: null,
  loading: false,
  loadError: null,
  connectFlow: null,
  connectError: null,
  syncing: false,
  lastReport: null,
  syncError: null,
  pendingSettingsImport: false,
  requestSettingsImport: () => set({ pendingSettingsImport: true }),
  clearSettingsImport: () => set({ pendingSettingsImport: false }),

  refresh: async () => {
    if (refreshInFlight) return refreshInFlight;
    refreshInFlight = (async () => {
      set({ loading: true, loadError: null });
      try {
        const state = await cloudState();
        set({
          state,
          status: get().connectFlow
            ? "connecting"
            : state.status === "connected"
              ? "connected"
              : "disconnected",
          loading: false,
        });
      } catch (e) {
        void logError("cloud refresh", e);
        set({ loading: false, loadError: describeError(e) });
      } finally {
        refreshInFlight = null;
      }
    })();
    return refreshInFlight;
  },

  beginConnect: async (paste) => {
    const gen = ++flowGeneration;
    set({ connectError: null, connectFlow: null, status: "connecting" });
    try {
      const begin = await cloudConnectBegin(paste);
      if (flowGeneration !== gen) {
        void cloudConnectCancel(begin.flowId);
        return;
      }
      set({ connectFlow: begin });
      void open(begin.authUrl);
      if (!begin.paste) {
        await cloudConnectWait(begin.flowId);
        if (flowGeneration !== gen) return;
        set({ connectFlow: null });
        await get().refresh();
        void get().syncNow();
      }
    } catch (e) {
      if (flowGeneration !== gen) return;
      set({
        connectFlow: null,
        connectError: describeError(e),
        status: get().state?.status === "connected" ? "connected" : "disconnected",
      });
    }
  },

  submitPasteCode: async (code) => {
    const flow = get().connectFlow;
    if (!flow || !code.trim()) return;
    const gen = flowGeneration;
    set({ connectError: null });
    try {
      await cloudConnectPaste(flow.flowId, code.trim());
      if (flowGeneration !== gen) return;
      set({ connectFlow: null });
      await get().refresh();
      void get().syncNow();
    } catch (e) {
      if (flowGeneration !== gen) return;
      set({ connectError: describeError(e) });
    }
  },

  cancelConnect: () => {
    flowGeneration += 1;
    const flow = get().connectFlow;
    if (flow) void cloudConnectCancel(flow.flowId);
    set({
      connectFlow: null,
      connectError: null,
      status: get().state?.status === "connected" ? "connected" : "disconnected",
    });
  },

  disconnect: async () => {
    set({ loading: true });
    try {
      await cloudDisconnect();
    } finally {
      set({ loading: false });
    }
    await get().refresh();
  },

  setEnabled: async (on) => {
    await cloudSetEnabled(on);
    await get().refresh();
  },

  setDeviceName: async (name) => {
    await cloudSetDeviceName(name);
    await get().refresh();
  },

  syncNow: async (manual = false) => {
    if (syncInFlight) return syncInFlight;
    if (get().status !== "connected" || !get().state?.enabled) return;
    syncInFlight = (async () => {
      set({ syncing: true, syncError: null });
      try {
        const report = await cloudSyncNow();
        const tweaked = report.projects.some(
          (project) => project.downloaded > 0 || project.deletedLocal > 0 || project.conflicts > 0,
        );
        const firstError = report.projects.find((project) => project.error)?.error ?? null;
        try {
          const { applied } = await cloudSettingsSync(await gatherCloudSettings());
          if (applied) await applyCloudSettings(applied);
        } catch (e) {
          void logError("cloud settings sync", e);
        }
        set({ lastReport: report, syncError: firstError });
        if (manual) {
          if (firstError) toast.error(firstError);
          else toast.success(i18n.t(($) => $.shell.settings.data.cloud.toastSynced));
        }
        if (tweaked) {
          await useFilesStore.getState().refreshProjects().catch(() => {});
        }
      } catch (e) {
        set({ syncError: describeError(e) });
        if (manual) toast.error(i18n.t(($) => $.shell.settings.data.cloud.toastSyncFailed));
      } finally {
        set({ syncing: false });
        syncInFlight = null;
      }
      await get().refresh();
    })();
    return syncInFlight;
  },

  setProjectMode: async (localId, mode) => {
    await cloudProjectSetMode(localId, mode);
    await get().refresh();
    if (mode === "sync") await get().syncNow();
  },

  downloadProject: async (cloudId, name) => {
    set({ syncing: true, syncError: null });
    try {
      await cloudDownloadProject(cloudId);
      await useFilesStore.getState().refreshProjects().catch(() => {});
      toast.success(i18n.t(($) => $.shell.settings.data.cloud.toastDownloaded, { name }));
    } catch (e) {
      void logError("cloud download project", e);
      set({ syncError: describeError(e) });
      toast.error(i18n.t(($) => $.shell.settings.data.cloud.toastDownloadFailed, { name }));
    } finally {
      set({ syncing: false });
    }
    await get().refresh();
  },
}));
