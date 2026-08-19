import { beforeEach, describe, expect, it, vi } from "vitest";
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

import { usePreflightStore } from "./preflight";

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
    useFilesStore.setState({ engineError: "Engine probe failed" });
    await usePreflightStore.getState().run();
    expect(usePreflightStore.getState()).toMatchObject({
      running: false,
      error: "Engine probe failed",
    });

    useFilesStore.setState({ engineError: null });
    await usePreflightStore.getState().run();
    expect(usePreflightStore.getState().error).toBe(
      "Document engine details are still loading.",
    );
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
