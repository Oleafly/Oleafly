import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckCheck, FileText, MessageSquare, Unlink } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { getEditorView } from "@oleafly/editor";
import { SidebarPanelHeader, SidebarSection } from "@/components/layout/SidebarSection";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip } from "@/components/ui/tooltip";
import { basename } from "@/lib/path-utils";
import type { CollabCommentCount, CollabCommentThread } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { collabErrorMessage } from "../errors";
import { LoadFailed } from "../feedback";
import { useCollabLiveStore } from "../live/live-store";
import { CommentComposer } from "./CommentComposer";
import { CommentQuote } from "./CommentQuote";
import {
  byDocument,
  canWriteComments,
  cancelDraft,
  collapseFile,
  commentMember,
  createThread,
  expandFile,
  reloadThreads,
  setShowResolved,
  useComments,
  type FileThreads,
} from "./comments-store";
import { ThreadCard, type ThreadContext } from "./ThreadCard";

const TICK_MS = 60_000;

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

function ThreadList({
  label,
  threads,
  selectedId,
  focus,
  context,
  path,
}: Readonly<{
  label: string;
  threads: readonly CollabCommentThread[];
  selectedId: string | null;
  focus: number;
  context: ThreadContext;
  path?: string;
}>) {
  return (
    <ul aria-label={label} className="space-y-1">
      {threads.map((thread) => (
        <ThreadCard
          key={thread.id}
          thread={thread}
          selected={thread.id === selectedId}
          focus={focus}
          context={context}
          path={path}
        />
      ))}
    </ul>
  );
}

interface Tally {
  path: string;
  open: number;
  resolved: number;
}

function tallyOf(count: CollabCommentCount, loaded: FileThreads | undefined): Tally {
  if (loaded?.phase !== "ready") return count;
  const resolved = loaded.threads.filter((thread) => thread.resolved !== null).length;
  return { path: count.path, open: loaded.threads.length - resolved, resolved };
}

function FileSection({
  tally,
  loaded,
  showResolved,
  focus,
  context,
}: Readonly<{
  tally: Tally;
  loaded: FileThreads | undefined;
  showResolved: boolean;
  focus: number;
  context: ThreadContext;
}>) {
  const { t } = useTranslation(["collab"]);
  const title = basename(tally.path);
  const shown = useMemo(
    () => (loaded?.threads ?? []).filter((thread) => showResolved || thread.resolved === null),
    [loaded?.threads, showResolved],
  );
  const content = () => {
    if (!loaded) return null;
    if (loaded.phase === "failed") {
      return (
        <LoadFailed
          message={t(($) => $.collab.comments.loadFailed)}
          reason={collabErrorMessage(loaded.error ?? "internal")}
          onRetry={() => expandFile(tally.path)}
        />
      );
    }
    if (loaded.phase !== "ready" && loaded.threads.length === 0) {
      return (
        <div className="flex justify-center py-3">
          <Spinner className="text-muted-foreground" />
        </div>
      );
    }
    return <ThreadList label={title} threads={shown} selectedId={null} focus={focus} context={context} path={tally.path} />;
  };
  return (
    <SidebarSection
      id={`comments-file-${encodeURIComponent(tally.path)}`}
      title={title}
      titleHint={tally.path}
      icon={<FileText aria-hidden className="size-3.5" />}
      count={tally.open + (showResolved ? tally.resolved : 0)}
      open={loaded !== undefined}
      onOpenChange={(open) => (open ? expandFile(tally.path) : collapseFile(tally.path))}
      contentClassName="px-2 py-1"
    >
      {content()}
    </SidebarSection>
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
  const live = useCollabLiveStore(
    useShallow((store) => ({
      members: store.members,
      role: store.role,
      liveState: store.status?.state ?? null,
      self: store.share?.account_id ?? null,
    })),
  );
  const [foldedPath, setFoldedPath] = useState<string | null>(null);
  const [detachedOpen, setDetachedOpen] = useState(true);
  const now = useNow();
  const canWrite = canWriteComments(state.status, live.role, live.liveState);
  const members = useMemo(() => live.members.map(commentMember), [live.members]);
  const people = useMemo(
    () => new Map(live.members.map((member) => [member.person.account_id, member.person])),
    [live.members],
  );
  const context = useMemo<ThreadContext>(
    () => ({ now, canWrite, self: live.self, people, members }),
    [now, canWrite, live.self, people, members],
  );
  const ordered = useMemo(() => byDocument(state.threads), [state.threads]);
  const shown = ordered.filter((thread) => state.showResolved || thread.resolved === null);
  const gone = useMemo(() => new Set(state.emptied), [state.emptied]);
  const isDetached = (thread: CollabCommentThread) => thread.anchor.range === null || gone.has(thread.id);
  const anchored = shown.filter((thread) => !isDetached(thread));
  const detached = shown.filter(isDetached);
  const tallies = useMemo(
    () =>
      (state.counts ?? [])
        .filter((count) => count.path !== state.path)
        .map((count) => tallyOf(count, state.elsewhere[count.path])),
    [state.counts, state.path, state.elsewhere],
  );
  const others = tallies.filter((tally) => tally.open + (state.showResolved ? tally.resolved : 0) > 0);
  const resolvedElsewhere = tallies.reduce((total, tally) => total + tally.resolved, 0);
  const hiddenResolved = state.showResolved ? 0 : state.threads.length - shown.length + resolvedElsewhere;
  const filterLabel = state.showResolved
    ? t(($) => $.collab.comments.hideResolved)
    : t(($) => $.collab.comments.showResolved);
  const newLabel = t(($) => $.collab.comments.newLabel);
  const detachedTitle = t(($) => $.collab.comments.detached);
  const fileTitle = state.path ? basename(state.path) : "";
  const failed = state.path !== null && state.phase === "failed";
  const loading =
    state.counts === null || (state.path !== null && state.phase === "loading" && state.threads.length === 0);
  const nothing = !failed && anchored.length === 0 && detached.length === 0 && others.length === 0;

  const body = () => {
    if (nothing && loading) {
      return (
        <div className="flex justify-center py-6">
          <Spinner className="text-muted-foreground" />
        </div>
      );
    }
    if (nothing) {
      const message = (() => {
        if (hiddenResolved > 0) return t(($) => $.collab.comments.allResolved);
        return canWrite ? t(($) => $.collab.comments.emptyCanWrite) : t(($) => $.collab.comments.empty);
      })();
      return <p className="px-3 py-2 text-xs text-muted-foreground">{message}</p>;
    }
    return (
      <>
        {failed ? (
          <div className="px-3 py-4">
            <LoadFailed
              message={t(($) => $.collab.comments.loadFailed)}
              reason={collabErrorMessage(state.error ?? "internal")}
              onRetry={reloadThreads}
            />
          </div>
        ) : null}
        {state.path && anchored.length > 0 ? (
          <SidebarSection
            id="comments-threads"
            title={fileTitle}
            titleHint={state.path}
            icon={<FileText aria-hidden className="size-3.5" />}
            count={anchored.length}
            open={foldedPath !== state.path}
            onOpenChange={(open) => setFoldedPath(open ? null : state.path)}
            contentClassName="px-2 py-1"
          >
            <ThreadList
              label={fileTitle}
              threads={anchored}
              selectedId={state.selectedId}
              focus={state.focus}
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
            <ThreadList
              label={detachedTitle}
              threads={detached}
              selectedId={state.selectedId}
              focus={state.focus}
              context={context}
            />
          </SidebarSection>
        ) : null}
        {others.map((tally) => (
          <FileSection
            key={tally.path}
            tally={tally}
            loaded={state.elsewhere[tally.path]}
            showResolved={state.showResolved}
            focus={state.focus}
            context={context}
          />
        ))}
      </>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="comments-pane" data-comments-pane>
      <SidebarPanelHeader icon={MessageSquare} title={t(($) => $.collab.comments.title)}>
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
        {body()}
      </div>
    </div>
  );
}
