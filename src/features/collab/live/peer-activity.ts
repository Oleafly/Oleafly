import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import type { CommentActivityScope } from "@/components/ui/comments/comment-kit";
import { type CommentPresence, useFresh } from "@/components/ui/comments/comment-presence";
import { collabPresenceActivity } from "@/lib/tauri-collab";
import { type LivePeer, useCollabLiveStore } from "./live-store";

export function sendPresenceActivity(scope: CommentActivityScope, active: boolean): void {
  const projectId = useCollabLiveStore.getState().projectId;
  if (!projectId) return;
  const activity = active ? { kind: scope.kind, threadId: scope.kind === "reply" ? scope.threadId : null } : null;
  void collabPresenceActivity(projectId, activity).catch(() => undefined);
}

const activityAt = (peer: LivePeer) => peer.activityAt ?? 0;

function presenceOf(peer: LivePeer): CommentPresence {
  return { id: peer.accountId, name: peer.person?.display_name ?? "", imageUrl: peer.person?.avatar_url };
}

function people(peers: readonly LivePeer[]): CommentPresence[] {
  const seen = new Map<string, CommentPresence>();
  for (const peer of peers) if (!seen.has(peer.accountId) && peer.person) seen.set(peer.accountId, presenceOf(peer));
  return [...seen.values()];
}

function useActivePeers(): LivePeer[] {
  const self = useCollabLiveStore((state) => state.share?.account_id ?? null);
  const peers = useCollabLiveStore(
    useShallow((state) => Object.values(state.peers).filter((peer) => Boolean(peer.activity) && peer.accountId !== self)),
  );
  return useFresh(peers, activityAt);
}

export function useReplying(): (threadId: string) => readonly CommentPresence[] {
  const peers = useActivePeers();
  return useMemo(() => {
    const byThread = new Map<string, LivePeer[]>();
    for (const peer of peers) {
      const thread = peer.activity?.kind === "reply" ? peer.activity.threadId : null;
      if (thread) byThread.set(thread, [...(byThread.get(thread) ?? []), peer]);
    }
    const shown = new Map([...byThread].map(([thread, list]) => [thread, people(list)]));
    return (threadId: string) => shown.get(threadId) ?? [];
  }, [peers]);
}

export function useChatTyping(): readonly CommentPresence[] {
  const peers = useActivePeers();
  return useMemo(() => people(peers.filter((peer) => peer.activity?.kind === "chat")), [peers]);
}

export function usePresentAccounts(): ReadonlySet<string> {
  const accounts = useCollabLiveStore(useShallow((state) => Object.values(state.peers).map((peer) => peer.accountId)));
  return useMemo(() => new Set(accounts), [accounts]);
}
