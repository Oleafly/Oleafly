// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "@/i18n/locales/en/editor.json" with { type: "json" };
import { acquireEditorMutationLease } from "@/lib/editor-mutation-lease";
import { useDiffStore } from "@/store/diff";
import { useFolderAccessStore } from "@/store/folder-access";

const mocks = vi.hoisted(() => ({
  gitShow: vi.fn(),
  readFileContent: vi.fn(),
  scroll: vi.fn(),
}));

interface FilesState {
  projectId: string | null;
  files: Record<string, { content: string }>;
  tree: { path: string; is_dir: boolean }[];
  setContent: ReturnType<typeof vi.fn>;
}

const files: FilesState = {
  projectId: "diff-project",
  files: {},
  tree: [],
  setContent: vi.fn(),
};

vi.mock("@/store/files", () => ({
  useFilesStore: Object.assign(
    (selector: (state: FilesState) => unknown) => selector(files),
    { getState: () => files },
  ),
}));
vi.mock("@/lib/tauri", () => ({
  gitShow: mocks.gitShow,
  readFileContent: mocks.readFileContent,
}));
vi.mock("@oleafly/editor", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@oleafly/editor")>()),
  scrollEditorPositionLocally: mocks.scroll,
}));
vi.mock("../cm/theme", () => ({ editorTheme: () => [] }));
vi.mock("../cm/languages", () => ({ languageForPath: () => null }));

import { DiffView } from "./DiffView";

const OLD = "a\nb\nc\nd\ne\nf\ng\nh\n";
const NEW = "a\nB\nc\nd\ne\nf\nG\nh\n";

function editorIn(selector: string): EditorView {
  const content = document.querySelector(`${selector} .cm-content`);
  const view = content ? EditorView.findFromDOM(content as HTMLElement) : null;
  if (!view) throw new Error(`no editor under ${selector}`);
  return view;
}

function open(path: string, side: "working" | "staged" | "disk", content: string | null = NEW) {
  files.files = content === null ? {} : { [path]: { content } };
  files.tree = [{ path, is_dir: false }];
  useDiffStore.getState().openDiff(path, side);
  return render(<DiffView />);
}

beforeEach(() => {
  mocks.gitShow.mockReset();
  mocks.readFileContent.mockReset();
  mocks.scroll.mockReset();
  files.projectId = "diff-project";
  files.setContent.mockReset();
  useDiffStore.setState({ diffs: [], activeKey: null, mode: "split" });
  useFolderAccessStore.getState().reset(null);
});

afterEach(cleanup);

describe("what the diff cannot show", () => {
  it("renders nothing without an open diff", () => {
    const { container } = render(<DiffView />);
    expect(container).toBeEmptyDOMElement();
  });

  it("explains that binary files are not diffed", async () => {
    mocks.gitShow.mockResolvedValue("PNG");
    open("figure.png", "working", "PNG2");
    expect(await screen.findByText(en.diff.binaryNotice)).toBeInTheDocument();
    expect(document.querySelector(".cm-editor")).toBeNull();
  });

  it("treats text with a NUL byte as binary", async () => {
    mocks.gitShow.mockResolvedValue(`a${String.fromCodePoint(0)}b`);
    open("data.txt", "working");
    expect(await screen.findByText(en.diff.binaryNotice)).toBeInTheDocument();
  });

  it("refuses files over two megabytes per side", async () => {
    mocks.gitShow.mockResolvedValue("x".repeat(2_000_001));
    open("main.tex", "working");
    expect(await screen.findByText(en.diff.tooLarge)).toBeInTheDocument();
  });

  it("shows a Git failure", async () => {
    mocks.gitShow.mockRejectedValue(new Error("not a repository"));
    open("main.tex", "working");
    expect(await screen.findByText("Error: not a repository")).toBeInTheDocument();
    expect(screen.queryByText(en.diff.loading)).not.toBeInTheDocument();
  });

  it("waits for a project before loading anything", () => {
    files.projectId = null;
    open("main.tex", "working");
    expect(mocks.gitShow).not.toHaveBeenCalled();
    expect(screen.getByText(en.diff.loading)).toBeInTheDocument();
  });

  it("ignores a load that finishes after the tab closed", async () => {
    let resolve: (value: string) => void = () => {};
    mocks.gitShow.mockReturnValue(new Promise<string>((done) => { resolve = done; }));
    const { unmount } = open("main.tex", "working");
    unmount();
    await act(async () => resolve(OLD));
    expect(document.querySelector(".cm-editor")).toBeNull();
  });
});

describe("loading the new side", () => {
  it("reads the file from disk when the buffer is not open", async () => {
    mocks.gitShow.mockResolvedValue(OLD);
    mocks.readFileContent.mockResolvedValue(NEW);
    open("main.tex", "working", null);
    await waitFor(() => expect(editorIn(".cm-merge-b").state.doc.toString()).toBe(NEW));
    expect(mocks.readFileContent).toHaveBeenCalledWith("diff-project", "main.tex");
  });

  it("shows an empty new side when the file cannot be read", async () => {
    mocks.gitShow.mockResolvedValue(OLD);
    mocks.readFileContent.mockRejectedValue(new Error("gone"));
    open("main.tex", "working", null);
    await waitFor(() => expect(editorIn(".cm-merge-a").state.doc.toString()).toBe(OLD));
    expect(editorIn(".cm-merge-b").state.doc.toString()).toBe("");
  });

  it("compares the index with HEAD for a staged diff", async () => {
    mocks.gitShow.mockImplementation(async (_project: string, rev: string) => (rev === "HEAD" ? OLD : NEW));
    open("main.tex", "staged");
    await waitFor(() => expect(editorIn(".cm-merge-b").state.doc.toString()).toBe(NEW));
    expect(mocks.gitShow).toHaveBeenCalledWith("diff-project", "HEAD", "main.tex");
    expect(editorIn(".cm-merge-b").state.readOnly).toBe(true);
  });
});

describe("git changes", () => {
  it("reloads a staged diff on every Git change", async () => {
    mocks.gitShow.mockImplementation(async (_project: string, rev: string) => (rev === "HEAD" ? OLD : NEW));
    open("main.tex", "staged");
    await waitFor(() => expect(editorIn(".cm-merge-b").state.doc.toString()).toBe(NEW));
    mocks.gitShow.mockImplementation(async () => OLD);
    act(() => window.dispatchEvent(new CustomEvent("oleafly:git-changed")));
    await waitFor(() => expect(editorIn(".cm-merge-b").state.doc.toString()).toBe(OLD));
  });

  it("reloads a working diff when the index cannot be read", async () => {
    mocks.gitShow.mockResolvedValue(OLD);
    open("main.tex", "working");
    await waitFor(() => expect(editorIn(".cm-merge-a").state.doc.toString()).toBe(OLD));
    const calls = mocks.gitShow.mock.calls.length;
    mocks.gitShow.mockRejectedValueOnce(new Error("busy"));
    mocks.gitShow.mockResolvedValue("a\n");
    act(() => window.dispatchEvent(new CustomEvent("oleafly:git-changed")));
    await waitFor(() => expect(editorIn(".cm-merge-a").state.doc.toString()).toBe("a\n"));
    expect(mocks.gitShow.mock.calls.length).toBeGreaterThan(calls + 1);
  });

  it("ignores Git changes without a project or after switching tabs", async () => {
    mocks.gitShow.mockResolvedValue(OLD);
    open("main.tex", "working");
    await waitFor(() => expect(editorIn(".cm-merge-a").state.doc.toString()).toBe(OLD));
    const editable = editorIn(".cm-merge-b");

    files.projectId = null;
    const calls = mocks.gitShow.mock.calls.length;
    act(() => window.dispatchEvent(new CustomEvent("oleafly:git-changed")));
    expect(mocks.gitShow).toHaveBeenCalledTimes(calls);
    files.projectId = "diff-project";

    let resolve: (value: string) => void = () => {};
    mocks.gitShow.mockReturnValueOnce(new Promise<string>((done) => { resolve = done; }));
    act(() => window.dispatchEvent(new CustomEvent("oleafly:git-changed")));
    act(() => useDiffStore.setState({ activeKey: null }));
    await act(async () => resolve("changed\n"));
    expect(mocks.gitShow).toHaveBeenCalledTimes(calls + 1);
    expect(editable.dom.isConnected).toBe(false);
  });
});

describe("change navigation", () => {
  async function openSplit() {
    mocks.gitShow.mockResolvedValue(OLD);
    open("main.tex", "working");
    await waitFor(() => expect(editorIn(".cm-merge-a").state.doc.toString()).toBe(OLD));
    return editorIn(".cm-merge-b");
  }

  it("steps forward through the changes and wraps around", async () => {
    const view = await openSplit();
    const next = screen.getByRole("button", { name: en.diff.nextChange });
    fireEvent.click(next);
    expect(view.state.selection.main.head).toBe(2);
    expect(mocks.scroll).toHaveBeenLastCalledWith(view, 2);
    fireEvent.click(next);
    expect(view.state.selection.main.head).toBe(12);
    fireEvent.click(next);
    expect(view.state.selection.main.head).toBe(2);
  });

  it("steps backward through the changes and wraps around", async () => {
    const view = await openSplit();
    const previous = screen.getByRole("button", { name: en.diff.previousChange });
    view.dispatch({ selection: { anchor: 12 } });
    fireEvent.click(previous);
    expect(view.state.selection.main.head).toBe(2);
    fireEvent.click(previous);
    expect(view.state.selection.main.head).toBe(12);
  });

  it("starts from the right change when the cursor is past every change", async () => {
    const view = await openSplit();
    view.dispatch({ selection: { anchor: NEW.length } });
    fireEvent.click(screen.getByRole("button", { name: en.diff.nextChange }));
    expect(view.state.selection.main.head).toBe(2);
    view.dispatch({ selection: { anchor: NEW.length } });
    fireEvent.click(screen.getByRole("button", { name: en.diff.previousChange }));
    expect(view.state.selection.main.head).toBe(12);
  });

  it("stays put inside the only change and when nothing changed", async () => {
    mocks.gitShow.mockResolvedValue("a\nb\n");
    open("main.tex", "working", "a\nB\n");
    await waitFor(() => expect(editorIn(".cm-merge-a").state.doc.toString()).toBe("a\nb\n"));
    const view = editorIn(".cm-merge-b");
    view.dispatch({ selection: { anchor: 3 } });
    fireEvent.click(screen.getByRole("button", { name: en.diff.nextChange }));
    expect(view.state.selection.main.head).toBe(3);
    expect(mocks.scroll).not.toHaveBeenCalled();

    cleanup();
    useDiffStore.setState({ diffs: [], activeKey: null });
    mocks.gitShow.mockResolvedValue("same\n");
    open("other.tex", "working", "same\n");
    await waitFor(() => expect(editorIn(".cm-merge-a").state.doc.toString()).toBe("same\n"));
    fireEvent.click(screen.getByRole("button", { name: en.diff.nextChange }));
    expect(mocks.scroll).not.toHaveBeenCalled();
  });

  it("does nothing before the diff has loaded", () => {
    mocks.gitShow.mockReturnValue(new Promise(() => {}));
    open("main.tex", "working");
    fireEvent.click(screen.getByRole("button", { name: en.diff.nextChange }));
    fireEvent.click(screen.getByRole("button", { name: en.diff.previousChange }));
    expect(mocks.scroll).not.toHaveBeenCalled();
  });

  it("switches between split and unified layouts", async () => {
    await openSplit();
    fireEvent.click(screen.getByRole("button", { name: en.diff.unifiedView }));
    expect(useDiffStore.getState().mode).toBe("unified");
    await waitFor(() => expect(document.querySelector(".cm-merge-b")).toBeNull());
    await waitFor(() => expect(document.querySelector(".cm-deletedChunk")).not.toBeNull());
    const unified = editorIn(".h-full");
    fireEvent.click(screen.getByRole("button", { name: en.diff.nextChange }));
    expect(unified.state.selection.main.head).toBe(2);

    fireEvent.click(screen.getByRole("button", { name: en.diff.splitView }));
    expect(useDiffStore.getState().mode).toBe("split");
    await waitFor(() => expect(document.querySelector(".cm-merge-b")).not.toBeNull());
  });
});

describe("project updates", () => {
  async function openWorking() {
    mocks.gitShow.mockResolvedValue(OLD);
    open("main.tex", "working");
    await waitFor(() => expect(editorIn(".cm-merge-a").state.doc.toString()).toBe(OLD));
    return editorIn(".cm-merge-b");
  }

  it("locks the editable side while an update runs and reloads the file afterwards", async () => {
    const view = await openWorking();
    const lease = acquireEditorMutationLease("diff-project");
    try {
      expect(view.state.readOnly).toBe(true);
      view.dispatch({ changes: { from: 0, insert: "blocked " } });
      expect(view.state.doc.toString()).toBe(NEW);
      files.files = { "main.tex": { content: "updated\n" } };
      await lease.reconcile();
    } finally {
      lease.release();
    }
    expect(view.state.doc.toString()).toBe("updated\n");
    expect(view.state.readOnly).toBe(false);
    expect(files.setContent).not.toHaveBeenCalled();
  });

  it("keeps the view when the reloaded file is unchanged", async () => {
    const view = await openWorking();
    const lease = acquireEditorMutationLease("diff-project");
    try {
      await lease.reconcile();
    } finally {
      lease.release();
    }
    expect(view.state.doc.toString()).toBe(NEW);
  });

  it("closes the diff when the update deleted the file", async () => {
    await openWorking();
    files.tree = [];
    const lease = acquireEditorMutationLease("diff-project");
    try {
      await lease.reconcile();
    } finally {
      lease.release();
    }
    expect(useDiffStore.getState().diffs).toEqual([]);
  });

  it("reads the file again when its buffer is closed and reports a failed read", async () => {
    await openWorking();
    files.files = {};
    mocks.readFileContent.mockRejectedValue(new Error("unreadable"));
    const lease = acquireEditorMutationLease("diff-project");
    try {
      await expect(lease.reconcile()).rejects.toThrow("unreadable");
    } finally {
      lease.release();
    }
    expect(await screen.findByText(en.diff.reloadFailed)).toBeInTheDocument();
    expect(document.querySelector(".cm-merge-b")).toBeNull();
  });

  it("does not reload a read-only staged diff", async () => {
    mocks.gitShow.mockImplementation(async (_project: string, rev: string) => (rev === "HEAD" ? OLD : NEW));
    open("main.tex", "staged");
    await waitFor(() => expect(editorIn(".cm-merge-b").state.doc.toString()).toBe(NEW));
    files.tree = [];
    const lease = acquireEditorMutationLease("diff-project");
    try {
      await lease.reconcile();
    } finally {
      lease.release();
    }
    expect(useDiffStore.getState().diffs).toHaveLength(1);
  });

  it("drops a reload that lands after the project closed", async () => {
    const view = await openWorking();
    files.files = {};
    let resolve: (value: string) => void = () => {};
    mocks.readFileContent.mockReturnValue(new Promise<string>((done) => { resolve = done; }));
    const lease = acquireEditorMutationLease("diff-project");
    try {
      const pending = lease.reconcile();
      files.projectId = "other-project";
      resolve("late\n");
      await pending;
    } finally {
      lease.release();
    }
    expect(view.state.doc.toString()).toBe(NEW);
  });
});
