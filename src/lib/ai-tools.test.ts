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
    projectMutationGeneration: vi.fn(),
    setMainDocCmd: vi.fn(),
    listFiles: vi.fn(),
    searchProject: vi.fn(),
    agentExecCwd: vi.fn(),
    agentExecRegisterExternal: vi.fn(),
    agentExecAuthorize: vi.fn(),
    agentExec: vi.fn(),
  },
  filesState: {
    projectId: "proj" as string | null,
    files: {} as Record<string, { content: string; dirty: boolean }>,
    applyExternalWrite: vi.fn(() => true),
    applyExternalDelete: vi.fn(() => true),
    applyExternalRename: vi.fn(() => true),
    prepareExternalMutation: vi.fn(async () => 0),
    recordMutationGeneration: vi.fn(),
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

import { createOleaflyTools } from "./ai-tools";
import { useSettingsStore } from "@/store/settings";

beforeEach(() => {
  // computer_use is only exposed when the experimental web browser is on.
  useSettingsStore.getState().setWebBrowser(true);
  for (const f of Object.values(mocks.api)) f.mockReset();
  mocks.filesState.applyExternalWrite.mockReset().mockReturnValue(true);
  mocks.filesState.applyExternalDelete.mockReset().mockReturnValue(true);
  mocks.filesState.applyExternalRename.mockReset().mockReturnValue(true);
  mocks.filesState.prepareExternalMutation.mockReset().mockResolvedValue(0);
  mocks.filesState.recordMutationGeneration.mockReset();
  mocks.api.projectMutationGeneration.mockResolvedValue(0);
  mocks.api.agentExecCwd.mockResolvedValue("/library/projects/proj");
  mocks.api.agentExecRegisterExternal.mockResolvedValue(undefined);
  mocks.api.agentExecAuthorize.mockResolvedValue("approval-token");
  mocks.api.agentExec.mockResolvedValue({
    command: "pwd",
    output: "/library/projects/proj",
    exit_code: 0,
    status: "Success",
    truncated: false,
    timed_out: false,
  });
  mocks.filesState.projectId = "proj";
  mocks.filesState.files = {};
});

describe("ai-tools: destructive edits require approval (U1)", () => {
  it("delete_file declines and does NOT touch disk when approval is refused", async () => {
    const confirm = vi.fn().mockResolvedValue(false);
    const tools = createOleaflyTools({ confirm });
    const res = await tools.delete_file.execute({ path: "sections/old.tex" });
    expect(confirm).toHaveBeenCalledOnce();
    expect(mocks.api.deleteFile).not.toHaveBeenCalled();
    expect(res).toMatchObject({ declined: true, tool: "delete_file" });
  });

  it("delete_file proceeds when approval is granted", async () => {
    const confirm = vi.fn().mockResolvedValue(true);
    const tools = createOleaflyTools({ confirm });
    const res = await tools.delete_file.execute({ path: "old.tex" });
    expect(mocks.api.deleteFile).toHaveBeenCalledWith("proj", "old.tex", 0);
    expect(res).toMatchObject({ success: true, path: "old.tex" });
  });

  it("write_file is gated the same way", async () => {
    mocks.api.readFileContent.mockResolvedValue("");
    const confirm = vi.fn().mockResolvedValue(false);
    const tools = createOleaflyTools({ confirm });
    const res = await tools.write_file.execute({ path: "a.tex", content: "x" });
    expect(mocks.api.writeFileContent).not.toHaveBeenCalled();
    expect(res).toMatchObject({ declined: true });
  });

  it("write_file's approval request carries a before/after diff", async () => {
    mocks.api.readFileContent.mockResolvedValue("old body");
    const confirm = vi.fn().mockResolvedValue(false);
    const tools = createOleaflyTools({ confirm });
    await tools.write_file.execute({ path: "a.tex", content: "new body" });
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        tool: "write_file",
        diff: { path: "a.tex", oldText: "old body", newText: "new body" },
      }),
    );
  });

  it("commits an approved write against the fresh post-approval generation", async () => {
    mocks.api.readFileContent.mockResolvedValue("old body");
    mocks.filesState.prepareExternalMutation
      .mockResolvedValueOnce(4)
      .mockResolvedValueOnce(9);
    const tools = createOleaflyTools({ confirm: async () => true });

    await tools.write_file.execute({ path: "a.tex", content: "new body" });

    expect(mocks.api.writeFileContent).toHaveBeenCalledWith(
      "proj",
      "a.tex",
      "new body",
      9,
    );
  });

  it("write_file on a new file shows an empty old side (all additions)", async () => {
    mocks.api.readFileContent.mockRejectedValue(new Error("no such file"));
    const confirm = vi.fn().mockResolvedValue(false);
    const tools = createOleaflyTools({ confirm });
    await tools.write_file.execute({ path: "new.tex", content: "hello" });
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        diff: { path: "new.tex", oldText: "", newText: "hello" },
      }),
    );
  });

  it("reports a conflict when a local edit lands while the write IPC is running", async () => {
    mocks.filesState.applyExternalWrite.mockReturnValue(false);
    const tools = createOleaflyTools();

    const res = await tools.write_file.execute({ path: "a.tex", content: "external" });

    expect(res).toMatchObject({ conflict: true, error: expect.stringContaining("local edit") });
  });

  it("reports a conflict when unsaved local edits race a delete", async () => {
    mocks.filesState.applyExternalDelete.mockReturnValue(false);
    const tools = createOleaflyTools();

    const res = await tools.delete_file.execute({ path: "a.tex" });

    expect(res).toMatchObject({ conflict: true, error: expect.stringContaining("restored") });
  });

  it("replace_in_file's approval request carries the applied diff", async () => {
    mocks.api.readFileContent.mockResolvedValue("alpha beta gamma");
    const confirm = vi.fn().mockResolvedValue(false);
    const tools = createOleaflyTools({ confirm });
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
    const tools = createOleaflyTools({ confirm });
    // `$$`, `$&`, `$1` etc. must land literally, not be interpreted by
    // String.prototype.replace's substitution syntax.
    await tools.replace_in_file.execute({
      path: "a.tex",
      find: "PLACEHOLDER",
      replace: "$$a + $& $1 $`",
    });
    expect(mocks.api.writeFileContent).toHaveBeenCalledWith(
      "proj",
      "a.tex",
      "x $$a + $& $1 $` y",
      0,
    );
  });

  it("replace_in_file errors before asking for approval when find is absent", async () => {
    mocks.api.readFileContent.mockResolvedValue("no match here");
    const confirm = vi.fn().mockResolvedValue(true);
    const tools = createOleaflyTools({ confirm });
    const res = await tools.replace_in_file.execute({ path: "a.tex", find: "zzz", replace: "y" });
    expect(confirm).not.toHaveBeenCalled();
    expect(mocks.api.writeFileContent).not.toHaveBeenCalled();
    expect(res).toMatchObject({ error: expect.stringContaining("not found") });
  });

  it("rejects an empty find string without constructing replacement output", async () => {
    mocks.api.readFileContent.mockResolvedValue("abc");
    const tools = createOleaflyTools();

    const res = await tools.replace_in_file.execute({
      path: "a.tex",
      find: "",
      replace: "x",
      replace_all: true,
    });

    expect(res).toMatchObject({ error: expect.stringContaining("must not be empty") });
    expect(mocks.api.readFileContent).not.toHaveBeenCalled();
    expect(mocks.api.writeFileContent).not.toHaveBeenCalled();
  });

  it("rejects replacement output over the bounded write limit before constructing it", async () => {
    mocks.api.readFileContent.mockResolvedValue("a".repeat(9 * 1024 * 1024));
    const tools = createOleaflyTools();

    const res = await tools.replace_in_file.execute({
      path: "a.tex",
      find: "a",
      replace: "aa",
      replace_all: true,
    });

    expect(res).toMatchObject({ error: expect.stringContaining("exceeds") });
    expect(mocks.api.writeFileContent).not.toHaveBeenCalled();
  });

  it("rejects pathological replace-all counts even when output size is unchanged", async () => {
    mocks.api.readFileContent.mockResolvedValue("a".repeat(100_001));
    const tools = createOleaflyTools();

    const res = await tools.replace_in_file.execute({
      path: "a.tex",
      find: "a",
      replace: "a",
      replace_all: true,
    });

    expect(res).toMatchObject({ error: expect.stringContaining("operation limit") });
    expect(mocks.api.writeFileContent).not.toHaveBeenCalled();
  });

  it("create_file is gated and declines without touching disk when refused", async () => {
    const confirm = vi.fn().mockResolvedValue(false);
    const tools = createOleaflyTools({ confirm });
    const res = await tools.create_file.execute({ path: "notes.tex" });
    expect(confirm).toHaveBeenCalledOnce();
    expect(mocks.api.createFile).not.toHaveBeenCalled();
    expect(res).toMatchObject({ declined: true, tool: "create_file" });
  });

  it("read_file is non-destructive and never asks for approval", async () => {
    mocks.api.readFileContent.mockResolvedValue("hello");
    const confirm = vi.fn().mockResolvedValue(true);
    const tools = createOleaflyTools({ confirm });
    const res = await tools.read_file.execute({ path: "a.tex" });
    expect(confirm).not.toHaveBeenCalled();
    expect(res).toMatchObject({ content: "hello", path: "a.tex" });
  });
});

describe("ai-tools: project scoping", () => {
  it("every file tool errors when no project is open", async () => {
    mocks.filesState.projectId = null;
    const tools = createOleaflyTools();
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
    const tools = createOleaflyTools();
    await tools.search_project.execute({ query: "theorem" });
    expect(mocks.api.searchProject).toHaveBeenCalledWith("proj", "theorem");
  });

  it("search_project returns every hit instead of a capped prefix", async () => {
    const hits = Array.from({ length: 47 }, (_, i) => ({
      path: `doc-${i}.tex`,
      line: i + 1,
      preview: `theorem match ${i}`,
    }));
    mocks.api.searchProject.mockResolvedValue(hits);
    const tools = createOleaflyTools();
    const result = (await tools.search_project.execute({ query: "theorem" })) as {
      results: unknown[];
      total: number;
    };
    expect(result.results).toHaveLength(47);
    expect(result.total).toBe(47);
  });

  it("does not write when the active project changes during approval", async () => {
    mocks.api.readFileContent.mockResolvedValue("old");
    let approve!: (value: boolean) => void;
    const confirm = vi.fn(
      () => new Promise<boolean>((resolve) => {
        approve = resolve;
      }),
    );
    const tools = createOleaflyTools({ confirm });
    const pending = tools.write_file.execute({ path: "a.tex", content: "new" });
    await vi.waitFor(() => expect(confirm).toHaveBeenCalledOnce());

    mocks.filesState.projectId = "other";
    approve(true);

    await expect(pending).resolves.toMatchObject({ error: expect.stringContaining("Project changed") });
    expect(mocks.api.writeFileContent).not.toHaveBeenCalled();
    expect(mocks.filesState.applyExternalWrite).not.toHaveBeenCalled();
  });
});

describe("ai-tools: command approval", () => {
  it("describes approval-gated tools without contradicting the active mode", () => {
    const tools = createOleaflyTools({ confirm: async () => true, runId: () => "run-1" });

    expect(tools.set_main_doc.description).toContain("active approval policy");
    expect(tools.run_command.description).toContain("active approval policy");
    expect(tools.computer_use.description).toContain("active approval policy");
    expect(
      [tools.set_main_doc, tools.run_command, tools.computer_use]
        .map((tool) => tool.description)
        .join(" "),
    ).not.toMatch(/confirmed with the user|requires user approval/i);
  });

  it("omits computer_use entirely when the web browser is disabled", () => {
    useSettingsStore.getState().setWebBrowser(false);
    const tools = createOleaflyTools({ confirm: async () => true, runId: () => "run-1" });
    expect(tools.computer_use).toBeUndefined();
  });

  it("does not expose shell execution without an approval flow", async () => {
    const result = await createOleaflyTools({ runId: () => "run-1" }).run_command.execute({
      command: "pwd",
    });

    expect(result).toMatchObject({ declined: true, tool: "run_command" });
    expect(result).toMatchObject({ status: "declined", message: expect.stringContaining("declined") });
    expect(result).not.toHaveProperty("error");
    expect(mocks.api.agentExecAuthorize).not.toHaveBeenCalled();
    expect(mocks.api.agentExec).not.toHaveBeenCalled();
  });

  it("shows the exact command and working directory before authorization", async () => {
    const confirm = vi.fn().mockResolvedValue(false);
    await createOleaflyTools({ confirm, runId: () => "run-1" }).run_command.execute({
      command: "pnpm test",
    });

    expect(confirm).toHaveBeenCalledWith({
      tool: "run_command",
      summary: "$ pnpm test",
      projectId: "proj",
      command: "pnpm test",
      cwd: "/library/projects/proj",
    });
    expect(mocks.api.agentExecAuthorize).not.toHaveBeenCalled();
  });

  it("mints and consumes an approval bound to the originating project and run", async () => {
    const confirm = vi.fn().mockResolvedValue(true);
    await createOleaflyTools({ confirm, runId: () => "run-7" }).run_command.execute({
      command: "pwd",
    });

    expect(mocks.api.agentExecAuthorize).toHaveBeenCalledWith("proj", "pwd", "run-7");
    expect(mocks.api.agentExec).toHaveBeenCalledWith(
      "proj",
      "pwd",
      "run-7",
      "approval-token",
    );
    // A native run id is already tracked, so no external registration happens.
    expect(mocks.api.agentExecRegisterExternal).not.toHaveBeenCalled();
  });

  it("runs a subagent command under its own registered execution owner", async () => {
    const confirm = vi.fn().mockResolvedValue(true);
    const owner = "external:00000000-0000-4000-8000-000000000abc";
    await createOleaflyTools({ confirm, runId: () => "run-7" }).run_command.execute({
      command: "pwd",
      __execOwner: owner,
    });

    // The child's owner wins over the run's native id, and is registered
    // before authorizing so the native registry trusts it.
    expect(mocks.api.agentExecRegisterExternal).toHaveBeenCalledWith(owner);
    expect(mocks.api.agentExecAuthorize).toHaveBeenCalledWith("proj", "pwd", owner);
    expect(mocks.api.agentExec).toHaveBeenCalledWith("proj", "pwd", owner, "approval-token");
  });

  it("registers a renderer-minted external owner before authorizing it", async () => {
    const confirm = vi.fn().mockResolvedValue(true);
    await createOleaflyTools({ confirm }).run_command.execute({ command: "pwd" });

    expect(mocks.api.agentExecRegisterExternal).toHaveBeenCalledTimes(1);
    const [registeredRunId] =
      mocks.api.agentExecRegisterExternal.mock.calls[0];
    expect(registeredRunId).toMatch(/^external:/);
    const [, , authorizedRunId] = mocks.api.agentExecAuthorize.mock.calls[0];
    expect(authorizedRunId).toBe(registeredRunId);
    const registerOrder =
      mocks.api.agentExecRegisterExternal.mock.invocationCallOrder[0];
    const authorizeOrder =
      mocks.api.agentExecAuthorize.mock.invocationCallOrder[0];
    expect(registerOrder).toBeLessThan(authorizeOrder);
  });

  it("preserves an explicit timeout outcome when no exit code exists", async () => {
    mocks.api.agentExec.mockResolvedValue({
      command: "sleep 180",
      output: "",
      exit_code: null,
      status: "Stopped: timed out",
      truncated: false,
      timed_out: true,
    });

    const result = await createOleaflyTools({
      confirm: async () => true,
      runId: () => "run-timeout",
    }).run_command.execute({ command: "sleep 180" });

    expect(result).toMatchObject({ exit_code: null, timed_out: true });
  });

  it("refuses an approved command if the project switches while approval is pending", async () => {
    let approve!: (value: boolean) => void;
    const confirm = vi.fn(
      () => new Promise<boolean>((resolve) => {
        approve = resolve;
      }),
    );
    const pending = createOleaflyTools({ confirm, runId: () => "run-1" }).run_command.execute({
      command: "pwd",
    });
    await vi.waitFor(() => expect(confirm).toHaveBeenCalledOnce());

    mocks.filesState.projectId = "other";
    approve(true);

    await expect(pending).resolves.toMatchObject({ error: expect.stringContaining("Project changed") });
    expect(mocks.api.agentExecAuthorize).not.toHaveBeenCalled();
    expect(mocks.api.agentExec).not.toHaveBeenCalled();
  });
});

describe("ai-tools: Typst project map", () => {
  it("reports file edges and ambiguous @ uses explicitly", async () => {
    const index = (await import("@/lib/index/build")).buildIndex({
      "main.typ": '= Main <main>\n#include "chapter.typ"\nSee @main and @source.',
      "chapter.typ": "== Chapter",
    });
    mocks.indexState.index = index;
    const result = await createOleaflyTools().project_map.execute({});
    expect(result).toMatchObject({
      inputGraph: [{ from: "main.typ", to: "chapter.typ" }],
      ambiguousTypstAtUses: ["main", "source"],
    });
  });
});
