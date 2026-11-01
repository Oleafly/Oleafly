import type { CollabCommentMessage, CollabCommentThread } from "@oleafly/backend-port";
import { Check, CheckCircle2, MoreHorizontal, Pencil, Quote, RotateCcw, Trash2, Undo2, X } from "lucide-react";
import { type CSSProperties, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty";
import { Tooltip } from "@/components/ui/tooltip";
import { peerHue } from "@/features/collab/live/peer-hue";
import { cn } from "@/lib/utils";
import type { CollabSuggestion } from "../protocol";
import { abilitiesFor, canWithdraw } from "../roles";
import { useWeb } from "../store";
import { Composer } from "./Composer";
import { ConfirmDialog } from "./ConfirmDialog";
import { useActions } from "./context";
import { type ErrorKey, failureKey } from "./errors";
import { dateTime, isoTime, relativeTime, useNow } from "./format";
import { PersonAvatar, usePersonName } from "./people";

const COMMENT_LIMIT = 10_000;
const NO_THREADS: readonly CollabCommentThread[] = [];
const NO_SUGGESTIONS: readonly CollabSuggestion[] = [];

function useRun(): [ErrorKey | null, (action: () => Promise<void>) => void, boolean] {
  const [error, setError] = useState<ErrorKey | null>(null);
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const run = (action: () => Promise<void>) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError(null);
    action()
      .catch((failure: unknown) => setError(failureKey(failure)))
      .finally(() => {
        running.current = false;
        setBusy(false);
      });
  };
  return [error, run, busy];
}

function InlineError({ error }: Readonly<{ error: ErrorKey | null }>) {
  const { t } = useTranslation(["web"]);
  if (!error) return null;
  return (
    <p role="alert" className="text-[0.6875rem] text-destructive">
      {t(($) => $.web.errors[error])}
    </p>
  );
}

function Stamp({ at, now }: Readonly<{ at: number; now: number }>) {
  if (!at) return null;
  return (
    <Tooltip label={dateTime(at)} className="shrink-0">
      <time dateTime={isoTime(at)} className="text-[0.6875rem] text-muted-foreground">
        {relativeTime(at, now)}
      </time>
    </Tooltip>
  );
}

function QuoteBlock({ quote, onJump, title }: Readonly<{ quote: string; onJump?: () => void; title: string }>) {
  const text = <span className="line-clamp-3 block whitespace-pre-wrap break-words">{quote}</span>;
  return (
    <div className="flex min-w-0 flex-1 gap-1.5 rounded-md bg-amber-500/10 px-2 py-1.5 text-xs text-foreground/85 dark:bg-amber-400/10">
      <Quote aria-hidden className="mt-0.5 size-3 shrink-0 text-amber-600 dark:text-amber-400" />
      <div className="min-w-0 flex-1">
        {onJump ? (
          <button
            type="button"
            title={title}
            onClick={onJump}
            className="block w-full rounded-sm text-left transition-colors hover:text-foreground focus-visible:bg-amber-500/15"
          >
            {text}
          </button>
        ) : (
          text
        )}
      </div>
    </div>
  );
}

function MessageRow({
  thread,
  message,
  canWrite,
  now,
}: Readonly<{ thread: CollabCommentThread; message: CollabCommentMessage; canWrite: boolean; now: number }>) {
  const { t } = useTranslation(["web"]);
  const actions = useActions();
  const nameOf = usePersonName();
  const self = useWeb((state) => state.me?.accountId ?? null);
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, run] = useRun();
  const name = nameOf(message.author, message.verified);
  const own = message.verified && message.author === self;
  return (
    <li className="flex gap-2">
      <PersonAvatar accountId={message.author} name={name} verified={message.verified} className="mt-0.5" />
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex min-w-0 items-center gap-1.5 text-xs">
          <span className={cn("truncate font-medium", !message.verified && "italic text-muted-foreground")}>{name}</span>
          <Stamp at={message.at} now={now} />
          {message.editedAt !== null && !message.deleted ? (
            <span className="text-[0.6875rem] text-muted-foreground">{t(($) => $.web.comments.edited)}</span>
          ) : null}
          {own && canWrite && !message.deleted && !editing ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={t(($) => $.web.comments.messageActions)}
                  className="ml-auto size-5 shrink-0 text-muted-foreground hover:text-foreground"
                >
                  <MoreHorizontal aria-hidden className="size-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setEditing(true)}>
                  <Pencil aria-hidden className="size-4" />
                  {t(($) => $.web.comments.edit)}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setConfirming(true)}>
                  <Trash2 aria-hidden className="size-4" />
                  {t(($) => $.web.comments.delete)}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
        {editing ? (
          <Composer
            label={t(($) => $.web.comments.editLabel)}
            submitLabel={t(($) => $.web.comments.save)}
            initial={message.body}
            autoFocus
            maxLength={COMMENT_LIMIT}
            onSubmit={async (body) => {
              await actions.editComment(thread, message.id, body);
              setEditing(false);
            }}
            onCancel={() => setEditing(false)}
          />
        ) : message.deleted ? (
          <p className="text-xs italic text-muted-foreground">{t(($) => $.web.comments.deleted)}</p>
        ) : (
          <p className="select-text whitespace-pre-wrap break-words text-xs">{message.body}</p>
        )}
        <InlineError error={error} />
      </div>
      <ConfirmDialog
        open={confirming}
        title={t(($) => $.web.comments.deleteTitle)}
        description={t(($) => $.web.comments.deleteDescription)}
        confirmLabel={t(($) => $.web.comments.delete)}
        onConfirm={() => {
          setConfirming(false);
          run(() => actions.deleteComment(thread, message.id));
        }}
        onCancel={() => setConfirming(false)}
      />
    </li>
  );
}

export function ThreadCard({
  thread,
  canWrite,
  now,
  embedded = false,
}: Readonly<{ thread: CollabCommentThread; canWrite: boolean; now: number; embedded?: boolean }>) {
  const { t } = useTranslation(["web"]);
  const actions = useActions();
  const nameOf = usePersonName();
  const selected = useWeb((state) => state.selectedThreadId === thread.id);
  const [error, run] = useRun();
  const busy = useRef(false);
  const toggle = (action: () => Promise<void>) => {
    if (busy.current) return;
    busy.current = true;
    run(() =>
      action().finally(() => {
        busy.current = false;
      }),
    );
  };
  const author = nameOf(thread.createdBy, thread.verified);
  const resolver = thread.resolved ? nameOf(thread.resolved.by, thread.resolved.verified) : null;
  const content = (
    <article
      aria-label={t(($) => $.web.comments.thread, { name: author })}
      aria-current={selected ? "true" : undefined}
      className={cn(
        "space-y-2 rounded-md border px-2 py-2 transition-colors",
        selected ? "border-primary/30 bg-primary/5" : "border-transparent hover:bg-sidebar-accent/60",
        thread.resolved && "opacity-80",
        embedded && "px-0 hover:bg-transparent",
      )}
    >
      <div className="flex items-start gap-1">
        {embedded ? null : (
          <QuoteBlock
            quote={thread.anchor.quote}
            title={t(($) => $.web.comments.showInSource)}
            onJump={thread.anchor.range ? () => actions.revealThread(thread) : undefined}
          />
        )}
        {canWrite ? (
          <div className="ml-auto flex shrink-0 items-center gap-0.5">
            {thread.resolved ? (
              <Tooltip label={t(($) => $.web.comments.reopen)}>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={t(($) => $.web.comments.reopen)}
                  className="size-6 text-muted-foreground hover:text-foreground"
                  onClick={() => toggle(() => actions.reopenThread(thread))}
                >
                  <RotateCcw aria-hidden className="size-3.5" />
                </Button>
              </Tooltip>
            ) : (
              <Tooltip label={t(($) => $.web.comments.resolve)}>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={t(($) => $.web.comments.resolve)}
                  className="size-6 text-muted-foreground hover:text-foreground"
                  onClick={() => toggle(() => actions.resolveThread(thread))}
                >
                  <Check aria-hidden className="size-3.5" />
                </Button>
              </Tooltip>
            )}
          </div>
        ) : null}
      </div>
      {!thread.anchor.range && !embedded ? (
        <p className="text-[0.6875rem] text-muted-foreground">{t(($) => $.web.comments.anchorLost)}</p>
      ) : null}
      {resolver ? (
        <p className="flex items-center gap-1 text-[0.6875rem] text-muted-foreground">
          <CheckCircle2 aria-hidden className="size-3" />
          {t(($) => $.web.comments.resolvedBy, { name: resolver })}
        </p>
      ) : null}
      <ol className="space-y-2">
        {thread.messages.map((message) => (
          <MessageRow key={message.id} thread={thread} message={message} canWrite={canWrite} now={now} />
        ))}
      </ol>
      <InlineError error={error} />
      {canWrite && !thread.resolved ? (
        <Composer
          compact
          label={t(($) => $.web.comments.replyLabel)}
          placeholder={t(($) => $.web.comments.replyPlaceholder)}
          submitLabel={t(($) => $.web.comments.reply)}
          maxLength={COMMENT_LIMIT}
          onSubmit={(body) => actions.replyComment(thread, body)}
        />
      ) : null}
    </article>
  );
  return embedded ? content : <li>{content}</li>;
}

function SuggestionText({ suggestion, self }: Readonly<{ suggestion: CollabSuggestion; self: string | null }>) {
  const { t } = useTranslation(["web"]);
  const hue = peerHue(suggestion.author || "unknown", self);
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
  now,
}: Readonly<{ suggestion: CollabSuggestion; thread: CollabCommentThread | null; now: number }>) {
  const { t } = useTranslation(["web"]);
  const actions = useActions();
  const nameOf = usePersonName();
  const role = useWeb((state) => state.role);
  const features = useWeb((state) => state.features);
  const self = useWeb((state) => state.me?.accountId ?? null);
  const selected = useWeb((state) => state.selectedSuggestionId === suggestion.id);
  const abilities = abilitiesFor(role, features);
  const withdraw = !abilities.resolve && suggestion.verified && canWithdraw(role, suggestion.author, self);
  const [error, run, busy] = useRun();
  const name = nameOf(suggestion.author, suggestion.verified);
  return (
    <li>
      <article
        aria-label={t(($) => $.web.suggestions.card, { name })}
        aria-current={selected ? "true" : undefined}
        className={cn(
          "space-y-2 rounded-md border px-2 py-2 transition-colors",
          selected ? "border-primary/30 bg-primary/5" : "border-transparent hover:bg-sidebar-accent/60",
        )}
      >
        <div className="flex min-w-0 items-center gap-1.5 text-xs">
          <PersonAvatar accountId={suggestion.author} name={name} verified={suggestion.verified} />
          <span className={cn("truncate font-medium", !suggestion.verified && "italic text-muted-foreground")}>
            {name}
          </span>
          <Stamp at={suggestion.createdAt} now={now} />
          <Badge variant={suggestion.kind === "insert" ? "success" : "destructive"} size="sm" className="ml-auto">
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
        <InlineError error={error} />
        {thread ? <ThreadCard thread={thread} canWrite={abilities.comment} now={now} embedded /> : null}
      </article>
    </li>
  );
}

function FileGroup({
  fileId,
  path,
  threads,
  suggestions,
  now,
}: Readonly<{
  fileId: string;
  path: string;
  threads: readonly CollabCommentThread[];
  suggestions: readonly CollabSuggestion[];
  now: number;
}>) {
  const { t } = useTranslation(["web"]);
  const actions = useActions();
  const role = useWeb((state) => state.role);
  const features = useWeb((state) => state.features);
  const abilities = abilitiesFor(role, features);
  const [showResolved, setShowResolved] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, run, busy] = useRun();
  const linked = new Set(suggestions.map((suggestion) => suggestion.threadId).filter(Boolean));
  const byId = new Map(threads.map((thread) => [thread.id, thread]));
  const loose = threads.filter((thread) => !linked.has(thread.id));
  const open = loose.filter((thread) => !thread.resolved);
  const resolved = loose.filter((thread) => thread.resolved);
  const sortedSuggestions = [...suggestions].sort((a, b) => a.from - b.from || a.createdAt - b.createdAt);
  const sortedThreads = [...open, ...(showResolved ? resolved : [])].sort(
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
      <InlineError error={error} />
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
      <ul className="space-y-1">
        {sortedSuggestions.map((suggestion) => (
          <SuggestionCard
            key={suggestion.id}
            suggestion={suggestion}
            thread={suggestion.threadId ? (byId.get(suggestion.threadId) ?? null) : null}
            now={now}
          />
        ))}
        {sortedThreads.map((thread) => (
          <ThreadCard key={thread.id} thread={thread} canWrite={abilities.comment} now={now} />
        ))}
      </ul>
      {resolved.length > 0 ? (
        <Button
          type="button"
          size="xs"
          variant="link"
          className="px-2 text-muted-foreground"
          onClick={() => setShowResolved((value) => !value)}
        >
          {showResolved
            ? t(($) => $.web.comments.hideResolved)
            : t(($) => $.web.comments.resolvedCount, { count: resolved.length })}
        </Button>
      ) : null}
    </section>
  );
}

function DraftComposer() {
  const { t } = useTranslation(["web"]);
  const actions = useActions();
  const draft = useWeb((state) => state.draft);
  if (!draft) return null;
  return (
    <div className="space-y-2 border-b px-2 py-2">
      <p className="text-xs font-medium">{t(($) => $.web.comments.newComment)}</p>
      <QuoteBlock quote={draft.quote} title={t(($) => $.web.comments.showInSource)} />
      <Composer
        key={`${draft.fileId}:${draft.from}:${draft.to}`}
        label={t(($) => $.web.comments.newComment)}
        placeholder={t(($) => $.web.comments.placeholder)}
        submitLabel={t(($) => $.web.comments.submit)}
        autoFocus
        maxLength={COMMENT_LIMIT}
        onSubmit={(body) => actions.createComment(body)}
        onCancel={() => actions.cancelComment()}
      />
    </div>
  );
}

export function CommentsPane() {
  const { t } = useTranslation(["web"]);
  const now = useNow();
  const threads = useWeb((state) => state.threads);
  const suggestions = useWeb((state) => state.suggestions);
  const files = useWeb((state) => state.files);
  const activeFileId = useWeb((state) => state.activeFileId);
  const role = useWeb((state) => state.role);
  const features = useWeb((state) => state.features);
  const draft = useWeb((state) => state.draft);
  const canComment = abilitiesFor(role, features).comment;
  const groups = useMemo(() => {
    const paths = new Map(files.map((file) => [file.fileId, file.path]));
    const ids = new Set([...Object.keys(threads), ...Object.keys(suggestions)]);
    return [...ids]
      .map((fileId) => ({
        fileId,
        path: paths.get(fileId) ?? fileId,
        threads: threads[fileId] ?? NO_THREADS,
        suggestions: suggestions[fileId] ?? NO_SUGGESTIONS,
      }))
      .filter((group) => paths.has(group.fileId) && (group.threads.length > 0 || group.suggestions.length > 0))
      .sort((a, b) =>
        a.fileId === activeFileId ? -1 : b.fileId === activeFileId ? 1 : a.path.localeCompare(b.path),
      );
  }, [threads, suggestions, files, activeFileId]);
  return (
    <div data-comments-pane className="flex min-h-0 flex-1 flex-col">
      <DraftComposer />
      {groups.length === 0 && !draft ? (
        <EmptyState
          size="compact"
          className="flex-1 px-6 py-10"
          title={t(($) => $.web.comments.emptyTitle)}
          description={canComment ? t(($) => $.web.comments.emptyCanComment) : t(($) => $.web.comments.emptyReadOnly)}
        />
      ) : (
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-1 py-2">
          {groups.map((group) => (
            <FileGroup key={group.fileId} {...group} now={now} />
          ))}
        </div>
      )}
    </div>
  );
}
