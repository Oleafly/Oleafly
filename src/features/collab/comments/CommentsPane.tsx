import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckCheck, FileText, MessageSquare, MessageSquareDiff, Unlink } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { getEditorView } from "@oleafly/editor";
import { SidebarPanelHeader, SidebarSection } from "@/components/layout/SidebarSection";
import { badgeVariants } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip } from "@/components/ui/tooltip";
import { formatNumber } from "@/lib/intl";
import { basename } from "@/lib/path-utils";
import type { CollabCommentCount, CollabCommentThread, CollabSuggestion } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { collabErrorMessage } from "../errors";
import { LoadFailed } from "../feedback";
import { useCollabLiveStore } from "../live/live-store";
import { canEditProjectRole, canSuggestProjectRole } from "../roles";
import { FileSuggestionActions } from "../suggestions/FileSuggestionActions";
import { SuggestionCard, type SuggestionContext } from "../suggestions/SuggestionCard";
import {
  collapseSuggestionsFile,
  expandSuggestionsFile,
  pendingIn,
  reloadSuggestions,
  useSuggestions,
  type FileSuggestions,
  type SuggestionsState,
} from "../suggestions/suggestions-store";
import { CommentComposer } from "./CommentComposer";
import { CommentQuote } from "./CommentQuote";
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
  setShowResolved,
  useComments,
  type CommentsState,
  type FileThreads,
} from "./comments-store";
import { ThreadCard } from "./ThreadCard";

const TICK_MS = 60_000;
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

function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

type ReviewItem =
  | { kind: "thread"; at: number; thread: CollabCommentThread }
  | { kind: "suggestion"; at: number; suggestion: CollabSuggestion };

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
    ...suggestions.map((suggestion) => ({ kind: "suggestion" as const, at: suggestion.from, suggestion })),
    ...threads
      .filter((thread) => !linked.has(thread.id))
      .map((thread) => ({ kind: "thread" as const, at: thread.anchor.range?.from ?? Number.MAX_SAFE_INTEGER, thread })),
  ];
  return items.sort((left, right) => left.at - right.at);
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
  path,
}: Readonly<{
  label: string;
  items: readonly ReviewItem[];
  threads: readonly CollabCommentThread[];
  selectedId: string | null;
  suggestionId: string | null;
  focus: number;
  suggestionFocus: number;
  context: SuggestionContext;
  path?: string;
}>) {
  const byId = useMemo(() => new Map(threads.map((thread) => [thread.id, thread])), [threads]);
  return (
    <ul aria-label={label} className="space-y-1">
      {items.map((item) =>
        item.kind === "thread" ? (
          <ThreadCard
            key={item.thread.id}
            thread={item.thread}
            selected={item.thread.id === selectedId}
            focus={focus}
            context={context}
            path={path}
          />
        ) : (
          <SuggestionCard
            key={item.suggestion.id}
            suggestion={item.suggestion}
            thread={item.suggestion.threadId ? (byId.get(item.suggestion.threadId) ?? null) : null}
            selected={item.suggestion.id === suggestionId}
            focus={suggestionFocus}
            context={context}
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
  showResolved,
  focus,
  context,
}: Readonly<{
  tally: Tally;
  loaded: FileThreads | undefined;
  suggested: FileSuggestions | undefined;
  commentsOn: boolean;
  showResolved: boolean;
  focus: number;
  context: SuggestionContext;
}>) {
  const { t } = useTranslation(["collab"]);
  const title = basename(tally.path);
  const threads = loaded?.threads ?? [];
  const shown = useMemo(
    () => threads.filter((thread) => showResolved || thread.resolved === null),
    [threads, showResolved],
  );
  const suggestions = suggested?.suggestions ?? NO_SUGGESTIONS;
  const items = useMemo(() => reviewItems(shown, suggestions), [shown, suggestions]);
  const open = loaded !== undefined || suggested !== undefined;
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
    return (
      <>
        {context.canResolve ? <FileSuggestionActions path={tally.path} pending={suggestions.length} /> : null}
        <ReviewList
          label={title}
          items={items}
          threads={threads}
          selectedId={null}
          suggestionId={null}
          focus={focus}
          suggestionFocus={focus}
          context={context}
          path={tally.path}
        />
      </>
    );
  };
  const shownCount = showResolved ? tally.open + tally.resolved : tally.open;
  return (
    <SidebarSection
      id={`comments-file-${encodeURIComponent(tally.path)}`}
      title={title}
      titleHint={tally.path}
      icon={<FileText aria-hidden className="size-3.5" />}
      count={commentsOn ? shownCount : undefined}
      titleAdornment={<PendingBadge pending={tally.pending} />}
      open={open}
      onOpenChange={(next) => (next ? expand() : collapse())}
      contentClassName="px-2 py-1"
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
  | "showResolved"
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
    .map((count) => ({ path: count.path, open: 0, resolved: 0 }))
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
}

function EmptyPane({ hiddenResolved, canWrite }: Readonly<{ hiddenResolved: number; canWrite: boolean }>) {
  const { t } = useTranslation(["collab"]);
  let message = t(($) => $.collab.comments.empty);
  if (hiddenResolved > 0) message = t(($) => $.collab.comments.allResolved);
  else if (canWrite) message = t(($) => $.collab.comments.emptyCanWrite);
  return <p className="px-3 py-2 text-xs text-muted-foreground">{message}</p>;
}

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
  if (nothing) return <EmptyPane hiddenResolved={hiddenResolved} canWrite={context.canWrite} />;
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
          contentClassName="px-2 py-1"
        >
          {canResolve ? <FileSuggestionActions path={activePath} pending={activeSuggestions.length} /> : null}
          <ReviewList
            label={fileTitle}
            items={activeItems}
            threads={state.threads}
            selectedId={state.selectedId}
            suggestionId={review.hoveredId ?? review.selectedId}
            focus={state.focus}
            suggestionFocus={review.focus}
            context={context}
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
          contentClassName="space-y-1 px-2 py-1"
        >
          <p className="px-1 text-xs text-muted-foreground">{t(($) => $.collab.comments.detachedHint)}</p>
          <ul aria-label={detachedTitle} className="space-y-1">
            {detached.map((thread) => (
              <ThreadCard
                key={thread.id}
                thread={thread}
                selected={thread.id === state.selectedId}
                focus={state.focus}
                context={context}
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
          showResolved={state.showResolved}
          focus={state.focus}
          context={context}
        />
      ))}
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
      showResolved: store.showResolved,
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
      self: store.share?.account_id ?? null,
    })),
  );
  const now = useNow();
  const commentsOn = commentsShown(state.status);
  const canWrite = canWriteComments(state.status, live.role, live.liveState);
  const connected = live.liveState !== null && live.liveState !== "ended";
  const canResolve = connected && canEditProjectRole(live.role);
  const canSuggest = connected && canSuggestProjectRole(live.role);
  const members = useMemo(() => live.members.map(commentMember), [live.members]);
  const people = useMemo(
    () => new Map(live.members.map((member) => [member.person.account_id, member.person])),
    [live.members],
  );
  const context = useMemo<SuggestionContext>(
    () => ({ now, canWrite, self: live.self, people, members, canResolve, canSuggest, commentsOn }),
    [now, canWrite, live.self, people, members, canResolve, canSuggest, commentsOn],
  );
  const activePath = state.path ?? review.path;
  const activeSuggestions = review.path !== null && review.path === activePath ? review.suggestions : NO_SUGGESTIONS;
  const linked = useMemo(() => linkedThreads(activeSuggestions), [activeSuggestions]);
  const ordered = useMemo(() => byDocument(state.threads), [state.threads]);
  const shown = ordered.filter((thread) => (state.showResolved || thread.resolved === null) && !linked.has(thread.id));
  const gone = useMemo(() => new Set(state.emptied), [state.emptied]);
  const isDetached = (thread: CollabCommentThread) => thread.anchor.range === null || gone.has(thread.id);
  const anchored = shown.filter((thread) => !isDetached(thread));
  const detached = shown.filter(isDetached);
  const activeItems = useMemo(() => reviewItems(anchored, activeSuggestions), [anchored, activeSuggestions]);
  const tallies = useMemo(
    () => otherFileTallies(commentsOn, state, review, activePath),
    [commentsOn, state, review, activePath],
  );
  const others = tallies.filter(
    (tally) => tally.open + (state.showResolved ? tally.resolved : 0) + tally.pending > 0,
  );
  const resolvedElsewhere = tallies.reduce((total, tally) => total + tally.resolved, 0);
  const linkedHere = state.threads.filter((thread) => linked.has(thread.id)).length;
  const hiddenResolved = state.showResolved ? 0 : state.threads.length - linkedHere - shown.length + resolvedElsewhere;
  const filterLabel = state.showResolved
    ? t(($) => $.collab.comments.hideResolved)
    : t(($) => $.collab.comments.showResolved);
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

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="comments-pane" data-comments-pane>
      <SidebarPanelHeader icon={MessageSquare} title={t(($) => $.collab.comments.title)}>
        {commentsOn ? (
          <Tooltip label={filterLabel}>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={filterLabel}
              aria-pressed={state.showResolved}
              className={cn(
                "h-6 w-auto min-w-6 gap-1 px-1 text-muted-foreground hover:text-foreground",
                state.showResolved && "bg-primary/10 text-foreground",
              )}
              onClick={() => setShowResolved(!state.showResolved)}
            >
              <CheckCheck aria-hidden className="size-3.5" />
              {hiddenResolved > 0 ? (
                <span aria-hidden className="font-mono text-[0.625rem] tabular-nums">
                  {hiddenResolved}
                </span>
              ) : null}
            </Button>
          </Tooltip>
        ) : null}
      </SidebarPanelHeader>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {state.draft && canWrite ? (
          <section aria-label={newLabel} className="space-y-2 border-b border-sidebar-border px-3 py-2">
            <CommentQuote quote={state.draft.quote} />
            <CommentComposer
              key={`${state.draft.path}:${state.draft.from}:${state.draft.to}`}
              label={newLabel}
              placeholder={t(($) => $.collab.comments.newPlaceholder)}
              submitLabel={t(($) => $.collab.comments.post)}
              autoFocus
              members={members}
              self={live.self}
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
        />
      </div>
    </div>
  );
}
