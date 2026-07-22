import { create } from "zustand";
import type { Venue } from "@/lib/deadlines";
import { logError } from "@/lib/log";
import { readDeadlines, refreshDeadlines } from "@/lib/tauri";

interface DeadlinesState {
  open: boolean;
  venues: Venue[] | null;
  generatedAt: string | null;
  busy: boolean;
  error: string | null;
  openView: () => Promise<void>;
  refresh: () => Promise<void>;
  close: () => void;
}

async function load(): Promise<{ venues: Venue[]; generatedAt: string | null }> {
  const raw = await readDeadlines();
  const parsed = JSON.parse(raw) as { generated_at?: string; venues?: Venue[] };
  return {
    venues: Array.isArray(parsed.venues) ? parsed.venues : [],
    generatedAt: parsed.generated_at || null,
  };
}

export const useDeadlinesStore = create<DeadlinesState>((set) => ({
  open: false,
  venues: null,
  generatedAt: null,
  busy: false,
  error: null,
  openView: async () => {
    set({ open: true, error: null });
    try {
      const { venues, generatedAt } = await load();
      set({ venues, generatedAt });
    } catch (e) {
      logError("deadlines", e);
      set({ error: String(e), venues: [] });
    }
  },
  refresh: async () => {
    set({ busy: true, error: null });
    try {
      await refreshDeadlines();
      const { venues, generatedAt } = await load();
      set({ venues, generatedAt, busy: false });
    } catch (e) {
      logError("deadlines", e);
      set({ busy: false, error: String(e) });
    }
  },
  close: () => set({ open: false }),
}));
