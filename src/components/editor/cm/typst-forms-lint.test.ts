// @vitest-environment jsdom
import { diagnosticCount, forceLinting, forEachDiagnostic, type Diagnostic } from "@codemirror/lint";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { EMPTY_TYPST_FORM_CATALOG, type TypstFormCatalog, type TypstFormDiagnostic } from "@oleafly/editor/typst-forms";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/typst-forms", () => ({ loadTypstFormCatalog: vi.fn(async () => EMPTY_TYPST_FORM_CATALOG) }));

import { useFilesStore } from "@/store/files";
import { useTypstFormsStore } from "@/store/typst-forms";
import { hasTypstFormsLint, typstFormDiagnosticsFor, typstFormsLint, vendoredPackageSpec } from "./typst-forms-lint";

const VENDORED = "typst/packages/local/acme-report/0.1.0/typst.toml";

function diagnostic(overrides: Partial<TypstFormDiagnostic>): TypstFormDiagnostic {
  return {
    source: "oleafly-forms.toml",
    severity: "error",
    code: "unknownKind",
    path: "tool.oleafly.forms[0].fields[0].kind",
    line: 3,
    detail: "\"date\" is not a field kind.",
    ...overrides,
  };
}

function catalog(diagnostics: TypstFormDiagnostic[]): TypstFormCatalog {
  return { ...EMPTY_TYPST_FORM_CATALOG, watch: ["oleafly-forms.toml", VENDORED], diagnostics };
}

const views: EditorView[] = [];

afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
  useTypstFormsStore.setState({ catalog: EMPTY_TYPST_FORM_CATALOG, wanted: [] });
  useFilesStore.setState({ files: {} });
});

function placed(view: EditorView): { from: number; to: number; message: string }[] {
  const found: { from: number; to: number; message: string }[] = [];
  forEachDiagnostic(view.state, (item, from, to) => found.push({ from, to, message: item.message }));
  return found;
}

function lastView(): EditorView {
  const view = views.at(-1);
  if (!view) throw new Error("no editor was created");
  return view;
}

async function markers(path: string, forms: TypstFormCatalog, doc = "one\ntwo\nthree\nfour\n"): Promise<Diagnostic[]> {
  useTypstFormsStore.setState({ catalog: forms });
  const view = new EditorView({ state: EditorState.create({ doc, extensions: [typstFormsLint(path)] }), parent: document.body });
  views.push(view);
  forceLinting(view);
  await new Promise((resolve) => setTimeout(resolve, 0));
  const found: Diagnostic[] = [];
  forEachDiagnostic(view.state, (item) => found.push(item));
  expect(diagnosticCount(view.state)).toBe(found.length);
  return found;
}

describe("Typst forms diagnostics in the editor", () => {
  it("marks a problem on its line with the label for its code", async () => {
    const [marker] = await markers("oleafly-forms.toml", catalog([diagnostic({})]));
    expect(marker).toMatchObject({ from: 8, to: 13, severity: "error", source: "typst-forms" });
    expect(marker.message).toBe('Unknown field kind: "date" is not a field kind.');
  });

  it("puts a problem without a line on line 1 and names the key", async () => {
    const [marker] = await markers(
      "oleafly-forms.toml",
      catalog([diagnostic({ line: null, code: "schemaMissing", severity: "warning", detail: "No schema." })]),
    );
    expect(marker).toMatchObject({ from: 0, to: 3, severity: "warning" });
    expect(marker.message).toBe("Missing schema: No schema. (at tool.oleafly.forms[0].fields[0].kind)");
  });

  it("shows a package's problems in its vendored typst.toml only", async () => {
    const forms = catalog([diagnostic({ source: "@local/acme-report:0.1.0", line: 2 }), diagnostic({})]);
    expect(await markers(VENDORED, forms)).toHaveLength(1);
    expect(typstFormDiagnosticsFor("main.typ", forms)).toEqual([]);
    expect(typstFormDiagnosticsFor("other/oleafly-forms.toml", forms)).toEqual([]);
  });

  it("marks nothing without diagnostics", async () => {
    expect(await markers("oleafly-forms.toml", EMPTY_TYPST_FORM_CATALOG)).toEqual([]);
  });

  it("keeps a line past the end of the file on the last line", async () => {
    const [marker] = await markers("oleafly-forms.toml", catalog([diagnostic({ line: 99 })]), "a\nb");
    expect(marker).toMatchObject({ from: 2, to: 3 });
  });

  it("names no key for a problem with the whole file", async () => {
    const tooLarge = diagnostic({ code: "fileTooLarge", path: "", line: null, detail: "The file is 300000 bytes." });
    const [marker] = await markers("oleafly-forms.toml", catalog([tooLarge]));
    expect(marker).toMatchObject({ from: 0, to: 3 });
    expect(marker.message).toBe("File too large: The file is 300000 bytes.");
  });

  it("marks the problems of a reloaded catalog without another edit", async () => {
    expect(await markers("oleafly-forms.toml", catalog([]))).toEqual([]);
    const view = lastView();
    useTypstFormsStore.setState({ catalog: catalog([diagnostic({})]) });
    await vi.waitFor(() => expect(placed(view)).toEqual([{ from: 8, to: 13, message: 'Unknown field kind: "date" is not a field kind.' }]));
    useTypstFormsStore.setState({ catalog: catalog([]) });
    await vi.waitFor(() => expect(placed(view)).toEqual([]));
  });

  it("keeps markers where edits moved them while the file has unsaved changes", async () => {
    const [marker] = await markers("oleafly-forms.toml", catalog([diagnostic({})]));
    const view = lastView();
    useFilesStore.setState({ files: { "oleafly-forms.toml": { content: "", dirty: true } } });
    view.dispatch({ changes: { from: 0, insert: "new line\n" } });
    forceLinting(view);
    await new Promise((resolve) => setTimeout(resolve, 0));
    // The catalog still says line 3, which is now "two"; the problem moved down with "three".
    expect(placed(view)).toEqual([{ from: 17, to: 22, message: marker.message }]);

    // Saved, the reloaded catalog places it again.
    useFilesStore.setState({ files: { "oleafly-forms.toml": { content: "", dirty: false } } });
    useTypstFormsStore.setState({ catalog: catalog([diagnostic({ line: 5, detail: "Saved." })]) });
    await vi.waitFor(() => expect(placed(view)).toEqual([{ from: 23, to: 27, message: "Unknown field kind: Saved." }]));
  });
});

describe("files that get the forms lint", () => {
  it.each([
    ["oleafly-forms.toml", true],
    ["typst-packages/local/acme-report/0.1.0/typst.toml", true],
    ["typst.toml", true],
    ["Cargo.toml", false],
    ["docs/pyproject.toml", false],
    ["oleafly-forms.toml.bak", false],
    ["main.typ", false],
    [null, false],
  ])("%s: %s", (path, expected) => {
    expect(hasTypstFormsLint(path)).toBe(expected);
  });

  it("reads the package of a vendored manifest", () => {
    expect(vendoredPackageSpec("typst-packages/local/acme-report/0.1.0/typst.toml")).toBe("@local/acme-report:0.1.0");
    expect(vendoredPackageSpec("typst-packages/local/acme-report/latest/typst.toml")).toBeNull();
    expect(vendoredPackageSpec("vendor/typst-packages/local/acme-report/0.1.0/typst.toml")).toBeNull();
    expect(vendoredPackageSpec("oleafly-forms.toml")).toBeNull();
  });

  it("asks for the forms of a vendored package when its manifest is linted", async () => {
    await markers("typst-packages/local/acme-report/0.1.0/typst.toml", EMPTY_TYPST_FORM_CATALOG);
    expect(useTypstFormsStore.getState().wanted).toEqual(["@local/acme-report:0.1.0"]);
    await markers("oleafly-forms.toml", EMPTY_TYPST_FORM_CATALOG);
    expect(useTypstFormsStore.getState().wanted).toEqual(["@local/acme-report:0.1.0"]);
  });
});
