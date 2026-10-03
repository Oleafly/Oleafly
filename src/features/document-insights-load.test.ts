import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readFile: vi.fn(),
  refreshAux: vi.fn(),
  texts: {} as Record<string, string>,
  files: {
    projectId: "paper" as string | null,
    mainDoc: "main.tex",
    files: {} as Record<string, { content?: string }>,
    engine: { id: "latexmk", source_format: "latex" },
  },
  checkpoint: null as null | { projectId: string; mainDocument: string; outputId: string },
  current: false,
}));

vi.mock("@/lib/tauri", () => ({ readFileContent: mocks.readFile }));
vi.mock("@/store/files", () => ({ useFilesStore: { getState: () => mocks.files } }));
vi.mock("@/store/project-index", () => ({ useIndexStore: { getState: () => ({ texts: mocks.texts }) } }));
vi.mock("@/store/settings", () => ({ useSettingsStore: { getState: () => ({ offline: false }) } }));
vi.mock("@/store/typst-variant", () => ({ activeTypstVariant: () => null }));
vi.mock("@/lib/tex-root", () => ({ resolveEffectiveMainDoc: () => ({ mainDoc: mocks.files.mainDoc }) }));
vi.mock("@/store/compile", () => ({
  useCompileStore: { getState: () => ({ lastCompileCheckpoint: mocks.checkpoint }) },
  isCompileCheckpointCurrent: () => mocks.current,
}));
vi.mock("@/lib/aux-numbers", () => ({ refreshAuxNumbers: mocks.refreshAux, auxNumberFor: () => null }));

import { insightsEngineFor, loadDocumentInsights } from "./document-insights-load";

function serve(files: Record<string, string>) {
  mocks.readFile.mockImplementation((_projectId: string, path: string) =>
    Object.hasOwn(files, path) ? Promise.resolve(files[path]) : Promise.reject(new Error(`missing ${path}`)),
  );
}

function readPaths(): string[] {
  return mocks.readFile.mock.calls.map(([, path]) => path as string);
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.files.projectId = "paper";
  mocks.files.mainDoc = "main.tex";
  mocks.files.files = {};
  mocks.texts = {};
  mocks.checkpoint = null;
  mocks.current = false;
});

describe("insightsEngineFor", () => {
  it("maps engines by source format first, then by id", () => {
    expect(insightsEngineFor({ id: "latexmk", source_format: "latex" })).toBe("latex");
    expect(insightsEngineFor({ id: "markdown" })).toBe("markdown");
    expect(insightsEngineFor({ id: "pandoc", source_format: "docx" })).toBeNull();
    expect(insightsEngineFor(null)).toBeNull();
  });
});

describe("loadDocumentInsights for LaTeX", () => {
  it("reads includes round after round until nothing new is missing", async () => {
    mocks.texts = { "main.tex": String.raw`\begin{document}\input{a}\end{document}` };
    serve({ "a.tex": String.raw`\input{b}`, "b.tex": String.raw`\section{Deep}` });
    const loaded = await loadDocumentInsights("latex");
    expect(readPaths()).toEqual(["a.tex", "b.tex"]);
    expect(loaded.engine).toBe("latex");
    expect(loaded.insights.headings.map((heading) => heading.text)).toEqual(["Deep"]);
  });

  it("tries the next candidate when the first one cannot be read, and never retries a failed include", async () => {
    mocks.texts = { "main.tex": String.raw`\begin{document}\input{chap.x}\input{gone}\end{document}` };
    serve({ "chap.x.tex": String.raw`\section{Found}` });
    const loaded = await loadDocumentInsights("latex");
    expect(readPaths()).toEqual(["chap.x", "gone.tex", "chap.x.tex"]);
    expect(loaded.insights.headings.map((heading) => heading.text)).toEqual(["Found"]);
  });

  it("reads independent includes in the same round", async () => {
    mocks.texts = { "main.tex": String.raw`\begin{document}\input{one}\input{two}\end{document}` };
    serve({ "one.tex": String.raw`\section{One}`, "two.tex": String.raw`\section{Two}` });
    const loaded = await loadDocumentInsights("latex");
    expect(readPaths()).toEqual(["one.tex", "two.tex"]);
    expect(loaded.insights.headings.map((heading) => heading.text)).toEqual(["One", "Two"]);
  });

  it("reads the main file when the index does not have it, and prefers open buffers", async () => {
    mocks.files.files = { "a.tex": { content: String.raw`\section{Buffered}` } };
    serve({ "main.tex": String.raw`\begin{document}\input{a}\end{document}` });
    const loaded = await loadDocumentInsights("latex");
    expect(readPaths()).toEqual(["main.tex"]);
    expect(loaded.insights.headings.map((heading) => heading.text)).toEqual(["Buffered"]);
  });

  it.each([
    [null, false, "missing"],
    [{ projectId: "other", mainDocument: "main.tex", outputId: "out" }, true, "missing"],
    [{ projectId: "paper", mainDocument: "other.tex", outputId: "out" }, true, "missing"],
    [{ projectId: "paper", mainDocument: "main.tex", outputId: "out" }, false, "stale"],
    [{ projectId: "paper", mainDocument: "main.tex", outputId: "out" }, true, "current"],
  ] as const)("reports numbers from the checkpoint %j (current %s) as %s", async (checkpoint, current, numbers) => {
    mocks.texts = { "main.tex": String.raw`\begin{document}\section{A}\end{document}` };
    mocks.checkpoint = checkpoint;
    mocks.current = current;
    const loaded = await loadDocumentInsights("latex");
    expect(loaded).toMatchObject({ engine: "latex", numbers });
    expect(mocks.refreshAux).toHaveBeenCalledTimes(numbers === "current" ? 1 : 0);
  });
});

describe("loadDocumentInsights for Markdown", () => {
  it("reads a declared bibliography that is not indexed yet", async () => {
    mocks.files.mainDoc = "paper.md";
    mocks.texts = { "paper.md": "---\nbibliography: refs.bib\n---\n\nSee [@smith].\n" };
    serve({ "refs.bib": "@article{smith, title={A}}\n" });
    const loaded = await loadDocumentInsights("markdown");
    expect(readPaths()).toEqual(["refs.bib"]);
    expect(loaded.insights.citations).toEqual([expect.objectContaining({ key: "smith", unresolved: false })]);
  });
});

describe("loadDocumentInsights without a project", () => {
  it("rejects", () => {
    mocks.files.projectId = null;
    expect(() => loadDocumentInsights("latex")).toThrow("no project");
  });
});
