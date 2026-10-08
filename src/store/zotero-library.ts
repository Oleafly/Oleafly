import { create } from "zustand";
import type {
  ZoteroConnectionReport,
  ZoteroLibraryStatus,
} from "@oleafly/backend-port";
import { describeError } from "@/lib/app-error";
import { logError } from "@/lib/log";
import {
  zoteroLibraryKeys,
  zoteroLibrarySetEnabled,
  zoteroLibraryStatus,
  zoteroLibrarySync,
  zoteroLibraryTest,
} from "@/lib/tauri";
import { resetZoteroSearchCache } from "@/lib/zotero/search-client";
import { useSettingsStore } from "@/store/settings";

const FOCUS_COALESCE_MS = 2_000;

interface ZoteroLibraryState {
  status: ZoteroLibraryStatus | null;
  report: ZoteroConnectionReport | null;
  testing: boolean;
  testError: string | null;
  keysGeneration: number;
  load: () => Promise<void>;
  sync: (options?: { force?: boolean }) => Promise<void>;
  syncInBackground: () => void;
  test: () => Promise<void>;
  setEnabled: (libraryId: string, enabled: boolean) => Promise<void>;
  applyStatus: (status: ZoteroLibraryStatus) => void;
}

let keySet: ReadonlySet<string> = new Set();
let keysFor = -1;
let keysPending: Promise<void> | null = null;
let lastBackgroundSync = 0;

export function zoteroHasKey(key: string): boolean {
  return keySet.has(key);
}

export function zoteroKeyCount(): number {
  return keySet.size;
}

function offline(): boolean {
  return useSettingsStore.getState().offline;
}

function loadKeys(generation: number): void {
  if (generation === keysFor || keysPending) return;
  keysPending = zoteroLibraryKeys()
    .then((reply) => {
      keySet = new Set(reply.keys);
      keysFor = reply.generation;
      useZoteroLibraryStore.setState({ keysGeneration: reply.generation });
    })
    .catch((error) => {
      void logError("read Zotero citation keys", error);
    })
    .finally(() => {
      keysPending = null;
      const latest = useZoteroLibraryStore.getState().status?.generation;
      if (latest !== undefined && latest !== keysFor) loadKeys(latest);
    });
}

export const useZoteroLibraryStore = create<ZoteroLibraryState>((set, get) => ({
  status: null,
  report: null,
  testing: false,
  testError: null,
  keysGeneration: -1,
  applyStatus: (status) => {
    const previous = get().status;
    if (previous && previous.generation !== status.generation) resetZoteroSearchCache();
    set({ status });
    if (status.itemCount > 0) loadKeys(status.generation);
    else if (keySet.size > 0) {
      keySet = new Set();
      keysFor = status.generation;
      set({ keysGeneration: status.generation });
    }
  },
  load: async () => {
    try {
      get().applyStatus(await zoteroLibraryStatus());
    } catch (error) {
      void logError("read the Zotero library", error);
    }
  },
  sync: async (options = {}) => {
    try {
      get().applyStatus(await zoteroLibrarySync(offline(), options.force === true));
    } catch (error) {
      void logError("sync the Zotero library", error);
    }
  },
  syncInBackground: () => {
    const now = Date.now();
    if (now - lastBackgroundSync < FOCUS_COALESCE_MS) return;
    lastBackgroundSync = now;
    void get().sync();
  },
  test: async () => {
    set({ testing: true, testError: null });
    try {
      const report = await zoteroLibraryTest(offline());
      set({ report });
      if (!report.error) await get().sync({ force: true });
    } catch (error) {
      set({ testError: describeError(error) });
    } finally {
      set({ testing: false });
    }
  },
  setEnabled: async (libraryId, enabled) => {
    try {
      get().applyStatus(await zoteroLibrarySetEnabled(libraryId, enabled));
      if (enabled) await get().sync({ force: true });
    } catch (error) {
      void logError("choose Zotero libraries", error);
    }
  },
}));

export function resetZoteroLibraryForTest(): void {
  keySet = new Set();
  keysFor = -1;
  keysPending = null;
  lastBackgroundSync = 0;
  useZoteroLibraryStore.setState({
    status: null,
    report: null,
    testing: false,
    testError: null,
    keysGeneration: -1,
  });
}

export function setZoteroKeysForTest(keys: readonly string[], generation = 1): void {
  keySet = new Set(keys);
  keysFor = generation;
  useZoteroLibraryStore.setState({ keysGeneration: generation });
}
