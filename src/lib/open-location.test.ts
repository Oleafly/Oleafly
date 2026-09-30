// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  revealEditor: vi.fn(),
  setViewMode: vi.fn(),
  viewMode: "editor" as "editor" | "split" | "pdf",
  revealSourceEditor: vi.fn(),
  waitForEditorDocument: vi.fn(),
  gotoLine: vi.fn(),
  revealEditorRange: vi.fn(),
  editorView: null as { contentDOM: HTMLElement } | null,
}));

vi.mock("@/store/files", async () => {
  const { create } = await import("zustand");
  return {
    useFilesStore: create<{
      projectId: string | null;
      activePath: string | null;
      openFile: (path: string) => Promise<void>;
    }>(() => ({ projectId: "proj", activePath: null, openFile: async () => {} })),
  };
});
vi.mock("@/store/settings", () => ({
  useSettingsStore: {
    getState: () => ({
      viewMode: mocks.viewMode,
      revealEditor: mocks.revealEditor,
      setViewMode: mocks.setViewMode,
    }),
  },
}));
vi.mock("@/components/editor/wysiwyg/controller", () => ({
  revealSourceEditor: mocks.revealSourceEditor,
}));
vi.mock("@/components/editor/cm/controller", () => ({
  waitForEditorDocument: mocks.waitForEditorDocument,
  gotoLine: mocks.gotoLine,
  revealEditorRange: mocks.revealEditorRange,
  getEditorView: () => mocks.editorView,
}));

import { useFilesStore } from "@/store/files";
import { EDITOR_DOCUMENT_WAIT_MS, openProjectLocation } from "./open-location";

const view = { state: { doc: { length: 40 } } };
const openFile = vi.fn(async (path: string) => {
  useFilesStore.setState({ activePath: path });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.editorView = null;
  mocks.viewMode = "editor";
  mocks.waitForEditorDocument.mockResolvedValue(view);
  useFilesStore.setState({ projectId: "proj", activePath: null, openFile });
  document.body.innerHTML = "";
});

afterEach(() => {
  vi.useRealTimers();
});

describe("openProjectLocation", () => {
  it("opens the file, waits for its document, then goes to the line and column", async () => {
    const ready = deferred<typeof view | null>();
    mocks.waitForEditorDocument.mockReturnValue(ready.promise);

    const opening = openProjectLocation({ path: "chapters/intro.tex", line: 12, column: 4 });
    await vi.waitFor(() =>
      expect(mocks.waitForEditorDocument).toHaveBeenCalledWith("chapters/intro.tex", expect.any(AbortSignal)),
    );
    expect(openFile).toHaveBeenCalledWith("chapters/intro.tex");
    expect(mocks.gotoLine).not.toHaveBeenCalled();

    ready.resolve(view);
    expect(await opening).toBe(true);
    expect(mocks.gotoLine).toHaveBeenCalledExactlyOnceWith(12, 4);
    expect(mocks.revealEditor).toHaveBeenCalled();
    expect(mocks.revealSourceEditor).toHaveBeenCalled();
  });

  it("passes only the line when there is no column, and line 1 when there is neither", async () => {
    await openProjectLocation({ path: "main.tex", line: 7 });
    expect(mocks.gotoLine).toHaveBeenLastCalledWith(7);
    expect(mocks.gotoLine.mock.lastCall).toHaveLength(1);

    await openProjectLocation({ path: "main.tex" });
    expect(mocks.gotoLine).toHaveBeenLastCalledWith(1);
  });

  it("does not reopen the file that is already active", async () => {
    useFilesStore.setState({ activePath: "main.tex" });
    await openProjectLocation({ path: "main.tex", line: 2 });
    expect(openFile).not.toHaveBeenCalled();
    expect(mocks.gotoLine).toHaveBeenCalledWith(2);
  });

  it("selects a character range clamped to the document", async () => {
    expect(await openProjectLocation({ path: "main.tex", range: { from: 30, to: 99 } })).toBe(true);
    expect(mocks.revealEditorRange).toHaveBeenCalledExactlyOnceWith(view, 30, 40);
    expect(mocks.gotoLine).not.toHaveBeenCalled();
  });

  it("lets a newer call cancel an older one", async () => {
    const first = deferred<typeof view | null>();
    mocks.waitForEditorDocument.mockReturnValueOnce(first.promise);

    const older = openProjectLocation({ path: "a.tex", line: 3 });
    await vi.waitFor(() => expect(mocks.waitForEditorDocument).toHaveBeenCalledTimes(1));
    const newer = openProjectLocation({ path: "b.tex", line: 9 });

    expect(await newer).toBe(true);
    first.resolve(view);
    expect(await older).toBe(false);
    expect(mocks.gotoLine).toHaveBeenCalledExactlyOnceWith(9);
  });

  it("gives up when another tab becomes active while it waits", async () => {
    const ready = deferred<typeof view | null>();
    mocks.waitForEditorDocument.mockReturnValue(ready.promise);

    const opening = openProjectLocation({ path: "a.tex", line: 3 });
    await vi.waitFor(() => expect(mocks.waitForEditorDocument).toHaveBeenCalled());
    const signal = mocks.waitForEditorDocument.mock.calls[0][1] as AbortSignal;
    useFilesStore.setState({ activePath: "other.tex" });
    expect(signal.aborted).toBe(true);

    ready.resolve(view);
    expect(await opening).toBe(false);
    expect(mocks.gotoLine).not.toHaveBeenCalled();
  });

  it("gives up when the editor never shows the document", async () => {
    vi.useFakeTimers();
    mocks.waitForEditorDocument.mockImplementation(
      (_path: string, signal: AbortSignal) =>
        new Promise((resolve) => signal.addEventListener("abort", () => resolve(null))),
    );

    const opening = openProjectLocation({ path: "a.tex", line: 3 });
    await vi.waitFor(() => expect(mocks.waitForEditorDocument).toHaveBeenCalled());
    await vi.advanceTimersByTimeAsync(EDITOR_DOCUMENT_WAIT_MS);

    expect(await opening).toBe(false);
    expect(mocks.gotoLine).not.toHaveBeenCalled();
  });

  it("opens a PDF or image without waiting for a text document", async () => {
    expect(await openProjectLocation({ path: "figures/fig1.pdf", line: 3 })).toBe(true);
    expect(openFile).toHaveBeenCalledWith("figures/fig1.pdf");
    expect(mocks.revealEditor).toHaveBeenCalled();
    expect(mocks.revealSourceEditor).not.toHaveBeenCalled();
    expect(mocks.waitForEditorDocument).not.toHaveBeenCalled();
    expect(mocks.gotoLine).not.toHaveBeenCalled();
  });

  it("leaves Visual mode alone for a file it does not render", async () => {
    expect(await openProjectLocation({ path: "scripts/plot.py", line: 4 })).toBe(true);
    expect(mocks.revealEditor).toHaveBeenCalled();
    expect(mocks.revealSourceEditor).not.toHaveBeenCalled();
    expect(mocks.gotoLine).toHaveBeenCalledWith(4);
  });

  it("switches a Markdown file to source before moving the cursor", async () => {
    mocks.gotoLine.mockImplementationOnce(() =>
      expect(mocks.revealSourceEditor).toHaveBeenCalledOnce(),
    );
    expect(await openProjectLocation({ path: "notes/README.md", line: 2 })).toBe(true);
    expect(mocks.gotoLine).toHaveBeenCalledWith(2);
  });

  it("brings the editor next to the PDF by default", async () => {
    mocks.viewMode = "pdf";
    await openProjectLocation({ path: "main.tex", line: 2 });
    expect(mocks.revealEditor).toHaveBeenCalled();
    expect(mocks.setViewMode).not.toHaveBeenCalled();
  });

  it("swaps the PDF for the editor when asked", async () => {
    mocks.viewMode = "pdf";
    await openProjectLocation({ path: "main.tex", line: 2 }, { pdfView: "editor" });
    expect(mocks.setViewMode).toHaveBeenCalledExactlyOnceWith("editor");
    expect(mocks.revealEditor).not.toHaveBeenCalled();

    vi.clearAllMocks();
    mocks.viewMode = "split";
    await openProjectLocation({ path: "main.tex", line: 2 }, { pdfView: "editor" });
    expect(mocks.setViewMode).not.toHaveBeenCalled();
    expect(mocks.revealEditor).toHaveBeenCalled();
  });

  it("reports a file that did not open", async () => {
    openFile.mockImplementationOnce(async () => {});
    expect(await openProjectLocation({ path: "missing.tex", line: 1 })).toBe(false);
    expect(mocks.waitForEditorDocument).not.toHaveBeenCalled();
  });

  it("does nothing without a project", async () => {
    useFilesStore.setState({ projectId: null });
    expect(await openProjectLocation({ path: "main.tex", line: 1 })).toBe(false);
    expect(openFile).not.toHaveBeenCalled();
    expect(mocks.revealEditor).not.toHaveBeenCalled();
  });

  it("leaves the layout alone when asked not to show the editor", async () => {
    await openProjectLocation({ path: "main.tex", line: 2 }, { showEditor: false });
    expect(mocks.revealEditor).not.toHaveBeenCalled();
    expect(mocks.revealSourceEditor).not.toHaveBeenCalled();
    expect(mocks.gotoLine).toHaveBeenCalledWith(2);
  });

  it("hands keyboard focus back when asked to keep it", async () => {
    const composer = document.createElement("textarea");
    const pane = document.createElement("div");
    pane.className = "cm-editor";
    const content = document.createElement("textarea");
    pane.append(content);
    document.body.append(composer, pane);
    mocks.editorView = { contentDOM: content };
    composer.focus();
    mocks.gotoLine.mockImplementation(() => content.focus());

    await openProjectLocation({ path: "main.tex", line: 4 }, { keepFocus: true });
    expect(document.activeElement).toBe(composer);

    mocks.gotoLine.mockImplementation(() => content.focus());
    await openProjectLocation({ path: "main.tex", line: 5 });
    expect(document.activeElement).toBe(content);
  });
});
