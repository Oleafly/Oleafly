import { type RefObject, useLayoutEffect, useReducer, useRef } from "react";
import {
  type SidebarScrollSlot,
  readSidebarView,
  writeSidebarView,
} from "@/store/sidebar-view-state";

const SCROLL_TOLERANCE_PX = 1;

export interface ScrollMemory {
  readonly restore: () => boolean;
  readonly subscribe: (listener: () => void) => () => void;
}

class ScrollTracker implements ScrollMemory {
  scope = "";
  ready = true;
  private top: number;
  private pending: boolean;
  private element: HTMLElement | null = null;
  private frame = 0;
  private readonly listeners = new Set<() => void>();

  constructor(
    public scroller: RefObject<HTMLElement | null>,
    top: number,
  ) {
    this.top = top;
    this.pending = top > 0;
  }

  private readonly onScroll = () => {
    if (!this.pending && this.element) this.top = this.element.scrollTop;
  };

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  track(): HTMLElement | null {
    const next = this.scroller.current;
    if (next === this.element) return next;
    this.element?.removeEventListener("scroll", this.onScroll);
    this.element = next;
    next?.addEventListener("scroll", this.onScroll, { passive: true });
    if (next && this.top > 0) this.pending = true;
    return next;
  }

  readonly restore = (): boolean => {
    const element = this.track();
    if (!this.pending || !this.ready || !element) return false;
    if (element.scrollHeight - element.clientHeight < this.top - SCROLL_TOLERANCE_PX) {
      this.scheduleFallback();
      return false;
    }
    this.apply(element);
    return true;
  };

  retarget(top: number): void {
    this.top = top;
    this.pending = true;
    this.cancelFallback();
  }

  position(): number {
    const element = this.element;
    return element?.isConnected && !this.pending ? element.scrollTop : this.top;
  }

  release(): void {
    this.element?.removeEventListener("scroll", this.onScroll);
    this.element = null;
    this.cancelFallback();
  }

  private apply(element: HTMLElement): void {
    this.cancelFallback();
    this.pending = false;
    element.scrollTop = this.top;
    for (const listener of this.listeners) listener();
  }

  private scheduleFallback(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      const element = this.track();
      if (this.pending && this.ready && element) this.apply(element);
    });
  }

  private cancelFallback(): void {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
  }
}

export function useScrollMemory({
  scrollRef,
  projectId,
  slot,
  ready = true,
}: Readonly<{
  scrollRef: RefObject<HTMLElement | null>;
  projectId: string | null;
  slot: SidebarScrollSlot;
  ready?: boolean;
}>): ScrollMemory {
  const key = `scroll.${slot}` as const;
  const trackerRef = useRef<ScrollTracker | null>(null);
  trackerRef.current ??= new ScrollTracker(scrollRef, readSidebarView(projectId, key) ?? 0);
  const tracker = trackerRef.current;
  tracker.scroller = scrollRef;
  tracker.ready = ready;
  const scope = `${projectId ?? ""}\0${key}`;
  if (tracker.scope === "") tracker.scope = scope;

  useLayoutEffect(() => {
    if (tracker.scope !== scope) {
      tracker.scope = scope;
      tracker.retarget(readSidebarView(projectId, key) ?? 0);
    }
    tracker.track();
    return () => {
      writeSidebarView(projectId, key, tracker.position());
      tracker.release();
    };
  }, [key, projectId, scope, tracker]);

  useLayoutEffect(() => {
    tracker.restore();
  });

  return tracker;
}

export function useScrollMemoryLayout(memory: ScrollMemory | undefined): void {
  const [, remeasure] = useReducer((count: number) => count + 1, 0);
  useLayoutEffect(() => memory?.subscribe(remeasure), [memory]);
  useLayoutEffect(() => {
    memory?.restore();
  });
}
