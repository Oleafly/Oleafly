// @vitest-environment jsdom
import { syntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import type { Decoration } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { latexTreeSupport } from "../latex-tree";
import { visualAtomicField } from "./atomic-decorations";
import { visualMode } from "./index";
import { typesetNodeInto } from "./typeset";
import { BibItemWidget } from "./widgets/bibitem";
import { BraceWidget } from "./widgets/brace";
import { RuleWidget } from "./widgets/rule";
import { parsedState } from "./test-document";

const ports = { resolveImage: async () => null };

function createState(doc: string, cursor = 0): EditorState {
  const state = parsedState(
    EditorState.create({
      doc,
      selection: { anchor: cursor },
      extensions: [latexTreeSupport(), visualMode(ports)],
    }),
  );
  expect(syntaxTree(state).length).toBe(doc.length);
  return state;
}

function decorations(state: EditorState): Array<{ from: number; to: number; spec: Decoration["spec"] }> {
  const found: Array<{ from: number; to: number; spec: Decoration["spec"] }> = [];
  const cursor = state.field(visualAtomicField).decorations.iter();
  while (cursor.value) {
    found.push({ from: cursor.from, to: cursor.to, spec: (cursor.value as Decoration).spec });
    cursor.next();
  }
  return found;
}

const BODY = (inner: string) => `\\documentclass{article}\n\\begin{document}\n${inner}\n\\end{document}\n`;

describe("template constructs", () => {
  it("hides layout commands until the cursor touches them", () => {
    const doc = BODY("\\noindent\\vspace{4pt}\nText\\par");
    const state = createState(doc, doc.indexOf("Text"));
    const hidden = decorations(state).filter((entry) => entry.spec.widget instanceof BraceWidget);
    const texts = hidden.map((entry) => doc.slice(entry.from, entry.to));
    expect(texts).toEqual(expect.arrayContaining(["\\noindent", "\\vspace{4pt}", "\\par"]));
    const revealed = createState(doc, doc.indexOf("\\vspace") + 2);
    const revealedTexts = decorations(revealed).map((entry) => doc.slice(entry.from, entry.to));
    expect(revealedTexts).not.toContain("\\vspace{4pt}");
  });

  it("swallows the star form of a spacing command", () => {
    const doc = BODY("\\vspace*{12pt}\nText");
    const state = createState(doc, doc.indexOf("Text"));
    const texts = decorations(state).map((entry) => doc.slice(entry.from, entry.to));
    expect(texts).toContain("\\vspace*{12pt}");
  });

  it("hides a centering command that shares its line with other content", () => {
    const doc = BODY("\\begin{table}\n\\centering%% note\n\\begin{tabular}{l}\na\\\\\n\\end{tabular}\n\\end{table}\nAfter");
    const state = createState(doc, doc.indexOf("After"));
    const texts = decorations(state).map((entry) => doc.slice(entry.from, entry.to));
    expect(texts).toContain("\\centering");
  });

  it("turns rule commands into rule widgets", () => {
    const doc = BODY("\\rule{\\textwidth}{4pt}\nText\\hrule");
    const state = createState(doc, doc.indexOf("Text"));
    const rules = decorations(state)
      .map((entry) => entry.spec.widget)
      .filter((widget): widget is RuleWidget => widget instanceof RuleWidget);
    expect(rules.map((rule) => [rule.width, rule.height])).toEqual([
      ["100%", "4pt"],
      ["100%", "0.4pt"],
    ]);
  });

  it("hides the edges of a center environment and reveals them on the cursor", () => {
    const doc = BODY("\\begin{center}\nCentred title\n\\end{center}\nAfter");
    const state = createState(doc, doc.indexOf("After"));
    const hidden = decorations(state)
      .filter((entry) => !entry.spec.widget && entry.spec.block)
      .map((entry) => doc.slice(entry.from, entry.to));
    expect(hidden).toEqual(expect.arrayContaining(["\\begin{center}", "\\end{center}"]));
    const revealed = createState(doc, doc.indexOf("\\begin{center}") + 3);
    const stillHidden = decorations(revealed).map((entry) => doc.slice(entry.from, entry.to));
    expect(stillHidden).not.toContain("\\begin{center}");
  });

  it("renders a bibliography as a numbered list with hidden edges", () => {
    const doc = BODY(
      "\\begin{thebibliography}{9}\n\\bibitem{a} First entry.\n\\bibitem[Doe]{b} Second entry.\n\\end{thebibliography}",
    );
    const state = createState(doc, 0);
    const found = decorations(state);
    const items = found.map((entry) => entry.spec.widget).filter((widget): widget is BibItemWidget => widget instanceof BibItemWidget);
    expect(items.map((item) => item.label)).toEqual(["1", "Doe"]);
    const hidden = found.filter((entry) => !entry.spec.widget && entry.spec.block).map((entry) => doc.slice(entry.from, entry.to));
    expect(hidden).toEqual(expect.arrayContaining(["\\begin{thebibliography}{9}", "\\end{thebibliography}"]));
  });

  it("typesets IEEE author blocks and NeurIPS separators inside the author argument", () => {
    const doc = "\\author{\\IEEEauthorblockN{Ada}\\IEEEauthorblockA{Dept} \\And Grace}";
    const state = createState(doc, 0);
    let author: ReturnType<typeof syntaxTree>["topNode"] | null = null;
    syntaxTree(state).iterate({
      enter(node) {
        if (node.type.is("Author")) author = node.node.getChild("TextArgument");
      },
    });
    expect(author).not.toBeNull();
    const element = typesetNodeInto(author as never, document.createElement("div"), state);
    expect(element.querySelector(".ofl-visual-author-name")?.textContent).toBe("Ada");
    expect(element.querySelector(".ofl-visual-author-affiliation")?.textContent).toBe("Dept");
    expect(element.querySelector(".ofl-visual-command-and")).not.toBeNull();
  });
});
