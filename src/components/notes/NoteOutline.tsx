import { List } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { PanelState } from "@/components/layout/IntelligenceTree";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TreeRow } from "@/components/ui/tree-row";
import { logError } from "@/lib/log";
import { cn } from "@/lib/utils";
import {
  markdownOutline,
  noteEditorRoot,
  outlineRows,
  scrollToHeading,
  watchHeadings,
  type OutlineHeading,
} from "./note-outline";
import { useNotesData } from "./notes-data";

export interface NoteOutlineProps {
  noteId: string | null;
  onOpenHeading: (noteId: string, slug: string) => void;
}

const ALL_LEVELS = 6;
const FIND_EVERY_MS = 400;
const LEVELS = [1, 2, 3, 4, 5] as const;

export function NoteOutline({ noteId, onOpenHeading }: Readonly<NoteOutlineProps>) {
  const { t } = useTranslation(["notes"]);
  const { loadNote } = useNotesData();
  const [headings, setHeadings] = useState<readonly OutlineHeading[]>([]);
  const [active, setActive] = useState(-1);
  const [collapsed, setCollapsed] = useState<ReadonlySet<number>>(new Set());
  const [maxLevel, setMaxLevel] = useState(ALL_LEVELS);
  const elementsRef = useRef<readonly HTMLElement[]>([]);
  const liveRef = useRef(false);
  const pendingRef = useRef<number | null>(null);

  useEffect(() => {
    setHeadings([]);
    setActive(-1);
    setCollapsed(new Set());
    elementsRef.current = [];
    liveRef.current = false;
    pendingRef.current = null;
    if (!noteId) return;
    const id = noteId;
    let disposed = false;
    let root: HTMLElement | null = null;
    let unwatch: (() => void) | null = null;
    let findTimer = 0;

    const watchesRemoval = typeof ResizeObserver !== "undefined";
    let sizes: ResizeObserver | null = null;
    const detach = () => {
      unwatch?.();
      unwatch = null;
      sizes?.disconnect();
      sizes = null;
      root = null;
      liveRef.current = false;
    };
    const attach = (found: HTMLElement) => {
      root = found;
      liveRef.current = true;
      if (watchesRemoval) {
        sizes = new ResizeObserver(() => {
          if (found.isConnected || disposed) return;
          detach();
          find();
        });
        sizes.observe(found);
      }
      unwatch = watchHeadings(found, {
        onRead: (outline) => {
          elementsRef.current = outline.elements;
          setHeadings(outline.headings);
          const pending = pendingRef.current;
          if (pending !== null && outline.elements[pending]) {
            pendingRef.current = null;
            scrollToHeading(outline.elements[pending]);
          }
        },
        onActive: setActive,
      });
    };
    function find() {
      if (root && !root.isConnected) detach();
      if (!root) {
        const found = noteEditorRoot(id);
        if (found) attach(found);
      }
      if (root && watchesRemoval) return;
      findTimer = window.setTimeout(find, FIND_EVERY_MS);
    }

    loadNote(noteId).then(
      (source) => {
        if (!disposed && !liveRef.current) setHeadings(markdownOutline(source.text));
      },
      (error: unknown) => void logError("read the note outline", error),
    );
    find();
    return () => {
      disposed = true;
      detach();
      window.clearTimeout(findTimer);
    };
  }, [loadNote, noteId]);

  const rows = useMemo(() => outlineRows(headings, collapsed, maxLevel), [collapsed, headings, maxLevel]);

  const toggle = useCallback((index: number) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }, []);

  if (!noteId) {
    return (
      <PanelState
        state="empty"
        icon={<List aria-hidden className="size-4" />}
        title={t(($) => $.notes.graph.outline.noNote)}
        detail={t(($) => $.notes.graph.outline.noNoteDetail)}
      />
    );
  }

  const go = (heading: OutlineHeading) => {
    const element = elementsRef.current[heading.index];
    if (liveRef.current && element?.isConnected) {
      scrollToHeading(element);
      setActive(heading.index);
      return;
    }
    pendingRef.current = heading.index;
    onOpenHeading(noteId, heading.slug);
  };

  return (
    <div className="flex h-full min-h-0 flex-col" data-note-outline={noteId}>
      <div className="flex shrink-0 items-center justify-end border-b px-2 py-1.5">
        <Select value={String(maxLevel)} onValueChange={(value) => setMaxLevel(Number(value))}>
          <SelectTrigger aria-label={t(($) => $.notes.graph.outline.levels)} className="h-7 w-32 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={String(ALL_LEVELS)}>{t(($) => $.notes.graph.outline.allLevels)}</SelectItem>
            {LEVELS.map((level) => (
              <SelectItem key={level} value={String(level)}>
                {t(($) => $.notes.graph.outline.upTo, { level })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {rows.length === 0 ? (
        <PanelState
          state="empty"
          icon={<List aria-hidden className="size-4" />}
          title={t(($) => $.notes.graph.outline.empty)}
          detail={t(($) => $.notes.graph.outline.emptyDetail)}
        />
      ) : (
        <nav aria-label={t(($) => $.notes.graph.outline.title)} className="min-h-0 flex-1 overflow-y-auto py-1">
          <ul>
            {rows.map(({ heading, depth, hasChildren, collapsed: folded }) => (
              <li key={`${heading.index}-${heading.slug}`}>
                <TreeRow
                  depth={depth}
                  expanded={hasChildren ? !folded : undefined}
                  onToggle={() => toggle(heading.index)}
                  toggleLabel={
                    folded
                      ? t(($) => $.notes.graph.outline.expand, { title: heading.text })
                      : t(($) => $.notes.graph.outline.collapse, { title: heading.text })
                  }
                  active={heading.index === active}
                  onSelect={() => go(heading)}
                  label={heading.text}
                  labelClassName={cn("text-sm", heading.level <= 2 && "text-foreground")}
                />
              </li>
            ))}
          </ul>
        </nav>
      )}
    </div>
  );
}
