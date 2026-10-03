import { describe, expect, it } from "vitest";
import {
  isVendoredTypstPackagePath,
  trimTypstReference,
  typstReferenceEnd,
} from "./typst-syntax";

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

describe("vendored Typst package paths", () => {
  it("covers the project-level typst-packages folder and nothing else", () => {
    expect(isVendoredTypstPackagePath("typst-packages")).toBe(true);
    expect(isVendoredTypstPackagePath("typst-packages/preview/cetz/0.5.2/lib.typ")).toBe(true);
    expect(isVendoredTypstPackagePath("typst-packages\\local\\mine\\0.1.0\\lib.typ")).toBe(true);
    expect(isVendoredTypstPackagePath("/typst-packages/preview/cetz/0.5.2/README.md")).toBe(true);
    expect(isVendoredTypstPackagePath("chapters/typst-packages/notes.typ")).toBe(false);
    expect(isVendoredTypstPackagePath("typst-packages.typ")).toBe(false);
    expect(isVendoredTypstPackagePath("typst-packages-old/lib.typ")).toBe(false);
    expect(isVendoredTypstPackagePath("main.typ")).toBe(false);
    expect(isVendoredTypstPackagePath(null)).toBe(false);
    expect(isVendoredTypstPackagePath("")).toBe(false);
  });
});
