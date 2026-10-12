import { create, type StoreApi, type UseBoundStore } from "zustand";
import { useCollabEditorGate } from "@/lib/collab-live-bridge";
import { logError } from "@/lib/log";
import {
  collabLiveStart,
  collabLiveStop,
  collabMembersList,
  collabShareInfo,
  onCollabLiveMerged,
  onCollabLiveNewDevice,
  onCollabLiveRole,
  onCollabLiveStatus,
  onCollabPresence,
  onCollabPresenceLeft,
  type CollabLiveEndReason,
  type CollabLiveMerged,
  type CollabLiveNewDevice,
  type CollabLiveRole,
  type CollabLiveState,
  type CollabLiveStatus,
  type CollabPerson,
  type CollabPresence,
  type CollabPresenceLeft,
  type CollabProjectMember,
  type CollabProjectRole,
  type CollabShareInfo,
} from "@/lib/tauri";
import { useFilesStore } from "@/store/files";
import { peerHue } from "./peer-hue";

export interface LivePeer {
  deviceId: string;
  accountId: string;
  person: CollabPerson | null;
  path: string | null;
  cursor: number | null;
  anchor: number | null;
  seenAt: number;
  hue: number;
}

export type PeerPlace = Pick<LivePeer, "deviceId" | "accountId" | "person" | "path" | "hue">;
export type PeerPlaces = Readonly<Record<string, PeerPlace>>;

const placesFor = new WeakMap<PeerPlaces, PeerPlaces>();
let lastPlaces: PeerPlaces = {};

function samePlace(a: PeerPlace | undefined, b: PeerPlace): boolean {
  return a !== undefined && a.accountId === b.accountId && a.person === b.person && a.path === b.path && a.hue === b.hue;
}

function samePlaces(a: PeerPlaces, b: PeerPlaces): boolean {
  const keys = Object.keys(b);
  return keys.length === Object.keys(a).length && keys.every((key) => samePlace(a[key], b[key]));
}

export function peerPlaces(peers: PeerPlaces): PeerPlaces {
  const known = placesFor.get(peers);
  if (known) return known;
  const places = samePlaces(lastPlaces, peers) ? lastPlaces : peers;
  placesFor.set(peers, places);
  lastPlaces = places;
  return places;
}

export interface CollabLiveStoreState {
  projectId: string | null;
  share: CollabShareInfo | null;
  role: CollabProjectRole | null;
  status: CollabLiveState | null;
  pending: number;
  peers: Record<string, LivePeer>;
  members: CollabProjectMember[];
  merged: CollabLiveMerged | null;
  newDevice: CollabLiveNewDevice | null;
  ended: CollabLiveEndReason | null;
  refreshShare: () => Promise<void>;
  refreshMembers: () => Promise<void>;
  dismissMerged: () => void;
  dismissEnded: () => void;
}

export interface LiveSession {
  projectId: string;
  role: CollabProjectRole;
  accountId: string;
  deviceId: string;
}

export interface LiveHooks {
  started?: (session: LiveSession) => (() => void) | undefined;
}

export const PEER_TTL_MS = 30_000;
const PEER_SWEEP_MS = 1_000;

type LiveData = Omit<
  CollabLiveStoreState,
  "refreshShare" | "refreshMembers" | "dismissMerged" | "dismissEnded"
>;

function emptyLive(projectId: string | null): LiveData {
  return {
    projectId,
    share: null,
    role: null,
    status: null,
    pending: 0,
    peers: {},
    members: [],
    merged: null,
    newDevice: null,
    ended: null,
  };
}

function personFor(members: readonly CollabProjectMember[], accountId: string): CollabPerson | null {
  return members.find((member) => member.person.account_id === accountId)?.person ?? null;
}

function withPeople(
  peers: Record<string, LivePeer>,
  members: readonly CollabProjectMember[],
): Record<string, LivePeer> {
  return Object.fromEntries(
    Object.entries(peers).map(([deviceId, peer]) => [
      deviceId,
      { ...peer, person: personFor(members, peer.accountId) ?? peer.person },
    ]),
  );
}

let shareRequest = 0;
let membersRequest = 0;

export const useCollabLiveStore: UseBoundStore<StoreApi<CollabLiveStoreState>> = create<CollabLiveStoreState>(
  (set, get) => ({
    ...emptyLive(null),
    refreshShare: async () => {
      const projectId = get().projectId;
      if (!projectId) return;
      const request = ++shareRequest;
      let share: CollabShareInfo | null;
      try {
        share = await collabShareInfo(projectId);
      } catch (error) {
        void logError("collab share info", error);
        return;
      }
      if (request !== shareRequest || get().projectId !== projectId) return;
      set((state) => ({ share, role: share ? (state.role ?? share.role) : null }));
    },
    refreshMembers: async () => {
      const projectId = get().projectId;
      if (!projectId || !get().share) return;
      const request = ++membersRequest;
      let members: CollabProjectMember[];
      try {
        members = await collabMembersList(projectId);
      } catch (error) {
        void logError("collab members", error);
        return;
      }
      if (request !== membersRequest || get().projectId !== projectId) return;
      set((state) => ({ members, peers: withPeople(state.peers, members) }));
    },
    dismissMerged: () => set({ merged: null }),
    dismissEnded: () => set({ ended: null }),
  }),
);

interface LiveRun {
  projectId: string;
  ready: boolean;
  deviceId: string | null;
  release: (() => void) | null;
  retry: ReturnType<typeof setTimeout> | null;
}

const START_RETRY_MS = [1_000, 2_000, 5_000, 10_000, 30_000];

function holdEditors(projectId: string): void {
  useCollabEditorGate.setState({ projectId, viewer: false, connecting: true });
}

function releaseEditors(projectId: string): void {
  const gate = useCollabEditorGate.getState();
  if (gate.projectId === projectId && gate.connecting) {
    useCollabEditorGate.setState({ projectId: null, viewer: false, connecting: false });
  }
}

export function startCollabLive(hooks: LiveHooks = {}): () => void {
  const store = useCollabLiveStore;
  let disposed = false;
  let live: LiveRun | null = null;

  const stopLive = () => {
    const run = live;
    if (!run) return;
    live = null;
    if (run.retry) clearTimeout(run.retry);
    run.retry = null;
    run.release?.();
    run.release = null;
    releaseEditors(run.projectId);
    if (run.ready) void collabLiveStop(run.projectId).catch((error) => logError("collab live stop", error));
  };

  const goLive = async (projectId: string, attempt = 0) => {
    const run: LiveRun = { projectId, ready: false, deviceId: null, release: null, retry: null };
    live = run;
    holdEditors(projectId);
    let info: Awaited<ReturnType<typeof collabLiveStart>>;
    try {
      await useFilesStore
        .getState()
        .saveAllDirty()
        .catch((error) => logError("collab save before live", error));
      if (disposed || live !== run) {
        if (live === run) live = null;
        return;
      }
      info = await collabLiveStart(projectId);
    } catch (error) {
      void logError("collab live start", error);
      if (disposed || live !== run) return;
      const delay = START_RETRY_MS[Math.min(attempt, START_RETRY_MS.length - 1)];
      run.retry = setTimeout(() => {
        run.retry = null;
        if (disposed || live !== run || !store.getState().share) return;
        void goLive(projectId, attempt + 1);
      }, delay);
      return;
    }
    run.ready = true;
    if (disposed || live !== run) {
      void collabLiveStop(projectId).catch((error) => logError("collab live stop", error));
      return;
    }
    run.deviceId = info.device_id;
    releaseEditors(projectId);
    store.setState({ role: info.role });
    void store.getState().refreshMembers();
    run.release =
      hooks.started?.({
        projectId,
        role: info.role,
        accountId: info.account_id,
        deviceId: info.device_id,
      }) ?? null;
  };

  const openProject = (projectId: string | null) => {
    stopLive();
    store.setState(emptyLive(projectId));
    if (projectId) void store.getState().refreshShare();
  };

  const current = () => store.getState().projectId;

  const onStatus = (payload: CollabLiveStatus) => {
    if (payload.projectId !== current()) return;
    store.setState({ status: payload.status, pending: payload.pending });
    if (payload.status.state !== "ended" || payload.status.reason === "stopped") return;
    if (live?.projectId === payload.projectId) {
      live.release?.();
      live = null;
    }
    store.setState({ ended: payload.status.reason, peers: {} });
    void store.getState().refreshShare();
  };

  const onRole = (payload: CollabLiveRole) => {
    if (payload.projectId !== current()) return;
    const changed = store.getState().role !== payload.role;
    store.setState({ role: payload.role });
    if (changed) void store.getState().refreshMembers();
  };

  const onMerged = (payload: CollabLiveMerged) => {
    if (payload.projectId !== current()) return;
    store.setState({ merged: payload });
  };

  const onNewDevice = (payload: CollabLiveNewDevice) => {
    if (payload.projectId !== current()) return;
    store.setState({ newDevice: payload });
  };

  const onPresence = (payload: CollabPresence) => {
    if (payload.projectId !== current() || payload.deviceId === live?.deviceId) return;
    store.setState((state) => ({
      peers: {
        ...state.peers,
        [payload.deviceId]: {
          deviceId: payload.deviceId,
          accountId: payload.accountId,
          person: personFor(state.members, payload.accountId),
          path: payload.path,
          cursor: payload.cursor,
          anchor: payload.anchor,
          seenAt: Date.now(),
          hue: peerHue(payload.accountId, state.share?.account_id ?? null),
        },
      },
    }));
  };

  const onLeft = (payload: CollabPresenceLeft) => {
    if (payload.projectId !== current() || !store.getState().peers[payload.deviceId]) return;
    store.setState((state) => {
      const peers = { ...state.peers };
      delete peers[payload.deviceId];
      return { peers };
    });
  };

  const expirePeers = () => {
    const peers = store.getState().peers;
    const cutoff = Date.now() - PEER_TTL_MS;
    const kept = Object.entries(peers).filter(([, peer]) => peer.seenAt > cutoff);
    if (kept.length === Object.keys(peers).length) return;
    store.setState({ peers: Object.fromEntries(kept) });
  };

  const unlisteners = [
    onCollabLiveStatus(onStatus),
    onCollabLiveRole(onRole),
    onCollabLiveMerged(onMerged),
    onCollabLiveNewDevice(onNewDevice),
    onCollabPresence(onPresence),
    onCollabPresenceLeft(onLeft),
  ].map((pending) =>
    pending.catch((error) => {
      void logError("collab live listen", error);
      return () => {};
    }),
  );
  let sweep: ReturnType<typeof setInterval> | null = null;
  const unsubscribeSweep = store.subscribe((state, previous) => {
    if (state.peers === previous.peers) return;
    const present = Object.keys(state.peers).length > 0;
    if (present && sweep === null) {
      sweep = setInterval(expirePeers, PEER_SWEEP_MS);
    } else if (!present && sweep !== null) {
      clearInterval(sweep);
      sweep = null;
    }
  });

  const unsubscribeStore = store.subscribe((state, previous) => {
    if (disposed || state.share === previous.share || !state.projectId) return;
    if (state.share && !state.ended && live?.projectId !== state.projectId) {
      void goLive(state.projectId);
    } else if (!state.share && live) {
      stopLive();
      store.setState({ role: null, status: null, pending: 0, peers: {}, members: [] });
    }
  });

  let projectId = useFilesStore.getState().projectId;
  const unsubscribeFiles = useFilesStore.subscribe((state) => {
    if (state.projectId === projectId) return;
    projectId = state.projectId;
    openProject(projectId);
  });
  openProject(projectId);

  return () => {
    if (disposed) return;
    disposed = true;
    unsubscribeFiles();
    unsubscribeStore();
    unsubscribeSweep();
    if (sweep !== null) clearInterval(sweep);
    stopLive();
    for (const pending of unlisteners) void pending.then((unlisten) => unlisten());
    store.setState(emptyLive(null));
  };
}
