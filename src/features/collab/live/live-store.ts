import { create, type StoreApi, type UseBoundStore } from "zustand";
import { useCollabEditorGate } from "@/lib/collab-live-bridge";
import { logError } from "@/lib/log";
import type {
  CollabCommentNotSent,
  CollabCommentsNotSent,
  CollabErrorCode,
  CollabLiveEndedReason,
  CollabLiveMembers,
  CollabLiveMerged,
  CollabLiveNewDevice,
  CollabLiveRole,
  CollabLiveSyncState,
  CollabLiveStatus,
  CollabLiveUnwritten,
  CollabPerson,
  CollabPresence,
  CollabPresenceLeft,
  CollabProjectMember,
  CollabProjectRole,
  CollabServerChanged,
  CollabShareInfo,
} from "@/lib/tauri";
import {
  collabLiveStart,
  collabLiveStop,
  collabMembersList,
  collabServersList,
  collabShareInfo,
  onCollabCommentsNotSent,
  onCollabLiveMembers,
  onCollabLiveMerged,
  onCollabLiveNewDevice,
  onCollabLiveRole,
  onCollabLiveStatus,
  onCollabLiveProjectFull,
  onCollabLiveUnwritten,
  onCollabPresence,
  onCollabPresenceLeft,
  onCollabServerChanged,
} from "@/lib/tauri-collab";
import { useFilesStore } from "@/store/files";
import { collabErrorCode } from "../errors";
import { canEditProjectRole } from "../roles";
import { heldStatus } from "../sharing/sync-state";
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
  return a?.accountId === b.accountId && a.person === b.person && a.path === b.path && a.hue === b.hue;
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

export interface LiveMemberChange extends CollabLiveMembers {
  name: string;
  byName: string;
}

export type RoleNoticeKind = "viewer" | "commenter" | "reviewer";

export interface AccessNotice {
  kind: RoleNoticeKind | "removed";
  byName: string;
}

function roleNoticeKind(role: CollabProjectRole): RoleNoticeKind | null {
  if (canEditProjectRole(role)) return null;
  if (role === "reviewer" || role === "commenter") return role;
  return "viewer";
}

export interface CollabLiveStoreState {
  projectId: string | null;
  share: CollabShareInfo | null;
  role: CollabProjectRole | null;
  status: CollabLiveSyncState | null;
  pending: number;
  peers: Record<string, LivePeer>;
  members: CollabProjectMember[];
  merged: CollabLiveMerged | null;
  newDevice: CollabLiveNewDevice | null;
  memberChange: LiveMemberChange | null;
  ended: CollabLiveEndedReason | null;
  accessNotice: AccessNotice | null;
  commentsNotSent: CollabCommentNotSent[] | null;
  // Files of the live project that couldn't be written to this computer.
  unwritten: CollabLiveUnwritten["files"];
  // The server refused a change because the project reached its size limit.
  // Until the connection comes back, changes stay on this computer.
  projectFull: boolean;
  refreshShare: () => Promise<void>;
  refreshMembers: () => Promise<void>;
  dismissMerged: () => void;
  dismissEnded: () => void;
  dismissAccessNotice: () => void;
  dismissCommentsNotSent: () => void;
  // Starts syncing again after it stopped on an error.
  goLiveAgain: () => void;
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
  | "refreshShare"
  | "refreshMembers"
  | "dismissMerged"
  | "dismissEnded"
  | "dismissAccessNotice"
  | "dismissCommentsNotSent"
  | "goLiveAgain"
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
    memberChange: null,
    ended: null,
    accessNotice: null,
    commentsNotSent: null,
    unwritten: [],
    projectFull: false,
  };
}

function personFor(members: readonly CollabProjectMember[], accountId: string): CollabPerson | null {
  return members.find((member) => member.person.account_id === accountId)?.person ?? null;
}

function nameIn(lists: readonly (readonly CollabProjectMember[])[], accountId: string): string {
  for (const members of lists) {
    const found = personFor(members, accountId);
    if (found) return found.display_name;
  }
  return "";
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

// Set while the live lifecycle runs.
let goLiveAgainNow: (() => void) | null = null;

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
    dismissAccessNotice: () => set({ accessNotice: null }),
    dismissCommentsNotSent: () => set({ commentsNotSent: null }),
    goLiveAgain: () => goLiveAgainNow?.(),
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

// Retrying a live start can't fix these: the person has to sign in again, or
// add the project's server back. They are tried again on the next server
// change instead of on a timer.
const START_REFUSALS: ReadonlySet<CollabErrorCode> = new Set([
  "signed_out",
  "server_removed",
  "unauthorized",
  "not_found",
  "server_unknown",
]);

// Endings that signing in again, or adding the server back, can undo.
const RESUMABLE: ReadonlySet<CollabLiveEndedReason> = new Set(["signed_out", "server_removed", "account_suspended"]);

function refusalReason(code: CollabErrorCode): CollabLiveEndedReason {
  return code === "server_removed" || code === "server_unknown" ? "server_removed" : "signed_out";
}

function holdEditors(projectId: string): void {
  useCollabEditorGate.setState({ projectId, viewer: false, locked: false, connecting: true });
}

function releaseEditors(projectId: string): void {
  const gate = useCollabEditorGate.getState();
  if (gate.projectId === projectId && gate.connecting) {
    useCollabEditorGate.setState({ projectId: null, viewer: false, locked: false, connecting: false });
  }
}

export function startCollabLive(hooks: LiveHooks = {}): () => void {
  const store = useCollabLiveStore;
  let disposed = false;
  let live: LiveRun | null = null;
  let resumable = false;
  let askedAbout = new Set<string>();
  let ownChange: Pick<CollabLiveMembers, "by" | "kind"> | null = null;

  const takeOwnChange = (kind: CollabLiveMembers["kind"]): string => {
    const change = ownChange;
    ownChange = null;
    return change?.kind === kind ? change.by : "";
  };

  const changedBy = (by: string): string => (by ? nameIn([store.getState().members], by) : "");

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

  const refuseStart = (projectId: string, code: CollabErrorCode) => {
    releaseEditors(projectId);
    resumable = true;
    const state = store.getState();
    // A status event from the start already said why, unless the server is gone.
    if (refusalReason(code) !== "server_removed" && state.status?.state === "ended") return;
    const reason = refusalReason(code);
    store.setState({ status: { state: "ended", reason }, ended: reason, peers: {} });
  };

  const goLive = async (projectId: string, attempt = 0) => {
    const run: LiveRun = { projectId, ready: false, deviceId: null, release: null, retry: null };
    live = run;
    resumable = false;
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
      if (disposed) return;
      const code = collabErrorCode(error);
      if (START_REFUSALS.has(code)) {
        if (live === run) live = null;
        if (live === null && current() === projectId) refuseStart(projectId, code);
        return;
      }
      if (live !== run) return;
      // One line per run: the retries below would otherwise log every 30 seconds.
      if (attempt === 0) void logError("collab live start", error);
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

  // Syncing stopped after an error. The next start skips the change at
  // fault, so it can start again at once.
  const goLiveAgain = () => {
    const state = store.getState();
    if (disposed || live !== null || !state.projectId || !state.share || state.ended !== "failed") return;
    store.setState({ status: null, ended: null });
    void goLive(state.projectId);
  };
  goLiveAgainNow = goLiveAgain;

  const openProject = (projectId: string | null) => {
    stopLive();
    resumable = false;
    askedAbout = new Set();
    ownChange = null;
    store.setState(emptyLive(projectId));
    if (projectId) void store.getState().refreshShare();
  };

  const current = () => store.getState().projectId;

  const learnAbout = (accountIds: readonly string[]) => {
    const state = store.getState();
    const unknown = accountIds.filter(
      (accountId) =>
        accountId !== state.share?.account_id && !personFor(state.members, accountId) && !askedAbout.has(accountId),
    );
    if (unknown.length === 0) return;
    for (const accountId of unknown) askedAbout.add(accountId);
    void state.refreshMembers();
  };

  const onStatus = (payload: CollabLiveStatus) => {
    if (payload.projectId !== current()) return;
    // A connection that comes back tries the changes again, and the server
    // says once more if the project is still full.
    const back = payload.status.state === "online" && store.getState().status?.state !== "online";
    store.setState((state) => ({
      status: heldStatus(state.status, payload.status),
      pending: payload.pending,
      projectFull: back ? false : state.projectFull,
    }));
    if (payload.status.state !== "ended") return;
    releaseEditors(payload.projectId);
    if (payload.status.reason === "stopped") return;
    if (live?.projectId === payload.projectId) {
      if (live.retry) clearTimeout(live.retry);
      live.release?.();
      live = null;
    }
    resumable = RESUMABLE.has(payload.status.reason);
    const removedBy = payload.status.reason === "removed" ? takeOwnChange("removed") : "";
    const self = store.getState().share?.account_id ?? null;
    const notice: AccessNotice | null =
      payload.status.reason === "removed" && (removedBy === "" || removedBy !== self)
        ? { kind: "removed", byName: changedBy(removedBy) }
        : store.getState().accessNotice;
    store.setState({ ended: payload.status.reason, peers: {}, accessNotice: notice });
    void store.getState().refreshShare();
  };

  const onRole = (payload: CollabLiveRole) => {
    if (payload.projectId !== current()) return;
    const state = store.getState();
    const before = state.role;
    const changed = before !== payload.role;
    const by = takeOwnChange("role_changed");
    let notice = state.accessNotice;
    const kind = roleNoticeKind(payload.role);
    if (changed && before !== null && kind !== null) {
      notice = { kind, byName: changedBy(by) };
    } else if (changed && kind === null && notice !== null && notice.kind !== "removed") {
      notice = null;
    }
    store.setState({ role: payload.role, accessNotice: notice });
    if (changed) void store.getState().refreshMembers();
  };

  const onMerged = (payload: CollabLiveMerged) => {
    if (payload.projectId !== current()) return;
    store.setState({ merged: payload });
    learnAbout(payload.authors.map((author) => author.accountId));
  };

  const onNewDevice = (payload: CollabLiveNewDevice) => {
    if (payload.projectId !== current()) return;
    store.setState({ newDevice: payload });
    learnAbout([payload.accountId]);
  };

  const onMembers = (payload: CollabLiveMembers) => {
    if (payload.projectId !== current()) return;
    const state = store.getState();
    const before = state.members;
    if (payload.accountId === state.share?.account_id) ownChange = { by: payload.by, kind: payload.kind };
    const settle = () => {
      if (store.getState().projectId !== payload.projectId) return;
      const lists = [store.getState().members, before];
      store.setState({
        memberChange: { ...payload, name: nameIn(lists, payload.accountId), byName: nameIn(lists, payload.by) },
      });
    };
    if (payload.kind === "removed" && payload.accountId === state.share?.account_id) {
      settle();
      return;
    }
    void state.refreshMembers().then(settle);
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
    learnAbout([payload.accountId]);
  };

  const onLeft = (payload: CollabPresenceLeft) => {
    if (payload.projectId !== current() || !store.getState().peers[payload.deviceId]) return;
    store.setState((state) => {
      const peers = { ...state.peers };
      delete peers[payload.deviceId];
      return { peers };
    });
  };

  // After a sign-in, or after the project's server is added back, a project
  // that couldn't go live tries again.
  const onServerChanged = (payload: CollabServerChanged) => {
    const state = store.getState();
    const projectId = state.projectId;
    const share = state.share;
    if (disposed || !resumable || live !== null || !projectId || share?.server_id !== payload.serverId) return;
    collabServersList().then(
      (servers) => {
        const now = store.getState();
        if (disposed || !resumable || live !== null || now.projectId !== projectId || !now.share) return;
        if (!servers.some((server) => server.server_id === payload.serverId && server.signed_in)) return;
        store.setState({ status: null, ended: null });
        void goLive(projectId);
      },
      (error: unknown) => logError("collab servers after a change", error),
    );
  };

  const onCommentsNotSent = (payload: CollabCommentsNotSent) => {
    if (payload.projectId !== current()) return;
    store.setState((state) => ({ commentsNotSent: [...(state.commentsNotSent ?? []), ...payload.comments] }));
  };

  const onProjectFull = (payload: { projectId: string }) => {
    if (payload.projectId !== current()) return;
    store.setState({ projectFull: true });
  };

  const onUnwritten = (payload: CollabLiveUnwritten) => {
    if (payload.projectId !== current()) return;
    store.setState({ unwritten: payload.files });
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
    onCollabLiveMembers(onMembers),
    onCollabPresence(onPresence),
    onCollabPresenceLeft(onLeft),
    onCollabCommentsNotSent(onCommentsNotSent),
    onCollabServerChanged(onServerChanged),
    onCollabLiveUnwritten(onUnwritten),
    onCollabLiveProjectFull(onProjectFull),
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
    if (goLiveAgainNow === goLiveAgain) goLiveAgainNow = null;
    unsubscribeFiles();
    unsubscribeStore();
    unsubscribeSweep();
    if (sweep !== null) clearInterval(sweep);
    stopLive();
    for (const pending of unlisteners) void pending.then((unlisten) => unlisten());
    store.setState(emptyLive(null));
  };
}
