// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { cssColorToHex } from "./css-color";

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
