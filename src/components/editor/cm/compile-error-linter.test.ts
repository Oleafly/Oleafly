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

    expect(view.dom.querySelectorAll(".cm-lint-marker-error")).toHaveLength(1);
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

    expect(view.dom.querySelectorAll(".cm-lint-marker-error")).toHaveLength(0);
    view.destroy();
  });

  it("uses warning severity for non-error diagnostics", async () => {
    useFilesStore.setState({ activePath: "main.tex" } as unknown as ReturnType<typeof useFilesStore.getState>);
    useCompileStore.setState({
      errors: [{ line: 1, file: "main.tex", message: "Float too large.", kind: "warning", explanation: null }],
    } as unknown as ReturnType<typeof useCompileStore.getState>);

    const view = makeView("line one\n");
    await runLinting(view);

    expect(view.dom.querySelectorAll(".cm-lint-marker-warning")).toHaveLength(1);
    expect(view.dom.querySelectorAll(".cm-lint-marker-error")).toHaveLength(0);
    view.destroy();
  });

  it("shows no diagnostics when there are no compile errors", async () => {
    useFilesStore.setState({ activePath: "main.tex" } as unknown as ReturnType<typeof useFilesStore.getState>);
    const view = makeView("line one\n");
    await runLinting(view);

    expect(view.dom.querySelectorAll(".cm-lint-marker-error")).toHaveLength(0);
    view.destroy();
  });

  it("keeps errors on the file they name when two files share a basename", async () => {
    useFilesStore.setState({
      activePath: "cast/b/intro.tex",
      tree: [
        { path: "main.tex", name: "main.tex", is_dir: false },
        { path: "cast/a/intro.tex", name: "intro.tex", is_dir: false },
        { path: "cast/b/intro.tex", name: "intro.tex", is_dir: false },
      ],
    } as unknown as ReturnType<typeof useFilesStore.getState>);
    useCompileStore.setState({
      errors: [
        { line: 3, file: "cast/a/intro.tex", message: "Undefined control sequence.", kind: "error", explanation: null },
        { line: 1, file: "cast/b/intro.tex", message: "Missing $ inserted.", kind: "error", explanation: null },
      ],
    } as unknown as ReturnType<typeof useCompileStore.getState>);

    const view = makeView("Beta first\n\nBeta second\n");
    await runLinting(view);

    expect(view.dom.querySelectorAll(".cm-lint-marker-error")).toHaveLength(1);
    view.destroy();
    useFilesStore.setState({ tree: [] } as unknown as ReturnType<typeof useFilesStore.getState>);
  });

  it("marks the child file for an error Tectonic reports without the .tex extension", async () => {
    useFilesStore.setState({ activePath: "kapitoly/úvod.tex" } as unknown as ReturnType<typeof useFilesStore.getState>);
    useCompileStore.setState({
      errors: [{ line: 2, file: "kapitoly/úvod", message: "Undefined control sequence.", kind: "error", explanation: null }],
    } as unknown as ReturnType<typeof useCompileStore.getState>);

    const view = makeView("\\section{Úvod}\nPříliš \\chybnýpříkaz\n");
    await runLinting(view);

    expect(view.dom.querySelectorAll(".cm-lint-marker-error")).toHaveLength(1);
    view.destroy();
  });

  it("marks the active file when the tree lists it too and the error names only its basename", async () => {
    useFilesStore.setState({
      activePath: "kapitoly/úvod.tex",
      tree: [
        { path: "main.tex", name: "main.tex", is_dir: false },
        { path: "kapitoly/úvod.tex", name: "úvod.tex", is_dir: false },
      ],
    } as unknown as ReturnType<typeof useFilesStore.getState>);
    useCompileStore.setState({
      errors: [{ line: 2, file: "úvod.tex", message: "Undefined control sequence.", kind: "error", explanation: null }],
    } as unknown as ReturnType<typeof useCompileStore.getState>);

    const view = makeView("\\section{Úvod}\nPříliš \\chybnýpříkaz\n");
    await runLinting(view);

    expect(view.dom.querySelectorAll(".cm-lint-marker-error")).toHaveLength(1);
    view.destroy();
    useFilesStore.setState({ tree: [] } as unknown as ReturnType<typeof useFilesStore.getState>);
  });
});
