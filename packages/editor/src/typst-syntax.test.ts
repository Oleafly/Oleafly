import { describe, expect, it } from "vitest";
import { trimTypstReference, typstReferenceEnd } from "./typst-syntax";

describe("Typst reference names", () => {
  it("drops trailing sentence punctuation from a reference", () => {
    expect(trimTypstReference("obr.1.")).toBe("obr.1");
    expect(trimTypstReference("sec:úvod:")).toBe("sec:úvod");
    expect(trimTypstReference("...")).toBe("");
    expect(trimTypstReference("plain")).toBe("plain");
  });

  it("stays linear on long runs of dots", () => {
    const name = `a${".".repeat(100_000)}b`;
    expect(trimTypstReference(name)).toBe(name);
    const text = `@a${".".repeat(100_000)}`;
    expect(typstReferenceEnd(text, 1)).toBe(2);
  });
});
