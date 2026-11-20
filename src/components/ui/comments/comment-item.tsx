import { type ReactNode, useRef, useState } from "react";
import { Check, Link2, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
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
import { cn } from "@/lib/utils";
import { useArrival } from "./comment-arrivals";
import { CommentBody } from "./comment-body";
import { ChatBubble } from "./comment-bubble";
import { CommentByline, usePillRoom, withActions } from "./comment-byline";
import { CommentComposer } from "./comment-composer";
import { AuthorAvatar, type CommentEntry, type CommentMessageActions, DeletedAvatar, DeliveryNote, useMentioned } from "./comment-entry";
import { type CommentKit, useCommentAction, useCommentKit } from "./comment-kit";
import { ReactionBar } from "./comment-reactions";

export interface ThreadMenu {
  copyLink?: () => void;
  resolve?: () => void;
  removeThread?: () => void;
}

export const MENU_BUTTON = "shrink-0 text-muted-foreground hover:text-foreground";

export const HEADER_BUTTON = "size-6 hover:bg-foreground/10 focus-visible:bg-foreground/10 data-[state=open]:bg-foreground/10";

const DESTRUCTIVE_ITEM = "text-destructive focus:text-destructive [&_svg]:text-destructive";

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
  const pointer = useRef(false);
  const fromPointer = () => {
    pointer.current = true;
  };
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
        onPointerDown={fromPointer}
        onPointerUp={fromPointer}
        onKeyDown={() => {
          pointer.current = false;
        }}
        onCloseAutoFocus={(event) => {
          const next = picked.current;
          picked.current = null;
          if (next && (next.keep || pointer.current)) event.preventDefault();
          next?.run?.();
        }}
      >
        {top.map(({ key, icon: Icon, label, run }) => (
          <DropdownMenuItem
            key={key}
            onSelect={() => {
              const later = pointer.current && key !== "edit";
              picked.current = { keep: key === "edit", run: later ? run : undefined };
              if (!later) run();
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
  const mentioned = useMentioned(kit.members, entry.mentions);
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState<"delete" | "remove" | null>(null);
  const { error, run } = useCommentAction(kit.describeError);
  const { ref: goneRow, room: goneRoom } = usePillRoom<HTMLDivElement>(
    entry.deleted && !entry.author.verified && Boolean(headerAction),
    `${entry.author.name}\u0000${entry.removed === true}`,
  );
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
        initial={entry.body}
        autoFocus
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
          <div ref={goneRow} className="flex min-h-6 min-w-0 flex-wrap items-center gap-x-1.5">
            {entry.author.verified ? (
              withActions(gone, headerAction, false)
            ) : (
              <>
                {gone}
                {withActions(<span className="min-w-0 truncate text-[0.6875rem] italic text-muted-foreground">{entry.author.name}</span>, headerAction, false, goneRoom.above ? "mt-1" : undefined)}
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
            members={mentioned}
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
