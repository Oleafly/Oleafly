import { describe, expect, it } from "vitest";
import { compileTrigger, regexEndClass } from "./trigger";

describe("compileTrigger", () => {
  it("anchors the pattern at the end with unicode on", () => {
    const pattern = compileTrigger("a|b");
    expect(pattern.flags).toBe("u");
    expect(pattern.test("xa")).toBe(true);
    expect(pattern.test("ax")).toBe(false);
    expect(() => compileTrigger("(")).toThrow(SyntaxError);
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
    ["\\p{N}", "*"],
    ["\\P{L}", "*"],
    ["(?:x)", "x"],
    ["(?<name>ab)", "b"],
    ["ab$", "b"],
    ["a\\b", "a"],
    ["a(?=b)", "a"],
    ["a(?<!b)", "a"],
    ["a+", "a"],
    ["a+?", "a"],
    ["ab{1,3}", "b"],
    ["ab*", "*"],
    ["ab?", "*"],
    ["ab{0,2}", "*"],
    ["\\.", "."],
    ["[\\/]", "/"],
    ["[x]", "x"],
    ["[^x]", "*"],
    ["[xy]", "*"],
    ["a.", "*"],
    ["\\w", "*"],
    ["\\n", "*"],
    ["\\u0041", "*"],
    ["\\u{1F600}", "*"],
    ["\\x41", "*"],
    ["\\cJ", "*"],
    ["(a)\\1", "*"],
    ["(?<n>a)\\k<n>", "*"],
    ["(a|b)", "*"],
    ["(a|a)", "a"],
    ["a|b", "*"],
    ["", "*"],
    ["(ab", "b"],
  ])("puts %s in the %s bucket", (source, expected) => {
    expect(regexEndClass(source)).toBe(expected);
  });
});
