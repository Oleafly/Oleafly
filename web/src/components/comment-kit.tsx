import { type ReactNode, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import { type CommentKit, type CommentKitLabels, CommentKitProvider, QUICK_REACTIONS } from "@/components/ui/comments/comment-kit";
import {
  type CommentPresenceFeed,
  createPresenceFeed,
  type PresenceView,
  presenceView,
  useFresh,
  usePublishPresence,
} from "@/components/ui/comments/comment-presence";
import { type CommentMember, mergeMentionPeople } from "@/components/ui/comments/mentions";
import { peerHue } from "@/features/collab/live/peer-hue";
import { useNow } from "@/hooks/use-now";
import type { WebPeer } from "../protocol";
import { useWeb } from "../store";
import { useActions } from "./context";
import { ConfirmDialog } from "./ConfirmDialog";
import { failureKey } from "./errors";
import { dateTime, relativeTime } from "./format";

const REACTIONS = { quick: QUICK_REACTIONS };

export function webRetryable(failure: unknown): boolean {
  const key = failureKey(failure);
  return key === "offline" || key === "generic";
}

interface ActivePeer {
  peer: WebPeer;
  at: number;
}

const activeAt = (entry: ActivePeer) => entry.at;

function usePeerPresence(): PresenceView {
  const self = useWeb((state) => state.me?.accountId ?? null);
  const peers = useWeb(useShallow((state) => state.peers.filter((peer) => peer.activity && peer.accountId !== self)));
  const activityAt = useWeb((state) => state.activityAt);
  const people = useWeb((state) => state.people);
  const entries = useMemo(() => peers.map((peer) => ({ peer, at: activityAt[peer.deviceId] ?? 0 })), [peers, activityAt]);
  const fresh = useFresh(entries, activeAt);
  return useMemo(
    () =>
      presenceView(
        fresh.flatMap(({ peer }) =>
          peer.activity
            ? [
                {
                  person: { id: peer.accountId, name: people[peer.accountId]?.name || peer.name || "", imageUrl: people[peer.accountId]?.avatarUrl },
                  kind: peer.activity.kind,
                  threadId: peer.activity.threadId,
                },
              ]
            : [],
        ),
      ),
    [fresh, people],
  );
}

function PeerPresence({ feed }: Readonly<{ feed: CommentPresenceFeed }>) {
  usePublishPresence(feed, usePeerPresence());
  return null;
}

export function useWebMentionMembers(): CommentMember[] {
  const { t } = useTranslation(["web"]);
  const people = useWeb((state) => state.people);
  const owner = useWeb((state) => state.owner?.accountId ?? null);
  const present = useWeb(useShallow((state) => state.peers.map((peer) => peer.accountId)));
  return useMemo(() => {
    const member = (person: (typeof people)[string]): CommentMember => ({
      accountId: person.accountId,
      displayName: person.name,
      login: person.login,
      role: person.role ? t(($) => $.web.roles[person.role ?? "unknown"]) : null,
    });
    const listed = Object.values(people);
    const known = listed.filter((person) => person.role || person.accountId === owner).map(member);
    const guests = listed.filter((person) => !person.role && person.accountId !== owner).map(member);
    return mergeMentionPeople(known, new Set(present), guests);
  }, [people, owner, present, t]);
}

export function WebCommentKit({
  labels: overrides,
  maxLength,
  children,
}: Readonly<{ labels?: Partial<CommentKitLabels>; maxLength: number; children: ReactNode }>) {
  const { t, i18n } = useTranslation(["web"]);
  const actions = useActions();
  const now = useNow();
  const people = useWeb((state) => state.people);
  const self = useWeb((state) => state.me?.accountId ?? null);
  const reactions = useWeb((state) => state.features.reactions);
  const moderate = useWeb((state) => state.role === "owner" && state.connection === "online");
  const members = useWebMentionMembers();
  const [presence] = useState(createPresenceFeed);
  const kit = useMemo<CommentKit>(() => {
    const names = new Intl.ListFormat(i18n.language, { type: "conjunction" });
    return {
      labels: {
        showMore: t(($) => $.web.comments.showMore),
        showLess: t(($) => $.web.comments.showLess),
        mentionList: t(($) => $.web.comments.mentionList),
        hereNow: t(($) => $.web.comments.hereNow),
        outdated: t(($) => $.web.comments.outdated),
        cancel: t(($) => $.web.app.cancel),
        sending: t(($) => $.web.comments.sending),
        enter: t(($) => $.web.comments.enterKey),
        notSent: t(($) => $.web.comments.notSent),
        retry: t(($) => $.web.app.retry),
        format: {
          bold: t(($) => $.web.comments.format.bold),
          italic: t(($) => $.web.comments.format.italic),
          strike: t(($) => $.web.comments.format.strike),
          code: t(($) => $.web.comments.format.code),
          list: t(($) => $.web.comments.format.list),
          mention: t(($) => $.web.comments.format.mention),
        },
        edited: t(($) => $.web.comments.edited),
        deleted: t(($) => $.web.comments.deleted),
        edit: t(($) => $.web.comments.edit),
        editLabel: t(($) => $.web.comments.editLabel),
        delete: t(($) => $.web.comments.delete),
        save: t(($) => $.web.comments.save),
        reply: t(($) => $.web.comments.reply),
        replyLabel: t(($) => $.web.comments.replyLabel),
        replyPlaceholder: t(($) => $.web.comments.replyPlaceholder),
        replies: (count) => t(($) => $.web.comments.replies, { count }),
        hideReplies: t(($) => $.web.comments.hideReplies),
        lastReply: (time) => t(($) => $.web.comments.lastReply, { time }),
        messageActions: t(($) => $.web.comments.messageActions),
        resolve: t(($) => $.web.comments.resolve),
        reopen: t(($) => $.web.comments.reopen),
        send: t(($) => $.web.chat.send),
        addReaction: t(($) => $.web.comments.addReaction),
        you: t(($) => $.web.comments.you),
        reactWith: (emoji) => t(($) => $.web.comments.reactWith, { emoji }),
        reactedBy: (list, emoji) => t(($) => $.web.comments.reactedBy, { names: list, emoji }),
        deleteMessageConfirm: {
          title: t(($) => $.web.comments.deleteTitle),
          description: t(($) => $.web.comments.deleteDescription),
        },
        newBadge: t(($) => $.web.comments.newBadge),
        waiting: t(($) => $.web.comments.waiting),
        copyText: t(($) => $.web.comments.copyText),
        discard: t(($) => $.web.comments.discard),
        removed: t(($) => $.web.comments.removed),
        remove: t(($) => $.web.comments.remove),
        removeConfirm: {
          title: t(($) => $.web.comments.removeTitle),
          description: t(($) => $.web.comments.removeDescription),
        },
        replying: {
          one: (name) => t(($) => $.web.comments.replyingOne, { name }),
          two: (first, second) => t(($) => $.web.comments.replyingTwo, { first, second }),
          many: (count) => t(($) => $.web.comments.replyingMany, { number: count }),
        },
        ...overrides,
      },
      now,
      relative: (at, from) => relativeTime(at, from),
      exact: (at) => dateTime(at),
      members,
      self,
      hue: (accountId) => peerHue(accountId, self, "server"),
      describeError: (failure) => t(($) => $.web.errors[failureKey(failure)]),
      canRetry: webRetryable,
      Confirm: ConfirmDialog,
      maxLength,
      nameOf: (accountId) =>
        accountId === self ? t(($) => $.web.people.you) : people[accountId]?.name || t(($) => $.web.people.someone),
      listNames: (list) => names.format(list),
      copyText: (value) => navigator.clipboard.writeText(value),
      reactions: reactions ? REACTIONS : undefined,
      moderate,
      activity: (scope, active) => actions.setActivity(scope, active),
      presence,
    };
  }, [t, i18n.language, overrides, now, people, self, reactions, maxLength, moderate, members, actions, presence]);
  return (
    <CommentKitProvider value={kit}>
      <PeerPresence feed={presence} />
      {children}
    </CommentKitProvider>
  );
}
