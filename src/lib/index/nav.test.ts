import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EditorView } from "@codemirror/view";
import type { Sym } from "./types";

const mocks = vi.hoisted(() => ({
  writeProjectFile: vi.fn(),
  setContent: vi.fn(),
  rebuildFromDisk: vi.fn(),
  renamePlan: vi.fn(),
  indexSymbolAt: vi.fn(),
  definitionFor: vi.fn(),
  updateFile: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  toastInfo: vi.fn(),
  toastInfoUnique: vi.fn(),
  toastErrorUnique: vi.fn(),
  currentSource: vi.fn(),
  accepted: vi.fn(),
  symbolAt: vi.fn(),
  definitionsForUse: vi.fn(),
  referencesFor: vi.fn(),
  navigate: vi.fn(),
  showReferences: vi.fn(),
  openRename: vi.fn(),
}));

const filesState = {
  projectId: "project-1" as string | null,
  activePath: "main.tex" as string | null,
  files: {} as Record<string, { content: string; dirty: boolean }>,
  setContent: mocks.setContent,
  writeProjectFile: mocks.writeProjectFile,
};

const indexState = {
  index: {
    renamePlan: mocks.renamePlan,
    symbolAt: mocks.indexSymbolAt,
    definitionFor: mocks.definitionFor,
  } as unknown,
  texts: {} as Record<string, string>,
  intelligenceState: { status: "not_run", stale: false } as Record<string, unknown>,
  rebuildFromDisk: mocks.rebuildFromDisk,
  updateFile: mocks.updateFile,
};

vi.mock("@/store/files", () => ({
  useFilesStore: { getState: () => ({ ...filesState }) },
}));
vi.mock("@/store/project-index", () => ({
  useIndexStore: { getState: () => ({ ...indexState }) },
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
  acceptedProjectSnapshot: mocks.accepted,
}));
vi.mock("@/lib/project-intelligence/selectors", () => ({
  symbolAt: mocks.symbolAt,
  definitionsForUse: mocks.definitionsForUse,
  referencesFor: mocks.referencesFor,
}));
vi.mock("@/lib/project-intelligence/navigation", () => ({
  navigateToProjectRange: mocks.navigate,
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

import {
  NAVIGATION_LOOKUP_TOAST_KEY,
  applyRename,
  findReferences,
  goToDefinition,
  startRename,
  symbolLikeRanges,
} from "./nav";

const EDITOR_TEXT = "See \\ref{fig:x}.";
const UPDATING = "Project references are updating.";
const UNAVAILABLE = "Project reference analysis is unavailable.";

function editorView(text = EDITOR_TEXT, head = 8): EditorView {
  const lineAt = (pos: number) => {
    const from = text.lastIndexOf("\n", pos - 1) + 1;
    const end = text.indexOf("\n", pos);
    return { from, text: text.slice(from, end === -1 ? text.length : end) };
  };
  return {
    dispatch: vi.fn(),
    state: {
      doc: { toString: () => text, lineAt },
      selection: { main: { head } },
    },
  } as unknown as EditorView;
}

function expectNoPlainToasts() {
  expect(mocks.toastInfo).not.toHaveBeenCalled();
  expect(mocks.toastError).not.toHaveBeenCalled();
}

const SYMBOL: Sym = {
  kind: "label",
  name: "fig:old",
  file: "main.tex",
  from: 0,
  to: 8,
  nameFrom: 0,
  nameTo: 8,
} as unknown as Sym;

const view = { dispatch: vi.fn() } as unknown as EditorView;

beforeEach(() => {
  for (const fn of Object.values(mocks)) fn.mockReset();
  mocks.writeProjectFile.mockResolvedValue(undefined);
  mocks.rebuildFromDisk.mockResolvedValue(undefined);
  filesState.projectId = "project-1";
  filesState.activePath = "main.tex";
  filesState.files = {};
  indexState.texts = { "chapters/intro.tex": "See \\ref{fig:old}.\n" };
  indexState.intelligenceState = { status: "not_run", stale: false };
  mocks.currentSource.mockReturnValue(null);
  mocks.accepted.mockReturnValue(null);
});

describe("applyRename", () => {
  it("writes a closed file through the files store so the tree refreshes", async () => {
    mocks.renamePlan.mockReturnValue({
      collision: false,
      fileCount: 1,
      edits: [
        { file: "chapters/intro.tex", from: 9, to: 16, newText: "fig:new" },
      ],
    });

    await applyRename(view, SYMBOL, "fig:new");

    expect(mocks.writeProjectFile).toHaveBeenCalledWith(
      "project-1",
      "chapters/intro.tex",
      "See \\ref{fig:new}.\n",
    );
    expect(mocks.setContent).not.toHaveBeenCalled();
    expect(mocks.rebuildFromDisk).toHaveBeenCalled();
  });

  it("edits an open buffer in place instead of writing it", async () => {
    filesState.files = {
      "chapters/intro.tex": { content: "See \\ref{fig:old}.\n", dirty: false },
    };
    mocks.renamePlan.mockReturnValue({
      collision: false,
      fileCount: 1,
      edits: [
        { file: "chapters/intro.tex", from: 9, to: 16, newText: "fig:new" },
      ],
    });

    await applyRename(view, SYMBOL, "fig:new");

    expect(mocks.setContent).toHaveBeenCalledWith(
      "chapters/intro.tex",
      "See \\ref{fig:new}.\n",
    );
    expect(mocks.writeProjectFile).not.toHaveBeenCalled();
  });

  it("reports a partial rename instead of claiming success", async () => {
    indexState.texts = {
      "chapters/intro.tex": "See \\ref{fig:old}.\n",
      "chapters/method.tex": "Also \\ref{fig:old}.\n",
    };
    mocks.writeProjectFile.mockRejectedValueOnce(new Error("read only"));
    mocks.renamePlan.mockReturnValue({
      collision: false,
      fileCount: 2,
      edits: [
        { file: "chapters/intro.tex", from: 9, to: 16, newText: "fig:new" },
        { file: "chapters/method.tex", from: 10, to: 17, newText: "fig:new" },
      ],
    });

    await applyRename(view, SYMBOL, "fig:new");

    expect(mocks.writeProjectFile).toHaveBeenCalledTimes(2);
    expect(mocks.rebuildFromDisk).toHaveBeenCalled();
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
    expect(mocks.toastError).toHaveBeenCalledWith(
      'Renamed to "fig:new" in 1 of 2 files. Could not write chapters/intro.tex.',
    );
  });

  it("names every file it could not write", async () => {
    indexState.texts = {
      "chapters/intro.tex": "See \\ref{fig:old}.\n",
      "chapters/method.tex": "Also \\ref{fig:old}.\n",
    };
    mocks.writeProjectFile.mockRejectedValue(new Error("read only"));
    mocks.renamePlan.mockReturnValue({
      collision: false,
      fileCount: 2,
      edits: [
        { file: "chapters/intro.tex", from: 9, to: 16, newText: "fig:new" },
        { file: "chapters/method.tex", from: 10, to: 17, newText: "fig:new" },
      ],
    });

    await applyRename(view, SYMBOL, "fig:new");

    expect(mocks.toastError).toHaveBeenCalledWith(
      'Renamed to "fig:new" in 0 of 2 files. Could not write chapters/intro.tex and chapters/method.tex.',
    );
  });

  it("counts the edits it actually applied when every write lands", async () => {
    indexState.texts = {
      "chapters/intro.tex": "See \\ref{fig:old} and \\ref{fig:old}.\n",
    };
    mocks.renamePlan.mockReturnValue({
      collision: false,
      fileCount: 1,
      edits: [
        { file: "chapters/intro.tex", from: 9, to: 16, newText: "fig:new" },
        { file: "chapters/intro.tex", from: 27, to: 34, newText: "fig:new" },
      ],
    });

    await applyRename(view, SYMBOL, "fig:new");

    expect(mocks.toastError).not.toHaveBeenCalled();
    expect(mocks.toastSuccess).toHaveBeenCalledWith(
      'Renamed to "fig:new" (2 edits in 1 file)',
    );
  });
});

describe("applyRename outcomes", () => {
  it("keeps the collision error for a name that already exists", async () => {
    mocks.renamePlan.mockReturnValue({ collision: true, fileCount: 0, edits: [] });

    await expect(applyRename(view, SYMBOL, "fig:new")).resolves.toBe("collision");
    expect(mocks.toastError).toHaveBeenCalledWith('"fig:new" already exists.');
    expect(mocks.writeProjectFile).not.toHaveBeenCalled();
  });

  it("reports each result so the caller can react", async () => {
    mocks.renamePlan.mockReturnValue({ collision: false, fileCount: 0, edits: [] });
    await expect(applyRename(view, SYMBOL, "fig:old")).resolves.toBe("unchanged");

    mocks.renamePlan.mockReturnValue({
      collision: false,
      fileCount: 1,
      edits: [
        { file: "chapters/intro.tex", from: 9, to: 16, newText: "fig:new" },
      ],
    });
    await expect(applyRename(view, SYMBOL, "fig:new")).resolves.toBe("renamed");
  });
});

describe("symbol lookups", () => {
  const snapshot = { identity: { projectId: "project-1" } };
  const use = {
    id: "use:fig",
    name: "fig:x",
    kind: "reference",
    definitionIds: [],
  };

  it("answers a missing definition under the shared lookup key", () => {
    mocks.currentSource.mockReturnValue({ snapshot, path: "main.tex" });
    mocks.symbolAt.mockReturnValue(use);
    mocks.definitionsForUse.mockReturnValue([]);

    expect(goToDefinition(editorView())).toBe(true);
    expect(goToDefinition(editorView())).toBe(true);

    expect(mocks.toastInfoUnique).toHaveBeenCalledTimes(2);
    expect(mocks.toastInfoUnique).toHaveBeenLastCalledWith(
      NAVIGATION_LOOKUP_TOAST_KEY,
      'No definition found for "fig:x"',
    );
    expectNoPlainToasts();
  });

  it("answers missing references under the same key", () => {
    const definition = {
      id: "def:fig",
      name: "fig:x",
      kind: "label",
      location: { file: "main.tex", range: { from: 0, to: 1 } },
    };
    mocks.currentSource.mockReturnValue({ snapshot, path: "main.tex" });
    mocks.symbolAt.mockReturnValue(use);
    mocks.definitionsForUse.mockReturnValue([definition]);
    mocks.referencesFor.mockReturnValue([]);

    expect(findReferences(editorView())).toBe(true);
    expect(mocks.toastInfoUnique).toHaveBeenCalledWith(
      NAVIGATION_LOOKUP_TOAST_KEY,
      'No references to "fig:x"',
    );
    expectNoPlainToasts();
  });

  it("explains failed analysis with the localized reason and never the raw failure text", () => {
    indexState.intelligenceState = {
      status: "error",
      stale: false,
      failure: {
        message: "worker exploded at /Users/private/project",
        reason: { key: "timedOut" },
      },
    };

    expect(goToDefinition(editorView())).toBe(true);
    expect(findReferences(editorView())).toBe(true);

    expect(mocks.toastErrorUnique).toHaveBeenCalledTimes(2);
    expect(mocks.toastErrorUnique).toHaveBeenCalledWith(
      NAVIGATION_LOOKUP_TOAST_KEY,
      "Project intelligence timed out.",
    );
    expectNoPlainToasts();
  });

  it("falls back to the catalog text when a failure has no reason", () => {
    indexState.intelligenceState = {
      status: "unavailable",
      stale: false,
      failure: { message: "raw backend text" },
    };

    expect(goToDefinition(editorView())).toBe(true);
    expect(mocks.toastErrorUnique).toHaveBeenCalledWith(
      NAVIGATION_LOOKUP_TOAST_KEY,
      UNAVAILABLE,
    );
  });

  it("says references are updating while analysis catches up with an edit", () => {
    indexState.intelligenceState = { status: "running", stale: false };
    expect(goToDefinition(editorView())).toBe(true);

    indexState.intelligenceState = { status: "success", stale: false };
    mocks.accepted.mockReturnValue({ fileStates: { "main.tex": {} } });
    indexState.texts = { "main.tex": "See \\ref{fig:y}." };
    expect(findReferences(editorView())).toBe(true);

    expect(mocks.toastInfoUnique).toHaveBeenCalledTimes(2);
    expect(mocks.toastInfoUnique).toHaveBeenLastCalledWith(
      NAVIGATION_LOOKUP_TOAST_KEY,
      UPDATING,
    );
    expectNoPlainToasts();
  });

  it("stays quiet while analysis updates when the caret is on plain text", () => {
    indexState.intelligenceState = { status: "running", stale: false };
    const plain = editorView("Plain prose with no symbols.", 5);

    expect(goToDefinition(plain)).toBe(false);
    expect(findReferences(plain)).toBe(false);

    expect(mocks.toastInfoUnique).not.toHaveBeenCalled();
    expectNoPlainToasts();
  });

  it("does not explain an update for a pointer lookup", () => {
    indexState.intelligenceState = { status: "running", stale: false };

    expect(goToDefinition(editorView(), "pointer")).toBe(false);

    expect(mocks.toastInfoUnique).not.toHaveBeenCalled();
    expectNoPlainToasts();
  });

  it("returns false without a toast when no analysis applies, so the caller can answer", () => {
    expect(goToDefinition(editorView())).toBe(false);
    expect(findReferences(editorView())).toBe(false);

    expect(mocks.toastInfoUnique).not.toHaveBeenCalled();
    expect(mocks.toastErrorUnique).not.toHaveBeenCalled();
    expectNoPlainToasts();
  });

  it("answers a symbol that cannot be renamed under the lookup key", () => {
    const section = { kind: "section", name: "Intro", file: "main.tex" };
    mocks.indexSymbolAt.mockReturnValue(section);
    mocks.definitionFor.mockReturnValue(section);

    expect(startRename(editorView())).toBe(true);
    expect(mocks.openRename).not.toHaveBeenCalled();
    expect(mocks.toastInfoUnique).toHaveBeenCalledWith(
      NAVIGATION_LOOKUP_TOAST_KEY,
      "This symbol cannot be renamed.",
    );
    expectNoPlainToasts();
  });
});

const SYMBOL_LIKE_TABLE: ReadonlyArray<readonly [string, ReadonlyArray<readonly [number, number]>]> = [
  ["\\ref", [[0, 4]]],
  ["\\Ref", [[0, 4]]],
  ["\\ref{fig:x}", [[0, 11]]],
  ["See \\ref{fig:x}.", [[4, 15]]],
  ["\\section*{Intro}", [[0, 16]]],
  ["\\ref*{x}", [[0, 8]]],
  ["\\ref**", [[0, 5]]],
  ["\\cite[p.~4]{knuth}", [[0, 18]]],
  ["\\cite[p.~4]", [[0, 11]]],
  ["\\cite[p]x", [[0, 8]]],
  ["\\includegraphics[width=\\linewidth]{a.png}", [[0, 41]]],
  ["\\ref[]{}", [[0, 8]]],
  ["\\ref{}", [[0, 6]]],
  ["\\ref{fig:x", [[0, 10]]],
  ["\\cite[p. 4", [[0, 5]]],
  ["\\ref[a]{b", [[0, 9]]],
  ["\\ref[a]}", [[0, 7]]],
  ["\\ref[{]", [[0, 7]]],
  ["\\ref{a}{b}", [[0, 7]]],
  ["\\ref[a][b]", [[0, 7]]],
  ["\\ref{a}[b]", [[0, 7]]],
  ["\\ref{\\label{x}}", [[0, 14]]],
  ["\\ref {x}", [[0, 4]]],
  ["\\ref{a\nb}", [[0, 6]]],
  ["\\cite[a\nb]{c}", [[0, 5]]],
  ["\\foo@bar", [[0, 8]]],
  ["\\makeatletter\\@author", [[0, 13], [13, 21]]],
  ["\\a@b1", [[0, 4]]],
  ["\\foo\\bar", [[0, 4], [4, 8]]],
  ["\\cite{a}\\cite{b}", [[0, 8], [8, 16]]],
  ["\\\\", []],
  ["\\\\ref", [[1, 5]]],
  ["\\1", []],
  ["\\*", []],
  ["\\_x", []],
  ["\\é", []],
  ["\\", []],
  ["@article{knuth84,", [[0, 8]]],
  ["@fig:x.y-z_1", [[0, 12]]],
  ["email@example.com", [[5, 17]]],
  ["a@b@c", [[1, 3], [3, 5]]],
  ["@", []],
  ["@@", []],
  ["@ foo", []],
  ["@é", []],
  ["<fig:x>", [[0, 7]]],
  ["<a-b.c:d_1>", [[0, 11]]],
  ["<<a>>", [[1, 4]]],
  ["<>", []],
  ["<a b>", []],
  ["<a", []],
  ["a < b > c", []],
  ["<a\\b>", [[2, 4]]],
  ["<@a>", [[1, 3]]],
  ["\\a{<b>}", [[0, 7]]],
  ["\\ref{@key} and @other <tag>", [[0, 10], [15, 21], [22, 27]]],
  ["Plain prose with no symbols.", []],
  ["", []],
];

describe("symbol-like text under the caret", () => {
  it.each(SYMBOL_LIKE_TABLE)("finds the symbol-like spans in %j", (text, ranges) => {
    expect(symbolLikeRanges(text)).toEqual(ranges);
  });

  it("explains an update only when the caret touches a span, ends included", () => {
    indexState.intelligenceState = { status: "running", stale: false };
    for (const [text, ranges] of SYMBOL_LIKE_TABLE) {
      if (text.includes("\n")) continue;
      for (let column = 0; column <= text.length; column++) {
        const touches = ranges.some(([start, end]) => column >= start && column <= end);
        expect(goToDefinition(editorView(text, column)), `${JSON.stringify(text)} at ${column}`).toBe(touches);
      }
    }
  });
});
