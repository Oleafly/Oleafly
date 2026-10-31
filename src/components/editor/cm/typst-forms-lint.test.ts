// @vitest-environment jsdom
import { diagnosticCount, forceLinting, forEachDiagnostic, type Diagnostic } from "@codemirror/lint";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  EMPTY_TYPST_FORM_CATALOG,
  type TypstFormCatalog,
  type TypstFormDiagnostic,
  type TypstFormMessage,
  type TypstFormMessageId,
} from "@oleafly/editor/typst-forms";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/typst-forms", () => ({ loadTypstFormCatalog: vi.fn(async () => EMPTY_TYPST_FORM_CATALOG) }));

import { i18n } from "@/i18n";
import englishEditor from "@/i18n/locales/en/editor.json" with { type: "json" };
import { useFilesStore } from "@/store/files";
import { useTypstFormsStore } from "@/store/typst-forms";
import {
  hasTypstFormsLint,
  typstFormDiagnosticsFor,
  typstFormMessageText,
  typstFormsLint,
  vendoredPackageSpec,
} from "./typst-forms-lint";

const KINDS = "Use text, content, choice, number or toggle.";
const VENDORED = "typst/packages/local/acme-report/0.1.0/typst.toml";

function diagnostic(overrides: Partial<TypstFormDiagnostic>): TypstFormDiagnostic {
  return {
    source: "oleafly-forms.toml",
    severity: "error",
    code: "unknownKind",
    path: "tool.oleafly.forms[0].fields[0].kind",
    line: 3,
    message: { id: "unknownKind", kind: "date" },
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
    expect(marker.message).toBe(`Unknown field kind: "date" is not a field kind. ${KINDS}`);
  });

  it("puts a problem without a line on line 1 and names the key", async () => {
    const [marker] = await markers(
      "oleafly-forms.toml",
      catalog([diagnostic({ line: null, code: "schemaMissing", severity: "warning", message: { id: "noSchema" } })]),
    );
    expect(marker).toMatchObject({ from: 0, to: 3, severity: "warning" });
    expect(marker.message).toBe("Missing schema: Add schema = 1 to [tool.oleafly]. (at tool.oleafly.forms[0].fields[0].kind)");
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
    const tooLarge = diagnostic({ code: "fileTooLarge", path: "", line: null, message: { id: "fileTooLarge", size: 300000, limit: 262144 } });
    const [marker] = await markers("oleafly-forms.toml", catalog([tooLarge]));
    expect(marker).toMatchObject({ from: 0, to: 3 });
    expect(marker.message).toBe("File too large: The file is 300000 bytes. Forms are read from files of at most 262144 bytes.");
  });

  it("marks the problems of a reloaded catalog without another edit", async () => {
    expect(await markers("oleafly-forms.toml", catalog([]))).toEqual([]);
    const view = lastView();
    useTypstFormsStore.setState({ catalog: catalog([diagnostic({})]) });
    await vi.waitFor(() => expect(placed(view)).toEqual([{ from: 8, to: 13, message: `Unknown field kind: "date" is not a field kind. ${KINDS}` }]));
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
    expect(placed(view)).toEqual([{ from: 17, to: 22, message: marker.message }]);

    useFilesStore.setState({ files: { "oleafly-forms.toml": { content: "", dirty: false } } });
    useTypstFormsStore.setState({ catalog: catalog([diagnostic({ line: 5, message: { id: "unknownKind", kind: "saved" } })]) });
    await vi.waitFor(() => expect(placed(view)).toEqual([{ from: 23, to: 27, message: `Unknown field kind: "saved" is not a field kind. ${KINDS}` }]));
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

const EVERY_MESSAGE: Record<TypstFormMessageId, TypstFormMessage> = {
  fileTooLarge: { id: "fileTooLarge", size: 300000, limit: 262144 },
  unreadable: { id: "unreadable", reason: "permission denied" },
  notUtf8: { id: "notUtf8" },
  invalidPackageSpec: { id: "invalidPackageSpec", spec: "acme" },
  notToml: { id: "notToml", error: "expected `=`" },
  notToml10: { id: "notToml10", error: "expected newline" },
  noOleaflyTable: { id: "noOleaflyTable" },
  oleaflyNotTable: { id: "oleaflyNotTable", found: "string" },
  formsNotList: { id: "formsNotList" },
  formNotTable: { id: "formNotTable", found: "integer" },
  noSchema: { id: "noSchema" },
  schemaUnsupported: { id: "schemaUnsupported", schema: 2 },
  schemaNotNumber: { id: "schemaNotNumber", found: "string" },
  summaryNotAField: { id: "summaryNotAField", arg: { named: "title" } },
  duplicateFunction: { id: "duplicateFunction", function: "card" },
  duplicateModuleFunction: { id: "duplicateModuleFunction", function: "card", module: "a.typ" },
  moduleNotAllowed: { id: "moduleNotAllowed" },
  moduleRequired: { id: "moduleRequired" },
  modulePathEmpty: { id: "modulePathEmpty", module: "" },
  modulePathPackage: { id: "modulePathPackage", module: "@preview/x:1.0.0" },
  modulePathBackslash: { id: "modulePathBackslash", module: "a\\b.typ" },
  modulePathAbsolute: { id: "modulePathAbsolute", module: "/a.typ" },
  modulePathParent: { id: "modulePathParent", module: "../a.typ" },
  modulePathEmptyFolder: { id: "modulePathEmptyFolder", module: "a//b.typ" },
  invalidFunction: { id: "invalidFunction", function: "a.b" },
  builtinName: { id: "builtinName", function: "table" },
  fieldsNotList: { id: "fieldsNotList", found: "table" },
  noFields: { id: "noFields" },
  fieldNotTable: { id: "fieldNotTable", found: "boolean" },
  duplicateArg: { id: "duplicateArg", arg: { positional: 0 } },
  unknownKind: { id: "unknownKind", kind: "date" },
  defaultNotOption: { id: "defaultNotOption", value: "x" },
  maxBelowMin: { id: "maxBelowMin", min: "5", max: "1" },
  stepNotPositive: { id: "stepNotPositive" },
  optionsNotList: { id: "optionsNotList", found: "inlineTable" },
  noOptions: { id: "noOptions" },
  optionNotStringOrTable: { id: "optionNotStringOrTable", found: "float" },
  duplicateOption: { id: "duplicateOption", value: "a" },
  notArg: { id: "notArg", key: "arg" },
  missingKey: { id: "missingKey", key: "label" },
  keyNotForKind: { id: "keyNotForKind", key: "min", kind: "text" },
  unknownKey: { id: "unknownKey", key: "colour" },
  blank: { id: "blank", key: "label" },
  notFinite: { id: "notFinite", key: "max" },
  notString: { id: "notString", key: "label", found: "array" },
  notNumber: { id: "notNumber", key: "min", found: "datetime" },
  notBoolean: { id: "notBoolean", key: "required", found: "arrayOfTables" },
};

describe("forms diagnostic messages", () => {
  it.each(Object.values(EVERY_MESSAGE))("words $id from its own template, with every value filled in", (message) => {
    const text = typstFormMessageText(message);
    expect(text).not.toMatch(/\{\{|typstForms|\[object Object\]/u);
    for (const [name, value] of Object.entries(message)) {
      if (name !== "id" && name !== "found" && name !== "arg" && value !== "") expect(text).toContain(String(value));
    }
  });

  it("has a sample here for every English template", () => {
    expect(Object.keys(EVERY_MESSAGE).sort()).toEqual(Object.keys(englishEditor.typstForms.messages).sort());
  });

  it("names value types and arguments in words", () => {
    expect(typstFormMessageText(EVERY_MESSAGE.oleaflyNotTable)).toBe("tool.oleafly must be a table, not a string.");
    expect(typstFormMessageText(EVERY_MESSAGE.summaryNotAField)).toBe(
      "summary names the argument title, which is not one of this form's fields.",
    );
    expect(typstFormMessageText(EVERY_MESSAGE.duplicateArg)).toBe("Another field of this form already binds positional argument 0.");
  });

  it("words the whole message in the app's language, value types included", async () => {
    i18n.addResourceBundle(
      "de",
      "editor",
      { typstForms: { messages: { oleaflyNotTable: "tool.oleafly muss eine Tabelle sein, nicht {{found}}." }, valueType: { string: "Text" } } },
      true,
      true,
    );
    try {
      await i18n.changeLanguage("de");
      expect(typstFormMessageText(EVERY_MESSAGE.oleaflyNotTable)).toBe("tool.oleafly muss eine Tabelle sein, nicht Text.");
    } finally {
      await i18n.changeLanguage("en");
      i18n.removeResourceBundle("de", "editor");
    }
  });
});
