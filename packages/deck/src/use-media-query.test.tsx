// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { matchesMediaQuery, useMediaQuery } from "./use-media-query";
import { usePrefersReducedMotion } from "./use-prefers-reduced-motion";

type Listener = (event: MediaQueryListEvent) => void;

function stubQueries(initial: Record<string, boolean>) {
  const state = new Map(Object.entries(initial));
  const listeners = new Map<string, Set<Listener>>();
  vi.stubGlobal("matchMedia", (query: string) => ({
    get matches() {
      return state.get(query) ?? false;
    },
    addEventListener: (_type: string, listener: Listener) => {
      const set = listeners.get(query) ?? new Set<Listener>();
      set.add(listener);
      listeners.set(query, set);
    },
    removeEventListener: (_type: string, listener: Listener) => listeners.get(query)?.delete(listener),
  }));
  return {
    set(query: string, matches: boolean) {
      state.set(query, matches);
      for (const listener of listeners.get(query) ?? []) listener({ matches } as MediaQueryListEvent);
    },
    count: (query: string) => listeners.get(query)?.size ?? 0,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useMediaQuery", () => {
  it("reads the query, follows changes and stops listening when unmounted", () => {
    const media = stubQueries({ "(min-width: 600px)": true });
    const { result, unmount } = renderHook(() => useMediaQuery("(min-width: 600px)"));
    expect(result.current).toBe(true);
    expect(media.count("(min-width: 600px)")).toBe(1);

    act(() => media.set("(min-width: 600px)", false));
    expect(result.current).toBe(false);

    unmount();
    expect(media.count("(min-width: 600px)")).toBe(0);
  });

  it("switches to a new query when it changes", () => {
    const media = stubQueries({ "(orientation: portrait)": false, "(orientation: landscape)": true });
    const { result, rerender } = renderHook(({ query }) => useMediaQuery(query), {
      initialProps: { query: "(orientation: portrait)" },
    });
    expect(result.current).toBe(false);

    rerender({ query: "(orientation: landscape)" });
    expect(result.current).toBe(true);
    expect(media.count("(orientation: portrait)")).toBe(0);
    expect(media.count("(orientation: landscape)")).toBe(1);
  });

  it("answers a one-off check", () => {
    stubQueries({ "(hover: hover)": true });
    expect(matchesMediaQuery("(hover: hover)")).toBe(true);
    expect(matchesMediaQuery("(hover: none)")).toBe(false);
  });
});

describe("reduced motion", () => {
  it("reads and follows the system setting", () => {
    const media = stubQueries({ "(prefers-reduced-motion: reduce)": true });
    const { result } = renderHook(() => usePrefersReducedMotion());
    expect(result.current).toBe(true);

    act(() => media.set("(prefers-reduced-motion: reduce)", false));
    expect(result.current).toBe(false);
  });
});
