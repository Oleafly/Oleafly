import { describe, expect, it } from "vitest";
import { bodyUses, escapeBodyText, parseBody, serializeBody } from "./body";
import { parseCodeMirrorTemplate } from "./codemirror-template";
import type { BodyNode } from "./types";

function nodes(body: string): BodyNode[] {
  const result = parseBody(body);
  expect(result.errors).toEqual([]);
  return result.nodes;
}

const text = (value: string): BodyNode => ({ kind: "text", text: value });
const field = (index: number, placeholder: BodyNode[] = []): BodyNode => ({ kind: "field", index, placeholder });

describe("parseBody", () => {
  it("reads numbered fields and the exit", () => {
    expect(nodes("\\frac{$1}{$2}$0")).toEqual([
      text("\\frac{"),
      field(1),
      text("}{"),
      field(2),
      text("}"),
      field(0),
    ]);
  });

  it("keeps LaTeX backslashes and braces as written", () => {
    expect(nodes("\\begin{x}")).toEqual([text("\\begin{x}")]);
    expect(nodes("\\left\\{ \\}")).toEqual([text("\\left\\{ }")]);
  });

  it("reads the three escapes", () => {
    expect(nodes("\\$5 \\\\ a\\}")).toEqual([text("$5 \\ a}")]);
  });

  it("treats a dollar that starts nothing as text", () => {
    expect(nodes("$ x $ and $x$")).toEqual([text("$ x $ and $x$")]);
  });

  it("reads a choice", () => {
    expect(nodes("[${1|htbp,t,b,H|}]")).toEqual([
      text("["),
      { kind: "choice", index: 1, options: ["htbp", "t", "b", "H"] },
      text("]"),
    ]);
  });

  it("reads escapes inside a choice", () => {
    expect(nodes("${1|a\\,b,c\\|d,\\x|}")).toEqual([{ kind: "choice", index: 1, options: ["a,b", "c|d", "\\x"] }]);
  });

  it("makes a repeated field a mirror", () => {
    expect(nodes("\\begin{${1:env}}$0\\end{$1}")).toEqual([
      text("\\begin{"),
      field(1, [text("env")]),
      text("}"),
      field(0),
      text("\\end{"),
      { kind: "mirror", index: 1 },
      text("}"),
    ]);
  });

  it("takes the placeholder from a later occurrence when the first had none", () => {
    expect(nodes("$1 ${1:name}")).toEqual([field(1, [text("name")]), text(" "), { kind: "mirror", index: 1 }]);
  });

  it("drops fields inside a discarded later placeholder", () => {
    expect(nodes("${1:a} ${1:b ${2:c}} $2")).toEqual([
      field(1, [text("a")]),
      text(" "),
      { kind: "mirror", index: 1 },
      text(" "),
      field(2),
    ]);
  });

  it("makes later choices and project fields with an owned index mirrors", () => {
    expect(nodes("$1${1|a,b|}${1@label}")).toEqual([
      field(1),
      { kind: "mirror", index: 1 },
      { kind: "mirror", index: 1 },
    ]);
  });

  it("reads a helper mirror", () => {
    expect(nodes("${4:Caption} fig:${4/slug}")).toEqual([
      field(4, [text("Caption")]),
      text(" fig:"),
      { kind: "mirror", index: 4, helper: "slug" },
    ]);
  });

  it("reads a regex mirror", () => {
    expect(nodes("$1 ${1/(.*)/${1:/upcase}/}")).toEqual([
      field(1),
      text(" "),
      { kind: "mirror", index: 1, regex: { source: "(.*)", format: "${1:/upcase}", flags: "" } },
    ]);
  });

  it("reads escaped slashes and flags in a regex mirror", () => {
    expect(nodes("${1/a\\/b/x\\/y/gi}")).toEqual([
      { kind: "mirror", index: 1, regex: { source: "a/b", format: "x\\/y", flags: "gi" } },
    ]);
  });

  it("reads project fields", () => {
    expect(nodes("${2@image} ${3@label:sec}")).toEqual([
      { kind: "project", index: 2, field: "image", placeholder: "" },
      text(" "),
      { kind: "project", index: 3, field: "label", placeholder: "sec" },
    ]);
  });

  it("normalises the selection variable", () => {
    expect(nodes("\\emph{${TM_SELECTED_TEXT}} $SELECTION")).toEqual([
      text("\\emph{"),
      { kind: "variable", name: "SELECTION", fallback: [] },
      text("} "),
      { kind: "variable", name: "SELECTION", fallback: [] },
    ]);
  });

  it("keeps a date format", () => {
    expect(nodes("${DATE:D MMMM YYYY}")).toEqual([
      { kind: "variable", name: "DATE", format: "D MMMM YYYY", fallback: [] },
    ]);
  });

  it("reads a variable fallback and a variable transform", () => {
    expect(nodes("${CLIPBOARD:${1:quote}} ${TM_FILENAME/(.*)\\..+$/$1/}")).toEqual([
      { kind: "variable", name: "CLIPBOARD", fallback: [field(1, [text("quote")])] },
      text(" "),
      {
        kind: "variable",
        name: "TM_FILENAME",
        regex: { source: "(.*)\\..+$", format: "$1", flags: "" },
        fallback: [],
      },
    ]);
  });

  it("keeps unknown bare names as text but reads braced ones", () => {
    expect(nodes("$foo ${foo}")).toEqual([text("$foo "), { kind: "variable", name: "foo", fallback: [] }]);
  });

  it("reads regex captures", () => {
    expect(nodes("[[0]]_[[1]] [[x]] [[2]")).toEqual([
      { kind: "capture", group: 1 },
      text("_"),
      { kind: "capture", group: 2 },
      text(" [[x]] [[2]"),
    ]);
  });

  it("reads nested fields", () => {
    expect(nodes("${1:a ${2:b}}")).toEqual([field(1, [text("a "), field(2, [text("b")])])]);
  });

  it("reports an unclosed field and keeps the rest as text", () => {
    expect(parseBody("\\caption{${1:Caption")).toEqual({
      nodes: [text("\\caption{${1:Caption")],
      errors: [{ offset: 9, code: "unclosed", message: expect.any(String) }],
    });
  });

  it("reports the outermost unclosed field", () => {
    const result = parseBody("x ${1:a ${2:b");
    expect(result.errors.map((error) => error.offset)).toEqual([2]);
    expect(result.nodes).toEqual([text("x ${1:a ${2:b")]);
  });

  it.each([
    ["${12", "unclosed"],
    ["${1|a,b", "unclosed"],
    ["${1/a/b", "unclosed"],
    ["${1/a/b/g", "unclosed"],
    ["${1/ab", "unclosed"],
    ["${1@label", "unclosed"],
    ["${1@label:x", "unclosed"],
    ["${DATE:YYYY", "unclosed"],
    ["${CLIPBOARD:x", "unclosed"],
    ["${NAME", "unclosed"],
    ["${TM_FILENAME/abc", "unclosed"],
    ["${", "unclosed"],
  ])("reports %s as unclosed", (body, code) => {
    const result = parseBody(body);
    expect(result.errors).toEqual([{ offset: 0, code, message: expect.any(String) }]);
    expect(result.nodes).toEqual([text(body)]);
  });

  it.each([
    ["${}", "bad-field", "${}"],
    ["${1x}", "bad-field", "${1x}"],
    ["${-}", "bad-field", "${-}"],
    ["${NAME!}", "bad-field", "${NAME!}"],
    ["${1/shout}", "unknown-helper", "${1/shout}"],
    ["${1@photo}", "unknown-project-field", "${1@photo}"],
    ["${1@label!}", "bad-field", "${1@label!}"],
    ["${1/(/x/}", "bad-transform", "${1/(/x/}"],
    ["${1/a/x/z}", "bad-transform", "${1/a/x/z}"],
    ["${1/a/x/g!}", "bad-transform", "${1/a/x/g!}"],
  ])("reports %s as %s and keeps it as text", (body, code, kept) => {
    const result = parseBody(body);
    expect(result.errors).toEqual([{ offset: 0, code, message: expect.any(String) }]);
    expect(result.nodes).toEqual([text(kept)]);
  });

  it("keeps a lone trailing backslash", () => {
    expect(nodes("a\\")).toEqual([text("a\\")]);
  });
});

describe("serializeBody", () => {
  it.each([
    "\\frac{$1}{$2}$0",
    "\\begin{figure}[${1|htbp,t,b,H|}]\n\t\\caption{${4:Caption}}\\label{fig:${4/slug}}",
    "${1:a ${2:b}} ${1/(.*)/${1:/upcase}/g}",
    "${2@image} ${3@label:sec\\}} [[0]]_[[1]]",
    "${SELECTION:${1:x}} ${DATE:D MMMM YYYY} ${TM_FILENAME/(.*)/$1/}",
    "\\$ \\\\$1 \\right\\\\} \\}",
    "${1|a\\,b,c\\|d|}",
    "${1}2 $1",
  ])("round-trips %s", (body) => {
    const parsed = nodes(body);
    expect(parseBody(serializeBody(parsed))).toEqual({ nodes: parsed, errors: [] });
  });

  it("writes the short form when no digit follows", () => {
    expect(serializeBody(nodes("\\frac{$1}{${2}}${1}0"))).toBe("\\frac{$1}{$2}${1}0");
  });
});

describe("escapeBodyText", () => {
  it("escapes only what the parser would read", () => {
    expect(escapeBodyText("\\frac{a}{b} costs $5 \\$ \\\\ end\\", "top")).toBe(
      "\\frac{a}{b} costs \\$5 \\\\\\$ \\\\\\\\ end\\\\",
    );
    expect(escapeBodyText("a}b", "placeholder")).toBe("a\\}b");
    expect(escapeBodyText("a,b|c", "choice")).toBe("a\\,b\\|c");
  });
});

describe("bodyUses", () => {
  it("finds a variable anywhere in the tree", () => {
    expect(bodyUses(nodes("${1:${2:${SELECTION}}}"), "SELECTION")).toBe(true);
    expect(bodyUses(nodes("${CLIPBOARD:${SELECTION}}"), "SELECTION")).toBe(true);
    expect(bodyUses(nodes("$1 ${CLIPBOARD}"), "SELECTION")).toBe(false);
  });
});

describe("parseCodeMirrorTemplate", () => {
  it("makes a single unnamed field the exit", () => {
    expect(parseCodeMirrorTemplate("\\left( ${} \\right)")).toEqual([text("\\left( "), field(0), text(" \\right)")]);
  });

  it("keeps two unnamed fields apart and ends on the last", () => {
    expect(parseCodeMirrorTemplate("\\frac{${}}{${}}")).toEqual([
      text("\\frac{"),
      field(1),
      text("}{"),
      field(0),
      text("}"),
    ]);
  });

  it("numbers named fields in order and uses the name as text", () => {
    expect(parseCodeMirrorTemplate("${index} = ${end}")).toEqual([
      field(1, [text("index")]),
      text(" = "),
      field(0, [text("end")]),
    ]);
  });

  it("orders numbered fields before unnamed ones and links repeats", () => {
    expect(parseCodeMirrorTemplate("#{} ${2:b} ${1} ${name} ${2} #{name}")).toEqual([
      field(3),
      text(" "),
      field(2, [text("b")]),
      text(" "),
      field(1),
      text(" "),
      field(0, [text("name")]),
      text(" "),
      { kind: "mirror", index: 2 },
      text(" "),
      { kind: "mirror", index: 0 },
    ]);
  });

  it("drops the backslash of escaped braces, as CodeMirror does", () => {
    expect(parseCodeMirrorTemplate("\\\\{ ${a\\}b} \\}")).toEqual([text("\\{ "), field(0, [text("a}b")]), text(" }")]);
  });

  it("resolves nested fields from the inside out, as CodeMirror does", () => {
    expect(parseCodeMirrorTemplate("\\left( ${1:${}} \\right)")).toEqual([
      text("\\left( "),
      field(1, [field(0)]),
      text(" \\right)"),
    ]);
    expect(parseCodeMirrorTemplate("begin{${1}}\n\t${0:${}}\n\\end{${1}}")).toEqual([
      text("begin{"),
      field(1),
      text("}\n\t"),
      field(2, [field(0)]),
      text("\n\\end{"),
      { kind: "mirror", index: 1 },
      text("}"),
    ]);
    expect(parseCodeMirrorTemplate("${a ${b}} ${c}")).toEqual([
      field(2, [text("a "), field(1, [text("b")])]),
      text(" "),
      field(0, [text("c")]),
    ]);
  });

  it("reads digits that do not form a number field as a name", () => {
    expect(parseCodeMirrorTemplate("${12abc} ${1:a\\{b}")).toEqual([
      field(1, [text("12abc")]),
      text(" "),
      field(0, [text("1:a{b")]),
    ]);
  });

  it("keeps text that is not a field", () => {
    expect(parseCodeMirrorTemplate("$x ${a{b}} ${\nx} ${1:\n} ${1:${x{}} ${1:a ${y")).toEqual([
      text("$x ${a{b}} ${\nx} ${1:\n} ${1:${x{}} ${1:a ${y"),
    ]);
    expect(parseCodeMirrorTemplate("")).toEqual([]);
  });
});
