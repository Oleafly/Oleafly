// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDebouncedValue } from "./use-debounced-value";

const isEmpty = (value: string) => value === "";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useDebouncedValue", () => {
  it("settles on the latest value once the delay passes", () => {
    const view = renderHook(({ value }) => useDebouncedValue(value, 100), {
      initialProps: { value: "a" },
    });
    expect(view.result.current).toBe("a");

    view.rerender({ value: "ab" });
    act(() => vi.advanceTimersByTime(60));
    view.rerender({ value: "abc" });
    act(() => vi.advanceTimersByTime(60));
    expect(view.result.current).toBe("a");

    act(() => vi.advanceTimersByTime(40));
    expect(view.result.current).toBe("abc");
  });

  it("skips the delay for values the caller marks as immediate", () => {
    const view = renderHook(({ value }) => useDebouncedValue(value, 100, isEmpty), {
      initialProps: { value: "query" },
    });
    view.rerender({ value: "" });
    expect(view.result.current).toBe("");

    view.rerender({ value: "next" });
    expect(view.result.current).toBe("");
    act(() => vi.advanceTimersByTime(100));
    expect(view.result.current).toBe("next");
  });
});
