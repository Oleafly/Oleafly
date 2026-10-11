import { create } from "zustand";
import {
  collabServerRemove,
  collabServerSignIn,
  collabServerSignOut,
  collabServersList,
  type CollabErrorCode,
  type CollabServer,
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
  signOut: (serverId: string) => Promise<CollabErrorCode | null>;
  remove: (serverId: string) => Promise<CollabErrorCode | null>;
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
}));
