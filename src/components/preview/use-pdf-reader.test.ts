// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { pdfDarkModeShown, readPdfPageColors } from "./use-pdf-reader";

function setPageColors(page: string, text: string) {
  document.documentElement.style.setProperty("--pdf-dark-page", page);
  document.documentElement.style.setProperty("--pdf-dark-text", text);
}

afterEach(() => {
  document.documentElement.style.removeProperty("--pdf-dark-page");
  document.documentElement.style.removeProperty("--pdf-dark-text");
});

describe("readPdfPageColors", () => {
  it("inverts the page when its color is darker than the text", () => {
    setPageColors("#282c34", "#abb2bf");
    expect(readPdfPageColors()).toBe("dark");
  });

  it("keeps the page upright when a theme picks a light page with dark text", () => {
    setPageColors("#f4ecd8", "#3b3024");
    expect(readPdfPageColors()).toBe("light");
  });

  it("falls back to a dark page when the colors cannot be read", () => {
    expect(readPdfPageColors()).toBe("dark");
  });
});

describe("pdfDarkModeShown", () => {
  it("follows the setting, and the app theme when matching it", () => {
    const shown = (["off", "on", "follow"] as const).flatMap((mode) =>
      (["light", "dark"] as const).flatMap((theme) =>
        (["dark", "light"] as const).map((colors) => `${mode} ${theme} ${colors}: ${pdfDarkModeShown(mode, theme, colors)}`),
      ),
    );
    expect(shown).toEqual([
      "off light dark: false",
      "off light light: false",
      "off dark dark: false",
      "off dark light: false",
      "on light dark: true",
      "on light light: true",
      "on dark dark: true",
      "on dark light: true",
      "follow light dark: false",
      "follow light light: true",
      "follow dark dark: true",
      "follow dark light: true",
    ]);
  });
});
