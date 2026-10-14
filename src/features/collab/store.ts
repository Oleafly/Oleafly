import { create } from "zustand";
import {
  collabServerCodeSignIn,
  collabServerRefresh,
  collabServerRemove,
  collabServerSignIn,
  collabServerSignOut,
  collabServersList,
  type CollabErrorCode,
  type CollabDetachedProject,
  type CollabServer,
  type CollabSignInCode,
  type CollabSignOut,
  type CollabUnsentProject,
} from "@/lib/tauri";
import { collabErrorCode } from "./errors";
import { followLocalCopies } from "./live/removed-notices";

export type CollabServersStatus = "idle" | "loading" | "ready" | "failed";
export type CollabServerAction = "signOut" | "remove";

export interface UnsentWork {
  action: CollabServerAction;
  projects: readonly CollabUnsentProject[];
}

// The shared projects a removed server left behind as ordinary projects.
export interface DetachedNotice {
  server: string;
  projects: readonly CollabDetachedProject[];
}

interface CollabStore {
  servers: CollabServer[];
  status: CollabServersStatus;
  loadError: CollabErrorCode | null;
  pending: Readonly<Record<string, CollabServerAction>>;
  unsent: Readonly<Record<string, UnsentWork>>;
  detached: DetachedNotice | null;
  load: () => Promise<void>;
  signIn: (url: string, providerId: string, setupCode?: string) => Promise<CollabServer>;
  signInWithCode: (
    url: string,
    setupCode: string | undefined,
    onCode: (code: CollabSignInCode) => void,
  ) => Promise<CollabServer>;
  signOut: (serverId: string) => Promise<CollabErrorCode | null>;
  remove: (serverId: string) => Promise<CollabErrorCode | null>;
  keepLocalCopies: (serverId: string) => Promise<CollabErrorCode | null>;
  stay: (serverId: string) => void;
  dismissDetached: () => void;
  refreshAccounts: () => Promise<void>;
}

let loadRequest = 0;

function without<T>(entries: Readonly<Record<string, T>>, serverId: string): Record<string, T> {
  return Object.fromEntries(Object.entries(entries).filter(([id]) => id !== serverId));
}

function upsert(servers: readonly CollabServer[], next: CollabServer): CollabServer[] {
  return servers.some((entry) => entry.server_id === next.server_id)
    ? servers.map((entry) => (entry.server_id === next.server_id ? next : entry))
    : [...servers, next];
}

function ended(servers: readonly CollabServer[], serverId: string, action: CollabServerAction): CollabServer[] {
  if (action === "remove") return servers.filter((entry) => entry.server_id !== serverId);
  return servers.map((entry) => (entry.server_id === serverId ? { ...entry, account: null, signed_in: false } : entry));
}

async function end(
  serverId: string,
  action: CollabServerAction,
  keepLocalCopy: boolean,
): Promise<CollabErrorCode | null> {
  const store = useCollabStore;
  if (store.getState().pending[serverId]) return null;
  const serverName = store.getState().servers.find((entry) => entry.server_id === serverId)?.name ?? "";
  store.setState((state) => ({
    pending: { ...state.pending, [serverId]: action },
    unsent: without(state.unsent, serverId),
  }));
  let outcome: CollabSignOut;
  try {
    outcome =
      action === "remove"
        ? await collabServerRemove(serverId, keepLocalCopy)
        : await collabServerSignOut(serverId, keepLocalCopy);
  } catch (error) {
    store.setState((state) => ({ pending: without(state.pending, serverId) }));
    return collabErrorCode(error);
  }
  if (!outcome.signed_out) {
    store.setState((state) => ({
      pending: without(state.pending, serverId),
      unsent: { ...state.unsent, [serverId]: { action, projects: outcome.unsent } },
    }));
    return null;
  }
  loadRequest += 1;
  const detached = outcome.detached ?? [];
  store.setState((state) => ({
    servers: ended(state.servers, serverId, action),
    pending: without(state.pending, serverId),
    detached: detached.length > 0 ? { server: serverName, projects: detached } : state.detached,
  }));
  const local = [...outcome.unsent, ...detached].map((project) => project.project_id);
  if (local.length > 0) void followLocalCopies(local);
  return null;
}

export const useCollabStore = create<CollabStore>((set, get) => ({
  servers: [],
  status: "idle",
  loadError: null,
  pending: {},
  unsent: {},
  detached: null,
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
  signOut: (serverId) => end(serverId, "signOut", false),
  remove: (serverId) => end(serverId, "remove", false),
  keepLocalCopies: async (serverId) => {
    const waiting = get().unsent[serverId];
    if (!waiting) return null;
    return end(serverId, waiting.action, true);
  },
  stay: (serverId) => set((state) => ({ unsent: without(state.unsent, serverId) })),
  dismissDetached: () => set({ detached: null }),
  refreshAccounts: async () => {
    const signedIn = get().servers.filter((entry) => entry.signed_in);
    const results = await Promise.allSettled(signedIn.map((entry) => collabServerRefresh(entry.server_id)));
    const fresh = results.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
    if (fresh.length === 0) return;
    set((state) => ({ servers: fresh.reduce((servers, server) => upsert(servers, server), state.servers) }));
  },
}));
