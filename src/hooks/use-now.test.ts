// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useNow } from "./use-now";

afterEach(() => vi.useRealTimers());

describe("useNow", () => {
  it("moves on once per tick and stops when unmounted", () => {
    vi.useFakeTimers({ now: 1_000 });
    const { result, unmount } = renderHook(() => useNow(60_000));
    expect(result.current).toBe(1_000);
    act(() => vi.advanceTimersByTime(59_999));
    expect(result.current).toBe(1_000);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBe(61_000);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
