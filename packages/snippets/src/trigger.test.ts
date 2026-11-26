import { describe, expect, it } from "vitest";
import { compileTrigger, EVERY_KEY, hasNestedQuantifier, regexEndClass } from "./trigger";

describe("compileTrigger", () => {
  it("anchors the pattern at the end with unicode on", () => {
    const pattern = compileTrigger("a|b");
    expect(pattern.flags).toBe("u");
    expect(pattern.test("xa")).toBe(true);
    expect(pattern.test("ax")).toBe(false);
    expect(() => compileTrigger("(")).toThrow(SyntaxError);
  });

  it("refuses a group that repeats and repeats inside", () => {
    expect(() => compileTrigger("(\\w+\\s?)+\\d\\d")).toThrow(SyntaxError);
  });
});

describe("hasNestedQuantifier", () => {
  it.each([
    ["(\\w+\\s?)+\\d\\d", true],
    ["^(a+)+$", true],
    ["(a*)*", true],
    ["(?:a+b)*", true],
    ["(a+)?", false],
    ["(\\d+)?x", false],
    ["(a+){0,1}", false],
    ["((a+)?)+", true],
    ["(a+){2,}", true],
    ["(a+){1,3}", true],
    ["(a+?)+", true],
    ["((a)+)+", true],
    ["(x(a+))+", true],
    ["(?<n>a+)+", true],
    ["(a+){2}", false],
    ["(a){2,}", false],
    ["(a|b)+", false],
    ["(\\d+|[A-Za-z]|\\\\[A-Za-z]+)/", false],
    ["(?<![\\\\A-Za-z])([A-Za-z])(\\d)", false],
    ["\\(a+\\)+", false],
    ["[(]a+[)]+", false],
    ["(\\p{L}{2})+", false],
    ["(.*)\\.(.+)", false],
    ["a+b*c?", false],
    ["", false],
  ])("finds a nested quantifier in %s: %s", (source, expected) => {
    expect(hasNestedQuantifier(source)).toBe(expected);
  });
});

describe("regexEndClass", () => {
  it.each([
    ["([A-Za-z])(\\d)", "digit"],
    ["(?<![\\\\A-Za-z])([A-Za-z])(\\d)", "digit"],
    ["(?<![\\\\A-Za-z])([A-Za-z])hat", "t"],
    ["(?<![\\\\A-Za-z])(\\d+|[A-Za-z]|\\\\[A-Za-z]+)/", "/"],
    ["x[0-9]", "digit"],
    ["x[\\d]+", "digit"],
    ["[a-zA-Z]+", "letter"],
    ["\\p{L}", "letter"],
    ["\\p{Letter}{2}", "letter"],
    ["[\\p{L}]", "letter"],
    ["\\p{N}", EVERY_KEY],
    ["\\P{L}", EVERY_KEY],
    ["(?:x)", "x"],
    ["(?<name>ab)", "b"],
    ["(?i:a)", EVERY_KEY],
    ["(?i-m:a)", EVERY_KEY],
    ["ab$", "b"],
    ["a\\b", "a"],
    ["a(?=b)", "a"],
    ["a(?<!b)", "a"],
    ["a+", "a"],
    ["a+?", "a"],
    ["ab{1,3}", "b"],
    ["ab*", EVERY_KEY],
    ["ab?", EVERY_KEY],
    ["ab{0,2}", EVERY_KEY],
    ["\\.", "."],
    ["x\\*", "*"],
    ["[*]", "*"],
    ["[\\/]", "/"],
    ["[x]", "x"],
    ["[^x]", EVERY_KEY],
    ["[xy]", EVERY_KEY],
    ["a.", EVERY_KEY],
    ["\\w", EVERY_KEY],
    ["\\n", EVERY_KEY],
    ["\\u0041", EVERY_KEY],
    ["\\u{1F600}", EVERY_KEY],
    ["\\x41", EVERY_KEY],
    ["\\cJ", EVERY_KEY],
    ["(a)\\1", EVERY_KEY],
    ["(?<n>a)\\k<n>", EVERY_KEY],
    ["(a|b)", EVERY_KEY],
    ["(a|a)", "a"],
    ["a|b", EVERY_KEY],
    ["", EVERY_KEY],
    ["(ab", "b"],
  ])("puts %s in the %s bucket", (source, expected) => {
    expect(regexEndClass(source)).toBe(expected);
  });

  it("keeps every single character apart from the every-key bucket", () => {
    expect(EVERY_KEY).not.toHaveLength(1);
    expect(regexEndClass("x\\*")).not.toBe(EVERY_KEY);
  });
});
