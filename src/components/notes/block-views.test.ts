import { describe, expect, it } from "vitest";
import { blockKindOf, imageSource } from "./block-views";

describe("drawn blocks", () => {
  it.each([
    ["mermaid", "mermaid"],
    ["chart", "chart"],
    ["{=latex}", "latex"],
    ["{=typst}", "typst"],
    [" {=latex} ", "latex"],
  ])("draws a %s fence", (info, kind) => {
    expect(blockKindOf(info)).toBe(kind);
  });

  it.each(["python", "", "{.python}", "{=html}", "latex extra", "constructor", "toString"])(
    "leaves a %s fence as code",
    (info) => {
      expect(blockKindOf(info)).toBeUndefined();
    },
  );
});

describe("image sources", () => {
  it.each([
    "https://example.org/loss.png",
    "HTTPS://example.org/loss.png",
    "data:image/png;base64,iVBORw0KGgo=",
    "DATA:IMAGE/svg+xml;utf8,<svg/>",
  ])("shows %s as it is", (src) => {
    expect(imageSource(src)).toEqual({ url: src });
  });

  it("trims the space around a web address", () => {
    expect(imageSource("  https://example.org/a.png  ")).toEqual({ url: "https://example.org/a.png" });
  });

  it.each([
    "",
    "   ",
    "http://example.org/loss.png",
    "file:///Users/me/loss.png",
    "data:text/html,<script>alert(1)</script>",
    "javascript:alert(1)",
    "asset://localhost/loss.png",
    "C:/figures/loss.png",
    "/Users/me/figures/loss.png",
    "\\\\server\\share\\loss.png",
    "\\figures\\loss.png",
    "../shared/loss.png",
    "figures/../../secret.png",
    "figures\\..\\..\\secret.png",
    "%2E%2E/secret.png",
  ])("refuses %j", (src) => {
    expect(imageSource(src)).toBeNull();
  });

  it.each([
    ["figures/loss.png", "figures/loss.png"],
    ["./figures/loss.png", "figures/loss.png"],
    [" ./figures/loss.png ", "figures/loss.png"],
    ["figures/loss%20curve.png", "figures/loss curve.png"],
    ["./%D1%80%D0%B8%D1%81.png", "рис.png"],
    ["figures/.//loss.png", "figures/.//loss.png"],
  ])("reads the relative path %j as %j", (src, path) => {
    expect(imageSource(src)).toEqual({ path });
  });

  it("keeps a path with a broken escape as written", () => {
    expect(imageSource("./figures/100%-done.png")).toEqual({ path: "figures/100%-done.png" });
    expect(imageSource("figures/%E0%A4%A.png")).toEqual({ path: "figures/%E0%A4%A.png" });
  });
});
