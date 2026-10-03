import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { JsonRpcRemoteError, type LanguageServiceClient } from "@/lib/language-service";
import { activateInteractiveLanguageService } from "@/lib/analysis/interactive-language-service";
import { registerBackgroundDocumentEditor } from "@oleafly/editor";
import type { Sym } from "./types";

const mocks = vi.hoisted(() => ({
  writeProjectFile: vi.fn(),
  setContent: vi.fn(),
  renameEntry: vi.fn(),
  rebuildFromDisk: vi.fn(),
  navigate: vi.fn(),
  openLocation: vi.fn(),
  showReferences: vi.fn(),
  openRename: vi.fn(),
  currentSource: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  toastInfo: vi.fn(),
  toastInfoUnique: vi.fn(),
  toastErrorUnique: vi.fn(),
  requestDefinition: vi.fn(),
  requestReferences: vi.fn(),
  requestPrepareRename: vi.fn(),
  requestRename: vi.fn(),
}));

const MAIN = "#import \"util.typ\": greet\n= Intro <intro>\n#greet(\"x\") see @intro.\n";
const UTIL = "#let greet(name) = [Hello #name]\n";

const filesState = {
  projectId: "project-typst" as string | null,
  activePath: "main.typ" as string | null,
  manifestHome: "library",
  tree: [] as Array<{ path: string; is_dir: boolean }>,
  files: {} as Record<string, { content: string; dirty: boolean }>,
  setContent: mocks.setContent,
  writeProjectFile: mocks.writeProjectFile,
  renameEntry: mocks.renameEntry,
};

const indexState = {
  index: null as unknown,
  texts: {} as Record<string, string>,
  intelligenceState: {
    status: "ready",
    stale: false,
    identity: { projectId: "project-typst", projectRevision: 3, requestGeneration: 7 },
  } as Record<string, unknown>,
  rebuildFromDisk: mocks.rebuildFromDisk,
  updateFile: vi.fn(),
};

vi.mock("@/store/files", () => ({
  useFilesStore: { getState: () => filesState },
}));
vi.mock("@/store/project-index", () => ({
  useIndexStore: { getState: () => indexState },
}));
vi.mock("@/store/references", () => ({
  useReferencesStore: { getState: () => ({ show: mocks.showReferences }) },
}));
vi.mock("@/store/rename", () => ({
  useRenameStore: { getState: () => ({ open: mocks.openRename }) },
}));
vi.mock("@/store/settings", () => ({
  useSettingsStore: {
    getState: () => ({ setRailTab: vi.fn(), showTree: true, toggleTree: vi.fn() }),
  },
}));
vi.mock("@/lib/project-intelligence/current", () => ({
  currentSourceProjectIntelligence: mocks.currentSource,
  acceptedProjectSnapshot: () => null,
}));
vi.mock("@/lib/project-intelligence/navigation", () => ({
  navigateToProjectRange: mocks.navigate,
}));
vi.mock("@/lib/open-location", () => ({
  openProjectLocation: mocks.openLocation,
}));
vi.mock("@/lib/toast", () => ({
  toast: {
    success: mocks.toastSuccess,
    error: mocks.toastError,
    info: mocks.toastInfo,
    infoUnique: mocks.toastInfoUnique,
    errorUnique: mocks.toastErrorUnique,
  },
}));

import { applyRename, findReferences, goToDefinition, renamePreview, startRename } from "./nav";

const range = (line: number, from: number, to: number) => ({
  start: { line, character: from },
  end: { line, character: to },
});

function fakeClient(): LanguageServiceClient {
  return {
    generation: 1,
    workspaceRoot: "/project",
    supports: () => true,
    requestDefinition: mocks.requestDefinition,
    requestReferences: mocks.requestReferences,
    requestPrepareRename: mocks.requestPrepareRename,
    requestRename: mocks.requestRename,
  } as unknown as LanguageServiceClient;
}

let deactivate: (() => void) | null = null;

function activateSession(): void {
  const documents: Record<string, string> = { "main.typ": MAIN, "util.typ": UTIL };
  deactivate = activateInteractiveLanguageService({
    owner: {},
    projectId: "project-typst",
    projectRevision: 3,
    kind: "tinymist",
    positionEncoding: "utf-16",
    client: fakeClient(),
    documentForPath: (path) =>
      documents[path] === undefined
        ? null
        : {
            path,
            uri: `file:///project/${path}`,
            text: documents[path],
            version: 1,
          },
  });
}

function editorAt(head: number): EditorView & { state: EditorState } {
  const view = {
    state: EditorState.create({ doc: MAIN, selection: { anchor: head } }),
    dispatch: vi.fn((spec: Parameters<EditorState["update"]>[0]) => {
      view.state = view.state.update(spec).state;
    }),
  };
  return view as unknown as EditorView & { state: EditorState };
}

const GREET_USE = MAIN.indexOf("greet(\"x\")") + 2;
const LABEL_USE = MAIN.indexOf("@intro") + 2;

beforeEach(() => {
  for (const fn of Object.values(mocks)) fn.mockReset();
  mocks.writeProjectFile.mockResolvedValue(undefined);
  mocks.rebuildFromDisk.mockResolvedValue(undefined);
  mocks.renameEntry.mockResolvedValue("chap.typ");
  mocks.setContent.mockReturnValue(true);
  mocks.currentSource.mockReturnValue(null);
  filesState.activePath = "main.typ";
  filesState.files = { "main.typ": { content: MAIN, dirty: false } };
  indexState.texts = { "main.typ": MAIN, "util.typ": UTIL };
  activateSession();
});

afterEach(() => {
  deactivate?.();
  deactivate = null;
});

describe("Typst navigation through Tinymist", () => {
  it("goes to a #let definition in another file", async () => {
    mocks.requestDefinition.mockResolvedValue([
      {
        targetUri: "file:///project/util.typ",
        targetRange: range(0, 0, 33),
        targetSelectionRange: range(0, 5, 10),
      },
    ]);
    expect(goToDefinition(editorAt(GREET_USE))).toBe(true);
    await vi.waitFor(() => expect(mocks.navigate).toHaveBeenCalled());
    expect(mocks.requestDefinition.mock.calls[0][0]).toEqual({
      textDocument: { uri: "file:///project/main.typ" },
      position: { line: 2, character: 3 },
    });
    expect(mocks.navigate).toHaveBeenCalledWith({
      path: "util.typ",
      range: { from: 5, to: 10 },
      source: "editor",
    });
    expect(mocks.currentSource).not.toHaveBeenCalled();
  });

  it("falls back to the local index when the server finds nothing", async () => {
    mocks.requestDefinition.mockResolvedValue(null);
    goToDefinition(editorAt(LABEL_USE));
    await vi.waitFor(() => expect(mocks.currentSource).toHaveBeenCalled());
  });

  it("uses the local index while the server is not ready", () => {
    deactivate?.();
    deactivate = null;
    goToDefinition(editorAt(GREET_USE));
    expect(mocks.requestDefinition).not.toHaveBeenCalled();
    expect(mocks.currentSource).toHaveBeenCalled();
  });

  it("lists references across files in the references panel", async () => {
    mocks.requestReferences.mockResolvedValue([
      { uri: "file:///project/util.typ", range: range(0, 5, 10) },
      { uri: "file:///project/main.typ", range: range(0, 20, 25) },
      { uri: "file:///project/main.typ", range: range(2, 1, 6) },
    ]);
    expect(findReferences(editorAt(GREET_USE))).toBe(true);
    await vi.waitFor(() => expect(mocks.showReferences).toHaveBeenCalled());
    const query = mocks.showReferences.mock.calls[0][0];
    expect(query).toMatchObject({
      projectId: "project-typst",
      projectRevision: 3,
      requestGeneration: 7,
      mode: "references",
      title: "References to greet",
    });
    expect(query.locations).toEqual([
      { path: "util.typ", from: 5, to: 10, line: 1, column: 6, preview: UTIL.trim() },
      {
        path: "main.typ",
        from: 20,
        to: 25,
        line: 1,
        column: 21,
        preview: "#import \"util.typ\": greet",
      },
      {
        path: "main.typ",
        from: MAIN.indexOf("greet(\"x\")"),
        to: MAIN.indexOf("greet(\"x\")") + 5,
        line: 3,
        column: 2,
        preview: "#greet(\"x\") see @intro.",
      },
    ]);
    expect(mocks.requestReferences.mock.calls[0][0].context).toEqual({
      includeDeclaration: true,
    });
  });
});

describe("Typst rename through Tinymist", () => {
  async function prepare(head: number): Promise<Sym> {
    expect(startRename(editorAt(head))).toBe(true);
    await vi.waitFor(() => expect(mocks.openRename).toHaveBeenCalled());
    return mocks.openRename.mock.calls[0][0] as Sym;
  }

  it("opens the rename box with the server's placeholder and no local preview", async () => {
    mocks.requestPrepareRename.mockResolvedValue({
      placeholder: "greet",
      range: range(2, 1, 6),
    });
    const sym = await prepare(GREET_USE);
    expect(sym).toMatchObject({ name: "greet", file: "main.typ" });
    expect(renamePreview({ renamePlan: vi.fn() } as never, sym, "hello")).toBeNull();
  });

  it("applies a workspace edit to the open editor and to closed files", async () => {
    mocks.requestPrepareRename.mockResolvedValue({
      placeholder: "greet",
      range: range(2, 1, 6),
    });
    const view = editorAt(GREET_USE);
    startRename(view);
    await vi.waitFor(() => expect(mocks.openRename).toHaveBeenCalled());
    const sym = mocks.openRename.mock.calls[0][0] as Sym;
    mocks.requestRename.mockResolvedValue({
      changes: {
        "file:///project/main.typ": [
          { range: range(0, 20, 25), newText: "hello" },
          { range: range(2, 1, 6), newText: "hello" },
        ],
        "file:///project/util.typ": [{ range: range(0, 5, 10), newText: "hello" }],
      },
    });

    await expect(applyRename(view, sym, "hello")).resolves.toBe("renamed");
    expect(mocks.requestRename.mock.calls[0][0]).toMatchObject({ newName: "hello" });
    expect(view.state.doc.toString()).toBe(
      MAIN.replace("greet\n", "hello\n").replace("#greet(", "#hello("),
    );
    expect(view.dispatch).toHaveBeenCalledTimes(1);
    expect(mocks.writeProjectFile).toHaveBeenCalledWith(
      "project-typst",
      "util.typ",
      "#let hello(name) = [Hello #name]\n",
    );
    expect(mocks.rebuildFromDisk).toHaveBeenCalled();
    expect(mocks.toastSuccess).toHaveBeenCalled();
  });

  async function renameGreetEverywhere(): Promise<{ view: EditorView & { state: EditorState }; sym: Sym }> {
    mocks.requestPrepareRename.mockResolvedValue({
      placeholder: "greet",
      range: range(2, 1, 6),
    });
    const view = editorAt(GREET_USE);
    startRename(view);
    await vi.waitFor(() => expect(mocks.openRename).toHaveBeenCalled());
    mocks.requestRename.mockResolvedValue({
      changes: {
        "file:///project/main.typ": [
          { range: range(0, 20, 25), newText: "hello" },
          { range: range(2, 1, 6), newText: "hello" },
        ],
        "file:///project/util.typ": [{ range: range(0, 5, 10), newText: "hello" }],
      },
    });
    return { view, sym: mocks.openRename.mock.calls[0][0] as Sym };
  }

  it("records the edit in an open background tab so its undo history survives", async () => {
    filesState.files = {
      "main.typ": { content: MAIN, dirty: false },
      "util.typ": { content: UTIL, dirty: false },
    };
    const background = vi.fn((_path: string, _base: string, _changes: readonly unknown[]) => true);
    const unregister = registerBackgroundDocumentEditor(background);
    try {
      const { view, sym } = await renameGreetEverywhere();
      await expect(applyRename(view, sym, "hello")).resolves.toBe("renamed");
      expect(mocks.setContent).toHaveBeenCalledWith(
        "util.typ",
        "#let hello(name) = [Hello #name]\n",
      );
      expect(background).toHaveBeenCalledWith("util.typ", UTIL, [
        { from: 5, to: 10, insert: "hello" },
      ]);
      expect(mocks.setContent.mock.invocationCallOrder[0]).toBeLessThan(
        background.mock.invocationCallOrder[0],
      );
      expect(mocks.writeProjectFile).not.toHaveBeenCalled();
    } finally {
      unregister();
    }
  });

  it("leaves the background tab alone when the files store refuses the edit", async () => {
    filesState.files = {
      "main.typ": { content: MAIN, dirty: false },
      "util.typ": { content: UTIL, dirty: false },
    };
    mocks.setContent.mockReturnValue(false);
    const background = vi.fn(() => true);
    const unregister = registerBackgroundDocumentEditor(background);
    try {
      const { view, sym } = await renameGreetEverywhere();
      await expect(applyRename(view, sym, "hello")).resolves.toBe("partial");
      expect(background).not.toHaveBeenCalled();
    } finally {
      unregister();
    }
  });

  it("moves a renamed include through the files store", async () => {
    mocks.requestPrepareRename.mockResolvedValue({
      placeholder: "util.typ",
      range: range(0, 8, 18),
    });
    const view = editorAt(10);
    startRename(view);
    await vi.waitFor(() => expect(mocks.openRename).toHaveBeenCalled());
    const sym = mocks.openRename.mock.calls[0][0] as Sym;
    mocks.requestRename.mockResolvedValue({
      documentChanges: [
        {
          textDocument: { uri: "file:///project/main.typ", version: null },
          edits: [{ range: range(0, 8, 18), newText: "\"helpers.typ\"" }],
        },
        {
          kind: "rename",
          oldUri: "file:///project/util.typ",
          newUri: "file:///project/helpers.typ",
        },
      ],
    });
    await expect(applyRename(view, sym, "helpers.typ")).resolves.toBe("renamed");
    expect(view.state.doc.toString().startsWith("#import \"helpers.typ\"")).toBe(true);
    expect(mocks.renameEntry).toHaveBeenCalledWith("util.typ", "helpers.typ");
  });

  it("reports a rename the server refuses", async () => {
    mocks.requestPrepareRename.mockResolvedValue({
      placeholder: "greet",
      range: range(2, 1, 6),
    });
    const view = editorAt(GREET_USE);
    startRename(view);
    await vi.waitFor(() => expect(mocks.openRename).toHaveBeenCalled());
    const sym = mocks.openRename.mock.calls[0][0] as Sym;
    mocks.requestRename.mockRejectedValue(
      new JsonRpcRemoteError({ code: -32602, message: "invalid name" }),
    );
    await expect(applyRename(view, sym, "1bad")).resolves.toBe("skipped");
    expect(mocks.toastError).toHaveBeenCalledWith("Could not rename to \"1bad\".");
    expect(view.dispatch).not.toHaveBeenCalled();
  });

  it("falls back to the local rename when the server cannot rename here", async () => {
    mocks.requestPrepareRename.mockResolvedValue(null);
    startRename(editorAt(GREET_USE));
    await vi.waitFor(() => expect(mocks.toastInfoUnique).toHaveBeenCalled());
    expect(mocks.openRename).not.toHaveBeenCalled();
  });
});
