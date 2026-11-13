// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { prefersReducedMotion, scrollBehavior, useReducedMotion } from "./reduced-motion";

function stubMotion(initial: boolean) {
  const listeners = new Set<() => void>();
  const query = {
    matches: initial,
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
  };
  vi.stubGlobal("matchMedia", (text: string) => {
    expect(text).toBe("(prefers-reduced-motion: reduce)");
    return query;
  });
  return {
    set(matches: boolean) {
      query.matches = matches;
      for (const listener of listeners) listener();
    },
    listeners,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("reduced motion", () => {
  it("reads the system setting and picks a scroll behaviour", () => {
    const motion = stubMotion(true);
    expect(prefersReducedMotion()).toBe(true);
    expect(scrollBehavior()).toBe("auto");
    motion.set(false);
    expect(scrollBehavior()).toBe("smooth");
  });

  it("says no when the webview cannot tell", () => {
    vi.stubGlobal("matchMedia", undefined);
    expect(prefersReducedMotion()).toBe(false);
  });

  it("follows changes while a component is mounted and stops listening after", () => {
    const motion = stubMotion(false);
    const { result, unmount } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);
    act(() => motion.set(true));
    expect(result.current).toBe(true);
    unmount();
    expect(motion.listeners.size).toBe(0);
  });
});
