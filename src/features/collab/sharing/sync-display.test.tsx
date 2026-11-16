// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useQuietDrop } from "./sync-display";
import { RECONNECTING_AFTER_MS, type SyncState } from "./sync-state";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useQuietDrop", () => {
  it("reconnecting shows after one second", () => {
    const { result, rerender } = renderHook(({ state }: { state: SyncState }) => useQuietDrop(state), {
      initialProps: { state: "upToDate" as SyncState },
    });
    rerender({ state: "reconnecting" });
    expect(result.current).toBe("upToDate");
    act(() => vi.advanceTimersByTime(RECONNECTING_AFTER_MS - 1));
    expect(result.current).toBe("upToDate");
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBe("reconnecting");
  });

  it("shows nothing of a drop that ends within a second", () => {
    const { result, rerender } = renderHook(({ state }: { state: SyncState }) => useQuietDrop(state), {
      initialProps: { state: "upToDate" as SyncState },
    });
    rerender({ state: "offline" });
    act(() => vi.advanceTimersByTime(RECONNECTING_AFTER_MS / 2));
    rerender({ state: "upToDate" });
    act(() => vi.advanceTimersByTime(RECONNECTING_AFTER_MS));
    expect(result.current).toBe("upToDate");
  });

  it("shows a drop at once when the project opens offline", () => {
    const { result } = renderHook(() => useQuietDrop("offline"));
    expect(result.current).toBe("offline");
  });
});
