import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckCheck, MessageSquare, Unlink } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { getEditorView } from "@oleafly/editor";
import { SidebarPanelHeader, SidebarSection } from "@/components/layout/SidebarSection";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip } from "@/components/ui/tooltip";
import { basename } from "@/lib/path-utils";
import type { CollabCommentThread } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { collabErrorMessage } from "../errors";
import { LoadFailed } from "../feedback";
import { useCollabLiveStore } from "../live/live-store";
import { CommentComposer } from "./CommentComposer";
import {
  byDocument,
  canWriteComments,
  cancelDraft,
  commentMember,
  createThread,
  reloadThreads,
  setShowResolved,
  useComments,
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
}: Readonly<{
  label: string;
  threads: readonly CollabCommentThread[];
  selectedId: string | null;
  focus: number;
  context: ThreadContext;
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
        />
      ))}
    </ul>
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
  const [sections, setSections] = useState({ threads: true, detached: true });
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
  const anchored = shown.filter((thread) => thread.anchor.range !== null);
  const detached = shown.filter((thread) => thread.anchor.range === null);
  const hiddenResolved = state.showResolved ? 0 : state.threads.length - shown.length;
  const filterLabel = state.showResolved
    ? t(($) => $.collab.comments.hideResolved)
    : t(($) => $.collab.comments.showResolved);
  const newLabel = t(($) => $.collab.comments.newLabel);
  const detachedTitle = t(($) => $.collab.comments.detached);
  const fileTitle = state.path ? basename(state.path) : "";

  const body = () => {
    if (!state.path) {
      return <p className="px-3 py-2 text-xs text-muted-foreground">{t(($) => $.collab.comments.noFile)}</p>;
    }
    if (state.phase === "failed") {
      return (
        <div className="px-3 py-4">
          <LoadFailed
            message={t(($) => $.collab.comments.loadFailed)}
            reason={collabErrorMessage(state.error ?? "internal")}
            onRetry={reloadThreads}
          />
        </div>
      );
    }
    if (state.phase === "loading" && state.threads.length === 0) {
      return (
        <div className="flex justify-center py-6">
          <Spinner className="text-muted-foreground" />
        </div>
      );
    }
    return (
      <>
        <SidebarSection
          id="comments-threads"
          title={fileTitle}
          icon={<MessageSquare aria-hidden className="size-3.5" />}
          count={anchored.length}
          open={sections.threads}
          onOpenChange={(open) => setSections((value) => ({ ...value, threads: open }))}
          contentClassName="px-2 py-1"
        >
          {anchored.length > 0 ? (
            <ThreadList
              label={fileTitle}
              threads={anchored}
              selectedId={state.selectedId}
              focus={state.focus}
              context={context}
            />
          ) : shown.length === 0 ? (
            <p className="px-1 py-1 text-xs text-muted-foreground">
              {canWrite ? t(($) => $.collab.comments.emptyCanWrite) : t(($) => $.collab.comments.empty)}
            </p>
          ) : null}
        </SidebarSection>
        {detached.length > 0 ? (
          <SidebarSection
            id="comments-detached"
            title={detachedTitle}
            icon={<Unlink aria-hidden className="size-3.5" />}
            count={detached.length}
            open={sections.detached}
            onOpenChange={(open) => setSections((value) => ({ ...value, detached: open }))}
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
            <p className="line-clamp-3 break-words border-l-2 border-amber-500/70 pl-2 text-xs italic text-muted-foreground">
              {state.draft.quote}
            </p>
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
