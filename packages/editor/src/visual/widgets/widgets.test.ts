// @vitest-environment jsdom

import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { afterEach, describe, expect, it } from "vitest";
import { ancestorAt, latexTreeSupport } from "../../latex-tree";
import { parsedView, positionOf, TITLE_DOCUMENT } from "../test-document";
import { typesetNodeInto } from "../typeset";
import { characterSubstitution } from "./character";
import { EndDocumentWidget } from "./end-document";
import { ItemWidget } from "./item";
import { LatexLogoWidget } from "./latex-logo";
import { paintMath, renderVisualMath } from "./math";
import { PreambleWidget } from "./preamble";
import { spaceWidthFor } from "./space";


if (typeof Range !== "undefined" && !Range.prototype.getClientRects) {
  Object.defineProperty(Range.prototype, "getClientRects", {
    configurable: true,
    value: () => [],
  });
}

let view: EditorView | null = null;

function mount(doc: string): EditorView {
  const parent = document.createElement("div");
  document.body.append(parent);
  view = new EditorView({
    state: EditorState.create({ doc, selection: { anchor: doc.length }, extensions: [latexTreeSupport()] }),
    parent,
  });
  return parsedView(view);
}

function argumentOf(state: EditorState, pos: number, type: string): SyntaxNode {
  const argument = ancestorAt(state, pos, type)?.getChild("TextArgument");
  if (!argument) throw new Error(`no ${type} argument at ${pos}`);
  return argument;
}

afterEach(() => {
  view?.destroy();
  view = null;
  document.body.innerHTML = "";
});

describe("math rendering", () => {
  it("renders inline and display math with KaTeX", () => {
    expect(renderVisualMath("E = mc^2", false).status).toBe("ready");
    expect(renderVisualMath("\\begin{equation}a = b\\end{equation}", true).status).toBe("ready");
  });

  it("falls back to the aligned body for environments KaTeX does not know", () => {
    expect(renderVisualMath("\\begin{multline}a \\\\ b\\end{multline}", true).status).toBe("ready");
  });

  it("shows the source with the error when rendering fails", () => {
    const element = document.createElement("span");
    const result = paintMath(element, "\\frac{1", false);
    expect(result.status).toBe("error");
    expect(element.classList.contains("ofl-visual-math-error")).toBe(true);
    expect(element.textContent).toBe("\\frac{1");
    expect(element.title.length).toBeGreaterThan(0);
  });
});

describe("preamble widget", () => {
  it("shows the collapsed bar and expands on click", () => {
    const editor = mount(TITLE_DOCUMENT);
    const element = new PreambleWidget(false).toDOM(editor);
    const bar = element.querySelector<HTMLElement>(".ofl-visual-preamble-widget");
    expect(bar?.textContent).toBe("visual.preamble.show");
    expect(bar?.getAttribute("aria-expanded")).toBe("false");
    bar?.dispatchEvent(new MouseEvent("mouseup", { button: 0, bubbles: true }));
    expect(editor.state.selection.main.head).toBe(0);
  });

  it("labels the expanded bar as hide and reports equality by state", () => {
    const editor = mount(TITLE_DOCUMENT);
    const element = new PreambleWidget(true).toDOM(editor);
    expect(element.classList.contains("ofl-visual-preamble-expanded")).toBe(true);
    expect(element.querySelector(".ofl-visual-preamble-text")?.textContent).toBe("visual.preamble.hide");
    expect(new PreambleWidget(true).eq(new PreambleWidget(true))).toBe(true);
    expect(new PreambleWidget(true).eq(new PreambleWidget(false))).toBe(false);
  });
});

describe("end of document widget", () => {
  it("renders the message in a centred bar", () => {
    const editor = mount(TITLE_DOCUMENT);
    const element = new EndDocumentWidget().toDOM(editor);
    expect(element.textContent).toBe("visual.endOfDocument");
    expect(element.className).toBe("ofl-visual-end-document");
  });
});

describe("list item widget", () => {
  it("cycles bullet styles by depth and numbers ordered lists", () => {
    expect(new ItemWidget("itemize", 1, 1).listStyle).toBe("disc");
    expect(new ItemWidget("itemize", 1, 2).listStyle).toBe("circle");
    expect(new ItemWidget("itemize", 1, 4).listStyle).toBe("disc");
    expect(new ItemWidget("enumerate", 3, 1).listStyle).toBe("decimal");
    expect(new ItemWidget("enumerate", 3, 2).listStyle).toBe("lower-alpha");
    const element = new ItemWidget("enumerate", 3, 2).toDOM();
    expect(element.style.getPropertyValue("--ofl-list-ordinal")).toBe("3");
    expect(element.style.getPropertyValue("--ofl-list-depth")).toBe("2");
  });
});

describe("character and space substitutions", () => {
  it("maps symbol commands to characters", () => {
    expect(characterSubstitution("\\ldots")).toBe("\u2026");
    expect(characterSubstitution("\\%")).toBe("%");
    expect(characterSubstitution("\\")).toBe(" ");
    expect(characterSubstitution("\\textbackslash")).toBe("\\");
    expect(characterSubstitution("\\unknown")).toBeUndefined();
  });

  it("maps spacing commands to widths", () => {
    expect(spaceWidthFor("\\quad")).toBe("1em");
    expect(spaceWidthFor("\\,")).toBe("calc(3em / 18)");
    expect(spaceWidthFor("\\bogus")).toBeUndefined();
  });

  it("builds the LaTeX logo from elements", () => {
    const element = new LatexLogoWidget().toDOM();
    expect(element.textContent).toBe("LaTeX");
    expect(element.querySelector("sup")?.textContent).toBe("a");
    expect(element.querySelector("sub")?.textContent).toBe("e");
  });
});

describe("typesetting", () => {
  it("typesets formatting commands and author separators into elements", () => {
    const editor = mount(TITLE_DOCUMENT);
    const { state } = editor;
    const title = argumentOf(state, positionOf(TITLE_DOCUMENT, "bold"), "Title");
    const element = typesetNodeInto(title, document.createElement("div"), state);
    expect(element.innerHTML).toBe("A <b>bold</b> title");
    const author = argumentOf(state, positionOf(TITLE_DOCUMENT, "Ann"), "Author");
    const authors = typesetNodeInto(author, document.createElement("div"), state);
    expect(authors.querySelectorAll(".ofl-visual-command-and")).toHaveLength(1);
    expect(authors.textContent).toBe("Ann Bob");
  });

  it("substitutes symbols and renders inline math while typesetting", () => {
    const text = "\\title{Dots\\ldots and $x^2$}\n";
    const editor = mount(text);
    const title = argumentOf(editor.state, 3, "Title");
    const element = typesetNodeInto(title, document.createElement("div"), editor.state);
    expect(element.textContent?.startsWith("Dots\u2026")).toBe(true);
    expect(element.querySelector(".ofl-visual-math .katex")).not.toBeNull();
  });
});
