import { describe, expect, it } from "vitest";
import { analyzeProjectFile } from "./analyze-file";
import { assembleProjectIntelligence } from "./assemble";
import type { ProjectIntelligenceSnapshot } from "./types";

function snapshot(
  sources: Readonly<Record<string, string>>,
  extraFiles: readonly string[] = [],
): ProjectIntelligenceSnapshot {
  const files = Object.fromEntries(
    Object.entries(sources).map(([file, source]) => [
      file,
      analyzeProjectFile(file, source, 1),
    ]),
  );
  return assembleProjectIntelligence({
    identity: { projectId: "project", projectRevision: 1, requestGeneration: 1 },
    files,
    knownFiles: [...Object.keys(sources), ...extraFiles],
    mainDocument: Object.keys(sources).find((file) =>
      /\.(?:md|typ)$/i.test(file),
    ),
    stats: {
      fileCount: Object.keys(files).length,
      characterCount: 0,
      parsedFileCount: Object.keys(files).length,
      reusedFileCount: 0,
      durationMs: 0,
    },
  });
}

const definitionNames = (value: ProjectIntelligenceSnapshot, kind: string) =>
  value.definitions
    .filter((definition) => definition.kind === kind)
    .map((definition) => definition.name);

const useNames = (value: ProjectIntelligenceSnapshot, kind: string) =>
  value.uses.filter((use) => use.kind === kind).map((use) => use.name);

describe("Typst names outside ASCII", () => {
  it("indexes accented, Cyrillic, CJK, dotted and digit-first labels", () => {
    const source = [
      "= Úvod <kap:úvod>",
      "= Введение <введение>",
      "= 引言 <引言>",
      "#figure(image(\"graf.png\"), caption: [Graf]) <obr.1>",
      "#figure(image(\"graf.png\"), caption: [Graf]) <2020x>",
      "Viz @kap:úvod, @введение, @引言。 @obr.1. @2020x",
      "",
    ].join("\n");
    const value = snapshot({ "main.typ": source }, ["graf.png"]);
    expect(value.diagnostics).toEqual([]);
    expect(definitionNames(value, "label")).toEqual(
      expect.arrayContaining(["kap:úvod", "введение", "引言", "obr.1", "2020x"]),
    );
    const references = value.uses.filter((use) => use.kind === "reference");
    expect(references.map((use) => use.name)).toEqual([
      "kap:úvod",
      "введение",
      "引言",
      "obr.1",
      "2020x",
    ]);
    const first = references[0].location.range;
    expect(source.slice(first.from, first.to)).toBe("kap:úvod");
  });

  it("resolves #ref, #cite and @ keys with non-ASCII letters", () => {
    const value = snapshot({
      "main.typ": [
        "= Úvod <úvod>",
        "#ref(<úvod>) #cite(<dvořák2020>) @novák2020",
        "#bibliography(\"refs.bib\")",
        "",
      ].join("\n"),
      "refs.bib":
        "@misc{dvořák2020, title={X}, year={2020}}\n@misc{novák2020, title={Y}, year={2020}}\n",
    });
    expect(value.diagnostics).toEqual([]);
    expect(value.uses.map((use) => use.name)).toEqual(
      expect.arrayContaining(["úvod", "novák2020", "dvořák2020"]),
    );
  });

  it("records #let bindings with non-ASCII names", () => {
    const value = snapshot({
      "main.typ": "#let výsledek(x) = x\n#let 结果 = 1\n#let परिणाम = 2\n",
    });
    expect(definitionNames(value, "macro")).toEqual([
      "výsledek",
      "结果",
      "परिणाम",
    ]);
  });

  it("keeps escaped at signs and URL paths out of references", () => {
    const value = snapshot({
      "main.typ":
        "Pište na jan\\@firma.cz nebo ředitel\\@škola.cz.\nViz https://example.org/@autor a \\\\@chybí.\n",
    });
    expect(useNames(value, "reference")).toEqual(["chybí"]);
  });

  it("treats http and https links as links, not line comments", () => {
    const value = snapshot({
      "main.typ": [
        "= Zdroje z https://typst.app/docs <zdroje>",
        "Viz @zdroje a (https://example.org/a).",
        "#link(\"https://typst.app\")[Typst] https://a.b/c // poznámka",
        "",
      ].join("\n"),
    });
    expect(value.diagnostics).toEqual([]);
    expect(definitionNames(value, "section")).toEqual([
      "Zdroje z https://typst.app/docs",
    ]);
    expect(definitionNames(value, "label")).toContain("zdroje");
  });
});

describe("Markdown Pandoc identifiers", () => {
  it("accepts explicit ids with non-ASCII letters and extra attributes", () => {
    const value = snapshot({
      "main.md": [
        "# Úvod do problematiky {#sec:úvod}",
        "",
        "# Введение {.unnumbered #введение}",
        "",
        "# Metody {#metody .class key=\"a b\"}",
        "",
        "Viz [a](#sec:úvod), [b](#введение), [c](#metody) a [d](#sec:%C3%BAvod).",
        "",
      ].join("\n"),
    });
    expect(value.diagnostics).toEqual([]);
    expect(definitionNames(value, "anchor")).toEqual(
      expect.arrayContaining(["sec:úvod", "введение", "metody"]),
    );
  });

  it("reads attribute blocks that never close without backtracking", () => {
    const unclosed = `Text {${'a="b" '.repeat(60)}\n# Nadpis {#konec}\n`;
    const value = snapshot({ "main.md": `${unclosed}\n[x](#konec)\n` });
    expect(value.diagnostics).toEqual([]);
    expect(definitionNames(value, "anchor")).toEqual(["konec"]);
  });

  it("derives auto ids the way Pandoc does", () => {
    const value = snapshot({
      "main.md": [
        "# 1. Úvod",
        "## Verze 2.0",
        "## snake_case [odkaz](http://x.y) *důraz*",
        "# 123",
        "# İstanbul",
        "",
        "[a](#úvod) [b](#verze-2.0) [c](#snake_case-odkaz-důraz) [d](#section) [e](#istanbul)",
        "",
      ].join("\n"),
    });
    expect(value.diagnostics).toEqual([]);
  });

  it("numbers repeated headings like Pandoc", () => {
    const value = snapshot({
      "main.md": [
        "# Experiment 1",
        "## Metody",
        "# Experiment 2",
        "## Metody",
        "# Metody-1",
        "",
        "[a](#metody) [b](#metody-1) [c](#metody-1-1)",
        "",
      ].join("\n"),
    });
    expect(value.diagnostics).toEqual([]);
    expect(definitionNames(value, "anchor")).toEqual(
      expect.arrayContaining(["metody", "metody-1", "metody-1-1"]),
    );
  });

  it("decodes percent-encoded link and image targets", () => {
    const value = snapshot(
      {
        "main.md": [
          "![Graf](obr%C3%A1zky/graf.png)",
          "![Other](my%20figure.png)",
          "[lit]: soubor%2520s%20procenty.md",
          "[x](a%2Fb.md)",
          "",
        ].join("\n"),
      },
      ["obrázky/graf.png", "my figure.png", "soubor%20s procenty.md", "a%2Fb.md"],
    );
    expect(value.diagnostics).toEqual([]);
    const asset = value.uses.find((use) => use.kind === "asset");
    expect(asset?.name).toBe("obr%C3%A1zky/graf.png");
  });
});
