import { describe, expect, it, vi } from "vitest";
import { parseBody } from "./body";
import { type RenderEnv, renderBody } from "./render";

const ENV: RenderEnv = {
  selection: "",
  clipboard: "",
  now: new Date(2026, 10, 25, 9, 5, 3),
  fileName: "chapters/intro.tex",
  projectName: "EdgeSense",
  lineComment: "%",
  captures: [],
  indent: "",
  indentUnit: "  ",
};

function render(body: string, env: Partial<RenderEnv> = {}) {
  const parsed = parseBody(body);
  expect(parsed.errors).toEqual([]);
  return renderBody(parsed.nodes, { ...ENV, ...env });
}

describe("renderBody", () => {
  it("places fields, mirrors and the exit", () => {
    const rendered = render("\\begin{${1:env}}\n\t$0\n\\end{$1}");
    expect(rendered.text).toBe("\\begin{env}\n  \n\\end{env}");
    expect(rendered.fields).toEqual([
      { index: 1, ranges: [{ from: 7, to: 10 }] },
      { index: 0, ranges: [{ from: 14, to: 14 }] },
    ]);
    expect(rendered.mirrors).toEqual([{ source: 1, from: 20, to: 23 }]);
    expect(rendered.exit).toBe(14);
  });

  it("orders fields 1 to n and then 0", () => {
    expect(render("$0 $2 $1 $3").fields.map((field) => field.index)).toEqual([1, 2, 3, 0]);
  });

  it("ends after the text when there is no $0", () => {
    const rendered = render("\\frac{$1}{$2}");
    expect(rendered.exit).toBe(rendered.text.length);
    expect(render("\\alpha")).toEqual({ text: "\\alpha", fields: [], mirrors: [], exit: 6 });
  });

  it("gives nested placeholders their own ranges", () => {
    const rendered = render("${1:a ${2:b}}c");
    expect(rendered.text).toBe("a bc");
    expect(rendered.fields).toEqual([
      { index: 1, ranges: [{ from: 0, to: 3 }] },
      { index: 2, ranges: [{ from: 2, to: 3 }] },
    ]);
  });

  it("indents every new line and turns tabs into the indent unit", () => {
    const rendered = render("\\begin{itemize}\n\t\\item $1\n\t\t${2:a\nb}\n\\end{itemize}", { indent: "\t", indentUnit: "    " });
    expect(rendered.text).toBe("\\begin{itemize}\n\t    \\item \n\t        a\n\tb\n\t\\end{itemize}");
  });

  it("renders choices and project fields with their first value", () => {
    const rendered = render("[${1|htbp,t|}]{${2@image:fig.png}}");
    expect(rendered.text).toBe("[htbp]{fig.png}");
    expect(rendered.fields).toEqual([
      { index: 1, ranges: [{ from: 1, to: 5 }], choices: ["htbp", "t"] },
      { index: 2, ranges: [{ from: 7, to: 14 }], project: "image" },
    ]);
  });

  it("applies helpers and transforms to mirrors, even before the field", () => {
    const rendered = render("\\label{fig:${1/slug}}\\caption{${1:Ignition map of the 48 nodes}} ${1/(.*)/${1:/upcase}/}");
    expect(rendered.text).toBe(
      "\\label{fig:ignition-map-of-the-48-nodes}\\caption{Ignition map of the 48 nodes} IGNITION MAP OF THE 48 NODES",
    );
    expect(rendered.mirrors).toEqual([
      { source: 1, from: 11, to: 39, helper: "slug" },
      { source: 1, from: 79, to: 107, regex: { source: "(.*)", format: "${1:/upcase}", flags: "" } },
    ]);
  });

  it("renders an empty mirror for a field that never appears", () => {
    expect(render("a${3/slug}b").text).toBe("ab");
  });

  it("inserts the selection", () => {
    expect(render("\\emph{${SELECTION}}", { selection: "word" }).text).toBe("\\emph{word}");
    expect(render("\\emph{${TM_SELECTED_TEXT}}", { selection: "a\nb" }).text).toBe("\\emph{a\nb}");
  });

  it("uses a fallback, with its fields, only for an empty value", () => {
    const empty = render("${SELECTION:${1:text}}");
    expect(empty.text).toBe("text");
    expect(empty.fields).toEqual([{ index: 1, ranges: [{ from: 0, to: 4 }] }]);
    const filled = render("${SELECTION:${1:text}}", { selection: "x" });
    expect(filled).toEqual({ text: "x", fields: [], mirrors: [], exit: 1 });
  });

  it("formats a date", () => {
    expect(render("${DATE:D MMMM YYYY}").text).toBe("25 November 2026");
    expect(render("${DATE}").text).toBe("2026-11-25");
  });

  it("resolves every listed variable", () => {
    const names = [
      "CURRENT_YEAR",
      "CURRENT_YEAR_SHORT",
      "CURRENT_MONTH",
      "CURRENT_MONTH_NAME",
      "CURRENT_MONTH_NAME_SHORT",
      "CURRENT_DATE",
      "CURRENT_DAY_NAME",
      "CURRENT_DAY_NAME_SHORT",
      "CURRENT_HOUR",
      "CURRENT_MINUTE",
      "CURRENT_SECOND",
      "TM_FILENAME",
      "TM_FILENAME_BASE",
      "CLIPBOARD",
      "LINE_COMMENT",
      "SELECTION",
      "PROJECT_NAME",
    ];
    const text = render(names.map((name) => `\${${name}}`).join("|"), { selection: "sel", clipboard: "clip" }).text;
    expect(text.split("|")).toEqual([
      "2026",
      "26",
      "11",
      "November",
      "Nov",
      "25",
      "Wednesday",
      "Wed",
      "09",
      "05",
      "03",
      "intro.tex",
      "intro",
      "clip",
      "%",
      "sel",
      "EdgeSense",
    ]);
  });

  it("makes one UUID and one random number per insertion", () => {
    const [first, second, random, again] = render("${UUID}|${UUID}|${RANDOM}|$RANDOM").text.split("|");
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
    expect(second).toBe(first);
    expect(random).toMatch(/^\d{6}$/u);
    expect(again).toBe(random);
  });

  it("skips random nibbles above 9 so every digit is equally likely", () => {
    const fill = (value: number) => ((array: Uint8Array) => array.fill(value)) as unknown as typeof crypto.getRandomValues;
    const spy = vi.spyOn(crypto, "getRandomValues").mockImplementationOnce(fill(0xff)).mockImplementationOnce(fill(0x21));
    expect(render("$RANDOM").text).toBe("121212");
    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });

  it("handles missing file and project names", () => {
    expect(render("${TM_FILENAME}|${TM_FILENAME_BASE}|${PROJECT_NAME}", { fileName: null, projectName: null }).text).toBe("||");
    expect(render("${TM_FILENAME_BASE}", { fileName: ".latexmkrc" }).text).toBe(".latexmkrc");
    expect(render("${TM_FILENAME_BASE}", { fileName: "C:\\paper\\main.typ" }).text).toBe("main");
  });

  it("transforms a variable", () => {
    expect(render("${TM_FILENAME/(.*)\\..+$/${1:/upcase}/}").text).toBe("INTRO");
  });

  it("writes an unknown variable's name unless it has a fallback", () => {
    expect(render("${TM_LINE_NUMBER}").text).toBe("TM_LINE_NUMBER");
    expect(render("${TM_LINE_NUMBER:3}").text).toBe("3");
  });

  it("inserts regex captures", () => {
    expect(render("[[0]]_[[1]][[2]]", { captures: ["x", "1"] }).text).toBe("x_1");
  });

  it("adds a second range when a field index repeats through nesting", () => {
    const rendered = renderBody(
      [
        { kind: "field", index: 1, placeholder: [{ kind: "text", text: "a" }] },
        { kind: "field", index: 1, placeholder: [{ kind: "text", text: "b" }] },
      ],
      ENV,
    );
    expect(rendered.fields).toEqual([
      {
        index: 1,
        ranges: [
          { from: 0, to: 1 },
          { from: 1, to: 2 },
        ],
      },
    ]);
  });

  it("renders an empty choice", () => {
    expect(renderBody([{ kind: "choice", index: 1, options: [] }], ENV).text).toBe("");
  });
});
