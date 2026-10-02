import { create } from "zustand";
import { i18n } from "@/i18n";
import { describeError } from "@/lib/app-error";
import { logError } from "@/lib/log";
import { getConnectorKey, setConnectorKey, zoteroVerify } from "@/lib/tauri";

export const ZOTERO_USER_ID_KEY = "zotero-user-id";
export const ZOTERO_API_KEY_KEY = "zotero-api-key";
export const ZOTERO_USERNAME_KEY = "zotero-username";

interface ZoteroConnectorState {
  connected: boolean;
  loading: boolean;
  username: string | null;
  error: string | null;
  connect(userId: string, apiKey: string): Promise<boolean>;
  disconnect(): Promise<void>;
  refresh(): Promise<void>;
}

async function forgetSaved(): Promise<void> {
  await setConnectorKey(ZOTERO_API_KEY_KEY, "");
  await setConnectorKey(ZOTERO_USER_ID_KEY, "");
  await setConnectorKey(ZOTERO_USERNAME_KEY, "");
}

export const useZoteroConnectorStore = create<ZoteroConnectorState>((set) => ({
  connected: false,
  loading: false,
  username: null,
  error: null,
  refresh: async () => {
    set({ loading: true, error: null });
    try {
      const [key, username] = await Promise.all([
        getConnectorKey(ZOTERO_API_KEY_KEY),
        getConnectorKey(ZOTERO_USERNAME_KEY),
      ]);
      const connected = Boolean(key?.trim());
      set({ connected, username: connected ? username?.trim() || null : null });
    } catch (error) {
      void logError("read the Zotero connection", error);
    } finally {
      set({ loading: false });
    }
  },
  connect: async (userId: string, apiKey: string) => {
    set({ loading: true, error: null });
    try {
      const account = await zoteroVerify(userId, apiKey);
      try {
        await setConnectorKey(ZOTERO_USER_ID_KEY, account.userId);
        await setConnectorKey(ZOTERO_USERNAME_KEY, account.username);
        await setConnectorKey(ZOTERO_API_KEY_KEY, apiKey);
      } catch (error) {
        await forgetSaved().catch(() => undefined);
        throw error;
      }
      set({ connected: true, username: account.username || null });
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
      await forgetSaved();
      set({ connected: false, username: null });
    } catch (error) {
      void logError("disconnect Zotero", error);
      set({ error: i18n.t(($) => $.settings.integrations.zotero.disconnectFailed) });
    } finally {
      set({ loading: false });
    }
  },
}));
