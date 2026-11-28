import { parseSnippetFile, type SnippetRecord } from "@oleafly/snippets";
import { setEditorTranslator } from "@oleafly/editor";
import { testCatalogTranslator } from "@oleafly/i18n-contract/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { i18n } from "@/i18n";
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };
import {
  collectionName,
  expandLabel,
  isMathPlace,
  languageLabel,
  placeLabel,
  snippetBody,
  snippetFits,
  searchTerms,
  snippetMatchesTerms,
  snippetMathSource,
  snippetName,
  snippetSearchText,
  snippetSource,
  snippetText,
  USER_COLLECTION,
  userCollections,
} from "./records";

function record(entry: Record<string, unknown>, id = "test.record"): SnippetRecord {
  const parsed = parseSnippetFile(JSON.stringify({ [id]: entry }), "mine", "user");
  return parsed.records[0];
}

const FRACTION = record({ name: "Fraction", prefix: "//", body: "\\frac{$1}{$2}$0", languages: ["latex"], where: "math" });
const FIGURE = record({
  name: "Figure",
  prefix: "fig",
  description: "Figure with caption",
  body: { latex: `\\begin{figure}\${1:x}\\end{figure}`, typst: `#figure(\${1:x})` },
});

beforeAll(() => setEditorTranslator(testCatalogTranslator("editor")));
afterAll(() => setEditorTranslator(null));

describe("snippet records", () => {
  it("names a built-in by its translated message and anything else by its own name", () => {
    expect(snippetName(record({ name: "Section", nameKey: "latex.snippet.section", body: "x" }))).toBe("Section");
    expect(snippetName(record({ name: "Mine", nameKey: "not.a.key", body: "x" }))).toBe("Mine");
    setEditorTranslator(null);
    expect(snippetName(record({ name: "Section heading", nameKey: "latex.snippet.section", body: "x" }))).toBe("Section heading");
    setEditorTranslator(testCatalogTranslator("editor"));
  });

  it("knows which languages a snippet fits", () => {
    expect(snippetFits(FRACTION, "latex")).toBe(true);
    expect(snippetFits(FRACTION, "typst")).toBe(false);
    expect(snippetFits(FRACTION, null)).toBe(false);
    expect(snippetFits(record({ body: "x" }), "notes")).toBe(true);
  });

  it("picks the body for the language, then the shared body, then any body", () => {
    expect(snippetSource(FIGURE, "typst")).toBe(`#figure(\${1:x})`);
    expect(snippetSource(FIGURE, "markdown")).toBe(`\\begin{figure}\${1:x}\\end{figure}`);
    expect(snippetSource(FRACTION, null)).toBe("\\frac{$1}{$2}$0");
    expect(snippetBody({ ...FRACTION, bodies: {} }, "latex")).toBeNull();
    expect(snippetSource({ ...FRACTION, bodies: {} }, "latex")).toBe("");
  });

  it("renders the plain text a snippet writes", () => {
    expect(snippetText(FIGURE, "latex")).toBe("\\begin{figure}x\\end{figure}");
    expect(snippetText(record({ body: `\${LINE_COMMENT} note` }), "typst")).toBe("// note");
    expect(snippetText(record({ body: `\${LINE_COMMENT} note` }), "bibtex")).toBe("% note");
    expect(snippetText(record({ body: `\${DATE:YYYY}` }), "latex", new Date(2026, 10, 25))).toBe("2026");
    expect(snippetText({ ...FRACTION, bodies: {} }, "latex")).toBe("");
  });

  it("fills empty fields with a box for a math preview", () => {
    expect(snippetMathSource(FRACTION, "latex")).toBe("\\frac{\\square}{\\square}");
    expect(snippetMathSource(record({ body: "sqrt($1)" }), "typst")).toBe("sqrt(square)");
    expect(snippetMathSource(record({ body: `\${1:a \${2}} \${3@label} \${4@cite:key}` }), null)).toBe("a \\square \\square key");
    expect(snippetMathSource({ ...FRACTION, bodies: {} }, "latex")).toBe("");
  });

  it("matches every search word against name, trigger, description and body", () => {
    const matches = (record: SnippetRecord, query: string) => snippetMatchesTerms(record, searchTerms(query));
    expect(searchTerms("  ")).toEqual([]);
    expect(matches(FIGURE, "")).toBe(true);
    expect(matches(FIGURE, "FIG caption")).toBe(true);
    expect(matches(FIGURE, "#figure")).toBe(true);
    expect(matches(FRACTION, "fraction")).toBe(true);
    expect(matches(FRACTION, "frac //")).toBe(true);
    expect(matches(FRACTION, "figure")).toBe(false);
  });

  it("searches the names shown in the current language", () => {
    const named = record({ name: "Fraction", nameKey: "latex.snippet.frac", body: "x" });
    const before = i18n.language;
    setEditorTranslator(() => (i18n.language === "de" ? "Bruch" : "Fraction"));
    try {
      expect(snippetSearchText(named)).toContain("fraction");
      i18n.language = "de";
      expect(snippetSearchText(named)).toContain("bruch");
    } finally {
      i18n.language = before;
      setEditorTranslator(testCatalogTranslator("editor"));
    }
  });

  it("names collections", () => {
    const files = parseSnippetFile('{"$pack": {"name": "Fast math · LaTeX"}}', "fast-math-latex", "pack");
    expect(collectionName(USER_COLLECTION, [])).toBe(enShell.snippets.mySnippets);
    expect(collectionName("fast-math-latex", [files])).toBe("Fast math · LaTeX");
    expect(collectionName("imported", [files])).toBe("imported");
    const paper = parseSnippetFile('{"$pack": {"name": "Paper", "nameKey": "snippets.packs.paperStructure"}}', "paper-structure", "pack");
    const unknown = parseSnippetFile('{"$pack": {"name": "Mine", "nameKey": "snippets.packs.nope"}}', "mine", "pack");
    expect(collectionName("paper-structure", [paper])).toBe("Paper structure");
    expect(collectionName("mine", [unknown])).toBe("Mine");
  });

  it("labels expand modes, languages and places", () => {
    expect(expandLabel("auto")).toBe(enShell.snippets.expands.auto);
    expect(languageLabel("bibtex")).toBe("BibTeX");
    expect(languageLabel("any")).toBe(enShell.snippets.languages.any);
    expect(placeLabel("inline-math")).toBe(enShell.snippets.places["inline-math"]);
    expect(isMathPlace("display-math")).toBe(true);
    expect(isMathPlace("math")).toBe(true);
    expect(isMathPlace("text")).toBe(false);
  });

  it("lists My snippets first and the user's other files after it", () => {
    expect(userCollections([])).toEqual([USER_COLLECTION]);
    expect(userCollections([{ name: "_state.json" }, { name: "imported.json" }, { name: "my-snippets.json" }])).toEqual([
      USER_COLLECTION,
      "imported",
    ]);
  });
});
