// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorView } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { forEachDiagnostic, forceLinting } from "@codemirror/lint";

const hints = vi.hoisted(() => ({ typstPackageHints: vi.fn() }));
vi.mock("@/lib/typst-package-hints", () => hints);

import { useSettingsStore } from "@/store/settings";
import { createTypstPackageHintLinter } from "./typst-package-hints";

function makeView(doc: string) {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  return new EditorView({
    state: EditorState.create({ doc, extensions: [createTypstPackageHintLinter()] }),
    parent,
  });
}

async function settle(view: EditorView) {
  forceLinting(view);
  for (let attempt = 0; attempt < 5; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function diagnostics(view: EditorView) {
  const found: { from: number; to: number; severity: string }[] = [];
  forEachDiagnostic(view.state, (diagnostic, from, to) => {
    found.push({ from, to, severity: diagnostic.severity });
  });
  return found;
}

describe("createTypstPackageHintLinter", () => {
  afterEach(() => {
    hints.typstPackageHints.mockReset();
    useSettingsStore.setState({ offline: false });
  });

  it("loads the hints lazily and shows them as info diagnostics", async () => {
    const doc = '#import "@preview/cetz:0.4.2"';
    hints.typstPackageHints.mockResolvedValue([
      { from: 23, to: 28, severity: "info", message: "Update available" },
    ]);
    useSettingsStore.setState({ offline: true });
    const view = makeView(doc);
    await settle(view);
    expect(hints.typstPackageHints).toHaveBeenCalledWith(doc, true);
    expect(diagnostics(view)).toEqual([{ from: 23, to: 28, severity: "info" }]);
    view.destroy();
  });

  it("shows nothing when the hint module fails", async () => {
    hints.typstPackageHints.mockRejectedValue(new Error("chunk failed"));
    const view = makeView('#import "@preview/cetz:0.4.2"');
    await settle(view);
    expect(diagnostics(view)).toEqual([]);
    view.destroy();
  });
});
