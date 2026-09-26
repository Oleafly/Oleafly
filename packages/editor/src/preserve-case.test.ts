import { describe, it, expect } from "vitest";
import { preserveCase } from "./preserve-case";

describe("preserveCase", () => {
  it("uppercases when the match is all caps", () => {
    expect(preserveCase("FOO", "bar")).toBe("BAR");
  });
  it("lowercases when the match is all lower", () => {
    expect(preserveCase("foo", "BAR")).toBe("bar");
  });
  it("capitalizes when the match is Capitalized", () => {
    expect(preserveCase("Foo", "bar")).toBe("Bar");
  });
  it("leaves mixed case replacements untouched", () => {
    expect(preserveCase("fooBar", "baz")).toBe("baz");
  });
  it("does not treat a digit-led match as all-caps", () => {
    expect(preserveCase("123", "bar")).toBe("bar");
  });
  it("keeps the replacement as typed when the match has no cased letters", () => {
    expect(preserveCase("数据", "GPU")).toBe("GPU");
    expect(preserveCase("שלום", "API")).toBe("API");
    expect(preserveCase("2024", "Q4")).toBe("Q4");
    expect(preserveCase("テスト", "Beta")).toBe("Beta");
  });
  it("decides case from the cased letters of a mixed match", () => {
    expect(preserveCase("GPU数据", "cpu")).toBe("CPU");
    expect(preserveCase("gpu数据", "CPU")).toBe("cpu");
    expect(preserveCase("Ω-test", "alpha")).toBe("Alpha");
  });
  it("handles accented and astral first letters", () => {
    expect(preserveCase("Řeka", "česko")).toBe("Česko");
    expect(preserveCase("ŘEKA", "česko")).toBe("ČESKO");
    expect(preserveCase("𐐀𐐨", "𐐨𐐨")).toBe("𐐀𐐨");
  });
});
