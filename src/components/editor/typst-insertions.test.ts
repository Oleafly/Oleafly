// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { emitTypstTable } from "@oleafly/conversion-registry/table";
import { i18n } from "@/i18n";

const mocks = vi.hoisted(() => ({
  view: null as EditorView | null,
  readFileContent: vi.fn(async () => "= Main\n"),
  toast: { infoUnique: vi.fn(), success: vi.fn(), error: vi.fn(), errorUnique: vi.fn(), info: vi.fn() },
}));

vi.mock("@/components/editor/cm/controller", () => ({
  getEditorView: () => mocks.view,
  insertTemplate: (template: string, selStart: number, selEnd: number) => {
    const view = mocks.view;
    if (!view) return;
    const selection = view.state.selection.main;
    view.dispatch({
      changes: { from: selection.from, to: selection.to, insert: template },
      selection: { anchor: selection.from + selStart, head: selection.from + selEnd },
    });
  },
  replaceRange: vi.fn(),
}));
vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  readFileContent: mocks.readFileContent,
}));
vi.mock("@/lib/toast", () => ({ toast: mocks.toast, notifyError: vi.fn() }));

import { useFilesStore } from "@/store/files";
import { useIndexStore } from "@/store/project-index";
import {
  addTypstLabel,
  addTypstNumberingRule,
  bibliographyTargetPath,
  insertTypstCitation,
  insertTypstNumberedEquation,
  insertTypstReferenceTo,
  insertTypstSymbolFor,
  insertTypstTableAt,
  resetTypstNumberingOffers,
  TYPST_NUMBERING_RULE,
  TYPST_NUMBERING_TOAST_KEY,
  typstLabelPlan,
  typstNumberingRuleOffset,
  typstReferenceText,
  typstTableTemplate,
} from "./typst-insertions";

function mount(doc: string, anchor = doc.indexOf("|"), head = anchor): EditorView {
  const marker = doc.indexOf("|");
  const text = marker < 0 ? doc : doc.slice(0, marker) + doc.slice(marker + 1);
  const view = new EditorView({
    state: EditorState.create({ doc: text, selection: EditorSelection.single(anchor, head) }),
    parent: document.body.appendChild(document.createElement("div")),
  });
  mocks.view = view;
  return view;
}

function selected(view: EditorView): string {
  const { from, to } = view.state.selection.main;
  return view.state.sliceDoc(from, to);
}

function project(files: Record<string, string>, activePath = "main.typ", mainDoc = "main.typ") {
  useFilesStore.setState({
    projectId: "p1",
    activePath,
    mainDoc,
    files: Object.fromEntries(Object.entries(files).map(([path, content]) => [path, { content }])),
    setContent: vi.fn(() => true),
    saveFile: vi.fn(async () => {}),
    writeProjectFile: vi.fn(async () => {}),
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  resetTypstNumberingOffers();
  useIndexStore.setState({ texts: {}, index: null } as never);
  project({});
});

afterEach(() => {
  mocks.view?.destroy();
  mocks.view = null;
});

describe("typst tables", () => {
  it("emits the booktabs-style figure the converter writes, with the caption selected", () => {
    const snippet = typstTableTemplate(2, 3);
    expect(snippet.template).toBe(
      [
        "#figure(",
        "  table(",
        "    columns: 3,",
        "    align: (left, left, left),",
        "    stroke: none,",
        "    table.hline(),",
        "    table.header([], [], []),",
        "    table.hline(stroke: 0.5pt),",
        "    [], [], [],",
        "    table.hline(),",
        "  ),",
        "  caption: [Caption],",
        ") <tab:label>",
        "",
      ].join("\n"),
    );
    expect(snippet.template).toBe(
      `${emitTypstTable([["", "", ""], ["", "", ""]], { header: true, caption: "Caption", label: "tab:label" })}\n`,
    );
    expect(snippet.template.slice(snippet.selStart, snippet.selEnd)).toBe("Caption");
  });

  it("inserts the table at the cursor", () => {
    const view = mount("Before |after");
    insertTypstTableAt(1, 1);
    expect(view.state.doc.toString()).toContain("Before #figure(\n  table(\n    columns: 1,\n    align: left,");
    expect(selected(view)).toBe("Caption");
  });
});

describe("typst references and citations", () => {
  it("writes the reference form that each mode accepts", () => {
    expect(typstReferenceText("cite", "knuth84", "markup", " ", " ")).toBe("@knuth84");
    expect(typstReferenceText("cite", "knuth84", "markup", "e", "s")).toBe(" @knuth84 ");
    expect(typstReferenceText("cite", "knuth84", "math", "", "")).toBe("#cite(<knuth84>)");
    expect(typstReferenceText("cite", "knuth84", "code", "", "")).toBe("cite(<knuth84>)");
    expect(typstReferenceText("ref", "fig:plot", "markup", " ", ".")).toBe("@fig:plot");
    expect(typstReferenceText("ref", "fig:plot", "code", "", "")).toBe("ref(<fig:plot>)");
    expect(typstReferenceText("cite", "doe:", "markup", " ", "")).toBe("#cite(<doe:>)");
    expect(typstReferenceText("cite", "has space", "markup", " ", "")).toBe('#cite(label("has space"))');
    expect(typstReferenceText("cite", "has space", "code", "", "")).toBe('cite(label("has space"))');
  });

  it("cites in markup and declares the bibliography in the open main file", async () => {
    const view = mount("= Intro\nAs shown |.\n");
    project({ "main.typ": "= Intro\nAs shown .\n" });
    await insertTypstCitation("knuth84", "refs/main.bib");
    expect(view.state.doc.toString()).toBe('= Intro\nAs shown @knuth84.\n\n#bibliography("refs/main.bib")\n');
    expect(view.state.selection.main.head).toBe("= Intro\nAs shown @knuth84".length);
    expect(mocks.toast.infoUnique).not.toHaveBeenCalled();
  });

  it("uses #cite inside math and cite() inside code", async () => {
    const view = mount('$ x |$\n#bibliography("a.bib")');
    await insertTypstCitation("k", "a.bib");
    expect(view.state.doc.toString()).toBe('$ x #cite(<k>)$\n#bibliography("a.bib")');
    view.destroy();
    const code = mount('#let c = |\n#bibliography("a.bib")');
    await insertTypstCitation("k", "a.bib");
    expect(code.state.doc.toString()).toBe('#let c = cite(<k>)\n#bibliography("a.bib")');
  });

  it("leaves the bibliography alone when another project file declares it", async () => {
    const view = mount("See |.");
    project({ "chapters/end.typ": '#bibliography("refs.bib")' }, "main.typ");
    await insertTypstCitation("k", "refs.bib");
    expect(view.state.doc.toString()).toBe("See @k.");
  });

  it("declares the bibliography in the main file when citing from a chapter", async () => {
    const view = mount("See |.");
    project({ "chapters/one.typ": "See ." }, "chapters/one.typ", "main.typ");
    await insertTypstCitation("k", "refs.bib");
    expect(view.state.doc.toString()).toBe("See @k.");
    const files = useFilesStore.getState();
    expect(mocks.readFileContent).toHaveBeenCalledWith("p1", "main.typ");
    expect(files.writeProjectFile).toHaveBeenCalledWith("p1", "main.typ", '= Main\n\n#bibliography("refs.bib")\n');
    expect(mocks.toast.infoUnique).toHaveBeenCalledWith(
      "typst-bibliography",
      i18n.t(($) => $.editor.typst.bibliographyAdded, { file: "main.typ" }),
    );
  });

  it("targets the main Typst file, or the active file in a LaTeX project", () => {
    expect(bibliographyTargetPath("main.typ", "chapters/a.typ")).toBe("main.typ");
    expect(bibliographyTargetPath("main.tex", "notes.typ")).toBe("notes.typ");
  });

  it("inserts a label reference", async () => {
    const view = mount("See|");
    insertTypstReferenceTo("fig:plot");
    expect(view.state.doc.toString()).toBe("See @fig:plot");
  });
});

describe("typst labels", () => {
  const markup = () => "markup" as const;

  it("labels the heading under the cursor from its title", () => {
    const text = "= Related Wörk\nBody";
    const plan = typstLabelPlan(text, 4, markup);
    expect(plan).toEqual({ kind: "insert", at: 14, insert: " <sec:related-work>", from: 2, to: 18 });
  });

  it("selects a label the heading already has", () => {
    const text = "== Method <sec:method>  \nBody";
    const plan = typstLabelPlan(text, 3, markup);
    expect(plan.kind).toBe("existing");
    if (plan.kind === "existing") expect(text.slice(plan.from, plan.to)).toBe("sec:method");
  });

  it("labels an image figure after its closing parenthesis", () => {
    const text = '#figure(\n  image("figures/Growth Rate.png"),\n  caption: [G],\n)\nNext';
    const plan = typstLabelPlan(text, 12, markup);
    expect(plan).toMatchObject({ kind: "insert", at: text.indexOf(")\nNext") + 1, insert: " <fig:growth-rate>" });
  });

  it("labels a table figure with a tab prefix and avoids taken names", () => {
    const text = "#figure(table(columns: 1, [a]), caption: [T])";
    const plan = typstLabelPlan(text, 10, markup, new Set(["tab:label"]));
    expect(plan).toMatchObject({ kind: "insert", at: text.length, insert: " <tab:label-2>" });
  });

  it("labels the block equation around the cursor", () => {
    const text = "Text\n$ a + b $\nMore";
    const plan = typstLabelPlan(text, 8, (pos) => (pos > 5 && pos < 14 ? "math" : "markup"));
    expect(plan).toEqual({ kind: "insert", at: 14, insert: " <eq:label>", from: 2, to: 10 });
  });

  it("falls back to a label at the cursor", () => {
    expect(typstLabelPlan("Plain text", 5, markup)).toEqual({
      kind: "insert",
      at: 5,
      insert: "<label>",
      from: 1,
      to: 6,
    });
  });

  it("applies the plan to the editor and selects the new label", () => {
    const view = mount("= Intro|\nText");
    addTypstLabel();
    expect(view.state.doc.toString()).toBe("= Intro <sec:intro>\nText");
    expect(selected(view)).toBe("sec:intro");
  });
});

describe("typst equations", () => {
  it("inserts a numbered equation and offers the numbering rule once", () => {
    const view = mount("#import \"x.typ\": *\n// note\nText |");
    project({ "main.typ": view.state.doc.toString() });
    insertTypstNumberedEquation();
    expect(view.state.doc.toString()).toContain("Text $ x $ <eq:label>");
    expect(selected(view)).toBe("x");
    expect(mocks.toast.infoUnique).toHaveBeenCalledOnce();
    const [key, message, action] = mocks.toast.infoUnique.mock.calls[0] as unknown as [
      string,
      string,
      { label: string; onClick: () => void },
    ];
    expect(key).toBe(TYPST_NUMBERING_TOAST_KEY);
    expect(message).toBe(i18n.t(($) => $.editor.typst.numberingNote));
    expect(action.label).toBe(i18n.t(($) => $.editor.typst.addNumberingRule));
    action.onClick();
    expect(view.state.doc.toString().split("\n")[2]).toBe(TYPST_NUMBERING_RULE);

    insertTypstNumberedEquation();
    expect(view.state.doc.toString()).toContain("<eq:label-2>");
    expect(mocks.toast.infoUnique).toHaveBeenCalledOnce();
  });

  it("stays quiet when the project already numbers equations", () => {
    mount("Text |");
    project({ "main.typ": "Text ", "setup.typ": '#set math.equation(numbering: "(1)")' });
    insertTypstNumberedEquation();
    expect(mocks.toast.infoUnique).not.toHaveBeenCalled();
  });

  it("puts the numbering rule after leading imports and comments", () => {
    expect(typstNumberingRuleOffset('#import "a.typ": *\n// c\n= Title')).toBe(24);
    expect(typstNumberingRuleOffset("= Title")).toBe(0);
  });

  it("finds a numbering rule only inside the equation set rule's arguments", () => {
    const opened = mount('#set math.equation(supplement: "Eq.")\n#let numbering: x\n|');
    addTypstNumberingRule("main.typ");
    expect(opened.state.doc.toString()).toContain(TYPST_NUMBERING_RULE);
    opened.destroy();
    const unclosed = mount(`${"#set\tmath.equation(".repeat(2_000)}|`);
    addTypstNumberingRule("main.typ");
    expect(unclosed.state.doc.toString()).toContain(TYPST_NUMBERING_RULE);
    unclosed.destroy();
  });

  it("does not add the rule when the file changed or already has one", () => {
    const view = mount('#set math.equation(numbering: "1")\n|');
    addTypstNumberingRule("main.typ");
    expect(view.state.doc.toString()).toBe('#set math.equation(numbering: "1")\n');
    addTypstNumberingRule("other.typ");
    expect(view.state.doc.toString()).toBe('#set math.equation(numbering: "1")\n');
  });
});

describe("typst symbols in the editor", () => {
  it("writes the math name inside an equation and the sym module in text", () => {
    const view = mount("$x|$");
    expect(insertTypstSymbolFor("\\alpha", "α")).toBe(true);
    expect(view.state.doc.toString()).toBe("$x alpha$");
    view.destroy();
    const text = mount("Angle |is");
    insertTypstSymbolFor("\\theta", "θ");
    expect(text.state.doc.toString()).toBe("Angle #sym.theta;is");
  });

  it("falls back to the glyph for commands without a Typst name", () => {
    const view = mount("$|$");
    insertTypstSymbolFor("\\circledast", "⊛");
    expect(view.state.doc.toString()).toBe("$⊛$");
  });
});
