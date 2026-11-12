// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useMediaQuery } from "./media-query";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useMediaQuery", () => {
  it("reads the query it was given, and uses the fallback when the webview cannot tell", () => {
    const matchMedia = vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    vi.stubGlobal("matchMedia", matchMedia);
    expect(renderHook(() => useMediaQuery("(min-width: 1200px)", true)).result.current).toBe(false);
    expect(matchMedia).toHaveBeenCalledWith("(min-width: 1200px)");

    vi.stubGlobal("matchMedia", undefined);
    expect(renderHook(() => useMediaQuery("(min-width: 768px)", true)).result.current).toBe(true);
    expect(renderHook(() => useMediaQuery("(min-width: 768px)")).result.current).toBe(false);
  });
});
