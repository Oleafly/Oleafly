// @vitest-environment jsdom

import { act, cleanup, render, waitFor } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useDiffStore } from "@/store/diff";
import { DiffView } from "./DiffView";

const mocks = vi.hoisted(() => ({ gitShow: vi.fn() }));
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
vi.mock("@/lib/tauri", () => ({ gitShow: mocks.gitShow, readFileContent: vi.fn() }));
vi.mock("../cm/theme", () => ({ editorTheme: () => [] }));
vi.mock("../cm/languages", () => ({ languageForPath: () => null }));

beforeEach(() => {
  mocks.gitShow.mockReset();
  useDiffStore.setState({ diffs: [], activeKey: null, mode: "split" });
});
afterEach(cleanup);

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
