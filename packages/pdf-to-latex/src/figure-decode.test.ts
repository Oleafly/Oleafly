import { describe, expect, it } from "vitest";
import { rawToRgba } from "./figure-decode";

describe("rawToRgba", () => {
  it("expands RGB24 to RGBA", () => {
    const rgba = rawToRgba(new Uint8Array([10, 20, 30, 40, 50, 60]), 2, 1, 2);
    expect([...rgba]).toEqual([10, 20, 30, 255, 40, 50, 60, 255]);
  });

  it("passes RGBA32 through", () => {
    const rgba = rawToRgba(new Uint8Array([1, 2, 3, 4]), 1, 1, 3);
    expect([...rgba]).toEqual([1, 2, 3, 4]);
  });

  it("expands 1bpp grayscale bits to opaque pixels", () => {
    const rgba = rawToRgba(new Uint8Array([0b10000000]), 2, 1, 1);
    expect([...rgba.slice(0, 4)]).toEqual([255, 255, 255, 255]);
    expect([...rgba.slice(4, 8)]).toEqual([0, 0, 0, 255]);
  });

  it("respects row byte padding for 1bpp", () => {
    // width 2 rows pad to 1 byte each; two rows
    const rgba = rawToRgba(new Uint8Array([0b10000000, 0b01000000]), 2, 2, 1);
    expect([...rgba.slice(0, 4)]).toEqual([255, 255, 255, 255]); // row0 px0
    expect([...rgba.slice(12, 16)]).toEqual([255, 255, 255, 255]); // row1 px1
  });
});
