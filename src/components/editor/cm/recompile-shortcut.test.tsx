// @vitest-environment jsdom
import { QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorView } from "@codemirror/view";
import { CmCodeEditor } from "@oleafly/diagram";
import { diagramCodeExtensions } from "@/components/diagram/code-extensions";
import { ApprovalsFileEditor } from "@/components/settings/ai/ApprovalsFileEditor";
import { CodeField } from "@/components/tools/CodeField";
import { createAppQueryClient } from "@/lib/query";
import { approvalsReadRaw } from "@/lib/tauri";
import { useFilesStore } from "@/store/files";
import { matchesShortcut, useShortcutStore } from "@/store/shortcuts";
import { latexLanguage } from "./latex";

vi.mock("@/lib/tauri", () => ({
  approvalsReadRaw: vi.fn(),
  approvalsWriteRaw: vi.fn(),
  approvalsModeGet: vi.fn(async () => "approve-for-me"),
  approvalsModeSet: vi.fn(),
}));

if (typeof Range !== "undefined" && !Range.prototype.getClientRects) {
  Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, value: () => [] });
}

const SOURCE = "\\draw (0,0) -- (1,1);\n\\node at (0,0) {A};\n";
const TOML = '["$approval_modes"]\nproj-1 = "custom"\n';

function editorIn(container: HTMLElement): EditorView {
  const dom = container.querySelector<HTMLElement>(".cm-editor");
  const view = dom ? EditorView.findFromDOM(dom) : null;
  if (!view) throw new Error("No CodeMirror editor is mounted.");
  return view;
}

// jsdom's navigator.platform is "", so CodeMirror and matchesShortcut both
// read Mod as Ctrl here.
function pressCtrlEnter(view: EditorView, at: number): void {
  act(() => view.dispatch({ selection: { anchor: at } }));
  act(() => {
    view.contentDOM.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        code: "Enter",
        keyCode: 13,
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
}

// Stands in for App.tsx's bubble-phase window listener, which owns the
// recompile chord everywhere in the main window.
let recompiles = 0;
function countRecompile(event: KeyboardEvent): void {
  if (matchesShortcut(event, useShortcutStore.getState().bindings.recompile)) recompiles += 1;
}

beforeEach(() => {
  recompiles = 0;
  window.addEventListener("keydown", countRecompile);
  useShortcutStore.getState().resetAll();
});

afterEach(() => {
  cleanup();
  window.removeEventListener("keydown", countRecompile);
});

describe("recompile shortcut in secondary code editors", () => {
  it("leaves the diagram composer's code untouched", () => {
    const onChange = vi.fn();
    const { container } = render(
      <CmCodeEditor value={SOURCE} onChange={onChange} extensions={diagramCodeExtensions()} />,
    );
    const view = editorIn(container);

    pressCtrlEnter(view, 5);

    expect(recompiles).toBe(1);
    expect(view.state.doc.toString()).toBe(SOURCE);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("leaves a tool panel's code field untouched", () => {
    const onChange = vi.fn();
    const { container } = render(
      <CodeField value={SOURCE} onChange={onChange} language={latexLanguage} themeId="default" />,
    );
    const view = editorIn(container);

    pressCtrlEnter(view, 5);

    expect(recompiles).toBe(1);
    expect(view.state.doc.toString()).toBe(SOURCE);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("leaves the approvals file untouched", async () => {
    vi.mocked(approvalsReadRaw).mockReset().mockResolvedValue(TOML);
    useFilesStore.setState({ projectId: "proj-1", projectName: "Grant proposal" });
    render(
      <QueryClientProvider client={createAppQueryClient()}>
        <ApprovalsFileEditor />
      </QueryClientProvider>,
    );
    const host = screen.getByTestId("approvals-file-source");
    await waitFor(() => expect(editorIn(host).state.doc.toString()).toBe(TOML));
    await waitFor(() => expect(screen.getByTestId("approvals-file-save")).toBeDisabled());
    const view = editorIn(host);

    pressCtrlEnter(view, 5);

    expect(recompiles).toBe(1);
    expect(view.state.doc.toString()).toBe(TOML);
    expect(screen.getByTestId("approvals-file-save")).toBeDisabled();
  });
});
