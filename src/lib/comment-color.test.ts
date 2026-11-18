// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { warmAccent } from "./comment-accent";
import { applyCommentColor, COMMENT_COLOR_STORAGE_KEY, readCommentColor } from "./comment-color";

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

  it("applies the stored color when none is passed, as a new window does", () => {
    localStorage.setItem(COMMENT_COLOR_STORAGE_KEY, "graphite");
    applyCommentColor();
    expect(document.documentElement.dataset.commentColor).toBe("graphite");
  });
});

describe("accent comment colour", () => {
  afterEach(() => {
    document.documentElement.style.removeProperty("--primary");
  });

  it.each([
    ["#f5c518", undefined],
    ["#f59e0b", undefined],
    ["oklch(0.8 0.15 85)", undefined],
    ["#2563eb", "accent"],
    ["oklch(0.205 0 0)", "accent"],
  ])("follows the accent %s unless it is yellow or amber", async (primary, expected) => {
    document.documentElement.style.setProperty("--primary", primary);
    await applyCommentColor("accent");
    expect(document.documentElement.dataset.commentColor).toBe(expected);
  });
});

describe("accent comment colour after review", () => {
  afterEach(() => {
    document.documentElement.style.removeProperty("--primary");
    vi.restoreAllMocks();
  });

  it("checks the accent again when the theme changes it while the app is open", async () => {
    document.documentElement.style.setProperty("--primary", "#2563eb");
    await applyCommentColor("accent");
    expect(document.documentElement.dataset.commentColor).toBe("accent");
    document.documentElement.style.setProperty("--primary", "#eab308");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.documentElement.dataset.commentColor).toBeUndefined();
    await applyCommentColor("leaf");
    document.documentElement.style.setProperty("--primary", "#2563eb");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.documentElement.dataset.commentColor).toBe("leaf");
  });

  it("never shows the accent before it has been checked", () => {
    document.documentElement.style.setProperty("--primary", "#eab308");
    const done = applyCommentColor("accent");
    expect(document.documentElement.dataset.commentColor).toBeUndefined();
    return done;
  });

  it.each(["rgb(234 179 8)", "rgb(234, 179, 8)", "hsl(45 93% 47%)", "hsla(45, 93%, 47%, 1)", "lch(80% 80 85)", "oklch(80% 0.15 85)"])(
    "treats %s as yellow",
    (color) => {
      expect(warmAccent(color)).toBe(true);
    },
  );

  it.each([
    "color(display-p3 1 0.8 0)",
    "color(display-p3 0.96 0.62 0.04)",
    "color(rec2020 0.9 0.7 0.1)",
    "color(a98-rgb 0.9 0.75 0.1)",
    "color(prophoto-rgb 0.8 0.7 0.2)",
    "color(srgb-linear 0.8 0.5 0)",
    "color(xyz 0.6 0.65 0.1)",
    "color(xyz-d50 0.62 0.66 0.08)",
  ])("treats the wide-gamut %s as yellow", (color) => {
    expect(warmAccent(color)).toBe(true);
  });

  it.each(["color(display-p3 1 0.8 none)", "lab(80 none 80)", "oklab(0.85 none 0.17)", "oklch(80% 0.15 85 / none)", "rgb(234 179 none)"])(
    "reads a none channel as 0, as the browser draws it, so %s is still yellow",
    (color) => {
      expect(warmAccent(color)).toBe(true);
    },
  );

  it.each(["color(display-p3 0.2 0.4 0.95)", "color(rec2020 0.25 0.35 0.9)", "color(srgb-linear 0.05 0.1 0.8)"])("keeps the wide-gamut %s", (color) => {
    expect(warmAccent(color)).toBe(false);
  });

  it.each(["rgb(37 99 235)", "hsl(220 83% 53%)", "lch(45% 70 290)", "#ea580c"])("keeps %s", (color) => {
    expect(warmAccent(color)).toBe(false);
  });

  it("asks the browser what a named colour is", async () => {
    document.documentElement.style.setProperty("--primary", "yellow");
    const real = window.getComputedStyle;
    vi.spyOn(window, "getComputedStyle").mockImplementation((element, pseudo) => {
      const style = real(element, pseudo);
      if (!(element instanceof HTMLElement) || element.style.color !== "var(--primary)") return style;
      return { ...style, color: "rgb(255, 255, 0)", getPropertyValue: style.getPropertyValue.bind(style) } as CSSStyleDeclaration;
    });
    await applyCommentColor("accent");
    expect(document.documentElement.dataset.commentColor).toBeUndefined();
  });
});
