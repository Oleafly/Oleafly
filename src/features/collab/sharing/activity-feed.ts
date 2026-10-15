import { useCollabRail } from "@/components/collab/collab-rail";
import { logError } from "@/lib/log";
import {
  onCollabChangeSkipped,
  onCollabLiveRenamed,
  onCollabLiveSettings,
  type CollabChangeSkipped,
  type CollabLiveRenamed,
  type CollabLiveSettings,
  type CollabProjectMember,
} from "@/lib/tauri";
import { useCollabLiveStore, type CollabLiveStoreState, type LivePeer } from "../live/live-store";
import { useCollabActivity, type NewActivity } from "./activity-store";

export const WELCOMED_KEY = "oleafly.collab.welcomed";

function readWelcomed(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(WELCOMED_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
  } catch {
    return [];
  }
}

function markWelcomed(projectId: string): void {
  try {
    localStorage.setItem(WELCOMED_KEY, JSON.stringify([...readWelcomed(), projectId]));
  } catch {
    return;
  }
}

function presentAccounts(state: CollabLiveStoreState): Map<string, LivePeer> {
  const selfId = state.share?.account_id ?? null;
  const accounts = new Map<string, LivePeer>();
  for (const peer of Object.values(state.peers)) {
    if (peer.accountId !== selfId && !accounts.has(peer.accountId)) accounts.set(peer.accountId, peer);
  }
  return accounts;
}

function memberName(accountId: string, members: readonly CollabProjectMember[]): string {
  return members.find((entry) => entry.person.account_id === accountId)?.person.display_name ?? "";
}

function nameOf(peer: LivePeer, members: readonly CollabProjectMember[]): string {
  return memberName(peer.accountId, members) || (peer.person?.display_name ?? "");
}

function welcome(state: CollabLiveStoreState, at: number): NewActivity | null {
  const role = state.role ?? state.share?.role ?? null;
  if (!state.projectId || !state.share || role === null || role === "owner") return null;
  const owner = state.members.find((member) => member.role === "owner")?.person.display_name;
  if (!owner || readWelcomed().includes(state.projectId)) return null;
  markWelcomed(state.projectId);
  return { kind: "welcome", at, owner, server: state.share.server_name, role };
}

function isGuest(state: CollabLiveStoreState): boolean {
  const selfId = state.share?.account_id ?? null;
  return state.members.some((member) => member.person.account_id === selfId && member.person.guest === true);
}

function memberEntry(state: CollabLiveStoreState, at: number): NewActivity | null {
  const change = state.memberChange;
  const selfId = state.share?.account_id ?? null;
  if (!change || change.accountId === selfId) return null;
  if (change.kind !== "added" && change.kind !== "removed") return null;
  return {
    kind: change.kind === "added" ? "memberAdded" : "memberRemoved",
    at,
    accountId: change.accountId,
    byAccountId: change.by,
    name: change.name,
    by: change.byName,
    byYou: change.by === selfId,
  };
}

function removedBy(state: CollabLiveStoreState): string | undefined {
  const change = state.memberChange;
  const selfId = state.share?.account_id ?? null;
  if (change?.kind !== "removed" || change.accountId !== selfId || change.by === selfId) return undefined;
  return change.byName || undefined;
}

function endedEntry(state: CollabLiveStoreState, memory: FeedMemory, at: number): NewActivity | null {
  switch (state.ended) {
    case "signed_out":
      return { kind: "signedOut", at, server: memory.server };
    case "account_suspended":
      return { kind: "suspended", at, server: memory.server };
    case "access_ended":
      return { kind: "accessEnded", at, server: memory.server, guest: isGuest(state) };
    case "removed":
      return { kind: "removed", at, by: removedBy(state) };
    case "archived":
      return { kind: "archived", at };
    case "client_too_old":
      return { kind: "clientTooOld", at, server: memory.server };
    case "server_too_old":
      return { kind: "serverTooOld", at, server: memory.server };
    case "server_changed":
      return { kind: "serverChanged", at, server: memory.server };
    case "failed":
      return { kind: "failed", at };
    default:
      return null;
  }
}

function sharingChanged(state: CollabLiveStoreState, previous: CollabLiveStoreState | null): boolean {
  return (
    previous?.projectId !== state.projectId ||
    previous.share !== state.share ||
    previous.role !== state.role ||
    previous.members !== state.members
  );
}

interface FeedMemory {
  server: string;
  offline: boolean;
}

function connectionEntries(
  state: CollabLiveStoreState,
  previous: CollabLiveStoreState,
  memory: FeedMemory,
  at: number,
): NewActivity[] {
  const found: NewActivity[] = [];
  const before = previous.status?.state ?? null;
  const after = state.status?.state ?? null;
  if (after === "offline" && before !== "offline") {
    memory.offline = true;
    found.push({ kind: "offline", at, pending: state.pending });
  }
  if (after === "online" && before !== "online" && memory.offline) {
    memory.offline = false;
    found.push({ kind: "online", at });
  }
  return found;
}

function projectEntries(state: CollabLiveStoreState, previous: CollabLiveStoreState, at: number): NewActivity[] {
  const found: NewActivity[] = [];
  if (state.merged && state.merged !== previous.merged) {
    const { files, authors, review } = state.merged;
    found.push({ kind: "merged", at, files, authors, review });
  }
  if (state.newDevice && state.newDevice !== previous.newDevice) {
    const { accountId } = state.newDevice;
    found.push({ kind: "newDevice", at, accountId, name: memberName(accountId, state.members) });
  }
  if (previous.share && previous.role && state.role && previous.role !== state.role) {
    found.push({ kind: "role", at, role: state.role });
  }
  return found;
}

function membershipEntries(
  state: CollabLiveStoreState,
  previous: CollabLiveStoreState,
  memory: FeedMemory,
  at: number,
): NewActivity[] {
  const found: NewActivity[] = [];
  if (state.memberChange && state.memberChange !== previous.memberChange) {
    const entry = memberEntry(state, at);
    if (entry) found.push(entry);
  }
  if (state.ended && state.ended !== previous.ended) {
    const entry = endedEntry(state, memory, at);
    if (entry) found.push(entry);
  }
  return found;
}

function presenceEntries(state: CollabLiveStoreState, previous: CollabLiveStoreState, at: number): NewActivity[] {
  const found: NewActivity[] = [];
  if (state.ended || state.status?.state === "ended") return found;
  const was = presentAccounts(previous);
  const now = presentAccounts(state);
  for (const [accountId, peer] of was) {
    if (!now.has(accountId)) found.push({ kind: "left", at, accountId, name: nameOf(peer, state.members) });
  }
  for (const [accountId, peer] of now) {
    if (!was.has(accountId)) found.push({ kind: "joined", at, accountId, name: nameOf(peer, state.members) });
  }
  return found;
}

function changes(state: CollabLiveStoreState, previous: CollabLiveStoreState, memory: FeedMemory, at: number) {
  return [
    ...connectionEntries(state, previous, memory, at),
    ...projectEntries(state, previous, at),
    ...membershipEntries(state, previous, memory, at),
    ...presenceEntries(state, previous, at),
  ];
}

function renamedEntry(payload: CollabLiveRenamed): NewActivity | null {
  const live = useCollabLiveStore.getState();
  if (payload.projectId !== live.projectId) return null;
  const { accountId, before, ours, theirs } = payload;
  const name = accountId ? memberName(accountId, live.members) : "";
  return { kind: "renamed", at: Date.now(), accountId, name, before, ours, theirs };
}

function settingEntries(payload: CollabLiveSettings): NewActivity[] {
  const live = useCollabLiveStore.getState();
  if (payload.projectId !== live.projectId) return [];
  const { accountId } = payload;
  const name = accountId ? memberName(accountId, live.members) : "";
  const at = Date.now();
  return payload.changes.map((change) => ({ kind: "setting", at, accountId, name, change }));
}

function skippedEntry(payload: CollabChangeSkipped): NewActivity | null {
  const live = useCollabLiveStore.getState();
  if (payload.projectId !== live.projectId) return null;
  const peer = payload.deviceId ? live.peers[payload.deviceId] : undefined;
  const name = peer ? nameOf(peer, live.members) : "";
  return { kind: "skipped", at: Date.now(), deviceId: payload.deviceId, name };
}

function syncRail() {
  const live = useCollabLiveStore.getState();
  const visible = live.projectId !== null && (live.share !== null || live.status?.state === "ended");
  const unread = visible && useCollabActivity.getState().unread;
  const rail = useCollabRail.getState();
  if (rail.visible !== visible || rail.unread !== unread) useCollabRail.setState({ visible, unread });
}

export function startCollabActivity(): () => void {
  const memory: FeedMemory = { server: "", offline: false };
  const sync = (state: CollabLiveStoreState, previous: CollabLiveStoreState | null) => {
    const activity = useCollabActivity.getState();
    activity.open(state.projectId);
    if (state.share) memory.server = state.share.server_name;
    const at = Date.now();
    if (previous?.projectId === state.projectId) {
      for (const entry of changes(state, previous, memory, at)) useCollabActivity.getState().add(entry);
      if (state.status?.state === "offline" && previous.pending !== state.pending) {
        useCollabActivity.getState().setPending(state.pending);
      }
    } else {
      memory.server = state.share?.server_name ?? "";
      memory.offline = state.status?.state === "offline";
    }
    const greeting = sharingChanged(state, previous) ? welcome(state, at) : null;
    if (greeting) useCollabActivity.getState().add(greeting);
    syncRail();
  };
  const stopLive = useCollabLiveStore.subscribe((state, previous) => sync(state, previous));
  const stopActivity = useCollabActivity.subscribe(syncRail);
  const stopRenamed = onCollabLiveRenamed((payload) => {
    const entry = renamedEntry(payload);
    if (entry) useCollabActivity.getState().add(entry);
  }).catch((error: unknown) => {
    void logError("collab renamed listen", error);
    return () => undefined;
  });
  const stopSettings = onCollabLiveSettings((payload) => {
    for (const entry of settingEntries(payload)) useCollabActivity.getState().add(entry);
  }).catch((error: unknown) => {
    void logError("collab settings listen", error);
    return () => undefined;
  });
  // Quiet: the feed records it without marking the pane unread.
  const stopSkipped = onCollabChangeSkipped((payload) => {
    const entry = skippedEntry(payload);
    if (entry) useCollabActivity.getState().add(entry, { quiet: true });
  }).catch((error: unknown) => {
    void logError("collab skipped listen", error);
    return () => undefined;
  });
  sync(useCollabLiveStore.getState(), null);
  return () => {
    stopLive();
    stopActivity();
    void stopRenamed.then((unlisten) => unlisten());
    void stopSettings.then((unlisten) => unlisten());
    void stopSkipped.then((unlisten) => unlisten());
    useCollabRail.setState({ visible: false, unread: false });
  };
}
