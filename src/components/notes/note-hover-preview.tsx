import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { NoteChip } from "./note-icons";
import { embedSource } from "./note-embeds";
import type { LinkableNote } from "./note-links";
import { NoteMarkdown } from "./note-preview";

export const HOVER_DELAY_MS = 400;
export const HIDE_DELAY_MS = 150;
const WIDTH = 352;
const HEIGHT = 288;
const GAP = 6;
const MARGIN = 8;

interface HoverTarget {
  note: LinkableNote;
  heading: string | null;
  rect: { left: number; top: number; bottom: number };
}

interface HoverPreviewProps {
  containerRef: RefObject<HTMLElement | null>;
  getNotes: () => readonly LinkableNote[] | null;
  previewOf: (projectId: string) => string | undefined;
  loadText: (projectId: string) => Promise<string>;
  resolveAsset?: (projectId: string, path: string) => Promise<string | null>;
}

export function hoverPlacement(rect: HoverTarget["rect"], viewport: { width: number; height: number }) {
  const left = Math.max(MARGIN, Math.min(rect.left, viewport.width - WIDTH - MARGIN));
  if (rect.bottom + GAP + HEIGHT > viewport.height && rect.top - GAP - HEIGHT >= 0) {
    return { left, bottom: viewport.height - rect.top + GAP };
  }
  return { left, top: rect.bottom + GAP };
}

function linkFrom(target: EventTarget | null, container: HTMLElement): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const link = target.closest<HTMLElement>("[data-note-link='note'][data-note-id]");
  return link && container.contains(link) ? link : null;
}

function HoverBody({ target, previewOf, loadText, resolveAsset }: Readonly<{ target: HoverTarget } & Omit<HoverPreviewProps, "containerRef" | "getNotes">>) {
  const { t } = useTranslation(["notes"]);
  const preview = target.heading ? undefined : previewOf(target.note.projectId);
  const [loaded, setLoaded] = useState<{ key: string; source: string | null } | null>(null);
  const key = `${target.note.projectId}#${target.heading ?? ""}`;
  useEffect(() => {
    if (preview !== undefined) return;
    let live = true;
    loadText(target.note.projectId).then(
      (text) => {
        if (live) setLoaded({ key, source: embedSource(text, target.heading ?? undefined) });
      },
      () => {
        if (live) setLoaded({ key, source: null });
      },
    );
    return () => {
      live = false;
    };
  }, [key, loadText, preview, target.heading, target.note.projectId]);
  const source = preview ?? (loaded?.key === key ? loaded.source : undefined);
  if (source === undefined) return <p className="px-3 py-2 text-xs text-muted-foreground">{t(($) => $.notes.kb.hover.loading)}</p>;
  if (!source) return <p className="px-3 py-2 text-xs text-muted-foreground">{t(($) => $.notes.kb.hover.empty)}</p>;
  return <NoteMarkdown noteId={target.note.projectId} source={source} resolveAsset={resolveAsset} className="note-hover-body" />;
}

function clear(timer: { current: number | null }): void {
  if (timer.current !== null) window.clearTimeout(timer.current);
  timer.current = null;
}

export function NoteHoverPreview({ containerRef, getNotes, previewOf, loadText, resolveAsset }: Readonly<HoverPreviewProps>) {
  const [target, setTarget] = useState<HoverTarget | null>(null);
  const showTimer = useRef<number | null>(null);
  const hideTimer = useRef<number | null>(null);
  const anchor = useRef<HTMLElement | null>(null);
  const hide = useCallback(() => {
    clear(showTimer);
    clear(hideTimer);
    anchor.current = null;
    setTarget(null);
  }, []);
  const hideSoon = useCallback(() => {
    clear(showTimer);
    clear(hideTimer);
    hideTimer.current = window.setTimeout(hide, HIDE_DELAY_MS);
  }, [hide]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const over = (event: MouseEvent) => {
      const link = linkFrom(event.target, container);
      if (!link) return;
      clear(hideTimer);
      if (link === anchor.current) return;
      clear(showTimer);
      anchor.current = link;
      showTimer.current = window.setTimeout(() => {
        const note = getNotes()?.find((candidate) => candidate.noteId === link.dataset.noteId);
        if (!note || !link.isConnected) return;
        const rect = link.getBoundingClientRect();
        setTarget({ note, heading: link.dataset.noteHeading ?? null, rect: { left: rect.left, top: rect.top, bottom: rect.bottom } });
      }, HOVER_DELAY_MS);
    };
    const out = (event: MouseEvent) => {
      if (!linkFrom(event.target, container)) return;
      if (linkFrom(event.relatedTarget, container) === anchor.current) return;
      hideSoon();
    };
    const down = () => hide();
    container.addEventListener("mouseover", over);
    container.addEventListener("mouseout", out);
    container.addEventListener("mousedown", down);
    container.addEventListener("scroll", down, { passive: true });
    return () => {
      container.removeEventListener("mouseover", over);
      container.removeEventListener("mouseout", out);
      container.removeEventListener("mousedown", down);
      container.removeEventListener("scroll", down);
      clear(showTimer);
      clear(hideTimer);
    };
  }, [containerRef, getNotes, hide, hideSoon]);

  useEffect(() => {
    if (!target) return;
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") hide();
    };
    document.addEventListener("keydown", key, true);
    return () => document.removeEventListener("keydown", key, true);
  }, [hide, target]);

  if (!target) return null;
  return createPortal(
    <div
      role="tooltip"
      data-note-hover={target.note.projectId}
      style={hoverPlacement(target.rect, { width: window.innerWidth, height: window.innerHeight })}
      onMouseEnter={() => clear(hideTimer)}
      onMouseLeave={hideSoon}
      className="fixed z-50 flex max-h-72 w-[22rem] flex-col overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-xl"
    >
      <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2">
        <NoteChip icon={target.note.icon} color={target.note.color} className="size-5 rounded" />
        <span className="truncate text-sm font-medium">{target.note.title}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden px-3 py-2">
        <HoverBody target={target} previewOf={previewOf} loadText={loadText} resolveAsset={resolveAsset} />
      </div>
    </div>,
    document.body,
  );
}
