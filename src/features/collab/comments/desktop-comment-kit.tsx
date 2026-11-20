import { useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { EmojiChooser } from "@/components/editor/emoji-chooser";
import type { CommentComposerLabels } from "@/components/ui/comments/comment-composer";
import {
  type CommentConfirmProps,
  type CommentKit,
  type CommentKitLabels,
  CommentKitProvider,
  QUICK_REACTIONS,
} from "@/components/ui/comments/comment-kit";
import { type CommentPresenceFeed, createPresenceFeed, usePublishPresence } from "@/components/ui/comments/comment-presence";
import type { CommentQuoteLabels } from "@/components/ui/comments/comment-quote";
import { type CommentMember, mergeMentionPeople } from "@/components/ui/comments/mentions";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { writeClipboardText } from "@/lib/clipboard";
import { formatDateTime, formatList, formatNumber, formatRelativeTimeFrom } from "@/lib/intl";
import type { CollabPerson, CollabProjectRole } from "@/lib/tauri";
import { useCollabLiveStore } from "../live/live-store";
import { sendPresenceActivity, usePeerPresence, usePresentAccounts } from "../live/peer-activity";
import { peerHue } from "../live/peer-hue";
import { commentFailure, commentRetryable } from "./refusals";

function DestructiveConfirm(props: Readonly<CommentConfirmProps>) {
  return <ConfirmationDialog {...props} destructive />;
}

function PeerPresence({ feed }: Readonly<{ feed: CommentPresenceFeed }>) {
  usePublishPresence(feed, usePeerPresence());
  return null;
}

const REACTIONS = {
  quick: QUICK_REACTIONS,
  more: (pick: (emoji: string) => void) => <EmojiChooser onSelect={pick} />,
};

const NAMED_ROLES: ReadonlySet<CollabProjectRole> = new Set(["owner", "editor", "reviewer", "commenter", "viewer"]);

export function useMentionMembers(): CommentMember[] {
  const { t } = useTranslation(["collab"]);
  const members = useCollabLiveStore((state) => state.members);
  const present = usePresentAccounts();
  return useMemo(
    () =>
      mergeMentionPeople(
        members.map((member) => ({
          accountId: member.person.account_id,
          displayName: member.person.display_name,
          login: member.person.login,
          role: NAMED_ROLES.has(member.role)
            ? t(($) => $.collab.projectRoles[member.role as Exclude<CollabProjectRole, "unknown">])
            : null,
        })),
        present,
      ),
    [members, present, t],
  );
}

export function useCommentQuoteLabels(): CommentQuoteLabels {
  const { t } = useTranslation(["collab", "common"]);
  return useMemo(
    () => ({
      showMore: t(($) => $.common.actions.showMore),
      showLess: t(($) => $.common.actions.showLess),
      outdated: t(($) => $.collab.comments.outdated),
    }),
    [t],
  );
}

export function useCommentComposerLabels(): CommentComposerLabels {
  const { t } = useTranslation(["collab", "common", "editor", "shell"]);
  return useMemo(
    () => ({
      mentionList: t(($) => $.collab.comments.mentionList),
      hereNow: t(($) => $.collab.comments.hereNow),
      cancel: t(($) => $.common.actions.cancel),
      sending: t(($) => $.collab.comments.sending),
      enter: t(($) => $.shell.keys.enter),
      notSent: t(($) => $.collab.comments.notSentShort),
      retry: t(($) => $.common.actions.retry),
      format: {
        bold: t(($) => $.editor.toolbar.bold),
        italic: t(($) => $.editor.toolbar.italic),
        strike: t(($) => $.editor.toolbar.strikethrough),
        code: t(($) => $.editor.toolbar.inlineCode),
        list: t(($) => $.editor.toolbar.bulletedList),
        mention: t(($) => $.collab.comments.mention),
      },
    }),
    [t],
  );
}

export function DesktopCommentKit({
  now,
  self,
  members,
  people,
  reactions,
  moderate = false,
  labels: overrides,
  maxLength,
  children,
}: Readonly<{
  now: number;
  self: string | null;
  members: readonly CommentMember[];
  people: ReadonlyMap<string, CollabPerson>;
  reactions: boolean;
  moderate?: boolean;
  labels?: Partial<CommentKitLabels>;
  maxLength?: number;
  children: ReactNode;
}>) {
  const { t } = useTranslation(["collab", "common"]);
  const quote = useCommentQuoteLabels();
  const composer = useCommentComposerLabels();
  const [presence] = useState(createPresenceFeed);
  const kit = useMemo<CommentKit>(
    () => ({
      labels: {
        ...quote,
        ...composer,
        edited: t(($) => $.collab.comments.edited),
        deleted: t(($) => $.collab.comments.deleted),
        edit: t(($) => $.common.actions.edit),
        editLabel: t(($) => $.collab.comments.editLabel),
        delete: t(($) => $.common.actions.delete),
        save: t(($) => $.common.actions.save),
        reply: t(($) => $.collab.comments.reply),
        replyLabel: t(($) => $.collab.comments.replyLabel),
        replyPlaceholder: t(($) => $.collab.comments.replyPlaceholder),
        replies: (count) => t(($) => $.collab.comments.replies, { number: formatNumber(count) }),
        hideReplies: t(($) => $.collab.comments.hideReplies),
        lastReply: (time) => t(($) => $.collab.comments.lastReply, { time }),
        messageActions: t(($) => $.collab.comments.messageActions),
        resolve: t(($) => $.collab.comments.resolve),
        reopen: t(($) => $.collab.comments.reopen),
        send: t(($) => $.collab.comments.send),
        copyLink: t(($) => $.collab.comments.copyLink),
        copied: t(($) => $.common.actions.copied),
        addReaction: t(($) => $.collab.comments.addReaction),
        moreEmoji: t(($) => $.collab.comments.moreEmoji),
        you: t(($) => $.collab.comments.you),
        reactWith: (emoji) => t(($) => $.collab.comments.reactWith, { emoji }),
        reactedBy: (names, emoji) => t(($) => $.collab.comments.reactedBy, { names, emoji }),
        deleteThread: t(($) => $.collab.comments.deleteThread),
        deleteMessageConfirm: {
          title: t(($) => $.collab.comments.deleteMessageConfirm.title),
          description: t(($) => $.collab.comments.deleteMessageConfirm.description),
        },
        deleteThreadConfirm: {
          title: t(($) => $.collab.comments.deleteThreadConfirm.title),
          description: t(($) => $.collab.comments.deleteThreadConfirm.description),
        },
        newBadge: t(($) => $.collab.comments.newBadge),
        waiting: t(($) => $.collab.comments.waiting),
        copyText: t(($) => $.collab.comments.notSent.copy),
        discard: t(($) => $.collab.comments.discard),
        removed: t(($) => $.collab.comments.removed),
        remove: t(($) => $.collab.comments.remove),
        removeConfirm: {
          title: t(($) => $.collab.comments.removeConfirm.title),
          description: t(($) => $.collab.comments.removeConfirm.description),
          confirm: t(($) => $.collab.comments.removeConfirm.confirm),
        },
        replying: {
          one: (name) => t(($) => $.collab.comments.replyingOne, { name }),
          two: (first, second) => t(($) => $.collab.comments.replyingTwo, { first, second }),
          many: (count) => t(($) => $.collab.comments.replyingMany, { number: formatNumber(count) }),
        },
        ...overrides,
      },
      now,
      relative: formatRelativeTimeFrom,
      exact: formatDateTime,
      members,
      self,
      hue: (accountId) => peerHue(accountId, self),
      describeError: commentFailure,
      canRetry: commentRetryable,
      Confirm: DestructiveConfirm,
      maxLength,
      nameOf: (accountId) => people.get(accountId)?.display_name || t(($) => $.collab.toolbar.unknownPerson),
      listNames: (names) => formatList(names, { type: "conjunction" }),
      copyText: writeClipboardText,
      reactions: reactions ? REACTIONS : undefined,
      moderate,
      activity: sendPresenceActivity,
      presence,
    }),
    [t, quote, composer, overrides, now, members, self, people, reactions, maxLength, moderate, presence],
  );
  return (
    <CommentKitProvider value={kit}>
      <PeerPresence feed={presence} />
      {children}
    </CommentKitProvider>
  );
}
