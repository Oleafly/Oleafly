import { afterEach, describe, expect, it, vi } from "vitest";
import { hasIdleCallbacks, scheduleIdle } from "./idle";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("scheduleIdle", () => {
  it("waits for an idle moment, hands over the deadline and can be cancelled", () => {
    const request = vi.fn((_run: IdleRequestCallback, _options?: IdleRequestOptions) => 7);
    const cancel = vi.fn();
    vi.stubGlobal("requestIdleCallback", request);
    vi.stubGlobal("cancelIdleCallback", cancel);
    const run = vi.fn();
    const stop = scheduleIdle(run, { fallbackMs: 10, timeout: 500 });
    expect(hasIdleCallbacks()).toBe(true);
    expect(request).toHaveBeenCalledWith(run, { timeout: 500 });
    const deadline = { didTimeout: false, timeRemaining: () => 40 };
    request.mock.calls[0][0](deadline);
    expect(run).toHaveBeenCalledWith(deadline);
    stop();
    expect(cancel).toHaveBeenCalledWith(7);
  });

  it("asks for no timeout unless one is given", () => {
    const request = vi.fn((_run: IdleRequestCallback, _options?: IdleRequestOptions) => 1);
    vi.stubGlobal("requestIdleCallback", request);
    vi.stubGlobal("cancelIdleCallback", vi.fn());
    scheduleIdle(vi.fn(), { fallbackMs: 10 });
    expect(request.mock.calls[0][1]).toBeUndefined();
  });

  it("falls back to a timer without a deadline where the webview has no idle callbacks", () => {
    vi.useFakeTimers();
    vi.stubGlobal("requestIdleCallback", undefined);
    expect(hasIdleCallbacks()).toBe(false);
    const run = vi.fn();
    scheduleIdle(run, { fallbackMs: 48 });
    vi.advanceTimersByTime(47);
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(run).toHaveBeenCalledWith();
    const later = vi.fn();
    const stop = scheduleIdle(later, { fallbackMs: 48 });
    stop();
    vi.advanceTimersByTime(48);
    expect(later).not.toHaveBeenCalled();
  });
});
