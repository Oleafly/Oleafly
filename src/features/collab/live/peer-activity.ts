import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import type { CommentActivityScope } from "@/components/ui/comments/comment-kit";
import { type ActivePresence, type PresenceView, presenceView, useFresh } from "@/components/ui/comments/comment-presence";
import { collabPresenceActivity } from "@/lib/tauri-collab";
import { type LivePeer, useCollabLiveStore } from "./live-store";

export function sendPresenceActivity(scope: CommentActivityScope, active: boolean): void {
  const projectId = useCollabLiveStore.getState().projectId;
  if (!projectId) return;
  const activity = active ? { kind: scope.kind, threadId: scope.kind === "reply" ? scope.threadId : null } : null;
  void collabPresenceActivity(projectId, activity).catch(() => undefined);
}

const activityAt = (peer: LivePeer) => peer.activityAt ?? 0;

function activeOf(peer: LivePeer): ActivePresence[] {
  if (!peer.activity) return [];
  const person = { id: peer.accountId, name: peer.person?.display_name ?? "", imageUrl: peer.person?.avatar_url };
  return [{ person, kind: peer.activity.kind, threadId: peer.activity.threadId }];
}

export function usePeerPresence(): PresenceView {
  const self = useCollabLiveStore((state) => state.share?.account_id ?? null);
  const peers = useCollabLiveStore(
    useShallow((state) => Object.values(state.peers).filter((peer) => Boolean(peer.activity) && peer.accountId !== self)),
  );
  const fresh = useFresh(peers, activityAt);
  return useMemo(() => presenceView(fresh.flatMap(activeOf)), [fresh]);
}

export function usePresentAccounts(): ReadonlySet<string> {
  const accounts = useCollabLiveStore(useShallow((state) => Object.values(state.peers).map((peer) => peer.accountId)));
  return useMemo(() => new Set(accounts), [accounts]);
}
