import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildMarkdownInsights, missingMarkdownSources, parseFrontMatter } from "./markdown-insights";

const LINES = [
  "---",
  'title: "Creep in *Niobium*"',
  "author:",
  "  - name: Elin Hagstrom",
  "    affiliation: Lund",
  "  - Rafael Pinto",
  "abstract: |",
  "  We study creep",
  "  in alloys.",
  "",
  "  Second paragraph.",
  "keywords: [creep, niobium] # two",
  "date: 2026-03-01",
  "bibliography: refs.bib",
  "---",
  "",
  "# Introduction {#sec:intro}",
  "",
  "Creep matters [@smith2020; @jones2019] and @smith2020 shows it. See @fig:rig.",
  "Mail a@b.com or see https://example.com/@user. <!-- TODO: cite the 1956 paper -->",
  "",
  "![The *test* rig](rig.png){#fig:rig width=50%}",
  "",
  "An inline ![icon](icon.png) image and `@code` text.",
  "",
  "Results",
  "-------",
  "",
  "| Method | Score |",
  "|---|---:|",
  "| a | 1 |",
  "",
  "Table: Creep rates {#tbl:rates}",
  "",
  "$$",
  "E = mc^2",
  "$$ {#eq:energy}",
  "",
  "$$ a + b $$",
  "",
  "+---+---+",
  "| a | b |",
  "+===+===+",
  "| 1 | 2 |",
  "+---+---+",
  "",
  "```python",
  "# TODO not here [@ghost]",
  "```",
  "",
  "# Appendix {.unnumbered}",
  "",
  "FIXME: redo the fit [-@ghost, p. 3].",
  "",
  "::: {#thm:bound}",
  "Bounded.",
  ":::",
  "",
];
const MAIN = LINES.join("\n");
const line = (prefix: string) => LINES.findIndex((candidate) => candidate.startsWith(prefix)) + 1;
const REFS = "@article{smith2020, title={A}}\n@book{jones2019, title={B}}\n";
const TEXTS = { "paper.md": MAIN, "refs.bib": REFS };

describe("parseFrontMatter", () => {
  it("reads scalars, lists, mappings and block scalars", () => {
    const front = parseFrontMatter(MAIN);
    expect(front?.endLine).toBe(15);
    expect(front?.values).toEqual({
      title: "Creep in *Niobium*",
      author: [{ name: "Elin Hagstrom", affiliation: "Lund" }, "Rafael Pinto"],
      abstract: "We study creep\nin alloys.\n\nSecond paragraph.\n",
      keywords: ["creep", "niobium"],
      date: "2026-03-01",
      bibliography: "refs.bib",
    });
  });

  it("handles folded scalars, quotes, comments and nested lists", () => {
    const front = parseFrontMatter(
      [
        "---",
        "# a comment",
        "title: 'It''s here'",
        "subtitle: >-",
        "  folded",
        "  line",
        "keywords:",
        "- one",
        "- 'two, three'",
        "authors: Ada Lovelace",
        "...",
        "body",
      ].join("\n"),
    );
    expect(front?.values).toEqual({
      title: "It's here",
      subtitle: "folded line",
      keywords: ["one", "two, three"],
      authors: "Ada Lovelace",
    });
    expect(front?.endLine).toBe(11);
  });

  it("returns null without front matter", () => {
    expect(parseFrontMatter("# Title\n")).toBeNull();
    expect(parseFrontMatter("---\ntitle: open\n")).toBeNull();
  });
});

describe("buildMarkdownInsights", () => {
  const insights = buildMarkdownInsights({ mainDoc: "paper.md", texts: TEXTS });

  it("lists ATX and setext headings with ids", () => {
    expect(insights.headings.map((entry) => [entry.text, entry.level, entry.label, entry.numbered])).toEqual([
      ["Introduction", 1, "sec:intro", true],
      ["Results", 2, null, true],
      ["Appendix", 1, null, false],
    ]);
    expect(insights.headings[0].location).toEqual({ path: "paper.md", line: line("# Introduction"), column: 1 });
  });

  it("lists standalone images as figures and captioned tables", () => {
    expect(insights.figures.map((entry) => [entry.text, entry.label, entry.numbered])).toEqual([["The test rig", "fig:rig", true]]);
    expect(insights.figures[0].location).toEqual({ path: "paper.md", line: line("![The"), column: 1 });
    expect(insights.tables.map((entry) => [entry.text, entry.label, entry.numbered])).toEqual([
      ["Creep rates", "tbl:rates", true],
      ["", null, false],
    ]);
    expect(insights.tables[0].location?.line).toBe(line("| Method"));
    expect(insights.tables[1].location?.line).toBe(line("+---+---+"));
  });

  it("lists display math with crossref ids", () => {
    expect(insights.equations.map((entry) => [entry.text, entry.label, entry.numbered])).toEqual([
      ["E = mc^2", "eq:energy", false],
      ["a + b", null, false],
    ]);
    expect(insights.equations[0].location?.line).toBe(line("$$") );
  });

  it("collects ids with their kinds", () => {
    expect(insights.labels.map((label) => [label.name, label.kind])).toEqual([
      ["sec:intro", "heading"],
      ["fig:rig", "figure"],
      ["tbl:rates", "table"],
      ["eq:energy", "equation"],
      ["thm:bound", "other"],
    ]);
  });

  it("counts citations, skips cross-references, mail, URLs and code", () => {
    expect(insights.citations).toEqual([
      { key: "smith2020", count: 2, unresolved: false, location: { path: "paper.md", line: line("Creep matters"), column: 16 } },
      { key: "jones2019", count: 1, unresolved: false, location: { path: "paper.md", line: line("Creep matters"), column: 28 } },
      { key: "ghost", count: 1, unresolved: true, location: { path: "paper.md", line: line("FIXME"), column: 23 } },
    ]);
  });

  it("collects TODO and FIXME notes outside code", () => {
    expect(insights.todos.map((todo) => [todo.text, todo.location.line])).toEqual([
      ["TODO: cite the 1956 paper", line("Mail a@b.com")],
      ["FIXME: redo the fit [-@ghost, p. 3].", line("FIXME")],
    ]);
  });

  it("reads files saved with Windows line endings", () => {
    const text = "---\r\ntitle: Notes\r\n---\r\n\r\n# Setup\r\n\r\nTODO: check\r\n";
    const insights = buildMarkdownInsights({ mainDoc: "notes.md", texts: { "notes.md": text } });
    expect(insights.headings.map((entry) => entry.text)).toEqual(["Setup"]);
    expect(insights.metadata.title).toBe("Notes");
    expect(insights.todos.map((todo) => todo.text)).toEqual(["TODO: check"]);
  });

  it("ends an HTML comment at --!> as well as -->", () => {
    const text = "<!-- TODO: hidden --!> shown\n<!--\nTODO: inside --!> after\n";
    const notes = buildMarkdownInsights({ mainDoc: "notes.md", texts: { "notes.md": text } }).todos;
    expect(notes.map((todo) => todo.text)).toEqual(["TODO: hidden", "TODO: inside"]);
  });

  it("reads the submission metadata from the front matter", () => {
    expect(insights.metadata).toEqual({
      title: "Creep in Niobium",
      authors: ["Elin Hagstrom", "Rafael Pinto"],
      abstract: "We study creep in alloys.\n\nSecond paragraph.",
      keywords: ["creep", "niobium"],
      date: "2026-03-01",
    });
  });

  it("splits keyword strings and reads inline references", () => {
    const main = "---\nkeywords: creep; niobium\nreferences:\n  - id: inline2020\n    title: X\n---\n\nSee [@inline2020] and [@other].\n";
    const result = buildMarkdownInsights({ mainDoc: "a.md", texts: { "a.md": main } });
    expect(result.metadata.keywords).toEqual(["creep", "niobium"]);
    expect(result.citations.map((citation) => [citation.key, citation.unresolved])).toEqual([
      ["inline2020", false],
      ["other", true],
    ]);
  });

  it("does not flag citations when a declared bibliography is not loaded", () => {
    const main = "---\nbibliography: refs.json\n---\n\nSee [@smith2020].\n";
    expect(buildMarkdownInsights({ mainDoc: "a.md", texts: { "a.md": main } }).citations[0].unresolved).toBeUndefined();
    expect(missingMarkdownSources("a.md", { "a.md": main })).toEqual(["refs.json"]);
    const json = '[{"id": "smith2020", "type": "book"}]';
    const loaded = buildMarkdownInsights({ mainDoc: "a.md", texts: { "a.md": main, "refs.json": json } });
    expect(loaded.citations[0].unresolved).toBe(false);
    expect(missingMarkdownSources("a.md", { "a.md": main, "refs.json": json })).toEqual([]);
  });

  it("reads the conversion fixture", () => {
    const root = join(process.cwd(), "fixtures/conversion-matrix");
    const result = buildMarkdownInsights({
      mainDoc: "math-citations.md",
      texts: {
        "math-citations.md": readFileSync(join(root, "math-citations.md"), "utf8"),
        "refs.bib": readFileSync(join(root, "refs.bib"), "utf8"),
      },
    });
    expect(result.metadata.title).toBe("Citation and Math Fixture");
    expect(result.headings.map((heading) => heading.text)).toEqual(["Setup", "Math", "Tables", "Diagrams (graceful handling)"]);
    expect(result.equations).toHaveLength(2);
    expect(result.tables).toHaveLength(1);
    expect(result.citations.map((citation) => citation.key)).toEqual(["vaswani2017attention", "knuth1984literate"]);
  });
});

function insightsFor(text: string, extra: Record<string, string> = {}) {
  return buildMarkdownInsights({ mainDoc: "a.md", texts: { "a.md": text, ...extra } });
}

describe("buildMarkdownInsights edge cases", () => {
  it.each([
    ["# Title", 1, "Title"],
    ["   ###### Six   ", 6, "Six"],
    ["    # Four spaces", null, null],
    ["####### Seven", null, null],
    ["#NoSpace", null, null],
    ["#", 1, ""],
    ["##\t", 2, ""],
    ["# Title ##", 1, "Title"],
    ["# Title#", 1, "Title#"],
    [String.raw`# Title \#`, 1, "Title #"],
    ["# ##", 1, ""],
    ["# a ## b ##  ", 1, "a ## b"],
    ["# Title {#sec:x}", 1, "Title"],
    ["# Title\rmore", null, null],
    ["\t# Tab", null, null],
  ])("reads the ATX heading %j", (line, level, text) => {
    const headings = insightsFor(`${line}\n`).headings;
    expect(headings.map((heading) => [heading.level, heading.text])).toEqual(level === null ? [] : [[level, text]]);
  });

  it.each([
    ["|a|b|\n|---|:-:|", true],
    ["a | b\n- | --", true],
    ["a | b\n:--:", true],
    ["a | b\n| -- || -- |", false],
    ["a | b\n|", false],
    ["a | b\n| : |", false],
    ["a | b\n| - - |", false],
    ["a | b\n --- | --- \t", true],
    ["a | b\n|-|", true],
    ["a | b\n||-", false],
    ["a | b\n-||", false],
  ])("decides whether %j is a pipe table", (text, table) => {
    expect(insightsFor(`\n${text}\n`).tables).toHaveLength(table ? 1 : 0);
  });

  it.each([
    ["Table: Rates {#tbl:a}", "Rates", "tbl:a"],
    ["table:  lower", "lower", null],
    ["  : Bare caption", "Bare caption", null],
    ["Table:NoSpace", "", null],
    ["Tables: plural", "", null],
    [": ", "", null],
  ])("reads the table caption %j", (caption, text, label) => {
    const [table] = insightsFor(`\n| a | b |\n|---|---|\n| 1 | 2 |\n\n${caption}\n`).tables;
    expect([table.text, table.label]).toEqual([text, label]);
  });

  it.each([
    ["![Alt](a.png)", "Alt", 1],
    ["![Alt [x] y](a.png)", "Alt [x] y", 1],
    ["![Alt [[x]] y](a.png)", null, 0],
    ["![Alt](a.png \"Title\")", "Alt", 1],
    ["![](a.png 'Only title')", "Only title", 1],
    ["![](a.png \"Dbl\"){#fig:t}", "Dbl", 1],
    ["![Alt]( <a b.png> )", null, 0],
    ["![Alt](<a.png>){#fig:x .wide}", "Alt", 1],
    ["![Alt]( \"quoted url\" )", "Alt", 1],
    ["![]( \"t i t\")", "t i t", 1],
    ["![Alt](a.png \"unclosed)", null, 0],
    ["![Alt](a.png){#fig:a", null, 0],
    ["![Alt](a.png) trailing", null, 0],
    ["![Alt](a.png)![B](b.png)", null, 0],
    ["![Alt\n", null, 0],
  ])("reads the standalone image %j", (line, caption, count) => {
    const figures = insightsFor(`\n${line}\n`).figures;
    expect(figures).toHaveLength(count);
    if (caption !== null) expect(figures[0].text).toBe(caption);
  });

  it("finds figure ids and keeps citations around images", () => {
    const figures = insightsFor("\n![Alt](a.png \"T\"){#fig:z width=3}\n").figures;
    expect(figures.map((figure) => [figure.label, figure.location?.column])).toEqual([["fig:z", 1]]);
    const cites = insightsFor("See ![x](a.png) and [@k] with ![y](b.png 'z') @m.\n").citations;
    expect(cites.map((citation) => [citation.key, citation.location?.column])).toEqual([
      ["k", 22],
      ["m", 47],
    ]);
  });

  it.each([
    ["[link](http://x) text", "link text"],
    ["![img](a.png) after", "img after"],
    ["[a [b](c) d", "a [b d"],
    ["[a] (b) [c](d)", "[a] (b) c"],
    ["[a](b [c](d)", "a"],
    ["[no close", "[no close"],
    ["[a](no close", "[a](no close"],
    ["![x]y [z](w)", "![x]y z"],
  ])("turns links in the title %j into their text", (title, plain) => {
    expect(insightsFor(`---\ntitle: "${title}"\n---\n`).metadata.title).toBe(plain);
  });

  it.each([
    ["a: b", { a: "b" }],
    ["a  :  b  c", { a: "b  c" }],
    ['"quoted key": v', { "quoted key": "v" }],
    ["'single key' : v", { "single key": "v" }],
    ["a b: c", { "a b": "c" }],
    ["a:b", {}],
    ["a:", { a: "" }],
    ["#a: b", {}],
    ['"open: b', {}],
    ["key: value # note", { key: "value" }],
    ["url: http://x:80/y", { url: "http://x:80/y" }],
  ])("reads the front matter line %j", (line, values) => {
    expect(parseFrontMatter(`---\n${line}\n---\n`)?.values).toEqual(values);
  });

  it("reads chomping and nested values in the front matter", () => {
    const front = parseFrontMatter(
      [
        "---",
        "keep: |+",
        "  kept",
        "",
        "strip: >-",
        "  a",
        "  b",
        "",
        "  c",
        "clip: |",
        "  x",
        "flow: [a, {b: c}, 'd, e']",
        "multi: [one,",
        "  two]",
        "map:",
        "  inner: 1",
        "  deeper:",
        "    - x",
        "    - y: z",
        "empty:",
        "quoted: \"two",
        "  lines\"",
        "plain: first",
        "  second",
        "---",
      ].join("\n"),
    );
    expect(front?.values).toEqual({
      keep: "kept\n",
      strip: "a b\nc",
      clip: "x\n",
      flow: ["a", { b: "c" }, "d, e"],
      multi: ["one", "two"],
      map: { inner: "1", deeper: ["x", { y: "z" }] },
      empty: "",
      quoted: "two lines",
      plain: "first second",
    });
  });

  it.each([
    ["refs.yaml", "- id: one\n-   id :  'two'\n  - id: \"three\"\nid: four # c\n\n\n   id: five\nnot id: six\n- id:\n", ["one", "two", "three", "four", "five"]],
    ["refs.yml", "- id: a\r- id: b\u2028- id: c", ["a", "b", "c"]],
    ["refs.json", '[{"id": "j1"}, {"id" : "j2"}]', ["j1", "j2"]],
  ])("reads the reference ids in %s", (path, text, ids) => {
    const cited = ids.map((id) => `[@${id}]`).join(" ");
    const main = `---\nbibliography: ${path}\n---\n\n${cited} [@missing]\n`;
    const citations = insightsFor(main, { [path]: text }).citations;
    expect(citations.filter((citation) => citation.unresolved === false).map((citation) => citation.key)).toEqual(ids);
    expect(citations.at(-1)).toMatchObject({ key: "missing", unresolved: true });
  });

  it("strips trailing punctuation from citation keys and keeps braced keys whole", () => {
    const citations = insightsFor("See @smith2020., @jones?! @{odd.key.} and @lee/-.\n").citations;
    expect(citations.map((citation) => citation.key)).toEqual(["smith2020", "jones", "odd.key.", "lee"]);
  });

  it("reads trailing attributes on headings and display math", () => {
    const insights = insightsFor("# A {#sec:a}  \n\n# B {.unnumbered}\n\n# C {x}\n\n$$ x $$ \t{#eq:x}\n\n# D {#sec:d} tail\n");
    expect(insights.headings.map((heading) => [heading.text, heading.label, heading.numbered])).toEqual([
      ["A", "sec:a", true],
      ["B", null, false],
      ["C {x}", null, true],
      ["D {#sec:d} tail", null, true],
    ]);
    expect(insights.equations.map((equation) => equation.label)).toEqual(["eq:x"]);
  });

  it("handles long lines of spaces, brackets and hashes", () => {
    const text = [
      `#${" ".repeat(20000)}x${" ".repeat(20000)}\u2028`,
      `![${"[".repeat(5000)}`,
      `${"[a]".repeat(5000)}`,
      `Table:${" ".repeat(20000)}\u2028x`,
      `| ${"- ".repeat(10000)}x`,
      `x${" ".repeat(20000)}{y}z`,
      `key${" ".repeat(20000)}value`,
    ].join("\n");
    insightsFor(`---\ntitle: "${"[x".repeat(5000)}"\n${"k ".repeat(10000)}\n---\n${text}\n`, {
      "refs.yaml": `${"\n".repeat(5000)}${" ".repeat(5000)}x`,
    });
  });
});
