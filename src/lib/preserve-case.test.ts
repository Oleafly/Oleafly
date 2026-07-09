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
});
