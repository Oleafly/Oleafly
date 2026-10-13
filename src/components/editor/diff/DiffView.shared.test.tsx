// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LATEX_ENGINE } from "@/lib/document-engine";

const mocks = vi.hoisted(() => ({
  gitShow: vi.fn(),
  readFileContent: vi.fn(),
  writeFileContent: vi.fn(),
  collabWriteText: vi.fn(),
  projectMutationGeneration: vi.fn(),
}));

vi.mock("@/lib/tauri", () => ({
  gitShow: mocks.gitShow,
  readFileContent: mocks.readFileContent,
  writeFileContent: mocks.writeFileContent,
  collabWriteText: mocks.collabWriteText,
  projectMutationGeneration: mocks.projectMutationGeneration,
  projectManifestHome: vi.fn(async () => "library"),
  mcpSetActiveProject: vi.fn(async () => {}),
  listProjects: vi.fn(async () => []),
}));
vi.mock("@/lib/log", () => ({ logError: vi.fn() }));
vi.mock("@/lib/toast", () => ({
  notifyError: vi.fn(),
  toast: {
    info: vi.fn(),
    infoUnique: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    errorUnique: vi.fn(),
    dismiss: vi.fn(),
  },
}));
vi.mock("@/lib/cross-window", () => ({ notifyProjectFilesChanged: vi.fn() }));
vi.mock("@/store/compile", () => ({
  useCompileStore: { getState: () => ({ reset: vi.fn() }) },
}));
vi.mock("@/components/editor/wysiwyg/controller", () => ({
  flushWysiwygPendingEdits: vi.fn(),
  invalidateWysiwygProjectSession: vi.fn(),
}));
vi.mock("../cm/theme", () => ({ editorTheme: () => [] }));
vi.mock("../cm/languages", () => ({ languageForPath: () => null }));

import en from "@/i18n/locales/en/editor.json" with { type: "json" };
import { useCollabEditorGate } from "@/lib/collab-live-bridge";
import { useDiffStore } from "@/store/diff";
import { useFilesStore } from "@/store/files";
import { useFolderAccessStore } from "@/store/folder-access";
import { DiffView } from "./DiffView";

const INDEX = "Intro\n";
let shared = INDEX;

function sharedMerge(base: string | null, text: string): string {
  if (base === shared) return text;
  return shared;
}

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

function goLive(gate: { viewer?: boolean; connecting?: boolean } = {}): void {
  useCollabEditorGate.setState({
    projectId: "project",
    viewer: gate.viewer ?? false,
    connecting: gate.connecting ?? false,
  });
}

function collaboratorTypes(text: string): void {
  shared = text;
  useFilesStore.setState((state) => ({
    files: { ...state.files, "main.tex": { ...state.files["main.tex"], content: text } },
  }));
}

function typeInDiff(text: string): void {
  const view = editableView();
  view.dispatch({ changes: { from: 0, insert: text }, userEvent: "input.type" });
}

async function openWorkingDiff(path = "main.tex"): Promise<void> {
  useDiffStore.getState().openDiff(path, "working");
  render(<DiffView />);
  await waitFor(() => expect(sideText("a")).toBe(INDEX));
}

beforeEach(async () => {
  useCollabEditorGate.setState({ projectId: null, viewer: false, connecting: false });
  await useFilesStore.getState().closeProject();
  for (const fn of Object.values(mocks)) fn.mockReset();
  shared = INDEX;
  mocks.gitShow.mockResolvedValue(INDEX);
  mocks.readFileContent.mockResolvedValue(INDEX);
  mocks.projectMutationGeneration.mockResolvedValue(3);
  mocks.writeFileContent.mockResolvedValue({ generation: 9 });
  mocks.collabWriteText.mockImplementation(async (_project: string, _path: string, base: string | null, text: string) => {
    shared = sharedMerge(base, text);
    return { handled: true };
  });
  useFolderAccessStore.getState().reset(null);
  useDiffStore.setState({ diffs: [], activeKey: null, mode: "split" });
  useFilesStore.setState({
    projectId: "project",
    projectName: "Paper",
    mainDoc: "main.tex",
    engine: LATEX_ENGINE,
    engineLoaded: true,
    manifestHome: "library",
    tree: [
      { path: "main.tex", is_dir: false },
      { path: "project.json", is_dir: false },
    ],
    files: { "main.tex": { content: INDEX, dirty: false, edits: 0 } },
    openTabs: [],
    activePath: "main.tex",
  });
});
afterEach(cleanup);

describe("the git diff view in a live shared project", () => {
  it("never saves over text a collaborator typed after the diff was opened", async () => {
    goLive();
    await openWorkingDiff();
    expect(sideText("b")).toBe(INDEX);

    act(() => collaboratorTypes("Intro\nCarol 0\n"));
    act(() => typeInDiff("Admin "));
    await useFilesStore.getState().saveFile("main.tex");

    expect(shared).toContain("Carol 0");
    expect(useFilesStore.getState().files["main.tex"].content).toContain("Carol 0");
    for (const call of mocks.collabWriteText.mock.calls) expect(call[3]).toContain("Carol 0");
    expect(mocks.writeFileContent).not.toHaveBeenCalled();
  });

  it("is read-only and says to make changes in the editor", async () => {
    goLive();
    await openWorkingDiff();

    expect(editableView().state.readOnly).toBe(true);
    expect(screen.getByText(en.diff.sharedReadOnly)).toBeInTheDocument();
  });

  it("turns read-only in place when the project goes live while the diff is open", async () => {
    await openWorkingDiff();
    const editable = editableView();
    expect(editable.state.readOnly).toBe(false);

    act(() => goLive());

    expect(editableView()).toBe(editable);
    expect(editable.state.readOnly).toBe(true);
    act(() => typeInDiff("Admin "));
    expect(editable.state.doc.toString()).toBe(INDEX);
    expect(useFilesStore.getState().files["main.tex"].dirty).toBe(false);
    expect(screen.getByText(en.diff.sharedReadOnly)).toBeInTheDocument();
  });

  it("becomes editable again when the project stops being shared", async () => {
    goLive();
    await openWorkingDiff();
    const editable = editableView();

    act(() => useCollabEditorGate.setState({ projectId: null, viewer: false, connecting: false }));

    expect(editableView()).toBe(editable);
    expect(editable.state.readOnly).toBe(false);
    expect(screen.queryByText(en.diff.sharedReadOnly)).toBeNull();
    act(() => typeInDiff("Mine "));
    expect(useFilesStore.getState().files["main.tex"]).toMatchObject({ content: "Mine Intro\n", dirty: true });
  });
});

describe("the git diff view for someone who may not edit the shared project", () => {
  it("keeps a viewer's edit out of their buffer and their disk", async () => {
    goLive({ viewer: true });
    await openWorkingDiff();

    act(() => typeInDiff("Viewer "));
    await useFilesStore.getState().saveFile("main.tex");

    expect(editableView().state.readOnly).toBe(true);
    expect(editableView().state.doc.toString()).toBe(INDEX);
    expect(useFilesStore.getState().files["main.tex"]).toMatchObject({ content: INDEX, dirty: false });
    expect(mocks.writeFileContent).not.toHaveBeenCalled();
    expect(mocks.collabWriteText).not.toHaveBeenCalled();
    expect(screen.getByText(en.diff.viewerReadOnly)).toBeInTheDocument();
  });

  it("takes no edits while the shared project is still connecting", async () => {
    goLive({ connecting: true });
    await openWorkingDiff();

    act(() => typeInDiff("Early "));
    await useFilesStore.getState().saveFile("main.tex");

    expect(editableView().state.readOnly).toBe(true);
    expect(useFilesStore.getState().files["main.tex"]).toMatchObject({ content: INDEX, dirty: false });
    expect(mocks.writeFileContent).not.toHaveBeenCalled();
    expect(mocks.collabWriteText).not.toHaveBeenCalled();
  });

  it("turns read-only in place when an editor becomes a viewer", async () => {
    goLive();
    await openWorkingDiff();
    const editable = editableView();
    expect(screen.getByText(en.diff.sharedReadOnly)).toBeInTheDocument();

    act(() => useCollabEditorGate.setState({ viewer: true }));

    expect(editableView()).toBe(editable);
    expect(editable.state.readOnly).toBe(true);
    expect(screen.getByText(en.diff.viewerReadOnly)).toBeInTheDocument();
  });
});

describe("the git diff view of a file Oleafly manages", () => {
  it("opens read-only like the editor does", async () => {
    useFilesStore.setState((state) => ({
      files: { ...state.files, "project.json": { content: INDEX, dirty: false, edits: 0 } },
    }));
    await openWorkingDiff("project.json");

    act(() => typeInDiff("{} "));

    expect(editableView().state.readOnly).toBe(true);
    expect(editableView().state.doc.toString()).toBe(INDEX);
    expect(useFilesStore.getState().files["project.json"].dirty).toBe(false);
  });
});
