import { describe, expect, it } from "vitest";
import { languageServiceContribution } from "./language-service-contribution";

const identity = { projectId: "p", projectRevision: 1, requestGeneration: 1 };

function definitionNames(source: string, name: string): string[] {
  const line = source.split("\n").length - 1;
  const result = languageServiceContribution({
    identity,
    provider: "texlab",
    workspaceRoot: "/project",
    texts: new Map([["main.tex", source]]),
    symbols: [
      {
        name,
        kind: 12,
        location: {
          uri: "file:///project/main.tex",
          range: {
            start: { line: 0, character: 0 },
            end: { line, character: source.split("\n").at(-1)?.length ?? 0 },
          },
        },
      },
    ],
  });
  return result.definitions.map((definition) => `${definition.kind}:${definition.name}`);
}

describe("languageServiceContribution", () => {
  it("keeps Unicode letters in XeTeX macro names", () => {
    expect(definitionNames(String.raw`\newcommand{\výsledek}{42}`, "výsledek")).toEqual(["macro:výsledek"]);
    expect(definitionNames(String.raw`\def\αβ{AB}`, "αβ")).toEqual(["macro:αβ"]);
    expect(definitionNames(String.raw`\newcommand{\foo}{x}`, "foo")).toEqual(["macro:foo"]);
  });
});

type RawSymbol = { name: string; kind: number; line: number; from: number; to: number; endLine?: number; uri?: string };

function contribute(
  texts: Record<string, string>,
  symbols: RawSymbol[] | unknown,
  options: { provider?: "texlab" | "tinymist"; workspaceRoot?: string } = {},
) {
  const root = options.workspaceRoot ?? "/project";
  const raw = Array.isArray(symbols)
    ? symbols.map((symbol: RawSymbol) => ({
        name: symbol.name,
        kind: symbol.kind,
        location: {
          uri: symbol.uri ?? "file:///project/main.tex",
          range: {
            start: { line: symbol.line, character: symbol.from },
            end: { line: symbol.endLine ?? symbol.line, character: symbol.to },
          },
        },
      }))
    : symbols;
  return languageServiceContribution({
    identity,
    provider: options.provider ?? "texlab",
    workspaceRoot: root,
    texts: new Map(Object.entries(texts)),
    symbols: raw as never,
  });
}

const summary = (result: ReturnType<typeof contribute>) =>
  result.definitions.map((definition) => [definition.kind, definition.name, definition.level ?? null]);

describe("LaTeX symbol recovery", () => {
  const source = [
    String.raw`\chapter{Start}`,
    String.raw`\subsubsection*{Deep}`,
    String.raw`\label{fig:x}`,
    String.raw`\begin{theorem}`,
    "plain text",
    String.raw`\subparagraph{Tiny}`,
  ].join("\n");

  it("recovers sections with their level, labels, environments and named macros", () => {
    const result = contribute({ "main.tex": source }, [
      { name: "Start", kind: 5, line: 0, from: 0, to: 15 },
      { name: "Deep", kind: 5, line: 1, from: 0, to: 21 },
      { name: "Outline entry", kind: 2, line: 4, from: 0, to: 5 },
      { name: "fig:x", kind: 7, line: 2, from: 0, to: 13 },
      { name: "theorem", kind: 7, line: 3, from: 0, to: 15 },
      { name: "define \\later", kind: 12, line: 4, from: 0, to: 5 },
      { name: "Tiny", kind: 5, line: 5, from: 0, to: 19 },
      { name: "text", kind: 13, line: 4, from: 0, to: 10 },
    ]);
    expect(summary(result)).toEqual([
      ["section", "Start", 1],
      ["section", "Deep", 3],
      ["section", "Outline entry", 1],
      ["label", "fig:x", null],
      ["environment", "theorem", null],
      ["macro", "later", null],
      ["section", "Tiny", 5],
    ]);
    expect(result.uses).toEqual([]);
    expect(result.identity).toBe(identity);
    expect(result.definitions[0]).toMatchObject({
      source: "texlab",
      engine: "latex",
      location: { file: "main.tex", range: { from: 0, to: 15, startLine: 1 } },
    });
  });

  it("clamps a range whose end precedes its start", () => {
    const result = contribute({ "main.tex": source }, [{ name: "fig:x", kind: 7, line: 2, from: 13, to: 0 }]);
    expect(result.definitions).toEqual([]);
    const label = contribute({ "main.tex": String.raw`\label{a}` }, [
      { name: "Start", kind: 2, line: 0, from: 9, to: 0 },
    ]);
    expect(label.definitions[0].location.range).toMatchObject({ from: 9, to: 9 });
  });

  it("accepts other LaTeX source extensions", () => {
    const texts = {
      "a.ltx": String.raw`\label{a}`,
      "b.latex": String.raw`\label{b}`,
      "c.sty": String.raw`\newcommand\c{}`,
      "d.cls": String.raw`\label{d}`,
      "e.bib": String.raw`\label{e}`,
    };
    const symbols = Object.keys(texts).map((file) => ({
      name: file,
      kind: 7,
      line: 0,
      from: 0,
      to: 16,
      uri: `file:///project/${file}`,
    }));
    expect(contribute(texts, symbols).definitions.map((definition) => definition.name)).toEqual(["a", "b", "c", "d"]);
  });
});

describe("Typst symbol recovery", () => {
  const source = ["= Top", "== Inner", "#figure[x] <fig:one>", "#let area(r) = r * r", "#show heading: it => it", "plain"].join("\n");

  it("recovers headings, labels and let/show bindings, and drops the rest", () => {
    const result = contribute(
      { "main.typ": source },
      [
        { name: "Top", kind: 5, line: 0, from: 0, to: 5 },
        { name: "Inner", kind: 5, line: 1, from: 0, to: 8 },
        { name: "fig:one", kind: 7, line: 2, from: 0, to: 20 },
        { name: "area", kind: 12, line: 3, from: 0, to: 20 },
        { name: "heading", kind: 12, line: 4, from: 0, to: 13 },
        { name: "plain", kind: 13, line: 5, from: 0, to: 5 },
      ].map((symbol) => ({ ...symbol, uri: "file:///project/main.typ" })),
      { provider: "tinymist" },
    );
    expect(summary(result)).toEqual([
      ["section", "Top", 1],
      ["section", "Inner", 2],
      ["label", "fig:one", null],
      ["macro", "area", null],
      ["macro", "heading", null],
    ]);
    expect(result.definitions.every((definition) => definition.source === "tinymist" && definition.engine === "typst")).toBe(true);
  });
});

describe("symbol filtering and URIs", () => {
  const raw = (symbols: unknown) =>
    languageServiceContribution({
      identity,
      provider: "texlab",
      workspaceRoot: "/project",
      texts: new Map([["main.tex", "x"]]),
      symbols: symbols as never,
    });

  it("ignores non-array payloads and malformed symbols", () => {
    expect(raw({ not: "an array" }).definitions).toEqual([]);
    const valid = { name: "s", kind: 2, location: { uri: "file:///project/main.tex", range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } } } };
    const malformed = [
      null,
      { ...valid, name: "  " },
      { ...valid, kind: 1.5 },
      { ...valid, location: null },
      { ...valid, location: { uri: 5, range: valid.location.range } },
      { ...valid, location: { uri: valid.location.uri, range: null } },
      { ...valid, location: { uri: valid.location.uri, range: { start: { line: -1, character: 0 }, end: { line: 0, character: 0 } } } },
      { ...valid, location: { uri: valid.location.uri, range: { start: { line: 0, character: 0 }, end: { line: 0, character: "1" } } } },
    ];
    expect(raw(malformed).definitions).toEqual([]);
    expect(raw([...malformed, { ...valid, name: "  padded  " }]).definitions.map((d) => d.name)).toEqual([
      "padded",
    ]);
  });

  it("skips symbols in files outside the project texts", () => {
    const result = contribute({ "main.tex": String.raw`\label{a}` }, [
      { name: "a", kind: 7, line: 0, from: 0, to: 9, uri: "file:///elsewhere/main.tex" },
    ]);
    expect(result.definitions).toEqual([]);
  });

  it("matches encoded and Windows workspace URIs", () => {
    const texts = { "my chapters/intro.tex": String.raw`\label{intro}` };
    const posix = contribute(texts, [
      { name: "intro", kind: 7, line: 0, from: 0, to: 13, uri: "file:///work/my%20chapters/intro.tex" },
    ], { workspaceRoot: "/work//" });
    expect(posix.definitions.map((definition) => definition.location.file)).toEqual(["my chapters/intro.tex"]);

    const windows = contribute(texts, [
      { name: "intro", kind: 7, line: 0, from: 0, to: 13, uri: "file:///C:/Users/ada/my%20chapters/intro.tex" },
    ], { workspaceRoot: "C:\\Users\\ada\\" });
    expect(windows.definitions.map((definition) => definition.name)).toEqual(["intro"]);
  });
});
