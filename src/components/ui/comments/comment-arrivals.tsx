import { ArrowDown, ArrowUp } from "lucide-react";
import {
  createContext,
  type ReactNode,
  type Ref,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";

export interface CommentArrival {
  id: string;
  mine: boolean;
  at: number;
  group?: string;
}

export const ARRIVAL_SEEN_MS = 4_000;
const CLOCK_SLACK_MS = 30_000;
const BOTTOM_SLACK_PX = 24;
const OPENED_MS = 1_000;
const WAIT_MS = 5_000;
const CLICK_MS = 300;
const ITEMS = "[data-comment-entry], [data-comment-thread]";

interface ArrivalContext {
  fresh: ReadonlySet<string>;
  observe: (id: string, element: HTMLElement | null) => void;
}

const Arrivals = createContext<ArrivalContext | null>(null);

export function newArrivals(
  known: ReadonlySet<string>,
  items: readonly CommentArrival[],
  since: number,
  groups: ReadonlySet<string> = new Set(),
): string[] {
  return items
    .filter(
      (item) =>
        !item.mine &&
        !known.has(item.id) &&
        item.at >= since - CLOCK_SLACK_MS &&
        (item.group === undefined || groups.has(item.group)),
    )
    .map((item) => item.id);
}

function groupsOf(items: readonly CommentArrival[]): Set<string> {
  return new Set(items.flatMap((item) => (item.group === undefined ? [] : [item.group])));
}

function atBottom(element: HTMLElement): boolean {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= BOTTOM_SLACK_PX;
}

function reducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

interface Anchor {
  element: Element;
  top: number;
}

interface Box {
  top: number;
  bottom: number;
}

interface Touch {
  start: number;
  clicked: number;
  settled: number | null;
  edge: number;
  top: boolean;
  control: Element;
  boxes: Map<Element, Box>;
  region: { id: string; height: number } | null;
}

interface Kept extends Anchor {
  own: boolean;
}

const CONTROLS = "button, a[href], input, select, textarea, summary, [role='button'], [contenteditable='true']";
const BUSY = '[aria-busy="true"]';

function boxOf(element: Element): Box {
  const rect = element.getBoundingClientRect();
  return { top: rect.top, bottom: rect.bottom };
}

function spaceOf(element: Element | null): number {
  if (!element) return 0;
  const box = boxOf(element);
  const style = getComputedStyle(element);
  return box.bottom - box.top + (Number.parseFloat(style.marginTop) || 0) + (Number.parseFloat(style.marginBottom) || 0);
}

function before(first: Element, second: Element): boolean {
  return Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);
}

function apart(first: Element, second: Element): boolean {
  return before(first, second) && !first.contains(second);
}

function measure(touch: Touch, container: HTMLElement): void {
  touch.edge = container.getBoundingClientRect().top;
  touch.top = container.scrollTop <= 0;
  for (const node of touch.boxes.keys()) touch.boxes.set(node, boxOf(node));
  if (touch.region) touch.region.height = spaceOf(document.getElementById(touch.region.id));
}

function touchOf(content: HTMLElement, container: HTMLElement, target: EventTarget, previous: Touch | null, click: boolean): Touch | null {
  const now = performance.now();
  if (!(target instanceof Element) || !content.contains(target)) return previous && { ...previous, start: now, settled: null };
  const boxes = new Map<Element, Box>();
  for (let node: Element | null = target; node && node !== content; node = node.parentElement) boxes.set(node, { top: 0, bottom: 0 });
  const found = target.closest(CONTROLS);
  const control = found && content.contains(found) ? found : target;
  const id = click ? control.closest("[aria-controls]")?.getAttribute("aria-controls")?.split(/\s+/u)[0] : undefined;
  const touch: Touch = {
    start: now,
    clicked: click ? now : Number.NEGATIVE_INFINITY,
    settled: null,
    edge: 0,
    top: true,
    control,
    boxes,
    region: id ? { id, height: 0 } : null,
  };
  measure(touch, container);
  return touch;
}

function change(touch: Touch, node: Element, side: (box: Box) => number): number {
  const previous = touch.boxes.get(node);
  return previous ? side(boxOf(node)) - side(previous) : 0;
}

function userMove(touch: Touch | null, anchor: Element, edge: number): { user: number; busy: boolean } {
  const none = { user: 0, busy: false };
  if (!touch) return none;
  const now = performance.now();
  if (touch.settled === null ? now - touch.start > WAIT_MS : now - touch.settled > OPENED_MS) return none;
  const chain = [...touch.boxes.keys()].filter((node) => node.isConnected);
  const point = chain[0];
  if (!point) return none;
  let user = 0;
  const region = touch.region && now - touch.clicked <= CLICK_MS ? document.getElementById(touch.region.id) : null;
  if (touch.region && region && apart(region, point) && !apart(anchor, point)) user += Math.max(0, spaceOf(region) - touch.region.height);
  const inside = chain.findIndex((node) => node.contains(anchor));
  const block = chain[(inside < 0 ? chain.length : inside) - 1];
  if (block && before(block, anchor) && boxOf(point).bottom > edge) {
    user += change(touch, block, (box) => box.bottom) - change(touch, point, (box) => box.top);
  }
  return { user, busy: Boolean(block && (block.matches(BUSY) || block.querySelector(BUSY))) };
}

function steadiest(live: readonly Anchor[]): { anchor: Anchor; reordered: boolean } {
  const outer = live.filter((anchor) => !live.some((other) => other !== anchor && other.element.contains(anchor.element)));
  if (outer.every((anchor, index) => index === 0 || before(outer[index - 1].element, anchor.element))) {
    return { anchor: live[0], reordered: false };
  }
  const counts = outer.map(
    (anchor, index) => outer.filter((other, at) => at !== index && at < index !== before(other.element, anchor.element)).length,
  );
  return { anchor: outer[counts.indexOf(Math.min(...counts))], reordered: true };
}

function keptAnchor(anchors: readonly Anchor[], touch: Touch | null, container: HTMLElement): Kept | null {
  const point = touch ? [...touch.boxes.keys()].find((node) => node.isConnected) : undefined;
  const box = touch && point ? touch.boxes.get(point) : undefined;
  const view = boxOf(container);
  const own = touch && !touch.top && point && box && box.bottom > touch.edge && box.top < touch.edge + view.bottom - view.top ? { element: point, top: box.top - touch.edge, own: true } : null;
  const live = anchors.filter((anchor) => anchor.element.isConnected);
  if (live.length === 0) return own;
  const { anchor, reordered } = steadiest(live);
  return reordered && own ? own : { ...anchor, own: false };
}

function onScreen(container: HTMLElement, element: HTMLElement): boolean {
  const box = container.getBoundingClientRect();
  const rect = element.getBoundingClientRect();
  return rect.bottom > box.top && rect.top < box.bottom;
}

function anchorsIn(container: HTMLElement): Anchor[] {
  if (container.scrollTop <= 0) return [];
  const box = container.getBoundingClientRect();
  const found: Anchor[] = [];
  let straddling: Element | null = null;
  for (const element of container.querySelectorAll(ITEMS)) {
    const rect = element.getBoundingClientRect();
    if (rect.top >= box.top) {
      found.push({ element, top: rect.top - box.top });
      if (rect.top >= box.bottom) break;
    } else if (found.length === 0 && rect.bottom > box.top) straddling = element;
  }
  if (found.length > 0) return found;
  let element = straddling;
  for (let inner = element; inner; ) {
    element = inner;
    const child = Array.from(inner.children).find((next) => next.getBoundingClientRect().bottom > box.top);
    inner = child && child.getBoundingClientRect().top < box.top ? child : null;
    if (child && !inner) element = child;
  }
  return element ? [{ element, top: element.getBoundingClientRect().top - box.top }] : [];
}

export function CommentScrollArea({
  items,
  ready,
  label,
  className,
  scrollRef,
  stickToBottom = false,
  scope = "",
  children,
}: Readonly<{
  items: readonly CommentArrival[];
  ready: boolean;
  label: (count: number) => string;
  className?: string;
  scrollRef?: Ref<HTMLDivElement>;
  stickToBottom?: boolean;
  scope?: string;
  children: ReactNode;
}>) {
  const container = useRef<HTMLDivElement | null>(null);
  const content = useRef<HTMLDivElement | null>(null);
  const known = useRef<Set<string> | null>(null);
  const groups = useRef<Set<string>>(new Set());
  const seededScope = useRef(scope);
  const since = useRef(0);
  const bottom = useRef(true);
  const anchors = useRef<Anchor[]>([]);
  const touched = useRef<Touch | null>(null);
  const elements = useRef(new Map<string, HTMLElement>());
  const seenAt = useRef(new Map<string, number>());
  const [fresh, setFresh] = useState<ReadonlySet<string>>(() => new Set());
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());
  const observer = useRef<IntersectionObserver | null>(null);

  const keepPlace = useCallback((force = false) => {
    const element = container.current;
    if (!element) return;
    const edge = element.getBoundingClientRect().top;
    const touch = touched.current;
    const kept = keptAnchor(anchors.current, touch, element);
    if (stickToBottom && (bottom.current || force)) {
      element.scrollTop = element.scrollHeight;
    } else if (kept) {
      const moved = kept.element.getBoundingClientRect().top - edge - kept.top;
      const { user, busy } = kept.own ? { user: 0, busy: false } : userMove(touch, kept.element, edge);
      const exempt = Math.sign(user) === Math.sign(moved) ? Math.sign(moved) * Math.min(Math.abs(user), Math.abs(moved)) : 0;
      if (Math.abs(moved - exempt) > 0.5) element.scrollTop += moved - exempt;
      if (touch && touch.settled === null && Math.abs(exempt) > 0.5 && !busy) touch.settled = performance.now();
    }
    anchors.current = anchorsIn(element);
    if (touch?.control.isConnected) measure(touch, element);
    else if (touch) touched.current = content.current && document.activeElement ? touchOf(content.current, element, document.activeElement, null, false) : null;
  }, [stickToBottom]);

  const changes = useMemo(() => {
    const none = { added: [] as string[], arrived: [] as string[], mine: false };
    if (!ready || known.current === null || seededScope.current !== scope) return none;
    const seen = known.current;
    const unseen = items.filter((item) => !seen.has(item.id));
    return {
      added: unseen.map((item) => item.id),
      arrived: newArrivals(seen, items, since.current, groups.current),
      mine: unseen.some((item) => item.mine),
    };
  }, [items, ready, scope]);

  useLayoutEffect(() => {
    if (!ready) return;
    const element = container.current;
    if (known.current === null || seededScope.current !== scope) {
      const reseeded = known.current !== null;
      known.current = new Set(items.map((item) => item.id));
      groups.current = groupsOf(items);
      seededScope.current = scope;
      since.current = Date.now();
      if (reseeded) {
        setFresh(new Set());
        setHidden(new Set());
      }
      if (element && stickToBottom) element.scrollTop = element.scrollHeight;
      anchors.current = element ? anchorsIn(element) : [];
      return;
    }
    const { added, arrived, mine } = changes;
    for (const id of added) known.current.add(id);
    groups.current = groupsOf(items);
    keepPlace(mine);
    if (arrived.length === 0) return;
    const now = Date.now();
    const away = arrived.filter((id) => {
      const item = elements.current.get(id);
      const visible = element !== null && item !== undefined && onScreen(element, item);
      if (visible) seenAt.current.set(id, now);
      return !visible;
    });
    setFresh((current) => new Set([...current, ...arrived]));
    if (away.length > 0) setHidden((current) => new Set([...current, ...away]));
  }, [items, ready, changes, stickToBottom, scope, keepPlace]);

  useEffect(() => {
    const element = content.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const watch = new ResizeObserver(() => keepPlace());
    watch.observe(element);
    return () => watch.disconnect();
  }, [keepPlace]);

  const forget = useCallback((id: string) => {
    setFresh((current) => {
      if (!current.has(id)) return current;
      const next = new Set(current);
      next.delete(id);
      return next;
    });
    seenAt.current.delete(id);
  }, []);

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const watch = new IntersectionObserver(
      (entries) => {
        setHidden((current) => {
          let next: Set<string> | null = null;
          for (const entry of entries) {
            const id = (entry.target as HTMLElement).dataset.arrivalId;
            if (!id) continue;
            if (entry.isIntersecting) {
              if (!seenAt.current.has(id)) seenAt.current.set(id, Date.now());
              if (current.has(id)) {
                next ??= new Set(current);
                next.delete(id);
              }
            }
          }
          return next ?? current;
        });
      },
      { root: container.current, threshold: 0.6 },
    );
    observer.current = watch;
    for (const element of elements.current.values()) watch.observe(element);
    return () => {
      watch.disconnect();
      observer.current = null;
    };
  }, []);

  useEffect(() => {
    const visible = [...fresh].filter((id) => !hidden.has(id));
    if (visible.length === 0) return;
    const timers = visible.map((id) => {
      const since = seenAt.current.get(id) ?? Date.now();
      return setTimeout(() => forget(id), Math.max(0, since + ARRIVAL_SEEN_MS - Date.now()));
    });
    return () => {
      for (const timer of timers) clearTimeout(timer);
    };
  }, [fresh, hidden, forget]);

  const observe = useCallback((id: string, element: HTMLElement | null) => {
    const previous = elements.current.get(id);
    if (previous && previous !== element) observer.current?.unobserve(previous);
    if (!element) {
      elements.current.delete(id);
      return;
    }
    element.dataset.arrivalId = id;
    elements.current.set(id, element);
    observer.current?.observe(element);
    if (!previous) setHidden((current) => (current.has(id) ? new Set(current) : current));
  }, []);

  const waiting = [...fresh].filter((id) => hidden.has(id) && elements.current.has(id));
  const target = waiting[0] ? elements.current.get(waiting[0]) : undefined;
  const above = (() => {
    const element = container.current;
    if (!element || !target) return true;
    return target.getBoundingClientRect().top < element.getBoundingClientRect().top;
  })();
  const Icon = above ? ArrowUp : ArrowDown;
  const context = useMemo(() => ({ fresh, observe }), [fresh, observe]);

  const touch = (event: { target: EventTarget; type: string }) => {
    if (content.current && container.current) touched.current = touchOf(content.current, container.current, event.target, touched.current, event.type === "click");
  };

  const setContainer = (element: HTMLDivElement | null) => {
    container.current = element;
    if (typeof scrollRef === "function") scrollRef(element);
    else if (scrollRef) (scrollRef as { current: HTMLDivElement | null }).current = element;
  };

  return (
    <Arrivals.Provider value={context}>
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          ref={setContainer}
          onScroll={(event) => {
            anchors.current = anchorsIn(event.currentTarget);
            bottom.current = atBottom(event.currentTarget);
            if (touched.current) measure(touched.current, event.currentTarget);
          }}
          className="min-h-0 flex-1 overflow-y-auto [overflow-anchor:none]"
        >
          <div
            ref={content}
            className={className}
            onPointerDownCapture={touch}
            onKeyDownCapture={touch}
            onClickCapture={touch}
          >
            {children}
          </div>
        </div>
        {target ? (
          <div className="pointer-events-none absolute inset-x-0 top-2.5 z-10 flex justify-center">
            <Button
              type="button"
              size="sm"
              className="pointer-events-auto h-7 gap-1.5 rounded-full bg-foreground text-[0.78125rem] font-medium text-background shadow-md hover:bg-foreground/90 focus-visible:bg-foreground/80 [&_svg]:size-[0.8125rem]"
              onClick={() => target.scrollIntoView({ block: "center", behavior: reducedMotion() ? "auto" : "smooth" })}
            >
              <Icon aria-hidden />
              {label(waiting.length)}
            </Button>
          </div>
        ) : null}
      </div>
    </Arrivals.Provider>
  );
}

const NO_FRESH: ReadonlySet<string> = new Set();

export function useFreshIds(): ReadonlySet<string> {
  return useContext(Arrivals)?.fresh ?? NO_FRESH;
}

export function useArrival(id: string): { fresh: boolean; ref?: (element: HTMLElement | null) => void } {
  const context = useContext(Arrivals);
  const observe = context?.observe;
  const ref = useCallback((element: HTMLElement | null) => observe?.(id, element), [observe, id]);
  if (!context) return { fresh: false };
  return { fresh: context.fresh.has(id), ref };
}
