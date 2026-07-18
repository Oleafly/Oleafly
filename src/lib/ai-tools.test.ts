import { describe, it, expect, beforeEach, vi } from "vitest";
import type { ProjectIndex } from "@/lib/index/types";

// Mock the Tauri command layer and the stores the tools reach into.
const mocks = vi.hoisted(() => ({
  api: {
    readFileContent: vi.fn(),
    writeFileContent: vi.fn(),
    createFile: vi.fn(),
    deleteFile: vi.fn(),
    renameFile: vi.fn(),
    setMainDocCmd: vi.fn(),
    listFiles: vi.fn(),
    searchProject: vi.fn(),
  },
  filesState: {
    projectId: "proj" as string | null,
    applyExternalWrite: vi.fn(),
    applyExternalDelete: vi.fn(),
    applyExternalRename: vi.fn(),
    refreshTree: vi.fn(),
  },
  compileState: { recompile: vi.fn(), log: "", pdfBytes: null as Uint8Array | null },
  indexState: { index: null as ProjectIndex | null, rebuildFromDisk: vi.fn() },
}));

vi.mock("@/lib/tauri", () => mocks.api);
vi.mock("@/store/files", () => ({
  useFilesStore: { getState: () => mocks.filesState, setState: vi.fn() },
}));
vi.mock("@/store/compile", () => ({ useCompileStore: { getState: () => mocks.compileState } }));
vi.mock("@/store/project-index", () => ({ useIndexStore: { getState: () => mocks.indexState } }));
vi.mock("@/lib/pdf-text", () => ({ extractPdfText: vi.fn() }));
// pdf-image pulls in pdfjs-dist (needs DOMMatrix), so mock it out of the graph.
vi.mock("@/lib/pdf-image", () => ({ pdfPageToPng: vi.fn() }));

import { createOpenLeafTools } from "./ai-tools";

beforeEach(() => {
  for (const f of Object.values(mocks.api)) f.mockReset();
  mocks.filesState.applyExternalWrite.mockReset();
  mocks.filesState.applyExternalDelete.mockReset();
  mocks.filesState.projectId = "proj";
});

describe("ai-tools: destructive edits require approval (U1)", () => {
  it("delete_file declines and does NOT touch disk when approval is refused", async () => {
    const confirm = vi.fn().mockResolvedValue(false);
    const tools = createOpenLeafTools({ confirm });
    const res = await tools.delete_file.execute({ path: "sections/old.tex" });
    expect(confirm).toHaveBeenCalledOnce();
    expect(mocks.api.deleteFile).not.toHaveBeenCalled();
    expect(res).toMatchObject({ declined: true, tool: "delete_file" });
  });

  it("delete_file proceeds when approval is granted", async () => {
    const confirm = vi.fn().mockResolvedValue(true);
    const tools = createOpenLeafTools({ confirm });
    const res = await tools.delete_file.execute({ path: "old.tex" });
    expect(mocks.api.deleteFile).toHaveBeenCalledWith("proj", "old.tex");
    expect(res).toMatchObject({ success: true, path: "old.tex" });
  });

  it("write_file is gated the same way", async () => {
    mocks.api.readFileContent.mockResolvedValue("");
    const confirm = vi.fn().mockResolvedValue(false);
    const tools = createOpenLeafTools({ confirm });
    const res = await tools.write_file.execute({ path: "a.tex", content: "x" });
    expect(mocks.api.writeFileContent).not.toHaveBeenCalled();
    expect(res).toMatchObject({ declined: true });
  });

  it("write_file's approval request carries a before/after diff", async () => {
    mocks.api.readFileContent.mockResolvedValue("old body");
    const confirm = vi.fn().mockResolvedValue(false);
    const tools = createOpenLeafTools({ confirm });
    await tools.write_file.execute({ path: "a.tex", content: "new body" });
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        tool: "write_file",
        diff: { path: "a.tex", oldText: "old body", newText: "new body" },
      }),
    );
  });

  it("write_file on a new file shows an empty old side (all additions)", async () => {
    mocks.api.readFileContent.mockRejectedValue(new Error("no such file"));
    const confirm = vi.fn().mockResolvedValue(false);
    const tools = createOpenLeafTools({ confirm });
    await tools.write_file.execute({ path: "new.tex", content: "hello" });
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        diff: { path: "new.tex", oldText: "", newText: "hello" },
      }),
    );
  });

  it("replace_in_file's approval request carries the applied diff", async () => {
    mocks.api.readFileContent.mockResolvedValue("alpha beta gamma");
    const confirm = vi.fn().mockResolvedValue(false);
    const tools = createOpenLeafTools({ confirm });
    await tools.replace_in_file.execute({ path: "a.tex", find: "beta", replace: "BETA" });
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        tool: "replace_in_file",
        diff: { path: "a.tex", oldText: "alpha beta gamma", newText: "alpha BETA gamma" },
      }),
    );
  });

  it("replace_in_file inserts $-patterns verbatim (no LaTeX corruption)", async () => {
    mocks.api.readFileContent.mockResolvedValue("x PLACEHOLDER y");
    const confirm = vi.fn().mockResolvedValue(true);
    const tools = createOpenLeafTools({ confirm });
    // `$$`, `$&`, `$1` etc. must land literally, not be interpreted by
    // String.prototype.replace's substitution syntax.
    await tools.replace_in_file.execute({
      path: "a.tex",
      find: "PLACEHOLDER",
      replace: "$$a + $& $1 $`",
    });
    expect(mocks.api.writeFileContent).toHaveBeenCalledWith("proj", "a.tex", "x $$a + $& $1 $` y");
  });

  it("replace_in_file errors before asking for approval when find is absent", async () => {
    mocks.api.readFileContent.mockResolvedValue("no match here");
    const confirm = vi.fn().mockResolvedValue(true);
    const tools = createOpenLeafTools({ confirm });
    const res = await tools.replace_in_file.execute({ path: "a.tex", find: "zzz", replace: "y" });
    expect(confirm).not.toHaveBeenCalled();
    expect(mocks.api.writeFileContent).not.toHaveBeenCalled();
    expect(res).toMatchObject({ error: expect.stringContaining("not found") });
  });

  it("create_file is gated and declines without touching disk when refused", async () => {
    const confirm = vi.fn().mockResolvedValue(false);
    const tools = createOpenLeafTools({ confirm });
    const res = await tools.create_file.execute({ path: "notes.tex" });
    expect(confirm).toHaveBeenCalledOnce();
    expect(mocks.api.createFile).not.toHaveBeenCalled();
    expect(res).toMatchObject({ declined: true, tool: "create_file" });
  });

  it("read_file is non-destructive and never asks for approval", async () => {
    mocks.api.readFileContent.mockResolvedValue("hello");
    const confirm = vi.fn().mockResolvedValue(true);
    const tools = createOpenLeafTools({ confirm });
    const res = await tools.read_file.execute({ path: "a.tex" });
    expect(confirm).not.toHaveBeenCalled();
    expect(res).toMatchObject({ content: "hello", path: "a.tex" });
  });
});

describe("ai-tools: project scoping", () => {
  it("every file tool errors when no project is open", async () => {
    mocks.filesState.projectId = null;
    const tools = createOpenLeafTools();
    expect(await tools.write_file.execute({ path: "a.tex", content: "x" })).toMatchObject({
      error: "No project open",
    });
    expect(await tools.read_file.execute({ path: "a.tex" })).toMatchObject({
      error: "No project open",
    });
    expect(mocks.api.writeFileContent).not.toHaveBeenCalled();
  });

  it("search_project scopes the query to the active project id", async () => {
    mocks.api.searchProject.mockResolvedValue([]);
    const tools = createOpenLeafTools();
    await tools.search_project.execute({ query: "theorem" });
    expect(mocks.api.searchProject).toHaveBeenCalledWith("proj", "theorem");
  });
});

describe("ai-tools: Typst project map", () => {
  it("reports file edges and ambiguous @ uses explicitly", async () => {
    const index = (await import("@/lib/index/build")).buildIndex({
      "main.typ": '= Main <main>\n#include "chapter.typ"\nSee @main and @source.',
      "chapter.typ": "== Chapter",
    });
    mocks.indexState.index = index;
    const result = await createOpenLeafTools().project_map.execute({});
    expect(result).toMatchObject({
      inputGraph: [{ from: "main.typ", to: "chapter.typ" }],
      ambiguousTypstAtUses: ["main", "source"],
    });
  });
});
