import { describe, expect, it } from "vitest";
import { analyzeProjectFile } from "./analyze-file";
import { assembleProjectIntelligence } from "./assemble";
import { mergeLanguageServiceIntelligence } from "./merge-language-service";
import { rangeFromOffsets, lineStarts } from "./source";
import type { ProjectDefinition, ProjectUse } from "./types";

const MAIN = [
  String.raw`\section{Intro}`,
  String.raw`See \ref{sec:a} and \cite{k1}.`,
  String.raw`Also \ref{dup}.`,
  String.raw`\input{part}`,
].join("\n");

const identity = { projectId: "p", projectRevision: 1, requestGeneration: 1 };

const snapshot = assembleProjectIntelligence({
  identity,
  files: { "main.tex": analyzeProjectFile("main.tex", MAIN, 1) },
  knownFiles: ["main.tex"],
  mainDocument: "main.tex",
  stats: { fileCount: 1, characterCount: MAIN.length, parsedFileCount: 1, reusedFileCount: 0, durationMs: 0 },
});

const starts = lineStarts(MAIN);
const at = (needle: string, length = needle.length) => {
  const from = MAIN.indexOf(needle);
  return rangeFromOffsets(starts, from, from + length);
};

function definition(id: string, kind: ProjectDefinition["kind"], name: string, needle: string, extra: Partial<ProjectDefinition> = {}): ProjectDefinition {
  return {
    id,
    source: "texlab",
    engine: "latex",
    kind,
    name,
    location: { file: "main.tex", range: at(needle) },
    ...extra,
  };
}

function use(id: string, kind: ProjectUse["kind"], name: string, needle: string, extra: Partial<ProjectUse> = {}): ProjectUse {
  return {
    id,
    source: "texlab",
    engine: "latex",
    kind,
    name,
    location: { file: "main.tex", range: at(needle) },
    resolution: "unresolved",
    definitionIds: [],
    ...extra,
  };
}

const unresolvedCodes = (value: typeof snapshot) =>
  value.diagnostics
    .filter((diagnostic) => diagnostic.code === "unresolved-reference" || diagnostic.code === "unresolved-citation")
    .map((diagnostic) => diagnostic.code).sort();

describe("mergeLanguageServiceIntelligence", () => {
  it("ignores contributions for another identity", () => {
    const merged = mergeLanguageServiceIntelligence(snapshot, {
      identity: { ...identity, requestGeneration: 2 },
      definitions: [definition("x", "label", "sec:a", "Also")],
      uses: [],
    });
    expect(merged).toBe(snapshot);
  });

  it("resolves references through server labels and drops their unresolved diagnostics", () => {
    expect(unresolvedCodes(snapshot)).toEqual(["unresolved-citation", "unresolved-reference", "unresolved-reference"]);
    const merged = mergeLanguageServiceIntelligence(snapshot, {
      identity,
      definitions: [
        definition("label-a", "label", "sec:a", "Also"),
        definition("dup-1", "label", "dup", "\\input"),
        definition("dup-2", "label", "dup", "part"),
      ],
      uses: [],
    });
    const reference = (name: string) => merged.uses.find((candidate) => candidate.kind === "reference" && candidate.name === name);
    expect(reference("sec:a")).toMatchObject({ resolution: "resolved", definitionIds: ["label-a"] });
    expect(reference("dup")).toMatchObject({ resolution: "duplicate", definitionIds: ["dup-1", "dup-2"] });
    expect(merged.uses.find((candidate) => candidate.kind === "citation")).toMatchObject({ resolution: "unresolved" });
    expect(unresolvedCodes(merged)).toEqual(["unresolved-citation"]);
    expect(merged.diagnostics.length).toBeGreaterThan(unresolvedCodes(merged).length);
  });

  it("keeps the local parse of a symbol and drops server duplicates and non-server sources", () => {
    const localSection = snapshot.definitions.find((candidate) => candidate.kind === "section");
    const merged = mergeLanguageServiceIntelligence(snapshot, {
      identity,
      definitions: [
        definition("server-intro", "section", "Intro", "Intro"),
        definition("macro-1", "macro", "foo", "See"),
        definition("macro-1-again", "macro", "foo", "See"),
        definition("local-only", "label", "ghost", "Also", { source: "local" }),
      ],
      uses: [],
    });
    expect(merged.definitions.filter((candidate) => candidate.kind === "section").map((candidate) => candidate.id)).toEqual([
      localSection?.id,
    ]);
    expect(merged.definitions.filter((candidate) => candidate.kind === "macro").map((candidate) => candidate.id)).toEqual([
      "macro-1",
    ]);
    expect(merged.definitions.some((candidate) => candidate.name === "ghost")).toBe(false);
  });

  it("adds server-only sections, macros and environments to the outline once, in source order", () => {
    const merged = mergeLanguageServiceIntelligence(snapshot, {
      identity,
      definitions: [
        definition("env", "environment", "proof", "\\input", { level: 2 }),
        definition("macro", "macro", "foo", "See"),
        definition("server-intro", "section", "Intro", "\\section{Intro}", { id: "server-intro" }),
        definition("label", "label", "sec:a", "Also"),
        { ...definition("other", "section", "Elsewhere", "Also"), location: { file: "other.tex", range: at("Also") } },
      ],
      uses: [],
    });
    const outline = merged.outlines["main.tex"];
    expect(outline.map((node) => [node.kind, node.title, node.level])).toEqual(
      expect.arrayContaining([
        ["macro", "foo", 0],
        ["environment", "proof", 2],
      ]),
    );
    expect(outline.filter((node) => node.kind === "section" && node.title === "Intro")).toHaveLength(1);
    expect(outline.some((node) => node.kind === "label")).toBe(false);
    const froms = outline.map((node) => node.range.from);
    expect(froms).toEqual([...froms].sort((a, b) => a - b));
    expect(merged.outlines["other.tex"].map((node) => node.title)).toEqual(["Elsewhere"]);
    expect(merged.outlines["other.tex"][0]).toMatchObject({ definitionId: "other", parentId: null });
  });

  it("adds server uses once, resolves them, and leaves non-resolvable kinds alone", () => {
    const merged = mergeLanguageServiceIntelligence(snapshot, {
      identity,
      definitions: [definition("env-def", "environment", "proof", "\\input")],
      uses: [
        use("env-use", "environment", "proof", "Also"),
        use("env-use-again", "environment", "proof", "Also"),
        use("missing-env", "environment", "lemma", "See"),
        use("link", "link", "https://example.org", "part", { resolution: "external" }),
        use("local-use", "reference", "sec:a", "Intro", { source: "local" }),
      ],
    });
    const serverUses = merged.uses.filter((candidate) => candidate.source === "texlab");
    expect(serverUses.map((candidate) => [candidate.id, candidate.resolution])).toEqual([
      ["missing-env", "unresolved"],
      ["env-use", "resolved"],
      ["link", "external"],
    ]);
    expect(serverUses.find((candidate) => candidate.id === "env-use")?.definitionIds).toEqual(["env-def"]);
    expect(merged.uses.some((candidate) => candidate.id === "local-use")).toBe(false);
  });
});
