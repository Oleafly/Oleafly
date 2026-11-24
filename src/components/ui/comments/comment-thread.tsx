import { type KeyboardEvent, type ReactNode, type Ref, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Check, CheckCircle2, ChevronDown, ChevronUp, RotateCcw } from "lucide-react";
import { AvatarStack } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/inline-alert";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useFreshIds } from "./comment-arrivals";
import { CommentComposer } from "./comment-composer";
import type { CommentAuthor, CommentEntry, CommentMessageActions } from "./comment-entry";
import { CommentItem, HEADER_BUTTON, MENU_BUTTON, type ThreadMenu } from "./comment-item";
import { useCommentAction, useCommentKit } from "./comment-kit";
import { commentPlainText } from "./comment-markdown";
import { presenceText, TypingLine, useReplyingIn } from "./comment-presence";
import { CommentQuote, type CommentQuoteState } from "./comment-quote";

export interface CommentThreadModel {
  id: string;
  label: string;
  quote: string;
  quoteState: CommentQuoteState;
  resolution: string | null;
  messages: readonly CommentEntry[];
  deletable: boolean;
  link?: string;
}

export interface CommentThreadActions extends CommentMessageActions {
  reply: (body: string) => Promise<void>;
  resolve: () => Promise<void>;
  reopen: () => Promise<void>;
  removeThread: () => Promise<void>;
}

export function commentCardClass(selected: boolean): string {
  return cn(
    "rounded-lg border bg-background px-4 py-3.5 transition-colors",
    selected ? "border-ring" : "border-sidebar-border hover:border-foreground/25",
  );
}

function RepliesToggle({
  replies,
  expanded,
  controls,
  onToggle,
}: Readonly<{ replies: readonly CommentEntry[]; expanded: boolean; controls: string; onToggle: () => void }>) {
  const kit = useCommentKit();
  const last = replies.at(-1);
  const people = useMemo(() => {
    const seen = new Map<string, CommentAuthor>();
    for (const reply of replies) if (!seen.has(reply.author.id)) seen.set(reply.author.id, reply.author);
    return [...seen.values()].slice(0, 3).map((author) => ({
      id: author.id || "unknown",
      name: author.name,
      imageUrl: author.verified ? author.imageUrl : null,
      hue: kit.hue(author.id || "unknown"),
    }));
  }, [replies, kit]);
  const Icon = expanded ? ChevronUp : ChevronDown;
  return (
    <button
      type="button"
      aria-expanded={expanded}
      aria-controls={controls}
      onClick={onToggle}
      className="flex max-w-full items-center gap-1.5 rounded-md py-0.5 pr-1 text-[0.6875rem] font-medium text-foreground/80 transition-colors hover:text-foreground focus-visible:bg-accent"
    >
      <span className="shrink-0">{expanded ? kit.labels.hideReplies : kit.labels.replies(replies.length)}</span>
      <Icon aria-hidden className="size-3.5 shrink-0" />
      {!expanded ? (
        <>
          <AvatarStack people={people} max={3} size="xs" className="shrink-0" />
          {last ? (
            <span className="truncate font-normal text-muted-foreground">
              {kit.labels.lastReply(kit.relative(last.at, kit.now))}
            </span>
          ) : null}
        </>
      ) : null}
    </button>
  );
}

function ResolvedSummary({
  thread,
  expanded,
  onToggle,
  ref,
}: Readonly<{ thread: CommentThreadModel; expanded: boolean; onToggle: () => void; ref?: Ref<HTMLButtonElement> }>) {
  const { labels, markdown } = useCommentKit();
  const replies = thread.messages.length - 1;
  const first = thread.messages[0];
  const opening = first && !first.deleted ? first.body : null;
  const plain = useMemo(() => (opening === null ? null : commentPlainText(opening, { markdown })), [opening, markdown]);
  return (
    <button
      ref={ref}
      type="button"
      aria-expanded={expanded}
      onClick={onToggle}
      className="flex min-w-0 grow basis-34 items-start gap-2 rounded-md text-left transition-colors focus-visible:bg-accent"
    >
      <CheckCircle2 aria-hidden className="mt-0.5 size-3.5 shrink-0 text-success" />
      <span className="min-w-0 flex-1">
        <span className="block text-xs text-foreground/85 [overflow-wrap:anywhere]">
          <span className="font-medium text-foreground">{thread.resolution}</span>
          {replies > 0 ? ` · ${labels.replies(replies)}` : null}
        </span>
        {expanded ? null : (
          <span className="block truncate text-[0.6875rem] text-muted-foreground">
            <span className="text-comment-ink">{thread.quote}</span>
            {plain === null ? null : ` · ${plain}`}
          </span>
        )}
      </span>
    </button>
  );
}

function ResolveButton({
  busy,
  onChip,
  shown,
  onResolve,
}: Readonly<{ busy: boolean; onChip: boolean | null; shown: boolean; onResolve: () => void }>) {
  const { labels } = useCommentKit();
  const header = onChip === null;
  return (
    <Tooltip label={labels.resolve} className={cn("shrink-0", !header && "-my-0.5")}>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={labels.resolve}
        aria-disabled={busy || undefined}
        data-resolve-button
        className={cn(
          "rounded-md",
          header
            ? cn(MENU_BUTTON, HEADER_BUTTON)
            : cn(
                "size-5.5 opacity-0 transition-opacity group-hover/thread:opacity-100 group-has-[:focus-visible]/thread:opacity-100 [@media(hover:none)]:opacity-100",
                onChip
                  ? "text-comment-ink hover:bg-comment-active hover:text-comment-ink focus-visible:bg-comment-active"
                  : "text-muted-foreground hover:text-foreground focus-visible:bg-accent",
                shown && "opacity-100",
              ),
        )}
        onClick={onResolve}
      >
        <Check aria-hidden className="size-3.5" />
      </Button>
    </Tooltip>
  );
}

function ReplyingLine({ threadId }: Readonly<{ threadId: string }>) {
  const { labels } = useCommentKit();
  const people = useReplyingIn(threadId);
  if (people.length === 0) return null;
  return (
    <TypingLine
      people={people}
      label={presenceText(labels.replying, people.map((person) => person.name))}
      className="ml-3.5 pl-4"
    />
  );
}

function replyPrefill(entry: CommentEntry, self: string | null): string {
  if (!entry.author.verified || entry.author.id === self || entry.author.name.trim() === "") return "";
  return `@${entry.author.name.trim()} `;
}

export function CommentThread({
  thread,
  actions,
  canWrite,
  selected = false,
  embedded = false,
  quoteTitle,
  onJump,
  onJumpKeyDown,
  cardRef,
  children,
}: Readonly<{
  thread: CommentThreadModel;
  actions: CommentThreadActions;
  canWrite: boolean;
  selected?: boolean;
  embedded?: boolean;
  quoteTitle?: string;
  onJump?: () => void;
  onJumpKeyDown?: (event: KeyboardEvent<HTMLButtonElement>) => void;
  cardRef?: Ref<HTMLElement>;
  children?: ReactNode;
}>) {
  const kit = useCommentKit();
  const { labels } = kit;
  const [root, ...replies] = thread.messages;
  const resolved = thread.resolution !== null;
  const [openResolved, setOpenResolved] = useState(false);
  const [expanded, setExpanded] = useState(replies.length <= 1);
  const [replying, setReplying] = useState<{ key: number; prefill: string } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [copied, setCopied] = useState(false);
  const { error, busy, run } = useCommentAction(kit.describeError);
  const folded = resolved && !openResolved;
  const writable = canWrite && !resolved;
  const Confirm = kit.Confirm;
  const activity = kit.activity;
  const repliesId = useId();
  const summary = useRef<HTMLButtonElement>(null);
  const reopened = useRef<HTMLElement | null>(null);
  const handoff = useRef<"resolve" | "reopen" | null>(null);
  const settle = (to: "resolve" | "reopen", action: () => Promise<void>) => {
    const keep = document.activeElement !== document.body;
    run(() => {
      handoff.current = keep ? to : null;
      return action().catch((failure: unknown) => {
        handoff.current = null;
        throw failure;
      });
    });
  };
  const resolve = () => settle("resolve", actions.resolve);
  const resolveButton = (onChip: boolean) => (
    <ResolveButton busy={busy} onChip={onChip ? thread.quoteState === "anchored" : null} shown={selected} onResolve={resolve} />
  );

  useLayoutEffect(() => {
    if (handoff.current !== (resolved ? "resolve" : "reopen")) return;
    handoff.current = null;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    const card = reopened.current;
    if (resolved) summary.current?.focus();
    else (card?.querySelector<HTMLElement>('[aria-haspopup="menu"]') ?? card?.querySelector<HTMLElement>("button:not([data-resolve-button])"))?.focus();
  }, [resolved]);

  useEffect(() => {
    if (!selected) return;
    setExpanded(true);
    setOpenResolved(true);
  }, [selected]);

  const fresh = useFreshIds();
  const freshReplies = replies
    .filter((entry) => fresh.has(entry.id))
    .map((entry) => entry.id)
    .join(" ");
  const openedFor = useRef("");
  useEffect(() => {
    const before = new Set(openedFor.current.split(" "));
    openedFor.current = freshReplies;
    if (!freshReplies || freshReplies.split(" ").every((id) => before.has(id))) return;
    setExpanded(true);
    setOpenResolved(true);
  }, [freshReplies]);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2_000);
    return () => clearTimeout(timer);
  }, [copied]);

  const startReply = (entry: CommentEntry) => {
    setExpanded(true);
    setReplying((current) => ({ key: (current?.key ?? 0) + 1, prefill: replyPrefill(entry, kit.self) }));
  };
  const onReply = writable && replying === null ? startReply : undefined;
  const link = thread.link;
  const copyText = kit.copyText;
  const menu: ThreadMenu = {
    copyLink:
      link && copyText
        ? () => {
            run(() => copyText(link).then(() => setCopied(true)));
          }
        : undefined,
    resolve: writable ? resolve : undefined,
    removeThread: writable && thread.deletable && labels.deleteThread ? () => setConfirming(true) : undefined,
  };

  return (
    <article
      ref={cardRef}
      aria-label={thread.label}
      aria-current={selected ? "true" : undefined}
      data-comment-thread={thread.id}
      className={cn("group/thread space-y-3", !embedded && commentCardClass(selected))}
    >
      {resolved ? (
        <div className="flex flex-wrap items-start gap-1">
          <ResolvedSummary ref={summary} thread={thread} expanded={openResolved} onToggle={() => setOpenResolved((value) => !value)} />
          {canWrite ? (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              disabled={busy}
              className="ms-auto shrink-0 text-foreground"
              onClick={() => {
                reopened.current = summary.current?.closest("article") ?? null;
                settle("reopen", actions.reopen);
              }}
            >
              <RotateCcw aria-hidden />
              {labels.reopen}
            </Button>
          ) : null}
        </div>
      ) : null}
      {folded ? null : (
        <>
          {embedded ? null : (
            <CommentQuote
              quote={thread.quote}
              labels={labels}
              state={thread.quoteState}
              active={selected}
              title={quoteTitle}
              onJump={onJump}
              onJumpKeyDown={onJumpKeyDown}
              action={writable ? resolveButton(true) : undefined}
            />
          )}
          {children}
          {root ? (
            <ol className="space-y-4">
              <CommentItem
                entry={root}
                root
                canWrite={writable}
                canReact={writable}
                actions={actions}
                onReply={onReply}
                thread={menu}
                headerAction={embedded && writable ? resolveButton(false) : undefined}
              />
            </ol>
          ) : null}
          {replies.length > 0 && expanded ? (
            <ol id={repliesId} aria-label={labels.replies(replies.length)} className="ml-3.5 space-y-4 border-l border-sidebar-border pl-4">
              {replies.map((entry) => (
                <CommentItem
                  key={entry.id}
                  entry={entry}
                  canWrite={writable}
                  canReact={writable}
                  actions={actions}
                  onReply={onReply}
                />
              ))}
            </ol>
          ) : null}
          {replies.length > 1 || (replies.length > 0 && !expanded) ? (
            <div className={cn(expanded && "ml-3.5 pl-4")}>
              <RepliesToggle replies={replies} expanded={expanded} controls={repliesId} onToggle={() => setExpanded((value) => !value)} />
            </div>
          ) : null}
          <ReplyingLine threadId={thread.id} />
          {writable && replying ? (
            <div className="ml-3.5 pl-4">
              <CommentComposer
                key={replying.key}
                compact
                label={labels.replyLabel}
                placeholder={labels.replyPlaceholder}
                submitLabel={labels.send}
                initial={replying.prefill}
                autoFocus
                onSubmit={async (body) => {
                  await actions.reply(body);
                  setReplying(null);
                }}
                onCancel={() => setReplying(null)}
                onActivity={activity ? (active) => activity({ kind: "reply", threadId: thread.id }, active) : undefined}
              />
            </div>
          ) : null}
        </>
      )}
      {copied && labels.copied ? (
        <p role="status" className="text-[0.6875rem] text-muted-foreground">
          {labels.copied}
        </p>
      ) : null}
      {error ? <InlineAlert>{error}</InlineAlert> : null}
      {labels.deleteThread && labels.deleteThreadConfirm ? (
        <Confirm
          open={confirming}
          title={labels.deleteThreadConfirm.title}
          description={labels.deleteThreadConfirm.description}
          confirmLabel={labels.deleteThread}
          onConfirm={() => {
            setConfirming(false);
            run(actions.removeThread);
          }}
          onCancel={() => setConfirming(false)}
        />
      ) : null}
    </article>
  );
}
