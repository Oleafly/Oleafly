// @vitest-environment jsdom
import { diagnosticCount, forceLinting, forEachDiagnostic, type Diagnostic } from "@codemirror/lint";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { EMPTY_TYPST_FORM_CATALOG, type TypstFormCatalog, type TypstFormDiagnostic } from "@oleafly/editor/typst-forms";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/typst-forms", () => ({ loadTypstFormCatalog: vi.fn(async () => EMPTY_TYPST_FORM_CATALOG) }));

import { useTypstFormsStore } from "@/store/typst-forms";
import { typstFormDiagnosticsFor, typstFormsLint } from "./typst-forms-lint";

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
  useTypstFormsStore.setState({ catalog: EMPTY_TYPST_FORM_CATALOG });
});

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
});
