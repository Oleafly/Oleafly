// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@oleafly/latex-intelligence", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@oleafly/latex-intelligence")>()),
  loadCore: async () => null,
  loadAtSuggestions: async () => null,
  loadPackageNames: async () => null,
  loadClassNames: async () => null,
}));
vi.mock("@/lib/log", () => ({ logError: vi.fn() }));

import { getEditorView } from "./cm/controller";
import { LATEX_ENGINE } from "@/lib/document-engine";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";
import { matchesShortcut, useShortcutStore } from "@/store/shortcuts";
import { useVisualModeStore } from "@/store/visual-mode";
import { CodeMirrorEditor } from "./CodeMirrorEditor";

if (typeof Range !== "undefined" && !Range.prototype.getClientRects) {
  Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, value: () => [] });
}

const SOURCE = "\\section{Intro}\nHello.\n";

function view() {
  const current = getEditorView();
  if (!current) throw new Error("The editor did not mount.");
  return current;
}

async function mount(path: string): Promise<void> {
  useFilesStore.setState({
    tree: [{ path, is_dir: false }],
    files: { [path]: { content: SOURCE, dirty: false } },
    openTabs: [path],
    activePath: path,
  });
  render(<CodeMirrorEditor />);
  await act(async () => {});
}

function placeCursor(pos: number): void {
  act(() => view().dispatch({ selection: { anchor: pos } }));
}

// jsdom's navigator.platform is "", so CodeMirror and matchesShortcut both
// read Mod as Ctrl here.
function pressEnter(modifiers: { ctrlKey?: boolean } = {}): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key: "Enter",
    code: "Enter",
    keyCode: 13,
    bubbles: true,
    cancelable: true,
    ...modifiers,
  });
  act(() => {
    view().contentDOM.dispatchEvent(event);
  });
  return event;
}

// Stands in for App.tsx's bubble-phase window listener, which owns the
// recompile chord.
let recompiles = 0;
function countRecompile(event: KeyboardEvent): void {
  if (matchesShortcut(event, useShortcutStore.getState().bindings.recompile)) recompiles += 1;
}

beforeEach(() => {
  recompiles = 0;
  window.addEventListener("keydown", countRecompile);
  useShortcutStore.getState().resetAll();
  useVisualModeStore.setState({ enabled: false });
  useSettingsStore.setState({ spellcheck: false, harper: false });
  useFilesStore.setState({
    projectId: "project",
    manifestHome: "library",
    engine: LATEX_ENGINE,
    engineLoaded: true,
  });
});

afterEach(() => {
  cleanup();
  window.removeEventListener("keydown", countRecompile);
  useShortcutStore.getState().resetAll();
  useVisualModeStore.setState({ enabled: false });
  useFilesStore.setState({ projectId: null, activePath: null, openTabs: [], files: {}, tree: [] });
});

describe("recompile shortcut in the source editor", () => {
  it.each(["main.tex", "notes.md"])(
    "Cmd/Ctrl+Enter in %s reaches the app's recompile handler without editing the document",
    async (path) => {
      await mount(path);
      placeCursor(5);

      const event = pressEnter({ ctrlKey: true });

      expect(recompiles).toBe(1);
      expect(event.defaultPrevented).toBe(true);
      expect(view().state.doc.toString()).toBe(SOURCE);
      expect(useFilesStore.getState().files[path]).toEqual({ content: SOURCE, dirty: false });
    },
  );

  it("leaves plain Enter to the editor", async () => {
    await mount("main.tex");
    placeCursor(SOURCE.indexOf("Hello.") + "Hello".length);

    pressEnter();

    expect(recompiles).toBe(0);
    expect(view().state.doc.toString()).toBe("\\section{Intro}\nHello\n.\n");
  });

  it("does not insert a blank line in LaTeX visual mode", async () => {
    useVisualModeStore.setState({ enabled: true });
    await mount("main.tex");
    // The visual module is a lazy import; give it time on a loaded machine.
    await waitFor(() => expect(view().dom.classList.contains("ofl-visual-parsed")).toBe(true), {
      timeout: 10_000,
    });
    placeCursor(SOURCE.indexOf("Hello."));

    pressEnter({ ctrlKey: true });

    expect(recompiles).toBe(1);
    expect(view().state.doc.toString()).toBe(SOURCE);
  });

  it("gives Mod-Enter back to the editor once recompile is bound to another chord", async () => {
    act(() => useShortcutStore.getState().setBinding("recompile", { key: "r", mod: true, shift: true }));
    await mount("main.tex");
    placeCursor(5);

    pressEnter({ ctrlKey: true });

    expect(recompiles).toBe(0);
    expect(view().state.doc.toString()).toBe("\\section{Intro}\n\nHello.\n");
  });
});
