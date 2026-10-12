// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Facet } from "@codemirror/state";

vi.mock("@oleafly/latex-intelligence", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@oleafly/latex-intelligence")>()),
  loadCore: async () => null,
  loadAtSuggestions: async () => null,
  loadPackageNames: async () => null,
  loadClassNames: async () => null,
}));
vi.mock("@/lib/log", () => ({ logError: vi.fn() }));

import { useCommentsRail } from "@/components/collab/comments-rail";
import { LATEX_ENGINE } from "@/lib/document-engine";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";
import { useVisualModeStore } from "@/store/visual-mode";
import { getEditorView } from "./cm/controller";
import { setCommentsEditorExtension } from "./cm/comments-slot";
import { CodeMirrorEditor } from "./CodeMirrorEditor";

if (typeof Range !== "undefined" && !Range.prototype.getClientRects) {
  Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, value: () => [] });
}

const SOURCE = "\\section{Intro}\nHello there.\n";
const marker = Facet.define<string>();

function view() {
  const current = getEditorView();
  if (!current) throw new Error("The editor did not mount.");
  return current;
}

async function mount(): Promise<void> {
  useFilesStore.setState({
    tree: [{ path: "main.tex", is_dir: false }],
    files: { "main.tex": { content: SOURCE, dirty: false } },
    openTabs: ["main.tex"],
    activePath: "main.tex",
  });
  render(<CodeMirrorEditor />);
  await act(async () => {});
}

function pressCommentChord(): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key: "m",
    code: "KeyM",
    keyCode: 77,
    ctrlKey: true,
    altKey: true,
    bubbles: true,
    cancelable: true,
  });
  act(() => {
    view().contentDOM.dispatchEvent(event);
  });
  return event;
}

beforeEach(() => {
  useVisualModeStore.setState({ enabled: false });
  useSettingsStore.setState({ spellcheck: false, harper: false, railTab: "files" });
  useFilesStore.setState({ projectId: "project", manifestHome: "library", engine: LATEX_ENGINE, engineLoaded: true });
  useCommentsRail.setState({ visible: true, canCompose: true, request: null });
});

afterEach(() => {
  cleanup();
  useCommentsRail.setState({ visible: false, canCompose: false, request: null });
  useFilesStore.setState({ projectId: null, activePath: null, openTabs: [], files: {}, tree: [] });
});

describe("comments in the source editor", () => {
  it("starts a comment on the selection with Mod-Alt-M", async () => {
    await mount();
    const start = SOURCE.indexOf("Hello");
    act(() => view().dispatch({ selection: { anchor: start, head: start + 5 } }));
    const event = pressCommentChord();
    expect(event.defaultPrevented).toBe(true);
    expect(useCommentsRail.getState().request).toEqual({ path: "main.tex", from: start, to: start + 5, quote: "Hello" });
    expect(useSettingsStore.getState().railTab).toBe("comments");
    expect(view().state.doc.toString()).toBe(SOURCE);
  });

  it("leaves the chord alone when the person cannot comment", async () => {
    useCommentsRail.setState({ canCompose: false });
    await mount();
    act(() => view().dispatch({ selection: { anchor: 16, head: 21 } }));
    const event = pressCommentChord();
    expect(event.defaultPrevented).toBe(false);
    expect(useCommentsRail.getState().request).toBeNull();
  });

  it("carries the comments extension slot", async () => {
    await mount();
    const release = setCommentsEditorExtension(marker.of("comments"));
    expect(view().state.facet(marker)).toEqual(["comments"]);
    release();
    expect(view().state.facet(marker)).toEqual([]);
  });
});
