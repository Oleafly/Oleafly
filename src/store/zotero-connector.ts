import { create } from "zustand";
import { i18n } from "@/i18n";
import { describeError } from "@/lib/app-error";
import { logError } from "@/lib/log";
import { zoteroWebAccount, zoteroWebConnect, zoteroWebDisconnect } from "@/lib/tauri";
import { useZoteroLibraryStore } from "@/store/zotero-library";

interface ZoteroConnectorState {
  connected: boolean;
  loading: boolean;
  username: string | null;
  userId: string | null;
  error: string | null;
  connect(userId: string, apiKey: string): Promise<boolean>;
  disconnect(): Promise<void>;
  refresh(): Promise<void>;
}

export const useZoteroConnectorStore = create<ZoteroConnectorState>((set) => ({
  connected: false,
  loading: false,
  username: null,
  userId: null,
  error: null,
  refresh: async () => {
    set({ loading: true, error: null });
    try {
      const account = await zoteroWebAccount();
      set({
        connected: account !== null,
        username: account?.username.trim() || null,
        userId: account?.userId ?? null,
      });
    } catch (error) {
      void logError("read the Zotero connection", error);
    } finally {
      set({ loading: false });
    }
  },
  connect: async (userId: string, apiKey: string) => {
    set({ loading: true, error: null });
    try {
      const account = await zoteroWebConnect(userId, apiKey);
      set({ connected: true, username: account.username || null, userId: account.userId });
      void useZoteroLibraryStore.getState().sync({ force: true });
      return true;
    } catch (error) {
      void logError("connect Zotero", error);
      set({ error: describeError(error) });
      return false;
    } finally {
      set({ loading: false });
    }
  },
  disconnect: async () => {
    set({ loading: true, error: null });
    try {
      await zoteroWebDisconnect();
      set({ connected: false, username: null, userId: null });
    } catch (error) {
      void logError("disconnect Zotero", error);
      set({ error: i18n.t(($) => $.settings.integrations.zotero.disconnectFailed) });
    } finally {
      set({ loading: false });
    }
  },
}));
