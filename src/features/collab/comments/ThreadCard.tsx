import { memo, useEffect, useMemo, useRef, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import type { CommentQuoteState } from "@/components/ui/comments/comment-quote";
import { mentionedIn } from "@/components/ui/comments/mentions";
import { type CommentEntry, type CommentMessageActions, messageEntry } from "@/components/ui/comments/comment-entry";
import { CommentThread, type CommentThreadActions, type CommentThreadModel } from "@/components/ui/comments/comment-thread";
import { useShallow } from "zustand/react/shallow";
import type {
  CollabChatMessage,
  CollabCommentMember,
  CollabCommentMessage,
  CollabCommentNotSent,
  CollabCommentThread,
  CollabPerson,
} from "@/lib/tauri";
import { useCollabLiveStore } from "../live/live-store";
import {
  deleteMessage,
  deleteThread,
  discardRefused,
  editMessage,
  openThreadIn,
  reactToComment,
  removeMessage,
  reopenThread,
  replyToThread,
  resolveThread,
  selectThread,
  useComments,
  type RefusedComment,
} from "./comments-store";
import { refusalText } from "./refusals";

export interface ThreadContext {
  now: number;
  canWrite: boolean;
  self: string | null;
  people: ReadonlyMap<string, CollabPerson>;
  members: readonly CollabCommentMember[];
  projectLink?: string | null;
}

export function threadLink(projectLink: string | null | undefined, thread: CollabCommentThread): string | undefined {
  if (!projectLink) return undefined;
  try {
    const url = new URL(projectLink);
    url.searchParams.set("file", thread.fileId);
    url.searchParams.set("thread", thread.id);
    return url.toString();
  } catch {
    return undefined;
  }
}

export function moveFocus(event: KeyboardEvent<HTMLButtonElement>) {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  const pane = event.currentTarget.closest("[data-comments-pane]");
  if (!pane) return;
  const jumps = [...pane.querySelectorAll<HTMLElement>("[data-thread-jump]")];
  const next = jumps[jumps.indexOf(event.currentTarget) + (event.key === "ArrowDown" ? 1 : -1)];
  if (!next) return;
  event.preventDefault();
  next.focus();
}

export interface AuthorNames {
  unknown: string;
  unverified: string;
}

export function useAuthorNames(): AuthorNames {
  const { t } = useTranslation(["collab"]);
  const unknown = t(($) => $.collab.toolbar.unknownPerson);
  const unverified = t(($) => $.collab.comments.unverifiedAuthor);
  return useMemo(() => ({ unknown, unverified }), [unknown, unverified]);
}

export function entryFor(
  message: CollabCommentMessage | CollabChatMessage,
  person: CollabPerson | undefined,
  names: AuthorNames,
): CommentEntry {
  return messageEntry(message, {
    id: message.author,
    name: message.verified ? person?.display_name || names.unknown : names.unverified,
    imageUrl: person?.avatar_url,
    verified: message.verified,
  });
}

function useEntryOf(context: ThreadContext): (message: CollabCommentMessage) => CommentEntry {
  const names = useAuthorNames();
  return (message) => entryFor(message, message.verified ? context.people.get(message.author) : undefined, names);
}

export function selfAuthor(context: Pick<ThreadContext, "self" | "people">, fallback: string): CommentEntry["author"] {
  const person = context.self ? context.people.get(context.self) : undefined;
  return { id: context.self ?? "", name: person?.display_name || fallback, imageUrl: person?.avatar_url, verified: true };
}

function useUnsentEntries(
  thread: CollabCommentThread,
  context: ThreadContext,
): { edits: ReadonlyMap<string, CommentEntry>; added: CommentEntry[] } {
  const { t } = useTranslation(["collab"]);
  const refused = useComments(useShallow((state) => state.refused.filter((entry) => entry.threadId === thread.id)));
  const batch = useCollabLiveStore(
    useShallow((state) => (state.commentsNotSent ?? []).filter((entry) => entry.threadId === thread.id && !entry.newThread)),
  );
  const author = selfAuthor(context, t(($) => $.collab.toolbar.unknownPerson));
  const reason = useNotSentReason();
  const edited = (comment: CollabCommentNotSent) => comment.edit && thread.messages.some((message) => message.id === comment.messageId);
  return {
    edits: new Map(batch.filter(edited).map((comment) => [comment.messageId, notSentEntry(comment, author, reason)])),
    added: [
      ...batch.filter((comment) => !edited(comment)).map((comment) => notSentEntry(comment, author, reason)),
      ...refused.map((entry) => refusedEntry(entry, author)),
    ],
  };
}

export function useNotSentReason(): string {
  const serverOff = useComments((state) => state.status?.serverAllowed === false);
  return refusalText(serverOff ? "comment_off_server" : "comment_off_project");
}

export function refusedEntry(entry: RefusedComment, author: CommentEntry["author"]): CommentEntry {
  return {
    id: entry.key,
    author,
    at: entry.at,
    editedAt: null,
    deleted: false,
    body: entry.body,
    mentions: [],
    delivery: { state: "failed", reason: entry.reason, discard: () => discardRefused(entry.key) },
  };
}

export function notSentEntry(comment: CollabCommentNotSent, author: CommentEntry["author"], reason: string): CommentEntry {
  return {
    id: `not-sent-${comment.messageId || comment.threadId}`,
    author,
    at: comment.at,
    editedAt: comment.edit ? (comment.editedAt ?? comment.at) : null,
    deleted: false,
    body: comment.body,
    mentions: [],
    delivery: {
      state: "failed",
      reason,
      discard: () => useCollabLiveStore.getState().discardCommentNotSent(comment),
    },
  };
}

function messageActions(thread: CollabCommentThread): CommentMessageActions {
  return {
    edit: (messageId, body) => editMessage(thread, messageId, body),
    remove: (messageId) => deleteMessage(thread, messageId),
    moderate: (messageId) => removeMessage(thread, messageId),
    react: (messageId, emoji, on) => reactToComment(thread, messageId, emoji, on),
  };
}

function useThreadView(
  thread: CollabCommentThread,
  context: ThreadContext,
  quoteState: CommentQuoteState,
): { model: CommentThreadModel; actions: CommentThreadActions } {
  const { t } = useTranslation(["collab"]);
  const entryOf = useEntryOf(context);
  const unsent = useUnsentEntries(thread, context);
  const unknown = t(($) => $.collab.toolbar.unknownPerson);
  const author = context.people.get(thread.createdBy)?.display_name || unknown;
  const resolution = (() => {
    if (!thread.resolved) return null;
    if (!thread.resolved.verified) return t(($) => $.collab.comments.resolvedUnverified);
    const name = context.people.get(thread.resolved.by)?.display_name || unknown;
    return t(($) => $.collab.comments.resolvedBy, { name });
  })();
  const model: CommentThreadModel = {
    id: thread.id,
    label: thread.verified
      ? t(($) => $.collab.comments.thread, { name: author })
      : t(($) => $.collab.comments.unverifiedThread),
    quote: thread.anchor.quote,
    quoteState,
    resolution,
    messages: [
      ...thread.messages.map((message) => {
        const edit = unsent.edits.get(message.id);
        const entry = entryOf(message);
        if (!edit) return entry;
        const { id, body, editedAt, delivery } = edit;
        return { ...entry, id, body, editedAt, delivery, deleted: false, removed: false, mentions: mentionedIn(body, context.members) };
      }),
      ...unsent.added,
    ],
    link: threadLink(context.projectLink, thread),
    deletable:
      thread.verified &&
      thread.createdBy === context.self &&
      thread.messages.every((message) => message.deleted || (message.verified && message.author === context.self)),
  };
  const actions = useMemo<CommentThreadActions>(
    () => ({
      ...messageActions(thread),
      reply: (body) => replyToThread(thread, body),
      resolve: () => resolveThread(thread),
      reopen: () => reopenThread(thread),
      removeThread: () => deleteThread(thread),
    }),
    [thread],
  );
  return { model, actions };
}

export function EmbeddedThread({ thread, context }: Readonly<{ thread: CollabCommentThread; context: ThreadContext }>) {
  const { model, actions } = useThreadView(thread, context, "anchored");
  return <CommentThread thread={model} actions={actions} canWrite={context.canWrite} embedded />;
}

export const ThreadCard = memo(function ThreadCard({
  thread,
  selected,
  focus,
  context,
  path,
  quoteState = "anchored",
}: Readonly<{
  thread: CollabCommentThread;
  selected: boolean;
  focus: number;
  context: ThreadContext;
  path?: string;
  quoteState?: CommentQuoteState;
}>) {
  const { t } = useTranslation(["collab"]);
  const card = useRef<HTMLElement>(null);
  const seen = useRef(focus);
  const { model, actions } = useThreadView(thread, context, quoteState);

  useEffect(() => {
    if (selected && focus !== seen.current) card.current?.scrollIntoView?.({ block: "nearest" });
    seen.current = focus;
  }, [focus, selected]);

  return (
    <li>
      <CommentThread
        cardRef={card}
        thread={model}
        actions={actions}
        canWrite={context.canWrite}
        selected={selected}
        quoteTitle={t(($) => $.collab.comments.showInEditor)}
        onJump={() => (path === undefined ? selectThread(thread.id, { reveal: true }) : openThreadIn(path, thread.id))}
        onJumpKeyDown={moveFocus}
      />
    </li>
  );
});
