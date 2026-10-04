// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cssColorToHex, readCssVariable } from "./css-color";

const NAMED: Record<string, string> = {
  red: "#ff0000",
  rebeccapurple: "#663399",
  "#010203": "#010203",
  "rgb(1 2 3)": "rgb(1, 2, 3)",
  "hsl(0 0% 50% / 0.5)": "rgba(128, 128, 128, 0.5)",
  "color(display-p3 1 0 0)": "color(display-p3 1 0 0)",
};

function installCanvas(available = true) {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((() => {
    if (!available) return null;
    let style = "#000000";
    return {
      get fillStyle() {
        return style;
      },
      set fillStyle(value: string) {
        if (Object.hasOwn(NAMED, value)) style = NAMED[value];
      },
    };
  }) as unknown as HTMLCanvasElement["getContext"]);
}

afterEach(() => {
  vi.restoreAllMocks();
  document.documentElement.style.removeProperty("--accent");
});

describe("cssColorToHex through the canvas", () => {
  it("converts named and functional colors the canvas understands", () => {
    installCanvas();
    expect(cssColorToHex("red")).toBe("#ff0000");
    expect(cssColorToHex("RebeccaPurple".toLowerCase())).toBe("#663399");
    expect(cssColorToHex("rgb(1 2 3)")).toBe("#010203");
    expect(cssColorToHex("hsl(0 0% 50% / 0.5)")).toBe("#808080");
  });

  it("accepts the sentinel color itself but rejects colors the canvas ignores or cannot express as RGB", () => {
    installCanvas();
    expect(cssColorToHex("#010203")).toBe("#010203");
    expect(cssColorToHex("bogus")).toBeNull();
    expect(cssColorToHex("color(display-p3 1 0 0)")).toBeNull();
  });

  it("returns null when no 2D canvas is available", () => {
    installCanvas(false);
    expect(cssColorToHex("red")).toBeNull();
  });
});

describe("readCssVariable", () => {
  it("reads a custom property from the document root", () => {
    document.documentElement.style.setProperty("--accent", "  #123456 ");
    expect(readCssVariable("--accent")).toBe("#123456");
    expect(readCssVariable("--missing")).toBe("");
  });
});
