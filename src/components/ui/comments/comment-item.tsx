import { type ReactNode, type Ref, useRef, useState } from "react";
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
      note={entry.author.note}
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

type Confirming = "delete" | "remove" | null;

type Arrival = ReturnType<typeof useArrival>;

function rights(entry: CommentEntry, kit: CommentKit, canWrite: boolean, actions: CommentMessageActions, editing: boolean) {
  const settled = !entry.deleted && !entry.delivery;
  const own = entry.author.verified && entry.author.id === kit.self;
  const mine = own && canWrite && settled && !editing;
  const moderator = Boolean(kit.moderate && actions.moderate && kit.labels.remove && kit.labels.removeConfirm);
  return {
    settled,
    own,
    edits: mine && actions.edit !== undefined,
    removes: mine && actions.remove !== undefined,
    moderates: canWrite && !own && settled && moderator,
  };
}

function itemMenu(
  kit: CommentKit,
  may: ReturnType<typeof rights>,
  thread: ThreadMenu | undefined,
  edit: () => void,
  confirm: (kind: "delete" | "remove") => void,
): MenuEntries | null {
  return menuEntries(kit.labels, {
    onEdit: may.edits ? edit : undefined,
    onDelete: may.removes ? () => confirm("delete") : undefined,
    onRemove: may.moderates ? () => confirm("remove") : undefined,
    thread: may.settled ? thread : undefined,
  });
}

function showsReactions(entry: CommentEntry, kit: CommentKit, canReact: boolean, react: CommentMessageActions["react"]): boolean {
  if (entry.deleted) return false;
  if ((entry.reactions ?? []).length > 0) return true;
  return Boolean(!entry.delivery && canReact && react !== undefined && kit.reactions);
}

function confirmCopy(confirming: Confirming, labels: CommentKit["labels"], actions: CommentMessageActions) {
  if (confirming === "remove" && labels.removeConfirm && labels.remove) {
    return { ...labels.removeConfirm, confirmLabel: labels.removeConfirm.confirm ?? labels.remove, action: actions.moderate };
  }
  return { ...labels.deleteMessageConfirm, confirmLabel: labels.delete, action: actions.remove };
}

function ItemEditor({
  entry,
  save,
  onDone,
}: Readonly<{ entry: CommentEntry; save: NonNullable<CommentMessageActions["edit"]>; onDone: () => void }>) {
  const { labels } = useCommentKit();
  return (
    <CommentComposer
      label={labels.editLabel}
      submitLabel={labels.save}
      submitIcon={Check}
      initial={entry.body}
      autoFocus
      onSubmit={async (body) => {
        await save(entry.id, body);
        onDone();
      }}
      onCancel={onDone}
    />
  );
}

function ItemConfirm({
  entry,
  confirming,
  actions,
  run,
  onClose,
}: Readonly<{
  entry: CommentEntry;
  confirming: Confirming;
  actions: CommentMessageActions;
  run: (action: () => Promise<void>) => void;
  onClose: () => void;
}>) {
  const { labels, Confirm } = useCommentKit();
  const confirm = confirmCopy(confirming, labels, actions);
  return (
    <Confirm
      open={confirming !== null}
      title={confirm.title}
      description={confirm.description}
      confirmLabel={confirm.confirmLabel}
      onConfirm={() => {
        onClose();
        const action = confirm.action;
        if (action) run(() => action(entry.id));
      }}
      onCancel={onClose}
    />
  );
}

function BubbleRow({
  entry,
  own,
  continued,
  arrival,
  canReact,
  react,
  entries,
  editor,
  children,
}: Readonly<{
  entry: CommentEntry;
  own: boolean;
  continued: boolean;
  arrival: Arrival;
  canReact: boolean;
  react: CommentMessageActions["react"];
  entries: MenuEntries | null;
  editor: ReactNode;
  children: ReactNode;
}>) {
  return (
    <li
      ref={arrival.ref}
      data-comment-entry={entry.id}
      data-fresh={arrival.fresh || undefined}
      data-delivery={entry.delivery?.state}
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
      {children}
    </li>
  );
}

function ItemError({ error }: Readonly<{ error: string | null }>) {
  return error ? <InlineAlert className="mt-1">{error}</InlineAlert> : null;
}

function CardRow({
  entry,
  root,
  arrival,
  dialog,
  children,
}: Readonly<{ entry: CommentEntry; root: boolean; arrival: Arrival; dialog: ReactNode; children: ReactNode }>) {
  return (
    <li
      ref={arrival.ref}
      data-comment-entry={entry.id}
      data-fresh={arrival.fresh || undefined}
      data-delivery={entry.delivery?.state}
      className={cn(
        "group/item -mx-1 flex gap-2.5 rounded-md px-1 transition-colors duration-700",
        arrival.fresh && "bg-comment-highlight",
      )}
    >
      <CardAvatar entry={entry} root={root} />
      <div className="min-w-0 flex-1">{children}</div>
      {dialog}
    </li>
  );
}

function CardAvatar({ entry, root }: Readonly<{ entry: CommentEntry; root: boolean }>) {
  const kit = useCommentKit();
  const size = root ? "base" : "sm";
  if (entry.deleted && entry.author.verified) return <DeletedAvatar size={size} />;
  return <AuthorAvatar author={entry.author} size={size} kit={kit} />;
}

function GoneRow({
  entry,
  headerAction,
  row,
  above,
}: Readonly<{ entry: CommentEntry; headerAction: ReactNode; row: Ref<HTMLDivElement>; above: boolean }>) {
  const { labels } = useCommentKit();
  const gone = <p className="min-w-0 text-[0.8125rem] italic text-muted-foreground">{entry.removed ? labels.removed : labels.deleted}</p>;
  return (
    <div ref={row} className="flex min-h-6 min-w-0 flex-wrap items-center gap-x-1.5">
      {entry.author.verified ? (
        withActions(gone, headerAction, false)
      ) : (
        <>
          {gone}
          {withActions(<span className="min-w-0 truncate text-[0.6875rem] italic text-muted-foreground">{entry.author.name}</span>, headerAction, false, above ? "mt-1" : undefined)}
        </>
      )}
    </div>
  );
}

function CardHeader({
  entry,
  fresh,
  headerAction,
  entries,
  row,
  above,
}: Readonly<{
  entry: CommentEntry;
  fresh: boolean;
  headerAction: ReactNode;
  entries: MenuEntries | null;
  row: Ref<HTMLDivElement>;
  above: boolean;
}>) {
  if (entry.deleted) return <GoneRow entry={entry} headerAction={headerAction} row={row} above={above} />;
  const menu =
    headerAction || entries ? (
      <>
        {headerAction}
        {entries ? <MessageMenu entries={entries} className={HEADER_BUTTON} /> : null}
      </>
    ) : null;
  return <MessageHeader entry={entry} fresh={fresh} menu={menu} wide={Boolean(headerAction && entries)} />;
}

function CardBody({
  entry,
  editor,
  mentioned,
}: Readonly<{ entry: CommentEntry; editor: ReactNode; mentioned: CommentKit["members"] }>) {
  const { math, markdown } = useCommentKit();
  const note = entry.delivery ? <DeliveryNote entry={entry} delivery={entry.delivery} /> : null;
  if (editor) {
    return (
      <>
        <div className="mt-1">{editor}</div>
        {note}
      </>
    );
  }
  if (entry.deleted) return note;
  return (
    <>
      <CommentBody
        body={entry.body}
        members={mentioned}
        math={math}
        markdown={markdown}
        className={entry.delivery ? "text-muted-foreground" : undefined}
      />
      {note}
    </>
  );
}

function CardActions({
  entry,
  canReact,
  react,
  onReply,
}: Readonly<{
  entry: CommentEntry;
  canReact: boolean;
  react: CommentMessageActions["react"];
  onReply: ((entry: CommentEntry) => void) | undefined;
}>) {
  const kit = useCommentKit();
  const settled = !entry.deleted && !entry.delivery;
  const reactions = showsReactions(entry, kit, canReact, react);
  const reply = settled ? onReply : undefined;
  if (!reactions && !reply) return null;
  return (
    <div data-comment-actions className="mt-2.5 flex flex-wrap items-center gap-1">
      {reactions ? (
        <ReactionBar
          reactions={entry.reactions ?? []}
          canReact={canReact && settled}
          onToggle={react ? (emoji, on) => react(entry.id, emoji, on) : undefined}
        />
      ) : null}
      {reply ? (
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="h-6 px-1.5 text-[0.6875rem] font-medium text-muted-foreground hover:text-foreground"
          onClick={() => reply(entry)}
        >
          {kit.labels.reply}
        </Button>
      ) : null}
    </div>
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
  const arrival = useArrival(entry.id);
  const mentioned = useMentioned(kit.members, entry.mentions);
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState<Confirming>(null);
  const { error, run } = useCommentAction(kit.describeError);
  const { ref: goneRow, room: goneRoom } = usePillRoom<HTMLDivElement>(
    entry.deleted && !entry.author.verified && Boolean(headerAction),
    `${entry.author.name}\u0000${entry.removed === true}`,
  );
  const may = rights(entry, kit, canWrite, actions, editing);
  const entries = editing ? null : itemMenu(kit, may, thread, () => setEditing(true), setConfirming);
  const editor =
    editing && actions.edit ? <ItemEditor entry={entry} save={actions.edit} onDone={() => setEditing(false)} /> : null;
  const dialog = (
    <ItemConfirm entry={entry} confirming={confirming} actions={actions} run={run} onClose={() => setConfirming(null)} />
  );
  if (variant === "bubble") {
    return (
      <BubbleRow
        entry={entry}
        own={may.own}
        continued={continued}
        arrival={arrival}
        canReact={canReact}
        react={actions.react}
        entries={entries}
        editor={editor}
      >
        <ItemError error={error} />
        {dialog}
      </BubbleRow>
    );
  }
  return (
    <CardRow entry={entry} root={root} arrival={arrival} dialog={dialog}>
      <CardHeader
        entry={entry}
        fresh={arrival.fresh}
        headerAction={headerAction}
        entries={entries}
        row={goneRow}
        above={goneRoom.above}
      />
      <CardBody entry={entry} editor={editor} mentioned={mentioned} />
      {editing ? null : <CardActions entry={entry} canReact={canReact} react={actions.react} onReply={onReply} />}
      <ItemError error={error} />
    </CardRow>
  );
}
