import { Fragment, type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { isoTime, useCommentKit } from "./comment-kit";
import { watchSize } from "./comment-resize";

const HEADER_ACTIONS =
  "absolute inset-y-0 end-0 my-auto flex h-6 items-center rounded-md has-[button]:bg-accent opacity-0 transition-opacity group-hover/item:opacity-100 has-[:focus-visible]:opacity-100 has-[[data-state=open]]:opacity-100 [@media(hover:none)]:opacity-100";

export const META = "text-[0.6875rem] text-foreground/60";

const NO_ROOM = { above: false, below: false };

function textRects(element: Element | null | undefined): DOMRect[] {
  const range = document.createRange();
  if (!element || typeof range.getClientRects !== "function") return [];
  const rects: DOMRect[] = [];
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    range.selectNodeContents(node);
    rects.push(...range.getClientRects());
  }
  return rects;
}

function covers(pill: DOMRect, line: DOMRect, shift: number): boolean {
  const width = Math.min(pill.right, line.right) - Math.max(pill.left, line.left);
  const height = Math.min(pill.bottom, line.bottom + shift) - Math.max(pill.top, line.top + shift);
  return width > 0.5 && height > 0.5;
}

function pillRoom(row: HTMLElement): typeof NO_ROOM {
  const tail = row.lastElementChild;
  const before = tail?.previousElementSibling;
  const pill = tail?.lastElementChild?.firstElementChild;
  if (!tail || !pill) return NO_ROOM;
  const style = getComputedStyle(tail);
  const box = pill.getBoundingClientRect();
  const next = row.nextElementSibling;
  const under = Boolean(before) && tail.getBoundingClientRect().top >= (before?.getBoundingClientRect().bottom ?? 0) - 1;
  return {
    above: under && textRects(before).some((line) => covers(box, line, Number.parseFloat(style.marginTop) || 0)),
    below: textRects(next?.firstElementChild ?? next).some((line) => covers(box, line, -(Number.parseFloat(style.marginBottom) || 0))),
  };
}

export function usePillRoom<T extends HTMLElement>(enabled: boolean, layout: string) {
  const ref = useRef<T>(null);
  const kit = useCommentKit();
  const [room, setRoom] = useState(NO_ROOM);
  const measure = useCallback(() => {
    const next = enabled && ref.current ? pillRoom(ref.current) : NO_ROOM;
    setRoom((current) => (current.above === next.above && current.below === next.below ? current : next));
  }, [enabled]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the kit's labels and clock and the row's own text are what can rewrap it, so a change in any of them measures it again.
  useLayoutEffect(measure, [measure, kit, layout]);
  useEffect(() => {
    const row = ref.current;
    if (!enabled || !row) return;
    return watchSize(row, measure);
  }, [enabled, measure]);
  return { ref, room };
}

export function withActions(node: ReactNode, actions: ReactNode, wide: boolean, room?: string): ReactNode {
  if (!actions) return node;
  return (
    <span className={cn("flex min-w-0 max-w-full grow items-center", room)}>
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
  const { ref, room } = usePillRoom<HTMLSpanElement>(Boolean(actions) && !alone, `${name}\u0000${at}\u0000${editedAt}\u0000${badged}\u0000${wide}`);
  return (
    <span ref={ref} className={cn("flex min-w-0 flex-wrap items-baseline gap-x-1.5", className)}>
      {items}
      {withActions(last, actions, wide, cn(room.above && (badged ? "mt-0.5" : "mt-1"), room.below && "mb-0.5"))}
    </span>
  );
}
