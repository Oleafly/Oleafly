import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, CheckCheck, MessageSquare, Pencil, RotateCcw, Trash2 } from "lucide-react";
import { SidebarPanelHeader } from "@/components/layout/SidebarSection";
import { Button } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { CollabCommentMember } from "@/lib/tauri";
import { CommentComposer } from "@/features/collab/comments/CommentComposer";
import { CommentQuote } from "@/features/collab/comments/CommentQuote";
import type { PersonalComment } from "./model";
import {
  cancelPersonalDraft,
  changePersonalComment,
  createPersonalComment,
  flushNotes,
  loadNotes,
  selectPersonalComment,
  startPersonalComments,
  usePersonalComments,
} from "./store";

const MEMBERS: readonly CollabCommentMember[] = [];

export function PersonalCommentsKeeper() {
  useEffect(() => startPersonalComments(), []);
  return null;
}

function PersonalCommentCard({ path, note }: Readonly<{ path: string; note: PersonalComment }>) {
  const { t } = useTranslation(["collab", "common"]);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const selected = usePersonalComments((state) => state.selected === note.id);
  const card = useRef<HTMLElement>(null);
  useEffect(() => {
    if (selected) card.current?.scrollIntoView?.({ block: "nearest" });
  }, [selected]);
  const resolve = note.resolved ? t(($) => $.collab.comments.reopen) : t(($) => $.collab.comments.resolve);
  return (
    <li>
      <article
        ref={card}
        aria-current={selected || undefined}
        className={cn(
          "space-y-2 rounded-md border p-2",
          selected ? "border-primary/30 bg-primary/5" : "border-sidebar-border",
          note.resolved && "opacity-70",
        )}
      >
        <CommentQuote
          quote={note.quote}
          title={t(($) => $.collab.comments.showInEditor)}
          onJump={note.range ? () => selectPersonalComment(path, note.id) : undefined}
        />
        {!note.range ? (
          <p className="text-xs text-muted-foreground">{t(($) => $.collab.comments.detachedHint)}</p>
        ) : null}
        {editing ? (
          <CommentComposer
            label={t(($) => $.collab.comments.editLabel)}
            submitLabel={t(($) => $.common.actions.save)}
            initial={note.body}
            autoFocus
            members={MEMBERS}
            self={null}
            onSubmit={async (body) => {
              await changePersonalComment(note.id, { body });
              setEditing(false);
            }}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <p className="select-text whitespace-pre-wrap break-words text-xs">{note.body}</p>
        )}
        <div className="flex justify-end gap-1">
          <Tooltip label={resolve}>
            <Button
              variant="ghost"
              size="icon"
              aria-label={resolve}
              className="size-6"
              onClick={() => void changePersonalComment(note.id, { resolved: !note.resolved })}
            >
              {note.resolved ? (
                <RotateCcw aria-hidden className="size-3.5" />
              ) : (
                <Check aria-hidden className="size-3.5" />
              )}
            </Button>
          </Tooltip>
          <Tooltip label={t(($) => $.common.actions.edit)}>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t(($) => $.common.actions.edit)}
              className="size-6"
              onClick={() => setEditing(true)}
            >
              <Pencil aria-hidden className="size-3.5" />
            </Button>
          </Tooltip>
          <Tooltip label={t(($) => $.common.actions.delete)}>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t(($) => $.common.actions.delete)}
              className="size-6"
              onClick={() => setDeleting(true)}
            >
              <Trash2 aria-hidden className="size-3.5" />
            </Button>
          </Tooltip>
        </div>
      </article>
      <ConfirmationDialog
        open={deleting}
        title={t(($) => $.collab.comments.personalDeleteTitle)}
        description={t(($) => $.collab.comments.personalDeleteDescription)}
        confirmLabel={t(($) => $.common.actions.delete)}
        destructive
        onConfirm={() => {
          setDeleting(false);
          void changePersonalComment(note.id, null);
        }}
        onCancel={() => setDeleting(false)}
      />
    </li>
  );
}

export function PersonalCommentsPane() {
  const { t } = useTranslation(["collab", "common"]);
  const state = usePersonalComments();
  const shown = state.data.files.flatMap((file) =>
    file.notes
      .filter((note) => state.showResolved || !note.resolved)
      .map((note) => ({ path: file.path, note })),
  );
  const hidden = state.data.files.reduce(
    (count, file) => count + file.notes.filter((note) => note.resolved).length,
    0,
  );
  const filterLabel = state.showResolved
    ? t(($) => $.collab.comments.hideResolved)
    : t(($) => $.collab.comments.showResolved);
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="personal-comments-pane">
      <SidebarPanelHeader icon={MessageSquare} title={t(($) => $.collab.comments.title)}>
        <Tooltip label={filterLabel}>
          <Button
            variant="ghost"
            size="icon"
            aria-label={filterLabel}
            aria-pressed={state.showResolved}
            className="size-6"
            onClick={() => usePersonalComments.setState({ showResolved: !state.showResolved })}
          >
            <CheckCheck aria-hidden className="size-3.5" />
          </Button>
        </Tooltip>
      </SidebarPanelHeader>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        <p className="text-xs text-muted-foreground">{t(($) => $.collab.comments.personalHint)}</p>
        {state.phase === "loading" ? <Spinner /> : null}
        {state.phase === "failed" ? (
          <div role="alert" className="space-y-2 text-xs">
            <p>{t(($) => $.collab.comments.loadFailed)}</p>
            <Button variant="outline" size="sm" onClick={() => void loadNotes()}>
              {t(($) => $.common.actions.retry)}
            </Button>
          </div>
        ) : null}
        {state.saveError ? (
          <div role="alert" className="space-y-2 text-xs text-destructive">
            <p>
              {state.conflict
                ? t(($) => $.collab.comments.personalConflict)
                : t(($) => $.collab.comments.personalSaveFailed)}
            </p>
            <Button variant="outline" size="sm" onClick={() => void flushNotes().catch(() => undefined)}>
              {t(($) => $.common.actions.retry)}
            </Button>
          </div>
        ) : null}
        {state.draft ? (
          <section className="space-y-2" aria-label={t(($) => $.collab.comments.newLabel)}>
            <CommentQuote quote={state.draft.quote} />
            <CommentComposer
              key={`${state.draft.path}:${state.draft.from}:${state.draft.to}`}
              label={t(($) => $.collab.comments.newLabel)}
              placeholder={t(($) => $.collab.comments.personalPlaceholder)}
              submitLabel={t(($) => $.collab.comments.post)}
              autoFocus
              members={MEMBERS}
              self={null}
              onSubmit={createPersonalComment}
              onCancel={cancelPersonalDraft}
            />
          </section>
        ) : null}
        {state.phase === "ready" && shown.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {hidden ? t(($) => $.collab.comments.allResolved) : t(($) => $.collab.comments.personalEmpty)}
          </p>
        ) : null}
        <ul className="space-y-3" aria-label={t(($) => $.collab.comments.title)}>
          {shown.map(({ path, note }) => (
            <li key={note.id} className="space-y-1">
              <p className="truncate text-xs font-medium text-muted-foreground" title={path}>
                {path}
              </p>
              <ul>
                <PersonalCommentCard path={path} note={note} />
              </ul>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
