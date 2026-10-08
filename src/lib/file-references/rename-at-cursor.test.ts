import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import enCore from "@/i18n/locales/en/core.json" with { type: "json" };
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };
import { FileConflictError } from "@/lib/tauri";
import { useFileRenameStore } from "@/store/file-rename";

const mocks = vi.hoisted(() => ({
  renameEntry: vi.fn(async (_from: string, to: string) => to),
  showLookupResult: vi.fn(),
  notifyError: vi.fn(),
  readOnly: false,
}));

const filesState = {
  projectId: "p1" as string | null,
  activePath: "main.tex" as string | null,
  mainDoc: "main.tex",
  manifestHome: "library",
  tree: [] as Array<{ path: string; is_dir: boolean }>,
  files: {},
  renameEntry: mocks.renameEntry,
};

const indexState = { texts: {} as Record<string, string> };

vi.mock("@/store/files", () => ({
  useFilesStore: { getState: () => filesState, subscribe: () => () => {} },
  onEntryRenamed: () => () => {},
}));
vi.mock("@/store/project-index", () => ({
  readProjectSources: vi.fn(),
  useIndexStore: { getState: () => indexState },
}));
vi.mock("@/store/folder-access", () => ({
  projectFolderIsReadOnly: () => mocks.readOnly,
  readOnlyFolderMessage: () => enShell.openedFolder.readOnly.banner,
}));
vi.mock("@/lib/index/nav", () => ({ showLookupResult: mocks.showLookupResult }));
vi.mock("@/lib/toast", () => ({ notifyError: mocks.notifyError }));

import {
  normalizeRenameDestination,
  pathReferenceUnderCursor,
  renameFromPrompt,
  startFileRenameAtCursor,
} from "./rename-at-cursor";

function viewAt(text: string, marker: string, offset = 0): EditorView {
  const state = EditorState.create({
    doc: text,
    selection: EditorSelection.cursor(text.indexOf(marker) + offset),
  });
  return { state } as unknown as EditorView;
}

beforeEach(() => {
  mocks.readOnly = false;
  filesState.activePath = "main.tex";
  filesState.mainDoc = "main.tex";
  filesState.tree = [
    { path: "main.tex", is_dir: false },
    { path: "figures", is_dir: true },
    { path: "figures/plot.png", is_dir: false },
    { path: "notes/a.md", is_dir: false },
    { path: "notes/img.png", is_dir: false },
  ];
  indexState.texts = {};
  useFileRenameStore.getState().close();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("startFileRenameAtCursor", () => {
  it("falls through when the caret is not on a path", () => {
    expect(startFileRenameAtCursor(viewAt("\\ref{fig:plot}", "fig"))).toBe(false);
    expect(useFileRenameStore.getState().target).toBeNull();
  });

  it("opens the rename prompt with the resolved project path", () => {
    indexState.texts = { "preamble.tex": "\\graphicspath{{figures/}}" };
    const view = viewAt("\\includegraphics{plot}", "plot", 2);
    expect(pathReferenceUnderCursor(view)?.raw).toBe("plot");
    expect(startFileRenameAtCursor(view)).toBe(true);
    expect(useFileRenameStore.getState().target).toEqual({ path: "figures/plot.png", directory: false });
  });

  it("resolves Markdown paths relative to the open file", () => {
    filesState.activePath = "notes/a.md";
    expect(startFileRenameAtCursor(viewAt("![x](img.png)", "img"))).toBe(true);
    expect(useFileRenameStore.getState().target).toEqual({ path: "notes/img.png", directory: false });
  });

  it("explains a path that names no project file", () => {
    expect(startFileRenameAtCursor(viewAt("\\input{chapters/missing}", "missing"))).toBe(true);
    expect(mocks.showLookupResult).toHaveBeenCalledWith(
      enCore.navigation.pathNotInProject.replace("{{path}}", "chapters/missing"),
    );
    expect(useFileRenameStore.getState().target).toBeNull();
  });

  it("refuses in a read-only folder", () => {
    mocks.readOnly = true;
    expect(startFileRenameAtCursor(viewAt("\\includegraphics{figures/plot}", "plot"))).toBe(true);
    expect(mocks.showLookupResult).toHaveBeenCalledWith(enShell.openedFolder.readOnly.banner);
    expect(useFileRenameStore.getState().target).toBeNull();
  });

  it("ignores files that are not LaTeX, Typst or Markdown", () => {
    filesState.activePath = "refs.bib";
    expect(startFileRenameAtCursor(viewAt("\\input{figures/plot}", "plot"))).toBe(false);
  });
});

describe("renameFromPrompt", () => {
  it("normalizes destinations and rejects paths outside the project", () => {
    expect(normalizeRenameDestination(" figures\\new/./plot.png ")).toBe("figures/new/plot.png");
    expect(normalizeRenameDestination("a/../plot.png")).toBe("plot.png");
    expect(normalizeRenameDestination("../plot.png")).toBeNull();
    expect(normalizeRenameDestination("/tmp/plot.png")).toBeNull();
    expect(normalizeRenameDestination("C:\\plot.png")).toBeNull();
    expect(normalizeRenameDestination("figures/")).toBeNull();
    expect(normalizeRenameDestination("  ")).toBeNull();
  });

  it("renames through the files store", async () => {
    await expect(renameFromPrompt("figures/plot.png", "images/plot.png")).resolves.toEqual({ status: "renamed" });
    expect(mocks.renameEntry).toHaveBeenCalledWith("figures/plot.png", "images/plot.png");
  });

  it("reports an existing destination without renaming", async () => {
    mocks.renameEntry.mockRejectedValueOnce(
      new FileConflictError({
        status: "conflict",
        destination: "images/plot.png",
        suggested_destination: "images/plot (1).png",
      } as ConstructorParameters<typeof FileConflictError>[0]),
    );
    await expect(renameFromPrompt("figures/plot.png", "images/plot.png")).resolves.toEqual({
      status: "exists",
      path: "images/plot.png",
    });
    expect(mocks.notifyError).not.toHaveBeenCalled();
  });

  it("reports other failures once", async () => {
    mocks.renameEntry.mockRejectedValueOnce(new Error("denied"));
    await expect(renameFromPrompt("figures/plot.png", "images/plot.png")).resolves.toEqual({ status: "failed" });
    expect(mocks.notifyError).toHaveBeenCalledTimes(1);
  });

  it("does not call the store for invalid or unchanged paths", async () => {
    await expect(renameFromPrompt("figures/plot.png", "../x.png")).resolves.toEqual({ status: "invalid" });
    await expect(renameFromPrompt("figures/plot.png", "figures/plot.png")).resolves.toEqual({ status: "unchanged" });
    expect(mocks.renameEntry).not.toHaveBeenCalled();
  });
});
