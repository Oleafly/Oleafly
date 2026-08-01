// @vitest-environment jsdom

// Completion scenarios ported from the package corpus's test/units/05_completion
// suite (commit becabe2, MIT) — scenarios and inputs only; the harness is
// Oleafly's project-intelligence completion contract. Scenarios exercising
// features Oleafly deliberately lacks (VS Code providers, TextMate ranges)
// are not ported.

import {
  CompletionContext,
  type Completion,
  type CompletionResult,
} from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { setEditorDocumentPath } from "@oleafly/editor";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadCore,
  loadPackageCatalog,
  loadPackageNames,
  setCorpusTransport,
} from "@oleafly/latex-intelligence";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  corpusCore,
  requestPackageCatalogs,
} from "@/lib/latex-corpus";
import { analyzeProjectFile } from "@/lib/project-intelligence/analyze-file";
import { assembleProjectIntelligence } from "@/lib/project-intelligence/assemble";
import { latexAstReady } from "@/lib/project-intelligence/latex-ast";
import type { ProjectIntelligenceSnapshot } from "@/lib/project-intelligence/types";
import { useFilesStore } from "@/store/files";
import { useIndexStore } from "@/store/project-index";
import { projectIntelligenceCompletion } from "./project-intelligence";

function snapshot(
  sources: Readonly<Record<string, string>>,
): ProjectIntelligenceSnapshot {
  const files = Object.fromEntries(
    Object.entries(sources).map(([path, source]) => [
      path,
      analyzeProjectFile(path, source, 1),
    ]),
  );
  return assembleProjectIntelligence({
    identity: {
      projectId: "scenario-project",
      projectRevision: 1,
      requestGeneration: 1,
    },
    files,
    knownFiles: Object.keys(sources),
    mainDocument: "main.tex",
    stats: {
      fileCount: Object.keys(files).length,
      characterCount: 0,
      parsedFileCount: Object.keys(files).length,
      reusedFileCount: 0,
      durationMs: 0,
    },
  });
}

function installProject(
  sources: Readonly<Record<string, string>>,
): void {
  const value = snapshot(sources);
  useFilesStore.setState({
    projectId: "scenario-project",
    activePath: "main.tex",
    files: Object.fromEntries(
      Object.entries(sources).map(([path, content]) => [
        path,
        { content, dirty: false },
      ]),
    ),
  });
  useIndexStore.setState({
    texts: { ...sources },
    intelligenceState: {
      status: "success",
      identity: value.identity,
      data: value,
      stale: false,
    },
  });
  setEditorDocumentPath("main.tex");
}

/**
 * The snapshot-backed completion path requires the editor text to match the
 * indexed text exactly, so every scenario indexes the very document it
 * completes against.
 */
function complete(
  doc: string,
  extraSources: Readonly<Record<string, string>> = {},
  pos = doc.length,
): CompletionResult | null {
  installProject({ "main.tex": doc, ...extraSources });
  const state = EditorState.create({ doc });
  const value = projectIntelligenceCompletion(
    new CompletionContext(state, pos, false),
  );
  if (
    value &&
    typeof (value as Promise<unknown>).then === "function"
  ) {
    throw new Error("Expected synchronous completion");
  }
  return value as CompletionResult | null;
}

function labels(result: CompletionResult | null): string[] {
  return (result?.options ?? []).map((option) =>
    String(option.label),
  );
}

function option(
  result: CompletionResult | null,
  label: string,
): Completion | undefined {
  return result?.options.find(
    (candidate) => candidate.label === label,
  );
}

beforeAll(async () => {
  // Corpus caches and the AST parser load asynchronously in production;
  // tests warm them deterministically through the same promises, with an
  // fs-backed transport standing in for the fetch of public/ assets.
  // Plain paths, not URL objects: jsdom swaps the global URL class and
  // node:fs does not accept foreign URL instances.
  const corpusDir = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../../../public/latex-intelligence",
  );
  setCorpusTransport(async (relativePath) => {
    try {
      return JSON.parse(
        await readFile(join(corpusDir, relativePath), "utf8"),
      ) as unknown;
    } catch {
      return null;
    }
  });
  await latexAstReady();
  corpusCore();
  requestPackageCatalogs([
    "siunitx",
    "geometry",
    "hyperref",
    "class-beamer",
  ]);
  await Promise.all([
    loadCore(),
    loadPackageNames(),
    loadPackageCatalog("siunitx"),
    loadPackageCatalog("geometry"),
    loadPackageCatalog("hyperref"),
    loadPackageCatalog("class-beamer"),
  ]);
  // Let the corpus module's .then() callbacks populate its sync caches.
  await new Promise((resolve) => setTimeout(resolve, 0));
});

afterEach(() => {
  setEditorDocumentPath(null);
  useIndexStore.getState().reset();
  useFilesStore.setState({
    projectId: null,
    activePath: null,
    tree: [],
    files: {},
  });
});

describe("Package-aware completion scenarios", () => {
  it("completes package names with CTAN details inside \\usepackage{}", () => {
    const result = complete("anchor \\usepackage{siunit");
    const siunitx = option(result, "siunitx");
    expect(siunitx).toBeTruthy();
    expect(String(siunitx?.detail ?? "")).not.toBe("");
    expect(
      labels(result).some((label) => label.startsWith(".")),
    ).toBe(false);
  });

  it("completes the second entry of a comma-separated \\usepackage list", () => {
    const result = complete("anchor \\usepackage{amsmath, geome");
    expect(option(result, "geometry")).toBeTruthy();
  });

  it("completes document classes inside \\documentclass{}", () => {
    const result = complete("anchor \\documentclass{beam");
    expect(option(result, "beamer")).toBeTruthy();
  });

  it("gates package commands on the packages the project actually uses", () => {
    const withPackage = complete(
      "\\usepackage{siunitx}\nx \\ang",
    );
    expect(option(withPackage, "ang")).toBeTruthy();

    const withoutPackage = complete(
      "\\usepackage{amsmath}\nx \\ang",
    );
    expect(option(withoutPackage, "ang")).toBeFalsy();
  });

  it("hides commands the corpus flags as unusual", () => {
    // `unusual` marks names that are settable registers rather than callable
    // commands. Deprecated-but-working commands are not flagged: a package
    // declares them exactly like any other, so nothing in the source says a
    // command is discouraged, and the corpus is generated from that source.
    const result = complete("\\usepackage{booktabs}\nx \\above");
    expect(option(result, "aboverulesep")).toBeFalsy();
  });

  it("merges project, package and core environments in \\begin{}", () => {
    const result = complete(
      "\\usepackage{siunitx}\nanchor \\begin{",
      {
        "macros.sty": "\\newenvironment{projectenv}{}{}",
      },
    );
    const found = labels(result);
    expect(found).toContain("projectenv");
    expect(found).toContain("itemize");
  });

  it("completes the second citation key in multicite syntax", () => {
    const result = complete(
      "anchor \\cite{first2020, second",
      {
        "refs.bib":
          "@article{first2020, title={A}}\n@article{second2021, title={B}}",
      },
    );
    expect(option(result, "second2021")).toBeTruthy();
  });

  it("completes the second label in cleveref range references", () => {
    const result = complete(
      "\\label{sec:one} text \\label{sec:two} anchor \\cref{sec:one, sec:t",
    );
    expect(option(result, "sec:two")).toBeTruthy();
  });

  it("offers only image files inside \\includegraphics{}", () => {
    const result = complete("anchor \\includegraphics{", {
      "chapters/intro.tex": "Intro",
    });
    expect(
      labels(result).every((label) => !label.endsWith(".tex")),
    ).toBe(true);
  });

  it("offers project source files inside \\input{} and \\import{}{}", () => {
    const input = complete("anchor \\input{intro", {
      "chapters/intro.tex": "Intro",
    });
    expect(
      labels(input).some((label) =>
        label.includes("chapters/intro.tex"),
      ),
    ).toBe(true);
    const imported = complete(
      "anchor \\import{chapters/}{intro",
      { "chapters/intro.tex": "Intro" },
    );
    expect(
      labels(imported).some((label) =>
        label.includes("chapters/intro.tex"),
      ),
    ).toBe(true);
  });

  it("completes glossary keys from \\newacronym definitions", () => {
    const result = complete(
      "\\newacronym{ast}{AST}{Abstract Syntax Tree} anchor \\gls{",
    );
    expect(option(result, "ast")).toBeTruthy();
  });

  it("completes package options inside \\usepackage[]{geometry}", () => {
    const doc =
      "\\usepackage{geometry}\nanchor \\usepackage[]{geometry}";
    const pos = doc.lastIndexOf("[]") + 1;
    const result = complete(doc, {}, pos);
    expect(labels(result).length).toBeGreaterThan(0);
    expect(
      labels(result).some((label) => label.startsWith("margin")),
    ).toBe(true);
  });

  it("completes key=value keys inside \\hypersetup{}", () => {
    const result = complete(
      "\\usepackage{hyperref}\nanchor \\hypersetup{",
    );
    expect(
      labels(result).some((label) =>
        label.startsWith("colorlinks"),
      ),
    ).toBe(true);
  });

  it("survives circular includes without losing completion", () => {
    const result = complete("\\input{a.tex} anchor \\ref{circ", {
      "a.tex": "\\input{b.tex}",
      "b.tex": "\\input{a.tex} \\label{circ:label}",
    });
    expect(option(result, "circ:label")).toBeTruthy();
  });

  it("keeps duplicate labels reachable in reference completion", () => {
    const result = complete("\\label{dup} anchor \\ref{du", {
      "other.tex": "\\label{dup}",
    });
    expect(option(result, "dup")).toBeTruthy();
  });
});
