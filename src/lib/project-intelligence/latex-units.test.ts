import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { maskLatexIgnoredRegions } from "@oleafly/editor/latex-analysis";
import { analyzeProjectFile } from "./analyze-file";
import {
  buildLatexUnits,
  byCodePoint,
  latexUnitFacts,
  latexUnitScope,
  type LatexUnitTier,
} from "./latex-units";
import { engineForPath } from "./source";
import type { LatexUnitFacts, LatexUnits } from "./types";

interface Fixture {
  readonly cases: readonly FixtureCase[];
}

interface FixtureCase {
  readonly name: string;
  readonly files: Readonly<Record<string, string>>;
  readonly main?: string;
  readonly known?: readonly string[];
  readonly units: readonly { root: string; files: string[]; open: boolean }[] | null;
  readonly orphans?: readonly string[];
  readonly select?: readonly {
    from: string;
    pool: string[];
    tier: LatexUnitTier;
    items: string[];
    ambiguous: boolean;
    citation?: boolean;
  }[];
  readonly rows?: readonly { files: string[]; rows: string[][] }[];
  readonly reaches?: readonly { from: string; to: string; value: boolean }[];
}

const fixture = JSON.parse(
  readFileSync(
    path.join(process.cwd(), "crates/oleafly-core/tests/fixtures/latex-units.json"),
    "utf8",
  ),
) as Fixture;

function unitsOf(
  files: Readonly<Record<string, string>>,
  main?: string,
  known: readonly string[] = [],
): LatexUnits | undefined {
  const facts = new Map<string, LatexUnitFacts>();
  for (const [file, text] of Object.entries(files)) {
    if (engineForPath(file) !== "latex") continue;
    const fileFacts = latexUnitFacts(file, text, maskLatexIgnoredRegions(text));
    if (fileFacts) facts.set(file, fileFacts);
  }
  return buildLatexUnits({
    facts,
    read: new Set(Object.keys(files)),
    known: [...Object.keys(files), ...known],
    ...(main ? { mainDocument: main } : {}),
  });
}

function summary(units: LatexUnits, files: readonly string[]) {
  return {
    units: units.roots.map((root, unit) => ({
      root,
      files: Object.keys(units.fileGroups)
        .filter((file) => units.groups[units.fileGroups[file]].includes(unit))
        .sort(byCodePoint),
      open: units.openUnits.includes(unit),
    })),
    orphans: files.filter((file) => !(file in units.fileGroups)).sort(byCodePoint),
  };
}

describe("compilation units against the shared fixture", () => {
  it("has a case for every rule", () => {
    expect(fixture.cases.length).toBeGreaterThanOrEqual(45);
  });

  it.each(fixture.cases.map((testCase) => [testCase.name, testCase] as const))(
    "%s",
    (_name, testCase) => {
      const units = unitsOf(testCase.files, testCase.main, testCase.known);
      if (testCase.units === null) {
        expect(units).toBeUndefined();
        return;
      }
      if (!units) throw new Error("expected units");
      expect(summary(units, Object.keys(testCase.files))).toEqual({
        units: testCase.units,
        orphans: testCase.orphans,
      });
      const scope = latexUnitScope(units);
      if (!scope) throw new Error("expected a scope");
      const file = (name: string) => name;
      for (const query of testCase.select ?? []) {
        const selection = scope.select(query.from, query.pool, file, query.citation ?? false);
        expect({ tier: selection.tier, items: selection.items }, JSON.stringify(query)).toEqual({
          tier: query.tier,
          items: query.items,
        });
        expect(scope.isAmbiguous(query.from, selection.items, file), JSON.stringify(query)).toBe(
          query.ambiguous,
        );
      }
      for (const query of testCase.rows ?? []) {
        expect(scope.duplicateRows(query.files), JSON.stringify(query.files)).toEqual(query.rows);
      }
      for (const query of testCase.reaches ?? []) {
        expect(scope.reaches(query.from, query.to), JSON.stringify(query)).toBe(query.value);
      }
    },
  );
});

describe("latexUnitFacts", () => {
  const facts = (text: string, file = "a.tex") =>
    latexUnitFacts(file, text, maskLatexIgnoredRegions(text));

  it("says nothing about a plain fragment", () => {
    expect(facts("\\section{A}\nSome text.\n")).toBeUndefined();
  });

  it("does not take the rest of a name for a command", () => {
    expect(facts("\\input@path{{chapters/}}\n\\includegraphics{a}\n\\inputminted{c}{a.c}\n")).toBeUndefined();
  });

  it("reads the subfiles parent, and never calls a subfile a document", () => {
    expect(facts("\\documentclass[../main.tex]{subfiles}\n\\begin{document}\\end{document}")).toEqual({
      subfilesParent: "../main.tex",
      packages: ["subfiles.cls"],
    });
  });

  it("keeps a magic root only on a file that is not its own document", () => {
    expect(facts("% !TeX root = main.tex\n\\section{A}")).toEqual({ magicRoot: "main.tex" });
    expect(facts("% !TeX root = main.tex\n\\documentclass{article}")).toEqual({
      document: true,
      packages: ["article.cls"],
    });
  });

  it("never treats a package or class file as a document", () => {
    expect(facts("\\documentclass{article}\n\\begin{document}\\end{document}", "a.sty")?.document).toBeUndefined();
    expect(facts("\\documentclass{article}\n", "a.cls")?.document).toBeUndefined();
  });

  it("marks each kind of include, and the local ones", () => {
    expect(facts("\\import{sec/}{a}\n\\subimport{sub}{b}\n\\inputfrom{x/}{c}\n")).toEqual({
      includes: [
        { raw: "sec/a", folder: "sec" },
        { raw: "sub/b", local: true, folder: "sub" },
        { raw: "x/c", folder: "x" },
      ],
    });
  });

  it("gives the worker the same facts as the scan", () => {
    const text = "\\documentclass{article}\n\\usepackage{x}\n\\input{chapter}\n";
    expect(analyzeProjectFile("main.tex", text, 1).latexUnit).toEqual(facts(text, "main.tex"));
  });

  it("still reads the facts of a file with validation switched off", () => {
    const text = "%novalidate\n\\documentclass{article}\n";
    expect(analyzeProjectFile("main.tex", text, 1).latexUnit?.document).toBe(true);
  });
});

describe("scale", () => {
  const SIZE = 1000;

  function hubProject() {
    const files: Record<string, string> = {};
    const chapters = Array.from({ length: SIZE - 1 }, (_, chapter) => `\\input{bank/p${chapter}}`);
    files["shared/hub.tex"] = chapters.join("\n");
    for (let chapter = 0; chapter < SIZE - 1; chapter += 1) {
      files[`shared/bank/p${chapter}.tex`] = "";
    }
    for (let root = 0; root < SIZE; root += 1) {
      files[`exams/e${root}/main.tex`] = "\\documentclass{article}\n\\input{../../shared/hub}\n";
    }
    return files;
  }

  it("gives a thousand roots one group each, plus one for what they share", () => {
    const files = hubProject();
    const units = unitsOf(files);
    expect(units?.roots).toHaveLength(SIZE);
    expect(units?.groups).toHaveLength(SIZE + 1);
    expect(units?.fileGroups["shared/bank/p0.tex"]).toBe(units?.fileGroups["shared/hub.tex"]);
  });

  it("gives up cleanly past the step budget", () => {
    const files = hubProject();
    const facts = new Map<string, LatexUnitFacts>();
    for (const [file, text] of Object.entries(files)) {
      const fileFacts = latexUnitFacts(file, text, text);
      if (fileFacts) facts.set(file, fileFacts);
    }
    expect(
      buildLatexUnits({
        facts,
        read: new Set(Object.keys(files)),
        known: Object.keys(files),
        maxSteps: 1000,
      }),
    ).toBeUndefined();
  });

  it("counts the cost of finding a path against the budget", () => {
    const text = "\\documentclass{article}\n\\input{chapter}\n";
    const facts = new Map<string, LatexUnitFacts>();
    for (const file of ["a.tex", "b.tex"]) {
      const fileFacts = latexUnitFacts(file, text, text);
      if (fileFacts) facts.set(file, fileFacts);
    }
    const known = ["a.tex", "b.tex"];
    for (let folder = 0; folder < 2000; folder += 1) known.push(`f${folder}/chapter.tex`);
    const build = (maxSteps: number) =>
      buildLatexUnits({ facts, read: new Set(["a.tex", "b.tex"]), known, maxSteps });
    expect(build(1000)).toBeUndefined();
    expect(build(100_000)).toBeDefined();
  });

  it("keeps groups apart past the first word of the bit set", () => {
    const paper = (body: string) => `\\documentclass{article}\n${body}\n`;
    const files: Record<string, string> = {};
    for (let root = 0; root < 70; root += 1) {
      files[`r${String(root).padStart(2, "0")}.tex`] = paper(
        [
          ...(root === 0 || root === 40 ? ["\\input{left}"] : []),
          ...(root === 40 || root === 69 ? ["\\input{right}"] : []),
        ].join("\n"),
      );
    }
    files["left.tex"] = "";
    files["right.tex"] = "";
    const scope = latexUnitScope(unitsOf(files));
    expect(scope?.sharesScope("left.tex", "right.tex")).toBe(true);
    expect(scope?.sharesScope("left.tex", "r69.tex")).toBe(false);
    expect(scope?.sharesScope("right.tex", "r00.tex")).toBe(false);
  });

  it("finds overlaps through the unit index when a pool has many shared owners", () => {
    const paper = (body: string) => `\\documentclass{article}\n${body}\n`;
    const files: Record<string, string> = {};
    const size = 40;
    for (let root = 0; root < size; root += 1) {
      files[`r${root}.tex`] = paper(`\\input{s${root}}\n\\input{s${(root + 1) % size}}`);
      files[`s${root}.tex`] = "";
    }
    const scope = latexUnitScope(unitsOf(files));
    if (!scope) throw new Error("expected a scope");
    const pool = Object.keys(files).filter((file) => file.startsWith("s"));
    const { items, tier } = scope.select("r3.tex", pool, (file) => file);
    expect(tier).toBe("unit");
    expect([...items].sort()).toEqual(["s3.tex", "s4.tex"]);
  });

  it("selects from a pool shared by two thousand roots without walking it per use", () => {
    const fileGroups: Record<string, number> = {};
    const roots: string[] = [];
    const groups: number[][] = [];
    for (let root = 0; root < 2000; root += 1) {
      roots.push(`r${root}.tex`);
      groups.push([root]);
      fileGroups[`r${root}.tex`] = root;
    }
    const scope = latexUnitScope({ roots, groups, fileGroups, openUnits: [] });
    if (!scope) throw new Error("expected a scope");
    let reads = 0;
    const file = (name: string) => {
      reads += 1;
      return name;
    };
    for (const viewer of roots) {
      expect(scope.select(viewer, roots, file).items).toEqual([viewer]);
    }
    expect(reads).toBeLessThanOrEqual(roots.length * 2);
  });
});
