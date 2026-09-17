// @vitest-environment jsdom

import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { latexTreeSupport } from "../latex-tree";
import { visualMode } from "./index";
import { parsedView, positionOf, SAMPLE_DOCUMENT } from "./test-document";


if (typeof Range !== "undefined" && !Range.prototype.getClientRects) {
  Object.defineProperty(Range.prototype, "getClientRects", {
    configurable: true,
    value: () => [],
  });
}

const ports = { resolveImage: async () => null };
let view: EditorView | null = null;

function mount(doc: string, cursor: number): EditorView {
  const parent = document.createElement("div");
  document.body.append(parent);
  view = new EditorView({
    state: EditorState.create({
      doc,
      selection: { anchor: cursor },
      extensions: [latexTreeSupport(), visualMode(ports)],
    }),
    parent,
  });
  return parsedView(view);
}

afterEach(() => {
  view?.destroy();
  view = null;
  document.body.innerHTML = "";
});

const doc = SAMPLE_DOCUMENT;

describe("mark decorations", () => {
  it("styles headings by level with the command hidden", () => {
    const editor = mount(doc, doc.length);
    const section = editor.contentDOM.querySelector(".ofl-visual-heading.ofl-visual-command-section");
    expect(section?.textContent).toBe("Inline and display math");
    expect(editor.contentDOM.querySelector(".ofl-visual-command-part")?.textContent).toBe("Widgets");
    expect(editor.contentDOM.querySelector(".ofl-visual-command-chapter")?.textContent).toBe("Rendering");
  });

  it("colours text and boxes from the colour argument", () => {
    const editor = mount(doc, doc.length);
    const colored = editor.contentDOM.querySelector<HTMLElement>(".ofl-visual-textcolor");
    expect(colored?.textContent).toBe("Red text");
    expect(colored?.style.color).toBe("rgb(255, 0, 0)");
    const boxed = editor.contentDOM.querySelector<HTMLElement>(".ofl-visual-colorbox");
    expect(boxed?.textContent).toBe("boxed text");
    expect(boxed?.style.backgroundColor).toBe("rgb(255, 255, 0)");
  });

  it("keeps the colour when the command is revealed", () => {
    const editor = mount(doc, positionOf(doc, "Red text") + 1);
    const colored = editor.contentDOM.querySelector<HTMLElement>(".ofl-visual-textcolor");
    expect(colored?.textContent).toBe("Red text");
    expect(editor.contentDOM.textContent).toContain("\\textcolor{red}{");
  });

  it("marks theorem bodies with the theorem style and table lines as a panel", () => {
    const editor = mount(doc, doc.length);
    editor.dispatch({ effects: EditorView.scrollIntoView(positionOf(doc, "A small table"), { y: "center" }) });
    const theoremLines = editor.contentDOM.querySelectorAll(".cm-line.ofl-visual-environment-theorem-plain");
    expect(theoremLines).toHaveLength(1);
    expect(theoremLines[0].textContent?.trim()).toBe("Every widget renders in place.");
    expect(editor.contentDOM.querySelector(".ofl-visual-begin-theorem")?.textContent).toBe("Lemma (Small)");
    expect(editor.contentDOM.querySelector(".ofl-visual-end")).not.toBeNull();
    const tableLines = editor.contentDOM.querySelectorAll(".cm-line.ofl-visual-environment-table");
    expect(tableLines.length).toBeGreaterThan(0);
    for (const line of tableLines) expect(line.classList.contains("ofl-visual-environment-centered")).toBe(true);
    expect(editor.contentDOM.querySelector(".ofl-visual-caption-line")?.textContent?.trim()).toBe("A small table");
  });

  it("wraps citations, references and labels in chips", () => {
    const text = "\\begin{document}\nSee \\cite{knuth} and \\ref{sec:a}.\n\\label{sec:a}\n\\end{document}\n";
    const editor = mount(text, text.length);
    expect(editor.contentDOM.querySelector(".ofl-visual-chip-cite")?.textContent).toBe("knuth");
    expect(editor.contentDOM.querySelector(".ofl-visual-chip-ref")?.textContent).toBe("sec:a");
    expect(editor.contentDOM.querySelector(".ofl-visual-chip-label")?.textContent).toBe("sec:a");
    expect(editor.contentDOM.querySelectorAll(".ofl-visual-icon-brace svg")).toHaveLength(3);
  });

  it("marks text formatting commands", () => {
    const text = "\\begin{document}\n\\textbf{bold} \\emph{em} \\textsc{sc}\n\\end{document}\n";
    const editor = mount(text, text.length);
    expect(editor.contentDOM.querySelector(".ofl-visual-command-textbf")?.textContent).toBe("bold");
    expect(editor.contentDOM.querySelector(".ofl-visual-command-emph")?.textContent).toBe("em");
    expect(editor.contentDOM.querySelector(".ofl-visual-command-textsc")?.textContent).toBe("sc");
    expect(editor.contentDOM.textContent).not.toContain("\\textbf");
  });
});
