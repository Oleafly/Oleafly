// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import en from "@/i18n/locales/en/editor.json" with { type: "json" };
import { type DiffSide, useDiffStore } from "@/store/diff";
import { useFolderAccessStore } from "@/store/folder-access";
import { DiffView } from "./DiffView";

const mocks = vi.hoisted(() => ({ gitShow: vi.fn(), readFileContent: vi.fn() }));
const source = "Original line\nAdded line\n";
const files = {
  projectId: "diff-project",
  files: { "main.tex": { content: source } },
  setContent: vi.fn(),
};

vi.mock("@/store/files", () => ({
  useFilesStore: Object.assign(
    (selector: (state: typeof files) => unknown) => selector(files),
    { getState: () => files },
  ),
}));
vi.mock("@/lib/tauri", () => ({
  gitShow: mocks.gitShow,
  readFileContent: mocks.readFileContent,
}));
vi.mock("../cm/theme", () => ({ editorTheme: () => [] }));
vi.mock("../cm/languages", () => ({ languageForPath: () => null }));

beforeEach(() => {
  mocks.gitShow.mockReset();
  mocks.readFileContent.mockReset();
  useDiffStore.setState({ diffs: [], activeKey: null, mode: "split" });
  useFolderAccessStore.getState().reset(null);
});
afterEach(cleanup);

function editableView(): EditorView {
  const content = document.querySelector(".cm-merge-b .cm-content");
  const view = content ? EditorView.findFromDOM(content as HTMLElement) : null;
  if (!view) throw new Error("the editable side of the diff is not mounted");
  return view;
}

function sideText(side: "a" | "b") {
  const content = document.querySelector(`.cm-merge-${side} .cm-content`);
  return content ? EditorView.findFromDOM(content as HTMLElement)?.state.doc.toString() : undefined;
}

it("reloads a working diff after staging and unstaging with a fast Git backend", async () => {
  let index = "Original line\n";
  mocks.gitShow.mockImplementation(async () => index);
  useDiffStore.getState().openDiff("main.tex", "working");
  render(<DiffView />);
  await waitFor(() => expect(sideText("a")).toBe(index));
  expect(sideText("b")).toBe(source);

  index = source;
  act(() => window.dispatchEvent(new CustomEvent("oleafly:git-changed")));
  await waitFor(() => expect(sideText("a")).toBe(source));
  expect(sideText("b")).toBe(source);
  expect(document.querySelector(".cm-changedLine, .cm-changedText")).toBeNull();

  index = "Original line\n";
  act(() => window.dispatchEvent(new CustomEvent("oleafly:git-changed")));
  await waitFor(() => expect(sideText("a")).toBe(index));
  expect(sideText("b")).toBe(source);
});

it("keeps the editable working view when a git change leaves the baseline alone", async () => {
  mocks.gitShow.mockImplementation(async () => "Original line\n");
  useDiffStore.getState().openDiff("main.tex", "working");
  render(<DiffView />);
  await waitFor(() => expect(sideText("a")).toBe("Original line\n"));

  const editable = editableView();
  editable.dispatch({ selection: { anchor: 5 } });
  const calls = mocks.gitShow.mock.calls.length;

  act(() => window.dispatchEvent(new CustomEvent("oleafly:git-changed")));
  await waitFor(() => expect(mocks.gitShow.mock.calls.length).toBeGreaterThan(calls));
  await act(() => Promise.resolve());

  expect(editableView()).toBe(editable);
  expect(editable.state.selection.main.anchor).toBe(5);
});

it("opens a working diff read-only in a read-only folder", async () => {
  mocks.gitShow.mockResolvedValue("Original line\n");
  useFolderAccessStore.setState({ projectId: "diff-project", status: { read_only: true, synced_with: null } });
  useDiffStore.getState().openDiff("main.tex", "working");
  render(<DiffView />);
  await waitFor(() => expect(sideText("a")).toBe("Original line\n"));

  expect(editableView().state.readOnly).toBe(true);
});

it("follows the folder's permissions in place without rebuilding the working diff", async () => {
  mocks.gitShow.mockResolvedValue("Original line\n");
  useFolderAccessStore.setState({ projectId: "diff-project", status: { read_only: false, synced_with: null } });
  useDiffStore.getState().openDiff("main.tex", "working");
  render(<DiffView />);
  await waitFor(() => expect(sideText("a")).toBe("Original line\n"));
  const editable = editableView();
  editable.dispatch({ selection: { anchor: 5 } });
  const calls = mocks.gitShow.mock.calls.length;
  expect(editable.state.readOnly).toBe(false);

  act(() => useFolderAccessStore.setState({ status: { read_only: true, synced_with: null } }));
  expect(editableView()).toBe(editable);
  expect(editable.state.readOnly).toBe(true);

  act(() => useFolderAccessStore.getState().reset("diff-project"));
  expect(editableView()).toBe(editable);
  expect(editable.state.readOnly).toBe(true);

  act(() => useFolderAccessStore.setState({ status: { read_only: false, synced_with: null } }));
  await act(() => Promise.resolve());
  expect(editableView()).toBe(editable);
  expect(editable.state.readOnly).toBe(false);
  expect(editable.state.selection.main.anchor).toBe(5);
  expect(mocks.gitShow.mock.calls).toHaveLength(calls);
});

it("compares the file on disk with the unsaved buffer without running Git", async () => {
  mocks.readFileContent.mockResolvedValue("Their line\n");
  useDiffStore.getState().openDiff("main.tex", "disk");
  render(<DiffView />);

  await waitFor(() => expect(sideText("a")).toBe("Their line\n"));
  expect(sideText("b")).toBe(source);
  expect(mocks.readFileContent).toHaveBeenCalledWith("diff-project", "main.tex");

  act(() => window.dispatchEvent(new CustomEvent("oleafly:git-changed")));
  await act(() => Promise.resolve());
  expect(mocks.gitShow).not.toHaveBeenCalled();
});

it.each<[DiffSide, string]>([
  ["working", en.diff.workingHeading],
  ["staged", en.diff.stagedHeading],
  ["disk", en.diff.diskHeading],
])("names what a %s diff compares in its heading", async (side, heading) => {
  mocks.gitShow.mockResolvedValue("Original line\n");
  mocks.readFileContent.mockResolvedValue("Original line\n");
  useDiffStore.getState().openDiff("main.tex", side);
  render(<DiffView />);

  expect(await screen.findByText(heading)).toBeInTheDocument();
});
