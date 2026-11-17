import { Fragment, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type Ref } from "react";
import {
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Link2,
  MoreHorizontal,
  Pencil,
  RotateCcw,
  ShieldQuestion,
  Trash2,
} from "lucide-react";
import { Avatar, AvatarStack } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { InlineAlert } from "@/components/ui/inline-alert";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useArrival, useFreshIds } from "./comment-arrivals";
import { CommentBody } from "./comment-body";
import { CommentComposer } from "./comment-composer";
import { isoTime, useCommentAction, useCommentKit, type CommentKit } from "./comment-kit";
import { commentPlainText } from "./comment-markdown";
import { presenceText, TypingLine } from "./comment-presence";
import { CommentQuote, type CommentQuoteState } from "./comment-quote";
import {
  type CommentReaction,
  ReactionAdd,
  ReactionBar,
  ReactionError,
  ReactionPills,
  useReactions,
} from "./comment-reactions";

export interface CommentAuthor {
  id: string;
  name: string;
  imageUrl?: string | null;
  verified: boolean;
}

export type CommentDelivery =
  | { state: "waiting" }
  | { state: "failed"; reason: string; retry?: () => void; discard: () => void };

export interface CommentEntry {
  id: string;
  author: CommentAuthor;
  at: number;
  editedAt: number | null;
  deleted: boolean;
  removed?: boolean;
  body: string;
  mentions: readonly string[];
  reactions?: readonly CommentReaction[];
  delivery?: CommentDelivery;
}

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

export interface CommentMessageActions {
  edit?: (messageId: string, body: string) => Promise<void>;
  remove?: (messageId: string) => Promise<void>;
  moderate?: (messageId: string) => Promise<void>;
  react?: (messageId: string, emoji: string, on: boolean) => Promise<void>;
}

export interface CommentThreadActions extends CommentMessageActions {
  reply: (body: string) => Promise<void>;
  resolve: () => Promise<void>;
  reopen: () => Promise<void>;
  removeThread: () => Promise<void>;
}

interface ThreadMenu {
  copyLink?: () => void;
  resolve?: () => void;
  removeThread?: () => void;
}

const MENU_BUTTON = "shrink-0 text-muted-foreground hover:text-foreground";
const HEADER_ACTIONS =
  "absolute inset-y-0 end-0 my-auto flex h-6 items-center rounded-md has-[button]:bg-accent opacity-0 transition-opacity group-hover/item:opacity-100 focus-within:opacity-100 has-[[data-state=open]]:opacity-100 [@media(hover:none)]:opacity-100";
const HEADER_BUTTON = "size-6 hover:bg-foreground/10 focus-visible:bg-foreground/10 data-[state=open]:bg-foreground/10";
const DESTRUCTIVE_ITEM = "text-destructive focus:text-destructive [&_svg]:text-destructive";
const META = "text-[0.6875rem] text-foreground/60";
const BUBBLE =
  "min-w-0 w-fit max-w-full rounded-2xl border border-sidebar-border bg-background px-3.5 py-2.5 [overflow-wrap:anywhere]";
const BUBBLE_ACTIONS =
  "flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/item:opacity-100 focus-within:opacity-100 has-[[aria-expanded=true]]:opacity-100 pointer-coarse:opacity-100";
const GROUP_GAP_MS = 5 * 60_000;

export interface GroupedMessage {
  author: string;
  verified: boolean;
  at: number;
  deleted: boolean;
}

export function chatGroups(messages: readonly GroupedMessage[]): boolean[] {
  let start: GroupedMessage | null = null;
  return messages.map((next, index) => {
    const previous = messages[index - 1];
    const joins =
      start !== null &&
      !previous.deleted &&
      !next.deleted &&
      next.verified &&
      previous.author === next.author &&
      Math.abs(next.at - start.at) < GROUP_GAP_MS;
    if (!joins) start = next.verified && !next.deleted ? next : null;
    return joins;
  });
}

export function commentCardClass(selected: boolean): string {
  return cn(
    "rounded-lg border bg-background px-4 py-3.5 transition-colors",
    selected ? "border-ring" : "border-sidebar-border hover:border-foreground/25",
  );
}

function DeletedAvatar({ size }: Readonly<{ size: "sm" | "base" }>) {
  return (
    <span
      aria-hidden
      className={cn(
        "mt-px flex shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground",
        size === "base" ? "size-7" : "size-5",
      )}
    >
      <Trash2 className={size === "base" ? "size-3.5" : "size-2.5"} />
    </span>
  );
}

function AuthorAvatar({ author, size, kit }: Readonly<{ author: CommentAuthor; size: "sm" | "base"; kit: CommentKit }>) {
  return (
    <Avatar
      person={{
        id: author.id || "unknown",
        name: author.name,
        imageUrl: author.verified ? author.imageUrl : null,
        hue: kit.hue(author.id || "unknown"),
      }}
      size={size}
      fallbackIcon={author.verified ? undefined : <ShieldQuestion />}
      className={cn("mt-px", !author.verified && "bg-muted text-muted-foreground")}
    />
  );
}

interface MenuEntries {
  top: { key: string; icon: typeof Pencil; label: string; run: () => void }[];
  bottom: { key: string; label: string; run: () => void }[];
}

function menuEntries(
  labels: CommentKit["labels"],
  {
    onEdit,
    onDelete,
    onRemove,
    thread,
  }: Readonly<{ onEdit?: () => void; onDelete?: () => void; onRemove?: () => void; thread?: ThreadMenu }>,
): MenuEntries | null {
  const top = [
    onEdit ? { key: "edit", icon: Pencil, label: labels.edit, run: onEdit } : null,
    thread?.copyLink && labels.copyLink ? { key: "link", icon: Link2, label: labels.copyLink, run: thread.copyLink } : null,
    thread?.resolve ? { key: "resolve", icon: Check, label: labels.resolve, run: thread.resolve } : null,
  ].filter((item) => item !== null);
  const bottom = [
    onDelete ? { key: "delete", label: labels.delete, run: onDelete } : null,
    onRemove && labels.remove ? { key: "remove", label: labels.remove, run: onRemove } : null,
    thread?.removeThread && labels.deleteThread
      ? { key: "thread", label: labels.deleteThread, run: thread.removeThread }
      : null,
  ].filter((item) => item !== null);
  return top.length === 0 && bottom.length === 0 ? null : { top, bottom };
}

function MessageMenu({ entries: { top, bottom }, className = "size-6" }: Readonly<{ entries: MenuEntries; className?: string }>) {
  const { labels } = useCommentKit();
  const picked = useRef<{ keep: boolean; run?: () => void } | null>(null);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="icon" aria-label={labels.messageActions} className={cn(MENU_BUTTON, className)}>
          <MoreHorizontal aria-hidden className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="min-w-44"
        onCloseAutoFocus={(event) => {
          const next = picked.current;
          picked.current = null;
          if (next?.keep) event.preventDefault();
          next?.run?.();
        }}
      >
        {top.map(({ key, icon: Icon, label, run }) => (
          <DropdownMenuItem
            key={key}
            onSelect={() => {
              if (key === "edit") picked.current = { keep: true };
              run();
            }}
          >
            <Icon aria-hidden className="size-4" />
            {label}
          </DropdownMenuItem>
        ))}
        {top.length > 0 && bottom.length > 0 ? <DropdownMenuSeparator /> : null}
        {bottom.map(({ key, label, run }) => (
          <DropdownMenuItem
            key={key}
            onSelect={() => {
              picked.current = { keep: false, run };
            }}
            className={DESTRUCTIVE_ITEM}
          >
            <Trash2 aria-hidden className="size-4" />
            {label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function DeliveryNote({
  entry,
  delivery,
  end = false,
}: Readonly<{ entry: CommentEntry; delivery: CommentDelivery; end?: boolean }>) {
  const kit = useCommentKit();
  const { labels } = kit;
  if (delivery.state === "waiting") {
    return (
      <span className={cn("flex items-center gap-1", META, end ? "mt-1" : "mt-1.5")}>
        <Clock aria-hidden className="size-3" />
        {labels.waiting}
      </span>
    );
  }
  const copyText = kit.copyText;
  return (
    <div className={cn("space-y-1", end ? "mt-1.5 text-right" : "mt-2.5")}>
      <p className="text-[0.75rem] text-destructive">
        <span className="font-medium">{labels.notSent}</span> {delivery.reason}
      </p>
      <div className={cn("flex flex-wrap items-center gap-1", end && "justify-end")}>
        {delivery.retry ? (
          <Button type="button" variant="ghost" size="xs" className="h-6 px-1.5" onClick={delivery.retry}>
            {labels.retry}
          </Button>
        ) : null}
        {copyText ? (
          <Button type="button" variant="ghost" size="xs" className="h-6 px-1.5" onClick={() => void copyText(entry.body)}>
            {labels.copyText}
          </Button>
        ) : null}
        <Button type="button" variant="ghost" size="xs" className="h-6 px-1.5" onClick={delivery.discard}>
          {labels.discard}
        </Button>
      </div>
    </div>
  );
}

function withActions(node: ReactNode, actions: ReactNode, wide: boolean): ReactNode {
  if (!actions) return node;
  return (
    <span className="flex min-w-0 max-w-full grow items-center">
      {node}
      <span className={cn("relative ms-1 grow self-stretch [@media(hover:none)]:min-h-6", wide ? "min-w-12" : "min-w-6")}>
        <span className={HEADER_ACTIONS}>{actions}</span>
      </span>
    </span>
  );
}

export function CommentByline({
  name,
  nameClassName,
  at,
  editedAt = null,
  className,
  actions,
  wide = false,
  children,
}: Readonly<{
  name?: string;
  nameClassName?: string;
  at: number;
  editedAt?: number | null;
  className?: string;
  actions?: ReactNode;
  wide?: boolean;
  children?: ReactNode;
}>) {
  const kit = useCommentKit();
  const badged = children !== undefined && children !== null && children !== false;
  const alone = !at && editedAt === null && !badged && Boolean(actions);
  const items = [
    name === undefined ? null : (
      <span key="name" className={cn("max-w-full truncate", alone ? "min-w-0" : "shrink-0", nameClassName)}>
        {name}
      </span>
    ),
    at ? (
      <Tooltip key="time" label={kit.exact(at)} className="min-w-0 max-w-full">
        <time dateTime={isoTime(at)} className={cn("min-w-0", META, "leading-4")}>
          {kit.relative(at, kit.now)}
        </time>
      </Tooltip>
    ) : null,
    editedAt === null ? null : (
      <Tooltip key="edited" label={kit.exact(editedAt)} className="min-w-0">
        <span className={cn(META, "leading-4")}>{`· ${kit.labels.edited}`}</span>
      </Tooltip>
    ),
    badged ? <Fragment key="badge">{children}</Fragment> : null,
  ].filter((item) => item !== null);
  const last = items.pop();
  return (
    <span className={cn("flex min-w-0 flex-wrap items-baseline gap-x-1.5", className)}>
      {items}
      {withActions(last, actions, wide)}
    </span>
  );
}

function MessageHeader({
  entry,
  fresh,
  menu,
  wide,
}: Readonly<{ entry: CommentEntry; fresh: boolean; menu: ReactNode; wide: boolean }>) {
  const { labels } = useCommentKit();
  return (
    <CommentByline
      name={entry.author.name}
      nameClassName={cn("text-[0.8125rem] font-medium leading-6", !entry.author.verified && "italic text-muted-foreground")}
      at={entry.delivery ? 0 : entry.at}
      editedAt={entry.delivery?.state === "waiting" ? null : entry.editedAt}
      actions={menu}
      wide={wide}
    >
      {fresh ? (
        <Badge variant="comment" size="sm" className="shrink-0">
          {labels.newBadge}
        </Badge>
      ) : null}
    </CommentByline>
  );
}

function BubbleMeta({ entry, own }: Readonly<{ entry: CommentEntry; own: boolean }>) {
  const settled = !entry.deleted && !entry.delivery;
  const named = !own && !(entry.deleted && entry.author.verified);
  if (!named && !settled) return null;
  return (
    <div className={cn("mb-1 flex", own ? "justify-end" : "pl-9")}>
      <CommentByline
        name={named ? entry.author.name : undefined}
        nameClassName={cn("font-medium", META, entry.author.verified ? "text-foreground/80" : "italic")}
        at={settled ? entry.at : 0}
        editedAt={settled ? entry.editedAt : null}
      />
    </div>
  );
}

function ChatBubble({
  entry,
  own,
  continued,
  fresh,
  canReact,
  react,
  menu,
  editor,
}: Readonly<{
  entry: CommentEntry;
  own: boolean;
  continued: boolean;
  fresh: boolean;
  canReact: boolean;
  react?: CommentMessageActions["react"];
  menu: ReactNode;
  editor: ReactNode;
}>) {
  const kit = useCommentKit();
  const { labels } = kit;
  const settled = !entry.deleted && !entry.delivery;
  const reactions = useReactions(
    entry.reactions ?? [],
    canReact && settled,
    react ? (emoji, on) => react(entry.id, emoji, on) : undefined,
  );
  const avatar = (() => {
    if (own) return null;
    if (continued) return <span aria-hidden className="w-7 shrink-0" />;
    if (entry.deleted && entry.author.verified) return <DeletedAvatar size="base" />;
    return <AuthorAvatar author={entry.author} size="base" kit={kit} />;
  })();
  return (
    <>
      {continued && entry.editedAt === null ? null : <BubbleMeta entry={entry} own={own} />}
      <div className={cn("flex items-start gap-2", own && "flex-row-reverse")}>
        {avatar}
        {editor ? (
          <div className="min-w-0 flex-1">{editor}</div>
        ) : (
          <Tooltip label={kit.exact(entry.at)} suppressed={!continued || !settled} className="min-w-0 max-w-[80%]">
            <div
              data-comment-bubble
              className={cn(BUBBLE, entry.deleted && "bg-muted/40 italic text-muted-foreground")}
            >
              {entry.deleted ? (
                <p className="text-[0.8125rem] leading-[1.55]">{entry.removed ? labels.removed : labels.deleted}</p>
              ) : (
                <CommentBody
                  body={entry.body}
                  members={kit.members.filter((member) => entry.mentions.includes(member.accountId))}
                  className={cn("mt-0", entry.delivery && "text-muted-foreground")}
                />
              )}
              {continued && settled && entry.at ? (
                <time dateTime={isoTime(entry.at)} className="sr-only">
                  {kit.relative(entry.at, kit.now)}
                </time>
              ) : null}
            </div>
          </Tooltip>
        )}
        {editor ? null : (
          <div
            data-comment-bubble-side
            className={cn("relative flex min-w-[3.125rem] shrink-0 items-center self-center", own && "flex-row-reverse")}
          >
            <span data-comment-bubble-actions className={cn(BUBBLE_ACTIONS, own && "flex-row-reverse")}>
              <ReactionAdd state={reactions} bare />
              {menu}
            </span>
            {fresh ? (
              <Badge
                variant="comment"
                size="sm"
                className="pointer-events-none absolute start-0 transition-opacity group-hover/item:opacity-0 group-focus-within/item:opacity-0 pointer-coarse:opacity-0"
              >
                {labels.newBadge}
              </Badge>
            ) : null}
          </div>
        )}
      </div>
      <div className={cn("flex flex-col", own ? "items-end" : "items-start pl-9")}>
        {entry.delivery ? <DeliveryNote entry={entry} delivery={entry.delivery} end={own} /> : null}
        {settled && reactions.shown.length > 0 ? (
          <div data-comment-actions className={cn("mt-1.5 flex flex-wrap items-center gap-1", own && "justify-end")}>
            <ReactionPills state={reactions} />
          </div>
        ) : null}
        <ReactionError state={reactions} className="mt-1.5 basis-auto" />
      </div>
    </>
  );
}

export function CommentItem({
  entry,
  root = false,
  canWrite,
  canReact = canWrite,
  actions,
  onReply,
  thread,
  headerAction,
  variant = "card",
  continued = false,
}: Readonly<{
  entry: CommentEntry;
  root?: boolean;
  variant?: "card" | "bubble";
  continued?: boolean;
  canWrite: boolean;
  canReact?: boolean;
  actions: CommentMessageActions;
  onReply?: (entry: CommentEntry) => void;
  thread?: ThreadMenu;
  headerAction?: ReactNode;
}>) {
  const kit = useCommentKit();
  const { labels } = kit;
  const arrival = useArrival(entry.id);
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState<"delete" | "remove" | null>(null);
  const { error, run } = useCommentAction(kit.describeError);
  const delivery = entry.delivery;
  const settled = !entry.deleted && !delivery;
  const own = entry.author.verified && entry.author.id === kit.self;
  const mine = own && canWrite && settled && !editing;
  const edit = mine && actions.edit ? () => setEditing(true) : undefined;
  const remove = mine && actions.remove ? () => setConfirming("delete") : undefined;
  const moderate =
    canWrite && !own && settled && kit.moderate && actions.moderate && labels.remove && labels.removeConfirm
      ? () => setConfirming("remove")
      : undefined;
  const react = actions.react;
  const Confirm = kit.Confirm;
  const reactions = entry.reactions ?? [];
  const showReactions = !entry.deleted && (reactions.length > 0 || (settled && canReact && react !== undefined && kit.reactions));
  const editMessage = actions.edit;
  const entries = editing ? null : menuEntries(labels, { onEdit: edit, onDelete: remove, onRemove: moderate, thread: settled ? thread : undefined });
  const confirm =
    confirming === "remove" && labels.removeConfirm && labels.remove
      ? { ...labels.removeConfirm, confirmLabel: labels.removeConfirm.confirm ?? labels.remove, action: actions.moderate }
      : { ...labels.deleteMessageConfirm, confirmLabel: labels.delete, action: actions.remove };
  const editor =
    editing && editMessage ? (
      <CommentComposer
        label={labels.editLabel}
        submitLabel={labels.save}
        submitIcon={Check}
        labels={labels}
        describeError={kit.describeError}
        canRetry={kit.canRetry}
        initial={entry.body}
        autoFocus
        maxLength={kit.maxLength}
        members={kit.members}
        self={kit.self}
        hue={kit.hue}
        onSubmit={async (body) => {
          await editMessage(entry.id, body);
          setEditing(false);
        }}
        onCancel={() => setEditing(false)}
      />
    ) : null;
  const dialog = (
    <Confirm
      open={confirming !== null}
      title={confirm.title}
      description={confirm.description}
      confirmLabel={confirm.confirmLabel}
      onConfirm={() => {
        setConfirming(null);
        const action = confirm.action;
        if (action) run(() => action(entry.id));
      }}
      onCancel={() => setConfirming(null)}
    />
  );
  if (variant === "bubble") {
    return (
      <li
        ref={arrival.ref}
        data-comment-entry={entry.id}
        data-fresh={arrival.fresh || undefined}
        data-delivery={delivery?.state}
        data-own={own || undefined}
        className={cn(
          "group/item -mx-1 rounded-md px-1 transition-colors duration-700",
          continued ? "mt-1" : "mt-3 first:mt-0",
          arrival.fresh && "bg-comment-highlight",
        )}
      >
        <ChatBubble
          entry={entry}
          own={own}
          continued={continued}
          fresh={arrival.fresh}
          canReact={canReact}
          react={react}
          menu={entries ? <MessageMenu entries={entries} /> : null}
          editor={editor}
        />
        {error ? <InlineAlert className="mt-1">{error}</InlineAlert> : null}
        {dialog}
      </li>
    );
  }
  const gone = <p className="min-w-0 text-[0.8125rem] italic text-muted-foreground">{entry.removed ? labels.removed : labels.deleted}</p>;
  const menu =
    headerAction || entries ? (
      <>
        {headerAction}
        {entries ? <MessageMenu entries={entries} className={HEADER_BUTTON} /> : null}
      </>
    ) : null;
  return (
    <li
      ref={arrival.ref}
      data-comment-entry={entry.id}
      data-fresh={arrival.fresh || undefined}
      data-delivery={delivery?.state}
      className={cn(
        "group/item -mx-1 flex gap-2.5 rounded-md px-1 transition-colors duration-700",
        arrival.fresh && "bg-comment-highlight",
      )}
    >
      {entry.deleted && entry.author.verified ? (
        <DeletedAvatar size={root ? "base" : "sm"} />
      ) : (
        <AuthorAvatar author={entry.author} size={root ? "base" : "sm"} kit={kit} />
      )}
      <div className="min-w-0 flex-1">
        {entry.deleted ? (
          <div className="flex min-h-6 min-w-0 flex-wrap items-center gap-x-1.5">
            {entry.author.verified ? (
              withActions(gone, headerAction, false)
            ) : (
              <>
                {gone}
                {withActions(<span className="min-w-0 truncate text-[0.6875rem] italic text-muted-foreground">{entry.author.name}</span>, headerAction, false)}
              </>
            )}
          </div>
        ) : (
          <MessageHeader entry={entry} fresh={arrival.fresh} menu={menu} wide={Boolean(headerAction && entries)} />
        )}
        {editor ? (
          <div className="mt-1">{editor}</div>
        ) : entry.deleted ? null : (
          <CommentBody
            body={entry.body}
            members={kit.members.filter((member) => entry.mentions.includes(member.accountId))}
            className={delivery ? "text-muted-foreground" : undefined}
          />
        )}
        {delivery ? <DeliveryNote entry={entry} delivery={delivery} /> : null}
        {!editing && (showReactions || (onReply && settled)) ? (
          <div data-comment-actions className="mt-2.5 flex flex-wrap items-center gap-1">
            {showReactions ? (
              <ReactionBar
                reactions={reactions}
                canReact={canReact && settled}
                onToggle={react ? (emoji, on) => react(entry.id, emoji, on) : undefined}
              />
            ) : null}
            {onReply && settled ? (
              <Button
                type="button"
                variant="ghost"
                size="xs"
                className="h-6 px-1.5 text-[0.6875rem] font-medium text-muted-foreground hover:text-foreground"
                onClick={() => onReply(entry)}
              >
                {labels.reply}
              </Button>
            ) : null}
          </div>
        ) : null}
        {error ? <InlineAlert className="mt-1">{error}</InlineAlert> : null}
      </div>
      {dialog}
    </li>
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
}: Readonly<{ thread: CommentThreadModel; expanded: boolean; onToggle: () => void }>) {
  const { labels } = useCommentKit();
  const replies = thread.messages.length - 1;
  const first = thread.messages[0];
  return (
    <button
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
            {first && !first.deleted ? ` · ${commentPlainText(first.body)}` : null}
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
                "size-5.5 opacity-0 transition-opacity group-hover/thread:opacity-100 group-focus-within/thread:opacity-100 [@media(hover:none)]:opacity-100",
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
  const replyingPeople = kit.replyingIn?.(thread.id) ?? [];
  const repliesId = useId();
  const resolveButton = (onChip: boolean) => (
    <ResolveButton
      busy={busy}
      onChip={onChip ? thread.quoteState === "anchored" : null}
      shown={selected}
      onResolve={() => run(actions.resolve)}
    />
  );

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
    resolve: writable ? () => run(actions.resolve) : undefined,
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
          <ResolvedSummary thread={thread} expanded={openResolved} onToggle={() => setOpenResolved((value) => !value)} />
          {canWrite ? (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              disabled={busy}
              className="ms-auto shrink-0 text-foreground"
              onClick={() => run(actions.reopen)}
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
          {replyingPeople.length > 0 ? (
            <TypingLine
              people={replyingPeople}
              label={presenceText(labels.replying, replyingPeople.map((person) => person.name))}
              className="ml-3.5 pl-4"
            />
          ) : null}
          {writable && replying ? (
            <div className="ml-3.5 pl-4">
              <CommentComposer
                key={replying.key}
                compact
                label={labels.replyLabel}
                placeholder={labels.replyPlaceholder}
                submitLabel={labels.send}
                labels={labels}
                describeError={kit.describeError}
                canRetry={kit.canRetry}
                initial={replying.prefill}
                autoFocus
                maxLength={kit.maxLength}
                members={kit.members}
                self={kit.self}
                hue={kit.hue}
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
