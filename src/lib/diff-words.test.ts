import { describe, it, expect } from "vitest";
import { diffWords } from "./diff-words";

describe("diffWords", () => {
  it("returns a single 'same' run for identical text", () => {
    expect(diffWords("hello world", "hello world")).toEqual([
      { kind: "same", text: "hello world" },
    ]);
  });

  it("marks a replaced word as del then add", () => {
    const d = diffWords("the old cat", "the new cat");
    expect(d.filter((t) => t.kind === "del").map((t) => t.text.trim())).toContain("old");
    expect(d.filter((t) => t.kind === "add").map((t) => t.text.trim())).toContain("new");
    // 'the' and 'cat' survive as 'same'
    expect(d.some((t) => t.kind === "same" && t.text.includes("the"))).toBe(true);
    expect(d.some((t) => t.kind === "same" && t.text.includes("cat"))).toBe(true);
  });

  it("reconstructs old text from same+del and new text from same+add", () => {
    const oldT = "alpha beta gamma";
    const newT = "alpha delta gamma epsilon";
    const d = diffWords(oldT, newT);
    expect(d.filter((t) => t.kind !== "add").map((t) => t.text).join("")).toBe(oldT);
    expect(d.filter((t) => t.kind !== "del").map((t) => t.text).join("")).toBe(newT);
  });

  it("handles empty old (pure addition) and empty new (pure deletion)", () => {
    expect(diffWords("", "hi").every((t) => t.kind === "add")).toBe(true);
    expect(diffWords("hi", "").every((t) => t.kind === "del")).toBe(true);
  });
});
