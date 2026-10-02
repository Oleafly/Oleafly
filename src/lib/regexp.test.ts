import { describe, expect, it } from "vitest";
import { escapeRegExp } from "./regexp";

const SPECIALS = String.raw`a.b*c+d?e^f$g{h}i(j)k|l[m]n\o`;

describe("escapeRegExp", () => {
  it("escapes every regular expression metacharacter", () => {
    expect(escapeRegExp(SPECIALS)).toBe(String.raw`a\.b\*c\+d\?e\^f\$g\{h\}i\(j\)k\|l\[m\]n\\o`);
  });

  it("builds a pattern that matches the text literally", () => {
    const pattern = new RegExp(`^${escapeRegExp(SPECIALS)}$`);
    expect(pattern.test(SPECIALS)).toBe(true);
    expect(pattern.test(SPECIALS.replace(".", "X"))).toBe(false);
  });

  it("leaves plain text alone", () => {
    expect(escapeRegExp("figure-1_final")).toBe("figure-1_final");
  });
});
