// @vitest-environment jsdom
import { describe, expect, it, afterEach } from "vitest";
import { EditorView } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { forceLinting, lintGutter } from "@codemirror/lint";
import { createCompileErrorLinter } from "./compile-error-linter";
import { useCompileStore } from "@/store/compile";
import { useFilesStore } from "@/store/files";

function makeView(doc: string) {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const view = new EditorView({
    state: EditorState.create({ doc, extensions: [lintGutter(), createCompileErrorLinter()] }),
    parent,
  });
  return view;
}

async function runLinting(view: EditorView) {
  forceLinting(view);
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("createCompileErrorLinter", () => {
  afterEach(() => {
    useCompileStore.setState({ errors: [] } as unknown as ReturnType<typeof useCompileStore.getState>);
  });

  it("places a gutter marker at the error's line for the active file", async () => {
    useFilesStore.setState({ activePath: "main.tex" } as unknown as ReturnType<typeof useFilesStore.getState>);
    useCompileStore.setState({
      errors: [
        { line: 2, file: "main.tex", message: "Undefined control sequence.", kind: "error", explanation: "Explained." },
      ],
    } as unknown as ReturnType<typeof useCompileStore.getState>);

    const view = makeView("line one\nline two\nline three\n");
    await runLinting(view);

    expect(view.dom.querySelectorAll(".cm-lint-marker-error").length).toBe(1);
    expect(view.dom.querySelectorAll(".cm-lintRange-error").length).toBeGreaterThan(0);
    view.destroy();
  });

  it("does not show a diagnostic for an error in a different file", async () => {
    useFilesStore.setState({ activePath: "main.tex" } as unknown as ReturnType<typeof useFilesStore.getState>);
    useCompileStore.setState({
      errors: [
        { line: 2, file: "other.tex", message: "Undefined control sequence.", kind: "error", explanation: null },
      ],
    } as unknown as ReturnType<typeof useCompileStore.getState>);

    const view = makeView("line one\nline two\nline three\n");
    await runLinting(view);

    expect(view.dom.querySelectorAll(".cm-lint-marker-error").length).toBe(0);
    view.destroy();
  });

  it("uses warning severity for non-error diagnostics", async () => {
    useFilesStore.setState({ activePath: "main.tex" } as unknown as ReturnType<typeof useFilesStore.getState>);
    useCompileStore.setState({
      errors: [{ line: 1, file: "main.tex", message: "Float too large.", kind: "warning", explanation: null }],
    } as unknown as ReturnType<typeof useCompileStore.getState>);

    const view = makeView("line one\n");
    await runLinting(view);

    expect(view.dom.querySelectorAll(".cm-lint-marker-warning").length).toBe(1);
    expect(view.dom.querySelectorAll(".cm-lint-marker-error").length).toBe(0);
    view.destroy();
  });

  it("shows no diagnostics when there are no compile errors", async () => {
    useFilesStore.setState({ activePath: "main.tex" } as unknown as ReturnType<typeof useFilesStore.getState>);
    const view = makeView("line one\n");
    await runLinting(view);

    expect(view.dom.querySelectorAll(".cm-lint-marker-error").length).toBe(0);
    view.destroy();
  });
});
