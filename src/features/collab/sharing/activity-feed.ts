import { useCollabRail } from "@/components/collab/collab-rail";
import type { CollabProjectMember } from "@/lib/tauri";
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

function nameOf(peer: LivePeer, members: readonly CollabProjectMember[]): string {
  const member = members.find((entry) => entry.person.account_id === peer.accountId);
  return member?.person.display_name ?? peer.person?.display_name ?? "";
}

function welcome(state: CollabLiveStoreState, at: number): NewActivity | null {
  const role = state.role ?? state.share?.role ?? null;
  if (!state.projectId || !state.share || role === null || role === "owner") return null;
  const owner = state.members.find((member) => member.role === "owner")?.person.display_name;
  if (!owner || readWelcomed().includes(state.projectId)) return null;
  markWelcomed(state.projectId);
  return { kind: "welcome", at, owner, server: state.share.server_name, role };
}

function sharingChanged(state: CollabLiveStoreState, previous: CollabLiveStoreState | null): boolean {
  return (
    previous === null ||
    previous.projectId !== state.projectId ||
    previous.share !== state.share ||
    previous.role !== state.role ||
    previous.members !== state.members
  );
}

interface FeedMemory {
  server: string;
  offline: boolean;
}

function changes(state: CollabLiveStoreState, previous: CollabLiveStoreState, memory: FeedMemory, at: number) {
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
  if (state.merged && state.merged !== previous.merged) found.push({ kind: "merged", at, files: state.merged.files });
  if (previous.share && previous.role && state.role && previous.role !== state.role) {
    found.push({ kind: "role", at, role: state.role });
  }
  if (state.ended && state.ended !== previous.ended) {
    if (state.ended === "signed_out") found.push({ kind: "signedOut", at, server: memory.server });
    else if (state.ended === "removed" || state.ended === "archived") found.push({ kind: state.ended, at });
  }
  if (!state.ended && after !== "ended") {
    const was = presentAccounts(previous);
    const now = presentAccounts(state);
    for (const [accountId, peer] of was) {
      if (!now.has(accountId)) found.push({ kind: "left", at, accountId, name: nameOf(peer, state.members) });
    }
    for (const [accountId, peer] of now) {
      if (!was.has(accountId)) found.push({ kind: "joined", at, accountId, name: nameOf(peer, state.members) });
    }
  }
  return found;
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
    if (previous && previous.projectId === state.projectId) {
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
  sync(useCollabLiveStore.getState(), null);
  return () => {
    stopLive();
    stopActivity();
    useCollabRail.setState({ visible: false, unread: false });
  };
}
