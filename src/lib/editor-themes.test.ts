// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  applyEditorColors,
  editorColorKey,
  editorColorPreviewStyle,
  editorThemeSurface,
  isEditorThemeId,
  normalizeEditorColor,
  parseEditorThemeExport,
  readEditorThemeColors,
  validateEditorColors,
} from "./editor-themes";

const root = document.documentElement;

afterEach(() => {
  applyEditorColors({});
});

describe("editor themes", () => {
  it("knows which surface each theme draws on", () => {
    expect(isEditorThemeId("paper")).toBe(true);
    expect(isEditorThemeId("neon")).toBe(false);
    expect(editorThemeSurface("paper", "dark")).toBe("light");
    expect(editorThemeSurface("one-light", "dark")).toBe("light");
    expect(editorThemeSurface("nord", "light")).toBe("dark");
    expect(editorThemeSurface("system", "light")).toBe("light");
    expect(editorThemeSurface("system", "dark")).toBe("dark");
  });

  it("keeps Match app colors apart for light and dark mode", () => {
    expect(editorColorKey("system", "light")).toBe("system-light");
    expect(editorColorKey("system", "dark")).toBe("system-dark");
    expect(editorColorKey("dracula", "light")).toBe("dracula");
    expect(editorColorKey("dracula", "dark")).toBe("dracula");
  });

  it("keeps only known themes, known colors and six-digit hex values", () => {
    expect(normalizeEditorColor(" #ABCDEF ")).toBe("#abcdef");
    expect(normalizeEditorColor("#abc")).toBe("#aabbcc");
    expect(normalizeEditorColor(42)).toBeNull();
    expect(
      validateEditorColors({
        nord: { heading: "#FF0000", math: "nope", title: "#123456" },
        "system-light": { background: "#fffaf0" },
        system: { heading: "#000000" },
        neon: { heading: "#000000" },
        paper: {},
        dracula: "red",
      }),
    ).toEqual({ nord: { heading: "#ff0000" }, "system-light": { background: "#fffaf0" } });
    expect(validateEditorColors(null)).toEqual({});
    expect(validateEditorColors([])).toEqual({});
  });

  it("sets the user color variables on the root and removes the ones left out", () => {
    applyEditorColors({ heading: "#112233", lineNumbers: "#445566" });
    expect(root.style.getPropertyValue("--cm-user-heading")).toBe("#112233");
    expect(root.style.getPropertyValue("--cm-user-line-numbers")).toBe("#445566");

    applyEditorColors({ heading: "#778899" });
    expect(root.style.getPropertyValue("--cm-user-heading")).toBe("#778899");
    expect(root.style.getPropertyValue("--cm-user-line-numbers")).toBe("");
  });

  it("blocks every color the previewed theme does not set", () => {
    const style = editorColorPreviewStyle({ comment: "#123456" });
    expect(style["--cm-user-comment"]).toBe("#123456");
    expect(style["--cm-user-heading"]).toBe("initial");
    expect(style["--cm-user-background"]).toBe("initial");
  });

  it("reads an imported editor section and ignores what it does not know", () => {
    expect(
      parseEditorThemeExport({
        themes: { light: "paper", dark: "neon" },
        colors: { paper: { heading: "#AA0000" }, neon: { heading: "#000000" } },
      }),
    ).toEqual({ themes: { light: "paper", dark: "system" }, colors: { paper: { heading: "#aa0000" } } });
    expect(parseEditorThemeExport("paper")).toBeNull();
  });

  it("measures a theme's colors without leaving the probe behind", () => {
    const before = document.body.childElementCount;
    const colors = readEditorThemeColors("paper", "light", { "--primary": "#2563eb" });
    expect(Object.keys(colors)).toContain("heading");
    expect(Object.keys(colors)).toContain("background");
    expect(document.body.childElementCount).toBe(before);
  });
});
