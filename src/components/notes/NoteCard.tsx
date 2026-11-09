import { MoreHorizontal, Star } from "lucide-react";
import { useId, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from "@/components/ui/context-menu";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useNearViewport } from "@/hooks/use-near-viewport";
import { ROW_WINDOW_ITEM } from "@/hooks/use-row-window";
import { cn } from "@/lib/utils";
import { AgentTag, NoteChip, NoteIcon } from "./note-icons";
import { NotePreview } from "./note-preview";
import { CONTEXT_MENU_KIT, DROPDOWN_MENU_KIT, type MenuKit, type NoteActions, NoteMenuItems, NoteRenameInput } from "./note-actions";
import { SharedMark } from "./NoteShareButton";
import { ProjectDot } from "./project-color";
import type { NoteItem } from "./types";

const SOLID_FILL = "bg-[color-mix(in_oklab,var(--foreground)_3.5%,var(--background))]";
const SOLID_HOVER = "hover:bg-[color-mix(in_oklab,var(--foreground)_9%,var(--background))]";
const REVEAL = "opacity-0 transition-opacity motion-reduce:transition-none focus-visible:opacity-100 data-[state=open]:opacity-100";
const CARD_REVEAL =
  "group-hover/card:opacity-100 group-focus-within/card:opacity-100 group-data-[menu-open=true]/card:opacity-100";
const ROW_REVEAL = "group-hover/row:opacity-100 group-focus-within/row:opacity-100 group-data-[menu-open=true]/row:opacity-100";

const LIST_COLUMN = "min-w-[7.5rem] max-w-[15rem] flex-[1_1_0%] items-center truncate px-3";
const LIST_COLUMNS = {
  project: "hidden @min-[36rem]:flex",
  author: "hidden @min-[48rem]:flex",
  edited: "flex",
  created: "hidden @min-[60rem]:flex",
  opened: "hidden @min-[70rem]:flex",
} as const;

export type ListColumn = keyof typeof LIST_COLUMNS;

export function listColumn(column: ListColumn, sorted: ListColumn | null): string {
  return cn(LIST_COLUMN, column === sorted ? "flex" : LIST_COLUMNS[column]);
}

const NEAR_MARGIN = "400px 0px";

interface NoteMenus {
  open: boolean;
  renaming: boolean;
  finishRename: (title: string | null) => void;
  items: (kit: MenuKit) => ReactNode;
  setMoreOpen: (open: boolean) => void;
  setContextOpen: (open: boolean) => void;
  runPending: () => void;
}

function useNoteMenus(note: NoteItem, actions: NoteActions): NoteMenus {
  const [renaming, setRenaming] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const pending = useRef<(() => void) | null>(null);
  const afterClose = (action: () => void) => () => {
    pending.current = action;
  };
  return {
    open: moreOpen || contextOpen,
    renaming,
    finishRename: (next) => {
      setRenaming(false);
      const title = next?.trim();
      if (title && title !== note.title) actions.rename?.(title);
    },
    items: (kit) => (
      <NoteMenuItems
        note={note}
        kit={kit}
        actions={actions}
        onRename={afterClose(() => setRenaming(true))}
        onDelete={afterClose(() => actions.remove?.())}
      />
    ),
    setMoreOpen,
    setContextOpen,
    runPending: () => {
      const action = pending.current;
      pending.current = null;
      action?.();
    },
  };
}

const TITLE_INPUT = "h-auto rounded-md border-0 bg-foreground/[0.06] px-1 py-0";
const CORNER_BUTTON = "flex size-6 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground";

function FavoriteButton({
  favorite,
  reveal,
  className,
}: Readonly<{ favorite: NonNullable<NoteActions["favorite"]>; reveal: string; className?: string }>) {
  const { t } = useTranslation(["notes"]);
  return (
    <button
      type="button"
      aria-label={favorite.on ? t(($) => $.notes.library.menu.unfavorite) : t(($) => $.notes.library.menu.favorite)}
      aria-pressed={favorite.on}
      onClick={favorite.toggle}
      className={cn(
        CORNER_BUTTON,
        favorite.on ? "text-amber-500 opacity-100 hover:text-amber-600" : cn(REVEAL, reveal),
        className,
      )}
    >
      <Star aria-hidden className={cn("size-3.5", favorite.on && "fill-current")} />
    </button>
  );
}

function CornerButtons({
  favorite,
  menus,
  shape,
  reveal,
  className,
}: Readonly<{ favorite?: NoteActions["favorite"]; menus: NoteMenus; shape: string; reveal: string; className?: string }>) {
  const { t } = useTranslation(["notes"]);
  return (
    <div className={cn("absolute flex items-center gap-1", className)}>
      {favorite && <FavoriteButton favorite={favorite} reveal={reveal} className={shape} />}
      <DropdownMenu onOpenChange={menus.setMoreOpen}>
        <DropdownMenuTrigger asChild>
          <button type="button" aria-label={t(($) => $.notes.library.menu.more)} className={cn(CORNER_BUTTON, shape, REVEAL, reveal)}>
            <MoreHorizontal aria-hidden className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52" onCloseAutoFocus={menus.runPending}>
          {menus.items(DROPDOWN_MENU_KIT)}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

interface NoteViewProps {
  note: NoteItem;
  icon: string | undefined;
  actions: NoteActions;
  projectColor: string | null;
  onOpen: () => void;
}

export function NoteCard({
  note,
  icon,
  actions,
  projectColor,
  onOpen,
  resolveAsset,
}: Readonly<NoteViewProps & { resolveAsset?: (noteId: string, path: string) => Promise<string | null> }>) {
  const menus = useNoteMenus(note, actions);
  const [gate, near] = useNearViewport<HTMLDivElement>(NEAR_MARGIN);
  const metaId = useId();
  return (
    <ContextMenu onOpenChange={menus.setContextOpen}>
      <ContextMenuTrigger asChild disabled={menus.renaming}>
        <div
          ref={gate}
          data-note-card={note.id}
          data-menu-open={menus.open ? "true" : "false"}
          className="group/card relative aspect-[236/264] min-w-0 rounded-[1.25rem] bg-foreground/[0.035] p-1 transition-colors duration-150 hover:bg-foreground/[0.065] has-[[data-card-open]:focus-visible]:bg-foreground/[0.09] data-[menu-open=true]:bg-foreground/[0.065] motion-reduce:transition-none"
        >
          <div className="flex h-full flex-col overflow-hidden rounded-2xl bg-background px-[1.125rem] pt-[1.125rem]">
            <div className="flex min-w-0 items-start gap-1.5 pr-3 text-sm/5 font-bold">
              <span className="flex h-5 shrink-0 items-center">
                <NoteIcon icon={icon} />
              </span>
              {menus.renaming ? (
                <NoteRenameInput title={note.title} className={cn(TITLE_INPUT, "text-sm/5 font-bold")} onDone={menus.finishRename} />
              ) : (
                <span className="min-w-0 break-words">{note.title}</span>
              )}
              {note.shared && <SharedMark className="h-5" />}
            </div>
            <div className="mt-1 flex h-4 min-w-0 items-center gap-1.5">
              <p id={metaId} className="flex min-w-0 flex-1 items-center gap-1.5 text-[0.6875rem] leading-4 text-muted-foreground">
                <ProjectDot color={projectColor} className="size-1.5" />
                <span className="truncate">{note.project}</span>
              </p>
              {actions.favorite && (
                <FavoriteButton
                  favorite={actions.favorite}
                  reveal={CARD_REVEAL}
                  className="relative z-10 -mr-1.5 size-5 rounded-md hover:bg-foreground/[0.06]"
                />
              )}
            </div>
            {near ? (
              <NotePreview
                noteId={note.id}
                updatedAt={note.updatedAt}
                source={note.preview ?? ""}
                resolveAsset={resolveAsset}
                className="mt-2 min-h-0 flex-1"
              />
            ) : (
              <div data-preview-pending className="mt-2 min-h-0 flex-1" />
            )}
          </div>
          {!menus.renaming && (
            <button
              type="button"
              data-card-open
              aria-label={note.title}
              aria-describedby={metaId}
              onClick={onOpen}
              className="absolute inset-0 rounded-[1.25rem]"
            />
          )}
          <CornerButtons
            menus={menus}
            shape={cn("rounded-full", SOLID_FILL, SOLID_HOVER)}
            reveal={CARD_REVEAL}
            className="right-2 top-2"
          />
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-52" onCloseAutoFocus={menus.runPending}>
        {menus.items(CONTEXT_MENU_KIT)}
      </ContextMenuContent>
    </ContextMenu>
  );
}

export function NoteListRow({
  note,
  icon,
  actions,
  projectColor,
  onOpen,
  when,
  sorted,
}: Readonly<
  NoteViewProps & {
    when: { edited: string; created: string; opened: string | null };
    sorted: ListColumn | null;
  }
>) {
  const { t } = useTranslation(["notes"]);
  const menus = useNoteMenus(note, actions);
  return (
    <ContextMenu onOpenChange={menus.setContextOpen}>
      <ContextMenuTrigger asChild disabled={menus.renaming}>
        <div
          {...{ [ROW_WINDOW_ITEM]: "" }}
          data-note-list-row={note.id}
          data-menu-open={menus.open ? "true" : "false"}
          className="group/row relative flex h-14 items-center rounded-md border-b border-foreground/[0.045] text-[0.8125rem] text-muted-foreground transition-colors duration-150 hover:border-transparent hover:bg-foreground/[0.045] has-[[data-row-open]:focus-visible]:border-transparent has-[[data-row-open]:focus-visible]:bg-foreground/[0.06] data-[menu-open=true]:border-transparent data-[menu-open=true]:bg-foreground/[0.045] motion-reduce:transition-none [&:has(+*:hover)]:border-transparent"
        >
          <div className="flex min-w-[12.5rem] flex-[3_1_0%] items-center gap-3 pl-6 pr-3">
            <NoteChip icon={icon} color={note.color} />
            {menus.renaming ? (
              <NoteRenameInput title={note.title} className={cn(TITLE_INPUT, "text-[0.9375rem]/[1.375rem] text-foreground")} onDone={menus.finishRename} />
            ) : (
              <span className="truncate text-[0.9375rem]/[1.375rem] text-foreground">{note.title}</span>
            )}
            {note.shared && <SharedMark />}
          </div>
          <div className={cn(listColumn("project", sorted), "gap-1.5")}>
            <ProjectDot color={projectColor} className="size-1.5" />
            <span className="truncate">{note.project}</span>
          </div>
          <div className={listColumn("author", sorted)}>
            {note.author === "you" ? (
              !note.shared && <span className="truncate">{t(($) => $.notes.library.author.you)}</span>
            ) : (
              <AgentTag name={note.agent ?? t(($) => $.notes.library.agentFallback)} />
            )}
          </div>
          <div className={cn(listColumn("edited", sorted), "whitespace-nowrap")}>{when.edited}</div>
          <div className={cn(listColumn("created", sorted), "whitespace-nowrap")}>{when.created}</div>
          <div className={cn(listColumn("opened", sorted), "whitespace-nowrap")}>{when.opened}</div>
          <div className="w-[3.75rem] shrink-0" />
          {!menus.renaming && (
            <button
              type="button"
              data-row-open
              aria-label={note.title}
              onClick={onOpen}
              className="absolute inset-0 rounded-md"
            />
          )}
          <CornerButtons
            favorite={actions.favorite}
            menus={menus}
            shape="rounded-md hover:bg-foreground/[0.06]"
            reveal={ROW_REVEAL}
            className="right-3 top-1/2 -translate-y-1/2"
          />
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-52" onCloseAutoFocus={menus.runPending}>
        {menus.items(CONTEXT_MENU_KIT)}
      </ContextMenuContent>
    </ContextMenu>
  );
}
