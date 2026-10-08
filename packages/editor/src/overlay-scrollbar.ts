export type ScrollAxis = "x" | "y";

export interface OverlayScrollbarOptions {
  scroller: HTMLElement;
  host: HTMLElement;
  axes?: readonly ScrollAxis[];
  observe?: readonly HTMLElement[];
  zIndex?: number;
}

export interface OverlayScrollbarHandle {
  update(): void;
  observe(element: HTMLElement): void;
  destroy(): void;
}

export const OVERLAY_SCROLLBAR_ATTRIBUTE = "data-overlay-scrollbar";
export const NATIVE_SCROLLBAR_HIDDEN_CLASS = "ofl-native-scrollbar-hidden";

const BAR_SIZE = 10;
const THUMB_SIZE = 6;
const THUMB_SIZE_ACTIVE = 8;
const THUMB_INSET = 2;
const MIN_THUMB = 24;
const SCROLL_VISIBLE_MS = 900;
const THUMB_COLOR = "color-mix(in srgb, var(--muted-foreground) 42%, transparent)";
const THUMB_COLOR_ACTIVE = "color-mix(in srgb, var(--muted-foreground) 62%, transparent)";

export interface AxisMetrics {
  viewport: number;
  content: number;
  position: number;
  track: number;
  thumb: number;
  offset: number;
  maxScroll: number;
}

export function axisMetrics(
  viewport: number,
  content: number,
  position: number,
  track: number,
): AxisMetrics {
  const maxScroll = Math.max(0, content - viewport);
  if (maxScroll <= 0.5 || track <= 0) {
    return { viewport, content, position, track, thumb: 0, offset: 0, maxScroll: 0 };
  }
  const thumb = Math.min(track, Math.max(MIN_THUMB, Math.round((track * viewport) / content)));
  const travel = Math.max(0, track - thumb);
  const offset = travel * Math.min(1, Math.max(0, position / maxScroll));
  return { viewport, content, position, track, thumb, offset, maxScroll };
}

export function positionAt(metrics: AxisMetrics, offset: number): number {
  const travel = metrics.track - metrics.thumb;
  if (travel <= 0) return 0;
  return (Math.min(travel, Math.max(0, offset)) / travel) * metrics.maxScroll;
}

export function dragOffset(
  metrics: AxisMetrics,
  start: Readonly<{ offset: number; pointer: number }>,
  pointer: number,
): number {
  const travel = Math.max(0, metrics.track - metrics.thumb);
  return Math.min(travel, Math.max(0, start.offset + pointer - start.pointer));
}

export function trackOffset(metrics: AxisMetrics, pointerInTrack: number): number {
  const travel = Math.max(0, metrics.track - metrics.thumb);
  return Math.min(travel, Math.max(0, pointerInTrack - metrics.thumb / 2));
}

function readAxis(scroller: HTMLElement, axis: ScrollAxis, track: number): AxisMetrics {
  return axis === "y"
    ? axisMetrics(scroller.clientHeight, scroller.scrollHeight, scroller.scrollTop, track)
    : axisMetrics(scroller.clientWidth, scroller.scrollWidth, scroller.scrollLeft, track);
}

function writePosition(scroller: HTMLElement, axis: ScrollAxis, value: number) {
  if (axis === "y") scroller.scrollTop = value;
  else scroller.scrollLeft = value;
}

interface Bar {
  axis: ScrollAxis;
  track: HTMLDivElement;
  thumb: HTMLDivElement;
  metrics: AxisMetrics | null;
  drag: { pointerId: number; offset: number; pointer: number; current: number } | null;
  hovered: boolean;
}

function createBar(axis: ScrollAxis, zIndex: number): Bar {
  const track = document.createElement("div");
  track.setAttribute(OVERLAY_SCROLLBAR_ATTRIBUTE, axis);
  track.setAttribute("aria-hidden", "true");
  const ts = track.style;
  ts.position = "absolute";
  ts.zIndex = String(zIndex);
  ts.opacity = "0";
  ts.transition = "opacity 160ms ease-out";
  ts.touchAction = "none";
  ts.userSelect = "none";
  ts.webkitUserSelect = "none";
  ts.display = "none";
  ts.contain = "strict";
  const thumb = document.createElement("div");
  const s = thumb.style;
  s.position = "absolute";
  s.borderRadius = "999px";
  s.background = THUMB_COLOR;
  s.willChange = "transform";
  s.transition = "background-color 120ms ease-out, width 120ms ease-out, height 120ms ease-out";
  if (axis === "y") {
    s.top = "0";
    s.right = `${THUMB_INSET}px`;
    s.width = `${THUMB_SIZE}px`;
  } else {
    s.left = "0";
    s.bottom = `${THUMB_INSET}px`;
    s.height = `${THUMB_SIZE}px`;
  }
  track.appendChild(thumb);
  return { axis, track, thumb, metrics: null, drag: null, hovered: false };
}

export function attachOverlayScrollbar(options: OverlayScrollbarOptions): OverlayScrollbarHandle {
  const { scroller, host } = options;
  const axes = options.axes ?? ["y"];
  const bars = axes.map((axis) => createBar(axis, options.zIndex ?? 11));
  for (const bar of bars) host.appendChild(bar.track);
  scroller.classList.add(NATIVE_SCROLLBAR_HIDDEN_CLASS);

  let hostHovered = false;
  let scrolledUntil = 0;
  let fadeTimer: ReturnType<typeof setTimeout> | null = null;
  let frame = 0;
  let destroyed = false;
  let box = { top: 0, left: 0, width: 0, height: 0 };

  const active = (bar: Bar) => bar.drag !== null || bar.hovered;

  const paintThumb = (bar: Bar, offset = bar.metrics?.offset ?? 0) => {
    const m = bar.metrics;
    if (!m || m.thumb <= 0) return;
    const size = active(bar) ? THUMB_SIZE_ACTIVE : THUMB_SIZE;
    const s = bar.thumb.style;
    s.background = active(bar) ? THUMB_COLOR_ACTIVE : THUMB_COLOR;
    if (bar.axis === "y") {
      s.height = `${m.thumb}px`;
      s.width = `${size}px`;
      s.transform = `translate3d(0, ${offset}px, 0)`;
    } else {
      s.width = `${m.thumb}px`;
      s.height = `${size}px`;
      s.transform = `translate3d(${offset}px, 0, 0)`;
    }
  };

  const paintVisibility = () => {
    const now = Date.now();
    for (const bar of bars) {
      const shown =
        bar.metrics !== null &&
        bar.metrics.thumb > 0 &&
        (hostHovered || bar.drag !== null || now < scrolledUntil);
      bar.track.style.opacity = shown ? "1" : "0";
      bar.track.style.pointerEvents = bar.metrics && bar.metrics.thumb > 0 ? "auto" : "none";
    }
  };

  const layoutBars = () => {
    const both = bars.length > 1 && bars.every((bar) => bar.metrics && bar.metrics.thumb > 0);
    for (const bar of bars) {
      const t = bar.track.style;
      const visible = bar.metrics !== null && bar.metrics.thumb > 0;
      t.display = visible ? "block" : "none";
      if (bar.axis === "y") {
        t.top = `${box.top}px`;
        t.left = `${box.left + box.width - BAR_SIZE}px`;
        t.width = `${BAR_SIZE}px`;
        t.height = `${Math.max(0, box.height - (both ? BAR_SIZE : 0))}px`;
      } else {
        t.top = `${box.top + box.height - BAR_SIZE}px`;
        t.left = `${box.left}px`;
        t.height = `${BAR_SIZE}px`;
        t.width = `${Math.max(0, box.width - (both ? BAR_SIZE : 0))}px`;
      }
    }
  };

  const measure = () => {
    if (destroyed) return;
    const container =
      getComputedStyle(host).position === "static"
        ? ((host.offsetParent as HTMLElement | null) ?? document.body)
        : host;
    if (scroller.offsetParent === container) {
      box = {
        top: scroller.offsetTop,
        left: scroller.offsetLeft,
        width: scroller.offsetWidth,
        height: scroller.offsetHeight,
      };
    } else {
      const containerRect = container.getBoundingClientRect();
      const rect = scroller.getBoundingClientRect();
      box = {
        top: rect.top - containerRect.top - container.clientTop + container.scrollTop,
        left: rect.left - containerRect.left - container.clientLeft + container.scrollLeft,
        width: scroller.offsetWidth,
        height: scroller.offsetHeight,
      };
    }
    const both = bars.length > 1;
    for (const bar of bars) {
      const length = bar.axis === "y" ? box.height : box.width;
      const reserve = both ? BAR_SIZE : 0;
      bar.metrics = readAxis(scroller, bar.axis, Math.max(0, length - reserve));
    }
    if (both && !bars.every((bar) => bar.metrics && bar.metrics.thumb > 0)) {
      for (const bar of bars) {
        const length = bar.axis === "y" ? box.height : box.width;
        bar.metrics = readAxis(scroller, bar.axis, length);
      }
    }
    layoutBars();
    for (const bar of bars) paintThumb(bar, bar.drag?.current ?? bar.metrics?.offset);
    paintVisibility();
  };

  const schedule = () => {
    if (frame || destroyed) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      measure();
    });
  };

  const showWhileScrolling = () => {
    scrolledUntil = Date.now() + SCROLL_VISIBLE_MS;
    if (fadeTimer !== null) clearTimeout(fadeTimer);
    fadeTimer = setTimeout(() => {
      fadeTimer = null;
      paintVisibility();
    }, SCROLL_VISIBLE_MS + 20);
  };

  const onScroll = () => {
    showWhileScrolling();
    schedule();
  };

  const onHostEnter = () => {
    hostHovered = true;
    schedule();
  };
  const onHostLeave = () => {
    hostHovered = false;
    paintVisibility();
  };

  const listeners: Array<() => void> = [];
  const listen = <K extends keyof HTMLElementEventMap>(
    target: HTMLElement,
    type: K,
    handler: (event: HTMLElementEventMap[K]) => void,
    opts?: AddEventListenerOptions,
  ) => {
    target.addEventListener(type, handler as EventListener, opts);
    listeners.push(() => target.removeEventListener(type, handler as EventListener, opts));
  };

  listen(scroller, "scroll", onScroll, { passive: true });
  listen(host, "pointerenter", onHostEnter);
  listen(host, "pointerleave", onHostLeave);

  for (const bar of bars) {
    const pointerCoordinate = (event: PointerEvent) => (bar.axis === "y" ? event.clientY : event.clientX);
    const trackStart = () => {
      const rect = bar.track.getBoundingClientRect();
      return bar.axis === "y" ? rect.top : rect.left;
    };
    const finish = (event: PointerEvent) => {
      if (!bar.drag || bar.drag.pointerId !== event.pointerId) return;
      bar.drag = null;
      if (bar.track.hasPointerCapture(event.pointerId)) bar.track.releasePointerCapture(event.pointerId);
      showWhileScrolling();
      measure();
    };
    listen(bar.track, "pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      measure();
      const metrics = bar.metrics;
      if (!metrics || metrics.thumb <= 0) return;
      const pointer = pointerCoordinate(event);
      const inTrack = pointer - trackStart();
      const onThumb = inTrack >= metrics.offset && inTrack <= metrics.offset + metrics.thumb;
      const offset = onThumb ? metrics.offset : trackOffset(metrics, inTrack);
      if (!onThumb) writePosition(scroller, bar.axis, positionAt(metrics, offset));
      bar.drag = { pointerId: event.pointerId, offset, pointer, current: offset };
      bar.track.setPointerCapture(event.pointerId);
      paintThumb(bar, offset);
      paintVisibility();
    });
    listen(bar.track, "pointermove", (event) => {
      const drag = bar.drag;
      const metrics = bar.metrics;
      if (!drag || drag.pointerId !== event.pointerId || !metrics) return;
      event.preventDefault();
      const offset = dragOffset(metrics, drag, pointerCoordinate(event));
      drag.current = offset;
      writePosition(scroller, bar.axis, positionAt(metrics, offset));
      paintThumb(bar, offset);
    });
    listen(bar.track, "pointerup", finish);
    listen(bar.track, "pointercancel", finish);
    listen(bar.track, "lostpointercapture", (event) => finish(event));
    listen(bar.track, "pointerenter", () => {
      bar.hovered = true;
      paintThumb(bar);
    });
    listen(bar.track, "pointerleave", () => {
      bar.hovered = false;
      paintThumb(bar);
    });
  }

  const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
  resize?.observe(scroller);
  for (const element of options.observe ?? []) resize?.observe(element);

  measure();

  return {
    update: schedule,
    observe(element) {
      resize?.observe(element);
    },
    destroy() {
      destroyed = true;
      if (frame) cancelAnimationFrame(frame);
      if (fadeTimer !== null) clearTimeout(fadeTimer);
      resize?.disconnect();
      for (const remove of listeners) remove();
      for (const bar of bars) bar.track.remove();
      scroller.classList.remove(NATIVE_SCROLLBAR_HIDDEN_CLASS);
    },
  };
}
