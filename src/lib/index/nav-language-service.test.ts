import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { JsonRpcRemoteError, type LanguageServiceClient } from "@/lib/language-service";
import { activateInteractiveLanguageService } from "@/lib/analysis/interactive-language-service";
import { registerBackgroundDocumentEditor } from "@oleafly/editor";
import {
  LanguageServiceTimeoutError,
  StaleLanguageServiceResultError,
} from "@/lib/language-service/errors";
import { useFolderAccessStore } from "@/store/folder-access";
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };
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
  setRailTab: vi.fn(),
  toggleTree: vi.fn(),
  updateFile: vi.fn(),
}));

const settingsState = { showTree: true };
const clientState = {
  workspaceRoot: "/project" as string | null,
  unsupported: new Set<string>(),
};

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
  updateFile: mocks.updateFile,
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
    getState: () => ({
      setRailTab: mocks.setRailTab,
      showTree: settingsState.showTree,
      toggleTree: mocks.toggleTree,
    }),
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
    get workspaceRoot() {
      return clientState.workspaceRoot;
    },
    supports: (feature: string) => !clientState.unsupported.has(feature),
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
  filesState.projectId = "project-typst";
  filesState.files = { "main.typ": { content: MAIN, dirty: false } };
  indexState.texts = { "main.typ": MAIN, "util.typ": UTIL };
  indexState.index = null;
  indexState.intelligenceState = {
    status: "ready",
    stale: false,
    identity: { projectId: "project-typst", projectRevision: 3, requestGeneration: 7 },
  };
  settingsState.showTree = true;
  clientState.workspaceRoot = "/project";
  clientState.unsupported = new Set();
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

  it("moves files one after another and reports the moves that fail", async () => {
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
        { kind: "rename", oldUri: "file:///project/util.typ", newUri: "file:///project/helpers.typ" },
        { kind: "rename", oldUri: "file:///project/notes.typ", newUri: "file:///project/memo.typ" },
      ],
    });
    let rejectFirst: (error: Error) => void = () => {};
    mocks.renameEntry
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            rejectFirst = reject;
          }),
      )
      .mockResolvedValueOnce("memo.typ");
    const outcome = applyRename(view, sym, "helpers.typ");
    await vi.waitFor(() => expect(mocks.renameEntry).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mocks.renameEntry).toHaveBeenCalledTimes(1);
    rejectFirst(new Error("busy"));
    await expect(outcome).resolves.toBe("partial");
    expect(mocks.renameEntry.mock.calls).toEqual([
      ["util.typ", "helpers.typ"],
      ["notes.typ", "memo.typ"],
    ]);
    expect(mocks.toastError).toHaveBeenCalledWith(
      "Renamed to \"helpers.typ\" in 1 of 2 files. Could not write util.typ.",
    );
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

const WHITESPACE = MAIN.indexOf(": ") + 1;
const STALE = () =>
  new StaleLanguageServiceResultError(
    { generation: 1, projectRevision: 3, documentUri: "file:///project/main.typ", documentVersion: 1 } as never,
    "moved on",
  );

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function until(assertion: () => void): Promise<void> {
  return vi.waitFor(assertion, { interval: 1 });
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function editMainBuffer(): void {
  filesState.files = { "main.typ": { content: `${MAIN}more`, dirty: true } };
}

describe("Typst definition lookups that need a fallback", () => {
  it("falls back to the local index when the server request fails", async () => {
    mocks.requestDefinition.mockRejectedValue(new Error("crashed"));
    expect(goToDefinition(editorAt(LABEL_USE))).toBe(true);
    await until(() => expect(mocks.currentSource).toHaveBeenCalled());
  });

  it("does nothing when the server result is stale or cancelled", async () => {
    mocks.requestDefinition.mockRejectedValueOnce(STALE());
    mocks.requestDefinition.mockRejectedValueOnce(new LanguageServiceTimeoutError("textDocument/definition", 5000));
    goToDefinition(editorAt(LABEL_USE));
    goToDefinition(editorAt(LABEL_USE));
    await until(() => expect(mocks.requestDefinition).toHaveBeenCalledTimes(2));
    await flush();
    expect(mocks.currentSource).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("drops an answer that arrives after the buffer changed", async () => {
    const answer = deferred<unknown>();
    mocks.requestDefinition.mockReturnValue(answer.promise);
    goToDefinition(editorAt(GREET_USE));
    editMainBuffer();
    answer.resolve([{ uri: "file:///project/util.typ", range: range(0, 5, 10) }]);
    await flush();
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(mocks.currentSource).not.toHaveBeenCalled();
  });

  it("lists references when the only definition is the one under the caret", async () => {
    mocks.requestDefinition.mockResolvedValue([{ uri: "file:///project/main.typ", range: range(2, 1, 6) }]);
    mocks.requestReferences.mockResolvedValue([{ uri: "file:///project/util.typ", range: range(0, 5, 10) }]);
    goToDefinition(editorAt(GREET_USE));
    await until(() => expect(mocks.showReferences).toHaveBeenCalled());
    expect(mocks.showReferences.mock.calls[0][0]).toMatchObject({ mode: "references" });
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("lists several definitions in the references panel and opens the tree", async () => {
    settingsState.showTree = false;
    mocks.requestDefinition.mockResolvedValue([
      { uri: "file:///project/util.typ", range: range(0, 5, 10) },
      { uri: "file:///project/main.typ", range: range(0, 20, 25) },
    ]);
    goToDefinition(editorAt(GREET_USE));
    await until(() => expect(mocks.showReferences).toHaveBeenCalled());
    expect(mocks.showReferences.mock.calls[0][0]).toMatchObject({
      mode: "definitions",
      targetId: "",
      title: "Definitions for greet",
    });
    expect(mocks.showReferences.mock.calls[0][0].locations.map((l: { path: string }) => l.path)).toEqual([
      "util.typ",
      "main.typ",
    ]);
    expect(mocks.setRailTab).toHaveBeenCalledWith("refs");
    expect(mocks.toggleTree).toHaveBeenCalledTimes(1);
  });

  it("titles the definitions list with the first preview when the caret is between words", async () => {
    mocks.requestDefinition.mockResolvedValue([
      { uri: "file:///project/util.typ", range: range(0, 5, 10) },
      { uri: "file:///project/main.typ", range: range(0, 20, 25) },
    ]);
    goToDefinition(editorAt(WHITESPACE));
    await until(() => expect(mocks.showReferences).toHaveBeenCalled());
    expect(mocks.showReferences.mock.calls[0][0].title).toBe(`Definitions for ${UTIL.trim()}`);
  });

  it("opens the first definition directly when the panel belongs to another project", async () => {
    indexState.intelligenceState = {
      status: "ready",
      stale: false,
      identity: { projectId: "other", projectRevision: 1, requestGeneration: 1 },
    };
    mocks.requestDefinition.mockResolvedValue([
      { uri: "file:///project/util.typ", range: range(0, 5, 10) },
      { uri: "file:///project/main.typ", range: range(0, 20, 25) },
    ]);
    goToDefinition(editorAt(GREET_USE));
    await until(() => expect(mocks.navigate).toHaveBeenCalled());
    expect(mocks.navigate).toHaveBeenCalledWith({
      path: "util.typ",
      range: { from: 5, to: 10 },
      source: "editor",
    });
    expect(mocks.showReferences).not.toHaveBeenCalled();
  });

  it("opens a definition by line and column when its text is not loaded", async () => {
    mocks.requestDefinition.mockResolvedValue([{ uri: "file:///project/lib/unseen.typ", range: range(4, 2, 7) }]);
    goToDefinition(editorAt(GREET_USE));
    await until(() => expect(mocks.openLocation).toHaveBeenCalled());
    expect(mocks.openLocation).toHaveBeenCalledWith(
      { path: "lib/unseen.typ", line: 5, column: 3 },
      { pdfView: "editor" },
    );
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("reads a closed file's text from the open buffers or the index", async () => {
    filesState.files = {
      "main.typ": { content: MAIN, dirty: false },
      "notes.typ": { content: "first\nsecond line\n", dirty: false },
    };
    indexState.texts = { ...indexState.texts, "extra.typ": "alpha\nbeta gamma\n" };
    mocks.requestDefinition.mockResolvedValue([
      { uri: "file:///project/notes.typ", range: range(1, 0, 6) },
      { uri: "file:///project/extra.typ", range: range(1, 5, 10) },
    ]);
    goToDefinition(editorAt(GREET_USE));
    await until(() => expect(mocks.showReferences).toHaveBeenCalled());
    expect(mocks.showReferences.mock.calls[0][0].locations).toEqual([
      { path: "notes.typ", from: 6, to: 12, line: 2, column: 1, preview: "second line" },
      { path: "extra.typ", from: 11, to: 16, line: 2, column: 6, preview: "beta gamma" },
    ]);
  });

  it("ignores locations outside the project and falls back to the local index", async () => {
    mocks.requestDefinition.mockResolvedValue([
      { uri: "file:///elsewhere/util.typ", range: range(0, 5, 10) },
      { uri: "https://example.com/util.typ", range: range(0, 5, 10) },
    ]);
    goToDefinition(editorAt(GREET_USE));
    await until(() => expect(mocks.currentSource).toHaveBeenCalled());
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("cannot resolve any location before the server has a workspace root", async () => {
    clientState.workspaceRoot = null;
    mocks.requestDefinition.mockResolvedValue([{ uri: "file:///project/util.typ", range: range(0, 5, 10) }]);
    goToDefinition(editorAt(GREET_USE));
    await until(() => expect(mocks.currentSource).toHaveBeenCalled());
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("uses the local index for a file that is not Typst", () => {
    filesState.activePath = "main.tex";
    goToDefinition(editorAt(GREET_USE));
    expect(mocks.requestDefinition).not.toHaveBeenCalled();
    expect(mocks.currentSource).toHaveBeenCalled();
  });

  it("uses the local index when the server lacks the feature", () => {
    clientState.unsupported = new Set(["definition", "references"]);
    goToDefinition(editorAt(GREET_USE));
    findReferences(editorAt(GREET_USE));
    expect(mocks.requestDefinition).not.toHaveBeenCalled();
    expect(mocks.requestReferences).not.toHaveBeenCalled();
    expect(mocks.currentSource).toHaveBeenCalledTimes(2);
  });
});

describe("Typst reference lookups that need a fallback", () => {
  it("falls back to the local index when the server request fails", async () => {
    mocks.requestReferences.mockRejectedValue(new Error("crashed"));
    expect(findReferences(editorAt(LABEL_USE))).toBe(true);
    await until(() => expect(mocks.currentSource).toHaveBeenCalled());
  });

  it("does nothing when the server result is stale", async () => {
    mocks.requestReferences.mockRejectedValue(STALE());
    findReferences(editorAt(LABEL_USE));
    await until(() => expect(mocks.requestReferences).toHaveBeenCalled());
    await flush();
    expect(mocks.currentSource).not.toHaveBeenCalled();
    expect(mocks.showReferences).not.toHaveBeenCalled();
  });

  it("drops an answer that arrives after the buffer changed", async () => {
    const answer = deferred<unknown>();
    mocks.requestReferences.mockReturnValue(answer.promise);
    findReferences(editorAt(GREET_USE));
    editMainBuffer();
    answer.resolve([{ uri: "file:///project/util.typ", range: range(0, 5, 10) }]);
    await flush();
    expect(mocks.showReferences).not.toHaveBeenCalled();
    expect(mocks.currentSource).not.toHaveBeenCalled();
  });

  it("falls back to the local index when the server finds no references", async () => {
    mocks.requestReferences.mockResolvedValue([]);
    findReferences(editorAt(GREET_USE));
    await until(() => expect(mocks.currentSource).toHaveBeenCalled());
    expect(mocks.showReferences).not.toHaveBeenCalled();
  });

  it("titles the list with the first preview when the caret is between words", async () => {
    mocks.requestReferences.mockResolvedValue([{ uri: "file:///project/util.typ", range: range(0, 5, 10) }]);
    findReferences(editorAt(WHITESPACE));
    await until(() => expect(mocks.showReferences).toHaveBeenCalled());
    expect(mocks.showReferences.mock.calls[0][0].title).toBe(`References to ${UTIL.trim()}`);
  });
});

describe("starting a Typst rename", () => {
  async function opened(head: number): Promise<Sym> {
    expect(startRename(editorAt(head))).toBe(true);
    await until(() => expect(mocks.openRename).toHaveBeenCalled());
    return mocks.openRename.mock.calls[0][0] as Sym;
  }

  async function explained(head: number): Promise<void> {
    expect(startRename(editorAt(head))).toBe(true);
    await until(() =>
      expect(mocks.toastInfoUnique).toHaveBeenCalledWith("navigation:lookup", "This symbol cannot be renamed."),
    );
    expect(mocks.openRename).not.toHaveBeenCalled();
  }

  it("says the folder is read-only instead of asking the server", () => {
    useFolderAccessStore.setState({
      projectId: "project-typst",
      status: { read_only: true, synced_with: null },
    });
    try {
      expect(startRename(editorAt(GREET_USE))).toBe(true);
      expect(mocks.requestPrepareRename).not.toHaveBeenCalled();
      expect(mocks.openRename).not.toHaveBeenCalled();
      expect(mocks.toastInfoUnique).toHaveBeenCalledWith(
        "navigation:lookup",
        enShell.openedFolder.readOnly.banner,
      );
    } finally {
      useFolderAccessStore.getState().reset(null);
    }
  });

  it("renames the word under the caret when the server cannot prepare a rename", async () => {
    clientState.unsupported = new Set(["prepareRename"]);
    const sym = await opened(GREET_USE);
    expect(mocks.requestPrepareRename).not.toHaveBeenCalled();
    const from = MAIN.indexOf("greet(\"x\")");
    expect(sym).toMatchObject({ kind: "label", name: "greet", file: "main.typ", line: 3, from, to: from + 5 });
  });

  it("renames the word under the caret when the server asks for the default behaviour", async () => {
    mocks.requestPrepareRename.mockResolvedValue({ defaultBehavior: true });
    const sym = await opened(GREET_USE + 1);
    expect(sym).toMatchObject({ name: "greet", line: 3 });
  });

  it("accepts a bare range and takes the name from the text", async () => {
    mocks.requestPrepareRename.mockResolvedValue(range(2, 1, 6));
    const sym = await opened(GREET_USE);
    expect(sym.name).toBe("greet");
  });

  it("ignores a placeholder that is not text", async () => {
    mocks.requestPrepareRename.mockResolvedValue({ range: range(2, 1, 6), placeholder: 42 });
    const sym = await opened(GREET_USE);
    expect(sym.name).toBe("greet");
  });

  it("explains that nothing can be renamed when the server answers with no range", async () => {
    mocks.requestPrepareRename.mockResolvedValue(undefined);
    await explained(GREET_USE);
  });

  it("explains when the server answers with an array or a range away from the caret", async () => {
    mocks.requestPrepareRename.mockResolvedValueOnce([range(2, 1, 6)]);
    await explained(GREET_USE);
    mocks.toastInfoUnique.mockReset();
    mocks.requestPrepareRename.mockResolvedValueOnce({ range: range(0, 0, 3) });
    await explained(GREET_USE);
    mocks.toastInfoUnique.mockReset();
    mocks.requestPrepareRename.mockResolvedValueOnce({ range: "nowhere" });
    await explained(GREET_USE);
  });

  it("explains when the default rename has no word under the caret", async () => {
    mocks.requestPrepareRename.mockResolvedValue({ defaultBehavior: true });
    await explained(WHITESPACE);
  });

  it("falls back to the local rename when preparing fails", async () => {
    mocks.requestPrepareRename.mockRejectedValue(new Error("crashed"));
    await explained(GREET_USE);
  });

  it("opens the local rename box when the local index knows the symbol", async () => {
    const label = { kind: "label", name: "intro", file: "main.typ" };
    indexState.index = {
      symbolAt: vi.fn(() => label),
      definitionFor: vi.fn(() => label),
    };
    mocks.requestPrepareRename.mockResolvedValue(null);
    const sym = await opened(LABEL_USE);
    expect(sym).toBe(label);
    expect(mocks.toastInfoUnique).not.toHaveBeenCalled();
  });

  it("does nothing when preparing is stale or the buffer changed meanwhile", async () => {
    mocks.requestPrepareRename.mockRejectedValueOnce(STALE());
    startRename(editorAt(GREET_USE));
    await until(() => expect(mocks.requestPrepareRename).toHaveBeenCalledTimes(1));
    await flush();

    const answer = deferred<unknown>();
    mocks.requestPrepareRename.mockReturnValueOnce(answer.promise);
    startRename(editorAt(GREET_USE));
    editMainBuffer();
    answer.resolve({ placeholder: "greet", range: range(2, 1, 6) });
    await flush();

    expect(mocks.openRename).not.toHaveBeenCalled();
    expect(mocks.toastInfoUnique).not.toHaveBeenCalled();
  });
});

describe("applying a Typst rename", () => {
  async function renameTarget(): Promise<{ view: EditorView & { state: EditorState }; sym: Sym }> {
    mocks.requestPrepareRename.mockResolvedValue({ placeholder: "greet", range: range(2, 1, 6) });
    const view = editorAt(GREET_USE);
    startRename(view);
    await until(() => expect(mocks.openRename).toHaveBeenCalled());
    return { view, sym: mocks.openRename.mock.calls[0][0] as Sym };
  }

  it("says analysis is updating when the request fails for another reason", async () => {
    const { view, sym } = await renameTarget();
    mocks.requestRename.mockRejectedValue(new LanguageServiceTimeoutError("textDocument/rename", 10_000));
    await expect(applyRename(view, sym, "hello")).resolves.toBe("skipped");
    expect(mocks.toastInfoUnique).toHaveBeenCalledWith("navigation:lookup", "Project references are updating.");
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it("says analysis is updating when the buffer changed during the request", async () => {
    const { view, sym } = await renameTarget();
    mocks.requestRename.mockImplementation(async () => {
      editMainBuffer();
      return { changes: { "file:///project/util.typ": [{ range: range(0, 5, 10), newText: "hello" }] } };
    });
    await expect(applyRename(view, sym, "hello")).resolves.toBe("skipped");
    expect(mocks.toastInfoUnique).toHaveBeenCalledWith("navigation:lookup", "Project references are updating.");
    expect(mocks.writeProjectFile).not.toHaveBeenCalled();
  });

  it("reports a failure for an answer it cannot use", async () => {
    const { view, sym } = await renameTarget();
    mocks.requestRename.mockResolvedValueOnce(null);
    await expect(applyRename(view, sym, "hello")).resolves.toBe("skipped");
    mocks.requestRename.mockResolvedValueOnce({
      documentChanges: [{ kind: "create", uri: "file:///project/new.typ" }],
    });
    await expect(applyRename(view, sym, "hello")).resolves.toBe("skipped");
    clientState.workspaceRoot = null;
    mocks.requestRename.mockResolvedValueOnce({ changes: {} });
    await expect(applyRename(view, sym, "hello")).resolves.toBe("skipped");
    expect(mocks.toastError).toHaveBeenCalledTimes(3);
    expect(mocks.toastError).toHaveBeenLastCalledWith('Could not rename to "hello".');
    expect(view.dispatch).not.toHaveBeenCalled();
  });

  it("says there is nothing to rename for an empty edit", async () => {
    const { view, sym } = await renameTarget();
    mocks.requestRename.mockResolvedValue({ changes: {} });
    await expect(applyRename(view, sym, "hello")).resolves.toBe("unchanged");
    expect(mocks.toastInfo).toHaveBeenCalledWith("Nothing to rename.");
    expect(mocks.rebuildFromDisk).not.toHaveBeenCalled();
  });

  it("names the files it had to skip", async () => {
    const { view, sym } = await renameTarget();
    filesState.files = {
      "main.typ": { content: MAIN, dirty: false },
      "util.typ": { content: `${UTIL}edited`, dirty: true },
    };
    mocks.requestRename.mockResolvedValue({
      documentChanges: [
        {
          textDocument: { uri: "file:///project/main.typ", version: 1 },
          edits: [{ range: range(2, 1, 6), newText: "hello" }],
        },
        {
          textDocument: { uri: "file:///project/util.typ", version: 1 },
          edits: [{ range: range(0, 5, 10), newText: "hello" }],
        },
        {
          textDocument: { uri: "file:///outside/lib.typ", version: 1 },
          edits: [{ range: range(0, 0, 1), newText: "x" }],
        },
        {
          textDocument: { uri: "file:///project/missing.typ", version: 1 },
          edits: [{ range: range(0, 0, 1), newText: "x" }],
        },
        { kind: "rename", oldUri: "file:///project/a.typ", newUri: "file:///outside/a.typ" },
        { kind: "rename", oldUri: "file:///outside/b.typ", newUri: "file:///project/b.typ" },
      ],
    });
    await expect(applyRename(view, sym, "hello")).resolves.toBe("partial");
    expect(view.state.doc.toString()).toContain("#hello(");
    expect(mocks.writeProjectFile).not.toHaveBeenCalled();
    expect(mocks.renameEntry).not.toHaveBeenCalled();
    expect(mocks.rebuildFromDisk).toHaveBeenCalled();
    expect(mocks.toastError).toHaveBeenCalledWith(
      'Renamed to "hello" in 1 of 6 files. Could not write util.typ, file:///outside/lib.typ, missing.typ, a.typ, and file:///outside/b.typ.',
    );
  });

  it("skips a file whose edits overlap", async () => {
    const { view, sym } = await renameTarget();
    mocks.requestRename.mockResolvedValue({
      changes: {
        "file:///project/main.typ": [{ range: range(2, 1, 6), newText: "hello" }],
        "file:///project/util.typ": [
          { range: range(0, 5, 10), newText: "hello" },
          { range: range(0, 6, 9), newText: "x" },
        ],
      },
    });
    await expect(applyRename(view, sym, "hello")).resolves.toBe("partial");
    expect(mocks.writeProjectFile).not.toHaveBeenCalled();
    expect(mocks.toastError).toHaveBeenCalledWith(
      'Renamed to "hello" in 1 of 2 files. Could not write util.typ.',
    );
  });
});
