// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { cssColorToHex, readClassVariables } from "./css-color";

describe("cssColorToHex", () => {
  it("normalizes hex forms without touching the canvas", () => {
    expect(cssColorToHex("#ABC")).toBe("#aabbcc");
    expect(cssColorToHex("#abcd")).toBe("#aabbcc");
    expect(cssColorToHex(" #2563EB ")).toBe("#2563eb");
    expect(cssColorToHex("#2563eb80")).toBe("#2563eb");
  });

  it("returns null for blank input and for colors the canvas cannot parse", () => {
    expect(cssColorToHex("")).toBeNull();
    expect(cssColorToHex("   ")).toBeNull();
    expect(cssColorToHex("not a color")).toBeNull();
  });
});

describe("readClassVariables", () => {
  it("reads the custom properties a class sets and leaves no probe behind", () => {
    const style = document.createElement("style");
    style.textContent = ".sample { --tone: #123456; --edge: 2px; }";
    document.head.append(style);
    expect(readClassVariables("sample", ["--tone", "--edge", "--missing"])).toEqual({
      "--tone": "#123456",
      "--edge": "2px",
      "--missing": "",
    });
    expect(document.querySelector(".sample")).toBeNull();
    style.remove();
  });
});
