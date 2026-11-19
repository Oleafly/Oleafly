import { create, type StoreApi, type UseBoundStore } from "zustand";
import {
  collabHandBack,
  collabNoteHandBack,
  useCollabEditorGate,
  useCollabLiveNote,
  useLiveBackend,
} from "@/lib/collab-live-bridge";
import { logError } from "@/lib/log";
import { overleafLiveMembers, type OverleafLiveProject } from "@/lib/overleaf-live";
import type { OverleafLiveAccountChanged } from "@oleafly/backend-port";
import type {
  CollabCommentNotSent,
  CollabCommentsNotSent,
  CollabErrorCode,
  CollabLiveEndedReason,
  CollabLiveDocPending,
  CollabLiveInfo,
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
  collabMembersList,
  collabServersList,
  collabShareInfo,
  onCollabCommentsNotSent,
  onCollabLiveDocPending,
  onOverleafLiveAccountChanged,
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
import { announcePeerJoined } from "./presence";
import { serverDriver } from "./server-driver";

export interface LivePeer {
  deviceId: string;
  accountId: string;
  person: CollabPerson | null;
  path: string | null;
  cursor: number | null;
  anchor: number | null;
  seenAt: number;
  hue: number;
  activity?: LivePeerActivity | null;
  activityAt?: number;
}

export interface LivePeerActivity {
  kind: "reply" | "chat";
  threadId: string | null;
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

export interface LiveBackendDriver {
  kind: "server" | "overleaf";
  wants(state: CollabLiveStoreState): boolean;
  start(projectId: string): Promise<CollabLiveInfo>;
  stop(projectId: string): Promise<void>;
  refresh(projectId: string): Promise<void>;
  resumable(reason: CollabLiveEndedReason): boolean;
}

export type LiveBackend = LiveBackendDriver["kind"];

export interface CollabLiveStoreState {
  projectId: string | null;
  backend: LiveBackend | null;
  share: CollabShareInfo | null;
  overleaf: OverleafLiveProject | null;
  role: CollabProjectRole | null;
  selfId: string | null;
  tracking: boolean;
  restricted: boolean;
  deletedExternally: boolean;
  status: CollabLiveSyncState | null;
  pending: number;
  pendingPaths: readonly string[];
  storedAsFiles: readonly string[];
  peers: Record<string, LivePeer>;
  members: CollabProjectMember[];
  merged: CollabLiveMerged | null;
  newDevice: CollabLiveNewDevice | null;
  memberChange: LiveMemberChange | null;
  ended: CollabLiveEndedReason | null;
  accessNotice: AccessNotice | null;
  commentsNotSent: CollabCommentNotSent[] | null;
  notSentBannerHidden: boolean;
  unwritten: CollabLiveUnwritten["files"];
  projectFull: boolean;
  accountChanged: OverleafLiveAccountChanged | null;
  refreshShare: () => Promise<void>;
  refreshMembers: () => Promise<void>;
  dismissMerged: () => void;
  dismissEnded: () => void;
  dismissAccessNotice: () => void;
  dismissCommentsNotSent: () => void;
  dismissAccountChanged: () => void;
  discardCommentNotSent: (comment: CollabCommentNotSent) => void;
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
  drivers?: readonly LiveBackendDriver[];
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
  | "dismissAccountChanged"
  | "discardCommentNotSent"
  | "goLiveAgain"
>;

function emptyLive(projectId: string | null): LiveData {
  return {
    projectId,
    backend: null,
    share: null,
    overleaf: null,
    role: null,
    selfId: null,
    tracking: false,
    restricted: false,
    deletedExternally: false,
    status: null,
    pending: 0,
    pendingPaths: [],
    storedAsFiles: [],
    peers: {},
    members: [],
    merged: null,
    newDevice: null,
    memberChange: null,
    ended: null,
    accessNotice: null,
    commentsNotSent: null,
    notSentBannerHidden: false,
    unwritten: [],
    projectFull: false,
    accountChanged: null,
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

function presencePerson(payload: CollabPresence): CollabPerson | null {
  const name = payload.person?.name;
  if (!name) return null;
  return {
    account_id: payload.accountId,
    display_name: name,
    avatar_url: null,
    email: payload.person?.email ?? null,
    login: null,
  };
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
      const overleaf = get().backend === "overleaf";
      if (!projectId || (!overleaf && !get().share)) return;
      const request = ++membersRequest;
      let members: CollabProjectMember[];
      try {
        members = overleaf ? await overleafLiveMembers(projectId) : await collabMembersList(projectId);
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
    dismissCommentsNotSent: () => set({ notSentBannerHidden: true }),
    dismissAccountChanged: () => set({ accountChanged: null }),
    discardCommentNotSent: (comment) =>
      set((state) => {
        const left = (state.commentsNotSent ?? []).filter((entry) => entry !== comment);
        return { commentsNotSent: left.length > 0 ? left : null };
      }),
    goLiveAgain: () => goLiveAgainNow?.(),
  }),
);

interface LiveRun {
  projectId: string;
  driver: LiveBackendDriver;
  ready: boolean;
  deviceId: string | null;
  release: (() => void) | null;
  retry: ReturnType<typeof setTimeout> | null;
  heardRole: boolean;
}

const START_RETRY_MS = [1_000, 2_000, 5_000, 10_000, 30_000];

const START_REFUSALS: ReadonlySet<CollabErrorCode> = new Set([
  "signed_out",
  "server_removed",
  "unauthorized",
  "not_found",
  "server_unknown",
]);

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

export function noteStoredAsFiles(projectId: string, paths: readonly string[]): void {
  if (useCollabLiveStore.getState().projectId !== projectId) return;
  useCollabLiveStore.setState({ storedAsFiles: paths });
}

export function liveTarget(): string | null {
  return useCollabLiveNote.getState().noteId ?? useFilesStore.getState().projectId;
}

export function startCollabLive(hooks: LiveHooks = {}): () => void {
  const store = useCollabLiveStore;
  const drivers = hooks.drivers ?? [serverDriver(() => store.getState().refreshShare())];
  const driverFor = (state: CollabLiveStoreState): LiveBackendDriver | null =>
    drivers.find((driver) => driver.wants(state)) ?? null;
  const driverOf = (kind: LiveBackend | null): LiveBackendDriver =>
    drivers.find((driver) => driver.kind === kind) ?? drivers[0];
  const refreshAll = (projectId: string) => {
    for (const driver of drivers) void driver.refresh(projectId);
  };
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
    if (run.ready) void run.driver.stop(run.projectId).catch((error) => logError("collab live stop", error));
  };

  const refuseStart = (projectId: string, code: CollabErrorCode) => {
    releaseEditors(projectId);
    resumable = true;
    const state = store.getState();
    if (refusalReason(code) !== "server_removed" && state.status?.state === "ended") return;
    const reason = refusalReason(code);
    store.setState({ status: { state: "ended", reason }, ended: reason, peers: {} });
  };

  const goLive = async (projectId: string, driver: LiveBackendDriver, attempt = 0) => {
    const run: LiveRun = { projectId, driver, ready: false, deviceId: null, release: null, retry: null, heardRole: false };
    live = run;
    resumable = false;
    holdEditors(projectId);
    if (store.getState().backend !== driver.kind) store.setState({ backend: driver.kind });
    let info: CollabLiveInfo;
    try {
      await useFilesStore
        .getState()
        .saveAllDirty()
        .catch((error) => logError("collab save before live", error));
      if (disposed || live !== run) {
        if (live === run) live = null;
        return;
      }
      info = await driver.start(projectId);
    } catch (error) {
      startFailed(run, error, attempt);
      return;
    }
    wentLive(run, info);
  };

  const startFailed = (run: LiveRun, error: unknown, attempt: number) => {
    if (disposed) return;
    const code = collabErrorCode(error);
    if (START_REFUSALS.has(code)) {
      if (live === run) live = null;
      if (live === null && current() === run.projectId) refuseStart(run.projectId, code);
      return;
    }
    if (live !== run) return;
    if (attempt === 0) void logError("collab live start", error);
    retryStart(run, attempt);
  };

  const retryStart = (run: LiveRun, attempt: number) => {
    const delay = START_RETRY_MS[Math.min(attempt, START_RETRY_MS.length - 1)];
    run.retry = setTimeout(() => {
      run.retry = null;
      if (disposed || live !== run || !run.driver.wants(store.getState())) return;
      void goLive(run.projectId, run.driver, attempt + 1);
    }, delay);
  };

  const wentLive = (run: LiveRun, info: CollabLiveInfo) => {
    run.ready = true;
    if (disposed || live !== run) {
      void run.driver.stop(run.projectId).catch((error) => logError("collab live stop", error));
      return;
    }
    run.deviceId = info.device_id;
    releaseEditors(run.projectId);
    const role = run.heardRole ? (store.getState().role ?? info.role) : info.role;
    store.setState({ role, selfId: info.account_id });
    void store.getState().refreshMembers();
    run.release =
      hooks.started?.({
        projectId: run.projectId,
        role,
        accountId: info.account_id,
        deviceId: info.device_id,
      }) ?? null;
  };

  const goLiveAgain = () => {
    const state = store.getState();
    const driver = driverFor(state);
    if (disposed || live !== null || !state.projectId || !driver || !state.ended) return;
    if (state.ended !== "failed" && !(resumable && driver.resumable(state.ended))) return;
    store.setState({ status: null, ended: null });
    void goLive(state.projectId, driver);
  };
  goLiveAgainNow = goLiveAgain;

  const openProject = (projectId: string | null) => {
    stopLive();
    resumable = false;
    askedAbout = new Set();
    ownChange = null;
    store.setState(emptyLive(projectId));
    if (projectId) refreshAll(projectId);
  };

  const current = () => store.getState().projectId;

  const learnAbout = (accountIds: readonly string[]) => {
    const state = store.getState();
    const unknown = accountIds.filter(
      (accountId) =>
        accountId !== (state.share?.account_id ?? state.selfId) &&
        !personFor(state.members, accountId) &&
        !askedAbout.has(accountId),
    );
    if (unknown.length === 0) return;
    for (const accountId of unknown) askedAbout.add(accountId);
    void state.refreshMembers();
  };

  const onStatus = (payload: CollabLiveStatus) => {
    if (payload.projectId !== current()) return;
    const back = payload.status.state === "online" && store.getState().status?.state !== "online";
    store.setState((state) => ({
      status: heldStatus(state.status, payload.status),
      pending: payload.pending,
      projectFull: back ? false : state.projectFull,
    }));
    if (payload.status.state !== "ended") return;
    releaseEditors(payload.projectId);
    store.setState({ pendingPaths: [], storedAsFiles: [] });
    if (payload.status.reason === "stopped") return;
    const ending = live?.projectId === payload.projectId ? live : null;
    const driver = ending?.driver ?? driverOf(store.getState().backend);
    if (ending) {
      if (ending.retry) clearTimeout(ending.retry);
      ending.release?.();
      live = null;
    }
    resumable = driver.resumable(payload.status.reason);
    const removedBy = payload.status.reason === "removed" ? takeOwnChange("removed") : "";
    const self = store.getState().share?.account_id ?? null;
    const notice: AccessNotice | null =
      payload.status.reason === "removed" && (removedBy === "" || removedBy !== self)
        ? { kind: "removed", byName: changedBy(removedBy) }
        : store.getState().accessNotice;
    store.setState({ ended: payload.status.reason, peers: {}, accessNotice: notice });
    refreshAll(payload.projectId);
  };

  const onRole = (payload: CollabLiveRole) => {
    if (payload.projectId !== current()) return;
    if (live?.projectId === payload.projectId) live.heardRole = true;
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
    store.setState({
      role: payload.role,
      tracking: payload.tracking,
      restricted: payload.restricted,
      deletedExternally: payload.deletedExternally,
      accessNotice: notice,
    });
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
    const joined = !store.getState().peers[payload.deviceId];
    store.setState((state) => ({
      peers: {
        ...state.peers,
        [payload.deviceId]: {
          deviceId: payload.deviceId,
          accountId: payload.accountId,
          person: personFor(state.members, payload.accountId) ?? presencePerson(payload),
          path: payload.path,
          cursor: payload.cursor,
          anchor: payload.anchor,
          seenAt: Date.now(),
          hue: peerHue(payload.accountId, state.share?.account_id ?? state.selfId),
          activity: payload.activity ?? null,
          activityAt: payload.activity ? Date.now() : 0,
        },
      },
    }));
    learnAbout([payload.accountId]);
    if (joined) announcePeerJoined();
  };

  const onLeft = (payload: CollabPresenceLeft) => {
    if (payload.projectId !== current() || !store.getState().peers[payload.deviceId]) return;
    store.setState((state) => {
      const peers = { ...state.peers };
      delete peers[payload.deviceId];
      return { peers };
    });
  };

  const onServerChanged = (payload: CollabServerChanged) => {
    const state = store.getState();
    const projectId = state.projectId;
    const share = state.share;
    if (disposed || !resumable || live !== null || !projectId || share?.server_id !== payload.serverId) return;
    collabServersList().then(
      (servers) => {
        const now = store.getState();
        const driver = driverFor(now);
        if (disposed || !resumable || live !== null || now.projectId !== projectId || !driver) return;
        if (!servers.some((server) => server.server_id === payload.serverId && server.signed_in)) return;
        store.setState({ status: null, ended: null });
        void goLive(projectId, driver);
      },
      (error: unknown) => logError("collab servers after a change", error),
    );
  };

  const onCommentsNotSent = (payload: CollabCommentsNotSent) => {
    if (payload.projectId !== current()) return;
    store.setState((state) => ({
      commentsNotSent: [...(state.commentsNotSent ?? []), ...payload.comments],
      notSentBannerHidden: false,
    }));
  };

  const onProjectFull = (payload: { projectId: string }) => {
    if (payload.projectId !== current()) return;
    store.setState({ projectFull: true });
  };

  const onUnwritten = (payload: CollabLiveUnwritten) => {
    if (payload.projectId !== current()) return;
    store.setState({ unwritten: payload.files });
  };

  const onDocPending = (payload: CollabLiveDocPending) => {
    if (payload.projectId !== current()) return;
    store.setState((state) => {
      const has = state.pendingPaths.includes(payload.path);
      if (has === payload.pending) return state;
      return {
        pendingPaths: payload.pending
          ? [...state.pendingPaths, payload.path]
          : state.pendingPaths.filter((path) => path !== payload.path),
      };
    });
  };

  const onAccountChanged = (payload: OverleafLiveAccountChanged) => {
    if (payload.projectId !== current()) return;
    store.setState({ accountChanged: payload });
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
    onCollabLiveDocPending(onDocPending),
    onOverleafLiveAccountChanged(onAccountChanged),
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
    if (disposed || !state.projectId) return;
    const driver = driverFor(state);
    if (state.share === previous.share && driver === driverFor(previous)) return;
    if (driver && !state.ended && live?.projectId !== state.projectId) {
      void goLive(state.projectId, driver);
    } else if (!driver && live) {
      stopLive();
      store.setState({
        backend: null,
        role: null,
        selfId: null,
        tracking: false,
        restricted: false,
        deletedExternally: false,
        status: null,
        pending: 0,
        pendingPaths: [],
        storedAsFiles: [],
        peers: {},
        members: [],
      });
    }
  });

  const publishBackend = (state: CollabLiveStoreState) => {
    const backend = state.status?.state === "ended" ? null : state.backend;
    const published = useLiveBackend.getState();
    if (
      published.projectId !== state.projectId ||
      published.backend !== backend ||
      published.overleaf !== state.overleaf ||
      published.pendingPaths !== state.pendingPaths ||
      published.storedAsFiles !== state.storedAsFiles
    ) {
      useLiveBackend.setState({
        projectId: state.projectId,
        backend,
        overleaf: state.overleaf,
        pendingPaths: state.pendingPaths,
        storedAsFiles: state.storedAsFiles,
      });
    }
  };
  const unsubscribeBackend = store.subscribe(publishBackend);

  let projectId = liveTarget();
  let turn = 0;
  const follow = () => {
    const next = liveTarget();
    if (next === projectId) return;
    const leaving = live?.ready && live.projectId === projectId ? projectId : null;
    projectId = next;
    const mine = ++turn;
    if (leaving === null) {
      openProject(projectId);
      return;
    }
    void Promise.all([collabHandBack(leaving), collabNoteHandBack(leaving)])
      .catch((error: unknown) => logError("collab hand back before switching", error))
      .finally(() => {
        if (!disposed && mine === turn) openProject(projectId);
      });
  };
  const unsubscribeFiles = useFilesStore.subscribe(follow);
  const unsubscribeNote = useCollabLiveNote.subscribe(follow);
  openProject(projectId);

  return () => {
    if (disposed) return;
    disposed = true;
    if (goLiveAgainNow === goLiveAgain) goLiveAgainNow = null;
    unsubscribeFiles();
    unsubscribeNote();
    unsubscribeStore();
    unsubscribeBackend();
    unsubscribeSweep();
    if (sweep !== null) clearInterval(sweep);
    stopLive();
    for (const pending of unlisteners) void pending.then((unlisten) => unlisten());
    store.setState(emptyLive(null));
    useLiveBackend.setState({ projectId: null, backend: null, overleaf: null, pendingPaths: [], storedAsFiles: [] });
  };
}
