// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  attachOverlayScrollbar,
  axisMetrics,
  dragOffset,
  NATIVE_SCROLLBAR_HIDDEN_CLASS,
  OVERLAY_SCROLLBAR_ATTRIBUTE,
  positionAt,
  trackOffset,
} from "./overlay-scrollbar";

describe("axisMetrics", () => {
  it("sizes the thumb by the visible share of the content", () => {
    expect(axisMetrics(200, 800, 0, 200)).toMatchObject({ thumb: 50, offset: 0, maxScroll: 600 });
  });

  it("keeps a minimum thumb and maps the position onto the remaining travel", () => {
    const metrics = axisMetrics(200, 20_000, 9_900, 200);
    expect(metrics.thumb).toBe(24);
    expect(metrics.offset).toBeCloseTo((176 * 9_900) / 19_800);
  });

  it("has no thumb when the content fits", () => {
    expect(axisMetrics(200, 200, 0, 200).thumb).toBe(0);
    expect(axisMetrics(200, 150, 0, 200).thumb).toBe(0);
  });
});

describe("dragOffset and positionAt", () => {
  const metrics = axisMetrics(200, 2_000, 0, 200);

  it("keeps the grabbed point of the thumb under the pointer", () => {
    expect(dragOffset(metrics, { offset: 0, pointer: 10 }, 98)).toBe(88);
    expect(positionAt(metrics, 88)).toBeCloseTo(900);
  });

  it("clamps the thumb to the track and the content to its range", () => {
    expect(dragOffset(metrics, { offset: 0, pointer: 10 }, -500)).toBe(0);
    expect(dragOffset(metrics, { offset: 0, pointer: 10 }, 5_000)).toBe(176);
    expect(positionAt(metrics, 176)).toBe(1_800);
  });

  it("does not move the thumb back until the pointer returns from past the end", () => {
    expect(dragOffset(metrics, { offset: 100, pointer: 110 }, 400)).toBe(176);
    expect(dragOffset(metrics, { offset: 100, pointer: 110 }, 190)).toBe(176);
    expect(dragOffset(metrics, { offset: 100, pointer: 110 }, 180)).toBe(170);
  });

  it("maps the same thumb offset onto the content height measured now", () => {
    const taller = axisMetrics(200, 2_200, 0, 200);
    expect(positionAt(taller, 88)).toBeCloseTo((88 / (200 - taller.thumb)) * 2_000);
  });
});

describe("trackOffset", () => {
  it("centres the thumb on the pressed point of the track", () => {
    const metrics = axisMetrics(200, 2_000, 0, 200);
    expect(trackOffset(metrics, 150)).toBe(138);
    expect(trackOffset(metrics, 0)).toBe(0);
    expect(trackOffset(metrics, 400)).toBe(176);
  });
});

function pointer(type: string, init: { clientY: number; pointerId?: number; button?: number }) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientY: init.clientY, button: init.button ?? 0 });
  Object.defineProperty(event, "pointerId", { value: init.pointerId ?? 1 });
  return event;
}

describe("attachOverlayScrollbar", () => {
  let scrollTop = 0;
  let frames: FrameRequestCallback[] = [];
  let host: HTMLDivElement;
  let scroller: HTMLDivElement;

  const flushFrames = () => {
    for (const frame of frames.splice(0)) frame(0);
  };

  beforeEach(() => {
    scrollTop = 0;
    frames = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    host = document.createElement("div");
    scroller = document.createElement("div");
    host.appendChild(scroller);
    document.body.appendChild(host);
    Object.defineProperty(scroller, "clientHeight", { configurable: true, get: () => 200 });
    Object.defineProperty(scroller, "scrollHeight", { configurable: true, get: () => 2_000 });
    Object.defineProperty(scroller, "offsetHeight", { configurable: true, get: () => 200 });
    Object.defineProperty(scroller, "offsetWidth", { configurable: true, get: () => 300 });
    Object.defineProperty(scroller, "scrollTop", {
      configurable: true,
      get: () => scrollTop,
      set: (value: number) => {
        scrollTop = value;
      },
    });
    const rect = (top: number, height: number) =>
      ({ top, left: 0, right: 300, bottom: top + height, width: 300, height, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      return this === host || this === scroller || this.hasAttribute(OVERLAY_SCROLLBAR_ATTRIBUTE)
        ? rect(0, 200)
        : rect(0, 0);
    });
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.releasePointerCapture = vi.fn();
    Element.prototype.hasPointerCapture = vi.fn(() => true);
  });

  afterEach(() => {
    host.remove();
    vi.restoreAllMocks();
  });

  it("replaces the native scrollbar with one bar in the host and restores it on destroy", () => {
    const handle = attachOverlayScrollbar({ scroller, host });
    const bar = host.querySelector(`[${OVERLAY_SCROLLBAR_ATTRIBUTE}="y"]`);
    expect(bar).not.toBeNull();
    expect(bar?.getAttribute("aria-hidden")).toBe("true");
    expect(scroller.classList.contains(NATIVE_SCROLLBAR_HIDDEN_CLASS)).toBe(true);
    handle.destroy();
    expect(host.querySelector(`[${OVERLAY_SCROLLBAR_ATTRIBUTE}]`)).toBeNull();
    expect(scroller.classList.contains(NATIVE_SCROLLBAR_HIDDEN_CLASS)).toBe(false);
  });

  it("scrolls the content synchronously while the thumb is dragged", () => {
    const handle = attachOverlayScrollbar({ scroller, host });
    const bar = host.querySelector<HTMLElement>(`[${OVERLAY_SCROLLBAR_ATTRIBUTE}="y"]`)!;
    bar.dispatchEvent(pointer("pointerdown", { clientY: 10 }));
    bar.dispatchEvent(pointer("pointermove", { clientY: 98 }));
    expect(scrollTop).toBeCloseTo(900);
    const thumb = bar.firstElementChild as HTMLElement;
    expect(thumb.style.transform).toBe("translate3d(0, 88px, 0)");
    bar.dispatchEvent(pointer("pointermove", { clientY: 1_000 }));
    expect(scrollTop).toBe(1_800);
    bar.dispatchEvent(pointer("pointerup", { clientY: 1_000 }));
    bar.dispatchEvent(pointer("pointermove", { clientY: 10 }));
    expect(scrollTop).toBe(1_800);
    handle.destroy();
  });

  it("jumps to a pressed point on the track and keeps dragging from there", () => {
    const handle = attachOverlayScrollbar({ scroller, host });
    const bar = host.querySelector<HTMLElement>(`[${OVERLAY_SCROLLBAR_ATTRIBUTE}="y"]`)!;
    bar.dispatchEvent(pointer("pointerdown", { clientY: 150 }));
    expect(scrollTop).toBeCloseTo((138 / 176) * 1_800);
    bar.dispatchEvent(pointer("pointermove", { clientY: 160 }));
    expect(scrollTop).toBeCloseTo((148 / 176) * 1_800);
    handle.destroy();
  });

  it("ignores buttons other than the primary one", () => {
    const handle = attachOverlayScrollbar({ scroller, host });
    const bar = host.querySelector<HTMLElement>(`[${OVERLAY_SCROLLBAR_ATTRIBUTE}="y"]`)!;
    bar.dispatchEvent(pointer("pointerdown", { clientY: 150, button: 2 }));
    expect(scrollTop).toBe(0);
    handle.destroy();
  });

  it("shows the bar while the host is hovered or the content scrolls", () => {
    const handle = attachOverlayScrollbar({ scroller, host });
    const bar = host.querySelector<HTMLElement>(`[${OVERLAY_SCROLLBAR_ATTRIBUTE}="y"]`)!;
    expect(bar.style.opacity).toBe("0");
    host.dispatchEvent(new MouseEvent("pointerenter"));
    flushFrames();
    expect(bar.style.opacity).toBe("1");
    host.dispatchEvent(new MouseEvent("pointerleave"));
    expect(bar.style.opacity).toBe("0");
    scroller.dispatchEvent(new Event("scroll"));
    flushFrames();
    expect(bar.style.opacity).toBe("1");
    handle.destroy();
  });

  it("follows the scroll position on the next frame", () => {
    const handle = attachOverlayScrollbar({ scroller, host });
    const thumb = host.querySelector<HTMLElement>(`[${OVERLAY_SCROLLBAR_ATTRIBUTE}="y"]`)!
      .firstElementChild as HTMLElement;
    scrollTop = 900;
    scroller.dispatchEvent(new Event("scroll"));
    flushFrames();
    expect(thumb.style.transform).toBe("translate3d(0, 88px, 0)");
    handle.destroy();
  });

  it("hides the bar when the content fits", () => {
    Object.defineProperty(scroller, "scrollHeight", { configurable: true, get: () => 200 });
    const handle = attachOverlayScrollbar({ scroller, host });
    const bar = host.querySelector<HTMLElement>(`[${OVERLAY_SCROLLBAR_ATTRIBUTE}="y"]`)!;
    expect(bar.style.display).toBe("none");
    expect(bar.style.pointerEvents).toBe("none");
    handle.destroy();
  });
});
