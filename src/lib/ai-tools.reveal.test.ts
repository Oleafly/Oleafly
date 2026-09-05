// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  filesState: {
    projectId: "proj" as string | null,
    activePath: null as string | null,
    engineLoaded: true,
    engine: { capabilities: { supports_synctex: false } },
    files: {} as Record<string, { content: string; dirty: boolean }>,
    openFile: vi.fn(async (path: string) => {
      mocks.filesState.activePath = path;
    }),
  },
  compileState: { pdfBytes: null as Uint8Array | null },
  gotoLine: vi.fn(),
  editorView: null as { contentDOM: HTMLElement } | null,
  waitForEditorDocument: vi.fn(async (_path: string) => ({}) as unknown),
  gotoPdfPage: vi.fn(async () => true),
  forwardFromCursor: vi.fn(async () => {}),
}));

vi.mock("@/lib/tauri", () => ({
  readFileContent: vi.fn(),
  writeFileContent: vi.fn(),
  createFile: vi.fn(),
  deleteFile: vi.fn(),
  renameFile: vi.fn(),
  projectMutationGeneration: vi.fn(),
  listFiles: vi.fn(),
  searchProject: vi.fn(),
  compileIsolated: vi.fn(),
  readIsolatedPdf: vi.fn(),
  readProjectBytes: vi.fn(),
  writeProjectBytes: vi.fn(),
  agentExec: vi.fn(),
  agentExecAuthorize: vi.fn(),
  agentExecCwd: vi.fn(),
  agentExecRegisterExternal: vi.fn(),
}));
vi.mock("@/store/files", () => ({
  useFilesStore: { getState: () => mocks.filesState, setState: vi.fn() },
}));
vi.mock("@/store/compile", () => ({
  useCompileStore: { getState: () => mocks.compileState },
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
  gotoLine: mocks.gotoLine,
  waitForEditorDocument: mocks.waitForEditorDocument,
}));
vi.mock("@/components/pdf/pdfController", () => ({ gotoPdfPage: mocks.gotoPdfPage }));
vi.mock("@/features/synctex", () => ({ forwardFromCursor: mocks.forwardFromCursor }));

import { createOleaflyTools } from "./ai-tools";
import { useSettingsStore } from "@/store/settings";

function showLocation() {
  return createOleaflyTools().show_location;
}

beforeEach(() => {
  mocks.filesState.projectId = "proj";
  mocks.filesState.activePath = null;
  mocks.filesState.engineLoaded = true;
  mocks.filesState.engine = { capabilities: { supports_synctex: false } };
  mocks.filesState.openFile.mockClear();
  mocks.compileState.pdfBytes = null;
  mocks.gotoLine.mockClear();
  mocks.editorView = null;
  mocks.waitForEditorDocument.mockClear().mockResolvedValue({});
  mocks.gotoPdfPage.mockClear().mockResolvedValue(true);
  mocks.forwardFromCursor.mockClear().mockResolvedValue(undefined);
  useSettingsStore.getState().setViewMode("split");
  document.body.innerHTML = "";
});

describe("show_location adapter", () => {
  it("opens the file and jumps to the line", async () => {
    const result = await showLocation().execute({ path: "sections/intro.tex", line: 12 });

    expect(mocks.filesState.openFile).toHaveBeenCalledWith("sections/intro.tex");
    expect(mocks.gotoLine).toHaveBeenCalledWith(12);
    expect(result).toMatchObject({ revealed: true, path: "sections/intro.tex", line: 12 });
  });

  it("opens a file with no line at the top and leaves the PDF alone", async () => {
    const result = await showLocation().execute({ path: "main.tex" });

    expect(mocks.gotoLine).toHaveBeenCalledWith(1);
    expect(mocks.gotoPdfPage).not.toHaveBeenCalled();
    expect(mocks.forwardFromCursor).not.toHaveBeenCalled();
    expect(result).toMatchObject({ revealed: true });
  });

  it("leaves keyboard focus in the chat composer", async () => {
    const composer = document.createElement("textarea");
    const editor = document.createElement("textarea");
    document.body.append(composer, editor);
    composer.focus();
    mocks.gotoLine.mockImplementation(() => editor.focus());

    await showLocation().execute({ path: "main.tex", line: 4 });

    expect(document.activeElement).toBe(composer);
  });

  it("waits for the editor to install the requested document before jumping", async () => {
    let release: (view: unknown) => void = () => {};
    mocks.waitForEditorDocument.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );

    const pending = showLocation().execute({ path: "sections/results.tex", line: 210 });
    await vi.waitFor(() =>
      expect(mocks.waitForEditorDocument).toHaveBeenCalledWith(
        "sections/results.tex",
        expect.anything(),
      ),
    );
    expect(mocks.gotoLine).not.toHaveBeenCalled();

    release({});
    const result = await pending;

    expect(mocks.gotoLine).toHaveBeenCalledWith(210);
    expect(result).toMatchObject({ revealed: true });
  });

  it("reports a reveal that the editor never took", async () => {
    mocks.waitForEditorDocument.mockResolvedValue(null);

    const result = await showLocation().execute({ path: "sections/results.tex", line: 210 });

    expect(mocks.gotoLine).not.toHaveBeenCalled();
    expect(result).toMatchObject({ error: expect.stringContaining("sections/results.tex") });
  });

  it("does not park keyboard focus in the editor when nothing was focused", async () => {
    const pane = document.createElement("div");
    pane.className = "cm-editor";
    const content = document.createElement("textarea");
    pane.append(content);
    document.body.append(pane);
    mocks.editorView = { contentDOM: content };
    mocks.gotoLine.mockImplementation(() => content.focus());

    await showLocation().execute({ path: "main.tex", line: 4 });

    expect(document.activeElement?.closest?.(".cm-editor") ?? null).toBeNull();
  });

  it("jumps the PDF to a page without touching the editor", async () => {
    const result = await showLocation().execute({ page: 3 });

    expect(mocks.gotoPdfPage).toHaveBeenCalledWith(3, 0);
    expect(mocks.filesState.openFile).not.toHaveBeenCalled();
    expect(result).toMatchObject({ revealed: true, page: 3 });
  });

  it("reports a page jump that found no preview", async () => {
    mocks.gotoPdfPage.mockResolvedValue(false);

    const result = await showLocation().execute({ page: 3 });

    expect(result).toMatchObject({ error: expect.stringContaining("PDF preview") });
  });

  it("forwards to the PDF through SyncTeX for a compiled LaTeX project", async () => {
    mocks.filesState.engine = { capabilities: { supports_synctex: true } };
    mocks.compileState.pdfBytes = new Uint8Array([1]);

    const result = await showLocation().execute({ path: "main.tex", line: 9 });

    expect(mocks.forwardFromCursor).toHaveBeenCalled();
    expect(result).toEqual({ success: true, revealed: true, path: "main.tex", line: 9 });
  });

  it("still reveals the editor line when SyncTeX fails", async () => {
    mocks.filesState.engine = { capabilities: { supports_synctex: true } };
    mocks.compileState.pdfBytes = new Uint8Array([1]);
    mocks.forwardFromCursor.mockRejectedValue(new Error("no synctex file"));

    const result = await showLocation().execute({ path: "main.tex", line: 9 });

    expect(mocks.gotoLine).toHaveBeenCalledWith(9);
    expect(result).toMatchObject({
      revealed: true,
      note: expect.stringContaining("PDF preview"),
    });
  });

  it("asks for a compile when a LaTeX project has no PDF yet", async () => {
    mocks.filesState.engine = { capabilities: { supports_synctex: true } };

    const result = await showLocation().execute({ path: "main.tex", line: 2 });

    expect(mocks.forwardFromCursor).not.toHaveBeenCalled();
    expect(result).toMatchObject({ note: expect.stringContaining("Compile") });
  });

  it("reports a file it could not open", async () => {
    mocks.filesState.openFile.mockImplementation(async () => {});

    const result = await showLocation().execute({ path: "missing.tex", line: 1 });

    expect(result).toMatchObject({ error: expect.stringContaining("missing.tex") });
  });

  it("errors when no project is open", async () => {
    mocks.filesState.projectId = null;

    expect(await showLocation().execute({ page: 1 })).toMatchObject({
      error: expect.stringContaining("No project"),
    });
  });

  it("opens the preview beside the editor when the view is editor only", async () => {
    useSettingsStore.getState().setViewMode("editor");

    await showLocation().execute({ page: 2 });

    expect(useSettingsStore.getState().viewMode).toBe("split");
    expect(mocks.gotoPdfPage).toHaveBeenCalledWith(2, 1500);
  });
});
