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
  buildProjectStructureNodes,
  buildReferenceResultNodes,
  buildSymbolNodes,
  projectIssueCount,
} from "./project-intelligence-view";

const intelligence = enWorkspace.intelligence;

function snapshot(
  sources: Readonly<Record<string, string>>,
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
