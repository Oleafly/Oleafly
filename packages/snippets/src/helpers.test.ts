import { describe, expect, it } from "vitest";
import { applyHelper, applyRegexTransform, formatDate, validRegexTransform } from "./helpers";

describe("applyHelper", () => {
  it("slugs text", () => {
    expect(applyHelper("slug", "Ignition map of the 48 nodes")).toBe("ignition-map-of-the-48-nodes");
    expect(applyHelper("slug", "  --Field evaluation, results!--  ")).toBe("field-evaluation-results");
  });

  it("keeps unicode letters in a slug", () => {
    expect(applyHelper("slug", "Größe der Ränder")).toBe("größe-der-ränder");
    expect(applyHelper("slug", "Équations à résoudre")).toBe("équations-à-résoudre");
    expect(applyHelper("slug", "量子 状態")).toBe("量子-状態");
  });

  it("changes case", () => {
    expect(applyHelper("lower", "LaTeX Tips")).toBe("latex tips");
    expect(applyHelper("upper", "LaTeX Tips")).toBe("LATEX TIPS");
    expect(applyHelper("title", "ignition map of LaTeX nodes")).toBe("Ignition Map Of LaTeX Nodes");
  });

  it("takes initials", () => {
    expect(applyHelper("initials", "Ada King Lovelace")).toBe("AKL");
    expect(applyHelper("initials", "jean-paul sartre, 48 ans")).toBe("JPS4A");
    expect(applyHelper("initials", "")).toBe("");
  });
});

describe("applyRegexTransform", () => {
  const transform = (value: string, source: string, format: string, flags = "") =>
    applyRegexTransform(value, { source, format, flags });

  it("applies case changes", () => {
    expect(transform("abc", "(.*)", "${1:/upcase}")).toBe("ABC");
    expect(transform("ABC", "(.*)", "${1:/downcase}")).toBe("abc");
    expect(transform("abc def", "(.*)", "${1:/capitalize}")).toBe("Abc def");
    expect(transform("foo-bar baz_qux", "(.*)", "${1:/camelcase}")).toBe("fooBarBazQux");
    expect(transform("Foo-bar", "(.*)", "${1:/camelcase}")).toBe("fooBar");
    expect(transform("foo-bar baz", "(.*)", "${1:/pascalcase}")).toBe("FooBarBaz");
    expect(transform("abc", "(.*)", "${1:/shout}")).toBe("abc");
    expect(transform("", "(.*)", "${1:/camelcase}")).toBe("");
  });

  it("applies conditionals and defaults", () => {
    expect(transform("a", "(a)?(b)?", "${1:+one}${2:+two}")).toBe("one");
    expect(transform("a", "(a)?(b)?", "${1:?yes:no}|${2:?yes:no}|${2:?only}")).toBe("yes|no|");
    expect(transform("a", "(a)?(b)?", "${2:-none}${2:else}${1:-x}")).toBe("noneelsea");
    expect(transform("a", "(a)", "${1:+a\\}b}")).toBe("a}b");
  });

  it("splits an if-else on the first colon that is not escaped", () => {
    expect(transform("a", "(a)?(b)?", "${2:?yes\\:1:no}")).toBe("no");
    expect(transform("a", "(a)?(b)?", "${1:?yes\\:1:no}")).toBe("yes:1");
    expect(transform("a", "(a)?(b)?", "${1:?a\\\\:b}")).toBe("a\\");
  });

  it("inserts groups and escapes", () => {
    expect(transform("main.tex", "(.*)\\.(.+)", "$2:${1}\\n\\t\\$\\/$")).toBe("tex:main\n\t$/$");
    expect(transform("x", "(?<name>x)", "[$1]")).toBe("[x]");
    expect(transform("x", "x", "$9|${9}")).toBe("|");
    expect(transform("x", "x", "a\\")).toBe("a\\");
  });

  it("replaces the first match unless the g flag is set", () => {
    expect(transform("a-b-c", "-", "+")).toBe("a+b-c");
    expect(transform("a-b-c", "-", "+", "g")).toBe("a+b+c");
    expect(transform("ABC", "b", "x", "i")).toBe("AxC");
  });

  it("leaves the value alone for an invalid transform", () => {
    expect(transform("abc", "(", "x")).toBe("abc");
    expect(transform("abc", "a", "x", "q")).toBe("abc");
    expect(validRegexTransform({ source: "a", format: "", flags: "gimsu" })).toBe(true);
  });

  it("refuses a regular expression that repeats a group which repeats inside", () => {
    expect(validRegexTransform({ source: "(a+){1,3}", format: "x", flags: "" })).toBe(false);
    expect(validRegexTransform({ source: "(.*)\\.(.+)", format: "x", flags: "" })).toBe(true);
    expect(transform("aaa!", "(a+){1,3}", "x")).toBe("aaa!");
  });
});

describe("formatDate", () => {
  it("formats every token", () => {
    const now = new Date(2026, 10, 25, 9, 5, 3);
    expect(formatDate(now, "YYYY YY MMMM MMM MM M DD D dddd ddd HH mm ss")).toBe(
      "2026 26 November Nov 11 11 25 25 Wednesday Wed 09 05 03",
    );
    expect(formatDate(now, "D MMMM YYYY")).toBe("25 November 2026");
    expect(formatDate(now, "dddd D MMMM YYYY")).toBe("Wednesday 25 November 2026");
  });

  it("pads only the padded tokens", () => {
    const now = new Date(2007, 2, 4, 23, 59, 0);
    expect(formatDate(now, "M/D/YY MM-DD HH:mm:ss")).toBe("3/4/07 03-04 23:59:00");
    expect(formatDate(now, "at dd")).toBe("at dd");
  });

  it("writes text in square brackets as it is", () => {
    const now = new Date(2026, 10, 26);
    expect(formatDate(now, "[Day] D [of] MMMM")).toBe("Day 26 of November");
    expect(formatDate(now, "[[]D[]] [] YYYY")).toBe("[26]  2026");
    expect(formatDate(now, "[D")).toBe("[26");
    expect(formatDate(now, `${"[\\".repeat(20_000)}x`)).toHaveLength(40_001);
  });
});
