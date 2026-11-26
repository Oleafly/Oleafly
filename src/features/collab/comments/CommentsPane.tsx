import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckCheck, FileText, MessageSquareDiff, MessageSquareQuote, Unlink } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { getEditorDocumentPath, getEditorView } from "@oleafly/editor";
import { SidebarPanelHeader, SidebarSection } from "@/components/layout/SidebarSection";
import { Badge, badgeVariants } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { type CommentArrival, CommentScrollArea, threadArrivals } from "@/components/ui/comments/comment-arrivals";
import { CommentKeys, CommentsEmpty, CommentsFootnote, CommentsOfflineQueue, withKeys } from "@/components/ui/comments/comment-empty";
import { type CommentFilter, CommentFilterMenu, keepsThread } from "@/components/ui/comments/comment-filter";
import { CommentQuote, type CommentQuoteState } from "@/components/ui/comments/comment-quote";
import type { CommentEntry } from "@/components/ui/comments/comment-entry";
import { CommentThread } from "@/components/ui/comments/comment-thread";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { InlineAlert } from "@/components/ui/inline-alert";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip } from "@/components/ui/tooltip";
import { useNow } from "@/hooks/use-now";
import { formatNumber } from "@/lib/intl";
import { overleafProjectUrl } from "@/lib/overleaf-live";
import { basename } from "@/lib/path-utils";
import type { CollabCommentCount, CollabCommentNotSent, CollabCommentThread, CollabSuggestion } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { collabErrorMessage } from "../errors";
import { LoadFailed } from "../feedback";
import { liveSelfId, useCollabLiveStore } from "../live/live-store";
import { onRoster, peopleById } from "../people";
import { canCommentProjectRole, canEditProjectRole, canSuggestProjectRole } from "../roles";
import { FileSuggestionActions } from "../suggestions/FileSuggestionActions";
import { SuggestionCard, type SuggestionContext } from "../suggestions/SuggestionCard";
import {
  collapseSuggestionsFile,
  expandSuggestionsFile,
  groupIds,
  groupSuggestions,
  pendingIn,
  reloadSuggestions,
  useSuggestions,
  type FileSuggestions,
  type SuggestionGroup,
  type SuggestionsState,
} from "../suggestions/suggestions-store";
import { CommentComposer } from "@/components/ui/comments/comment-composer";
import { DesktopCommentKit, useCommentQuoteLabels, useMentionMembers } from "./desktop-comment-kit";
import { commentSpansIn } from "./editor-comments";
import {
  byDocument,
  canWriteComments,
  cancelDraft,
  collapseFile,
  commentMember,
  commentsShown,
  createThread,
  expandFile,
  reloadThreads,
  resolveThread,
  setCommentFilter,
  trackedChangesOnly,
  useComments,
  type CommentsState,
  type FileThreads,
  type RefusedComment,
} from "./comments-store";
import { commentFailure } from "./refusals";
import {
  notSentEntry,
  overleafThreadLinks,
  refusedEntry,
  serverThreadLinks,
  ThreadCard,
  useNotSentReason,
} from "./ThreadCard";

const TICK_MS = 60_000;
const COMMENT_LIMIT = 20_000;
const NO_SUGGESTIONS: readonly CollabSuggestion[] = [];

function backToText(): void {
  getEditorView()?.focus();
}

async function postThread(body: string): Promise<void> {
  await createThread(body);
  backToText();
}

function dropDraft(): void {
  cancelDraft();
  backToText();
}

function sameText(left: string, right: string): boolean {
  return left.replaceAll("\r\n", "\n") === right.replaceAll("\r\n", "\n");
}

function outdatedThreads(threads: readonly CollabCommentThread[], path: string | null): ReadonlySet<string> {
  const state = getEditorView()?.state;
  if (!state || path === null || getEditorDocumentPath() !== path) return new Set();
  const quotes = new Map(threads.map((thread) => [thread.id, thread.anchor.quote]));
  const changed = new Set<string>();
  for (const span of commentSpansIn(state)) {
    const quote = quotes.get(span.id);
    if (quote === undefined || span.from >= span.to) continue;
    if (!sameText(state.sliceDoc(span.from, span.to), quote)) changed.add(span.id);
  }
  return changed;
}

async function resolveEvery(threads: readonly CollabCommentThread[]): Promise<void> {
  for (const thread of threads) await resolveThread(thread);
}

type ReviewItem =
  | { kind: "thread"; at: number; thread: CollabCommentThread }
  | { kind: "suggestion"; at: number; group: SuggestionGroup };

function linkedThreads(suggestions: readonly CollabSuggestion[]): Set<string> {
  const linked = new Set<string>();
  for (const suggestion of suggestions) if (suggestion.threadId) linked.add(suggestion.threadId);
  return linked;
}

function reviewItems(
  threads: readonly CollabCommentThread[],
  suggestions: readonly CollabSuggestion[],
): ReviewItem[] {
  const linked = linkedThreads(suggestions);
  const items: ReviewItem[] = [
    ...groupSuggestions(suggestions).map((group) => ({ kind: "suggestion" as const, at: group.suggestion.from, group })),
    ...threads
      .filter((thread) => !linked.has(thread.id))
      .map((thread) => ({ kind: "thread" as const, at: thread.anchor.range?.from ?? Number.MAX_SAFE_INTEGER, thread })),
  ];
  return items.sort((left, right) => left.at - right.at);
}

function quoteStateOf(thread: CollabCommentThread, outdated: ReadonlySet<string> | undefined): CommentQuoteState {
  if (thread.anchor.range === null) return "detached";
  return outdated?.has(thread.id) ? "outdated" : "anchored";
}

function shownTally(tally: Tally, filter: CommentFilter): number {
  if (filter === "all") return tally.open + tally.resolved;
  return filter === "resolved" ? tally.resolved : tally.open;
}

const NO_ITEMS: readonly CommentArrival[] = [];

function pendingCount(threads: readonly CollabCommentThread[]): number {
  return threads.reduce(
    (total, thread) => total + thread.messages.filter((message) => message.pending && !message.deleted).length,
    0,
  );
}

function groupThread(
  group: SuggestionGroup,
  byId: ReadonlyMap<string, CollabCommentThread>,
): CollabCommentThread | null {
  const threadId = group.suggestion.threadId ?? group.replaced?.threadId ?? null;
  return threadId ? (byId.get(threadId) ?? null) : null;
}

function ReviewList({
  label,
  items,
  threads,
  selectedId,
  suggestionId,
  focus,
  suggestionFocus,
  context,
  canAccept,
  path,
  outdated,
}: Readonly<{
  label: string;
  items: readonly ReviewItem[];
  threads: readonly CollabCommentThread[];
  selectedId: string | null;
  suggestionId: string | null;
  focus: number;
  suggestionFocus: number;
  context: SuggestionContext;
  canAccept: boolean;
  path?: string;
  outdated?: ReadonlySet<string>;
}>) {
  const byId = useMemo(() => new Map(threads.map((thread) => [thread.id, thread])), [threads]);
  return (
    <ul aria-label={label} className="space-y-3">
      {items.map((item) =>
        item.kind === "thread" ? (
          <ThreadCard
            key={item.thread.id}
            thread={item.thread}
            selected={item.thread.id === selectedId}
            focus={focus}
            context={context}
            path={path}
            quoteState={quoteStateOf(item.thread, outdated)}
          />
        ) : (
          <SuggestionCard
            key={item.group.suggestion.id}
            suggestion={item.group.suggestion}
            replaced={item.group.replaced}
            thread={groupThread(item.group, byId)}
            selected={suggestionId !== null && groupIds(item.group).includes(suggestionId)}
            focus={suggestionFocus}
            context={context}
            canAccept={canAccept}
            path={path}
          />
        ),
      )}
    </ul>
  );
}

function PendingBadge({ pending }: Readonly<{ pending: number }>) {
  const { t } = useTranslation(["collab"]);
  if (pending === 0) return null;
  const label = t(($) => $.collab.suggestions.pendingCount, { number: formatNumber(pending) });
  return (
    <Tooltip label={label} className="inline-flex">
      <output
        aria-label={label}
        className={cn(
          badgeVariants({ variant: "primaryGhost", size: "sm" }),
          "gap-0.5 font-mono font-normal tabular-nums tracking-normal",
        )}
      >
        <MessageSquareDiff aria-hidden className="size-3" />
        {formatNumber(pending)}
      </output>
    </Tooltip>
  );
}

interface Tally {
  path: string;
  open: number;
  resolved: number;
  pending: number;
}

function tallyOf(
  count: CollabCommentCount,
  loaded: FileThreads | undefined,
  suggested: FileSuggestions | undefined,
  pending: number,
): Tally {
  const ready = suggested?.phase === "ready" ? suggested.suggestions.length : pending;
  if (loaded?.phase !== "ready") return { ...count, pending: ready };
  const linked = linkedThreads(suggested?.suggestions ?? NO_SUGGESTIONS);
  const threads = loaded.threads.filter((thread) => !linked.has(thread.id));
  const resolved = threads.filter((thread) => thread.resolved !== null).length;
  return { path: count.path, open: threads.length - resolved, resolved, pending: ready };
}

function FileSection({
  tally,
  loaded,
  suggested,
  commentsOn,
  filter,
  focus,
  context,
}: Readonly<{
  tally: Tally;
  loaded: FileThreads | undefined;
  suggested: FileSuggestions | undefined;
  commentsOn: boolean;
  filter: CommentFilter;
  focus: number;
  context: SuggestionContext;
}>) {
  const { t } = useTranslation(["collab"]);
  const title = basename(tally.path);
  const threads = loaded?.threads ?? [];
  const shown = useMemo(
    () => threads.filter((thread) => keepsThread(filter, thread.resolved !== null)),
    [threads, filter],
  );
  const suggestions = suggested?.suggestions ?? NO_SUGGESTIONS;
  const items = useMemo(() => reviewItems(shown, suggestions), [shown, suggestions]);
  const open = loaded !== undefined || suggested !== undefined;
  const loading = loaded?.phase === "loading" || suggested?.phase === "loading";
  const expand = () => {
    if (commentsOn) expandFile(tally.path);
    expandSuggestionsFile(tally.path);
  };
  const collapse = () => {
    collapseFile(tally.path);
    collapseSuggestionsFile(tally.path);
  };
  const content = () => {
    if (!open) return null;
    if (loaded?.phase === "failed") {
      return (
        <LoadFailed
          message={t(($) => $.collab.comments.loadFailed)}
          reason={collabErrorMessage(loaded.error ?? "internal")}
          onRetry={() => expandFile(tally.path)}
        />
      );
    }
    if (suggested?.phase === "failed") {
      return (
        <LoadFailed
          message={t(($) => $.collab.suggestions.loadFailed)}
          reason={collabErrorMessage(suggested.error ?? "internal")}
          onRetry={() => expandSuggestionsFile(tally.path)}
        />
      );
    }
    const waiting = (loaded !== undefined && loaded.phase !== "ready") || (suggested !== undefined && suggested.phase !== "ready");
    if (waiting && items.length === 0) {
      return (
        <div className="flex justify-center py-3">
          <Spinner className="text-muted-foreground" />
        </div>
      );
    }
    const canAccept = suggested?.canAccept ?? true;
    return (
      <>
        {context.canResolve ? (
          <FileSuggestionActions path={tally.path} pending={suggestions.length} canAccept={canAccept} />
        ) : null}
        <ReviewList
          label={title}
          items={items}
          threads={threads}
          selectedId={null}
          suggestionId={null}
          focus={focus}
          suggestionFocus={focus}
          context={context}
          canAccept={canAccept}
          path={tally.path}
        />
      </>
    );
  };
  const shownCount = shownTally(tally, filter);
  return (
    <SidebarSection
      id={`comments-file-${encodeURIComponent(tally.path)}`}
      title={title}
      titleHint={tally.path}
      icon={<FileText aria-hidden className="size-3.5" />}
      count={commentsOn ? shownCount : undefined}
      titleAdornment={<PendingBadge pending={tally.pending} />}
      open={open}
      ariaBusy={loading || undefined}
      onOpenChange={(next) => (next ? expand() : collapse())}
      contentClassName="px-3 py-3"
    >
      {content()}
    </SidebarSection>
  );
}

type PaneComments = Pick<
  CommentsState,
  | "status"
  | "path"
  | "threads"
  | "phase"
  | "error"
  | "selectedId"
  | "focus"
  | "filter"
  | "draft"
  | "emptied"
  | "counts"
  | "elsewhere"
>;

type PaneSuggestions = Pick<
  SuggestionsState,
  | "projectId"
  | "path"
  | "suggestions"
  | "canAccept"
  | "phase"
  | "error"
  | "counts"
  | "elsewhere"
  | "selectedId"
  | "hoveredId"
  | "focus"
>;

function phaseFailed(path: string | null, phase: string): boolean {
  return path !== null && phase === "failed";
}

function stillLoading(
  counts: readonly unknown[] | null,
  path: string | null,
  phase: string,
  loaded: number,
): boolean {
  return counts === null || (path !== null && phase === "loading" && loaded === 0);
}

function otherFileTallies(
  commentsOn: boolean,
  state: PaneComments,
  review: PaneSuggestions,
  activePath: string | null,
): Tally[] {
  const pendingCounts = review.counts ?? [];
  const commentCounts = commentsOn ? (state.counts ?? []) : [];
  const listed = new Set(commentCounts.map((count) => count.path));
  const extra = pendingCounts
    .filter((count) => count.pending > 0 && !listed.has(count.path))
    .map((count) => ({ path: count.path, open: 0, resolved: 0, waiting: 0 }))
    .sort((left, right) => left.path.localeCompare(right.path));
  return [...commentCounts, ...extra]
    .filter((count) => count.path !== activePath)
    .map((count) =>
      tallyOf(count, state.elsewhere[count.path], review.elsewhere[count.path], pendingIn(review, count.path)),
    );
}

interface PaneBodyProps {
  state: PaneComments;
  review: PaneSuggestions;
  context: SuggestionContext;
  nothing: boolean;
  loading: boolean;
  hiddenResolved: number;
  commentsFailed: boolean;
  suggestionsFailed: boolean;
  activePath: string | null;
  activeItems: readonly ReviewItem[];
  activeSuggestions: readonly CollabSuggestion[];
  anchoredCount: number;
  detached: readonly CollabCommentThread[];
  others: readonly Tally[];
  outdated: ReadonlySet<string>;
  notSent: readonly LostThread[];
  noResolved: boolean;
  changesOnly: boolean;
}

function EmptyPane({
  hiddenResolved,
  canWrite,
  noResolved,
  changesOnly,
}: Readonly<{ hiddenResolved: number; canWrite: boolean; noResolved: boolean; changesOnly: boolean }>) {
  const { t } = useTranslation(["collab"]);
  if (changesOnly) return <CommentsEmpty title={t(($) => $.collab.comments.noChanges)} />;
  if (noResolved) return <CommentsEmpty title={t(($) => $.collab.comments.noResolved)} />;
  if (hiddenResolved > 0) return <CommentsEmpty title={t(($) => $.collab.comments.allResolved)} />;
  return (
    <CommentsEmpty
      title={t(($) => $.collab.comments.emptyTitle)}
      description={canWrite ? withKeys(t(($) => $.collab.comments.emptyHint), <CommentKeys />) : undefined}
    />
  );
}

interface LostThread {
  key: string;
  quote: string;
  fresh: boolean;
  entries: CommentEntry[];
}

function lostThreads(
  batch: readonly CollabCommentNotSent[],
  refused: readonly RefusedComment[],
  known: ReadonlySet<string>,
  path: string | null,
  author: CommentEntry["author"],
  reason: string,
): LostThread[] {
  const here = (at: string | null | undefined) => path === null || at === path || at === null || at === undefined;
  const started = new Set(batch.filter((comment) => comment.newThread && here(comment.path)).map((comment) => comment.threadId));
  const groups = new Map<string, LostThread>();
  for (const comment of batch) {
    const lost = started.has(comment.threadId) || (path !== null && comment.path === path);
    if (known.has(comment.threadId) || !lost) continue;
    const group = groups.get(comment.threadId) ?? {
      key: comment.threadId,
      quote: comment.quote,
      fresh: started.has(comment.threadId),
      entries: [],
    };
    group.entries.push(notSentEntry(comment, author, reason));
    groups.set(comment.threadId, group);
  }
  const local = refused
    .filter((entry) => entry.threadId === "" && here(entry.path))
    .map((entry) => ({ key: entry.key, quote: entry.quote ?? "", fresh: true, entries: [refusedEntry(entry, author)] }));
  return [...groups.values(), ...local];
}

function NotSentThreads({ threads }: Readonly<{ threads: readonly LostThread[] }>) {
  const { t } = useTranslation(["collab"]);
  return threads.map((lost) => (
    <li key={lost.key}>
      <CommentThread
        thread={{
          id: lost.key,
          label: lost.fresh ? t(($) => $.collab.comments.newLabel) : t(($) => $.collab.comments.replyLabel),
          quote: lost.quote,
          quoteState: "pending",
          resolution: null,
          messages: lost.entries,
          deletable: false,
        }}
        actions={NO_THREAD_ACTIONS}
        canWrite={false}
      />
    </li>
  ));
}

const nothingToDo = () => Promise.resolve();
const NO_THREAD_ACTIONS = {
  reply: nothingToDo,
  resolve: nothingToDo,
  reopen: nothingToDo,
  removeThread: nothingToDo,
};

function PaneBody({
  state,
  review,
  context,
  nothing,
  loading,
  hiddenResolved,
  commentsFailed,
  suggestionsFailed,
  activePath,
  activeItems,
  activeSuggestions,
  anchoredCount,
  detached,
  others,
  outdated,
  notSent,
  noResolved,
  changesOnly,
}: Readonly<PaneBodyProps>) {
  const { t } = useTranslation(["collab"]);
  const [foldedPath, setFoldedPath] = useState<string | null>(null);
  const [detachedOpen, setDetachedOpen] = useState(true);
  const { commentsOn, canResolve } = context;
  const detachedTitle = t(($) => $.collab.comments.detached);
  const fileTitle = activePath ? basename(activePath) : "";
  if (nothing && loading) {
    return (
      <div className="flex justify-center py-6">
        <Spinner className="text-muted-foreground" />
      </div>
    );
  }
  if (nothing && notSent.length === 0) {
    return (
      <EmptyPane
        hiddenResolved={hiddenResolved}
        canWrite={context.canWrite}
        noResolved={noResolved}
        changesOnly={changesOnly}
      />
    );
  }
  return (
    <>
      {commentsFailed ? (
        <div className="px-3 py-4">
          <LoadFailed
            message={t(($) => $.collab.comments.loadFailed)}
            reason={collabErrorMessage(state.error ?? "internal")}
            onRetry={reloadThreads}
          />
        </div>
      ) : null}
      {suggestionsFailed ? (
        <div className="px-3 py-4">
          <LoadFailed
            message={t(($) => $.collab.suggestions.loadFailed)}
            reason={collabErrorMessage(review.error ?? "internal")}
            onRetry={reloadSuggestions}
          />
        </div>
      ) : null}
      {notSent.length > 0 ? (
        <ul aria-label={t(($) => $.collab.comments.notSent.list)} className="space-y-3 px-3 py-3">
          <NotSentThreads threads={notSent} />
        </ul>
      ) : null}
      {activePath !== null && activeItems.length > 0 ? (
        <SidebarSection
          id="comments-threads"
          title={fileTitle}
          titleHint={activePath}
          icon={<FileText aria-hidden className="size-3.5" />}
          count={commentsOn ? anchoredCount : undefined}
          titleAdornment={<PendingBadge pending={activeSuggestions.length} />}
          open={foldedPath !== activePath}
          onOpenChange={(open) => setFoldedPath(open ? null : activePath)}
          contentClassName="px-3 py-3"
        >
          {canResolve ? (
            <FileSuggestionActions path={activePath} pending={activeSuggestions.length} canAccept={review.canAccept} />
          ) : null}
          <ReviewList
            label={fileTitle}
            items={activeItems}
            threads={state.threads}
            selectedId={state.selectedId}
            suggestionId={review.hoveredId ?? review.selectedId}
            focus={state.focus}
            suggestionFocus={review.focus}
            context={context}
            canAccept={review.canAccept}
            outdated={outdated}
          />
        </SidebarSection>
      ) : null}
      {detached.length > 0 ? (
        <SidebarSection
          id="comments-detached"
          title={detachedTitle}
          icon={<Unlink aria-hidden className="size-3.5" />}
          count={detached.length}
          open={detachedOpen}
          onOpenChange={setDetachedOpen}
          contentClassName="space-y-2 px-3 py-3"
        >
          <p className="px-1 text-xs text-muted-foreground">{t(($) => $.collab.comments.detachedHint)}</p>
          <ul aria-label={detachedTitle} className="space-y-3">
            {detached.map((thread) => (
              <ThreadCard
                key={thread.id}
                thread={thread}
                selected={thread.id === state.selectedId}
                focus={state.focus}
                context={context}
                quoteState="detached"
              />
            ))}
          </ul>
        </SidebarSection>
      ) : null}
      {others.map((tally) => (
        <FileSection
          key={tally.path}
          tally={tally}
          loaded={state.elsewhere[tally.path]}
          suggested={review.elsewhere[tally.path]}
          commentsOn={commentsOn}
          filter={state.filter}
          focus={state.focus}
          context={context}
        />
      ))}
    </>
  );
}

function CommentsFilter({
  filter,
  counts,
}: Readonly<{ filter: CommentFilter; counts: Readonly<Record<CommentFilter, number>> }>) {
  const { t } = useTranslation(["collab"]);
  const labels = {
    open: t(($) => $.collab.comments.filterOpen),
    resolved: t(($) => $.collab.comments.filterResolved),
    all: t(($) => $.collab.comments.filterAll),
  };
  return (
    <CommentFilterMenu
      value={filter}
      counts={counts}
      labels={labels}
      format={formatNumber}
      ariaLabel={(value) => t(($) => $.collab.comments.filter, { value })}
      onChange={setCommentFilter}
    />
  );
}

function OfflineQueue({ count }: Readonly<{ count: number }>) {
  const { t } = useTranslation(["collab"]);
  if (count === 0) return null;
  const text =
    count === 1
      ? t(($) => $.collab.comments.offlineQueuedOne)
      : t(($) => $.collab.comments.offlineQueued, { number: formatNumber(count) });
  return <CommentsOfflineQueue>{text}</CommentsOfflineQueue>;
}

function ResolveAll({
  path,
  threads,
  onError,
}: Readonly<{ path: string; threads: readonly CollabCommentThread[]; onError: (message: string | null) => void }>) {
  const { t } = useTranslation(["collab"]);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const label = t(($) => $.collab.comments.resolveAll);
  const run = () => {
    setConfirming(false);
    setBusy(true);
    onError(null);
    resolveEvery(threads)
      .catch((error: unknown) => onError(commentFailure(error)))
      .finally(() => setBusy(false));
  };
  return (
    <>
      <Tooltip label={label}>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={label}
          disabled={busy || threads.length === 0}
          className="size-6 text-muted-foreground hover:text-foreground"
          onClick={() => setConfirming(true)}
        >
          {busy ? <Spinner size="xs" /> : <CheckCheck aria-hidden className="size-3.5" />}
        </Button>
      </Tooltip>
      <ConfirmationDialog
        open={confirming}
        title={t(($) => $.collab.comments.resolveAllConfirm.title, { file: basename(path) })}
        description={t(($) => $.collab.comments.resolveAllConfirm.description, { number: formatNumber(threads.length) })}
        confirmLabel={t(($) => $.collab.comments.resolveAllConfirm.confirm)}
        onConfirm={run}
        onCancel={() => setConfirming(false)}
      />
    </>
  );
}

export function CommentsPane() {
  const { t } = useTranslation(["collab"]);
  const state = useComments(
    useShallow((store) => ({
      status: store.status,
      path: store.path,
      threads: store.threads,
      phase: store.phase,
      error: store.error,
      selectedId: store.selectedId,
      focus: store.focus,
      filter: store.filter,
      draft: store.draft,
      emptied: store.emptied,
      counts: store.counts,
      elsewhere: store.elsewhere,
    })),
  );
  const review = useSuggestions(
    useShallow((store) => ({
      projectId: store.projectId,
      path: store.path,
      suggestions: store.suggestions,
      canAccept: store.canAccept,
      phase: store.phase,
      error: store.error,
      counts: store.counts,
      elsewhere: store.elsewhere,
      selectedId: store.selectedId,
      hoveredId: store.hoveredId,
      focus: store.focus,
    })),
  );
  const live = useCollabLiveStore(
    useShallow((store) => ({
      members: store.members,
      role: store.role,
      liveState: store.status?.state ?? null,
      self: liveSelfId(store),
      backend: store.backend,
      shareLink: store.share?.link ?? null,
      overleafLink:
        store.share === null && store.backend === "overleaf" && store.overleaf ? overleafProjectUrl(store.overleaf) : null,
      commentsNotSent: store.commentsNotSent,
    })),
  );
  const changesOnly = useCollabLiveStore((store) => trackedChangesOnly(state.status, store));
  const now = useNow(TICK_MS);
  const commentsOn = commentsShown(state.status);
  const canWrite = canWriteComments(state.status, live.role, live.liveState);
  const connected = live.liveState !== null && live.liveState !== "ended";
  const canResolve = connected && canEditProjectRole(live.role);
  const canSuggest = connected && canSuggestProjectRole(live.role);
  const members = useMemo(() => live.members.filter(onRoster).map(commentMember), [live.members]);
  const mentionMembers = useMentionMembers();
  const people = useMemo(() => peopleById(live.members), [live.members]);
  const links = useMemo(
    () => serverThreadLinks(live.shareLink) ?? overleafThreadLinks(live.overleafLink),
    [live.shareLink, live.overleafLink],
  );
  const suggestionThreads = state.status?.suggestionThreads === true;
  const context = useMemo<SuggestionContext>(
    () => ({
      now,
      canWrite,
      self: live.self,
      backend: live.backend,
      people,
      members,
      canResolve,
      canSuggest,
      commentsOn,
      suggestionThreads,
      links,
    }),
    [now, canWrite, live.self, live.backend, people, members, canResolve, canSuggest, commentsOn, suggestionThreads, links],
  );
  const activePath = state.path ?? review.path;
  const activeSuggestions = review.path !== null && review.path === activePath ? review.suggestions : NO_SUGGESTIONS;
  const linked = useMemo(() => linkedThreads(activeSuggestions), [activeSuggestions]);
  const ordered = useMemo(() => byDocument(state.threads), [state.threads]);
  const shown = useMemo(
    () => ordered.filter((thread) => keepsThread(state.filter, thread.resolved !== null) && !linked.has(thread.id)),
    [ordered, state.filter, linked],
  );
  const { anchored, detached } = useMemo(() => {
    const gone = new Set(state.emptied);
    const isDetached = (thread: CollabCommentThread) => thread.anchor.range === null || gone.has(thread.id);
    return { anchored: shown.filter((thread) => !isDetached(thread)), detached: shown.filter(isDetached) };
  }, [shown, state.emptied]);
  const activeItems = useMemo(() => reviewItems(anchored, activeSuggestions), [anchored, activeSuggestions]);
  const tallies = useMemo(
    () => otherFileTallies(commentsOn, state, review, activePath),
    [commentsOn, state, review, activePath],
  );
  const others = tallies.filter((tally) => shownTally(tally, state.filter) + tally.pending > 0);
  const resolvedElsewhere = tallies.reduce((total, tally) => total + tally.resolved, 0);
  const linkedHere = state.threads.filter((thread) => linked.has(thread.id)).length;
  const hiddenResolved =
    state.filter === "open" ? state.threads.length - linkedHere - shown.length + resolvedElsewhere : 0;
  const newLabel = t(($) => $.collab.comments.newLabel);
  const commentsFailed = commentsOn && phaseFailed(state.path, state.phase);
  const suggestionsFailed = phaseFailed(review.path, review.phase);
  const loading =
    (commentsOn && stillLoading(state.counts, state.path, state.phase, state.threads.length)) ||
    (review.projectId !== null && stillLoading(review.counts, review.path, review.phase, review.suggestions.length));
  const nothing =
    !commentsFailed &&
    !suggestionsFailed &&
    anchored.length === 0 &&
    detached.length === 0 &&
    others.length === 0 &&
    activeSuggestions.length === 0;
  const [bulkError, setBulkError] = useState<string | null>(null);
  const quoteLabels = useCommentQuoteLabels();
  const outdated = useMemo(() => outdatedThreads(state.threads, state.path), [state.threads, state.path]);
  const loose = ordered.filter((thread) => !linked.has(thread.id));
  const openHere = loose.filter((thread) => thread.resolved === null);
  const openElsewhere = tallies.reduce((total, tally) => total + tally.open, 0);
  const openCount = openHere.length + openElsewhere;
  const allCount = loose.length + openElsewhere + resolvedElsewhere;
  const filterCounts = { open: openCount, resolved: allCount - openCount, all: allCount };
  const shownCount = filterCounts[state.filter];
  const loadedThreads = useMemo(
    () => [
      ...state.threads,
      ...Object.values(state.elsewhere).flatMap((loaded) => (loaded.phase === "ready" ? loaded.threads : [])),
    ],
    [state.threads, state.elsewhere],
  );
  const arrivals = useMemo(
    () =>
      commentsOn
        ? [
            ...threadArrivals(state.threads, live.self),
            ...Object.entries(state.elsewhere).flatMap(([path, loaded]) =>
              loaded.phase === "ready" ? threadArrivals(loaded.threads, live.self, path) : [],
            ),
          ]
        : NO_ITEMS,
    [commentsOn, state.threads, state.elsewhere, live.self],
  );
  const refused = useComments((store) => store.refused);
  const reason = useNotSentReason();
  const notSent = useMemo(() => {
    const person = live.self ? people.get(live.self) : undefined;
    const author = {
      id: live.self ?? "",
      name: person?.display_name || t(($) => $.collab.toolbar.unknownPerson),
      imageUrl: person?.avatar_url,
      verified: true,
    };
    const known = new Set(loadedThreads.map((thread) => thread.id));
    return lostThreads(live.commentsNotSent ?? [], refused, known, state.path, author, reason);
  }, [live.commentsNotSent, live.self, people, refused, loadedThreads, state.path, reason, t]);
  const noResolved = state.filter === "resolved" && filterCounts.resolved === 0 && filterCounts.open > 0;
  const offline = live.liveState === "offline" || live.liveState === "connecting";
  const projectWaiting = (state.counts ?? []).reduce((total, count) => total + (count.waiting ?? 0), 0);
  const waiting = offline ? Math.max(projectWaiting, pendingCount(loadedThreads)) : 0;
  const moderate = connected && state.status?.moderate === true;

  return (
    <DesktopCommentKit
      now={now}
      self={live.self}
      members={mentionMembers}
      people={people}
      reactions={state.status?.reactions === true}
      typing={state.status?.typing === true}
      moderate={moderate}
      maxLength={COMMENT_LIMIT}
      markdown={live.backend !== "overleaf"}
    >
      <div className="flex h-full min-h-0 flex-col" data-testid="comments-pane" data-comments-pane>
        <SidebarPanelHeader
          icon={MessageSquareQuote}
          title={t(($) => $.collab.comments.title)}
          adornment={
            commentsOn ? (
              <Badge variant="muted" size="sm" className="tabular-nums">
                {formatNumber(shownCount)}
              </Badge>
            ) : null
          }
        >
          {commentsOn ? (
            <>
              <CommentsFilter filter={state.filter} counts={filterCounts} />
              {canWrite && state.path !== null ? (
                <ResolveAll path={state.path} threads={openHere} onError={setBulkError} />
              ) : null}
            </>
          ) : null}
        </SidebarPanelHeader>
        <OfflineQueue count={waiting} />
        <CommentScrollArea
          items={arrivals}
          scope={`${review.projectId ?? ""}:${state.path ?? ""}`}
          ready={state.phase === "ready" || state.phase === "idle"}
          label={(count) =>
            count === 1
              ? t(($) => $.collab.comments.newOne)
              : t(($) => $.collab.comments.newMany, { number: formatNumber(count) })
          }
        >
          {bulkError ? (
            <div className="px-3 pt-2">
              <InlineAlert>{bulkError}</InlineAlert>
            </div>
          ) : null}
          {state.draft && canWrite ? (
            <section aria-label={newLabel} className="space-y-2 border-b border-sidebar-border px-3 py-2">
              <CommentQuote quote={state.draft.quote} labels={quoteLabels} />
              <CommentComposer
                key={`${state.draft.path}:${state.draft.from}:${state.draft.to}`}
                label={newLabel}
                placeholder={t(($) => $.collab.comments.newPlaceholder)}
                submitLabel={t(($) => $.collab.comments.send)}
                autoFocus
                mentionButton
                onSubmit={postThread}
                onCancel={dropDraft}
              />
            </section>
          ) : null}
          <PaneBody
            state={state}
            review={review}
            context={context}
            nothing={nothing}
            loading={loading}
            hiddenResolved={hiddenResolved}
            commentsFailed={commentsFailed}
            suggestionsFailed={suggestionsFailed}
            activePath={activePath}
            activeItems={activeItems}
            activeSuggestions={activeSuggestions}
            anchoredCount={anchored.length}
            detached={detached}
            others={others}
            outdated={outdated}
            notSent={notSent}
            noResolved={noResolved}
            changesOnly={changesOnly}
          />
        </CommentScrollArea>
        {commentsOn && live.role !== null && !canCommentProjectRole(live.role) ? (
          <CommentsFootnote>{t(($) => $.collab.comments.readOnlyNote)}</CommentsFootnote>
        ) : null}
        {changesOnly ? <CommentsFootnote>{t(($) => $.collab.comments.overleafOff)}</CommentsFootnote> : null}
      </div>
    </DesktopCommentKit>
  );
}
