import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { Popover, PopoverItem } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const OUTLINE_RAIL_MAX_MARKS = 32;
export const OUTLINE_RAIL_ROOM_PX = 40;

const MARK_WIDTH = ["w-3.5", "w-2.5", "w-1.5"] as const;
const CURRENT_ROW = '[data-outline-rail-list] [aria-current="location"]';
const ROW_INDENT = ["pl-2", "pl-6", "pl-10"] as const;

interface Leveled {
  readonly level: number;
}

interface RailMarks {
  readonly depths: readonly number[];
  readonly shown: readonly number[];
  readonly markOf: readonly number[];
}

export function railMarks(items: readonly Leveled[], maxMarks = OUTLINE_RAIL_MAX_MARKS): RailMarks {
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

export interface OutlineRailRow {
  readonly label: string;
  readonly ariaLabel?: string;
  readonly leading?: ReactNode;
  readonly trailing?: ReactNode;
  readonly onSelect: () => void;
}

interface OutlineRailProps<Item extends Leveled> {
  readonly items: readonly Item[];
  readonly itemKey: (item: Item) => string;
  readonly row: (item: Item, index: number) => OutlineRailRow;
  readonly activeIndex: number;
  readonly title: string;
  readonly source?: string | null;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly hidden?: boolean;
  readonly top?: number;
}

function OutlineRailList<Item extends Leveled>({
  items,
  itemKey,
  row,
  depths,
  activeIndex,
  title,
  source,
}: Readonly<{
  items: readonly Item[];
  itemKey: (item: Item) => string;
  row: (item: Item, index: number) => OutlineRailRow;
  depths: readonly number[];
  activeIndex: number;
  title: string;
  source?: string | null;
}>) {
  const listRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const list = listRef.current;
    const current = list?.querySelector<HTMLElement>('[aria-current="location"]');
    if (list && current) list.scrollTop = current.offsetTop - (list.clientHeight - current.offsetHeight) / 2;
  }, []);

  return (
    <>
      <div className="flex items-center justify-between gap-3 px-2 pb-1 pt-1.5 text-xs text-muted-foreground">
        <span>{title}</span>
        {source ? <span className="truncate">{source}</span> : null}
      </div>
      <div ref={listRef} data-outline-rail-list className="max-h-[min(60vh,28rem)] overflow-y-auto">
        {items.map((item, index) => {
          const depth = depths[index] ?? 0;
          const current = index === activeIndex;
          const { label, ariaLabel, leading, trailing, onSelect } = row(item, index);
          return (
            <PopoverItem
              key={itemKey(item)}
              onClick={onSelect}
              aria-current={current ? "location" : undefined}
              aria-label={ariaLabel}
              className={cn("gap-2 pr-2", ROW_INDENT[depth], current && "bg-accent text-accent-foreground")}
            >
              {leading}
              <span className={cn("min-w-0 flex-1 truncate", depth > 0 && !current && "text-muted-foreground")}>
                {label}
              </span>
              {trailing}
            </PopoverItem>
          );
        })}
      </div>
    </>
  );
}

export function OutlineRail<Item extends Leveled>({
  items,
  itemKey,
  row,
  activeIndex,
  title,
  source,
  open,
  onOpenChange,
  hidden = false,
  top = 0,
}: OutlineRailProps<Item>) {
  const { depths, shown, markOf } = useMemo(() => railMarks(items), [items]);
  const gone = hidden || shown.length < 2;

  useEffect(() => {
    if (gone && open) onOpenChange(false);
  }, [gone, open, onOpenChange]);

  if (gone) return null;
  const currentMark = activeIndex < 0 ? -1 : markOf[activeIndex];

  return (
    <div
      data-testid="outline-rail"
      className="pointer-events-none absolute right-3 bottom-0 z-10 flex items-center"
      style={{ top }}
    >
      <Popover
        openOnHover
        open={open}
        onOpenChange={onOpenChange}
        side="left"
        align="center"
        ariaLabel={title}
        contentAriaLabel={title}
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
            key={itemKey(items[item])}
            data-current={mark === currentMark ? "" : undefined}
            className={cn(
              "h-0.5 shrink-0 rounded-full bg-muted-foreground/40",
              MARK_WIDTH[depths[item] ?? 0],
              mark === currentMark && "bg-primary",
            )}
          />
        ))}
      >
        <OutlineRailList
          items={items}
          itemKey={itemKey}
          row={row}
          depths={depths}
          activeIndex={activeIndex}
          title={title}
          source={source}
        />
      </Popover>
    </div>
  );
}
