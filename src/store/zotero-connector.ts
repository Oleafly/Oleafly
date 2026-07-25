import { create } from "zustand";
import { getConnectorKey, setConnectorKey } from "@/lib/tauri";

interface ZoteroConnectorState {
  connected: boolean;
  loading: boolean;
  connect(userId: string, apiKey: string): Promise<void>;
  disconnect(): Promise<void>;
  refresh(): Promise<void>;
}

export const useZoteroConnectorStore = create<ZoteroConnectorState>((set) => ({
  connected: false,
  loading: false,
  refresh: async () => {
    set({ loading: true });
    try {
      const key = await getConnectorKey("zotero-api-key");
      set({ connected: !!key });
    } finally {
      set({ loading: false });
    }
  },
  connect: async (userId: string, apiKey: string) => {
    set({ loading: true });
    try {
      await setConnectorKey("zotero-user-id", userId);
      await setConnectorKey("zotero-api-key", apiKey);
      set({ connected: true });
    } finally {
      set({ loading: false });
    }
  },
  disconnect: async () => {
    set({ loading: true });
    try {
      await setConnectorKey("zotero-api-key", "");
      await setConnectorKey("zotero-user-id", "");
      set({ connected: false });
    } finally {
      set({ loading: false });
    }
  },
}));
