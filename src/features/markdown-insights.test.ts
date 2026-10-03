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
