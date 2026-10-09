// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { editorThemeCursorColor } from "./editor-cursor-color";
import {
  THEME_CUSTOMIZATION_VERSION,
  resetThemeCustomization,
  writeThemeCustomization,
} from "./theme-customization";

const palette = document.createElement("style");
const root = document.documentElement;

beforeEach(() => {
  palette.textContent = [
    '[data-editor-theme="dracula"] { --cm-cursor: #f8f8f2; }',
    ".dark { --primary: #444444; }",
    ".light { --primary: #333333; }",
  ].join("\n");
  document.head.append(palette);
  root.style.setProperty("--primary", "#db2777");
});

afterEach(() => {
  palette.remove();
  root.style.removeProperty("--primary");
  localStorage.clear();
  resetThemeCustomization();
});

describe("editorThemeCursorColor", () => {
  it("reads a dark editor theme's own cursor color", () => {
    expect(editorThemeCursorColor("dark", "dracula", { theme: "light", accentColor: "#db2777" })).toBe("#f8f8f2");
  });

  it("uses the accent shown on screen when the editor follows the app theme", () => {
    expect(editorThemeCursorColor("light", "system", { theme: "light", accentColor: "#db2777" })).toBe("#db2777");
    expect(editorThemeCursorColor("light", "dracula", { theme: "light", accentColor: "#db2777" })).toBe("#db2777");
  });

  it("uses the accent, not the stylesheet's primary, for the mode that is not on screen", () => {
    expect(editorThemeCursorColor("dark", "system", { theme: "light", accentColor: "#0b8842" })).toBe("#0b8842");
  });

  it("uses a customized primary for the mode that is not on screen", () => {
    writeThemeCustomization({
      version: THEME_CUSTOMIZATION_VERSION,
      light: {},
      dark: { primary: "#123456" },
      radius: null,
      customCss: null,
    });
    expect(editorThemeCursorColor("dark", "system", { theme: "light", accentColor: "#0b8842" })).toBe("#123456");
  });
});
