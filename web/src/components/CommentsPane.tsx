import type { CollabCommentThread } from "@oleafly/backend-port";
import { Check, Undo2, X } from "lucide-react";
import { type CSSProperties, memo, useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { type CommentArrival, CommentScrollArea, threadArrivals } from "@/components/ui/comments/comment-arrivals";
import { CommentComposer } from "@/components/ui/comments/comment-composer";
import { CommentKeys, CommentsEmpty, CommentsFootnote, CommentsOfflineQueue, withKeys } from "@/components/ui/comments/comment-empty";
import { type CommentFilter, CommentFilterMenu, keepsThread } from "@/components/ui/comments/comment-filter";
import { useCommentAction, useCommentKit } from "@/components/ui/comments/comment-kit";
import { CommentQuote } from "@/components/ui/comments/comment-quote";
import { CommentByline } from "@/components/ui/comments/comment-byline";
import { type CommentEntry, messageEntry } from "@/components/ui/comments/comment-entry";
import {
  commentCardClass,
  CommentThread,
  type CommentThreadActions,
  type CommentThreadModel,
} from "@/components/ui/comments/comment-thread";
import { InlineAlert } from "@/components/ui/inline-alert";
import { peerHue } from "@/features/collab/live/peer-hue";
import { cn } from "@/lib/utils";
import type { OutboxItem } from "../outbox";
import type { CollabSuggestion } from "../protocol";
import { abilitiesFor, canWithdraw } from "../roles";
import { useWeb } from "../store";
import { WebCommentKit } from "./comment-kit";
import { ConfirmDialog } from "./ConfirmDialog";
import { useActions } from "./context";
import { errorKey } from "./errors";
import { PersonAvatar, useMessageAuthor, usePersonName } from "./people";

const COMMENT_LIMIT = 20_000;
const NO_THREADS: readonly CollabCommentThread[] = [];
const NO_SUGGESTIONS: readonly CollabSuggestion[] = [];
const NO_OUTBOX: readonly OutboxItem[] = [];

export function useOutboxEntry(): (item: OutboxItem) => CommentEntry {
  const { t } = useTranslation(["web"]);
  const actions = useActions();
  const self = useWeb((state) => state.me?.accountId ?? "");
  const imageUrl = useWeb((state) => state.people[self]?.avatarUrl ?? null);
  return useCallback((item: OutboxItem): CommentEntry => ({
    id: item.id,
    author: { id: self, name: t(($) => $.web.people.you), imageUrl, verified: true },
    at: item.at,
    editedAt: null,
    deleted: false,
    body: item.body,
    mentions: [],
    delivery:
      item.state === "waiting"
        ? { state: "waiting" }
        : {
            state: "failed",
            reason: t(($) => $.web.errors[errorKey(item.reason ?? "generic")]),
            retry: item.retry ? () => actions.retryOutbox(item.id) : undefined,
            discard: () => actions.discardOutbox(item.id),
          },
  }), [t, actions, self, imageUrl]);
}

export function OutboxThread({ item }: Readonly<{ item: OutboxItem }>) {
  const { t } = useTranslation(["web"]);
  const entryOf = useOutboxEntry();
  return (
    <li>
      <CommentThread
        thread={{
          id: item.id,
          label: t(($) => $.web.comments.newComment),
          quote: item.quote ?? "",
          quoteState: "pending",
          resolution: null,
          messages: [entryOf(item)],
          deletable: false,
        }}
        actions={NO_ACTIONS}
        canWrite={false}
      />
    </li>
  );
}

const nothingToDo = () => Promise.resolve();
const NO_ACTIONS: CommentThreadActions = {
  reply: nothingToDo,
  resolve: nothingToDo,
  reopen: nothingToDo,
  removeThread: nothingToDo,
};

export const ThreadCard = memo(function ThreadCard({
  thread,
  canWrite,
  embedded = false,
}: Readonly<{ thread: CollabCommentThread; canWrite: boolean; embedded?: boolean }>) {
  const { t } = useTranslation(["web"]);
  const actions = useActions();
  const nameOf = usePersonName();
  const authorOf = useMessageAuthor();
  const outboxEntry = useOutboxEntry();
  const outbox = useWeb((state) => state.outbox);
  const queued = useMemo(
    () => outbox.filter((item) => item.kind === "reply" && item.threadId === thread.id),
    [outbox, thread.id],
  );
  const selected = useWeb((state) => state.selectedThreadId === thread.id);
  const author = nameOf(thread.createdBy, thread.verified);
  const resolver = thread.resolved ? nameOf(thread.resolved.by, thread.resolved.verified) : null;
  const model: CommentThreadModel = {
    id: thread.id,
    label: t(($) => $.web.comments.thread, { name: author }),
    quote: thread.anchor.quote,
    quoteState: thread.anchor.range ? "anchored" : "detached",
    resolution: resolver === null ? null : t(($) => $.web.comments.resolvedBy, { name: resolver }),
    messages: [...thread.messages.map((message) => messageEntry(message, authorOf(message))), ...queued.map(outboxEntry)],
    deletable: false,
  };
  const threadActions = useMemo<CommentThreadActions>(
    () => ({
      edit: (messageId, body) => actions.editComment(thread, messageId, body),
      remove: (messageId) => actions.deleteComment(thread, messageId),
      moderate: (messageId) => actions.deleteComment(thread, messageId),
      reply: (body) => actions.replyComment(thread, body),
      resolve: () => actions.resolveThread(thread),
      reopen: () => actions.reopenThread(thread),
      react: (messageId, emoji, on) => actions.reactComment(thread, messageId, emoji, on),
      removeThread: async () => undefined,
    }),
    [actions, thread],
  );
  const card = (
    <CommentThread
      thread={model}
      actions={threadActions}
      canWrite={canWrite}
      selected={selected}
      embedded={embedded}
      quoteTitle={t(($) => $.web.comments.showInSource)}
      onJump={thread.anchor.range ? () => actions.revealThread(thread) : undefined}
    >
      {!thread.anchor.range && !embedded ? (
        <p className="text-[0.6875rem] text-muted-foreground">{t(($) => $.web.comments.anchorLost)}</p>
      ) : null}
    </CommentThread>
  );
  return embedded ? card : <li>{card}</li>;
});

function SuggestionText({ suggestion, self }: Readonly<{ suggestion: CollabSuggestion; self: string | null }>) {
  const { t } = useTranslation(["web"]);
  const hue = peerHue(suggestion.author || "unknown", self, "server");
  const shown = suggestion.text.length > 280 ? `${suggestion.text.slice(0, 280)}…` : suggestion.text;
  const label = shown.trim() === "" ? t(($) => $.web.suggestions.lineBreak) : shown;
  return (
    <span
      style={{ "--suggest-hue": String(hue) } as CSSProperties}
      className={cn(
        "select-text whitespace-pre-wrap break-words rounded-sm px-0.5 text-xs",
        suggestion.kind === "insert" ? "web-suggest-insert" : "web-suggest-delete",
      )}
    >
      {label}
    </span>
  );
}

export function SuggestionCard({
  suggestion,
  thread,
}: Readonly<{ suggestion: CollabSuggestion; thread: CollabCommentThread | null }>) {
  const { t } = useTranslation(["web"]);
  const actions = useActions();
  const nameOf = usePersonName();
  const role = useWeb((state) => state.role);
  const features = useWeb((state) => state.features);
  const self = useWeb((state) => state.me?.accountId ?? null);
  const selected = useWeb((state) => state.selectedSuggestionId === suggestion.id);
  const abilities = abilitiesFor(role, features);
  const withdraw = !abilities.resolve && suggestion.verified && canWithdraw(role, suggestion.author, self);
  const { error, run, busy } = useCommentAction(useCommentKit().describeError);
  const name = nameOf(suggestion.author, suggestion.verified);
  return (
    <li>
      <article
        aria-label={t(($) => $.web.suggestions.card, { name })}
        aria-current={selected ? "true" : undefined}
        className={cn("space-y-3", commentCardClass(selected))}
      >
        <div className="flex min-w-0 items-center gap-1.5 text-xs">
          <PersonAvatar accountId={suggestion.author} name={name} verified={suggestion.verified} />
          <CommentByline
            name={name}
            nameClassName={cn("font-medium", !suggestion.verified && "italic text-muted-foreground")}
            at={suggestion.createdAt}
          />
          <Badge variant={suggestion.kind === "insert" ? "success" : "destructive"} size="sm" className="ml-auto shrink-0">
            {suggestion.kind === "insert" ? t(($) => $.web.suggestions.inserted) : t(($) => $.web.suggestions.deleted)}
          </Badge>
        </div>
        <button
          type="button"
          title={t(($) => $.web.comments.showInSource)}
          onClick={() => actions.revealSuggestion(suggestion)}
          className="block w-full rounded-sm text-left transition-colors focus-visible:bg-accent"
        >
          <SuggestionText suggestion={suggestion} self={self} />
        </button>
        {abilities.resolve || withdraw ? (
          <div className="flex flex-wrap gap-1.5">
            {abilities.resolve ? (
              <>
                <Button
                  type="button"
                  size="xs"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => run(() => actions.acceptSuggestions([suggestion.id]))}
                >
                  <Check aria-hidden />
                  {t(($) => $.web.suggestions.accept)}
                </Button>
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => run(() => actions.rejectSuggestions([suggestion.id]))}
                >
                  <X aria-hidden />
                  {t(($) => $.web.suggestions.reject)}
                </Button>
              </>
            ) : (
              <Button
                type="button"
                size="xs"
                variant="ghost"
                disabled={busy}
                onClick={() => run(() => actions.withdrawSuggestions([suggestion.id]))}
              >
                <Undo2 aria-hidden />
                {t(($) => $.web.suggestions.withdraw)}
              </Button>
            )}
          </div>
        ) : null}
        {error ? <InlineAlert>{error}</InlineAlert> : null}
        {thread ? <ThreadCard thread={thread} canWrite={abilities.comment} embedded /> : null}
      </article>
    </li>
  );
}

function FileGroup({
  fileId,
  path,
  threads,
  suggestions,
  filter,
  queued,
}: Readonly<{
  fileId: string;
  path: string;
  threads: readonly CollabCommentThread[];
  suggestions: readonly CollabSuggestion[];
  filter: CommentFilter;
  queued: readonly OutboxItem[];
}>) {
  const { t } = useTranslation(["web"]);
  const actions = useActions();
  const role = useWeb((state) => state.role);
  const features = useWeb((state) => state.features);
  const abilities = abilitiesFor(role, features);
  const [confirming, setConfirming] = useState(false);
  const { error, run, busy } = useCommentAction(useCommentKit().describeError);
  const linked = new Set(suggestions.map((suggestion) => suggestion.threadId).filter(Boolean));
  const byId = new Map(threads.map((thread) => [thread.id, thread]));
  const loose = threads.filter((thread) => !linked.has(thread.id));
  const sortedSuggestions = [...suggestions].sort((a, b) => a.from - b.from || a.createdAt - b.createdAt);
  const sortedThreads = loose.filter((thread) => keepsThread(filter, thread.resolved !== null)).sort(
    (a, b) => (a.anchor.range?.from ?? Number.MAX_SAFE_INTEGER) - (b.anchor.range?.from ?? Number.MAX_SAFE_INTEGER),
  );
  return (
    <section aria-label={path} className="space-y-1">
      <header className="sticky top-0 z-10 flex flex-wrap items-center gap-1.5 bg-sidebar/95 px-2 py-1.5 backdrop-blur">
        <h3 className="min-w-0 flex-1 truncate font-mono text-[0.6875rem] text-muted-foreground" title={path}>
          {path}
        </h3>
        {suggestions.length > 0 ? (
          <Badge variant="muted" size="sm">
            {t(($) => $.web.suggestions.pending, { count: suggestions.length })}
          </Badge>
        ) : null}
        {abilities.resolve && suggestions.length > 0 ? (
          <div className="flex basis-full justify-end gap-1">
            <Button type="button" size="xs" variant="ghost" disabled={busy} onClick={() => run(() => actions.acceptFile(fileId))}>
              {t(($) => $.web.suggestions.acceptAll)}
            </Button>
            <Button type="button" size="xs" variant="ghost" disabled={busy} onClick={() => setConfirming(true)}>
              {t(($) => $.web.suggestions.rejectAll)}
            </Button>
          </div>
        ) : null}
      </header>
      {error ? <InlineAlert>{error}</InlineAlert> : null}
      <ConfirmDialog
        open={confirming}
        title={t(($) => $.web.suggestions.rejectAllConfirm.title, { file: path.split("/").at(-1) ?? path })}
        description={t(($) => $.web.suggestions.rejectAllConfirm.description, { number: suggestions.length })}
        confirmLabel={t(($) => $.web.suggestions.rejectAllConfirm.confirm)}
        onConfirm={() => {
          setConfirming(false);
          run(() => actions.rejectFile(fileId));
        }}
        onCancel={() => setConfirming(false)}
      />
      <ul className="space-y-3 px-2">
        {sortedSuggestions.map((suggestion) => (
          <SuggestionCard
            key={suggestion.id}
            suggestion={suggestion}
            thread={suggestion.threadId ? (byId.get(suggestion.threadId) ?? null) : null}
          />
        ))}
        {queued.map((item) => (
          <OutboxThread key={item.id} item={item} />
        ))}
        {sortedThreads.map((thread) => (
          <ThreadCard key={thread.id} thread={thread} canWrite={abilities.comment} />
        ))}
      </ul>
    </section>
  );
}

function DraftComposer() {
  const { t } = useTranslation(["web"]);
  const actions = useActions();
  const kit = useCommentKit();
  const draft = useWeb((state) => state.draft);
  if (!draft) return null;
  return (
    <div className="space-y-2 border-b px-2 py-2">
      <p className="text-xs font-medium">{t(($) => $.web.comments.newComment)}</p>
      <CommentQuote quote={draft.quote} labels={kit.labels} />
      <CommentComposer
        key={`${draft.fileId}:${draft.from}:${draft.to}`}
        label={t(($) => $.web.comments.newComment)}
        placeholder={t(($) => $.web.comments.placeholder)}
        submitLabel={kit.labels.send}
        mentionButton
        autoFocus
        onSubmit={(body) => actions.createComment(body)}
        onCancel={() => actions.cancelComment()}
      />
    </div>
  );
}

function filterCounts(
  threads: Readonly<Record<string, readonly CollabCommentThread[]>>,
  suggestions: Readonly<Record<string, readonly CollabSuggestion[]>>,
): Record<CommentFilter, number> {
  const linked = new Set(Object.values(suggestions).flatMap((list) => list.map((suggestion) => suggestion.threadId)));
  const all = Object.values(threads).flat().filter((thread) => !linked.has(thread.id));
  const resolved = all.filter((thread) => thread.resolved).length;
  return { open: all.length - resolved, resolved, all: all.length };
}

function arrivalsOf(threads: Readonly<Record<string, readonly CollabCommentThread[]>>, self: string | null): CommentArrival[] {
  return Object.values(threads).flatMap((list) => threadArrivals(list, self));
}

function OfflineQueue() {
  const { t } = useTranslation(["web"]);
  const offline = useWeb((state) => state.connection === "offline" || state.connection === "connecting");
  const waiting = useWeb((state) => state.outbox.filter((item) => item.kind !== "chat" && item.state === "waiting").length);
  if (!offline || waiting === 0) return null;
  return <CommentsOfflineQueue>{t(($) => $.web.comments.offlineQueued, { count: waiting })}</CommentsOfflineQueue>;
}

export function CommentsPane() {
  const { t } = useTranslation(["web"]);
  const threads = useWeb((state) => state.threads);
  const suggestions = useWeb((state) => state.suggestions);
  const files = useWeb((state) => state.files);
  const activeFileId = useWeb((state) => state.activeFileId);
  const role = useWeb((state) => state.role);
  const features = useWeb((state) => state.features);
  const draft = useWeb((state) => state.draft);
  const self = useWeb((state) => state.me?.accountId ?? null);
  const outbox = useWeb((state) => state.outbox);
  const [filter, setFilter] = useState<CommentFilter>("open");
  const canComment = abilitiesFor(role, features).comment;
  const created = useMemo(() => outbox.filter((item) => item.kind === "create"), [outbox]);
  const groups = useMemo(() => {
    const paths = new Map(files.map((file) => [file.fileId, file.path]));
    const ids = new Set([
      ...Object.keys(threads),
      ...Object.keys(suggestions),
      ...created.flatMap((item) => (item.fileId ? [item.fileId] : [])),
    ]);
    return [...ids]
      .map((fileId) => ({
        fileId,
        path: paths.get(fileId) ?? fileId,
        threads: threads[fileId] ?? NO_THREADS,
        suggestions: suggestions[fileId] ?? NO_SUGGESTIONS,
        queued: created.filter((item) => item.fileId === fileId),
      }))
      .filter(
        (group) =>
          paths.has(group.fileId) &&
          (group.threads.some((thread) => keepsThread(filter, thread.resolved !== null)) ||
            group.suggestions.length > 0 ||
            group.queued.length > 0),
      )
      .map((group) => ({ ...group, queued: group.queued.length > 0 ? group.queued : NO_OUTBOX }))
      .sort((a, b) =>
        a.fileId === activeFileId ? -1 : b.fileId === activeFileId ? 1 : a.path.localeCompare(b.path),
      );
  }, [threads, suggestions, files, activeFileId, created, filter]);
  const counts = useMemo(() => filterCounts(threads, suggestions), [threads, suggestions]);
  const arrivals = useMemo(() => arrivalsOf(threads, self), [threads, self]);
  const labels = {
    open: t(($) => $.web.comments.filterOpen),
    resolved: t(($) => $.web.comments.filterResolved),
    all: t(($) => $.web.comments.filterAll),
  };
  const viewer = role === "viewer" && features.comments;
  const projectId = useWeb((state) => state.projectId);
  const quiet = filter === "resolved" ? counts.all > 0 : filter === "open" && counts.resolved > 0;
  const emptyTitle = quiet
    ? filter === "open"
      ? t(($) => $.web.comments.allResolved)
      : t(($) => $.web.comments.noResolved)
    : t(($) => $.web.comments.emptyTitle);
  return (
    <WebCommentKit maxLength={COMMENT_LIMIT}>
      <div data-comments-pane className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center justify-end px-2 pt-1">
          <CommentFilterMenu
            value={filter}
            counts={counts}
            labels={labels}
            ariaLabel={(value) => t(($) => $.web.comments.filter, { value })}
            onChange={setFilter}
          />
        </div>
        <OfflineQueue />
        <DraftComposer />
        <CommentScrollArea
          items={arrivals}
          ready
          scope={projectId ?? ""}
          className="flex min-h-full flex-col space-y-3 px-1 py-3"
          label={(count) => t(($) => $.web.comments.newComments, { count })}
        >
          {groups.length === 0 && !draft ? (
            <CommentsEmpty
              className="flex-1 px-6 py-10"
              title={emptyTitle}
              description={
                quiet
                  ? undefined
                  : canComment
                    ? withKeys(t(($) => $.web.comments.emptyHint), <CommentKeys />)
                    : t(($) => $.web.comments.emptyReadOnly)
              }
            />
          ) : (
            groups.map((group) => <FileGroup key={group.fileId} {...group} filter={filter} />)
          )}
        </CommentScrollArea>
        {viewer ? <CommentsFootnote>{t(($) => $.web.comments.readOnlyNote)}</CommentsFootnote> : null}
      </div>
    </WebCommentKit>
  );
}

let counted: { threads: unknown; suggestions: unknown; open: number } | null = null;

export function openThreadCount(
  threads: Readonly<Record<string, readonly CollabCommentThread[]>>,
  suggestions: Readonly<Record<string, readonly CollabSuggestion[]>>,
): number {
  if (counted?.threads !== threads || counted.suggestions !== suggestions) {
    counted = { threads, suggestions, open: filterCounts(threads, suggestions).open };
  }
  return counted.open;
}
