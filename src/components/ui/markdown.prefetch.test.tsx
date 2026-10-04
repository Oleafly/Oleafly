// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const loaded = vi.hoisted(() => vi.fn());

vi.mock("./markdown-renderer", () => {
  loaded();
  return { default: () => null };
});

beforeEach(() => {
  vi.resetModules();
  loaded.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("prefetching the markdown renderer", () => {
  it("loads the renderer once the browser is idle", async () => {
    const callbacks: Array<() => void> = [];
    vi.stubGlobal("requestIdleCallback", (callback: () => void) => {
      callbacks.push(callback);
      return 1;
    });
    const { prefetchMarkdownRenderer } = await import("./markdown");

    prefetchMarkdownRenderer();
    expect(loaded).not.toHaveBeenCalled();
    expect(callbacks).toHaveLength(1);

    callbacks[0]();
    await vi.waitFor(() => expect(loaded).toHaveBeenCalledTimes(1));

    prefetchMarkdownRenderer();
    expect(callbacks).toHaveLength(1);
  });

  it("falls back to a short timer without idle callbacks", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("requestIdleCallback", undefined);
    const timeout = vi.spyOn(window, "setTimeout");
    const { prefetchMarkdownRenderer } = await import("./markdown");

    prefetchMarkdownRenderer();
    expect(timeout).toHaveBeenCalledWith(expect.any(Function), 1);

    await vi.advanceTimersByTimeAsync(1);
    prefetchMarkdownRenderer();

    expect(timeout).toHaveBeenCalledTimes(1);
  });
});
