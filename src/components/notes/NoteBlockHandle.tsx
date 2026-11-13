import type { Editor } from "@tiptap/core";
import { GripVertical, Link2 } from "lucide-react";
import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { writeClipboardText } from "@/lib/clipboard";
import { notifyError, toast } from "@/lib/toast";
import { matchesShortcut, shortcutLabel, useShortcutStore } from "@/store/shortcuts";
import { blockFragment } from "./note-block-ids";
import { type DocBlock, docBlockAt, ensureDocBlockId, findDocBlock } from "./note-block-links";
import type { BlockRefs } from "./note-block-refs";
import { NoteChip } from "./note-icons";
import { isLinkableId, noteLinkHref } from "./note-link-format";
import type { OpenNoteHandler } from "./note-links";
import { blockBacklinks, blockLinkCounts, useNoteBacklinks } from "./use-note-links";

interface Spot {
  block: DocBlock;
  top: number;
  left: number;
}

function sameSpot(a: Spot | null, b: Spot | null): boolean {
  if (!a || !b) return false;
  return a.block.pos === b.block.pos && a.top === b.top;
}

const HANDLE = 22;
const GAP = 4;
const ITEM_INSET = 18;
const HIDE_DELAY_MS = 200;
const LIST_ITEMS = new Set(["listItem", "taskItem"]);

function firstLine(editor: Editor, block: DocBlock): { top: number; bottom: number } | null {
  let inside = -1;
  if (block.node.isTextblock) inside = block.pos + 1;
  else {
    block.node.descendants((child, offset) => {
      if (inside >= 0) return false;
      if (child.isTextblock) inside = block.pos + 1 + offset + 1;
      return inside < 0;
    });
  }
  if (inside < 0 || block.node.type.name === "table" || block.node.type.name === "codeBlock") return null;
  try {
    return editor.view.coordsAtPos(inside);
  } catch {
    return null;
  }
}

function spotOf(editor: Editor, block: DocBlock): Spot | null {
  const dom = editor.view.nodeDOM(block.pos);
  if (!(dom instanceof HTMLElement)) return null;
  const box = dom.getBoundingClientRect();
  const line = firstLine(editor, block);
  const center = line ? (line.top + line.bottom) / 2 : box.top + HANDLE / 2 + GAP;
  const inset = LIST_ITEMS.has(block.node.type.name) ? ITEM_INSET : 0;
  return { block, top: center - HANDLE / 2, left: box.left - inset - HANDLE - GAP };
}

export function NoteBlockHandle({
  editor,
  noteId,
  refs,
  scrollRef,
  onOpenNote,
}: Readonly<{
  editor: Editor;
  noteId: string | null | undefined;
  refs: BlockRefs;
  scrollRef: RefObject<HTMLElement | null>;
  onOpenNote: OpenNoteHandler;
}>) {
  const { t } = useTranslation(["notes"]);
  const [spot, setSpot] = useState<Spot | null>(null);
  const [open, setOpen] = useState(false);
  const openRef = useRef(open);
  openRef.current = open;
  const hideTimer = useRef<number | null>(null);
  const keys = useShortcutStore((state) => shortcutLabel(state.bindings.notesCopyBlockLink));
  const backlinks = useNoteBacklinks(noteId);
  const counts = useMemo(() => blockLinkCounts(backlinks), [backlinks]);

  useEffect(() => {
    refs.setCounts(counts, (count) => t(($) => $.notes.linksSearch.blocks.links, { count }));
  }, [counts, refs, t]);

  const copy = useCallback(
    (block: DocBlock | null) => {
      if (!block || !isLinkableId(noteId)) return;
      const id = ensureDocBlockId(editor.view, block);
      if (!id) {
        toast.error(t(($) => $.notes.linksSearch.blocks.noId));
        return;
      }
      writeClipboardText(noteLinkHref("note", noteId, blockFragment(id))).then(
        () => toast.success(t(($) => $.notes.linksSearch.blocks.linkCopied)),
        (error: unknown) => notifyError("copy a block link", error, t(($) => $.notes.linksSearch.blocks.copyFailed)),
      );
    },
    [editor, noteId, t],
  );

  const clearHide = () => {
    if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
    hideTimer.current = null;
  };
  const hideSoon = useCallback(() => {
    if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      if (!openRef.current) setSpot(null);
    }, HIDE_DELAY_MS);
  }, []);

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    let frame = 0;
    let last: { x: number; y: number } | null = null;
    const locate = () => {
      frame = 0;
      if (!last || openRef.current || editor.isDestroyed) return;
      const box = editor.view.dom.getBoundingClientRect();
      if (last.y < box.top || last.y > box.bottom) {
        hideSoon();
        return;
      }
      const x = Math.min(Math.max(last.x, box.left + 2), box.right - 2);
      const found = editor.view.posAtCoords({ left: x, top: last.y });
      const block = found ? docBlockAt(editor.state, found.pos) : null;
      const next = block ? spotOf(editor, block) : null;
      if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
      hideTimer.current = null;
      setSpot((current) => (sameSpot(current, next) ? current : next));
    };
    const move = (event: MouseEvent) => {
      last = { x: event.clientX, y: event.clientY };
      if (!frame) frame = window.requestAnimationFrame(locate);
    };
    const away = () => {
      if (!openRef.current) setSpot(null);
    };
    scroller.addEventListener("mousemove", move);
    scroller.addEventListener("mouseleave", hideSoon);
    scroller.addEventListener("scroll", away, { passive: true });
    scroller.addEventListener("keydown", away);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      scroller.removeEventListener("mousemove", move);
      scroller.removeEventListener("mouseleave", hideSoon);
      scroller.removeEventListener("scroll", away);
      scroller.removeEventListener("keydown", away);
    };
  }, [editor, hideSoon, scrollRef]);

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!matchesShortcut(event, useShortcutStore.getState().bindings.notesCopyBlockLink) || !editor.view.hasFocus()) return;
      event.preventDefault();
      event.stopPropagation();
      copy(docBlockAt(editor.state));
    };
    scroller.addEventListener("keydown", onKeyDown, true);
    return () => scroller.removeEventListener("keydown", onKeyDown, true);
  }, [copy, editor, scrollRef]);

  useEffect(
    () =>
      refs.onOpen((blockId) => {
        const block = findDocBlock(editor.state.doc, blockId);
        const next = block ? spotOf(editor, block) : null;
        if (!next) return;
        setSpot(next);
        setOpen(true);
      }),
    [editor, refs],
  );

  if (!spot || !isLinkableId(noteId)) return null;
  const linked = spot.block.id ? blockBacklinks(backlinks, spot.block.id) : [];
  return createPortal(
    <DropdownMenu
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setSpot(null);
      }}
    >
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-note-block-handle=""
          aria-label={t(($) => $.notes.linksSearch.blocks.handle)}
          onMouseEnter={clearHide}
          onMouseLeave={hideSoon}
          onMouseDown={(event) => event.preventDefault()}
          style={{ top: spot.top, left: spot.left, width: HANDLE, height: HANDLE }}
          className="fixed z-40 flex items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground data-[state=open]:bg-accent"
        >
          <GripVertical aria-hidden className="size-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="left" className="w-64" onCloseAutoFocus={(event) => event.preventDefault()}>
        <DropdownMenuItem className="gap-2 [&>svg]:size-4" onSelect={() => copy(spot.block)}>
          <Link2 aria-hidden />
          <span className="flex-1">{t(($) => $.notes.linksSearch.blocks.copyLink)}</span>
          <span aria-hidden className="text-xs text-muted-foreground">
            {keys}
          </span>
        </DropdownMenuItem>
        {linked.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs text-muted-foreground">{t(($) => $.notes.linksSearch.blocks.linkedFrom)}</DropdownMenuLabel>
            {linked.map((backlink) => (
              <DropdownMenuItem
                key={backlink.projectId}
                className="gap-2"
                aria-label={t(($) => $.notes.linksSearch.blocks.openLinked, { title: backlink.title })}
                onSelect={() => onOpenNote(backlink.noteId, { newTab: false, projectId: backlink.projectId })}
              >
                <NoteChip icon={backlink.icon} color={backlink.color} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{backlink.title}</span>
                  <span className="block truncate text-xs text-muted-foreground">{backlink.snippet}</span>
                </span>
              </DropdownMenuItem>
            ))}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>,
    document.body,
  );
}
