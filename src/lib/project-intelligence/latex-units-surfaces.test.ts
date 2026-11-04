import { describe, expect, it } from "vitest";
import { runRefsRules } from "@oleafly/preflight";
import { buildSymbolNodes } from "@/components/layout/project-intelligence-view";
import { headingTitlesByLabel, outlineSources } from "@/lib/index/outline";
import { buildRefsContext } from "@/lib/preflight-context";
import type { ProjectIndex, Sym } from "@/lib/index/types";
import { analyzeProjectFile } from "./analyze-file";
import { assembleProjectIntelligence } from "./assemble";
import { lazyLegacyIndex, legacyIndexFromProjectIntelligence } from "./legacy-index";
import { mergeLanguageServiceIntelligence } from "./merge-language-service";
import { definitionCandidatesForUse } from "./resolution";
import { referencesFor } from "./selectors";
import type { ProjectDefinition, ProjectIntelligenceSnapshot, ProjectUse } from "./types";
import { isProjectIntelligenceWorkerResponse } from "./worker-protocol";

const DOC = "\\documentclass{article}\n\\begin{document}\n";
const END = "\n\\end{document}\n";
const paper = (body: string) => `${DOC}${body}${END}`;

function project(
  sources: Readonly<Record<string, string>>,
  mainDocument: string | undefined = Object.keys(sources)[0],
): ProjectIntelligenceSnapshot {
  return assembleProjectIntelligence({
    identity: { projectId: "project", projectRevision: 1, requestGeneration: 1 },
    files: Object.fromEntries(
      Object.entries(sources).map(([file, source]) => [
        file,
        analyzeProjectFile(file, source, 1),
      ]),
    ),
    knownFiles: Object.keys(sources),
    ...(mainDocument ? { mainDocument } : {}),
    stats: {
      fileCount: 0,
      characterCount: 0,
      parsedFileCount: 0,
      reusedFileCount: 0,
      durationMs: 0,
    },
  });
}

function codes(snapshot: ProjectIntelligenceSnapshot) {
  return snapshot.diagnostics.map((diagnostic) => `${diagnostic.code} ${diagnostic.location.file}`).sort();
}

function referencesIn(snapshot: ProjectIntelligenceSnapshot, file: string): ProjectUse[] {
  return snapshot.uses.filter((use) => use.kind === "reference" && use.location.file === file);
}

function definitionFiles(snapshot: ProjectIntelligenceSnapshot, use: ProjectUse): string[] {
  return use.definitionIds.map(
    (id) => snapshot.definitions.find((definition) => definition.id === id)?.location.file ?? "?",
  );
}

function symbol(index: ProjectIndex, file: string, kind: Sym["kind"], name: string): Sym {
  const found = [...index.uses, ...index.defs].find(
    (sym) => sym.file === file && sym.kind === kind && sym.name === name,
  );
  if (!found) throw new Error(`no ${kind} ${name} in ${file}`);
  return found;
}

function editedFiles(index: ProjectIndex, sym: Sym, name = "new") {
  return index.renamePlan(sym, name).edits.map((edit) => edit.file).sort();
}

describe("side-by-side revisions", () => {
  const revisions = {
    "manuscript.tex": paper("\\section{A}\\label{sec:a}\nSee \\ref{sec:a}."),
    "manuscript_v1.tex": paper("\\section{A}\\label{sec:a}\nSee \\ref{sec:a}."),
    "manuscript_v2.tex": paper("\\section{A}\\label{sec:a}\nSee \\ref{sec:a}."),
  };

  it("reports no duplicate labels and resolves each reference to its own file", () => {
    const snapshot = project(revisions);
    expect(codes(snapshot)).toEqual([]);
    for (const file of Object.keys(revisions)) {
      const [reference] = referencesIn(snapshot, file);
      expect(reference.resolution).toBe("resolved");
      expect(definitionFiles(snapshot, reference)).toEqual([file]);
    }
  });

  it("finds references only inside the same document", () => {
    const snapshot = project(revisions);
    const definition = snapshot.definitions.find(
      (candidate) => candidate.kind === "label" && candidate.location.file === "manuscript.tex",
    ) as ProjectDefinition;
    expect(referencesFor(snapshot, definition.id).map((use) => use.location.file)).toEqual(["manuscript.tex"]);
  });

  it("gives the same answers after a language service merge", () => {
    const snapshot = project(revisions);
    const merged = mergeLanguageServiceIntelligence(snapshot, {
      identity: snapshot.identity,
      definitions: [],
      uses: [],
    });
    expect(merged.uses).toEqual(snapshot.uses);
    expect(codes(merged)).toEqual([]);
  });

  it("keeps an unresolved reference after a language service merge", () => {
    const snapshot = project({
      "a.tex": paper("\\label{only-a}"),
      "b.tex": paper("\\ref{only-a}"),
    });
    expect(codes(snapshot)).toEqual(["unresolved-reference b.tex"]);
    const merged = mergeLanguageServiceIntelligence(snapshot, {
      identity: snapshot.identity,
      definitions: [],
      uses: [],
    });
    expect(codes(merged)).toEqual(["unresolved-reference b.tex"]);
  });

  it("clears the other kinds of name that collide the same way", () => {
    const body = [
      "\\newtheorem{thm}{Theorem}",
      "\\newenvironment{box}{}{}",
      "\\newacronym{abc}{ABC}{A B C}",
      "\\newcommand{\\foo}{x}",
      "\\begin{thm}\\foo\\end{thm}",
      "\\begin{thebibliography}{1}\\bibitem{k} K.\\end{thebibliography}",
      "\\cite{k}",
    ].join("\n");
    const snapshot = project({ "a.tex": paper(body), "b.tex": paper(body) });
    expect(codes(snapshot)).toEqual([]);
    expect(
      snapshot.uses
        .filter((use) => use.kind === "environment" || use.kind === "macro" || use.kind === "citation")
        .every((use) => use.resolution === "resolved"),
    ).toBe(true);
  });

  it("shows no duplicate badge in the symbols list", () => {
    const nodes = buildSymbolNodes(project(revisions));
    const labels = nodes.find((node) => node.id === "symbols:labels");
    expect(labels?.children?.map((node) => node.badge)).toEqual([undefined, undefined, undefined]);
  });

  it("travels through the worker protocol", () => {
    const snapshot = project(revisions);
    expect(snapshot.latexUnits?.roots).toEqual(Object.keys(revisions));
    expect(
      isProjectIntelligenceWorkerResponse({
        type: "result",
        protocolVersion: snapshot.protocolVersion,
        requestId: 1,
        identity: snapshot.identity,
        snapshot,
      }),
    ).toBe(true);
    expect(
      isProjectIntelligenceWorkerResponse({
        type: "result",
        protocolVersion: snapshot.protocolVersion,
        requestId: 1,
        identity: snapshot.identity,
        snapshot: { ...snapshot, latexUnits: "wrong" },
      }),
    ).toBe(false);
  });
});

describe("what stays exactly as it was", () => {
  it("adds nothing for one document", () => {
    const snapshot = project({
      "main.tex": paper("\\input{chapter}\\label{a}"),
      "chapter.tex": "\\label{a}\n",
      "stale.tex": "\\label{a}\n",
    });
    expect(snapshot.latexUnits).toBeUndefined();
    expect(codes(snapshot)).toEqual([
      "duplicate-definition chapter.tex",
      "duplicate-definition main.tex",
      "duplicate-definition stale.tex",
    ]);
  });

  it("still pools a project with no document marker", () => {
    const snapshot = project({ "a.tex": "\\label{x}\n", "b.tex": "\\label{x}\n" });
    expect(snapshot.latexUnits).toBeUndefined();
    expect(codes(snapshot)).toEqual(["duplicate-definition a.tex", "duplicate-definition b.tex"]);
  });

  it("leaves Typst and Markdown alone beside two LaTeX documents", () => {
    const snapshot = project(
      {
        "paper.typ": "= A <a>\n= B <a>\n@a\n",
        "a.tex": paper("\\label{a}"),
        "b.tex": paper("\\label{a}"),
      },
      "paper.typ",
    );
    expect(codes(snapshot).filter((code) => code.endsWith("paper.typ"))).toEqual([
      "duplicate-definition paper.typ",
      "duplicate-definition paper.typ",
      "duplicate-definition paper.typ",
    ]);
    expect(codes(snapshot).filter((code) => code.endsWith(".tex"))).toEqual([]);
  });

  it("keeps .bib keys pooled", () => {
    const entry = "@misc{k, title={T}}\n";
    const snapshot = project({
      "a.tex": paper("\\bibliography{a}\\cite{k}"),
      "b.tex": paper("\\bibliography{b}\\cite{k}"),
      "a.bib": entry,
      "b.bib": entry,
    });
    expect(codes(snapshot).filter((code) => code.includes(".bib"))).toEqual([
      "duplicate-citation-key a.bib",
      "duplicate-citation-key b.bib",
    ]);
  });
});

describe("a file shared by two documents", () => {
  const shared = {
    "a.tex": paper("\\input{macros}\\label{x}"),
    "b.tex": paper("\\input{macros}\\label{x}"),
    "macros.tex": "See \\ref{x}.\n",
  };

  it("resolves to one label per document, with no complaint", () => {
    const snapshot = project(shared);
    expect(codes(snapshot)).toEqual([]);
    const [reference] = referencesIn(snapshot, "macros.tex");
    expect(reference.resolution).toBe("resolved");
    expect(definitionFiles(snapshot, reference)).toEqual(["a.tex", "b.tex"]);
  });

  it("reports a real clash in one document and leaves the other clean", () => {
    const snapshot = project({
      "a.tex": paper("\\input{chapter}\\label{x}"),
      "chapter.tex": "\\label{x}\n",
      "b.tex": paper("\\label{x}"),
    });
    expect(codes(snapshot)).toEqual(["duplicate-definition a.tex", "duplicate-definition chapter.tex"]);
  });

  it("counts a shared definition once per copy, with unique ids", () => {
    const snapshot = project({
      "a.tex": paper("\\input{macros}\\label{x}"),
      "b.tex": paper("\\input{macros}\\label{x}"),
      "macros.tex": "\\label{x}\n",
    });
    const ids = snapshot.diagnostics.map((diagnostic) => diagnostic.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(codes(snapshot)).toEqual([
      "duplicate-definition a.tex",
      "duplicate-definition b.tex",
      "duplicate-definition macros.tex",
    ]);
  });
});

describe("files no document reaches", () => {
  const withFragment = {
    "a.tex": paper("\\label{x}\\ref{only-frag}"),
    "b.tex": paper("\\label{x}"),
    "frag.tex": "\\label{only-frag}\\ref{x}\n",
  };

  it("resolves a fragment's reference across the documents without complaint", () => {
    const snapshot = project(withFragment);
    expect(codes(snapshot)).toEqual([]);
    const [reference] = referencesIn(snapshot, "frag.tex");
    expect(reference.resolution).toBe("resolved");
    expect(definitionFiles(snapshot, reference)).toEqual(["a.tex", "b.tex"]);
  });

  it("lets a document's reference reach a fragment not included yet", () => {
    const snapshot = project(withFragment);
    expect(referencesIn(snapshot, "a.tex")[0].resolution).toBe("resolved");
  });

  it("reports two fragments that collide with each other", () => {
    const snapshot = project({
      "a.tex": paper(""),
      "b.tex": paper(""),
      "frag1.tex": "\\label{x}\n",
      "frag2.tex": "\\label{x}\n",
    });
    expect(codes(snapshot)).toEqual(["duplicate-definition frag1.tex", "duplicate-definition frag2.tex"]);
  });

  it("does not let a fragment collide with a document", () => {
    const snapshot = project({
      "a.tex": paper("\\label{x}"),
      "b.tex": paper(""),
      "frag.tex": "\\label{x}\n",
    });
    expect(codes(snapshot)).toEqual([]);
  });
});

describe("a reference another document answers", () => {
  it("is unresolved when its document is closed", () => {
    const snapshot = project({ "a.tex": paper("\\label{x}"), "b.tex": paper("\\ref{x}") });
    expect(referencesIn(snapshot, "b.tex")[0].resolution).toBe("unresolved");
    expect(codes(snapshot)).toEqual(["unresolved-reference b.tex"]);
  });

  it("resolves quietly from a document with \\externaldocument", () => {
    const snapshot = project({
      "a.tex": paper("\\label{x}"),
      "b.tex": `\\documentclass{article}\n\\usepackage{xr}\n\\externaldocument{a}\n\\begin{document}\\ref{x}${END}`,
    });
    expect(codes(snapshot)).toEqual([]);
    expect(referencesIn(snapshot, "b.tex")[0].resolution).toBe("resolved");
  });

  it("never turns a citation into a new error", () => {
    const snapshot = project({
      "a.tex": paper("\\begin{thebibliography}{1}\\bibitem{k} K.\\end{thebibliography}"),
      "b.tex": paper("\\cite{k}"),
    });
    expect(codes(snapshot)).toEqual([]);
  });
});

describe("rename", () => {
  const index = (sources: Readonly<Record<string, string>>) =>
    legacyIndexFromProjectIntelligence(project(sources));

  const revisions = {
    "manuscript.tex": paper("\\label{a}\\ref{a}"),
    "manuscript_v1.tex": paper("\\label{a}\\ref{a}"),
  };

  it("stays in the document when started from a reference", () => {
    const value = index(revisions);
    const reference = symbol(value, "manuscript.tex", "ref", "a");
    expect(value.definitionFor(reference)?.file).toBe("manuscript.tex");
    expect(editedFiles(value, reference)).toEqual(["manuscript.tex", "manuscript.tex"]);
  });

  it("stays in the document when started from the label", () => {
    const value = index(revisions);
    expect(editedFiles(value, symbol(value, "manuscript_v1.tex", "label", "a"))).toEqual([
      "manuscript_v1.tex",
      "manuscript_v1.tex",
    ]);
  });

  it("keeps every compile valid across a shared file", () => {
    const value = index({
      "a.tex": paper("\\input{shared}\\label{x}\\ref{x}"),
      "b.tex": paper("\\input{shared}\\label{x}\\ref{x}"),
      "shared.tex": "\\ref{x}\n",
    });
    expect(editedFiles(value, symbol(value, "a.tex", "label", "x"))).toEqual([
      "a.tex",
      "a.tex",
      "b.tex",
      "b.tex",
      "shared.tex",
    ]);
  });

  it("renames a shared definition and every document's references", () => {
    const value = index({
      "a.tex": paper("\\input{shared}\\ref{x}"),
      "b.tex": paper("\\input{shared}\\ref{x}"),
      "shared.tex": "\\label{x}\n",
    });
    expect(editedFiles(value, symbol(value, "shared.tex", "label", "x"))).toEqual([
      "a.tex",
      "b.tex",
      "shared.tex",
    ]);
  });

  it("can still rename one of two real duplicates", () => {
    const value = index({
      "a.tex": paper("\\input{chapter}\\label{x}\\ref{x}"),
      "chapter.tex": "\\label{x}\n",
      "b.tex": paper(""),
    });
    expect(editedFiles(value, symbol(value, "chapter.tex", "label", "x"))).toEqual(["a.tex", "chapter.tex"]);
  });

  it("does not let a fragment chain two revisions together", () => {
    const value = index({
      "a.tex": paper("\\label{x}\\ref{x}"),
      "b.tex": paper("\\label{x}\\ref{x}"),
      "frag.tex": "\\ref{x}\n",
    });
    expect(editedFiles(value, symbol(value, "a.tex", "label", "x"))).toEqual(["a.tex", "a.tex"]);
  });

  it("refuses a rename that would have to guess", () => {
    const value = index({
      "a.tex": paper("\\label{x}"),
      "b.tex": paper("\\label{x}"),
      "frag.tex": "\\ref{x}\n",
    });
    expect(value.renameIsAmbiguous?.(symbol(value, "frag.tex", "ref", "x"))).toBe(true);
    expect(value.renameIsAmbiguous?.(symbol(value, "a.tex", "label", "x"))).toBe(false);
  });

  it("edits a fragment's reference when the fragment owns the label", () => {
    const value = index({
      "a.tex": paper(""),
      "b.tex": paper("\\ref{x}"),
      "frag.tex": "\\label{x}\\ref{x}\n",
    });
    expect(editedFiles(value, symbol(value, "frag.tex", "label", "x"))).toEqual([
      "b.tex",
      "frag.tex",
      "frag.tex",
    ]);
  });

  it("keeps an unresolved reference to its own document", () => {
    const value = index({
      "a.tex": paper("\\ref{typo}\\ref{typo}"),
      "b.tex": paper("\\ref{typo}"),
    });
    expect(editedFiles(value, symbol(value, "a.tex", "ref", "typo"))).toEqual(["a.tex", "a.tex"]);
  });

  it("only warns about a clash in the same document", () => {
    const value = index({
      "a.tex": paper("\\label{x}\\label{taken}"),
      "b.tex": paper("\\label{other}"),
    });
    expect(value.renamePlan(symbol(value, "a.tex", "label", "x"), "taken").collision).toBe(true);
    expect(value.renamePlan(symbol(value, "a.tex", "label", "x"), "other").collision).toBe(false);
  });

  it("leaves a .bib entry's rename project-wide", () => {
    const value = index({
      "a.tex": paper("\\cite{k}"),
      "b.tex": paper("\\cite{k}"),
      "refs.bib": "@misc{k, title={T}}\n",
    });
    expect(editedFiles(value, symbol(value, "a.tex", "cite", "k"))).toEqual(["a.tex", "b.tex", "refs.bib"]);
  });

  describe("across an index rebuild", () => {
    const shared = {
      "a.tex": paper("\\label{sec:a}\\ref{sec:a}\\input{shared}"),
      "b.tex": paper("\\label{sec:a}\\input{shared}"),
      "shared.tex": "\\ref{sec:a}\n",
    };

    it("finds the definition again in a merged snapshot", () => {
      const snapshot = project(shared);
      const definition = symbol(lazyLegacyIndex(snapshot), "a.tex", "label", "sec:a");
      const fresh = lazyLegacyIndex(
        mergeLanguageServiceIntelligence(snapshot, {
          identity: snapshot.identity,
          definitions: [],
          uses: [],
        }),
      );
      expect(editedFiles(fresh, definition)).toEqual(["a.tex", "a.tex", "b.tex", "shared.tex"]);
    });

    it("finds the definition again after an edit moved it", () => {
      const definition = symbol(index(shared), "a.tex", "label", "sec:a");
      const moved = index({ ...shared, "a.tex": paper("Words first.\\label{sec:a}\\ref{sec:a}\\input{shared}") });
      expect(editedFiles(moved, definition)).toEqual(["a.tex", "a.tex", "b.tex", "shared.tex"]);
    });
  });

  describe("a reference that names its file", () => {
    const linked = {
      "a.tex": paper("\\label{lab}"),
      "b.tex": paper("\\label{lab}"),
      "note.md": "[x](a.tex#lab)\n",
    };

    it("follows the label it names", () => {
      const value = index(linked);
      expect(editedFiles(value, symbol(value, "a.tex", "label", "lab"))).toEqual(["a.tex", "note.md"]);
      expect(editedFiles(value, symbol(value, "b.tex", "label", "lab"))).toEqual(["b.tex"]);
    });

    it("can start a rename", () => {
      const value = index(linked);
      const link = symbol(value, "note.md", "ref", "lab");
      expect(value.renameIsAmbiguous?.(link)).toBe(false);
      expect(editedFiles(value, link)).toEqual(["a.tex", "note.md"]);
    });

    it("follows a shared rename into the second document's label", () => {
      const value = index({
        "a.tex": paper("\\label{lab}\\input{shared}"),
        "b.tex": paper("\\label{lab}\\input{shared}"),
        "shared.tex": "\\ref{lab}\n",
        "note.md": "[x](b.tex#lab)\n",
      });
      expect(editedFiles(value, symbol(value, "a.tex", "label", "lab"))).toEqual([
        "a.tex",
        "b.tex",
        "note.md",
        "shared.tex",
      ]);
    });

    it("is listed with the label it names", () => {
      const value = index(linked);
      const files = value.allReferences(symbol(value, "a.tex", "label", "lab")).map((sym) => sym.file);
      expect(files.sort()).toEqual(["a.tex", "note.md"]);
    });
  });

  describe("a collision through a reference", () => {
    it("warns when a renamed reference lands on another label", () => {
      const value = index({
        "main.tex": paper("\\label{x}\\ref{y}"),
        "other.tex": paper(""),
        "frag.tex": "\\label{y}\n",
      });
      expect(value.renamePlan(symbol(value, "frag.tex", "label", "y"), "x").collision).toBe(true);
    });

    it("warns for a reference an open document follows", () => {
      const value = index({
        "r1.tex": paper("\\label{y}"),
        "r3.tex": paper("\\externaldocument{r1}\\label{x}\\ref{y}"),
      });
      expect(value.renamePlan(symbol(value, "r1.tex", "label", "y"), "x").collision).toBe(true);
    });

    it("says nothing when the new name is free where the reference is", () => {
      const value = index({
        "main.tex": paper("\\label{y}\\ref{y}"),
        "other.tex": paper("\\label{x}"),
      });
      expect(value.renamePlan(symbol(value, "main.tex", "label", "y"), "x").collision).toBe(false);
    });
  });

  describe("a definition known only by its whole extent", () => {
    const theorems = {
      "main.tex": paper("\\newtheorem{thm}{Theorem}\\input{chapters/intro}"),
      "main_v1.tex": paper("\\newtheorem{thm}{Theorem}\\input{chapters/intro}"),
      "chapters/intro.tex": "\\section{Intro}\n\\begin{thm}body\\end{thm}\n",
    };

    // What texlab reports: a theorem named by the whole environment around it.
    function withWholeEnvironment(snapshot: ProjectIntelligenceSnapshot) {
      const source = theorems["chapters/intro.tex"];
      const named = snapshot.definitions.find((definition) => definition.name === "thm");
      if (!named) throw new Error("no theorem definition");
      const from = source.indexOf("\\begin");
      const to = source.indexOf("\\end{thm}") + "\\end{thm}".length;
      const wide: ProjectDefinition = {
        ...named,
        id: "language-server:thm",
        source: "texlab",
        location: {
          file: "chapters/intro.tex",
          range: { ...named.location.range, from, to },
        },
      };
      return { ...snapshot, definitions: [wide, ...snapshot.definitions] };
    }

    it("renames the names and leaves the environment alone", () => {
      const value = legacyIndexFromProjectIntelligence(withWholeEnvironment(project(theorems)));
      const { edits } = value.renamePlan(symbol(value, "main.tex", "environment", "thm"), "lem");
      expect(edits.map((edit) => edit.file).sort()).toEqual([
        "chapters/intro.tex",
        "chapters/intro.tex",
        "main.tex",
        "main_v1.tex",
      ]);
      for (const edit of edits) expect(edit.to - edit.from).toBe("thm".length);
    });

    it("starts from a real name when F2 lands on the environment", () => {
      const value = legacyIndexFromProjectIntelligence(withWholeEnvironment(project(theorems)));
      const wide = value.defs.find(
        (definition) => definition.file === "chapters/intro.tex" && definition.name === "thm",
      );
      if (!wide) throw new Error("no wide definition");
      expect(value.renameTarget?.(wide)?.file).toMatch(/^main(_v1)?\.tex$/);
      expect(new Set(editedFiles(value, wide))).toEqual(
        new Set(["chapters/intro.tex", "main.tex", "main_v1.tex"]),
      );
    });

    it("leaves a link bound to a file alone when its label has no name range", () => {
      const figure = "\\begin{figure}\\label{x}\\end{figure}";
      const snapshot = project({
        "a.tex": paper(figure),
        "b.tex": paper("\\label{x}\\ref{x}"),
        "n.md": "[t](a.tex#x)\n",
      });
      const label = snapshot.definitions.find(
        (definition) => definition.location.file === "a.tex" && definition.name === "x",
      );
      if (!label) throw new Error("no label");
      const wide: ProjectDefinition = {
        ...label,
        id: "language-server:x",
        source: "texlab",
        location: { file: "a.tex", range: { ...label.location.range, from: 40, to: 60 } },
      };
      const value = legacyIndexFromProjectIntelligence({
        ...snapshot,
        definitions: [wide, ...snapshot.definitions.filter((definition) => definition !== label)],
      });
      const link = value.uses.find((use) => use.file === "n.md");
      if (!link) throw new Error("no link");
      expect(value.renameTarget?.(link)).toBeNull();
      expect(value.renamePlan(link, "new").edits).toEqual([]);
    });

    it("gives up rather than overwrite it when no real name is known", () => {
      const snapshot = withWholeEnvironment(project(theorems));
      const value = legacyIndexFromProjectIntelligence({
        ...snapshot,
        definitions: snapshot.definitions.filter(
          (definition) => definition.id === "language-server:thm",
        ),
      });
      const use = symbol(value, "chapters/intro.tex", "envuse", "thm");
      expect(value.renamePlan(use, "lem").edits).toEqual([]);
    });
  });

  describe("a stale definition that left its file", () => {
    const shared = {
      "a.tex": paper("\\label{sec:a}\\ref{sec:a}\\input{shared}"),
      "b.tex": paper("\\label{sec:a}\\input{shared}"),
      "shared.tex": "\\ref{sec:a}\n",
    };

    it("plans nothing", () => {
      const definition = symbol(index(shared), "a.tex", "label", "sec:a");
      const changed = index({ ...shared, "a.tex": paper("\\label{zzz}\\ref{zzz}\\input{shared}") });
      expect(changed.renamePlan(definition, "new")).toEqual({
        edits: [],
        fileCount: 0,
        collision: false,
      });
    });

    it("plans nothing with one document either", () => {
      const definition = symbol(index({ "a.tex": paper("\\label{a}") }), "a.tex", "label", "a");
      const changed = index({ "a.tex": paper("\\label{b}") });
      expect(changed.renamePlan(definition, "new").edits).toEqual([]);
    });

    it("picks the copy at the same place among duplicates in one file", () => {
      const sources = { "a.tex": paper("\\label{x}\\label{x}") };
      const value = index(sources);
      const [, second] = value.defs.filter((sym) => sym.kind === "label");
      const { edits } = value.renamePlan(second, "new");
      expect(edits.map((edit) => edit.from)).toEqual([second.nameFrom]);
    });
  });

  it("carries an orphan's use along when both of a macro's definitions are renamed", () => {
    const value = index({
      "a.tex": paper("\\newcommand{\\foo}{a}\\renewcommand{\\foo}{b}\\foo"),
      "b.tex": paper(""),
      "frag.tex": "\\foo\n",
    });
    const files = editedFiles(value, symbol(value, "a.tex", "macro", "foo"));
    expect(files).toContain("frag.tex");
  });

  it("carries a use along from an orphan that defines a macro twice", () => {
    const value = index({
      "a.tex": paper(""),
      "b.tex": paper(""),
      "defs.tex": "\\newcommand{\\foo}{a}\\renewcommand{\\foo}{b}\\foo\n",
      "frag.tex": "\\foo\n",
    });
    expect(new Set(editedFiles(value, symbol(value, "defs.tex", "macro", "foo")))).toEqual(
      new Set(["defs.tex", "frag.tex"]),
    );
  });

  it("does not count a macro's own definition as a free use", () => {
    const value = index({
      "a.tex": paper("\\newcommand{\\foo}{x}\\foo"),
      "b.tex": paper("\\newcommand{\\bar}{x}\\bar"),
      "o.tex": "\\newcommand{\\bar}{y}\n",
    });
    expect(value.renamePlan(symbol(value, "a.tex", "macro", "foo"), "bar").collision).toBe(false);
  });

  it("does not count a macro's second definition as a free use", () => {
    const value = index({
      "a.tex": paper("\\newcommand{\\foo}{x}\\foo"),
      "b.tex": paper(""),
      "f0.tex": "\\newcommand{\\q}{a}\\renewcommand{\\q}{b}\n",
    });
    expect(value.renamePlan(symbol(value, "a.tex", "macro", "foo"), "q").collision).toBe(false);
  });

  it("still sees a real collision on a macro's new name", () => {
    const value = index({
      "a.tex": paper("\\newcommand{\\foo}{x}\\newcommand{\\bar}{y}\\foo"),
      "b.tex": paper(""),
    });
    expect(value.renamePlan(symbol(value, "a.tex", "macro", "foo"), "bar").collision).toBe(true);
  });

  it("renames a fragment's own reference even when another document shares the name", () => {
    const value = index({
      "a.tex": paper("\\label{x}"),
      "b.tex": paper(""),
      "frag.tex": "\\label{x}\\ref{x}\n",
    });
    expect(editedFiles(value, symbol(value, "frag.tex", "label", "x"))).toEqual([
      "frag.tex",
      "frag.tex",
    ]);
  });

  describe("a collision that moves a reference", () => {
    it("warns when the renamed label would capture an existing reference", () => {
      const value = index({
        "main.tex": paper("\\label{y}\\ref{x}"),
        "other.tex": paper(""),
        "frag.tex": "\\label{x}\n",
      });
      expect(value.renamePlan(symbol(value, "main.tex", "label", "y"), "x").collision).toBe(true);
    });

    it("stays quiet when the renamed label hides a fragment's copy", () => {
      const value = index({
        "main.tex": paper("\\label{y}\\ref{y}"),
        "other.tex": paper(""),
        "frag.tex": "\\label{x}\n",
      });
      expect(value.renamePlan(symbol(value, "main.tex", "label", "y"), "x").collision).toBe(false);
    });

    it("stays quiet about a reference that names its file", () => {
      const value = index({
        "a.tex": paper("\\label{y}"),
        "b.tex": paper("\\label{x}"),
        "note.md": "[t](a.tex#y)\n",
      });
      expect(value.renamePlan(symbol(value, "a.tex", "label", "y"), "x").collision).toBe(false);
    });
  });

  describe("F2 outside a document", () => {
    it("starts from a macro's own definition, not the other copy", () => {
      const sources = {
        "a.tex": paper(""),
        "b.tex": paper(""),
        "frag1.tex": "\\newcommand{\\foo}{x}\n",
        "frag2.tex": "\\newcommand{\\foo}{y}\n",
      };
      const value = index(sources);
      const at = sources["frag2.tex"].indexOf("foo");
      const sym = value.symbolAt("frag2.tex", at);
      if (!sym) throw new Error("no symbol");
      expect(value.renameIsAmbiguous?.(sym)).toBe(false);
      expect(value.renameTarget?.(sym)?.file).toBe("frag2.tex");
    });

    it("leaves Typst and Markdown names to their own rules", () => {
      const value = index({
        "a.tex": paper(""),
        "b.tex": paper(""),
        "n.md": "# Sec {#d}\n\n## Sec2 {#d}\n\n[t](#d)\n",
      });
      expect(value.renameIsAmbiguous?.(symbol(value, "n.md", "ref", "d"))).toBe(false);
    });
  });

  it("does not let an edit sit inside another", () => {
    const value = index({ "n.md": "## [Unreleased]\n\ntext\n\n[Unreleased]: https://example.com/x\n" });
    const heading = value.defs.find((sym) => sym.file === "n.md");
    if (!heading) throw new Error("no heading");
    const { edits } = value.renamePlan(heading, "next");
    const sorted = [...edits].sort((left, right) => left.from - right.from);
    for (let at = 1; at < sorted.length; at += 1) {
      expect(sorted[at].from).toBeGreaterThanOrEqual(sorted[at - 1].to);
    }
  });

  it("renames \\newtheorem{theorem} in its argument, not in the command", () => {
    const value = index({ "a.tex": paper("\\newtheorem{theorem}{Theorem}") });
    const definition = symbol(value, "a.tex", "environment", "theorem");
    const source = paper("\\newtheorem{theorem}{Theorem}");
    expect(source.slice(definition.nameFrom, definition.nameTo)).toBe("theorem");
    expect(source[definition.nameFrom - 1]).toBe("{");
  });

  it("renames \\def\\d in its name, not in the command", () => {
    const source = paper("\\def\\d{x}");
    const value = index({ "a.tex": source });
    const definition = symbol(value, "a.tex", "macro", "d");
    expect(source[definition.nameFrom - 1]).toBe("\\");
    expect(source.slice(definition.nameFrom - 4, definition.nameFrom)).toBe("def\\");
  });

  it("edits a macro that is redefined once per place", () => {
    const value = index({
      "macros.tex": "\\newcommand{\\foo}{x}\n\\renewcommand{\\foo}{y}\n",
      "main.tex": paper("\\input{macros}\\foo"),
    });
    const { edits } = value.renamePlan(symbol(value, "macros.tex", "macro", "foo"), "qux");
    const places = edits.map((edit) => `${edit.file}:${edit.from}`);
    expect(new Set(places).size).toBe(places.length);
  });

  it("settles a long ladder of overlapping documents", () => {
    const steps = 120;
    const sources: Record<string, string> = {};
    for (let step = 0; step < steps; step += 1) {
      const name = String(step).padStart(4, "0");
      sources[`r${name}.tex`] = paper(`\\label{x}\\input{c${name}}`);
      const next = String(step + 1).padStart(4, "0");
      sources[`c${name}.tex`] = `\\ref{x}\n${step + 1 < steps ? `\\input{c${next}}\n` : ""}`;
    }
    const value = index(sources);
    const plan = value.renamePlan(symbol(value, "r0000.tex", "label", "x"), "new");
    const edited = new Set(plan.edits.map((edit) => edit.file));
    expect(edited.size).toBe(steps * 2);
  });

  it("exposes the scope without building the index", () => {
    const snapshot = project(revisions);
    const lazy = lazyLegacyIndex(snapshot);
    expect(lazy.unitScope).toBeDefined();
    expect(lazyLegacyIndex(project({ "main.tex": paper("") })).unitScope).toBeUndefined();
  });
});

describe("names outside the reach of units", () => {
  it("still renames a heading anchor whose slug is not its text", () => {
    const source = "# What's new?\n\nSee [x](#whats-new).\n";
    const value = legacyIndexFromProjectIntelligence(project({ "n.md": source }));
    const link = value.uses.find((use) => use.file === "n.md");
    if (!link) throw new Error("no link");
    expect(value.renamePlan(link, "fresh").edits).toHaveLength(2);
  });

  it.each([
    ["\\bibitem{ k } t", "\\bibitem"],
    ["\\newacronym{ k }{K}{Key}", "\\newacronym"],
    ["\\newglossaryentry{ k }{name=K}", "\\newglossaryentry"],
  ])("still renames a spaced key in %s", (entry) => {
    const source = paper(`${entry}\\cite{k}`);
    const value = legacyIndexFromProjectIntelligence(project({ "a.tex": source }));
    const definition = value.defs.find((sym) => sym.name === "k");
    if (!definition) throw new Error("no key");
    const { edits } = value.renamePlan(definition, "ZZ");
    expect(edits.length).toBeGreaterThan(0);
    for (const edit of edits) expect(source.slice(edit.from, edit.to)).toBe("k");
  });

  it("treats \\vpageref as a reference", () => {
    const value = legacyIndexFromProjectIntelligence(
      project({ "a.tex": paper("\\label{a}\\vpageref{a}") }),
    );
    expect(value.renamePlan(symbol(value, "a.tex", "label", "a"), "b").edits).toHaveLength(2);
  });
});

describe("a rename that keeps the compile whole", () => {
  const applied = (source: string, file: string, index: ProjectIndex, sym: Sym, name: string) =>
    index
      .renamePlan(sym, name)
      .edits.filter((edit) => edit.file === file)
      .sort((left, right) => right.from - left.from)
      .reduce(
        (text, edit) => text.slice(0, edit.from) + edit.newText + text.slice(edit.to),
        source,
      );

  it("moves \\end with \\begin", () => {
    const source = paper("\\newenvironment{qq}{}{}\\begin{qq}x\\end{qq}");
    const value = legacyIndexFromProjectIntelligence(project({ "a.tex": source }));
    const renamed = applied(source, "a.tex", value, symbol(value, "a.tex", "environment", "qq"), "zz");
    expect(renamed).toContain("\\newenvironment{zz}{}{}\\begin{zz}x\\end{zz}");
  });

  it("starts from \\end as well as \\begin", () => {
    const source = paper("\\newtheorem{thm}{T}\\begin{thm}x\\end{thm}");
    const value = legacyIndexFromProjectIntelligence(project({ "a.tex": source }));
    const end = value.uses.find((use) => use.from === source.indexOf("thm", source.indexOf("\\end{")));
    if (!end) throw new Error("no use at \\end");
    expect(value.renamePlan(end, "lem").edits).toHaveLength(3);
  });

  it.each([
    [
      "takes a \\renewenvironment along",
      "\\newenvironment{e}{}{}\\renewenvironment{e}{}{}\\begin{e}\\end{e}",
      "e",
      "\\newenvironment{z}{}{}\\renewenvironment{z}{}{}\\begin{z}\\end{z}",
    ],
    [
      "leaves a counter alone when only an environment shares its name",
      "\\newcounter{e}\\newenvironment{e}{}{}\\newtheorem{side}[e]{S}\\begin{e}\\end{e}",
      "e",
      "\\newcounter{e}\\newenvironment{z}{}{}\\newtheorem{side}[e]{S}\\begin{z}\\end{z}",
    ],
    [
      "reads a theorem's counter past a brace in its title",
      "\\newtheorem{thm}{T}\\newtheorem{sub}{{\\bfseries S}}[thm]",
      "thm",
      "\\newtheorem{z}{T}\\newtheorem{sub}{{\\bfseries S}}[z]",
    ],
    [
      "keeps a comment inside an environment's braces",
      "\\newenvironment{e}{}{}\\begin{e%why\n}x\\end{ e% note\n}",
      "e",
      "\\newenvironment{z}{}{}\\begin{z%why\n}x\\end{ z% note\n}",
    ],
  ])("%s", (_title, body, name, expected) => {
    const source = paper(body);
    const value = legacyIndexFromProjectIntelligence(project({ "a.tex": source }));
    const renamed = applied(source, "a.tex", value, symbol(value, "a.tex", "environment", name), "z");
    expect(renamed).toContain(expected);
  });

  it("plans the same rename from every site of a redefined environment", () => {
    const source = paper("\\newenvironment{e}{}{}\\renewenvironment{e}{}{}\\begin{e}\\end{e}");
    const value = legacyIndexFromProjectIntelligence(project({ "a.tex": source }));
    const sites = [...value.defs, ...value.uses].filter((sym) => sym.name === "e");
    expect(sites).toHaveLength(4);
    for (const site of sites) {
      expect(applied(source, "a.tex", value, site, "f")).toContain(
        "\\newenvironment{f}{}{}\\renewenvironment{f}{}{}\\begin{f}\\end{f}",
      );
    }
  });

  it("takes every spelling of a redefinition along", () => {
    for (const [first, second] of [
      ["\\NewDocumentEnvironment{e}{}{}{}", "\\RenewDocumentEnvironment{e}{}{}{}"],
      ["\\DeclareDocumentEnvironment{e}{}{}{}", "\\RenewDocumentEnvironment{e}{}{}{}"],
      ["\\newtheorem{e}{E}", "\\renewenvironment{e}{}{}"],
      ["\\newenvironment*{e}{}{}", "\\renewenvironment*{e}{}{}"],
    ]) {
      const source = paper(`${first}${second}\\begin{e}\\end{e}`);
      const value = legacyIndexFromProjectIntelligence(project({ "a.tex": source }));
      for (const site of value.defs.filter((sym) => sym.name === "e")) {
        expect(value.renamePlan(site, "f").edits).toHaveLength(4);
      }
    }
  });

  it("carries a redefinition in a shared file into the other document", () => {
    const sources = {
      "a.tex": paper("\\newenvironment{e}{}{}\\input{shared}"),
      "b.tex": paper("\\newenvironment{e}{}{}\\input{shared}"),
      "shared.tex": "\\renewenvironment{e}{}{}\n",
    };
    const value = legacyIndexFromProjectIntelligence(project(sources));
    for (const file of Object.keys(sources)) {
      expect(editedFiles(value, symbol(value, file, "environment", "e"))).toEqual([
        "a.tex",
        "b.tex",
        "shared.tex",
      ]);
    }
  });

  it("leaves a document that only shares the name out of a redefinition", () => {
    const value = legacyIndexFromProjectIntelligence(
      project({
        "a.tex": paper("\\newenvironment{e}{}{}\\renewenvironment{e}{}{}"),
        "b.tex": paper("\\newenvironment{e}{}{}"),
      }),
    );
    expect(editedFiles(value, symbol(value, "a.tex", "environment", "e"))).toEqual(["a.tex", "a.tex"]);
    expect(editedFiles(value, symbol(value, "b.tex", "environment", "e"))).toEqual(["b.tex"]);
  });

  it("renames both definitions an orphan holds", () => {
    const value = legacyIndexFromProjectIntelligence(
      project({
        "a.tex": paper(""),
        "b.tex": paper(""),
        "orphan.tex": "\\newenvironment{e}{}{}\\renewenvironment{e}{}{}\n",
      }),
    );
    expect(editedFiles(value, symbol(value, "orphan.tex", "environment", "e"))).toEqual([
      "orphan.tex",
      "orphan.tex",
    ]);
  });

  it("does not count \\renewenvironment as a use of itself", () => {
    const snapshot = project({ "a.tex": paper("\\renewenvironment{abstract}{}{}") });
    expect(snapshot.uses.filter((use) => use.name === "abstract")).toEqual([]);
  });

  it("takes a shared theorem counter along, in either place", () => {
    for (const [before, after] of [
      ["\\newtheorem{lem}[thm]{L}", "\\newtheorem{lem}[zz]{L}"],
      ["\\newtheorem{lem}{L}[thm]", "\\newtheorem{lem}{L}[zz]"],
    ]) {
      const source = paper(`\\newtheorem{thm}{T}${before}`);
      const value = legacyIndexFromProjectIntelligence(project({ "a.tex": source }));
      const renamed = applied(source, "a.tex", value, symbol(value, "a.tex", "environment", "thm"), "zz");
      expect(renamed).toContain(`\\newtheorem{zz}{T}${after}`);
    }
  });

  it("raises nothing new for a built-in environment or a section counter", () => {
    const snapshot = project({
      "a.tex": paper("\\newtheorem{thm}{T}[section]\\begin{figure}x\\end{figure}"),
    });
    expect(codes(snapshot)).toEqual([]);
  });

  it("renames a label a comment splits, as it always did", () => {
    const value = legacyIndexFromProjectIntelligence(
      project({ "a.tex": paper("\\section{B}\\label{sec:%\nc}\nSee \\ref{sec:c}.") }),
    );
    const reference = symbol(value, "a.tex", "ref", "sec:c");
    expect(value.renameTarget?.(reference)).not.toBeNull();
    expect(value.renamePlan(reference, "new").edits).toHaveLength(2);
  });
});

describe("a language server's whole-extent definitions", () => {
  const widen = (snapshot: ProjectIntelligenceSnapshot, file: string, from: number, to: number) => {
    const named = snapshot.definitions.find((definition) => definition.name === "thm");
    if (!named) throw new Error("no theorem definition");
    const wide: ProjectDefinition = {
      ...named,
      id: `language-server:${file}`,
      source: "texlab",
      location: { file, range: { ...named.location.range, from, to } },
    };
    return { ...snapshot, definitions: [wide, ...snapshot.definitions] };
  };

  it("refuse a rename the caret cannot tell apart", () => {
    const orphan = "\\begin{thm}body\\end{thm}\n";
    const snapshot = project({
      "a.tex": paper("\\newtheorem{thm}{T}\\begin{thm}\\end{thm}"),
      "b.tex": paper("\\newtheorem{thm}{T}"),
      "o.tex": orphan,
    });
    const value = legacyIndexFromProjectIntelligence(widen(snapshot, "o.tex", 0, orphan.length - 1));
    const inBody = value.symbolAt("o.tex", orphan.indexOf("body"));
    if (!inBody) throw new Error("nothing at the caret");
    expect(value.renameTarget?.(inBody)).toBeNull();
    expect(value.renamePlan(inBody, "lem").edits).toEqual([]);
  });

  it("do not read as a second definition of the theorem they are an instance of", () => {
    const source = paper("\\newtheorem{thm}{T}\\begin{thm}x\\end{thm}");
    const snapshot = project({ "a.tex": source });
    const instance = source.indexOf("\\begin{thm}");
    const merged = mergeLanguageServiceIntelligence(snapshot, {
      identity: snapshot.identity,
      definitions: widen(snapshot, "a.tex", instance, source.indexOf("\\end{document}")).definitions.slice(0, 1),
      uses: [],
    });
    const uses = merged.uses.filter((use) => use.kind === "environment" && use.name === "thm");
    expect(uses).toHaveLength(2);
    for (const use of uses) {
      expect(use.resolution).toBe("resolved");
      expect(definitionFiles(merged, use)).toEqual(["a.tex"]);
    }
  });

  it("stand in for an environment nothing else names", () => {
    const source = paper("\\newtheorem{thm}{T}\\begin{thm}x\\end{thm}");
    const snapshot = project({ "a.tex": source });
    const [instance] = widen(snapshot, "a.tex", source.indexOf("\\begin{thm}"), source.length).definitions;
    const use = snapshot.uses.find((candidate) => candidate.name === "thm");
    if (!use) throw new Error("no theorem use");
    const lookup = new Map([["environment:thm", [instance]]]);
    expect(definitionCandidatesForUse(use, lookup, undefined)).toEqual([instance]);
  });

  it("do not stand in for the name in go to definition", () => {
    const shared = "\\begin{thm}x\\end{thm}\n";
    const main = paper("\\newtheorem{thm}{T}\\input{chapters/one}\\begin{thm}y\\end{thm}");
    const snapshot = project({
      "main.tex": main,
      "other.tex": paper("\\input{chapters/one}"),
      "chapters/one.tex": shared,
    });
    const value = legacyIndexFromProjectIntelligence(
      widen(snapshot, "chapters/one.tex", 0, shared.length - 1),
    );
    const use = value.uses.find((sym) => sym.kind === "envuse" && sym.file === "main.tex");
    if (!use) throw new Error("no theorem use");
    expect(value.definitionFor(use)?.file).toBe("main.tex");
  });
});

describe("other reference commands", () => {
  it.each(["vrefrange{a}{b}", "fullref{a}", "Cpageref{a}", "Cpagerefrange{a}{b}"])(
    "\\%s follows a label rename",
    (command) => {
      const value = legacyIndexFromProjectIntelligence(
        project({ "a.tex": paper(`\\label{a}\\label{b}\\${command}`) }),
      );
      expect(value.renamePlan(symbol(value, "a.tex", "label", "a"), "z").edits).toHaveLength(2);
    },
  );
});

describe("the folder a compile runs in", () => {
  const sources = {
    "papers/a/main.tex": paper("\\input{intro}\\includegraphics{plot}"),
    "intro.tex": "Root\n",
    "papers/a/intro.tex": "Local\n",
    "plot.png": "",
    "papers/a/plot.png": "",
  };
  const compiled = (compileFolder?: string) =>
    assembleProjectIntelligence({
      identity: { projectId: "project", projectRevision: 1, requestGeneration: 1 },
      files: Object.fromEntries(
        Object.entries(sources)
          .filter(([file]) => file.endsWith(".tex"))
          .map(([file, source]) => [file, analyzeProjectFile(file, source, 1)]),
      ),
      knownFiles: Object.keys(sources),
      mainDocument: "papers/a/main.tex",
      ...(compileFolder ? { compileFolder } : {}),
      stats: { fileCount: 0, characterCount: 0, parsedFileCount: 0, reusedFileCount: 0, durationMs: 0 },
    });
  const target = (snapshot: ProjectIntelligenceSnapshot, kind: string) =>
    snapshot.hierarchy.edges.find((edge) => edge.kind === kind && edge.fromFile === "papers/a/main.tex")?.targetFile;

  it("opens an input from the project root by default", () => {
    expect(target(compiled(), "include")).toBe("intro.tex");
  });

  it("opens an input from the compile folder first", () => {
    expect(target(compiled("papers/a"), "include")).toBe("papers/a/intro.tex");
  });

  it("finds a figure in the same order", () => {
    expect(target(compiled(), "asset")).toBe("plot.png");
    expect(target(compiled("papers/a"), "asset")).toBe("papers/a/plot.png");
  });

  it("still opens a file only the main document's folder has", () => {
    const local = project({ "papers/a/main.tex": paper("\\input{note}"), "papers/a/note.tex": "x\n" }, "papers/a/main.tex");
    expect(target(local, "include")).toBe("papers/a/note.tex");
  });
});

describe("the outline's macros", () => {
  const sources = {
    "manuscript.tex": paper("\\newcommand{\\part}{Results}"),
    "manuscript_v1.tex": paper("\\newcommand{\\part}{Findings}"),
    "fragment.tex": "\\newcommand{\\extra}{x}\n",
  };

  it("come from the files the viewer is compiled with", () => {
    const value = legacyIndexFromProjectIntelligence(project(sources));
    expect(Object.keys(outlineSources(sources, value, "manuscript.tex")).sort()).toEqual([
      "fragment.tex",
      "manuscript.tex",
    ]);
  });

  it("put the viewer's own document last, because the last definition wins", () => {
    const three = {
      "a.tex": paper("\\newcommand{\\p}{Alpha}"),
      "b.tex": paper("\\newcommand{\\p}{Beta}"),
      "z.tex": "\\newcommand{\\p}{Orphan}\n",
    };
    const value = legacyIndexFromProjectIntelligence(project(three));
    expect(Object.keys(outlineSources(three, value, "a.tex")).at(-1)).toBe("a.tex");
  });

  it("keep every file for one document", () => {
    const one = { "main.tex": paper(""), "fragment.tex": "\\section{x}\n" };
    const value = legacyIndexFromProjectIntelligence(project(one));
    expect(outlineSources(one, value, "main.tex")).toBe(one);
  });
});

describe("Preflight", () => {
  const refs = (sources: Readonly<Record<string, string>>, mainDoc: string = Object.keys(sources)[0]) =>
    buildRefsContext({
      mainDoc,
      treePaths: Object.keys(sources),
      indexTexts: sources,
      openTexts: {},
      index: legacyIndexFromProjectIntelligence(project(sources, mainDoc)),
    });

  it("has no duplicate rows for side-by-side revisions", () => {
    const value = refs({
      "manuscript.tex": paper("\\label{a}\\ref{a}"),
      "manuscript_v1.tex": paper("\\label{a}\\ref{a}"),
    });
    expect(value.duplicateLabels).toEqual([]);
    expect(value.unreachableLabels).toBeUndefined();
    expect(value.definedLabels).toEqual(["a", "a"]);
  });

  it("reports one row per document that really clashes", () => {
    const value = refs({
      "a.tex": paper("\\input{chapter}\\label{x}"),
      "chapter.tex": "\\label{x}\n",
      "b.tex": paper("\\label{x}"),
    });
    expect(value.duplicateLabels).toEqual([{ label: "x", files: ["a.tex", "chapter.tex"] }]);
  });

  it("flags a reference only another document answers", () => {
    const sources = { "a.tex": paper("\\label{x}"), "b.tex": paper("\\ref{x}") };
    const value = refs(sources);
    expect(value.unreachableLabels).toEqual([{ file: "b.tex", labels: ["x"] }]);
    const findings = runRefsRules(sources["b.tex"], value, { file: "b.tex" });
    expect(findings.some((finding) => finding.id === "refs-undefined-ref")).toBe(true);
    expect(
      runRefsRules(sources["a.tex"], value, { file: "a.tex" }).some(
        (finding) => finding.id === "refs-undefined-ref",
      ),
    ).toBe(false);
  });

  it("does not flag an old revision split over several files", () => {
    const sources = {
      "main.tex": paper("\\label{m}"),
      "old/main.tex": paper("\\input{chapter}\\ref{old}"),
      "old/chapter.tex": "\\label{old}\n",
    };
    const value = refs(sources, "main.tex");
    expect(value.unreachableLabels).toBeUndefined();
    expect(
      runRefsRules(sources["old/main.tex"], value, { file: "old/main.tex" }).some(
        (finding) => finding.id === "refs-undefined-ref",
      ),
    ).toBe(false);
  });

  it("counts a float label as unreferenced when only another document cites it", () => {
    const value = refs({
      "a.tex": paper("\\label{fig:one}"),
      "b.tex": paper("\\label{fig:one}\\ref{fig:one}"),
    });
    expect(value.unreferencedLabels).toEqual([{ label: "fig:one", file: "a.tex" }]);
  });

  it("counts labels, not rows, in the title of the duplicate finding", () => {
    const sources = {
      "a.tex": paper("\\input{a_ch}\\label{x}"),
      "a_ch.tex": "\\label{x}\n",
      "b.tex": paper("\\input{b_ch}\\label{x}"),
      "b_ch.tex": "\\label{x}\n",
    };
    const context = refs(sources);
    expect(context.duplicateLabels).toHaveLength(2);
    const finding = runRefsRules(sources["a.tex"], context, { file: "a.tex" } as never).find(
      (item) => item.id === "refs-project-duplicate-label",
    );
    expect(JSON.stringify(finding?.title)).toContain('"count":1');
  });

  it("ignores a Typst reference when it decides a LaTeX label is unreferenced", () => {
    const value = refs({
      "a.tex": paper("\\label{fig:one}"),
      "b.tex": paper(""),
      "p.typ": "@fig:one\n",
    });
    expect(value.unreferencedLabels).toEqual([{ label: "fig:one", file: "a.tex" }]);
  });

  it("counts a label a Markdown link names as referenced", () => {
    const value = refs({
      "a.tex": paper("\\label{fig:lab}"),
      "b.tex": paper(""),
      "note.md": "[x](a.tex#fig:lab)\n",
    });
    expect(value.unreferencedLabels).toEqual([]);
  });

  it("does not call a link that names its file unreachable", () => {
    const value = refs({
      "a.tex": paper("\\label{sec:one}"),
      "b.tex": paper("\\href{a.tex#sec:one}{there}"),
    });
    expect(value.unreachableLabels).toBeUndefined();
  });

  it("gives no new finding for an orphan copy in a one-document project", () => {
    const value = refs({
      "main.tex": paper("\\label{fig:one}\\ref{fig:one}"),
      "stale.tex": "\\label{fig:one}\n",
    });
    expect(value.unreferencedLabels).toEqual([]);
    expect(value.duplicateLabels).toEqual([{ label: "fig:one", files: ["main.tex", "stale.tex"] }]);
  });
});

describe("outline titles", () => {
  it("takes a \\nameref title from the viewer's own document", () => {
    const value = legacyIndexFromProjectIntelligence(
      project({
        "a.tex": paper("\\section{Alpha}\\label{sec:a}"),
        "b.tex": paper("\\section{Beta}\\label{sec:a}"),
      }),
    );
    expect(headingTitlesByLabel(value, undefined, "b.tex").get("sec:a")).toBe("Beta");
    expect(headingTitlesByLabel(value, undefined, "a.tex").get("sec:a")).toBe("Alpha");
  });
});

describe("result size", () => {
  it("caps related locations and keeps the true count", () => {
    const labels = Array.from({ length: 25 }, () => "\\label{x}").join("\n");
    const snapshot = project({ "main.tex": paper(labels) });
    const duplicates = snapshot.diagnostics.filter((diagnostic) => diagnostic.code === "duplicate-definition");
    expect(duplicates).toHaveLength(25);
    expect(duplicates[0].related).toHaveLength(20);
    expect(duplicates[0].message.params?.count).toBe(25);
  });
});
