import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { scanTypstDocument, typstDocumentSummary } from "@/lib/document-stats-typst";

interface TypstCase {
  name: string;
  source: string;
  expected: ReturnType<typeof typstDocumentSummary>;
}

const cases = JSON.parse(
  readFileSync(
    path.join(process.cwd(), "src-tauri/src/fixtures/document-stats/typst-cases.json"),
    "utf8",
  ),
) as TypstCase[];

describe("Typst document summary shared with the Rust counter", () => {
  it.each(cases.map((entry) => [entry.name, entry] as const))("%s", (_name, entry) => {
    expect(typstDocumentSummary(entry.source)).toEqual(entry.expected);
  });
});

describe("Typst structure scan", () => {
  it("keeps the source length and line breaks in the code-free text", () => {
    const source = "#let x = 1\nBody #emph[shown] text.\r\n#set page(width: 5cm)\n";
    const { prose } = scanTypstDocument(source);
    expect(prose).toHaveLength(source.length);
    expect(prose.split("\n")).toHaveLength(source.split("\n").length);
    expect(prose).toContain("shown");
    expect(prose).not.toContain("let");
    expect(prose).not.toContain("width");
  });

  it("does not let a quote in a content argument swallow the document", () => {
    const summary = typstDocumentSummary(
      '#table(columns: 2, [5" wide], [b])\nLater paragraph text here.\n',
    );
    expect(summary.words).toBe(6);
    expect(summary.tables).toBe(1);
  });

  it("ignores structure inside set rules and definitions", () => {
    const summary = typstDocumentSummary(
      "#set figure(gap: 1em)\n#let fig(body) = figure(body, caption: [Hidden])\n#show table: set text(size: 9pt)\n",
    );
    expect(summary.figures).toBe(0);
    expect(summary.tables).toBe(0);
    expect(summary.words).toBe(0);
  });

  it.each([
    ["label openers", "<".repeat(200_000)],
    ["label names", "<a".repeat(100_000)],
    ["unclosed calls", "#f(".repeat(70_000)],
    ["unclosed content", "#f[".repeat(70_000)],
    ["nested content", "#f([".repeat(50_000)],
    ["nested brackets", "[".repeat(200_000)],
    ["quotes in content", `#f[${'"'.repeat(200_000)}]`],
    ["context chains", "#context ".repeat(25_000)],
    ["if chains", "#if a [b] else ".repeat(15_000)],
    ["escapes", "\\u{".repeat(70_000)],
    ["hash runs", "#".repeat(200_000)],
    ["raw fences", `${"`".repeat(1_000)}x${"`".repeat(999)}y`.repeat(100)],
    ["caption lookbacks", `#f(${"caption:     [a] ".repeat(10_000)})`],
    ["autolink tails", `http://a${".".repeat(200_000)}`],
  ])("stays linear on %s", (_name, source) => {
    const started = performance.now();
    const { prose } = scanTypstDocument(source);
    expect(prose).toHaveLength(source.length);
    expect(performance.now() - started).toBeLessThan(2_000);
  });
});
