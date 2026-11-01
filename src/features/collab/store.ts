import { create } from "zustand";
import { logError } from "@/lib/log";
import type {
  CollabErrorCode,
  CollabDetachedProject,
  CollabServer,
  CollabSignInCode,
  CollabSignOut,
  CollabUnsentProject,
} from "@/lib/tauri";
import {
  collabServerCodeSignIn,
  collabServerRefresh,
  collabServerRemove,
  collabServerSignIn,
  collabServerSignOut,
  collabServersList,
  onCollabServerChanged,
} from "@/lib/tauri-collab";
import { collabErrorCode } from "./errors";
import { followLocalCopies } from "./live/removed-notices";

export type CollabServersStatus = "idle" | "loading" | "ready" | "failed";
export type CollabServerAction = "signOut" | "remove";

export interface UnsentWork {
  action: CollabServerAction;
  projects: readonly CollabUnsentProject[];
}

export interface DetachedNotice {
  server: string;
  projects: readonly CollabDetachedProject[];
}

function withDetached(
  notices: readonly DetachedNotice[],
  server: string,
  projects: readonly CollabDetachedProject[],
): readonly DetachedNotice[] {
  const existing = notices.find((notice) => notice.server === server);
  if (!existing) return [...notices, { server, projects }];
  const listed = new Set(existing.projects.map((project) => project.project_id));
  const added = projects.filter((project) => !listed.has(project.project_id));
  return notices.map((notice) => (notice === existing ? { server, projects: [...notice.projects, ...added] } : notice));
}

interface CollabStore {
  servers: CollabServer[];
  status: CollabServersStatus;
  loadError: CollabErrorCode | null;
  pending: Readonly<Record<string, CollabServerAction>>;
  unsent: Readonly<Record<string, UnsentWork>>;
  detached: readonly DetachedNotice[];
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
    detached: detached.length > 0 ? withDetached(state.detached, serverName, detached) : state.detached,
  }));
  const local = [...outcome.unsent, ...detached].map((project) => project.project_id);
  if (local.length > 0) void followLocalCopies(local);
  return null;
}

let watchers = 0;
let listening: { stop: (() => void) | null; released: boolean } | null = null;

export function watchServers(): () => void {
  watchers += 1;
  if (watchers === 1) {
    const current = { stop: null as (() => void) | null, released: false };
    listening = current;
    onCollabServerChanged(() => {
      if (useCollabStore.getState().status !== "idle") void useCollabStore.getState().load();
    }).then(
      (unlisten) => {
        if (current.released) unlisten();
        else current.stop = unlisten;
      },
      (error: unknown) => {
        void logError("collab server listener", error);
      },
    );
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    watchers -= 1;
    if (watchers > 0 || !listening) return;
    listening.released = true;
    listening.stop?.();
    listening = null;
  };
}

export const useCollabStore = create<CollabStore>((set, get) => ({
  servers: [],
  status: "idle",
  loadError: null,
  pending: {},
  unsent: {},
  detached: [],
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
  dismissDetached: () => set({ detached: [] }),
  refreshAccounts: async () => {
    const started = loadRequest;
    const signedIn = get().servers.filter((entry) => entry.signed_in);
    await Promise.all(
      signedIn.map(async (entry) => {
        let fresh: CollabServer;
        try {
          fresh = await collabServerRefresh(entry.server_id);
        } catch {
          return;
        }
        if (loadRequest !== started || get().pending[entry.server_id]) return;
        set((state) => ({ servers: upsert(state.servers, fresh) }));
      }),
    );
  },
}));
