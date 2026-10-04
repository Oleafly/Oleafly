// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMarquee } from "./use-marquee";

let frames: Map<number, FrameRequestCallback>;
let nextFrame: number;

function shelf(width = 300, visible = 100) {
  let left = 0;
  const node = document.createElement("div");
  Object.defineProperties(node, {
    scrollWidth: { configurable: true, get: () => width },
    clientWidth: { configurable: true, get: () => visible },
    scrollLeft: { configurable: true, get: () => left, set: (value: number) => { left = value; } },
  });
  return node;
}

function runFrame(time: number) {
  const pending = [...frames.entries()];
  frames.clear();
  for (const [, callback] of pending) callback(time);
}

beforeEach(() => {
  frames = new Map();
  nextFrame = 1;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    const id = nextFrame++;
    frames.set(id, callback);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    frames.delete(id);
  });
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query }));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useMarquee", () => {
  it("drifts the shelf, picks up where the reader scrolled it, and turns at the end", () => {
    const node = shelf();
    const { result } = renderHook(() => useMarquee({ current: node }, true));
    expect(result.current.running).toBe(true);

    runFrame(0);
    runFrame(1000);
    expect(node.scrollLeft).toBe(16);

    node.scrollLeft = 150;
    runFrame(2000);
    expect(node.scrollLeft).toBe(166);

    node.scrollLeft = 199;
    runFrame(3000);
    runFrame(4000);
    expect(node.scrollLeft).toBe(184);
  });

  it("holds while the pointer or focus is inside and resumes when it leaves", () => {
    const node = shelf();
    const { result } = renderHook(() => useMarquee({ current: node }, true));

    act(() => result.current.handlers.onMouseEnter());
    expect(result.current.running).toBe(false);
    expect(frames.size).toBe(0);
    act(() => result.current.handlers.onMouseLeave());
    expect(result.current.running).toBe(true);

    act(() => result.current.handlers.onFocusCapture());
    expect(result.current.running).toBe(false);
    act(() => result.current.handlers.onBlurCapture());
    expect(result.current.running).toBe(true);
  });

  it("pauses for two seconds after the reader scrolls, restarting the wait on more input", () => {
    vi.useFakeTimers();
    const node = shelf();
    const { result } = renderHook(() => useMarquee({ current: node }, true));

    act(() => result.current.handlers.onWheel());
    expect(result.current.running).toBe(false);
    act(() => vi.advanceTimersByTime(1500));
    act(() => result.current.handlers.onTouchStart());
    act(() => vi.advanceTimersByTime(1500));
    expect(result.current.running).toBe(false);
    act(() => vi.advanceTimersByTime(500));
    expect(result.current.running).toBe(true);

    act(() => result.current.handlers.onPointerDown());
    act(() => result.current.handlers.onMouseEnter());
    act(() => vi.advanceTimersByTime(5000));
    expect(result.current.running).toBe(false);
  });

  it("drops a pending resume when the shelf unmounts", () => {
    vi.useFakeTimers();
    const node = shelf();
    const { result, unmount } = renderHook(() => useMarquee({ current: node }, true));
    act(() => result.current.handlers.onWheel());

    unmount();

    expect(vi.getTimerCount()).toBe(0);
  });

  it("stays still when disabled, when motion is reduced, or without animation frames", () => {
    const node = shelf();
    const disabled = renderHook(() => useMarquee({ current: node }, false));
    expect(disabled.result.current.running).toBe(false);
    expect(frames.size).toBe(0);
    disabled.unmount();

    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduce"), media: query }));
    renderHook(() => useMarquee({ current: node }, true));
    expect(frames.size).toBe(0);

    vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query }));
    vi.stubGlobal("requestAnimationFrame", undefined);
    renderHook(() => useMarquee({ current: node }, true));
    expect(node.scrollLeft).toBe(0);
  });
});
