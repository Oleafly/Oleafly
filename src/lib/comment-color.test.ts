// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ACCENTS } from "@/store/settings";
import { applyCommentColor, COMMENT_COLOR_STORAGE_KEY, readCommentColor } from "./comment-color";
import { applyTheme } from "./theme";

const CHROMIUM_OKLCH: Readonly<Record<string, string>> = {
  "#2563eb": "oklch(0.54613 0.215194 262.885)",
  "#0b8842": "oklch(0.549554 0.144704 150.98)",
  "#7c3aed": "oklch(0.54132 0.246582 293.015)",
  "#db2777": "oklch(0.591651 0.218003 0.589081)",
  "#ea580c": "oklch(0.646079 0.194351 41.1136)",
  "#0d9488": "oklch(0.600217 0.103809 184.7)",
  "oklch(0.205 0 0)": "oklch(0.205 0 0)",
  "oklch(0.922 0 0)": "oklch(0.922 0 0)",
  "#f5c518": "oklch(0.841946 0.168387 90.416)",
  "#f59e0b": "oklch(0.768595 0.16468 70.0701)",
  "#eab308": "oklch(0.795245 0.161679 86.0336)",
  yellow: "oklch(0.967983 0.210997 109.756)",
  "hsl(45 93% 47%)": "oklch(0.785773 0.159791 85.296)",
  "lch(80% 80 85)": "oklch(0.824104 0.167131 91.117)",
  "color(display-p3 1 0.8 0)": "oklch(0.86754 0.204634 89.2576)",
  "color(display-p3 0.2 0.4 0.95)": "oklch(0.566037 0.23194 261.862)",
  "color(xyz-d50 0.62 0.66 0.08)": "oklch(0.863646 0.177966 101.168)",
  "oklab(0.85 0 0.17)": "oklch(0.85 0.17 90)",
  "oklch(0.8 0.15 85 / 0.5)": "oklch(0.8 0.15 85 / 0.5)",
  "oklch(80% 0.15 85)": "oklch(0.8 0.15 85)",
  "oklch(0.5 0 none)": "oklch(0.5 0 none)",
  "not-a-color": "rgb(255, 255, 255)",
};

function mixesLikeChromium() {
  const real = window.getComputedStyle;
  vi.spyOn(window, "getComputedStyle").mockImplementation((element, pseudo) => {
    const style = real(element, pseudo);
    if (!(element instanceof HTMLSpanElement) || element.parentElement !== document.documentElement) return style;
    const primary = document.documentElement.style.getPropertyValue("--primary").trim();
    return { ...style, color: CHROMIUM_OKLCH[primary] ?? "" } as CSSStyleDeclaration;
  });
}

afterEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.commentColor;
});

describe("comment highlight color", () => {
  it("reads the four colors and falls back to indigo for anything else", () => {
    expect(readCommentColor("graphite")).toBe("graphite");
    expect(readCommentColor("accent")).toBe("accent");
    expect(readCommentColor("amber")).toBe("indigo");
    expect(readCommentColor(null)).toBe("indigo");
  });

  it("marks the root with the chosen color and clears it for the indigo default", () => {
    applyCommentColor("leaf");
    expect(document.documentElement.dataset.commentColor).toBe("leaf");
    applyCommentColor("indigo");
    expect(document.documentElement.dataset.commentColor).toBeUndefined();
  });

  it("keeps the color the settings chose when the theme is applied again", () => {
    localStorage.setItem(COMMENT_COLOR_STORAGE_KEY, "graphite");
    applyCommentColor("leaf");
    applyTheme("dark");
    applyTheme("light");
    expect(document.documentElement.dataset.commentColor).toBe("leaf");
  });
});

describe("accent comment colour", () => {
  beforeEach(mixesLikeChromium);

  afterEach(() => {
    document.documentElement.style.removeProperty("--primary");
    vi.restoreAllMocks();
  });

  it.each(ACCENTS.map((accent) => accent.color))("follows the built-in accent %s", (primary) => {
    document.documentElement.style.setProperty("--primary", primary);
    applyCommentColor("accent");
    expect(document.documentElement.dataset.commentColor).toBe("accent");
  });

  it.each([
    ["#f5c518", undefined],
    ["#f59e0b", undefined],
    ["#2563eb", "accent"],
    ["oklch(0.205 0 0)", "accent"],
    ["oklch(0.922 0 0)", "accent"],
  ])("follows the accent %s unless it is yellow or amber", (primary, expected) => {
    document.documentElement.style.setProperty("--primary", primary);
    applyCommentColor("accent");
    expect(document.documentElement.dataset.commentColor).toBe(expected);
  });

  it("checks the accent again when the theme changes it while the app is open", async () => {
    document.documentElement.style.setProperty("--primary", "#2563eb");
    applyCommentColor("accent");
    expect(document.documentElement.dataset.commentColor).toBe("accent");
    document.documentElement.style.setProperty("--primary", "#eab308");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.documentElement.dataset.commentColor).toBeUndefined();
    applyCommentColor("leaf");
    document.documentElement.style.setProperty("--primary", "#2563eb");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.documentElement.dataset.commentColor).toBe("leaf");
  });

  it("never shows a yellow accent, even for a moment", () => {
    document.documentElement.style.setProperty("--primary", "#eab308");
    applyCommentColor("accent");
    expect(document.documentElement.dataset.commentColor).toBeUndefined();
  });

  it.each([
    "yellow",
    "hsl(45 93% 47%)",
    "lch(80% 80 85)",
    "color(display-p3 1 0.8 0)",
    "color(xyz-d50 0.62 0.66 0.08)",
    "oklab(0.85 0 0.17)",
    "oklch(0.8 0.15 85 / 0.5)",
    "oklch(80% 0.15 85)",
  ])("treats %s as yellow, as the browser converts it", (primary) => {
    document.documentElement.style.setProperty("--primary", primary);
    applyCommentColor("accent");
    expect(document.documentElement.dataset.commentColor).toBeUndefined();
  });

  it.each(["color(display-p3 0.2 0.4 0.95)", "oklch(0.5 0 none)", "not-a-color"])("keeps %s", (primary) => {
    document.documentElement.style.setProperty("--primary", primary);
    applyCommentColor("accent");
    expect(document.documentElement.dataset.commentColor).toBe("accent");
  });
});
