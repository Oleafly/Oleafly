// @vitest-environment jsdom
import { fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DRAG_THRESHOLD_PX, swallowNextClick, trackPointerDrag, type PointerDrag } from "./drag";

let frames = new Map<number, FrameRequestCallback>();
let frameCount = 0;

function flushFrames() {
  const pending = [...frames.values()];
  frames.clear();
  for (const callback of pending) callback(0);
}

function handlers(options: Pick<PointerDrag, "axis" | "perFrame"> = {}) {
  return { ...options, start: vi.fn(), move: vi.fn(), end: vi.fn() };
}

const listeners: (() => void)[] = [];

function clicks(): () => number {
  const seen = vi.fn();
  document.body.addEventListener("click", seen);
  listeners.push(() => document.body.removeEventListener("click", seen));
  return () => seen.mock.calls.length;
}

beforeEach(() => {
  frames = new Map();
  frameCount = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frameCount += 1;
    frames.set(frameCount, callback);
    return frameCount;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    frames.delete(id);
  });
});

afterEach(async () => {
  for (const remove of listeners.splice(0)) remove();
  vi.unstubAllGlobals();
  await new Promise((resolve) => setTimeout(resolve, 0));
});

describe("trackPointerDrag", () => {
  it("starts once the pointer travels the threshold in any direction", () => {
    const drag = handlers();
    trackPointerDrag({ clientX: 100, clientY: 100 }, drag);
    fireEvent.pointerMove(window, { clientX: 104, clientY: 104 });
    expect(drag.start).not.toHaveBeenCalled();
    fireEvent.pointerMove(window, { clientX: 105, clientY: 105 });
    expect(drag.start).toHaveBeenCalledWith({ clientX: 100, clientY: 100 });
    expect(drag.move).toHaveBeenLastCalledWith(expect.objectContaining({ clientX: 105, clientY: 105 }));
    fireEvent.pointerUp(window);
    expect(drag.end).toHaveBeenCalledWith(true);
  });

  it("measures the threshold along one axis when asked", () => {
    const drag = handlers({ axis: "y" });
    trackPointerDrag({ clientX: 0, clientY: 0 }, drag);
    fireEvent.pointerMove(window, { clientX: 80, clientY: DRAG_THRESHOLD_PX - 1 });
    expect(drag.move).not.toHaveBeenCalled();
    fireEvent.pointerMove(window, { clientX: 0, clientY: DRAG_THRESHOLD_PX });
    expect(drag.move).toHaveBeenCalledOnce();
    fireEvent.pointerUp(window);
  });

  it("hands over one move per frame and the last one on release", () => {
    const drag = handlers({ perFrame: true });
    trackPointerDrag({ clientX: 0, clientY: 0 }, drag);
    fireEvent.pointerMove(window, { clientX: 20, clientY: 0 });
    fireEvent.pointerMove(window, { clientX: 30, clientY: 0 });
    expect(drag.start).toHaveBeenCalledOnce();
    expect(drag.move).not.toHaveBeenCalled();
    expect(frames.size).toBe(1);
    flushFrames();
    expect(drag.move).toHaveBeenCalledTimes(1);
    expect(drag.move).toHaveBeenLastCalledWith({ clientX: 30, clientY: 0 });
    fireEvent.pointerMove(window, { clientX: 50, clientY: 0 });
    fireEvent.pointerUp(window);
    expect(frames.size).toBe(0);
    expect(drag.move).toHaveBeenLastCalledWith({ clientX: 50, clientY: 0 });
    expect(drag.end).toHaveBeenCalledWith(true);
    expect(drag.move.mock.invocationCallOrder.at(-1)).toBeLessThan(drag.end.mock.invocationCallOrder[0]);
  });

  it("drops a pending move when the drag is cancelled", () => {
    const drag = handlers({ perFrame: true });
    trackPointerDrag({ clientX: 0, clientY: 0 }, drag);
    fireEvent.pointerMove(window, { clientX: 40, clientY: 0 });
    fireEvent.pointerCancel(window);
    expect(frames.size).toBe(0);
    expect(drag.move).not.toHaveBeenCalled();
    expect(drag.end).toHaveBeenCalledWith(false);
  });

  it("lets Escape through before the drag starts and cancels with it afterwards", () => {
    const drag = handlers();
    trackPointerDrag({ clientX: 0, clientY: 0 }, drag);
    const early = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    window.dispatchEvent(early);
    expect(early.defaultPrevented).toBe(false);
    fireEvent.pointerMove(window, { clientX: 40, clientY: 0 });
    const late = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    window.dispatchEvent(late);
    expect(late.defaultPrevented).toBe(true);
    expect(drag.end).toHaveBeenCalledWith(false);
    fireEvent.pointerUp(window);
    expect(drag.end).toHaveBeenCalledOnce();
  });

  it("ends a started drag without swallowing a click when stopped from outside", () => {
    const drag = handlers();
    const stop = trackPointerDrag({ clientX: 0, clientY: 0 }, drag);
    fireEvent.pointerMove(window, { clientX: 40, clientY: 0 });
    stop();
    stop();
    expect(drag.end).toHaveBeenCalledOnce();
    expect(drag.end).toHaveBeenCalledWith(false);
    const count = clicks();
    fireEvent.click(document.body);
    expect(count()).toBe(1);
  });

  it("calls nothing for a press that never became a drag", () => {
    const drag = handlers();
    trackPointerDrag({ clientX: 0, clientY: 0 }, drag);
    fireEvent.pointerMove(window, { clientX: 2, clientY: 2 });
    fireEvent.pointerUp(window);
    expect(drag.start).not.toHaveBeenCalled();
    expect(drag.end).not.toHaveBeenCalled();
    const count = clicks();
    fireEvent.click(document.body);
    expect(count()).toBe(1);
  });
});

describe("swallowNextClick", () => {
  it("swallows the click that ends a drag but not one that starts with a fresh press", () => {
    const count = clicks();
    swallowNextClick();
    fireEvent.click(document.body);
    expect(count()).toBe(0);
    fireEvent.click(document.body);
    expect(count()).toBe(1);
    swallowNextClick();
    fireEvent.pointerDown(document.body);
    fireEvent.click(document.body);
    expect(count()).toBe(2);
  });

  it("stops waiting for a click after the current task", async () => {
    const count = clicks();
    swallowNextClick();
    await new Promise((resolve) => setTimeout(resolve, 0));
    fireEvent.click(document.body);
    expect(count()).toBe(1);
  });
});
