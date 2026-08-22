import { describe, expect, it } from "vitest";
import {
  analyzeProjectFile,
  latexCommandKeyTokens,
} from "./analyze-file";
import {
  assembleProjectIntelligence,
  unreadableFileIntelligence,
} from "./assemble";
import { citationCompletions } from "./selectors";
import {
  acceptedProjectSnapshot,
  currentProjectIntelligence,
} from "./current";
import { currentFileReferenceDiagnostics } from "@/components/editor/cm/project-intelligence";
import {
  rawInlineTokenAttributes,
  tokensFromRawInline,
} from "@/components/editor/wysiwyg/project-intelligence";
import type {
  FileIntelligence,
  ProjectIntelligenceSnapshot,
} from "./types";
import { useFilesStore } from "@/store/files";
import { useIndexStore } from "@/store/project-index";

function snapshot(
  sources: Readonly<Record<string, string>>,
  knownFiles: readonly string[] = Object.keys(sources),
  projectRevision = 1,
): ProjectIntelligenceSnapshot {
  const files = Object.fromEntries(
    Object.entries(sources).map(([file, source]) => [
      file,
      analyzeProjectFile(file, source, projectRevision),
    ]),
  );
  return assembleProjectIntelligence({
    identity: {
      projectId: "project",
      projectRevision,
      requestGeneration: projectRevision,
    },
    files,
    knownFiles,
    mainDocument: Object.keys(sources).find((file) =>
      /\.(?:tex|md|typ)$/i.test(file),
    ),
    stats: {
      fileCount: Object.keys(files).length,
      characterCount: Object.values(sources).reduce(
        (sum, source) => sum + source.length,
        0,
      ),
      parsedFileCount: Object.keys(files).length,
      reusedFileCount: 0,
      durationMs: 0,
    },
  });
}

function uses(
  value: ProjectIntelligenceSnapshot,
  kind: "reference" | "citation" | "asset" | "link",
) {
  return value.uses.filter((use) => use.kind === kind);
}

describe("Phase 3 project intelligence acceptance", () => {
  it("keeps malformed repeated unclosed TeX groups near-linear and explicitly partial", () => {
    const malformed = (count: number) =>
      String.raw`\ref{`.repeat(count);
    // Warm module/regex paths so the ratio measures scaling rather than first
    // execution setup.
    latexCommandKeyTokens(malformed(32));

    // Build the input outside the timed region: `.repeat(4000)` allocates, and
    // that allocation is not what is being measured.
    const measure = (count: number) => {
      const source = malformed(count);
      const started = performance.now();
      const tokens = latexCommandKeyTokens(source);
      return { duration: performance.now() - started, tokens };
    };
    const oneThousand = measure(1_000);
    const fourThousand = measure(4_000);

    expect(oneThousand.tokens).toEqual([]);
    expect(fourThousand.tokens).toEqual([]);
    expect(fourThousand.duration).toBeLessThan(150);
    // The ratio is what enforces near-linear scaling: 4x the input inside 8x
    // the time rules out the quadratic blowup this guards against. The floor
    // matters because both sides are single wall-clock samples on a shared
    // runner - when the 1,000 case happens to be measured fast, 8x it becomes
    // a bound no correct implementation can meet. CI failed here at 45.77ms
    // against a 43.47ms bound derived from a 5.43ms sample, with the algorithm
    // unchanged. 60ms is above that noise and still well under what a
    // quadratic regression would produce at this size.
    expect(fourThousand.duration).toBeLessThan(
      Math.max(60, oneThousand.duration * 8),
    );

    const analysisStarted = performance.now();
    const file = analyzeProjectFile(
      "malformed.tex",
      malformed(500),
      1,
    );
    expect(performance.now() - analysisStarted).toBeLessThan(150);
    expect(file.status).toBe("partial");
    expect(
      file.uses.filter(
        (use) =>
          use.kind === "reference" || use.kind === "citation",
      ),
    ).toEqual([]);
    expect(
      file.diagnostics.some(
        (diagnostic) => diagnostic.code === "malformed-source",
      ),
    ).toBe(true);
  });

  it("retains cross-file LaTeX command and environment argument forms", () => {
    const file = analyzeProjectFile(
      "macros.sty",
      String.raw`
% \newcommand{\commented}[1]{}
\begin{verbatim}
\newcommand{\codeonly}[1]{}
\end{verbatim}
\newcommand{\classic}[2][wide]{#1/#2}
\NewDocumentCommand{\modern}{m O{fallback} r()}{}
\def\primitive#1#2{}
\newenvironment{classicenv}[1][default]{}{}
\NewDocumentEnvironment{modernenv}{m o}{}{}
`,
      1,
    );
    const byName = new Map(
      file.definitions.map((definition) => [
        definition.name,
        definition,
      ]),
    );

    expect(byName.has("commented")).toBe(false);
    expect(byName.has("codeonly")).toBe(false);
    expect(byName.get("classic")?.latexArguments).toEqual({
      syntax: "classic",
      requiredCount: 1,
      optionalCount: 1,
      optionalDefault: "wide",
      completionSnippet: `[\${1:wide}]{\${2}}`,
    });
    expect(byName.get("modern")?.latexArguments).toEqual({
      syntax: "xparse",
      requiredCount: 2,
      optionalCount: 1,
      xparseSpecification: "m O{fallback} r()",
      completionSnippet: `{\${1}}[\${2:fallback}](\${3})`,
    });
    expect(byName.get("primitive")?.latexArguments).toMatchObject({
      syntax: "tex-def",
      requiredCount: 2,
      completionSnippet: `{\${1}}{\${2}}`,
    });
    expect(byName.get("classicenv")?.latexArguments).toMatchObject({
      optionalDefault: "default",
      completionSnippet: `[\${1:default}]`,
    });
    expect(byName.get("modernenv")?.latexArguments).toMatchObject({
      xparseSpecification: "m o",
      completionSnippet: `{\${1}}[\${2}]`,
    });
  });

  it("resolves broad LaTeX reference, citation, file, link, and asset forms with exact ranges", () => {
    const main = String.raw`\input{sections/body}
\crefrange{sec:start}{sec:end}
\hyperref[sec:end]{end}
\href{sections/body.tex#sec:end}{body}
\includegraphics{images/plot}
\textcites[see][4]{alpha}{beta}
\volcite{2}{alpha}`;
    const value = snapshot(
      {
        "main.tex": main,
        "sections/body.tex": String.raw`\section{Body}
\label{sec:start}
\label{sec:end}`,
        "refs.bib": `@article{alpha, author={A}, title={One}, journal={J}, year={2025}}
@book{beta, editor={B}, title={Two}, publisher={P}, year={2026}}`,
      },
      [
        "main.tex",
        "sections/body.tex",
        "refs.bib",
        "images/plot.pdf",
      ],
    );

    expect(
      uses(value, "reference").map((use) => [
        use.name,
        use.resolution,
        main.slice(use.location.range.from, use.location.range.to),
      ]),
    ).toEqual(
      expect.arrayContaining([
        ["sec:start", "resolved", "sec:start"],
        ["sec:end", "resolved", "sec:end"],
      ]),
    );
    expect(
      uses(value, "citation").map((use) => [
        use.name,
        use.resolution,
      ]),
    ).toEqual(
      expect.arrayContaining([
        ["alpha", "resolved"],
        ["beta", "resolved"],
      ]),
    );
    expect(
      value.hierarchy.edges.find(
        (edge) => edge.rawTarget === "images/plot",
      ),
    ).toMatchObject({
      kind: "asset",
      resolution: "resolved",
      targetFile: "images/plot.pdf",
    });
    expect(
      value.definitions.filter(
        (definition) => definition.kind === "file",
      ),
    ).toHaveLength(3);
    expect(value.diagnostics).toEqual([]);
  });

  it("reports duplicate definitions and every affected reference/citation range", () => {
    const value = snapshot({
      "main.tex": String.raw`\label{same}
\ref{same}
\cite{dup}`,
      "other.tex": String.raw`\label{same}
\eqref{same}`,
      "one.bib": "@misc{dup, title={One}}",
      "two.bib": "@misc{dup, title={Two}}",
    });

    expect(
      value.diagnostics.filter(
        (diagnostic) => diagnostic.code === "duplicate-definition",
      ),
    ).toHaveLength(4);
    expect(
      value.diagnostics.filter(
        (diagnostic) =>
          diagnostic.code === "duplicate-citation-key",
      ),
    ).toHaveLength(3);
    expect(
      citationCompletions(value, "dup").map((completion) => ({
        key: completion.key,
        duplicate: completion.duplicate,
        duplicateCount: completion.duplicateCount,
        file: completion.location.file,
      })),
    ).toEqual([
      {
        key: "dup",
        duplicate: true,
        duplicateCount: 2,
        file: "one.bib",
      },
      {
        key: "dup",
        duplicate: true,
        duplicateCount: 2,
        file: "two.bib",
      },
    ]);
    for (const diagnostic of value.diagnostics) {
      expect(diagnostic.location.range.to).toBeGreaterThan(
        diagnostic.location.range.from,
      );
    }

    const duplicateFileTarget = snapshot(
      { "main.tex": String.raw`\input{chapter}` },
      ["main.tex", "chapter.tex", "Chapter.tex"],
    );
    expect(
      duplicateFileTarget.hierarchy.edges[0],
    ).toMatchObject({
      resolution: "duplicate",
      candidateFiles: ["Chapter.tex", "chapter.tex"],
    });
    expect(
      duplicateFileTarget.diagnostics[0],
    ).toMatchObject({
      code: "unresolved-target",
      location: duplicateFileTarget.hierarchy.edges[0].location,
    });
  });

  it("keeps Markdown anchors file-scoped and resolves Pandoc citation and shortcut-reference forms", () => {
    const article = String.raw`# Intro
See [local](#intro), [remote](other.md#intro), and [Guide].

[@alpha, p. 4; -@beta]
email@example.com and \@escaped

[guide]: #intro`;
    const value = snapshot({
      "article.md": article,
      "other.md": "# Intro\n",
      "references.bib": `@misc{alpha, title={Alpha}}
@misc{beta, title={Beta}}`,
    });

    expect(
      uses(value, "citation").map((use) => use.name),
    ).toEqual(["alpha", "beta"]);
    expect(
      uses(value, "reference").filter(
        (use) => use.name === "intro",
      ),
    ).toHaveLength(2);
    expect(
      uses(value, "reference").every(
        (use) => use.resolution === "resolved",
      ),
    ).toBe(true);
    expect(
      value.diagnostics.some(
        (diagnostic) =>
          diagnostic.code === "duplicate-definition",
      ),
    ).toBe(false);
    expect(value.diagnostics).toEqual([]);
  });

  it("strips malformed nested-looking HTML tags before creating Markdown anchors", () => {
    const file = analyzeProjectFile(
      "article.md",
      "# <<script>alert</script> Safe\n",
      1,
    );
    const anchors = file.definitions
      .filter((definition) => definition.kind === "anchor")
      .map((definition) => definition.name);
    expect(anchors).toContain("alert-safe");
    expect(anchors.every((anchor) => !anchor.includes("<"))).toBe(
      true,
    );
  });

  it("resolves Typst markup and explicit multi-key citations without turning cite labels into definitions", () => {
    const value = snapshot({
      "main.typ": `#bibliography("refs.bib")
= Start <start>
See @start, @alpha, #ref(<start>), and #cite((<alpha>, label("beta")), form: "full").
#link("chapters/next.typ")`,
      "chapters/next.typ": "= Next\n",
      "refs.bib": `@misc{alpha, title={Alpha}}
@misc{beta, title={Beta}}`,
    });

    const citations = uses(value, "citation");
    expect(citations.map((use) => use.name)).toEqual([
      "alpha",
      "alpha",
      "beta",
    ]);
    expect(
      citations.every((use) => use.resolution === "resolved"),
    ).toBe(true);
    expect(
      value.definitions.filter(
        (definition) =>
          definition.engine === "typst" &&
          (definition.name === "alpha" ||
            definition.name === "beta"),
      ),
    ).toEqual([]);
    expect(
      value.hierarchy.edges.find(
        (edge) => edge.rawTarget === "chapters/next.typ",
      ),
    ).toMatchObject({ resolution: "resolved" });
    expect(value.diagnostics).toEqual([]);
  });

  it("recovers later BibTeX entries, catalogs metadata, and validates cross-entry fields", () => {
    const source = `@article{broken,
  title = "never closed
@book{parent,
  editor = {Editor},
  title = {Parent},
  publisher = {Press},
  year = {2025}
}
@inproceedings{child,
  author = {Author},
  title = {Child},
  booktitle = {Proceedings},
  year = {2026},
  crossref = {parent}
}`;
    const value = snapshot({ "refs.bib": source });
    const file = value.files["refs.bib"];

    expect(file.status).toBe("partial");
    expect(value.status).toBe("partial");
    expect(value.bibliography.entries.map((entry) => entry.key)).toEqual([
      "broken",
      "child",
      "parent",
    ]);
    expect(
      value.uses.find(
        (use) =>
          use.location.file === "refs.bib" &&
          use.name === "parent",
      ),
    ).toMatchObject({
      kind: "citation",
      resolution: "resolved",
    });
    expect(
      value.diagnostics.some(
        (diagnostic) =>
          diagnostic.code === "malformed-bibtex",
      ),
    ).toBe(true);

    const parent = citationCompletions(value, "parent")[0];
    expect(parent).toMatchObject({
      key: "parent",
      author: "Editor",
      title: "Parent",
      year: "2025",
    });
  });

  it("keeps exact source ranges for normalized multiline BibTeX cross-entry fields", () => {
    const source = `@misc{parent, title={Parent}}
@misc{second, title={Second}}
@misc{child,
  title = {Child},
  related = { parent,
              second }
}`;
    const value = snapshot({ "refs.bib": source });
    const crossEntryUses = uses(value, "citation").filter(
      (use) => use.location.file === "refs.bib",
    );

    expect(crossEntryUses.map((use) => use.name)).toEqual([
      "parent",
      "second",
    ]);
    for (const use of crossEntryUses) {
      expect(
        source.slice(
          use.location.range.from,
          use.location.range.to,
        ),
      ).toBe(use.name);
      expect(use.resolution).toBe("resolved");
    }
  });

  it("parses TeX arguments across comments/newlines and every Typst citation array key", () => {
    const latex = String.raw`\cite% optional note follows
 [see]
 {alpha}
\crefrange% split arguments
 {start}
 {end}`;
    const typst = `#cite(["alpha", "beta"])`;
    const value = snapshot({
      "main.tex": latex,
      "main.typ": typst,
      "labels.tex": String.raw`\label{start}\label{end}`,
      "refs.bib": `@misc{alpha, title={Alpha}}
@misc{beta, title={Beta}}`,
    });

    expect(
      uses(value, "citation").map((use) => [
        use.location.file,
        use.name,
      ]),
    ).toEqual(
      expect.arrayContaining([
        ["main.tex", "alpha"],
        ["main.typ", "alpha"],
        ["main.typ", "beta"],
      ]),
    );
    expect(
      uses(value, "reference").map((use) => use.name),
    ).toEqual(expect.arrayContaining(["start", "end"]));
    expect(value.diagnostics).toEqual([]);
  });

  it("rejects cite-like command names, URL syntax, and plain bracket prose", () => {
    const value = snapshot({
      "main.tex": String.raw`\excited{not-a-citation}
\cite{alpha}`,
      "article.md": `Plain [important] prose.
[real]
[real]: https://example.com/@definition-user#definition-fragment
[external](https://example.com/@link-user#link-fragment)
Bare https://example.com/@bare-user#bare-fragment`,
      "refs.bib": "@misc{alpha, title={Alpha}}",
    });

    expect(
      uses(value, "citation").map((use) => use.name),
    ).toEqual(["alpha"]);
    expect(
      uses(value, "reference")
        .filter((use) => use.location.file === "article.md")
        .map((use) => use.name),
    ).toEqual(["real"]);
    expect(
      value.uses.some((use) =>
        /(?:not-a-citation|definition-user|definition-fragment|link-user|link-fragment|bare-user|bare-fragment|important)/u.test(
          use.name,
        ),
      ),
    ).toBe(false);
  });

  it("balances Typst cite arguments without treating parentheses in escaped strings as structure", () => {
    const typst = String.raw`#cite(("alpha", note: "literal ) and \" (", "beta"))`;
    const value = snapshot({
      "main.typ": typst,
      "refs.bib": `@misc{alpha, title={Alpha}}
@misc{beta, title={Beta}}`,
    });

    expect(
      uses(value, "citation")
        .filter((use) => use.location.file === "main.typ")
        .map((use) => [
          use.name,
          typst.slice(use.location.range.from, use.location.range.to),
        ]),
    ).toEqual([
      ["alpha", "alpha"],
      ["beta", "beta"],
    ]);
    expect(value.diagnostics).toEqual([]);
  });

  it("normalizes TeX comment-spliced definition/reference/citation keys with source-mappable ranges", () => {
    const latex = String.raw`\label{al% remove this line
pha}
\ref{al% remove this too
pha}
\cite{be% and this
ta}`;
    const value = snapshot({
      "main.tex": latex,
      "refs.bib": "@misc{beta, title={Beta}}",
    });
    const label = value.definitions.find(
      (definition) =>
        definition.location.file === "main.tex" &&
        definition.kind === "label",
    );
    const keyUses = value.uses.filter(
      (use) =>
        use.location.file === "main.tex" &&
        (use.kind === "reference" || use.kind === "citation"),
    );

    expect(label?.name).toBe("alpha");
    expect(keyUses.map((use) => use.name)).toEqual(["alpha", "beta"]);
    expect(
      keyUses.every((use) => use.resolution === "resolved"),
    ).toBe(true);
    for (const item of [label, ...keyUses]) {
      expect(item).toBeDefined();
      if (!item) throw new Error("Expected a source-mapped key.");
      const range = item.location.range;
      const mapped = latex
        .slice(range.from, range.to)
        .replace(/%[^\r\n]*(?:\r\n|\r|\n)/gu, "");
      expect(mapped).toBe(item.name);
    }
  });

  it("analyzes every Visual raw-LaTeX key and elevates an unresolved key over valid siblings", () => {
    const source = String.raw`\cite{alpha, missing}`;
    const value = snapshot({
      "main.tex": source,
      "refs.bib": "@misc{alpha, title={Alpha}}",
    });
    const tokens = tokensFromRawInline(source);

    expect(
      tokens.map((token) => [
        token.key,
        source.slice(token.sourceFrom, token.sourceTo),
      ]),
    ).toEqual([
      ["alpha", "alpha"],
      ["missing", "missing"],
    ]);
    const attributes = rawInlineTokenAttributes(
      value,
      "main.tex",
      source,
    );
    expect(attributes).toMatchObject({
      class: expect.stringContaining("is-unresolved"),
      "data-project-intelligence-key": "missing",
      "data-project-intelligence-source-from": String(
        source.indexOf("missing"),
      ),
      "data-project-intelligence-source-to": String(
        source.indexOf("missing") + "missing".length,
      ),
    });
    expect(
      JSON.parse(
        attributes?.["data-project-intelligence-token-states"] ?? "[]",
      ),
    ).toEqual([
      expect.objectContaining({
        key: "alpha",
        resolution: "resolved",
      }),
      expect.objectContaining({
        key: "missing",
        resolution: "unresolved",
      }),
    ]);
  });

  it("withholds retained snapshots from navigation surfaces while analysis is running or failed", () => {
    const accepted = snapshot({
      "main.tex": String.raw`\section{Old range}`,
    });
    const pendingIdentity = {
      projectId: "project",
      projectRevision: 2,
      requestGeneration: 2,
    };
    expect(
      acceptedProjectSnapshot(
        {
          status: "running",
          identity: pendingIdentity,
          data: accepted,
          stale: true,
        },
        "project",
      ),
    ).toBeNull();
    expect(
      acceptedProjectSnapshot(
        {
          status: "error",
          identity: pendingIdentity,
          data: accepted,
          stale: true,
          failure: {
            name: "ProjectIntelligenceError",
            message: "failed",
            retryable: true,
          },
        },
        "project",
      ),
    ).toBeNull();
    expect(
      acceptedProjectSnapshot(
        {
          status: "success",
          identity: accepted.identity,
          data: accepted,
          stale: false,
        },
        "project",
      ),
    ).toBe(accepted);
  });

  it("uses a bounded masked active-file fallback without scanning background raw buffers", () => {
    const accepted = snapshot({
      "main.tex": String.raw`\ref{stable}`,
      "other.tex": String.raw`\label{stable}`,
    });
    const pendingIdentity = {
      projectId: "project",
      projectRevision: 2,
      requestGeneration: 2,
    };
    try {
      useFilesStore.setState({
        projectId: "project",
        activePath: "main.tex",
        tree: [
          { path: "main.tex", is_dir: false },
          { path: "other.tex", is_dir: false },
        ],
        files: {
          "main.tex": {
            content: String.raw`\ref{stable}`,
            dirty: true,
          },
          // This definition is deliberately newer than the accepted snapshot.
          // The fallback must not scan it as raw project-wide text.
          "other.tex": {
            content: String.raw`\label{buffer-only}`,
            dirty: true,
          },
        },
      });
      useIndexStore.setState({
        texts: {
          "main.tex": String.raw`\ref{stable}`,
          "other.tex": String.raw`\label{stable}`,
        },
        intelligenceState: {
          status: "running",
          identity: pendingIdentity,
          data: accepted,
          stale: true,
          currentFileFallbackAllowed: true,
        },
      });

      const current = String.raw`% \ref{comment-only}
\ref{stable}
\ref{buffer-only}`;
      const diagnostics = currentFileReferenceDiagnostics(
        "main.tex",
        current,
      );
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0].message).toContain("buffer-only");
      expect(
        current.slice(diagnostics[0].from, diagnostics[0].to),
      ).toBe("buffer-only");

      const denseSource = String.raw`\ref{stable}`.repeat(8_000);
      const denseStarted = performance.now();
      expect(
        currentFileReferenceDiagnostics("main.tex", denseSource),
      ).toEqual([]);
      expect(performance.now() - denseStarted).toBeLessThan(50);

      const before =
        useIndexStore.getState().intelligenceState;
      const started = performance.now();
      expect(
        currentFileReferenceDiagnostics(
          "main.tex",
          "x".repeat(100_001),
        ),
      ).toEqual([]);
      expect(performance.now() - started).toBeLessThan(50);
      expect(useIndexStore.getState().intelligenceState).toBe(before);
      expect(before).toMatchObject({
        status: "running",
        stale: true,
      });

      useIndexStore.setState({
        intelligenceState: {
          ...before,
          currentFileFallbackAllowed: false,
        },
      });
      expect(
        currentFileReferenceDiagnostics(
          "main.tex",
          String.raw`\ref{buffer-only}`,
        ),
      ).toEqual([]);
    } finally {
      useIndexStore.getState().reset();
      useFilesStore.setState({
        projectId: null,
        activePath: null,
        tree: [],
        files: {},
      });
    }
  });

  it("retains useful partial structure and truthful unreadable-file state", () => {
    const malformed = analyzeProjectFile(
      "main.typ",
      "= Recovered <ok>\n#let broken = (\n/* open",
      1,
    );
    const unreadable = unreadableFileIntelligence(
      "missing.tex",
      1,
      "Permission denied.",
    ) as FileIntelligence;
    const value = assembleProjectIntelligence({
      identity: {
        projectId: "project",
        projectRevision: 1,
        requestGeneration: 1,
      },
      files: {
        "main.typ": malformed,
        "missing.tex": unreadable,
      },
      knownFiles: ["main.typ", "missing.tex"],
      mainDocument: "main.typ",
      stats: {
        fileCount: 2,
        characterCount: 40,
        parsedFileCount: 1,
        reusedFileCount: 0,
        durationMs: 0,
      },
    });

    expect(value.status).toBe("partial");
    expect(value.outlines["main.typ"]).not.toEqual([]);
    expect(value.hierarchy.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          file: "main.typ",
          status: "partial",
        }),
        expect.objectContaining({
          file: "missing.tex",
          status: "unreadable",
        }),
      ]),
    );
    expect(
      value.diagnostics.map((diagnostic) => diagnostic.code),
    ).toEqual(
      expect.arrayContaining([
        "malformed-source",
        "unreadable-file",
      ]),
    );
  });

  it("recomputes create, edit, rename, move, and delete outcomes from the new project identity", () => {
    const main = String.raw`\input{chapter}
\addbibresource{refs.bib}
\ref{chapter}
\cite{paper}`;
    const created = snapshot(
      {
        "main.tex": main,
        "chapter.tex": String.raw`\label{chapter}`,
        "refs.bib": "@misc{paper, title={Initial}}",
      },
      ["main.tex", "chapter.tex", "refs.bib"],
      1,
    );
    expect(created.diagnostics).toEqual([]);

    const edited = snapshot(
      {
        "main.tex": main,
        "chapter.tex": String.raw`\label{renamed}`,
        "refs.bib": "@misc{replacement, title={Edited}}",
      },
      ["main.tex", "chapter.tex", "refs.bib"],
      2,
    );
    expect(
      edited.diagnostics.map((diagnostic) => diagnostic.code),
    ).toEqual(
      expect.arrayContaining([
        "unresolved-reference",
        "unresolved-citation",
      ]),
    );

    const moved = snapshot(
      {
        "main.tex": main,
        "chapters/chapter.tex": String.raw`\label{chapter}`,
        "bibliography/refs.bib": "@misc{paper, title={Moved}}",
      },
      [
        "main.tex",
        "chapters/chapter.tex",
        "bibliography/refs.bib",
      ],
      3,
    );
    expect(
      moved.diagnostics.filter(
        (diagnostic) =>
          diagnostic.code === "unresolved-target",
      ),
    ).toHaveLength(2);

    const renamedSource = String.raw`\input{chapters/chapter}
\addbibresource{bibliography/refs.bib}
\ref{chapter}
\cite{paper}`;
    const renamed = snapshot(
      {
        "main.tex": renamedSource,
        "chapters/chapter.tex": String.raw`\label{chapter}`,
        "bibliography/refs.bib": "@misc{paper, title={Moved}}",
      },
      [
        "main.tex",
        "chapters/chapter.tex",
        "bibliography/refs.bib",
      ],
      4,
    );
    expect(renamed.diagnostics).toEqual([]);
    expect(renamed.identity.projectRevision).toBe(4);

    const deleted = snapshot(
      { "main.tex": renamedSource },
      ["main.tex"],
      5,
    );
    expect(
      deleted.diagnostics.map((diagnostic) => diagnostic.code),
    ).toEqual(
      expect.arrayContaining([
        "unresolved-target",
        "unresolved-reference",
        "unresolved-citation",
      ]),
    );
  });

  it("rejects stale project identity/text and invalidates the graph synchronously on file-tree mutation", () => {
    const source = String.raw`\section{Current}`;
    const accepted = snapshot({ "main.tex": source });
    try {
      useFilesStore.setState({
        projectId: "project",
        activePath: "main.tex",
        files: {
          "main.tex": { content: source, dirty: false },
        },
      });
      useIndexStore.setState({
        texts: { "main.tex": source },
        intelligenceState: {
          status: "success",
          identity: accepted.identity,
          data: accepted,
          stale: false,
        },
      });
      expect(currentProjectIntelligence(source)?.snapshot).toBe(
        accepted,
      );

      useFilesStore.setState({ projectId: "different-project" });
      expect(currentProjectIntelligence(source)).toBeNull();

      useFilesStore.setState({ projectId: "project" });
      useIndexStore.setState((state) => ({
        intelligenceState: {
          ...state.intelligenceState,
          stale: true,
        },
      }));
      expect(currentProjectIntelligence(source)).toBeNull();

      useIndexStore.setState({
        texts: { "main.tex": source },
        intelligenceState: {
          status: "success",
          identity: accepted.identity,
          data: accepted,
          stale: false,
        },
      });
      useFilesStore.setState({ tree: [] });
      useIndexStore.getState().invalidateFilesystem();
      expect(useIndexStore.getState().intelligenceState).toMatchObject({
        status: "running",
        data: accepted,
        stale: true,
        currentFileFallbackAllowed: false,
      });
      expect(currentProjectIntelligence(source)).toBeNull();

      useIndexStore.getState().reset();
      useFilesStore.setState({ projectId: "project" });
      useIndexStore.getState().invalidateFilesystem();
      const first =
        useIndexStore.getState().intelligenceState.identity;
      expect(useIndexStore.getState().intelligenceState).toMatchObject({
        status: "running",
        stale: false,
      });
      useIndexStore.getState().invalidateFilesystem();
      const second =
        useIndexStore.getState().intelligenceState.identity;
      expect(second?.projectRevision).toBeGreaterThan(
        first?.projectRevision ?? 0,
      );
      expect(second?.requestGeneration).toBeGreaterThan(
        first?.requestGeneration ?? 0,
      );
    } finally {
      useIndexStore.getState().reset();
      useFilesStore.setState({
        projectId: null,
        activePath: null,
        files: {},
      });
    }
  });
});

describe("project-wide package and class rollup", () => {
  it("orders classes and packages by code point across every file", () => {
    const value = snapshot({
      "main.tex": "\\documentclass{scrartcl}\n\\usepackage{xcolor}\n\\usepackage{amsmath}\n",
      "poster.tex": "\\documentclass{beamer}\n\\usepackage{tikz}\n",
      "notes.tex": "\\documentclass{article}\n\\usepackage{amsmath}\n",
    });

    expect(value.documentClasses).toEqual(["article", "beamer", "scrartcl"]);
    expect(value.detectedPackages).toEqual(["amsmath", "tikz", "xcolor"]);
  });

  it("de-duplicates a class or package used by several files", () => {
    const value = snapshot({
      "a.tex": "\\documentclass{article}\n\\usepackage{amsmath}\n",
      "b.tex": "\\documentclass{article}\n\\usepackage{amsmath}\n",
    });

    expect(value.documentClasses).toEqual(["article"]);
    expect(value.detectedPackages).toEqual(["amsmath"]);
  });
});

