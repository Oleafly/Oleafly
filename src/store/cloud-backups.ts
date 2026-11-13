import { create } from "zustand";
import {
  type CloudBackupSettings,
  type CloudBackupState,
  type CloudBackupSummary,
  cloudBackupList,
  cloudBackupRun,
  cloudBackupSetSettings,
  cloudBackupState,
} from "@/lib/cloud-backups";
import { logError } from "@/lib/log";

interface CloudBackupStore {
  state: CloudBackupState | null;
  loadError: string | null;
  running: boolean;
  runError: string | null;
  backups: readonly CloudBackupSummary[] | null;
  listing: boolean;
  listError: string | null;
  load: () => Promise<void>;
  update: (patch: Partial<CloudBackupSettings>) => Promise<void>;
  runNow: (scheduled?: boolean) => Promise<void>;
  loadBackups: () => Promise<void>;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const useCloudBackupStore = create<CloudBackupStore>((set, get) => ({
  state: null,
  loadError: null,
  running: false,
  runError: null,
  backups: null,
  listing: false,
  listError: null,
  load: async () => {
    try {
      set({ state: await cloudBackupState(), loadError: null });
    } catch (error) {
      set({ loadError: message(error) });
    }
  },
  update: async (patch) => {
    const current = get().state;
    if (!current) return;
    const settings = { ...current.settings, ...patch };
    set({ state: { ...current, settings } });
    try {
      set({ state: await cloudBackupSetSettings(settings) });
    } catch (error) {
      set({ state: current, loadError: message(error) });
    }
  },
  runNow: async (scheduled = false) => {
    if (get().running) return;
    if (!scheduled) set({ running: true, runError: null });
    try {
      const run = await cloudBackupRun(scheduled);
      if (run.ran) {
        set({ runError: run.error });
        await get().load();
        if (get().backups !== null) await get().loadBackups();
      }
    } catch (error) {
      if (scheduled) void logError("run a scheduled cloud backup", error);
      else set({ runError: message(error) });
    } finally {
      if (!scheduled) set({ running: false });
    }
  },
  loadBackups: async () => {
    set({ listing: true, listError: null });
    try {
      set({ backups: await cloudBackupList() });
    } catch (error) {
      set({ listError: message(error) });
    } finally {
      set({ listing: false });
    }
  },
}));

export function resetCloudBackupStoreForTest(): void {
  useCloudBackupStore.setState({
    state: null,
    loadError: null,
    running: false,
    runError: null,
    backups: null,
    listing: false,
    listError: null,
  });
}
