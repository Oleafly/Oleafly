import { describe, expect, it } from "vitest";
import { blockKindOf } from "./block-views";

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
