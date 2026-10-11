import { create } from "zustand";
import { installFontComponent, listFontComponents, type ComponentInfo } from "@/lib/tauri";
import { logError } from "@/lib/log";

type Status = "idle" | "loading" | "ready" | "error";

interface FontPacksState {
  packs: ComponentInfo[];
  status: Status;
  installing: string | null;
  load: () => Promise<void>;
  install: (id: string) => Promise<boolean>;
}

export const useFontPacksStore = create<FontPacksState>((set, get) => ({
  packs: [],
  status: "idle",
  installing: null,
  load: async () => {
    if (get().status === "loading") return;
    set({ status: "loading" });
    try {
      set({ packs: await listFontComponents(), status: "ready" });
    } catch (error) {
      void logError("list font packs", error);
      set({ status: "error" });
    }
  },
  install: async (id) => {
    if (get().installing) return false;
    set({ installing: id });
    try {
      await installFontComponent(id);
      set({ packs: await listFontComponents(), status: "ready" });
      return true;
    } catch (error) {
      void logError("install font pack", error);
      return false;
    } finally {
      set({ installing: null });
    }
  },
}));
