import { describe, expect, it } from "vitest";
import {
  closingBracket,
  directoryOf,
  isBlankValue,
  isCodeAt,
  isExternalTypstPath,
  namedArgument,
  normalizeProjectPath,
  positionalArgument,
  resolveTypstPath,
  scanTypst,
  stringValue,
  stringsWithin,
  TYPST_ESCAPE,
  TYPST_MARKUP,
  TYPST_MATH,
  TYPST_RAW,
  TYPST_STRING,
  typstCalls,
  typstMethodCalls,
  typstShowRuleCalls,
  typstVersionAtLeast,
} from "./typst-scan";

describe("scanTypst", () => {
  it("keeps offsets and blanks comments and raw text", () => {
    const text = "Text // TODO hidden\n/* block /* nested */ still */ after `raw TODO` end";
    const scan = scanTypst(text);
    expect(scan.masked).toHaveLength(text.length);
    expect(scan.masked).not.toContain("TODO");
    expect(scan.masked).toContain("after");
    expect(scan.comments.map((range) => text.slice(range.from, range.to))).toEqual([
      "// TODO hidden",
      "/* block /* nested */ still */",
    ]);
  });

  it("keeps a URL in markup out of the comment scanner", () => {
    const scan = scanTypst("See https://example.com/a@b for more.");
    expect(scan.comments).toEqual([]);
    expect(scan.markup).not.toContain("@b");
  });

  it("treats a URL glued to a word as a link, not a comment, as Typst does", () => {
    const scan = scanTypst("Start xhttps://a.b tail");
    expect(scan.comments).toEqual([]);
    expect(scan.markup).toContain("tail");
  });

  it("separates code from markup", () => {
    const text = '#image("a.png", alt: "Plot") and #emph[see @fig] here';
    const scan = scanTypst(text);
    expect(scan.code).toContain("image(");
    expect(scan.code).not.toContain("Plot");
    expect(scan.markup).toContain("see @fig");
    expect(scan.markup).toContain("here");
    expect(scan.markup).not.toContain("image");
  });

  it("treats line statements as code until the end of the line", () => {
    const scan = scanTypst('#set document(title: "A")\n= Intro\n#let x = 1\nBody');
    expect(scan.markup).toContain("= Intro");
    expect(scan.markup).toContain("Body");
    expect(scan.markup).not.toContain("document");
    expect(scan.markup).not.toContain("let");
  });

  it("returns to markup after a call so a trailing label is markup", () => {
    const scan = scanTypst("#figure(image(\"a.png\"))<fig:a> after");
    expect(scan.markup).toContain("<fig:a>");
  });

  it("does not mistake a quotation in markup for a string", () => {
    const scan = scanTypst('He said "see @fig:a" today.');
    expect(scan.markup).toContain("@fig:a");
  });

  it("keeps a content block inside a multi-line show rule as markup", () => {
    const text = "#show: ieee.with(\n  title: [A (title],\n  abstract: [Text],\n)\nBody";
    const scan = scanTypst(text);
    const [call] = typstMethodCalls(scan, "with");
    expect(call.args.map((arg) => arg.name)).toEqual(["title", "abstract"]);
    expect(scan.markup).toContain("Body");
  });
});

describe("typstCalls", () => {
  it("reads positional and named arguments with string values", () => {
    const scan = scanTypst('#figure(image("plots/a.png", width: 50%), caption: [A], alt: "")');
    const image = typstCalls(scan, ["image"])[0];
    const path = positionalArgument(scan, image);
    expect(path && stringValue(scan, path.valueFrom, path.valueTo)?.value).toBe("plots/a.png");
    const figure = typstCalls(scan, ["figure"])[0];
    const alt = namedArgument(figure, "alt");
    expect(alt && isBlankValue(scan, alt.valueFrom, alt.valueTo)).toBe(true);
    expect(namedArgument(figure, "caption")).toBeDefined();
  });

  it("finds calls to hyphenated names", () => {
    const scan = scanTypst("#show-equation(x)\n#great-theorems-init(y)");
    expect(typstCalls(scan, ["show-equation", "great-theorems-init"]).map((call) => call.name)).toEqual([
      "show-equation",
      "great-theorems-init",
    ]);
  });

  it("ignores a word in markup that looks like a call", () => {
    expect(typstCalls(scanTypst("The image (left) shows it."), ["image"])).toEqual([]);
  });
});

describe("typstVersionAtLeast", () => {
  it("compares release numbers", () => {
    expect(typstVersionAtLeast("0.14.0", [0, 14, 0])).toBe(true);
    expect(typstVersionAtLeast("0.13.1", [0, 14, 0])).toBe(false);
    expect(typstVersionAtLeast("0.15.1", [0, 14, 0])).toBe(true);
    expect(typstVersionAtLeast("1.0.0-rc.1", [0, 14, 0])).toBe(true);
    expect(typstVersionAtLeast(undefined, [0, 14, 0])).toBe(true);
  });
});

describe("resolveTypstPath", () => {
  it("resolves against the file and treats a leading slash as the project root", () => {
    expect(resolveTypstPath("chapters/intro.typ", "fig/a.png")).toBe("chapters/fig/a.png");
    expect(resolveTypstPath("chapters/intro.typ", "../fig/a.png")).toBe("fig/a.png");
    expect(resolveTypstPath("chapters/intro.typ", "/fig/a.png")).toBe("fig/a.png");
    expect(resolveTypstPath("main.typ", "@preview/cetz:0.3.0")).toBeNull();
    expect(resolveTypstPath("main.typ", "../outside.png")).toBeNull();
  });
});

describe("scanTypst lexing details", () => {
  function kindsOf(text: string): string {
    return [...scanTypst(text).kinds].join("");
  }

  it("runs an unterminated block comment to the end of the text", () => {
    const scan = scanTypst("a /* open");
    expect(scan.comments).toEqual([{ from: 2, to: 9 }]);
    expect(scan.masked).toBe("a        ");
  });

  it("reads an empty raw span and runs an unterminated raw block to the end", () => {
    expect(kindsOf("a `` b")).toBe(`00${String(TYPST_RAW).repeat(2)}00`);
    expect(kindsOf("a ```code")).toBe(`00${String(TYPST_RAW).repeat(7)}`);
  });

  it("trims trailing punctuation from an autolink", () => {
    const text = "see https://a.b/c. Next";
    const kinds = kindsOf(text);
    expect(kinds.slice(4, 17)).toBe(String(TYPST_ESCAPE).repeat(13));
    expect(kinds[17]).toBe(String(TYPST_MARKUP));
  });

  it("treats a backslash at the end of the text or line as a one-character escape", () => {
    expect(kindsOf("a\\")).toBe(`0${TYPST_ESCAPE}`);
    expect(kindsOf("a\\\nb")).toBe(`0${TYPST_ESCAPE}00`);
  });

  it("keeps escapes, comments and embedded code inside math", () => {
    const text = "$a \\$ b // c\n #x $ d";
    const scan = scanTypst(text);
    expect(scan.kinds[3]).toBe(TYPST_MATH);
    expect(scan.kinds[4]).toBe(TYPST_MATH);
    expect(scan.comments.map((range) => text.slice(range.from, range.to))).toEqual(["// c"]);
    expect(scan.code).toContain("#x");
    expect(scan.markup.trim()).toBe("d");
  });

  it("runs an unterminated string to the end of the text", () => {
    const scan = scanTypst('#f("abc');
    expect(scan.strings).toEqual([{ from: 4, to: 7 }]);
    expect([...scan.kinds.slice(4)]).toEqual([TYPST_STRING, TYPST_STRING, TYPST_STRING]);
  });

  it("ends a line statement at the bracket that closes its content block", () => {
    const scan = scanTypst("#box[#set text(red)] after");
    expect(scan.code).toContain("#set text(red)]");
    expect(scan.markup.trim()).toBe("after");
  });

  it("keeps a stray closing bracket inside a top-level line statement", () => {
    const scan = scanTypst("#let x = a]b\nmore");
    expect(scan.code).toContain("a]b");
    expect(scan.markup.trim()).toBe("more");
  });

  it("ends a line statement at a closing parenthesis", () => {
    const scan = scanTypst("#(#let y = 2) z");
    expect(scan.code).toContain("#let y = 2)");
    expect(scan.markup.trim()).toBe("z");
  });

  it("follows dotted field and method access as one expression", () => {
    const scan = scanTypst("#calc.max(1, 2) and #sym.arrow.r done");
    expect(scan.code).toContain("#calc.max(1, 2)");
    expect(scan.code).toContain("#sym.arrow.r");
    expect(scan.markup).toContain("and");
    expect(scan.markup).toContain("done");
  });

  it("reads a code block as code until its closing brace", () => {
    const scan = scanTypst("#{ let x = 1 } after");
    expect(scan.code).toContain("#{ let x = 1 }");
    expect(scan.markup.trim()).toBe("after");
  });

  it("returns to markup when a quote follows a finished identifier", () => {
    const scan = scanTypst('#f"x" y');
    expect(scan.code.trim()).toBe("#f");
    expect(scan.strings).toEqual([]);
    expect(scan.markup).toContain('"x" y');
  });

  it("keeps nested brackets inside a content block as markup", () => {
    const scan = scanTypst("#[a [b] c] d");
    expect(scan.markup).toContain("a [b] c");
    expect(scan.code.trim()).toBe("#[       ]");
  });

  it("reports which offsets are code", () => {
    const scan = scanTypst("#f(x) y");
    expect(isCodeAt(scan, 1)).toBe(true);
    expect(isCodeAt(scan, 6)).toBe(false);
  });
});

describe("typst call helpers", () => {
  it("closes an unterminated call at the end of the code", () => {
    const scan = scanTypst("#f(a, b");
    const [call] = typstCalls(scan, ["f"]);
    expect(call.close).toBe(7);
    expect(call.args.map((arg) => scan.text.slice(arg.from, arg.to))).toEqual(["a", "b"]);
    expect(closingBracket(scan, call.open)).toBe(7);
  });

  it("skips empty arguments and spread arguments when reading positions", () => {
    const scan = scanTypst("#f(, ..rest, x, y: 1,)");
    const [call] = typstCalls(scan, ["f"]);
    expect(call.args.map((arg) => scan.text.slice(arg.from, arg.to))).toEqual(["..rest", "x", "y: 1"]);
    const first = positionalArgument(scan, call);
    expect(first && scan.text.slice(first.from, first.to)).toBe("x");
    expect(positionalArgument(scan, call, 1)).toBeUndefined();
  });

  it("finds show rules that wrap the document in a template call", () => {
    const scan = scanTypst("#show: doc => conf(title: [A], doc)\n#show: ieee.with(title: [B])");
    expect(typstShowRuleCalls(scan).map((call) => call.name)).toEqual(["conf", "ieee.with"]);
  });

  it("reads string literals, including empty ones, as string values", () => {
    const scan = scanTypst('#f("a\\n\\tb\\"c", x, "")');
    const [call] = typstCalls(scan, ["f"]);
    const [text, variable, empty] = call.args;
    expect(stringValue(scan, text.valueFrom, text.valueTo)?.value).toBe('a\n\tb"c');
    expect(stringValue(scan, variable.valueFrom, variable.valueTo)).toBeNull();
    expect(stringValue(scan, empty.valueFrom, empty.valueTo)?.value).toBe("");
    expect(stringsWithin(scan, call.open, call.close).map((item) => item.value)).toEqual(['a\n\tb"c', ""]);
  });

  it("does not read concatenated strings as one literal", () => {
    const scan = scanTypst('#f("a" + "b")');
    const [call] = typstCalls(scan, ["f"]);
    const [arg] = call.args;
    expect(stringValue(scan, arg.valueFrom, arg.valueTo)).toBeNull();
  });

  it("recognises blank values in every form", () => {
    const scan = scanTypst('#f(none, (), "  ", [ ], [x], "y", 0)');
    const [call] = typstCalls(scan, ["f"]);
    expect(call.args.map((arg) => isBlankValue(scan, arg.valueFrom, arg.valueTo))).toEqual([
      true,
      true,
      true,
      true,
      false,
      false,
      false,
    ]);
    expect(isBlankValue(scan, call.open + 1, call.open + 1)).toBe(true);
  });
});

describe("typst version and path helpers", () => {
  it("accepts unparseable versions and compares short ones as zero-padded", () => {
    expect(typstVersionAtLeast("nightly", [0, 14, 0])).toBe(true);
    expect(typstVersionAtLeast("v0.14", [0, 14, 0])).toBe(true);
    expect(typstVersionAtLeast("0.14", [0, 14, 1])).toBe(false);
    expect(typstVersionAtLeast("0.14.0", [0, 14])).toBe(true);
  });

  it("normalizes separators, dots and parent steps", () => {
    expect(normalizeProjectPath(String.raw`a\.\b//c/../d`)).toBe("a/b/d");
    expect(normalizeProjectPath("../x")).toBeNull();
    expect(directoryOf("file.typ")).toBe("");
    expect(directoryOf("a/b/file.typ")).toBe("a/b/");
  });

  it("treats packages and URLs as external and resolves without a source file", () => {
    expect(isExternalTypstPath("@preview/x:1.0.0")).toBe(true);
    expect(isExternalTypstPath("https://example.com/a.png")).toBe(true);
    expect(isExternalTypstPath("img/a.png")).toBe(false);
    expect(resolveTypstPath(undefined, "img/a.png")).toBe("img/a.png");
    expect(resolveTypstPath("main.typ", "https://example.com/a.png")).toBeNull();
  });
});
