import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import { isTauri } from "@tauri-apps/api/core";
import {
  latexEngineInfo,
  installTinytex,
  deleteTinytex,
  tlmgrInstalled,
  tlmgrInstall,
  tlmgrRemove,
  type EngineInfo,
} from "@/lib/tauri";
import { toast } from "@/lib/toast";
import { logError } from "@/lib/log";

interface EngineStore {
  info: EngineInfo | null;
  installing: boolean;
  progress: number | null;
  installed: string[];
  busyPkg: string | null;
  /** Whether engine info has been fetched at least once (so we cache it). */
  loaded: boolean;
  refresh: () => Promise<void>;
  /** Fetch engine info once; a no-op after the first successful load. */
  ensureLoaded: () => Promise<void>;
  refreshPackages: () => Promise<void>;
  install: () => Promise<void>;
  remove: () => Promise<void>;
  addPackage: (name: string) => Promise<void>;
  removePackage: (name: string) => Promise<void>;
}

export const useEngineStore = create<EngineStore>((set, get) => ({
  info: null,
  installing: false,
  progress: null,
  installed: [],
  busyPkg: null,
  loaded: false,

  refresh: async () => {
    if (!isTauri()) return;
    try {
      // Only fetch engine info here. The package list (a slow `tlmgr info` call)
      // is loaded separately by the Settings panel, never on the Preflight path.
      const info = await latexEngineInfo();
      set({ info, loaded: true });
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
    set({ installing: true, progress: 0 });
    const unlisten = await listen<{ received: number; total: number | null }>(
      "tinytex-download-progress",
      (e) => {
        const { received, total } = e.payload;
        set({ progress: total ? Math.round((received / total) * 100) : null });
      },
    );
    try {
      const info = await installTinytex();
      set({ info });
      toast.success("Tagging engine installed (TinyTeX)");
      void get().refreshPackages();
    } catch (e) {
      void logError("install tinytex", e);
      toast.error("Could not install the tagging engine. See the install guide.", {
        label: "Guide",
        onClick: () => void import("@tauri-apps/plugin-shell").then((m) => m.open("https://yihui.org/tinytex/")),
      });
    } finally {
      unlisten();
      set({ installing: false, progress: null });
    }
  },

  remove: async () => {
    if (!isTauri()) return;
    try {
      await deleteTinytex();
      toast.success("Removed TinyTeX");
      set({ installed: [] });
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
}));
