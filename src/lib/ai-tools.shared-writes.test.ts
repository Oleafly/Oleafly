import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AiToolsHost } from "@oleafly/ai-tools";

const mocks = vi.hoisted(() => ({
  host: null as unknown,
  api: {
    readFileContent: vi.fn(),
    writeFileContent: vi.fn(),
    collabWriteText: vi.fn(),
    createFile: vi.fn(),
    deleteFile: vi.fn(),
    renameFile: vi.fn(),
    projectMutationGeneration: vi.fn(),
    listFiles: vi.fn(),
    searchProject: vi.fn(),
    agentExecCwd: vi.fn(),
    agentExecRegisterExternal: vi.fn(),
    agentExecAuthorize: vi.fn(),
    agentExec: vi.fn(),
    renderTypstSnippet: vi.fn(),
  },
  files: {
    projectId: "proj" as string | null,
    engine: null as unknown,
    engineLoaded: true,
    mainDecision: "auto",
    mainDoc: "main.tex",
    activePath: null as string | null,
    files: {} as Record<string, { content: string; dirty: boolean }>,
    applyExternalWrite: vi.fn(() => true),
    applyExternalDelete: vi.fn(() => true),
    applyExternalRename: vi.fn(() => true),
    prepareExternalMutation: vi.fn(async () => 4),
    recordMutationGeneration: vi.fn(),
    refreshTree: vi.fn(),
    setMainDoc: vi.fn(async () => {}),
  },
  editorView: null as object | null,
}));

vi.mock("@oleafly/ai-tools", async (importOriginal) => {
  const real = await importOriginal<typeof import("@oleafly/ai-tools")>();
  return {
    ...real,
    createOleaflyTools: (host: AiToolsHost, options: Parameters<typeof real.createOleaflyTools>[1]) => {
      mocks.host = host;
      return real.createOleaflyTools(host, options);
    },
  };
});
vi.mock("@/lib/tauri", () => mocks.api);
vi.mock("@/lib/tauri-collab", () => mocks.api);
vi.mock("@/store/files", () => ({
  useFilesStore: { getState: () => mocks.files, setState: vi.fn() },
}));
vi.mock("@/store/compile", () => ({
  useCompileStore: { getState: () => ({ recompile: vi.fn(), log: "", pdfBytes: null }) },
}));
vi.mock("@/store/project-index", () => ({
  useIndexStore: { getState: () => ({ index: null, rebuildFromDisk: vi.fn() }) },
}));
vi.mock("@/lib/pdf-text", () => ({ extractPdfText: vi.fn() }));
vi.mock("@/lib/pdf-image", () => ({ pdfPageToPng: vi.fn() }));
vi.mock("@/components/editor/cm/controller", () => ({
  getEditorView: () => mocks.editorView,
  insertAtCursor: vi.fn(),
  replaceRange: vi.fn(),
}));
vi.mock("@/lib/cross-window", () => ({ notifyProjectFilesChanged: vi.fn() }));

import enCollab from "@/i18n/locales/en/collab.json" with { type: "json" };
import { loadNamespace } from "@/i18n";
import { insertAtCursor, replaceRange } from "@/components/editor/cm/controller";
import { useCollabEditorGate } from "@/lib/collab-live-bridge";
import { createOleaflyTools } from "./ai-tools";

type Execute = (input: Record<string, unknown>) => Promise<unknown>;

function tool(name: string, options: Parameters<typeof createOleaflyTools>[0] = {}): Execute {
  const tools = createOleaflyTools(options) as unknown as Record<string, { execute: Execute }>;
  return tools[name].execute;
}

function host(): AiToolsHost {
  createOleaflyTools();
  return mocks.host as AiToolsHost;
}

function goLive(): void {
  useCollabEditorGate.setState({ projectId: "proj", viewer: false, connecting: false });
}

beforeEach(() => {
  for (const fn of Object.values(mocks.api)) fn.mockReset();
  mocks.api.collabWriteText.mockResolvedValue({ handled: true });
  mocks.api.writeFileContent.mockResolvedValue({ generation: 8 });
  mocks.files.projectId = "proj";
  mocks.files.activePath = null;
  mocks.files.files = {};
  mocks.files.applyExternalWrite.mockReset().mockReturnValue(true);
  mocks.files.prepareExternalMutation.mockReset().mockResolvedValue(4);
  mocks.files.recordMutationGeneration.mockReset();
  mocks.editorView = null;
  useCollabEditorGate.setState({ projectId: null, viewer: false, connecting: false });
});

describe("AI file tools in a live shared project", () => {
  it("replace_in_file merges from the text it read, so newer edits elsewhere survive, and never writes the disk", async () => {
    goLive();
    mocks.api.readFileContent.mockResolvedValue("alpha\nbeta\n");
    const result = await tool("replace_in_file")({ path: "a.tex", find: "beta", replace: "gamma" });
    expect(result).toEqual({ success: true, path: "a.tex", replacements: 1 });
    expect(mocks.api.collabWriteText).toHaveBeenCalledWith("proj", "a.tex", "alpha\nbeta\n", "alpha\ngamma\n");
    expect(mocks.api.writeFileContent).not.toHaveBeenCalled();
    expect(mocks.files.applyExternalWrite).toHaveBeenCalledWith("proj", "a.tex", "alpha\ngamma\n", {
      opener: "assistant",
    });
  });

  it("write_file after approval merges from the text the approval showed", async () => {
    goLive();
    mocks.api.readFileContent.mockResolvedValue("old\n");
    await tool("write_file", { confirm: async () => true })({ path: "a.tex", content: "new\n" });
    expect(mocks.api.collabWriteText).toHaveBeenCalledWith("proj", "a.tex", "old\n", "new\n");
    expect(mocks.api.writeFileContent).not.toHaveBeenCalled();
  });

  it("write_file without approval sends no base, so an older read never stands in for one", async () => {
    goLive();
    mocks.api.readFileContent.mockResolvedValue("read long ago\n");
    await tool("read_file")({ path: "a.tex" });
    await tool("write_file")({ path: "a.tex", content: "new\n" });
    expect(mocks.api.collabWriteText).toHaveBeenCalledWith("proj", "a.tex", null, "new\n");
    expect(mocks.api.writeFileContent).not.toHaveBeenCalled();
  });

  it("writes the disk when the shared document does not take the write", async () => {
    goLive();
    mocks.api.collabWriteText.mockResolvedValue({ handled: false });
    mocks.api.readFileContent.mockResolvedValue("alpha\n");
    await tool("replace_in_file")({ path: "a.tex", find: "alpha", replace: "omega" });
    expect(mocks.api.writeFileContent).toHaveBeenCalledWith("proj", "a.tex", "omega\n", 4);
    expect(mocks.files.recordMutationGeneration).toHaveBeenCalledWith("proj", 8);
  });

  it("writes the disk in a project that is not shared, as before", async () => {
    mocks.api.readFileContent.mockResolvedValue("alpha\n");
    await tool("replace_in_file")({ path: "a.tex", find: "alpha", replace: "omega" });
    expect(mocks.api.writeFileContent).toHaveBeenCalledWith("proj", "a.tex", "omega\n", 4);
    expect(mocks.api.collabWriteText).not.toHaveBeenCalled();
  });
});

describe("AI edits while a shared project goes live", () => {
  function connecting(): void {
    useCollabEditorGate.setState({ projectId: "proj", viewer: false, connecting: true });
  }

  beforeAll(async () => {
    await loadNamespace("collab");
  });

  it("write_file and replace_in_file say why and write nothing", async () => {
    connecting();
    mocks.api.readFileContent.mockResolvedValue("alpha\n");
    const replaced = await tool("replace_in_file")({ path: "a.tex", find: "alpha", replace: "omega" });
    expect(JSON.stringify(replaced)).toContain(enCollab.access.connecting);
    const written = await tool("write_file")({ path: "a.tex", content: "new\n" });
    expect(JSON.stringify(written)).toContain(enCollab.access.connecting);
    expect(mocks.api.writeFileContent).not.toHaveBeenCalled();
    expect(mocks.api.collabWriteText).not.toHaveBeenCalled();
    expect(mocks.files.applyExternalWrite).not.toHaveBeenCalled();
  });

  it("inserts and replaces nothing, in the editor or on disk, and says why", async () => {
    vi.mocked(insertAtCursor).mockClear();
    vi.mocked(replaceRange).mockClear();
    connecting();
    mocks.files.activePath = "main.tex";
    mocks.files.files = { "main.tex": { content: "a\n\\end{document}", dirty: false } };
    await expect(host().insertAtCursor("proj", "b")).rejects.toThrow(enCollab.access.connecting);
    await expect(host().replaceRange?.("proj", 0, 1, "Z")).rejects.toThrow(enCollab.access.connecting);
    mocks.editorView = {};
    await expect(host().insertAtCursor("proj", "b")).rejects.toThrow(enCollab.access.connecting);
    await expect(host().replaceRange?.("proj", 0, 1, "Z")).rejects.toThrow(enCollab.access.connecting);
    expect(vi.mocked(insertAtCursor)).not.toHaveBeenCalled();
    expect(vi.mocked(replaceRange)).not.toHaveBeenCalled();
    expect(mocks.api.writeFileContent).not.toHaveBeenCalled();
    expect(mocks.api.collabWriteText).not.toHaveBeenCalled();
  });
});

describe("AI edits to the open document without a mounted editor in a live shared project", () => {
  it("inserts at the cursor through the shared document from the text it read", async () => {
    goLive();
    mocks.files.activePath = "main.tex";
    mocks.files.files = { "main.tex": { content: "a\n\\end{document}", dirty: false } };
    await expect(host().insertAtCursor("proj", "b")).resolves.toBe(true);
    expect(mocks.api.collabWriteText).toHaveBeenCalledWith(
      "proj",
      "main.tex",
      "a\n\\end{document}",
      "a\nb\n\\end{document}",
    );
    expect(mocks.api.writeFileContent).not.toHaveBeenCalled();
    expect(mocks.files.applyExternalWrite).toHaveBeenCalledWith("proj", "main.tex", "a\nb\n\\end{document}", {
      opener: "assistant",
    });
  });

  it("replaces a range through the shared document from the text it read", async () => {
    goLive();
    mocks.files.activePath = "main.tex";
    mocks.files.files = { "main.tex": { content: "abcdef", dirty: false } };
    await expect(host().replaceRange?.("proj", 2, 4, "Z")).resolves.toBe(true);
    expect(mocks.api.collabWriteText).toHaveBeenCalledWith("proj", "main.tex", "abcdef", "abZef");
    expect(mocks.api.writeFileContent).not.toHaveBeenCalled();
  });
});
