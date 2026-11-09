import { afterEach, describe, expect, it, vi } from "vitest";
import { TERMINAL_SCROLLBAR_WIDTH, readScrollThumbMix, withQuietScrollbar } from "./terminal-scrollbar";

const MIX = { rest: 0.16, active: 0.3 };

function stubRootVariables(values: Record<string, string>) {
  vi.stubGlobal("document", { documentElement: {} });
  vi.stubGlobal("getComputedStyle", () => ({ getPropertyValue: (name: string) => values[name] ?? "" }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("terminal scrollbar", () => {
  it("tints the slider from the foreground like the app's scrollbars", () => {
    expect(withQuietScrollbar({ foreground: "#f2f2f2", background: "#1e1e1e" }, MIX)).toEqual({
      foreground: "#f2f2f2",
      background: "#1e1e1e",
      overviewRulerBorder: "transparent",
      scrollbarSliderBackground: "#f2f2f229",
      scrollbarSliderHoverBackground: "#f2f2f24d",
      scrollbarSliderActiveBackground: "#f2f2f24d",
    });
    expect(withQuietScrollbar({ foreground: " #ABC " }, MIX).scrollbarSliderBackground).toBe("#aabbcc29");
  });

  it("keeps xterm's own slider colours when the foreground or the app's mix cannot be read", () => {
    expect(withQuietScrollbar({ foreground: "rgb(1, 2, 3)" }, MIX)).toEqual({
      foreground: "rgb(1, 2, 3)",
      overviewRulerBorder: "transparent",
    });
    expect(withQuietScrollbar({}, MIX)).toEqual({ overviewRulerBorder: "transparent" });
    expect(withQuietScrollbar({ foreground: "#ffffff" }, null)).toEqual({ foreground: "#ffffff", overviewRulerBorder: "transparent" });
  });

  it("reads the thumb mix the app's stylesheet sets for every scrollbar", () => {
    stubRootVariables({ "--ofl-scroll-thumb-mix": " 16%", "--ofl-scroll-thumb-active-mix": "30%" });
    expect(readScrollThumbMix()).toEqual(MIX);
    expect(withQuietScrollbar({ foreground: "#000000" }).scrollbarSliderHoverBackground).toBe("#0000004d");
    stubRootVariables({ "--ofl-scroll-thumb-mix": "16%", "--ofl-scroll-thumb-active-mix": "" });
    expect(readScrollThumbMix()).toBeNull();
    stubRootVariables({ "--ofl-scroll-thumb-mix": "160%", "--ofl-scroll-thumb-active-mix": "30%" });
    expect(readScrollThumbMix()).toBeNull();
  });

  it("is as thin as the app's scrollbars", () => {
    expect(TERMINAL_SCROLLBAR_WIDTH).toBe(8);
  });
});
