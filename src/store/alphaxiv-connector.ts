import { create } from "zustand";
import { getConnectorKey, setConnectorKey } from "@/lib/tauri";

interface AlphaXivConnectorState {
  connected: boolean;
  loading: boolean;
  connect(apiKey: string): Promise<void>;
  disconnect(): Promise<void>;
  refresh(): Promise<void>;
}

export const useAlphaXivConnectorStore = create<AlphaXivConnectorState>((set) => ({
  connected: false,
  loading: false,
  refresh: async () => {
    set({ loading: true });
    try {
      const key = await getConnectorKey("alphaxiv");
      set({ connected: !!key });
    } finally {
      set({ loading: false });
    }
  },
  connect: async (apiKey: string) => {
    set({ loading: true });
    try {
      await setConnectorKey("alphaxiv", apiKey);
      set({ connected: true });
    } finally {
      set({ loading: false });
    }
  },
  disconnect: async () => {
    set({ loading: true });
    try {
      await setConnectorKey("alphaxiv", "");
      set({ connected: false });
    } finally {
      set({ loading: false });
    }
  },
}));
