// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Transaction } from "@codemirror/state";

vi.mock("@oleafly/latex-intelligence", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@oleafly/latex-intelligence")>()),
  loadCore: async () => null,
  loadAtSuggestions: async () => null,
  loadPackageNames: async () => null,
  loadClassNames: async () => null,
}));
vi.mock("@/lib/log", () => ({ logError: vi.fn() }));

import { getEditorView } from "./cm/controller";
import { acquireEditorMutationLease } from "@/lib/editor-mutation-lease";
import { LATEX_ENGINE } from "@/lib/document-engine";
import { useFilesStore } from "@/store/files";
import { useFolderAccessStore } from "@/store/folder-access";
import { useSettingsStore } from "@/store/settings";
import { CodeMirrorEditor } from "./CodeMirrorEditor";

if (typeof Range !== "undefined" && !Range.prototype.getClientRects) {
  Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, value: () => [] });
}

const SOURCE = "\\section{Intro}\nHello.\n";

function setFolderReadOnly(readOnly: boolean | null): void {
  useFolderAccessStore.setState({
    projectId: "folder",
    status: readOnly === null ? null : { read_only: readOnly, synced_with: null },
  });
}

function view() {
  const current = getEditorView();
  if (!current) throw new Error("The editor did not mount.");
  return current;
}

function type(text: string): void {
  act(() => {
    view().dispatch({
      changes: { from: 0, insert: text },
      annotations: Transaction.userEvent.of("input.type"),
    });
  });
}

async function mount(): Promise<void> {
  render(<CodeMirrorEditor />);
  await act(async () => {});
}

beforeEach(() => {
  useSettingsStore.setState({ spellcheck: false, harper: false });
  useFilesStore.setState({
    projectId: "folder",
    manifestHome: "folder",
    engine: LATEX_ENGINE,
    engineLoaded: true,
    tree: [{ path: "main.tex", is_dir: false }],
    files: { "main.tex": { content: SOURCE, dirty: false } },
    openTabs: ["main.tex"],
    activePath: "main.tex",
  });
});

afterEach(() => {
  cleanup();
  useFolderAccessStore.getState().reset(null);
  useFilesStore.setState({ projectId: null, activePath: null, openTabs: [], files: {}, tree: [] });
});

describe("source editor in a read-only folder", () => {
  it("turns read-only as soon as the folder status arrives and ignores typing", async () => {
    setFolderReadOnly(null);
    await mount();
    expect(view().state.readOnly).toBe(false);

    act(() => setFolderReadOnly(true));

    expect(view().state.readOnly).toBe(true);
    expect(view().contentDOM.getAttribute("contenteditable")).toBe("false");
    type("typed ");
    expect(view().state.doc.toString()).toBe(SOURCE);
    expect(useFilesStore.getState().files["main.tex"]).toEqual({ content: SOURCE, dirty: false });
  });

  it("stays read-only after a project update releases its lock", async () => {
    setFolderReadOnly(true);
    await mount();
    expect(view().state.readOnly).toBe(true);

    act(() => acquireEditorMutationLease("folder").release());

    expect(view().state.readOnly).toBe(true);
    type("typed ");
    expect(view().state.doc.toString()).toBe(SOURCE);
  });

  it("becomes editable again once the folder is writable", async () => {
    setFolderReadOnly(true);
    await mount();

    act(() => setFolderReadOnly(false));

    expect(view().state.readOnly).toBe(false);
    type("typed ");
    expect(view().state.doc.toString()).toBe(`typed ${SOURCE}`);
    expect(useFilesStore.getState().files["main.tex"]?.dirty).toBe(true);
  });
});
