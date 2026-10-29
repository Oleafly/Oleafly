import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import { beforeAll, describe, expect, it } from "vitest";
import { loadTypstParser } from "../../../typst";
import { EMPTY_TYPST_FORM_CATALOG, staticTypstForms, type TypstFormCatalog } from "../../../typst-forms";
import { readTypstFormsFixture, typstFormsGolden } from "../../../typst-forms-test-support";
import type { VisualPorts } from "../../types";
import { buildTypstDecorations } from "../field";
import { typstState } from "../test-support";

beforeAll(async () => {
  await loadTypstParser();
});

const TYPST_DOCUMENTS: Record<string, string> = {
  report: readTypstFormsFixture("project/report.typ"),
  edgeCases: readTypstFormsFixture("project/edge-cases.typ"),
  memo: readTypstFormsFixture("project/template/memo.typ"),
  widgets: `#set page(paper: "a4")
= Title
Some *bold* and _emphasis_ with a #link("https://typst.app")[link] and a note#footnote[Note].
- item
+ numbered
$ x^2 $
#figure(image("figure.png"), caption: [A figure]) <fig>
See @fig and #cite(<key>).
#table(
  columns: 2,
  [a], [b],
)
#highlight[marked] and #underline[under].
\`\`\`rust
fn main() {}
\`\`\`
`,
  structure: `#import "@preview/cetz:0.3.4": canvas
#let note(body) = block(fill: luma(240), body)
= Methods
== Setup
/ Term: description
+ first
  + nested
- bullet with #strong[bold] and #emph[slanted] and #text(fill: red)[red]
#note[A *custom* call that has no form.]
#figure(
  table(columns: 3, [a], [b], [c]),
  caption: [Results],
) <results>
@results shows it. #footnote[See the appendix.] Inline $a^2 + b^2$ and
$ sum_(i=1)^n i = (n (n + 1)) / 2 $
#link("https://example.com") and "quotes" -- dashes ... ellipsis \\
\`raw\` and
\`\`\`typ
#info-box(title: "inside raw")
\`\`\`
`,
  large: Array.from({ length: 40 }, () => readTypstFormsFixture("project/report.typ")).join("\n"),
};

function elsewhere(catalog: TypstFormCatalog): TypstFormCatalog {
  return {
    ...catalog,
    forms: catalog.forms.map((form) => ({ ...form, binding: { kind: "package", spec: "@local/elsewhere:9.9.9" } })),
  };
}

function snapshot(state: EditorState): string[] {
  const { decorations } = buildTypstDecorations(state, syntaxTree(state));
  const found: string[] = [];
  decorations.between(0, state.doc.length, (from, to, value) => {
    const spec = value.spec as { class?: string; widget?: object; block?: boolean };
    found.push(`${from}:${to}:${spec.class ?? spec.widget?.constructor.name ?? "hidden"}:${spec.block ? "block" : ""}`);
  });
  return found;
}

const SETUPS: Record<string, () => VisualPorts> = {
  "no port": () => ({ resolveImage: async () => null }),
  "an empty catalog": () => ({ resolveImage: async () => null, typstForms: staticTypstForms(EMPTY_TYPST_FORM_CATALOG) }),
  "a catalog for another package": () => ({
    resolveImage: async () => null,
    typstForms: staticTypstForms(elsewhere(typstFormsGolden())),
  }),
};

describe("a document with no resolving forms", () => {
  it.each(Object.entries(TYPST_DOCUMENTS))("decorates %s exactly as before", (_name, doc) => {
    const base = snapshot(typstState(doc, { ports: SETUPS["no port"](), path: "report.typ" }));
    expect(base.length).toBeGreaterThan(0);
    for (const [setup, ports] of Object.entries(SETUPS)) {
      expect(snapshot(typstState(doc, { ports: ports(), path: "report.typ" })), setup).toEqual(base);
    }
  });
});
