import { beforeEach, describe, expect, it, vi } from "vitest";
import { runRefsRules } from "@oleafly/preflight";
import type { RefsContext } from "@oleafly/preflight";
import enCore from "@/i18n/locales/en/core.json" with { type: "json" };
import { LATEX_ENGINE } from "@/lib/document-engine";
import { useCompileStore } from "@/store/compile";
import { useFilesStore } from "@/store/files";
import { useIndexStore } from "@/store/project-index";

const mocks = vi.hoisted(() => ({
  detectSubmissionProfile: vi.fn(() => "journal"),
  extractForPreflight: vi.fn(),
  isCompileCheckpointCurrent: vi.fn(() => false),
  logError: vi.fn(),
  report: {
    findings: [],
    scores: { ats: 100, compile: 100, a11y: 100, refs: 100, submission: 100, privacy: 100 },
    atsScore: 100,
    compileScore: 100,
    a11yScore: 100,
    refsScore: 100,
    submissionScore: 100,
    privacyScore: 100,
    coverage: {
      ats: "evaluated",
      compile: "evaluated",
      a11y: "evaluated",
      refs: "evaluated",
      submission: "evaluated",
      privacy: "evaluated",
    },
    ranAt: 1,
    hasPdf: false,
  },
  runPreflight: vi.fn(),
  projectFileSizes: vi.fn(),
}));

vi.mock("@oleafly/preflight", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@oleafly/preflight")>();
  return {
    ...actual,
    detectSubmissionProfile: mocks.detectSubmissionProfile,
    runPreflight: mocks.runPreflight,
  };
});

vi.mock("@oleafly/preflight/pdf-extract", () => ({
  extractForPreflight: mocks.extractForPreflight,
}));

vi.mock("@/store/compile", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/store/compile")>();
  return {
    ...actual,
    isCompileCheckpointCurrent: mocks.isCompileCheckpointCurrent,
  };
});

vi.mock("@/lib/log", () => ({ logError: mocks.logError }));

vi.mock("@/lib/tauri", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tauri")>();
  return { ...actual, projectFileSizes: mocks.projectFileSizes };
});

import { preflightEngineFor, usePreflightStore } from "./preflight";

function symbol(kind: "label" | "bibentry" | "ref", name: string, file: string) {
  return {
    kind,
    name,
    file,
    line: 1,
    from: 0,
    to: name.length,
    nameFrom: 0,
    nameTo: name.length,
  };
}

function seedProject() {
  useFilesStore.setState({
    projectId: "paper",
    mainDoc: "main.tex",
    activePath: "chapter.tex",
    engine: LATEX_ENGINE,
    engineLoaded: true,
    engineError: null,
    tree: [
      { path: "main.tex", is_dir: false },
      { path: "chapter.tex", is_dir: false },
      { path: "other.tex", is_dir: false },
      { path: "refs.bib", is_dir: false },
      { path: "figure.png", is_dir: false },
      { path: "images", is_dir: true },
    ],
    files: {
      "main.tex": {
        content: "\\documentclass{article}\\begin{document}Paper\\end{document}",
        dirty: false,
      },
      "chapter.tex": {
        content: "Text \\cite{alpha,beta}. % \\cite{ignored}",
        dirty: true,
      },
      "refs.bib": {
        content:
          "@article{alpha, title={A}, doi={https://doi.org/10.1/shared}}\n" +
          "@article{beta, title={B}, doi={10.1/shared}}",
        dirty: false,
      },
    },
  });
  useIndexStore.setState({
    texts: {
      "other.tex": "\\citep{gamma} \\nocite{delta}",
      "refs.bib": "@article{gamma, title={G}}",
    },
    index: {
      defs: [
        symbol("label", "fig:used", "main.tex"),
        symbol("label", "fig:used", "other.tex"),
        symbol("label", "tab:orphan", "other.tex"),
        symbol("bibentry", "indexed", "refs.bib"),
      ],
      uses: [symbol("ref", "fig:used", "chapter.tex")],
      symbolAt: vi.fn(),
      definitionFor: vi.fn(),
      references: vi.fn(() => []),
      allReferences: vi.fn(() => []),
      renamePlan: vi.fn(),
    },
  });
}

beforeEach(() => {
  usePreflightStore.getState().reset();
  useCompileStore.getState().reset();
  useIndexStore.setState({ index: null, texts: {} });
  useFilesStore.setState({
    projectId: null,
    mainDoc: "main.tex",
    activePath: null,
    engine: LATEX_ENGINE,
    engineLoaded: false,
    engineError: null,
    tree: [],
    files: {},
  });
  mocks.detectSubmissionProfile.mockClear();
  mocks.extractForPreflight.mockReset();
  mocks.isCompileCheckpointCurrent.mockReset().mockReturnValue(false);
  mocks.logError.mockClear();
  mocks.runPreflight.mockReset().mockReturnValue(mocks.report);
  mocks.projectFileSizes.mockReset().mockResolvedValue({});
});

const TYPST_ENGINE = {
  ...LATEX_ENGINE,
  id: "typst" as const,
  label: "Typst",
  source_format: "typst" as const,
  main_document: "main.typ",
  source_extensions: ["typ"],
  capabilities: {
    ...LATEX_ENGINE.capabilities,
    formatting_profile: "typst" as const,
    source_preflight_profile: "typst" as const,
  },
};

function seedTypstProject(engine = TYPST_ENGINE) {
  useFilesStore.setState({
    projectId: "typst-paper",
    mainDoc: "main.typ",
    activePath: "main.typ",
    engine,
    engineLoaded: true,
    engineError: null,
    tree: [
      { path: "main.typ", is_dir: false },
      { path: "figures/plot.png", is_dir: false },
      { path: "unused.png", is_dir: false },
    ],
    files: {
      "main.typ": { content: '= Intro\n#image("figures/plot.png")', dirty: false },
    },
  });
  useIndexStore.setState({ index: null, texts: {} });
}

describe("preflightEngineFor", () => {
  it("maps the bundled Tectonic engine to \"bundled\"", () => {
    expect(preflightEngineFor("latex", undefined)).toBe("bundled");
  });

  it("uses the pinned latexmk flavor when one is set", () => {
    expect(preflightEngineFor("latexmk", "pdflatex")).toBe("pdflatex");
  });

  it("falls back to \"unknown\" for latexmk with no pinned flavor", () => {
    expect(preflightEngineFor("latexmk", undefined)).toBe("unknown");
    expect(preflightEngineFor("latexmk", null)).toBe("unknown");
  });

  it("maps the Typst engine to \"typst\"", () => {
    expect(preflightEngineFor("typst", undefined)).toBe("typst");
  });

  it("falls back to \"unknown\" for an engine without source checks", () => {
    expect(preflightEngineFor("markdown", undefined)).toBe("unknown");
    expect(preflightEngineFor("unknown", undefined)).toBe("unknown");
  });
});

describe("preflight store for Typst", () => {
  it("loads the Typst rules and the project's Typst version", async () => {
    const { TYPST_SOURCE_RULES } = await import("@oleafly/preflight/typst");
    seedTypstProject({ ...TYPST_ENGINE, typst_resolved: { version: "0.13.1", source: "downloaded" } });

    await usePreflightStore.getState().run();

    const input = mocks.runPreflight.mock.calls[0][0];
    expect(input).toMatchObject({
      sourceProfile: "typst",
      sourceRules: TYPST_SOURCE_RULES,
      typstVersion: "0.13.1",
      engine: "typst",
    });
  });

  it("falls back to the bundled Typst version", async () => {
    seedTypstProject();
    await usePreflightStore.getState().run();
    expect(mocks.runPreflight.mock.calls[0][0].typstVersion).toBe("0.15.1");
  });

  it("measures only the images the Typst sources use", async () => {
    seedTypstProject();
    mocks.projectFileSizes.mockResolvedValue({ "figures/plot.png": 12 });

    await usePreflightStore.getState().run();

    expect(mocks.projectFileSizes).toHaveBeenCalledTimes(1);
    expect(mocks.projectFileSizes).toHaveBeenCalledWith("typst-paper", ["figures/plot.png"]);
    const files = mocks.runPreflight.mock.calls[0][0].project.files;
    expect(files.find((file: { path: string }) => file.path === "figures/plot.png")).toMatchObject({ size: 12 });
    expect(files.find((file: { path: string }) => file.path === "unused.png")?.size).toBeUndefined();
  });

  it("does not load Typst rules for a LaTeX project", async () => {
    seedProject();
    await usePreflightStore.getState().run();
    const input = mocks.runPreflight.mock.calls[0][0];
    expect(input.sourceRules).toBeUndefined();
    expect(input.typstVersion).toBeUndefined();
    expect(mocks.projectFileSizes).not.toHaveBeenCalled();
  });
});

describe("preflight store", () => {
  it("updates options, toggles the reader, and resets the session", () => {
    const flags = {
      ats: true,
      compile: false,
      a11y: true,
      refs: false,
      submission: true,
      privacy: false,
    };
    const store = usePreflightStore.getState();
    store.setRan(flags);
    store.setEnabled(flags);
    store.setOpen(flags);
    store.setSubmissionProfile("ieee");
    store.setAnonymousReview(true);
    store.toggleReader();

    expect(usePreflightStore.getState()).toMatchObject({
      ran: flags,
      enabled: flags,
      open: flags,
      submissionProfile: "ieee",
      anonymousReview: true,
      showReader: true,
    });

    usePreflightStore.getState().reset();
    expect(usePreflightStore.getState()).toMatchObject({
      report: null,
      pageText: [],
      running: false,
      showReader: false,
      error: null,
      enabled: null,
      open: null,
      submissionProfile: null,
      anonymousReview: false,
    });
  });

  it("reports why the document engine is unavailable", async () => {
    useFilesStore.setState({ engineError: "loadFailed" });
    await usePreflightStore.getState().run();
    expect(usePreflightStore.getState()).toMatchObject({
      running: false,
      error: enCore.engine.error.loadFailed,
    });

    useFilesStore.setState({ engineError: null });
    await usePreflightStore.getState().run();
    expect(usePreflightStore.getState().error).toBe(enCore.engine.error.stillLoading);
    expect(mocks.runPreflight).not.toHaveBeenCalled();
  });

  it("assembles project-wide source, reference, asset, and compile context", async () => {
    seedProject();
    useCompileStore.setState({ status: "error", log: "Undefined control sequence" });

    await usePreflightStore.getState().run();

    expect(mocks.detectSubmissionProfile).toHaveBeenCalledWith(
      expect.stringContaining("documentclass"),
    );
    expect(mocks.runPreflight).toHaveBeenCalledOnce();
    const input = mocks.runPreflight.mock.calls[0][0];
    expect(input).toMatchObject({
      source: "Text \\cite{alpha,beta}. % \\cite{ignored}",
      submissionProfile: "journal",
      anonymousReview: false,
      compile: { status: "error", log: "Undefined control sequence" },
      project: { mainFile: "main.tex" },
      engine: "bundled",
    });
    expect(input.project.files.map((file: { path: string }) => file.path)).toEqual(
      expect.arrayContaining(["main.tex", "chapter.tex", "other.tex", "refs.bib", "figure.png"]),
    );
    expect(input.refs).toMatchObject({
      bibLoaded: true,
      duplicateDois: [{ doi: "10.1/shared", keys: ["alpha", "beta"] }],
      duplicateLabels: [{ label: "fig:used", files: ["main.tex", "other.tex"] }],
      unreferencedLabels: [{ label: "tab:orphan", file: "other.tex" }],
    });
    expect(input.refs.bibKeys).toEqual(
      expect.arrayContaining(["indexed", "alpha", "beta"]),
    );
    expect(input.refs.allCitedKeys).toEqual(
      expect.arrayContaining(["alpha", "beta", "gamma", "delta"]),
    );
    expect(input.refs.allCitedKeys).not.toContain("ignored");
    expect(usePreflightStore.getState()).toMatchObject({
      report: mocks.report,
      pageText: [],
      running: false,
      error: null,
    });
  });

  it("keeps LaTeX, Typst and Markdown labels apart", async () => {
    seedProject();
    useIndexStore.setState((state) => ({
      index: {
        ...(state.index as NonNullable<typeof state.index>),
        defs: [
          symbol("label", "eq:mae", "main.tex"),
          symbol("label", "eq:mae", "paper.typ"),
          symbol("label", "typst-only", "paper.typ"),
          symbol("label", "fig:plot", "main.tex"),
          // Markdown heading ids are scoped to their own file.
          symbol("label", "introduction", "a.md"),
          symbol("label", "introduction", "b.md"),
        ],
        uses: [
          symbol("ref", "eq:mae", "chapter.tex"),
          symbol("ref", "eq:mae", "paper.typ"),
          symbol("ref", "fig:plot", "paper.typ"),
        ],
      },
    }));

    await usePreflightStore.getState().run();

    const refs: RefsContext = mocks.runPreflight.mock.calls[0][0].refs;
    expect(refs.duplicateLabels).toEqual([]);
    // The project is LaTeX, so a label only Typst defines cannot satisfy one
    // of its \ref commands.
    expect(refs.definedLabels).toEqual(["eq:mae", "fig:plot"]);
    // A Typst @fig:plot does not reference the LaTeX figure.
    expect(refs.unreferencedLabels).toEqual([
      { label: "fig:plot", file: "main.tex" },
    ]);
  });

  it("counts a Markdown file#anchor link as a reference to the label it names", async () => {
    seedProject();
    const link = (name: string, target: string) => ({
      ...symbol("ref", name, "notes.md"),
      target,
    });
    useIndexStore.setState((state) => ({
      index: {
        ...(state.index as NonNullable<typeof state.index>),
        defs: [
          symbol("label", "fig:plot", "main.tex"),
          symbol("label", "fig:plot", "paper.typ"),
          symbol("label", "eq:mae", "paper.typ"),
          symbol("label", "tab:data", "main.tex"),
        ],
        uses: [
          link("fig:plot", "main.tex#fig:plot"),
          link("eq:mae", "paper.typ#eq:mae"),
          // Names a file that does not define the label.
          link("tab:data", "chapter.tex#tab:data"),
        ],
      },
    }));

    await usePreflightStore.getState().run();

    const refs: RefsContext = mocks.runPreflight.mock.calls[0][0].refs;
    expect(refs.unreferencedLabels).toEqual([
      { label: "fig:plot", file: "paper.typ" },
      { label: "tab:data", file: "main.tex" },
    ]);
  });

  it.each(["notes.md", "refs.bib", "paper.typ"])(
    "checks the LaTeX sources against LaTeX labels while %s is open",
    async (activePath) => {
      seedProject();
      useFilesStore.setState({ activePath });
      useIndexStore.setState((state) => ({
        index: {
          ...(state.index as NonNullable<typeof state.index>),
          defs: [
            symbol("label", "fig:plot", "main.tex"),
            symbol("label", "typst-only", "paper.typ"),
            symbol("label", "introduction", "notes.md"),
            symbol("label", "summary", "other.md"),
            symbol("label", "eq:mae", "chapter.tex"),
          ],
          uses: [],
        },
      }));

      await usePreflightStore.getState().run();

      const refs: RefsContext = mocks.runPreflight.mock.calls[0][0].refs;
      // The refs rules lint the project's .tex files whatever tab is open, so
      // a \ref there reaches the LaTeX labels and nothing else.
      expect(refs.definedLabels).toEqual(["fig:plot", "eq:mae"]);
      expect(
        runRefsRules("See \\ref{fig:plot}.", refs, { file: "chapter.tex" }).map((f) => f.id),
      ).not.toContain("refs-undefined-ref");
    },
  );

  it("does not call one heading id in two Markdown files a duplicate", async () => {
    seedProject();
    useIndexStore.setState((state) => ({
      index: {
        ...(state.index as NonNullable<typeof state.index>),
        defs: [
          symbol("label", "introduction", "a.md"),
          symbol("label", "introduction", "b.md"),
          symbol("label", "sec:intro", "main.tex"),
          symbol("label", "sec:intro", "other.tex"),
        ],
        uses: [],
      },
    }));

    await usePreflightStore.getState().run();

    const refs: RefsContext = mocks.runPreflight.mock.calls[0][0].refs;
    expect(refs.duplicateLabels).toEqual([
      { label: "sec:intro", files: ["main.tex", "other.tex"] },
    ]);
  });

  it.each([
    [
      "does not call the bibliography loaded when the declared file is missing",
      "\\documentclass{article}\\addbibresource{references.bib}",
      false,
    ],
    [
      "accepts a declaration that resolves against the project root",
      "\\documentclass{article}\\addbibresource{refs.bib}",
      true,
    ],
    [
      "ignores a commented or remote bibliography declaration",
      "% \\addbibresource{gone.bib}\n\\addbibresource[location=remote]{https://example.org/refs.bib}",
      true,
    ],
  ])("%s", async (_name, content, bibLoaded) => {
    seedProject();
    useFilesStore.setState((state) => ({
      files: {
        ...state.files,
        "main.tex": { content, dirty: false },
      },
    }));

    await usePreflightStore.getState().run();

    expect(mocks.runPreflight.mock.calls[0][0].refs.bibLoaded).toBe(bibLoaded);
  });

  it("resolves a nested file's declaration against the project root, not its own directory", async () => {
    seedProject();
    useIndexStore.setState((state) => ({
      texts: {
        ...state.texts,
        "document-body/intro.tex": "\\addbibresource{refs.bib}",
      },
    }));

    await usePreflightStore.getState().run();

    expect(mocks.runPreflight.mock.calls[0][0].refs.bibLoaded).toBe(true);
  });

  describe("the store and the refs rules agree about a declared bibliography", () => {
    async function refsContextFor(source: string): Promise<RefsContext> {
      seedProject();
      useFilesStore.setState((state) => ({
        tree: [...state.tree, { path: "other/refs.bib", is_dir: false }],
        files: { ...state.files, "main.tex": { content: source, dirty: false } },
      }));
      await usePreflightStore.getState().run();
      return mocks.runPreflight.mock.calls[0][0].refs as RefsContext;
    }

    it("reports the missing file and stays quiet about the citation it cannot check", async () => {
      const source = "\\addbibresource{missing/refs.bib}\n\\cite{nobody}";
      const refs = await refsContextFor(source);
      const ids = runRefsRules(source, refs, { file: "main.tex" }).map((f) => f.id);

      expect(refs.bibLoaded).toBe(false);
      expect(ids).toContain("refs-bib-missing");
      expect(ids).not.toContain("refs-undefined-cite");
    });

    it("reports the unknown citation once the declaration resolves", async () => {
      const source = "\\addbibresource{other/refs.bib}\n\\cite{nobody}";
      const refs = await refsContextFor(source);
      const ids = runRefsRules(source, refs, { file: "main.tex" }).map((f) => f.id);

      expect(refs.bibLoaded).toBe(true);
      expect(ids).not.toContain("refs-bib-missing");
      expect(ids).toContain("refs-undefined-cite");
    });

    async function dottedRefsContextFor(source: string): Promise<RefsContext> {
      seedProject();
      useFilesStore.setState((state) => ({
        tree: [...state.tree, { path: "refs.v1.bib", is_dir: false }],
        files: { ...state.files, "main.tex": { content: source, dirty: false } },
      }));
      await usePreflightStore.getState().run();
      return mocks.runPreflight.mock.calls[0][0].refs as RefsContext;
    }

    it("refuses a dotted name an \\addbibresource did not spell in full", async () => {
      const source = "\\addbibresource{refs.v1}";
      const refs = await dottedRefsContextFor(source);

      expect(refs.unresolvedBibliographies).toEqual([
        { file: "main.tex", name: "refs.v1" },
      ]);
      expect(refs.bibLoaded).toBe(false);
      expect(runRefsRules(source, refs, { file: "main.tex" }).map((f) => f.id)).toContain(
        "refs-bib-missing",
      );
    });

    it("accepts the same dotted name from a \\bibliography declaration", async () => {
      const source = "\\bibliography{refs.v1}";
      const refs = await dottedRefsContextFor(source);

      expect(refs.unresolvedBibliographies).toEqual([]);
      expect(refs.bibLoaded).toBe(true);
      expect(
        runRefsRules(source, refs, { file: "main.tex" }).map((f) => f.id),
      ).not.toContain("refs-bib-missing");
    });

    it("blames only the file whose copy of the same name is missing", async () => {
      const declaration = "\\addbibresource{local.bib}";
      seedProject();
      useFilesStore.setState((state) => ({
        tree: [
          ...state.tree,
          { path: "chapters/good.tex", is_dir: false },
          { path: "chapters/local.bib", is_dir: false },
          { path: "appendix/bad.tex", is_dir: false },
        ],
      }));
      useIndexStore.setState((state) => ({
        texts: {
          ...state.texts,
          "chapters/good.tex": declaration,
          "appendix/bad.tex": declaration,
        },
      }));

      await usePreflightStore.getState().run();
      const refs = mocks.runPreflight.mock.calls[0][0].refs as RefsContext;

      expect(
        runRefsRules(declaration, refs, { file: "chapters/good.tex" }).map((f) => f.id),
      ).not.toContain("refs-bib-missing");
      expect(
        runRefsRules(declaration, refs, { file: "appendix/bad.tex" }).map((f) => f.id),
      ).toContain("refs-bib-missing");
    });
  });

  it("uses an explicit profile and treats a stale successful compile as source-only", async () => {
    seedProject();
    usePreflightStore.setState({ submissionProfile: "acm", anonymousReview: true });
    useCompileStore.setState({
      status: "success",
      log: "old log",
      pdfBytes: new Uint8Array([1, 2]),
      lastCompileCheckpoint: {} as never,
    });
    mocks.isCompileCheckpointCurrent.mockReturnValue(false);

    await usePreflightStore.getState().run();

    expect(mocks.detectSubmissionProfile).not.toHaveBeenCalled();
    expect(mocks.extractForPreflight).not.toHaveBeenCalled();
    expect(mocks.runPreflight).toHaveBeenCalledWith(
      expect.objectContaining({
        submissionProfile: "acm",
        anonymousReview: true,
        compile: { status: "idle", log: "" },
      }),
    );
  });

  it("runs PDF-backed checks only for the current compile checkpoint", async () => {
    seedProject();
    const extraction = {
      pages: [[{ str: "Page", x: 1, y: 2, width: 3 }]],
      pageText: ["Page one", "Page two"],
      lang: "en-US",
      title: "A careful paper",
      tagged: true,
      extraction: {
        metadata: "ok",
        markInfo: "ok",
        structure: "ok",
        structureFailedPages: [],
      },
      struct: { tags: [] },
      facts: { pageCount: 2 },
    };
    mocks.isCompileCheckpointCurrent.mockReturnValue(true);
    mocks.extractForPreflight.mockResolvedValue(extraction);
    useCompileStore.setState({
      status: "success",
      log: "clean",
      pdfBytes: new Uint8Array([3, 4]),
      lastCompileCheckpoint: {} as never,
    });

    await usePreflightStore.getState().run();

    expect(mocks.extractForPreflight).toHaveBeenCalledWith(new Uint8Array([3, 4]));
    expect(mocks.runPreflight).toHaveBeenCalledWith(
      expect.objectContaining({
        pages: extraction.pages,
        meta: { lang: "en-US", title: "A careful paper", tagged: true },
        extraction: extraction.extraction,
        readerText: "Page one\nPage two",
        struct: extraction.struct,
        facts: extraction.facts,
        compile: { status: "success", log: "clean" },
      }),
    );
    expect(usePreflightStore.getState()).toMatchObject({
      report: mocks.report,
      pageText: ["Page one", "Page two"],
      running: false,
    });
  });

  it("does not publish PDF results after the active project changes", async () => {
    seedProject();
    mocks.isCompileCheckpointCurrent.mockReturnValue(true);
    useCompileStore.setState({
      status: "success",
      pdfBytes: new Uint8Array([8]),
      lastCompileCheckpoint: {} as never,
    });
    mocks.extractForPreflight.mockImplementation(async () => {
      useFilesStore.setState({ projectId: "another-project" });
      return {
        pages: [],
        pageText: [],
        lang: null,
        title: null,
        tagged: null,
        extraction: {},
        struct: null,
        facts: {},
      };
    });

    await usePreflightStore.getState().run();

    expect(mocks.runPreflight).not.toHaveBeenCalled();
    expect(usePreflightStore.getState().report).toBeNull();
  });

  it("surfaces extraction failures and records them in the application log", async () => {
    seedProject();
    mocks.isCompileCheckpointCurrent.mockReturnValue(true);
    useCompileStore.setState({
      status: "success",
      pdfBytes: new Uint8Array([9]),
      lastCompileCheckpoint: {} as never,
    });
    mocks.extractForPreflight.mockRejectedValue(new Error("Unreadable PDF"));

    await usePreflightStore.getState().run();
    await vi.waitFor(() => expect(mocks.logError).toHaveBeenCalled());

    expect(usePreflightStore.getState()).toMatchObject({
      running: false,
      error: "Error: Unreadable PDF",
    });
    expect(mocks.logError).toHaveBeenCalledWith("preflight", expect.any(Error));
  });
});
