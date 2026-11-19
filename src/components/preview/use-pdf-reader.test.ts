// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { readPdfPageColors } from "./use-pdf-reader";

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
