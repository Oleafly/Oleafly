import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { subscribeEditorDocument } from "@oleafly/editor";
import { Popover, PopoverItem } from "@/components/ui/popover";
import { OutlineFileBadge } from "@/components/layout/OutlineFileBadge";
import {
  jumpToOutlineItem,
  useDocumentOutline,
  type DocumentOutlineModel,
} from "@/components/layout/use-document-outline";
import type { OutlineItem } from "@/lib/index/outline";
import { basename } from "@/lib/path-utils";
import { cn } from "@/lib/utils";
import { useFilesStore } from "@/store/files";
import { isOutlineDocument } from "./cm/outline-rail-clearance";

const OUTLINE_RAIL_MAX_MARKS = 32;
export const OUTLINE_RAIL_MIN_EDITOR_WIDTH = 360;

const MARK_WIDTH = ["w-3.5", "w-2.5", "w-1.5"] as const;
const CURRENT_ROW = '[data-outline-rail-list] [aria-current="location"]';
const ROW_INDENT = ["pl-2", "pl-6", "pl-10"] as const;

interface RailMarks {
  readonly depths: readonly number[];
  readonly shown: readonly number[];
  readonly markOf: readonly number[];
}

export function railMarks(items: readonly OutlineItem[], maxMarks = OUTLINE_RAIL_MAX_MARKS): RailMarks {
  if (items.length === 0) return { depths: [], shown: [], markOf: [] };
  const base = Math.min(...items.map((item) => item.level));
  const depths = items.map((item) => Math.min(2, item.level - base));
  const within = (deepest: number) => depths.filter((depth) => depth <= deepest).length <= maxMarks;
  const deepest = [2, 1].find(within) ?? 0;
  const shown: number[] = [];
  const markOf = depths.map((depth, index) => {
    if (depth <= deepest) shown.push(index);
    return shown.length - 1;
  });
  return { depths, shown, markOf };
}

interface EditorFrame {
  readonly panels: number;
  readonly narrow: boolean;
}

function useEditorFrame(): EditorFrame {
  const [frame, setFrame] = useState<EditorFrame>({ panels: 0, narrow: false });
  useEffect(() => {
    let observer: ResizeObserver | null = null;
    const unsubscribe = subscribeEditorDocument((_path, view) => {
      observer?.disconnect();
      observer = null;
      if (!view) return;
      const measure = () => {
        const scroller = view.scrollDOM;
        const panels = Math.max(
          0,
          Math.round(scroller.getBoundingClientRect().top - view.dom.getBoundingClientRect().top),
        );
        const narrow = scroller.clientWidth > 0 && scroller.clientWidth < OUTLINE_RAIL_MIN_EDITOR_WIDTH;
        setFrame((current) =>
          current.panels === panels && current.narrow === narrow ? current : { panels, narrow },
        );
      };
      observer = new ResizeObserver(measure);
      observer.observe(view.scrollDOM);
      measure();
    });
    return () => {
      unsubscribe();
      observer?.disconnect();
    };
  }, []);
  return frame;
}

function OutlineRailList({
  outline,
  depths,
  activePath,
}: Readonly<{ outline: DocumentOutlineModel; depths: readonly number[]; activePath: string }>) {
  const { t } = useTranslation(["workspace"]);
  const listRef = useRef<HTMLDivElement>(null);
  const { root, items, marks, activeIndex, title } = outline;

  useLayoutEffect(() => {
    const list = listRef.current;
    const current = list?.querySelector<HTMLElement>('[aria-current="location"]');
    if (list && current) list.scrollTop = current.offsetTop - (list.clientHeight - current.offsetHeight) / 2;
  }, []);

  return (
    <>
      <div className="flex items-center justify-between gap-3 px-2 pb-1 pt-1.5 text-xs text-muted-foreground">
        <span>{t(($) => $.workspace.outline.title)}</span>
        {root ? <span className="truncate">{basename(root)}</span> : null}
      </div>
      <div ref={listRef} data-outline-rail-list className="max-h-[min(60vh,28rem)] overflow-y-auto">
        {items.map((item, index) => {
          const depth = depths[index] ?? 0;
          const number = marks[index]?.number ?? null;
          const page = marks[index]?.page ?? null;
          const heading = number === null ? title(item) : `${number} ${title(item)}`;
          const current = index === activeIndex;
          return (
            <PopoverItem
              key={`${item.file}:${item.from}`}
              onClick={() => jumpToOutlineItem(item)}
              aria-current={current ? "location" : undefined}
              aria-label={page === null ? heading : t(($) => $.workspace.outline.onPage, { heading, page })}
              className={cn("gap-2 pr-2", ROW_INDENT[depth], current && "bg-accent text-accent-foreground")}
            >
              {number === null ? null : <span className="shrink-0 tabular-nums text-muted-foreground">{number}</span>}
              <span className={cn("min-w-0 flex-1 truncate", depth > 0 && !current && "text-muted-foreground")}>
                {title(item)}
              </span>
              {item.file === activePath ? null : <OutlineFileBadge file={item.file} />}
              {page === null ? null : (
                <span aria-hidden className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {t(($) => $.workspace.outline.page, { page })}
                </span>
              )}
            </PopoverItem>
          );
        })}
      </div>
    </>
  );
}

export function OutlineRail() {
  const { t } = useTranslation(["workspace"]);
  const activePath = useFilesStore((state) => state.activePath);
  const [open, setOpen] = useState(false);
  const outline = useDocumentOutline("document", open);
  const frame = useEditorFrame();
  const { depths, shown, markOf } = useMemo(() => railMarks(outline.items), [outline.items]);
  const hidden = !activePath || !isOutlineDocument(activePath) || frame.narrow || shown.length < 2;

  useEffect(() => {
    if (hidden) setOpen(false);
  }, [hidden]);

  if (hidden) return null;
  const currentMark = outline.activeIndex < 0 ? -1 : markOf[outline.activeIndex];
  const label = t(($) => $.workspace.outline.title);

  return (
    <div
      data-testid="outline-rail"
      className="pointer-events-none absolute right-3 bottom-0 z-10 flex items-center"
      style={{ top: frame.panels }}
    >
      <Popover
        openOnHover
        open={open}
        onOpenChange={setOpen}
        side="left"
        align="center"
        ariaLabel={label}
        contentAriaLabel={label}
        className="w-80 p-1"
        triggerClassName="pointer-events-auto h-auto flex-col items-end gap-1.5 px-1.5 py-2"
        onOpenAutoFocus={(event) => {
          const current = document.querySelector<HTMLElement>(CURRENT_ROW);
          if (!current) return;
          event.preventDefault();
          current.focus();
        }}
        trigger={shown.map((item, mark) => (
          <span
            key={`${outline.items[item].file}:${outline.items[item].from}`}
            data-current={mark === currentMark ? "" : undefined}
            className={cn(
              "h-0.5 shrink-0 rounded-full bg-muted-foreground/40",
              MARK_WIDTH[depths[item] ?? 0],
              mark === currentMark && "bg-primary",
            )}
          />
        ))}
      >
        <OutlineRailList outline={outline} depths={depths} activePath={activePath} />
      </Popover>
    </div>
  );
}
