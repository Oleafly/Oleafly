import { beforeEach, describe, expect, it, vi } from "vitest";
import { LATEX_ENGINE } from "@/lib/document-engine";

const mocks = vi.hoisted(() => ({
  getProject: vi.fn(),
  getProjectEngine: vi.fn(),
  projectMutationGeneration: vi.fn(),
  listFiles: vi.fn(),
  readFileContent: vi.fn(),
  readProjectSourcesBatch: vi.fn(),
  logError: vi.fn(),
  mcpSetActiveProject: vi.fn(async () => {}),
}));

vi.mock("@/lib/tauri", () => ({
  getProject: mocks.getProject,
  projectManifestHome: vi.fn(async () => "library"),
  getProjectEngine: mocks.getProjectEngine,
  projectMutationGeneration: mocks.projectMutationGeneration,
  listFiles: mocks.listFiles,
  listFileTree: async (projectId: string) => ({
    entries: await mocks.listFiles(projectId),
    truncated: false,
  }),
  readFileContent: mocks.readFileContent,
  readProjectSourcesBatch: mocks.readProjectSourcesBatch,
  listProjects: vi.fn(async () => []),
  mcpSetActiveProject: mocks.mcpSetActiveProject,
}));
vi.mock("@/lib/log", () => ({ logError: mocks.logError }));
vi.mock("@/lib/toast", () => ({
  notifyError: vi.fn(),
  toast: { info: vi.fn(), infoUnique: vi.fn(), success: vi.fn(), errorUnique: vi.fn(), dismiss: vi.fn() },
}));
vi.mock("@/store/diff", () => ({ useDiffStore: { getState: () => ({ clearActiveDiff: vi.fn() }) } }));
vi.mock("@/store/tab-order", () => ({ nextTabSeq: () => 1 }));
vi.mock("@/store/compile", () => ({ useCompileStore: { getState: () => ({ reset: vi.fn() }) } }));
vi.mock("@/components/editor/wysiwyg/controller", () => ({
  flushWysiwygPendingEdits: vi.fn(),
  invalidateWysiwygProjectSession: vi.fn(),
}));

import { projectCompatibilityFindings, useFilesStore } from "./files";
import { resetProjectSourcesCache } from "@/lib/project-sources";

const SOURCES: Record<string, string> = {
  "main.tex": String.raw`\documentclass{book}\begin{document}\input{chapters/one}\end{document}`,
  "chapters/one.tex": `${String.raw`\usepackage{minted}`}\r\nChapter one.`,
  "chapters/two.tex": "Chapter two.",
  "chapters/three.tex": "Chapter three.",
  latexmkrc: "$pdf_mode = 1;",
};

function tree() {
  return [
    { path: "main.tex", is_dir: false },
    { path: "chapters", is_dir: true },
    { path: "chapters/one.tex", is_dir: false },
    { path: "chapters/two.tex", is_dir: false },
    { path: "chapters/three.tex", is_dir: false },
    { path: "latexmkrc", is_dir: false },
  ];
}

beforeEach(async () => {
  await useFilesStore.getState().closeProject();
  resetProjectSourcesCache();
  mocks.logError.mockReset().mockResolvedValue(undefined);
  mocks.getProject.mockReset().mockResolvedValue({ name: "Book", kind: "", main_doc: "main.tex" });
  mocks.getProjectEngine.mockReset().mockResolvedValue(LATEX_ENGINE);
  mocks.projectMutationGeneration.mockReset().mockResolvedValue(0);
  mocks.listFiles.mockReset().mockResolvedValue(tree());
  mocks.readFileContent.mockReset().mockImplementation(async (_projectId: string, path: string) => {
    const text = SOURCES[path];
    if (text === undefined) throw new Error(`missing ${path}`);
    return text;
  });
  mocks.readProjectSourcesBatch.mockReset().mockImplementation(
    async (_projectId: string, request: { paths: string[] }) => ({
      files: request.paths
        .filter((path) => SOURCES[path] !== undefined)
        .map((path) => ({ path, hash: `h-${path}`, text: SOURCES[path] })),
      unchanged: [],
      unreadable: request.paths
        .filter((path) => SOURCES[path] === undefined)
        .map((path) => ({ path, message: "unreadable" })),
      oversized: [],
      truncated: false,
    }),
  );
});

describe("compatibility scan on open", () => {
  it("reads every unopened source in one batched request instead of one read per file", async () => {
    await useFilesStore.getState().openProject("book");

    await vi.waitFor(() =>
      expect(projectCompatibilityFindings("book").map((finding) => finding.id)).toContain("minted"),
    );
    expect(mocks.readProjectSourcesBatch).toHaveBeenCalledTimes(1);
    expect(mocks.readProjectSourcesBatch.mock.calls[0]?.[1].paths.sort()).toEqual(
      ["chapters/one.tex", "chapters/three.tex", "chapters/two.tex", "latexmkrc"].sort(),
    );
    expect(mocks.readFileContent.mock.calls.map(([, path]) => path)).toEqual(["main.tex"]);
  });

  it("still logs the read error for a source the batch could not read", async () => {
    const failure = new Error("source read failed");
    delete SOURCES["chapters/two.tex"];
    mocks.readFileContent.mockImplementation(async (_projectId: string, path: string) => {
      if (path === "chapters/two.tex") throw failure;
      const text = SOURCES[path];
      if (text === undefined) throw new Error(`missing ${path}`);
      return text;
    });
    try {
      await useFilesStore.getState().openProject("book");

      await vi.waitFor(() =>
        expect(mocks.logError).toHaveBeenCalledWith("scan project compatibility", failure),
      );
      await vi.waitFor(() =>
        expect(projectCompatibilityFindings("book").map((finding) => finding.id)).toContain("minted"),
      );
      expect(useFilesStore.getState().projectId).toBe("book");
    } finally {
      SOURCES["chapters/two.tex"] = "Chapter two.";
    }
  });

  it("reads the sources the batch missed one at a time in tree order", async () => {
    delete SOURCES["chapters/two.tex"];
    delete SOURCES["chapters/three.tex"];
    const events: string[] = [];
    mocks.readFileContent.mockImplementation(async (_projectId: string, path: string) => {
      if (path === "chapters/two.tex" || path === "chapters/three.tex") {
        events.push(`start ${path}`);
        await Promise.resolve();
        events.push(`end ${path}`);
        if (path === "chapters/two.tex") throw new Error("two failed");
        return String.raw`\usepackage{minted}`;
      }
      const text = SOURCES[path];
      if (text === undefined) throw new Error(`missing ${path}`);
      return text;
    });
    try {
      await useFilesStore.getState().openProject("book");

      await vi.waitFor(() => expect(events).toHaveLength(4));
      expect(events).toEqual([
        "start chapters/two.tex",
        "end chapters/two.tex",
        "start chapters/three.tex",
        "end chapters/three.tex",
      ]);
      await vi.waitFor(() =>
        expect(mocks.logError).toHaveBeenCalledWith("scan project compatibility", new Error("two failed")),
      );
    } finally {
      SOURCES["chapters/two.tex"] = "Chapter two.";
      SOURCES["chapters/three.tex"] = "Chapter three.";
    }
  });
});
