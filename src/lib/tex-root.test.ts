import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { effectiveMainDocMissing, resolveCompileTarget, resolveEffectiveMainDoc } from "./tex-root";
import { LATEX_ENGINE } from "@/lib/document-engine";
import type { LatexUnits } from "@/lib/project-intelligence/types";
import { parseTexMagicComments } from "@/lib/tex-magic-comments";
import type { ProjectInfo, ProjectLocationInfo } from "@/lib/tauri";
import { useCompileRootStore } from "@/store/compile-root";
import { useFilesStore } from "@/store/files";

describe("parseTexMagicComments", () => {
  it("parses a root comment on the first line", () => {
    expect(
      parseTexMagicComments(
        "% !TEX root = ../main.tex\n\\section{Intro}\n",
      ),
    ).toEqual({ root: "../main.tex", program: null });
  });

  it("matches keywords case-insensitively", () => {
    expect(parseTexMagicComments("% !tex ROOT=main.tex\n")).toEqual({
      root: "main.tex",
      program: null,
    });
  });

  it("tolerates missing spaces around the marker and equals sign", () => {
    expect(parseTexMagicComments("%!TEX root=x.tex\n")).toEqual({
      root: "x.tex",
      program: null,
    });
  });

  it("reads CRLF files and trims the value under both rules", () => {
    expect(
      parseTexMagicComments("% !TEX root = main.tex \r\n\\section{A}\r\n"),
    ).toEqual({ root: "main.tex", program: null });
    expect(
      parseTexMagicComments("% !TEX program =  lualatex\t\r\n", "library"),
    ).toEqual({ root: null, program: "lualatex" });
    expect(parseTexMagicComments("% !TEX root =   \r\n", "library")).toEqual({
      root: null,
      program: null,
    });
  });

  it("only scans the first 50 lines", () => {
    const filler = Array.from({ length: 50 }, (_, i) => `line ${i}`);
    const text = [...filler, "% !TEX root = late.tex"].join("\n");
    expect(parseTexMagicComments(text)).toEqual({ root: null, program: null });
    const inRange = [...filler.slice(0, 49), "% !TEX root = fiftieth.tex"].join("\n");
    expect(parseTexMagicComments(inRange).root).toBe("fiftieth.tex");
  });

  it("accepts an indented comment without a bang and with loose spacing", () => {
    expect(parseTexMagicComments("  % TeX  root  =  main.tex  \n").root).toBe("main.tex");
  });

  it("skips an empty root and keeps looking", () => {
    expect(parseTexMagicComments("% !TEX root = \n% !TEX root = main.tex\n").root).toBe("main.tex");
  });

  it("parses every shared case the same way as the Rust detector", () => {
    const cases = JSON.parse(
      readFileSync(
        path.join(process.cwd(), "crates/oleafly-core/tests/fixtures/tex-magic-comments.json"),
        "utf8",
      ),
    ) as { text: string; root: string | null; program: string | null }[];
    expect(cases.length).toBeGreaterThanOrEqual(15);
    for (const { text, root, program } of cases) {
      expect(parseTexMagicComments(text), JSON.stringify(text)).toEqual({ root, program });
    }
  });

  it("keeps the first occurrence of each key", () => {
    const text = [
      "% !TEX root = first.tex",
      "% !TEX root = second.tex",
    ].join("\n");
    expect(parseTexMagicComments(text).root).toBe("first.tex");
  });

  it("parses program without inventing a root", () => {
    expect(
      parseTexMagicComments("% !TEX program = lualatex\n\\relax\n"),
    ).toEqual({ root: null, program: "lualatex" });
  });

  it("returns nulls when no magic comments exist", () => {
    expect(parseTexMagicComments("\\documentclass{article}\n")).toEqual({
      root: null,
      program: null,
    });
  });
});

describe("resolveEffectiveMainDoc", () => {
  const resetState = {
    projectId: null,
    projectName: "",
    projects: [],
    mainDoc: "main.tex",
    activePath: null,
    openTabs: [],
    tree: [],
    files: {},
    engine: LATEX_ENGINE,
    manifestHome: "library" as const,
  };

  beforeEach(() => {
    useFilesStore.setState(resetState);
    useCompileRootStore.setState({ followOpenFile: true, latexUnits: null });
    resolveEffectiveMainDoc();
  });

  afterEach(() => {
    useFilesStore.setState(resetState);
    useCompileRootStore.setState({ followOpenFile: true, latexUnits: null });
  });

  it("overrides the stored main document with a valid magic root", () => {
    useFilesStore.setState({
      projectId: "project",
      mainDoc: "thesis.tex",
      activePath: "chapters/ch1.tex",
      tree: [
        { path: "chapters", is_dir: true },
        { path: "chapters/ch1.tex", is_dir: false },
        { path: "main.tex", is_dir: false },
        { path: "thesis.tex", is_dir: false },
      ],
      files: {
        "chapters/ch1.tex": {
          content: "% !TEX root = ../main.tex\n\\section{One}\n",
          dirty: false,
        },
      },
    });
    expect(resolveEffectiveMainDoc()).toEqual({
      mainDoc: "main.tex",
      overriddenBy: "chapters/ch1.tex",
      reason: "magic",
      brokenRoot: null,
    });
  });

  it("falls back to the stored main document and reports a broken root", () => {
    useFilesStore.setState({
      projectId: "project",
      mainDoc: "thesis.tex",
      activePath: "chapters/ch1.tex",
      tree: [
        { path: "chapters/ch1.tex", is_dir: false },
        { path: "thesis.tex", is_dir: false },
      ],
      files: {
        "chapters/ch1.tex": {
          content: "% !TEX root = ../missing.tex\n",
          dirty: false,
        },
      },
    });
    expect(resolveEffectiveMainDoc()).toEqual({
      mainDoc: "thesis.tex",
      overriddenBy: null,
      reason: null,
      brokenRoot: {
        declaredIn: "chapters/ch1.tex",
        target: "../missing.tex",
        reason: "missing",
      },
    });
  });

  it("rejects a root comment that points at a file LaTeX can't compile", () => {
    useFilesStore.setState({
      projectId: "project",
      mainDoc: "thesis.tex",
      activePath: "chapters/ch1.tex",
      tree: [
        { path: "chapters/ch1.tex", is_dir: false },
        { path: "notes.md", is_dir: false },
        { path: "thesis.tex", is_dir: false },
      ],
      files: {
        "chapters/ch1.tex": { content: "% !TEX root = ../notes.md\n", dirty: false },
      },
    });
    expect(resolveEffectiveMainDoc()).toEqual({
      mainDoc: "thesis.tex",
      overriddenBy: null,
      reason: null,
      brokenRoot: { declaredIn: "chapters/ch1.tex", target: "../notes.md", reason: "not_tex" },
    });
  });

  it("keeps the strict parser for library projects and the shared one for linked folders", () => {
    const project = (id: string, location?: ProjectLocationInfo): ProjectInfo => ({
      id,
      name: id,
      main_doc: "thesis.tex",
      kind: "",
      created_at: 0,
      updated_at: 0,
      has_preview: false,
      exports: [],
      forked_from: null,
      recovery_pending: false,
      location,
    });
    const linked = project("linked-thesis", {
      kind: "linked",
      display_path: "~/thesis",
      availability: "ok",
    });
    const filler = Array.from({ length: 20 }, (_, index) => `% line ${index}`);
    for (const content of [
      "  % TeX root = ../main.tex\n",
      "% TeX root = ../main.tex\n",
      [...filler, "% !TEX root = ../main.tex"].join("\n"),
    ]) {
      const state = {
        mainDoc: "thesis.tex",
        activePath: "chapters/ch1.tex",
        tree: [
          { path: "chapters/ch1.tex", is_dir: false },
          { path: "main.tex", is_dir: false },
          { path: "thesis.tex", is_dir: false },
        ],
        files: { "chapters/ch1.tex": { content, dirty: false } },
        projects: [project("library"), linked],
      };
      for (const projectId of ["library", "unlisted"]) {
        useFilesStore.setState({ ...state, projectId });
        expect(resolveEffectiveMainDoc(), `${projectId} ${content}`).toEqual({
          mainDoc: "thesis.tex",
          overriddenBy: null,
          reason: null,
          brokenRoot: null,
        });
      }
      useFilesStore.setState({ ...state, projectId: "linked-thesis" });
      expect(resolveEffectiveMainDoc(), content).toEqual({
        mainDoc: "main.tex",
        overriddenBy: "chapters/ch1.tex",
        reason: "magic",
        brokenRoot: null,
      });
    }
  });

  it("ignores magic-looking comments in non-TeX active files", () => {
    useFilesStore.setState({
      projectId: "project",
      mainDoc: "thesis.tex",
      activePath: "notes.typ",
      tree: [
        { path: "notes.typ", is_dir: false },
        { path: "main.tex", is_dir: false },
        { path: "thesis.tex", is_dir: false },
      ],
      files: {
        "notes.typ": {
          content: "% !TEX root = main.tex\n",
          dirty: false,
        },
      },
    });
    expect(resolveEffectiveMainDoc()).toEqual({
      mainDoc: "thesis.tex",
      overriddenBy: null,
      reason: null,
      brokenRoot: null,
    });
  });

  it("uses the stored main document when no magic comment is present", () => {
    useFilesStore.setState({
      projectId: "project",
      mainDoc: "thesis.tex",
      activePath: "chapters/ch1.tex",
      tree: [
        { path: "chapters/ch1.tex", is_dir: false },
        { path: "thesis.tex", is_dir: false },
      ],
      files: {
        "chapters/ch1.tex": {
          content: "\\section{No magic here}\n",
          dirty: false,
        },
      },
    });
    expect(resolveEffectiveMainDoc()).toEqual({
      mainDoc: "thesis.tex",
      overriddenBy: null,
      reason: null,
      brokenRoot: null,
    });
  });

  const article = String.raw`\documentclass[11pt]{article}
\begin{document}
Supplement.
\end{document}
`;

  function open(activePath: string, files: Record<string, string>, extra: Record<string, unknown> = {}) {
    useFilesStore.setState({
      projectId: "paper",
      mainDoc: "paper.tex",
      activePath,
      openTabs: Object.keys(files),
      tree: [
        { path: "paper.tex", is_dir: false },
        { path: "supplement.tex", is_dir: false },
        { path: "response.tex", is_dir: false },
        { path: "refs.bib", is_dir: false },
        { path: "sections", is_dir: true },
        { path: "sections/intro.tex", is_dir: false },
        { path: "sections/methods.tex", is_dir: false },
        { path: "figures/plot.tex", is_dir: false },
      ],
      files: Object.fromEntries(
        Object.entries(files).map(([path, content]) => [path, { content, dirty: false }]),
      ),
      ...extra,
    });
  }

  function units(fileGroups: Record<string, number>, groups: number[][]): LatexUnits {
    return { roots: ["paper.tex", "supplement.tex", "response.tex"], groups, fileGroups, openUnits: [] };
  }

  it("compiles the open file when it has its own \\documentclass", () => {
    open("supplement.tex", { "supplement.tex": article });
    expect(resolveEffectiveMainDoc()).toEqual({
      mainDoc: "supplement.tex",
      overriddenBy: "supplement.tex",
      reason: "document",
      brokenRoot: null,
    });
    open("paper.tex", { "paper.tex": article });
    expect(resolveEffectiveMainDoc().overriddenBy).toBeNull();
  });

  it.each([
    ["a standalone figure", "\\documentclass[tikz]{standalone}\n\\begin{document}x\\end{document}"],
    ["a subfile", "\\documentclass[../paper.tex]{subfiles}\n\\begin{document}x\\end{document}"],
    ["a commented-out class", "% \\documentclass{article}\n\\begin{document}x\\end{document}"],
    ["a class with no document body", "\\documentclass{article}\n\\usepackage{amsmath}\n"],
    ["a commented-out document body", "\\documentclass{article}\n% \\begin{document}\n"],
    ["an escaped command", String.raw`See \\documentclass{article} and \begin{document}`],
  ])("keeps the main document for %s", (_name, text) => {
    open("figures/plot.tex", { "figures/plot.tex": text });
    expect(resolveEffectiveMainDoc().mainDoc).toBe("paper.tex");
  });

  it("reads a class whose options span lines and a percent sign that is escaped", () => {
    open("response.tex", {
      "response.tex": String.raw`Fees of 5\% apply.
\documentclass[
  11pt, % size
  a4paper
]{letter}
\begin{document}
\end{document}
`,
    });
    expect(resolveEffectiveMainDoc().mainDoc).toBe("response.tex");
  });

  it("lets a % !TEX root comment win over the file's own class", () => {
    open("supplement.tex", { "supplement.tex": `% !TEX root = paper.tex\n${article}` });
    expect(resolveEffectiveMainDoc()).toMatchObject({ mainDoc: "paper.tex", reason: "magic" });
  });

  it("compiles the document that includes the open fragment", () => {
    open("sections/methods.tex", { "sections/methods.tex": "\\section{Methods}\n" });
    useCompileRootStore.setState({
      latexUnits: { projectId: "paper", units: units({ "sections/methods.tex": 0, "sections/intro.tex": 1 }, [[1], [0]]) },
    });
    expect(resolveEffectiveMainDoc()).toEqual({
      mainDoc: "supplement.tex",
      overriddenBy: "sections/methods.tex",
      reason: "include",
      brokenRoot: null,
    });
    open("sections/intro.tex", { "sections/intro.tex": "\\section{Intro}\n" });
    expect(resolveEffectiveMainDoc()).toMatchObject({ mainDoc: "paper.tex", overriddenBy: null });
  });

  it("prefers the main document, then the last document, for a fragment several documents include", () => {
    const shared = units({ "sections/intro.tex": 0, "sections/methods.tex": 1 }, [[0, 1], [1, 2]]);
    useCompileRootStore.setState({ latexUnits: { projectId: "paper", units: shared } });
    open("sections/intro.tex", { "sections/intro.tex": "x" });
    expect(resolveEffectiveMainDoc().mainDoc).toBe("paper.tex");

    open("sections/methods.tex", { "sections/methods.tex": "x" });
    expect(resolveEffectiveMainDoc().mainDoc).toBe("paper.tex");

    open("response.tex", { "response.tex": article, "sections/methods.tex": "x" });
    expect(resolveEffectiveMainDoc().mainDoc).toBe("response.tex");
    open("sections/methods.tex", { "response.tex": article, "sections/methods.tex": "x" });
    expect(resolveEffectiveMainDoc()).toMatchObject({ mainDoc: "response.tex", reason: "include" });
  });

  it("ignores units from another project and roots that are gone", () => {
    open("sections/methods.tex", { "sections/methods.tex": "x" });
    useCompileRootStore.setState({
      latexUnits: { projectId: "other", units: units({ "sections/methods.tex": 0 }, [[1]]) },
    });
    expect(resolveEffectiveMainDoc().mainDoc).toBe("paper.tex");
    useCompileRootStore.setState({
      latexUnits: {
        projectId: "paper",
        units: { roots: ["deleted.tex"], groups: [[0]], fileGroups: { "sections/methods.tex": 0 }, openUnits: [] },
      },
    });
    expect(resolveEffectiveMainDoc().mainDoc).toBe("paper.tex");
  });

  it("keeps the last document while a bibliography is open, until its tab closes", () => {
    open("supplement.tex", { "supplement.tex": article });
    expect(resolveEffectiveMainDoc().mainDoc).toBe("supplement.tex");
    useFilesStore.setState({ activePath: "refs.bib", openTabs: ["supplement.tex", "refs.bib"] });
    expect(resolveEffectiveMainDoc()).toMatchObject({
      mainDoc: "supplement.tex",
      overriddenBy: "supplement.tex",
      reason: "document",
    });
    useFilesStore.setState({ openTabs: ["refs.bib"] });
    expect(resolveEffectiveMainDoc().mainDoc).toBe("paper.tex");
  });

  it("keeps a % !TEX root while another file is open", () => {
    open("sections/intro.tex", { "sections/intro.tex": "% !TEX root = ../supplement.tex\n" });
    expect(resolveEffectiveMainDoc().mainDoc).toBe("supplement.tex");
    useFilesStore.setState({ activePath: "refs.bib", openTabs: ["sections/intro.tex", "refs.bib"] });
    useCompileRootStore.setState({ followOpenFile: false });
    expect(resolveEffectiveMainDoc()).toMatchObject({ mainDoc: "supplement.tex", reason: "magic" });
  });

  it("always compiles the main document when following is off or the project isn't LaTeX", () => {
    useCompileRootStore.setState({
      followOpenFile: false,
      latexUnits: { projectId: "paper", units: units({ "sections/methods.tex": 0 }, [[1]]) },
    });
    open("supplement.tex", { "supplement.tex": article });
    expect(resolveEffectiveMainDoc().mainDoc).toBe("paper.tex");
    open("sections/methods.tex", { "sections/methods.tex": "x" });
    expect(resolveEffectiveMainDoc().mainDoc).toBe("paper.tex");

    useCompileRootStore.setState({ followOpenFile: true });
    open("supplement.tex", { "supplement.tex": article }, { engine: { ...LATEX_ENGINE, source_format: "typst" } });
    expect(resolveEffectiveMainDoc().mainDoc).toBe("paper.tex");
  });

  it("lets an opened folder with no main document compile a complete open file", () => {
    open("supplement.tex", { "supplement.tex": article }, { mainDoc: "", manifestHome: "folder" });
    expect(effectiveMainDocMissing()).toBe(false);
    open("sections/intro.tex", { "sections/intro.tex": "x" }, { mainDoc: "", manifestHome: "folder" });
    expect(effectiveMainDocMissing()).toBe(true);
  });
});

describe("resolveCompileTarget", () => {
  const letter = String.raw`\documentclass{letter}
\begin{document}
Thanks.
\end{document}
`;
  const tree = [
    "paper.tex",
    "letter.tex",
    "index.qmd",
    "paper.md",
    "README.md",
    "AGENTS.md",
    "notes/meeting.md",
    "slides.qmd",
    "poster.typ",
    "refs.bib",
    "figure.png",
    "_extensions/journal/partials/title.tex",
  ].map((path) => ({ path, is_dir: false }));
  const reset = {
    projectId: null,
    mainDoc: "main.tex",
    activePath: null,
    openTabs: [],
    tree: [],
    files: {},
    engine: LATEX_ENGINE,
    manifestHome: "library" as const,
  };

  function project(activePath: string | null, files: Record<string, string>, extra: Record<string, unknown> = {}) {
    useFilesStore.setState({
      projectId: "mixed",
      mainDoc: "paper.tex",
      activePath,
      openTabs: Object.keys(files),
      tree,
      files: Object.fromEntries(
        Object.entries(files).map(([path, content]) => [path, { content, dirty: false }]),
      ),
      engine: LATEX_ENGINE,
      ...extra,
    });
  }

  beforeEach(() => {
    useFilesStore.setState(reset);
    useCompileRootStore.setState({ followOpenFile: true, latexUnits: null, parts: null });
    resolveCompileTarget();
  });

  afterEach(() => {
    useFilesStore.setState(reset);
    useCompileRootStore.setState({ followOpenFile: true, latexUnits: null, parts: null });
  });

  it("compiles an open document in another format by itself and leaves LaTeX tools on the paper", () => {
    project("notes/meeting.md", { "notes/meeting.md": "# Meeting\n" });
    expect(resolveCompileTarget()).toEqual({
      mainDoc: "notes/meeting.md",
      overriddenBy: "notes/meeting.md",
      reason: "format",
      brokenRoot: null,
      format: "markdown",
    });
    expect(resolveEffectiveMainDoc().mainDoc).toBe("paper.tex");
    project("slides.qmd", { "slides.qmd": "# Slides\n" });
    expect(resolveCompileTarget()).toMatchObject({ mainDoc: "slides.qmd", format: "quarto" });
    project("poster.typ", { "poster.typ": "= Poster\n" });
    expect(resolveCompileTarget()).toMatchObject({ mainDoc: "poster.typ", format: "typst" });
  });

  it("keeps the main document for repository notes, files outside the tree and files in its own format", () => {
    project("README.md", { "README.md": "# Repo\n" });
    expect(resolveCompileTarget()).toMatchObject({ mainDoc: "paper.tex", format: null });
    project("AGENTS.md", { "AGENTS.md": "Rules\n" });
    expect(resolveCompileTarget().mainDoc).toBe("paper.tex");
    project("elsewhere.md", { "elsewhere.md": "# Not in the tree\n" });
    expect(resolveCompileTarget().mainDoc).toBe("paper.tex");
    project("notes/meeting.md", { "notes/meeting.md": "# Meeting\n" }, { mainDoc: "paper.md" });
    expect(resolveCompileTarget()).toMatchObject({ mainDoc: "paper.md", format: null });
  });

  it("compiles a complete LaTeX file in a Quarto project but not Quarto's own partials", () => {
    const quarto = { mainDoc: "index.qmd", engine: { ...LATEX_ENGINE, id: "quarto", source_format: "markdown" } };
    project("letter.tex", { "letter.tex": letter }, quarto);
    expect(resolveCompileTarget()).toMatchObject({ mainDoc: "letter.tex", format: "latex" });
    project("_extensions/journal/partials/title.tex", { "_extensions/journal/partials/title.tex": "\\title{$title$}\n" }, quarto);
    expect(resolveCompileTarget()).toMatchObject({ mainDoc: "index.qmd", format: null });
  });

  it("keeps the last document while a bibliography or image is open, until its tab closes", () => {
    project("notes/meeting.md", { "notes/meeting.md": "# Meeting\n" });
    expect(resolveCompileTarget().mainDoc).toBe("notes/meeting.md");
    useFilesStore.setState({ activePath: "refs.bib", openTabs: ["notes/meeting.md", "refs.bib"] });
    expect(resolveCompileTarget()).toMatchObject({ mainDoc: "notes/meeting.md", reason: "format" });
    useFilesStore.setState({ activePath: "figure.png" });
    expect(resolveCompileTarget().mainDoc).toBe("notes/meeting.md");
    useFilesStore.setState({ openTabs: ["refs.bib", "figure.png"] });
    expect(resolveCompileTarget().mainDoc).toBe("paper.tex");
  });

  it("goes back to the paper when a LaTeX file is opened again", () => {
    project("notes/meeting.md", { "notes/meeting.md": "# Meeting\n", "paper.tex": letter });
    expect(resolveCompileTarget().mainDoc).toBe("notes/meeting.md");
    useFilesStore.setState({ activePath: "paper.tex" });
    expect(resolveCompileTarget()).toMatchObject({ mainDoc: "paper.tex", format: null });
    useFilesStore.setState({ activePath: "refs.bib" });
    expect(resolveCompileTarget().mainDoc).toBe("paper.tex");
  });

  it("leaves Markdown in a Quarto project, Pandoc templates and files other documents use to the main document", () => {
    const quarto = { mainDoc: "index.qmd", engine: { ...LATEX_ENGINE, id: "quarto", source_format: "markdown" } };
    project("notes/meeting.md", { "notes/meeting.md": "# Meeting\n" }, quarto);
    expect(resolveCompileTarget()).toMatchObject({ mainDoc: "index.qmd", format: null });

    const template = String.raw`\documentclass{article}
\begin{document}
$body$
\end{document}
`;
    project("letter.tex", { "letter.tex": template }, quarto);
    expect(resolveCompileTarget().mainDoc).toBe("index.qmd");

    useCompileRootStore.setState({ parts: { projectId: "mixed", files: new Set(["poster.typ"]) } });
    project("poster.typ", { "poster.typ": "#let accent = blue\n" });
    expect(resolveCompileTarget()).toMatchObject({ mainDoc: "paper.tex", format: null });
    useCompileRootStore.setState({ parts: { projectId: "elsewhere", files: new Set(["poster.typ"]) } });
    expect(resolveCompileTarget()).toMatchObject({ mainDoc: "poster.typ", format: "typst" });
  });

  it("names the format of a LaTeX root that a comment picks in a project of another format", () => {
    useCompileRootStore.setState({ followOpenFile: false });
    const quarto = { mainDoc: "index.qmd", engine: { ...LATEX_ENGINE, id: "quarto", source_format: "markdown" } };
    project("chapter.tex", { "chapter.tex": "% !TEX root = letter.tex\n\\section{One}\n" }, quarto);
    expect(resolveCompileTarget()).toMatchObject({ mainDoc: "letter.tex", reason: "magic", format: "latex" });
  });

  it("follows nothing when the compile target is always the main document", () => {
    useCompileRootStore.setState({ followOpenFile: false });
    project("notes/meeting.md", { "notes/meeting.md": "# Meeting\n" });
    expect(resolveCompileTarget()).toMatchObject({ mainDoc: "paper.tex", format: null });
  });
});
