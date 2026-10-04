import { describe, expect, it } from "vitest";
import { analyzeProjectFile } from "@/lib/project-intelligence/analyze-file";
import { assembleProjectIntelligence } from "@/lib/project-intelligence/assemble";
import type {
  IntelligenceTreeNode,
} from "@/components/layout/IntelligenceTree";
import type { ProjectIntelligenceSnapshot } from "@/lib/project-intelligence/types";
import enWorkspace from "@/i18n/locales/en/workspace.json" with { type: "json" };
import {
  buildCitationNodes,
  buildLocationResultNodes,
  buildProjectStructureNodes,
  buildReferenceResultNodes,
  buildSymbolNodes,
  projectIssueCount,
} from "./project-intelligence-view";

const intelligence = enWorkspace.intelligence;

function snapshot(
  sources: Readonly<Record<string, string>>,
  mainDocument = "main.tex",
): ProjectIntelligenceSnapshot {
  const files = Object.fromEntries(
    Object.entries(sources).map(([file, source]) => [
      file,
      analyzeProjectFile(file, source, 1),
    ]),
  );
  return assembleProjectIntelligence({
    identity: { projectId: "p", projectRevision: 1, requestGeneration: 1 },
    files,
    knownFiles: Object.keys(sources),
    mainDocument,
    stats: {
      fileCount: Object.keys(files).length,
      characterCount: 0,
      parsedFileCount: Object.keys(files).length,
      reusedFileCount: 0,
      durationMs: 0,
    },
  });
}

function flatten(
  nodes: readonly IntelligenceTreeNode[],
): IntelligenceTreeNode[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children ?? [])]);
}

const labels = (nodes: readonly IntelligenceTreeNode[]) =>
  flatten(nodes).map((node) => node.label);

const PROJECT = snapshot({
  "main.tex": String.raw`\documentclass{article}
\newcommand{\proj}{Oleafly}
\begin{document}
\section{Introduction}
\label{sec:intro}
See \ref{sec:intro} and \ref{sec:missing}.
\cite{known} \cite{missing} \cite{dup}
\begin{theorem}
A claim.
\end{theorem}
\include{chapter}
\input{missing-file}
\end{document}`,
  "chapter.tex": String.raw`\section{Method}
\label{sec:method}
\cite{known}`,
  "orphan.tex": String.raw`\section{Unlinked}`,
  "refs.bib": `@article{known, title={A title}, author={An author}, year={2020}, journal={J}}
@book{dup, title={First}, author={Someone}, year={2019}, publisher={P}}
@book{dup, title={Second}, author={Someone}, year={2019}, publisher={P}}
@misc{sparse}`,
});

describe("project structure nodes", () => {
  const nodes = buildProjectStructureNodes(PROJECT);

  it("roots the tree at the main document and names every file", () => {
    expect(nodes.length).toBeGreaterThan(0);
    expect(nodes[0].label).toBe("main.tex");
    expect(nodes[0].kind).toBe("file");
    expect(nodes[0].description).toBe("main.tex");
    expect(nodes[0].provenance).toMatch(/^main\.tex:\d+:\d+$/);
  });

  it("groups the outgoing dependencies of a file", () => {
    const group = flatten(nodes).find(
      (node) => node.label === intelligence.groups.dependencies,
    );
    expect(group).toBeDefined();
    expect(group?.kind).toBe("group");
    expect(Number(group?.badge)).toBeGreaterThan(0);
  });

  it("describes each outline entry with its resolved kind", () => {
    const section = flatten(nodes).find((node) => node.label === "Introduction");
    expect(section?.kind).toBe("section");
    expect(section?.description).toBe(
      intelligence.inFile
        .replace("{{kind}}", intelligence.kinds.section)
        .replace("{{file}}", "main.tex"),
    );
  });

  it("marks an unresolvable dependency as missing", () => {
    const missing = flatten(nodes).find((node) => node.label === "missing-file");
    expect(missing?.badge).toBe(intelligence.badges.missing);
    expect(missing?.tone).toBe("danger");
  });

  it("collects the files nothing links to", () => {
    const onlyMainIsRoot = buildProjectStructureNodes({
      ...PROJECT,
      hierarchy: { ...PROJECT.hierarchy, roots: ["main.tex"] },
    });
    const unlinked = onlyMainIsRoot.find((node) => node.id === "project:unlinked");
    expect(unlinked?.label).toBe(intelligence.groups.unlinked);
    expect(Number(unlinked?.badge)).toBeGreaterThan(0);
    expect(labels(unlinked?.children ?? [])).toContain("orphan.tex");
  });
});

describe("citation nodes", () => {
  const nodes = buildCitationNodes(PROJECT);

  it("separates unresolved citations into their own group", () => {
    const group = nodes.find((node) => node.id === "citations:unresolved");
    expect(group?.label).toBe(intelligence.groups.unresolvedCitations);
    expect(group?.tone).toBe("danger");
    expect(labels(group?.children ?? [])).toContain("missing");
  });

  it("lists duplicate bibliography keys with a definition count", () => {
    const group = nodes.find((node) => node.id === "citations:duplicates");
    expect(group?.label).toBe(intelligence.groups.duplicateCitations);
    const key = group?.children?.find((node) => node.label === "dup");
    expect(key?.badge).toBe(
      intelligence.badges.definitions_other.replace("{{count}}", "2"),
    );
    expect(key?.children?.[0]?.description).toBe(
      intelligence.duplicateKeyIn
        .replace("{{key}}", "dup")
        .replace("{{file}}", "refs.bib"),
    );
  });

  it("groups the bibliography by file and flags an incomplete entry", () => {
    const group = nodes.find((node) => node.id === "citations:bibliography");
    expect(group?.label).toBe(intelligence.groups.bibliography);
    const entries = flatten(group?.children ?? []);
    const sparse = entries.find((node) => node.label === "sparse");
    expect(sparse?.badge).toBe(intelligence.badges.incomplete);
    expect(sparse?.description).toContain(intelligence.incompleteEntry);
    const known = entries.find((node) => node.label === "known");
    expect(known?.description).toContain("A title");
    expect(known?.badge).toBe("2020");
  });

  it("has nothing to show for a project with no citations", () => {
    expect(buildCitationNodes(snapshot({ "main.tex": "Plain text" }))).toEqual([]);
  });
});

describe("symbol nodes", () => {
  const nodes = buildSymbolNodes(PROJECT);

  it("leads with the unresolved and duplicate references", () => {
    const issues = nodes.find((node) => node.id === "symbols:issues");
    expect(issues?.label).toBe(intelligence.groups.unresolvedDuplicate);
    expect(issues?.tone).toBe("danger");
    expect(labels(issues?.children ?? [])).toContain("sec:missing");
  });

  it("groups the definitions the project declares", () => {
    const groupLabels = nodes.map((node) => node.label);
    expect(groupLabels).toContain(intelligence.groups.sections);
    expect(groupLabels).toContain(intelligence.groups.labels);
    expect(groupLabels).toContain(intelligence.groups.commands);
    expect(groupLabels).toContain(intelligence.groups.bibtexEntries);
    const macros = nodes.find((node) => node.label === intelligence.groups.commands);
    expect(labels(macros?.children ?? [])).toContain("proj");
  });

  it("marks a name defined twice as a duplicate", () => {
    const entries = nodes.find(
      (node) => node.label === intelligence.groups.bibtexEntries,
    );
    const duplicate = entries?.children?.find((node) => node.label === "dup");
    expect(duplicate?.badge).toBe(intelligence.badges.duplicate);
    expect(duplicate?.tone).toBe("warning");
  });

  it("has nothing to show for a project with no symbols", () => {
    expect(buildSymbolNodes(snapshot({ "main.tex": "Plain text" }))).toEqual([]);
  });
});

describe("reference query results", () => {
  it("splits definitions from occurrences", () => {
    const definitions = PROJECT.definitions.filter(
      (definition) => definition.name === "sec:intro",
    );
    const uses = PROJECT.uses.filter((use) => use.name === "sec:intro");
    const nodes = buildReferenceResultNodes(definitions, uses);
    expect(nodes[0].label).toBe(
      intelligence.groups.definitions_one.replace("{{count}}", "1"),
    );
    expect(nodes[0].badge).toBe("1");
    expect(nodes[1].label).toBe(intelligence.groups.occurrences);
    expect(labels(nodes[1].children ?? [])).toContain("main.tex");
  });

  it("returns nothing when the query matched nothing", () => {
    expect(buildReferenceResultNodes([], [])).toEqual([]);
  });
});

describe("project issue count", () => {
  it("counts only the diagnostics the panel surfaces", () => {
    expect(projectIssueCount(PROJECT)).toBeGreaterThan(0);
    expect(projectIssueCount(snapshot({ "main.tex": "Plain text" }))).toBe(0);
  });
});

describe("project structure edge cases", () => {
  it("marks an include that loops back to an open file as a cycle", () => {
    const looping = snapshot({
      "main.tex": String.raw`\begin{document}
\input{a}
\end{document}`,
      "a.tex": String.raw`\input{main}
\input{a}`,
    });

    const nodes = flatten(buildProjectStructureNodes(looping));
    const cycles = nodes.filter((node) => node.badge === intelligence.badges.cycle);

    expect(cycles.length).toBeGreaterThan(0);
    expect(cycles.every((node) => node.children === undefined)).toBe(true);
  });

  it("folds very deep include chains instead of expanding them", () => {
    const sources: Record<string, string> = {
      "main.tex": String.raw`\begin{document}
\input{f0}
\end{document}`,
    };
    for (let index = 0; index < 40; index += 1) {
      sources[`f${index}.tex`] = String.raw`\input{f${index + 1}}`;
    }
    sources["f40.tex"] = "end";

    const nodes = flatten(buildProjectStructureNodes(snapshot(sources)));
    const folded = nodes.filter((node) => node.badge === intelligence.badges.folded);

    expect(folded).toHaveLength(1);
    expect(folded[0].children?.[0]).toMatchObject({
      label: intelligence.folded.label,
      description: intelligence.folded.description,
      tone: "warning",
    });
  });
});

describe("location result nodes", () => {
  it("groups locations by file in name order and sorts each file by position", () => {
    const nodes = buildLocationResultNodes([
      { path: "src/b.tex", from: 30, to: 34, line: 3, column: 2, preview: "late" },
      { path: "src/b.tex", from: 5, to: 9, line: 1, column: 6, preview: "" },
      { path: "a.tex", from: 0, to: 4, line: 1, column: 1, preview: "first" },
    ]);

    expect(nodes.map((node) => [node.label, node.badge, node.description])).toEqual([
      ["a.tex", "1", "a.tex"],
      ["b.tex", "2", "src/b.tex"],
    ]);
    expect(nodes[1].children?.map((child) => [child.label, child.provenance, child.target])).toEqual([
      ["b.tex:1", "b.tex:1:6", { path: "src/b.tex", from: 5, to: 9 }],
      ["late", "b.tex:3:2", { path: "src/b.tex", from: 30, to: 34 }],
    ]);
    expect(buildLocationResultNodes([])).toEqual([]);
  });
});

describe("Typst project structure", () => {
  const typst = snapshot(
    {
      "main.typ": [
        '#import "lib.typ": *',
        '#include "chapter.typ"',
        '#image("figure.png")',
        '#bibliography("refs.bib")',
        "= Intro <intro>",
        "See @intro.",
      ].join("\n"),
      "lib.typ": "#let helper = 1",
      "chapter.typ": "== Body",
      "refs.bib": "@misc{a, title={A}}",
    },
    "main.typ",
  );

  it("describes Typst imports, includes, assets and bibliographies by their kind", () => {
    const descriptions = flatten(buildProjectStructureNodes(typst)).map((node) => node.description ?? "");

    for (const kind of ["import", "include", "asset", "bibliography"] as const) {
      expect(descriptions).toContain(
        intelligence.fromFile.replace("{{kind}}", intelligence.kinds[kind]).replace("{{file}}", "main.typ"),
      );
    }
  });
});

describe("reference results for every kind", () => {
  const location = (file: string, from: number) => ({
    file,
    range: { from, to: from + 1, startLine: 3, startColumn: 4, endLine: 3, endColumn: 5 },
  });
  const definition = (kind: string, name: string) =>
    ({ id: `${kind}-${name}`, source: "local", engine: "latex", kind, name, location: location("main.tex", 1) }) as never;
  const use = (kind: string, name: string, resolution: string, from: number) =>
    ({
      id: `${kind}-${name}`,
      source: "local",
      engine: "typst",
      kind,
      name,
      location: location("main.typ", from),
      resolution,
      definitionIds: [],
    }) as never;

  it("names definitions and uses by their kind and marks external targets", () => {
    const nodes = buildReferenceResultNodes(
      [
        definition("anchor", "fig"),
        definition("environment", "theorem"),
        definition("glossary", "api"),
        definition("macro", "proj"),
        definition("custom-kind", "thing"),
      ],
      [
        use("macro", "proj", "resolved", 10),
        use("environment", "theorem", "resolved", 20),
        use("import", "lib.typ", "resolved", 30),
        use("link", "https://typst.app", "external", 40),
      ],
    );

    const definitions = nodes[0].children ?? [];
    expect(definitions.map((node) => [node.kind, node.description])).toEqual([
      ["label", "anchor in main.tex"],
      ["environment", "environment in main.tex"],
      ["glossary", "glossary in main.tex"],
      ["macro", "macro in main.tex"],
      ["custom-kind", "custom kind in main.tex"],
    ]);
    expect(definitions.every((node) => node.badge === intelligence.badges.duplicate)).toBe(true);
    expect(definitions[0].provenance).toBe("main.tex:3:5");

    const uses = flatten(nodes[1].children ?? []).filter((node) => node.target);
    expect(uses.map((node) => [node.kind, node.description, node.badge ?? null, node.tone])).toEqual([
      ["macro", "macro in main.typ", null, "default"],
      ["environment", "environment in main.typ", null, "default"],
      ["include", "import in main.typ", null, "default"],
      ["reference", "link in main.typ", intelligence.badges.external, "muted"],
    ]);
  });
});
