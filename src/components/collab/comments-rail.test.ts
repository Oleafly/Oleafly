// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";
import { commentTarget, openCommentThread, requestComment, requestCommentAt, useCommentsRail } from "./comments-rail";

const TEXT = "The quick brown fox jumps.\n   \nEnd.";
const views: EditorView[] = [];

function editor(anchor: number, head = anchor): EditorView {
  const view = new EditorView({
    state: EditorState.create({ doc: TEXT, selection: EditorSelection.single(anchor, head) }),
    parent: document.body,
  });
  views.push(view);
  return view;
}

const openFile = vi.fn(async (_path: string) => undefined);

beforeEach(() => {
  openFile.mockClear();
  useCommentsRail.setState({ visible: true, unread: false, canCompose: true, request: null, reveal: null });
  useFilesStore.setState({ projectId: "paper", activePath: "chapters/intro.tex", openFile });
  useSettingsStore.setState({ railTab: "files", showTree: false });
});

afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
  useCommentsRail.setState({ visible: false, unread: false, canCompose: false, request: null, reveal: null });
});

describe("starting a comment from the editor", () => {
  it("asks the Comments tab for a thread on the selected text and opens the tab", () => {
    expect(requestComment(editor(4, 15))).toBe(true);
    expect(useCommentsRail.getState().request).toEqual({
      path: "chapters/intro.tex",
      from: 4,
      to: 15,
      quote: "quick brown",
    });
    expect(useSettingsStore.getState().railTab).toBe("comments");
    expect(useSettingsStore.getState().showTree).toBe(true);
  });

  it("comments on the word at the caret when nothing is selected", () => {
    expect(commentTarget(editor(12))).toEqual({ path: "chapters/intro.tex", from: 10, to: 15, quote: "brown" });
  });

  it("offers nothing for blank text or when the person cannot comment", () => {
    expect(requestComment(editor(28, 30))).toBe(false);
    useCommentsRail.setState({ canCompose: false });
    expect(requestComment(editor(4, 15))).toBe(false);
    expect(requestComment(null)).toBe(false);
    expect(useCommentsRail.getState().request).toBeNull();
    expect(useSettingsStore.getState().railTab).toBe("files");
  });

  it("offers nothing while no file is open", () => {
    useFilesStore.setState({ activePath: null });
    expect(commentTarget(editor(4, 15))).toBeNull();
    expect(requestComment(editor(4, 15))).toBe(false);
  });

  it("still shows the thread in the Comments tab when its file cannot be opened", async () => {
    openFile.mockRejectedValueOnce(new Error("gone"));
    useSettingsStore.setState({ showTree: true });
    openCommentThread("deleted.tex", "thread-9");
    expect(openFile).toHaveBeenCalledWith("deleted.tex");
    expect(useCommentsRail.getState().reveal).toEqual({ path: "deleted.tex", threadId: "thread-9" });
    expect(useSettingsStore.getState()).toMatchObject({ railTab: "comments", showTree: true });
    await Promise.resolve();
  });

  it("opens another file and its thread in the Comments tab", () => {
    openCommentThread("refs.tex", "thread-1");
    expect(openFile).toHaveBeenCalledWith("refs.tex");
    expect(useCommentsRail.getState().reveal).toEqual({ path: "refs.tex", threadId: "thread-1" });
    expect(useSettingsStore.getState().railTab).toBe("comments");
    openFile.mockClear();
    openCommentThread("chapters/intro.tex", "thread-2");
    expect(openFile).not.toHaveBeenCalled();
    expect(useCommentsRail.getState().reveal).toEqual({ path: "chapters/intro.tex", threadId: "thread-2" });
  });
});

describe("starting a comment on a range in any file", () => {
  const target = { path: "refs.tex", from: 3, to: 9, quote: "Knuth" };

  it("opens the file first, then asks the Comments tab for the thread and opens the tab", async () => {
    let opened: () => void = () => undefined;
    openFile.mockImplementationOnce(
      (path: string) =>
        new Promise<undefined>((resolve) => {
          opened = () => {
            useFilesStore.setState({ activePath: path });
            resolve(undefined);
          };
        }),
    );
    const asked = requestCommentAt(target);
    expect(openFile).toHaveBeenCalledWith("refs.tex");
    expect(useCommentsRail.getState().request).toBeNull();
    expect(useSettingsStore.getState().railTab).toBe("files");
    opened();
    await expect(asked).resolves.toBe(true);
    expect(useCommentsRail.getState().request).toEqual(target);
    expect(useSettingsStore.getState()).toMatchObject({ railTab: "comments", showTree: true });
  });

  it("asks at once for a range in the open file", () => {
    void requestCommentAt({ ...target, path: "chapters/intro.tex" });
    expect(openFile).not.toHaveBeenCalled();
    expect(useCommentsRail.getState().request).toEqual({ ...target, path: "chapters/intro.tex" });
  });

  it("asks for nothing when the person can't comment or the file didn't open", async () => {
    useCommentsRail.setState({ canCompose: false });
    await expect(requestCommentAt(target)).resolves.toBe(false);
    expect(openFile).not.toHaveBeenCalled();
    useCommentsRail.setState({ canCompose: true });
    await expect(requestCommentAt(target)).resolves.toBe(false);
    expect(openFile).toHaveBeenCalledWith("refs.tex");
    expect(useCommentsRail.getState().request).toBeNull();
    openFile.mockRejectedValueOnce(new Error("gone"));
    await expect(requestCommentAt(target)).rejects.toThrow("gone");
    expect(useSettingsStore.getState().railTab).toBe("files");
  });
});
