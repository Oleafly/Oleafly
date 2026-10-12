import { memo, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { Check, CheckCircle2, MoreHorizontal, Pencil, RotateCcw, ShieldQuestion, Trash2 } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip } from "@/components/ui/tooltip";
import { formatDateTime, formatRelativeTimeFrom } from "@/lib/intl";
import type { CollabCommentMember, CollabCommentMessage, CollabCommentThread, CollabPerson } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { InlineAlert } from "../feedback";
import { peerHue } from "../live/peer-hue";
import { CommentComposer } from "./CommentComposer";
import {
  deleteMessage,
  deleteThread,
  editMessage,
  reopenThread,
  replyToThread,
  resolveThread,
  selectThread,
} from "./comments-store";
import { mentionSegments } from "./mentions";
import { commentFailure } from "./refusals";

export interface ThreadContext {
  now: number;
  canWrite: boolean;
  self: string | null;
  people: ReadonlyMap<string, CollabPerson>;
  members: readonly CollabCommentMember[];
}

function useFailure() {
  const [error, setError] = useState<string | null>(null);
  const run = (action: () => Promise<void>) => {
    setError(null);
    action().catch((failure: unknown) => setError(commentFailure(failure)));
  };
  return [error, run] as const;
}

function moveFocus(event: KeyboardEvent<HTMLButtonElement>) {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  const pane = event.currentTarget.closest("[data-comments-pane]");
  if (!pane) return;
  const jumps = [...pane.querySelectorAll<HTMLElement>("[data-thread-jump]")];
  const next = jumps[jumps.indexOf(event.currentTarget) + (event.key === "ArrowDown" ? 1 : -1)];
  if (!next) return;
  event.preventDefault();
  next.focus();
}

function MessageBody({
  message,
  members,
}: Readonly<{ message: CollabCommentMessage; members: readonly CollabCommentMember[] }>) {
  const segments = useMemo(
    () =>
      mentionSegments(
        message.body,
        members.filter((member) => message.mentions.includes(member.accountId)),
      ),
    [message.body, message.mentions, members],
  );
  let offset = 0;
  return (
    <p className="select-text whitespace-pre-wrap break-words text-xs">
      {segments.map((segment) => {
        const at = offset;
        offset += segment.text.length;
        return segment.mention ? (
          <span key={at} data-mention className="font-medium text-primary">
            {segment.text}
          </span>
        ) : (
          <span key={at}>{segment.text}</span>
        );
      })}
    </p>
  );
}

function MessageRow({
  thread,
  message,
  context,
}: Readonly<{ thread: CollabCommentThread; message: CollabCommentMessage; context: ThreadContext }>) {
  const { t } = useTranslation(["collab", "common"]);
  const [editing, setEditing] = useState(false);
  const [error, run] = useFailure();
  const person = message.verified ? context.people.get(message.author) : undefined;
  const name = message.verified
    ? person?.display_name || t(($) => $.collab.toolbar.unknownPerson)
    : t(($) => $.collab.comments.unverifiedAuthor);
  const own = message.verified && message.author === context.self;
  const actions = t(($) => $.collab.comments.messageActions);
  return (
    <li className="flex gap-2">
      <Avatar
        person={{ id: message.author, name, imageUrl: person?.avatar_url, hue: peerHue(message.author, context.self) }}
        size="sm"
        fallbackIcon={message.verified ? undefined : <ShieldQuestion />}
        className={cn("mt-0.5", !message.verified && "bg-muted text-muted-foreground")}
      />
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex min-w-0 items-center gap-1.5 text-xs">
          <span className={cn("truncate font-medium", !message.verified && "italic text-muted-foreground")}>
            {name}
          </span>
          <time
            dateTime={new Date(message.at).toISOString()}
            title={formatDateTime(message.at)}
            className="shrink-0 text-[0.6875rem] text-muted-foreground"
          >
            {formatRelativeTimeFrom(message.at, context.now)}
          </time>
          {message.editedAt !== null && !message.deleted ? (
            <span title={formatDateTime(message.editedAt)} className="shrink-0 text-[0.6875rem] text-muted-foreground">
              {t(($) => $.collab.comments.edited)}
            </span>
          ) : null}
          {own && context.canWrite && !message.deleted && !editing ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={actions}
                  className="ml-auto size-5 shrink-0 text-muted-foreground hover:text-foreground"
                >
                  <MoreHorizontal aria-hidden className="size-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" onCloseAutoFocus={(event) => event.preventDefault()}>
                <DropdownMenuItem onSelect={() => setEditing(true)}>
                  <Pencil aria-hidden className="size-4" />
                  {t(($) => $.common.actions.edit)}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => run(() => deleteMessage(thread, message.id))}>
                  <Trash2 aria-hidden className="size-4" />
                  {t(($) => $.common.actions.delete)}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
        {editing ? (
          <CommentComposer
            label={t(($) => $.collab.comments.editLabel)}
            submitLabel={t(($) => $.common.actions.save)}
            initial={message.body}
            autoFocus
            members={context.members}
            self={context.self}
            onSubmit={async (body) => {
              await editMessage(thread, message.id, body);
              setEditing(false);
            }}
            onCancel={() => setEditing(false)}
          />
        ) : message.deleted ? (
          <p className="text-xs italic text-muted-foreground">{t(($) => $.collab.comments.deleted)}</p>
        ) : (
          <MessageBody message={message} members={context.members} />
        )}
        {error ? <InlineAlert>{error}</InlineAlert> : null}
      </div>
    </li>
  );
}

function ThreadActions({ thread, self }: Readonly<{ thread: CollabCommentThread; self: string | null }>) {
  const { t } = useTranslation(["collab"]);
  const [error, run] = useFailure();
  const resolve = t(($) => $.collab.comments.resolve);
  const reopen = t(($) => $.collab.comments.reopen);
  const more = t(($) => $.collab.comments.threadActions);
  const deletable =
    thread.verified &&
    thread.createdBy === self &&
    thread.messages.every((message) => message.verified && message.author === self);
  return (
    <>
      <div className="flex shrink-0 items-center gap-0.5">
        {thread.resolved ? (
          <Tooltip label={reopen}>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={reopen}
              className="size-6 text-muted-foreground hover:text-foreground"
              onClick={() => run(() => reopenThread(thread))}
            >
              <RotateCcw aria-hidden className="size-3.5" />
            </Button>
          </Tooltip>
        ) : (
          <Tooltip label={resolve}>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={resolve}
              className="size-6 text-muted-foreground hover:text-foreground"
              onClick={() => run(() => resolveThread(thread))}
            >
              <Check aria-hidden className="size-3.5" />
            </Button>
          </Tooltip>
        )}
        {deletable ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={more}
                className="size-6 text-muted-foreground hover:text-foreground"
              >
                <MoreHorizontal aria-hidden className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => run(() => deleteThread(thread))}>
                <Trash2 aria-hidden className="size-4" />
                {t(($) => $.collab.comments.deleteThread)}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
      {error ? (
        <div className="basis-full">
          <InlineAlert>{error}</InlineAlert>
        </div>
      ) : null}
    </>
  );
}

export const ThreadCard = memo(function ThreadCard({
  thread,
  selected,
  focus,
  context,
}: Readonly<{ thread: CollabCommentThread; selected: boolean; focus: number; context: ThreadContext }>) {
  const { t } = useTranslation(["collab"]);
  const card = useRef<HTMLElement>(null);
  const seen = useRef(focus);
  const author = context.people.get(thread.createdBy)?.display_name || t(($) => $.collab.toolbar.unknownPerson);
  const label = thread.verified
    ? t(($) => $.collab.comments.thread, { name: author })
    : t(($) => $.collab.comments.unverifiedThread);
  const resolver = (() => {
    if (!thread.resolved) return null;
    if (!thread.resolved.verified) return t(($) => $.collab.comments.resolvedUnverified);
    const name = context.people.get(thread.resolved.by)?.display_name || t(($) => $.collab.toolbar.unknownPerson);
    return t(($) => $.collab.comments.resolvedBy, { name });
  })();

  useEffect(() => {
    if (selected && focus !== seen.current) card.current?.scrollIntoView?.({ block: "nearest" });
    seen.current = focus;
  }, [focus, selected]);

  return (
    <li>
      <article
        ref={card}
        aria-label={label}
        aria-current={selected ? "true" : undefined}
        className={cn(
          "space-y-2 rounded-md border px-2 py-2 transition-colors",
          selected ? "border-primary/30 bg-primary/5" : "border-transparent hover:bg-sidebar-accent/60",
          thread.resolved && "opacity-80",
        )}
      >
        <div className="flex flex-wrap items-start gap-1">
          <button
            type="button"
            data-thread-jump
            title={t(($) => $.collab.comments.showInEditor)}
            onClick={() => selectThread(thread.id, { reveal: true })}
            onKeyDown={moveFocus}
            className="min-w-0 flex-1 rounded-sm border-l-2 border-amber-500/70 py-0.5 pl-2 text-left text-xs italic text-muted-foreground transition-colors hover:text-foreground focus-visible:bg-sidebar-accent focus-visible:text-foreground"
          >
            <span className="line-clamp-3 break-words">{thread.anchor.quote}</span>
          </button>
          {context.canWrite ? <ThreadActions thread={thread} self={context.self} /> : null}
        </div>
        {resolver ? (
          <p className="flex items-center gap-1 text-[0.6875rem] text-muted-foreground">
            <CheckCircle2 aria-hidden className="size-3" />
            {resolver}
          </p>
        ) : null}
        <ol className="space-y-2">
          {thread.messages.map((message) => (
            <MessageRow key={message.id} thread={thread} message={message} context={context} />
          ))}
        </ol>
        {context.canWrite && !thread.resolved ? (
          <CommentComposer
            compact
            label={t(($) => $.collab.comments.replyLabel)}
            placeholder={t(($) => $.collab.comments.replyPlaceholder)}
            submitLabel={t(($) => $.collab.comments.reply)}
            members={context.members}
            self={context.self}
            onSubmit={(body) => replyToThread(thread, body)}
          />
        ) : null}
      </article>
    </li>
  );
});
