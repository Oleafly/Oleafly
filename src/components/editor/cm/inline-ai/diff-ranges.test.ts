import { describe, it, expect } from "vitest";
import { buildDecoSpans } from "./diff-ranges";

describe("buildDecoSpans", () => {
  it("marks deleted words in the original at absolute offsets", () => {
    // original 'the old cat' starts at doc offset 10; 'old ' spans 14..18
    const spans = buildDecoSpans("the old cat", "the new cat", 10);
    const del = spans.find((s) => s.kind === "del");
    expect(del).toMatchObject({ from: 14, to: 18, kind: "del" });
  });

  it("emits zero-width add spans with the inserted preview text", () => {
    const spans = buildDecoSpans("the old cat", "the new cat", 0);
    const add = spans.find((s) => s.kind === "add");
    expect(add?.from).toBe(add?.to); // zero-width insertion point
    expect(add?.text).toBe("new ");
  });

  it("returns no spans when identical", () => {
    expect(buildDecoSpans("same", "same", 0)).toEqual([]);
  });

  it("del span offsets stay within the original text length", () => {
    const original = "alpha beta";
    const spans = buildDecoSpans(original, "alpha gamma", 0);
    for (const s of spans.filter((x) => x.kind === "del")) {
      expect(s.to).toBeLessThanOrEqual(original.length);
    }
  });
});
