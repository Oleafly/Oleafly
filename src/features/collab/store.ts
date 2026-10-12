import { create } from "zustand";
import {
  collabServerCodeSignIn,
  collabServerRefresh,
  collabServerRemove,
  collabServerSignIn,
  collabServerSignOut,
  collabServersList,
  type CollabErrorCode,
  type CollabServer,
  type CollabSignInCode,
} from "@/lib/tauri";
import { collabErrorCode } from "./errors";

export type CollabServersStatus = "idle" | "loading" | "ready" | "failed";
export type CollabServerAction = "signOut" | "remove";

interface CollabStore {
  servers: CollabServer[];
  status: CollabServersStatus;
  loadError: CollabErrorCode | null;
  pending: Readonly<Record<string, CollabServerAction>>;
  load: () => Promise<void>;
  signIn: (url: string, providerId: string, setupCode?: string) => Promise<CollabServer>;
  signInWithCode: (
    url: string,
    setupCode: string | undefined,
    onCode: (code: CollabSignInCode) => void,
  ) => Promise<CollabServer>;
  signOut: (serverId: string) => Promise<CollabErrorCode | null>;
  remove: (serverId: string) => Promise<CollabErrorCode | null>;
  refreshAccounts: () => Promise<void>;
}

let loadRequest = 0;

function withoutKey(
  pending: Readonly<Record<string, CollabServerAction>>,
  serverId: string,
): Record<string, CollabServerAction> {
  return Object.fromEntries(Object.entries(pending).filter(([id]) => id !== serverId));
}

function upsert(servers: readonly CollabServer[], next: CollabServer): CollabServer[] {
  return servers.some((entry) => entry.server_id === next.server_id)
    ? servers.map((entry) => (entry.server_id === next.server_id ? next : entry))
    : [...servers, next];
}

export const useCollabStore = create<CollabStore>((set, get) => ({
  servers: [],
  status: "idle",
  loadError: null,
  pending: {},
  load: async () => {
    const request = ++loadRequest;
    set((state) => ({ status: state.status === "ready" ? "ready" : "loading", loadError: null }));
    try {
      const servers = await collabServersList();
      if (request !== loadRequest) return;
      set({ servers, status: "ready", loadError: null });
    } catch (error) {
      if (request !== loadRequest) return;
      set({ status: "failed", loadError: collabErrorCode(error) });
    }
  },
  signIn: async (url, providerId, setupCode) => {
    const server = await collabServerSignIn(url, providerId, setupCode);
    loadRequest += 1;
    set((state) => ({ servers: upsert(state.servers, server), status: "ready", loadError: null }));
    return server;
  },
  signInWithCode: async (url, setupCode, onCode) => {
    const server = await collabServerCodeSignIn(url, setupCode, onCode);
    loadRequest += 1;
    set((state) => ({ servers: upsert(state.servers, server), status: "ready", loadError: null }));
    return server;
  },
  signOut: async (serverId) => {
    if (get().pending[serverId]) return null;
    set((state) => ({ pending: { ...state.pending, [serverId]: "signOut" } }));
    try {
      await collabServerSignOut(serverId);
      loadRequest += 1;
      set((state) => ({
        servers: state.servers.map((entry) =>
          entry.server_id === serverId ? { ...entry, account: null, signed_in: false } : entry,
        ),
        pending: withoutKey(state.pending, serverId),
      }));
      return null;
    } catch (error) {
      set((state) => ({ pending: withoutKey(state.pending, serverId) }));
      return collabErrorCode(error);
    }
  },
  remove: async (serverId) => {
    if (get().pending[serverId]) return null;
    set((state) => ({ pending: { ...state.pending, [serverId]: "remove" } }));
    try {
      await collabServerRemove(serverId);
      loadRequest += 1;
      set((state) => ({
        servers: state.servers.filter((entry) => entry.server_id !== serverId),
        pending: withoutKey(state.pending, serverId),
      }));
      return null;
    } catch (error) {
      set((state) => ({ pending: withoutKey(state.pending, serverId) }));
      return collabErrorCode(error);
    }
  },
  refreshAccounts: async () => {
    const signedIn = get().servers.filter((entry) => entry.signed_in);
    const results = await Promise.allSettled(signedIn.map((entry) => collabServerRefresh(entry.server_id)));
    const fresh = results.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
    if (fresh.length === 0) return;
    set((state) => ({ servers: fresh.reduce(upsert, state.servers) }));
  },
}));
