import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));

import {
  buildTypstInsights,
  fetchTypstDocumentInsights,
  formatSubmissionMetadata,
  hasSubmissionMetadata,
  type TypstDocumentInsightsResult,
  type TypstInsightElement,
} from "./typst-insights";

const MAIN = [
  '#import "lib.typ": conf',
  "#show: conf.with(",
  "  title: [Grain *boundary* creep],",
  '  authors: ((name: "Elin Hagstrom"), (name: "Rafael Pinto")),',
  '  keywords: ("creep", "niobium"),',
  ")",
  "= Introduction <sec:intro>",
  "Creep matters @smith2020 and @fig:rig. // TODO: cite the 1956 paper",
  '#include "sections/results.typ"',
  "",
].join("\n");

const RESULTS = [
  "= Results",
  "$ E = m c^2 $ <eq:energy>",
  "$ a + b $",
  "#figure(image(\"rig.png\"), caption: [The rig]) <fig:rig>",
  "#figure(table(columns: 1, [x]), caption: [Creep rates])",
  "Inline $x$ is not listed. #cite(<smith2020>)",
  "/* FIXME: redo the fit */",
  '#raw("TODO inside a string")',
  "- remember <note:item>",
  "",
].join("\n");

const LIB = "#let conf(title: none, authors: (), keywords: (), body) = body\n";

function element(partial: Partial<TypstInsightElement> & Pick<TypstInsightElement, "kind" | "text">): TypstInsightElement {
  return { label: null, level: null, figureKind: null, numbered: true, page: null, ...partial };
}

const COMPILED: TypstDocumentInsightsResult = {
  status: "ready",
  typstVersion: "0.15.1",
  method: "eval",
  truncated: false,
  elements: [
    element({ kind: "heading", text: "Introduction", label: "sec:intro", level: 1, page: 1 }),
    element({ kind: "citation", text: "smith2020" }),
    element({ kind: "heading", text: "Results", level: 1, page: 2 }),
    element({ kind: "equation", text: "E = m c2", label: "eq:energy", page: 2 }),
    element({ kind: "equation", text: "a + b", page: 2 }),
    element({ kind: "figure", text: "The rig", label: "fig:rig", figureKind: "image", page: 2 }),
    element({ kind: "figure", text: "Creep rates", figureKind: "table", page: 3 }),
    element({ kind: "citation", text: "smith2020" }),
    element({ kind: "heading", text: "References", level: 1, numbered: false, page: 4 }),
  ],
};

const TEXTS = { "main.typ": MAIN, "sections/results.typ": RESULTS, "lib.typ": LIB, "refs.bib": "@book{x}" };

describe("buildTypstInsights", () => {
  it("lists compiled elements and points each one at its source", async () => {
    const insights = await buildTypstInsights("main.typ", TEXTS, COMPILED);
    expect(insights.headings.map((entry) => [entry.text, entry.location])).toEqual([
      ["Introduction", { path: "main.typ", line: 7, column: 1 }],
      ["Results", { path: "sections/results.typ", line: 1, column: 1 }],
      ["References", null],
    ]);
    expect(insights.equations.map((entry) => [entry.text, entry.label, entry.location?.line])).toEqual([
      ["E = m c^2", "eq:energy", 2],
      ["a + b", null, 3],
    ]);
    expect(insights.figures).toHaveLength(1);
    expect(insights.figures[0]).toMatchObject({ text: "The rig", page: 2, location: { path: "sections/results.typ", line: 4 } });
    expect(insights.tables).toHaveLength(1);
    expect(insights.tables[0]).toMatchObject({ text: "Creep rates", location: { path: "sections/results.typ", line: 5 } });
  });

  it("counts citations and finds where each key is first used", async () => {
    const insights = await buildTypstInsights("main.typ", TEXTS, COMPILED);
    expect(insights.citations).toEqual([
      { key: "smith2020", count: 2, location: { path: "main.typ", line: 8, column: 15 } },
    ]);
  });

  it("drops trailing dots and colons from a reference key", async () => {
    const compiled: TypstDocumentInsightsResult = {
      ...COMPILED,
      elements: [element({ kind: "citation", text: "smith" }), element({ kind: "citation", text: "a.b:c" })],
    };
    const main = ["Intro.", "See @smith.:. and @a.b:c:..", ""].join("\n");
    const insights = await buildTypstInsights("main.typ", { "main.typ": main }, compiled);
    expect(insights.citations).toEqual([
      { key: "smith", count: 1, location: { path: "main.typ", line: 2, column: 5 } },
      { key: "a.b:c", count: 1, location: { path: "main.typ", line: 2, column: 19 } },
    ]);
  });

  it("lists compiled labels first, then labels only the source has", async () => {
    const insights = await buildTypstInsights("main.typ", TEXTS, COMPILED);
    expect(insights.labels.map((label) => [label.name, label.kind, label.location?.path, label.location?.line])).toEqual([
      ["sec:intro", "heading", "main.typ", 7],
      ["eq:energy", "equation", "sections/results.typ", 2],
      ["fig:rig", "figure", "sections/results.typ", 4],
      ["note:item", "other", "sections/results.typ", 9],
    ]);
  });

  it("collects TODO and FIXME notes outside strings", async () => {
    const insights = await buildTypstInsights("main.typ", TEXTS, COMPILED);
    expect(insights.todos).toEqual([
      { text: "TODO: cite the 1956 paper", location: { path: "main.typ", line: 8, column: 43 } },
      { text: "FIXME: redo the fit", location: { path: "sections/results.typ", line: 7, column: 4 } },
    ]);
  });

  it("reads submission metadata from the template arguments", async () => {
    const { metadata } = await buildTypstInsights("main.typ", TEXTS, COMPILED);
    expect(metadata).toEqual({
      title: "Grain boundary creep",
      authors: ["Elin Hagstrom", "Rafael Pinto"],
      abstract: null,
      keywords: ["creep", "niobium"],
      date: null,
    });
  });

  it("falls back to the document set rule and an Abstract heading", async () => {
    const main = [
      '#set document(title: "Plain title", author: "Solo Author", keywords: "a, b; c")',
      "= Abstract",
      "We show *one* thing.",
      "",
      "And another.",
      "= Introduction",
      "Body.",
    ].join("\n");
    const { metadata, headings } = await buildTypstInsights("main.typ", { "main.typ": main }, null);
    expect(metadata).toEqual({
      title: "Plain title",
      authors: ["Solo Author"],
      abstract: "We show one thing. And another.",
      keywords: ["a", "b", "c"],
      date: null,
    });
    expect(headings).toEqual([]);
  });

  it("keeps source findings when the compile failed", async () => {
    const failed: TypstDocumentInsightsResult = {
      status: "failed",
      typstVersion: "0.13.1",
      method: "query",
      diagnostics: [{ message: "unknown variable", file: "main.typ", line: 2, column: 1 }],
    };
    const insights = await buildTypstInsights("main.typ", TEXTS, failed);
    expect(insights.headings).toEqual([]);
    expect(insights.todos).toHaveLength(2);
    expect(insights.labels.map((label) => label.kind)).toEqual(["other", "other", "other", "other"]);
    expect(insights.compiled).toBe(failed);
  });
});

describe("submission metadata text", () => {
  const labels = { title: "Title", authors: "Authors", keywords: "Keywords", abstract: "Abstract" };

  it("formats only the fields that are present", () => {
    expect(
      formatSubmissionMetadata(
        { title: "T", authors: ["A", "B"], abstract: "Text.", keywords: ["k"], date: null },
        labels,
      ),
    ).toBe("Title: T\nAuthors: A, B\nKeywords: k\n\nAbstract:\nText.");
    expect(formatSubmissionMetadata({ title: null, authors: [], abstract: null, keywords: ["k"], date: null }, labels)).toBe(
      "Keywords: k",
    );
  });

  it("knows when there is nothing to copy", () => {
    expect(hasSubmissionMetadata({ title: null, authors: [], abstract: null, keywords: [], date: "2026" })).toBe(false);
    expect(hasSubmissionMetadata({ title: "T", authors: [], abstract: null, keywords: [], date: null })).toBe(true);
  });
});

describe("fetchTypstDocumentInsights", () => {
  it("asks the backend for the project's insights", async () => {
    mocks.invoke.mockResolvedValue(COMPILED);
    await expect(fetchTypstDocumentInsights("paper", true)).resolves.toBe(COMPILED);
    expect(mocks.invoke).toHaveBeenCalledWith("typst_document_insights", { projectId: "paper", offline: true });
  });

  it("names the chosen build variant so insights read the same inputs as the compile", async () => {
    mocks.invoke.mockResolvedValue(COMPILED);
    await fetchTypstDocumentInsights("paper", false, "camera-ready");
    expect(mocks.invoke).toHaveBeenCalledWith("typst_document_insights", {
      projectId: "paper",
      offline: false,
      typstVariant: "camera-ready",
    });
  });
});
