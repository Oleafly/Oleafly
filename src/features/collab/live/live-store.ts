import { create, type StoreApi, type UseBoundStore } from "zustand";
import { avatarHue } from "@/components/ui/avatar";
import { logError } from "@/lib/log";
import {
  collabLiveStart,
  collabLiveStop,
  collabMembersList,
  collabShareInfo,
  onCollabLiveMerged,
  onCollabLiveRole,
  onCollabLiveStatus,
  onCollabPresence,
  onCollabPresenceLeft,
  type CollabLiveEndReason,
  type CollabLiveMerged,
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

export interface CollabLiveStoreState {
  projectId: string | null;
  share: CollabShareInfo | null;
  role: CollabProjectRole | null;
  status: CollabLiveState | null;
  pending: number;
  peers: Record<string, LivePeer>;
  members: CollabProjectMember[];
  merged: CollabLiveMerged | null;
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
}

export function startCollabLive(hooks: LiveHooks = {}): () => void {
  const store = useCollabLiveStore;
  let disposed = false;
  let live: LiveRun | null = null;

  const stopLive = () => {
    const run = live;
    if (!run) return;
    live = null;
    run.release?.();
    run.release = null;
    if (run.ready) void collabLiveStop(run.projectId).catch((error) => logError("collab live stop", error));
  };

  const goLive = async (projectId: string) => {
    const run: LiveRun = { projectId, ready: false, deviceId: null, release: null };
    live = run;
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
      if (live === run) live = null;
      void logError("collab live start", error);
      return;
    }
    run.ready = true;
    if (disposed || live !== run) {
      void collabLiveStop(projectId).catch((error) => logError("collab live stop", error));
      return;
    }
    run.deviceId = info.device_id;
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
    store.setState({ role: payload.role });
  };

  const onMerged = (payload: CollabLiveMerged) => {
    if (payload.projectId !== current()) return;
    store.setState({ merged: payload });
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
          hue: avatarHue(payload.accountId),
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
    onCollabPresence(onPresence),
    onCollabPresenceLeft(onLeft),
  ].map((pending) =>
    pending.catch((error) => {
      void logError("collab live listen", error);
      return () => {};
    }),
  );
  const sweep = setInterval(expirePeers, PEER_SWEEP_MS);

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
    clearInterval(sweep);
    stopLive();
    for (const pending of unlisteners) void pending.then((unlisten) => unlisten());
    store.setState(emptyLive(null));
  };
}
