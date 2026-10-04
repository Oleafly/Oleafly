// @vitest-environment jsdom

import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ancestorAt, latexTreeSupport } from "../../latex-tree";
import { parsedView, positionOf } from "../test-document";
import { RawLanguageWidget, TypstTextWidget } from "../typst/widgets";
import { BeginWidget } from "./begin";
import { BeginTheoremWidget } from "./begin-theorem";
import { BibItemWidget } from "./bibitem";
import { BraceWidget } from "./brace";
import { CharacterWidget, createCharacterWidget, hasCharacterSubstitution } from "./character";
import { DescriptionItemWidget } from "./description-item";
import { DividerWidget } from "./divider";
import { EndWidget } from "./end";
import { EndDocumentWidget } from "./end-document";
import { EnvironmentLineWidget } from "./environment-line";
import { FootnoteWidget } from "./footnote";
import { FrameWidget } from "./frame";
import { IconBraceWidget } from "./icon-brace";
import { IndicatorWidget } from "./indicator";
import { ItemWidget } from "./item";
import { LatexLogoWidget } from "./latex-logo";
import { MakeTitleWidget } from "./maketitle";
import { MathWidget } from "./math";
import { collapsePreambleEffect, type Preamble, PreambleWidget } from "./preamble";
import { RuleWidget, ruleWidgetFor } from "./rule";
import { createSpaceWidget, hasSpaceSubstitution, SpaceWidget } from "./space";
import { TexLogoWidget } from "./tex-logo";
import { TildeWidget } from "./tilde";

if (typeof Range !== "undefined" && !Range.prototype.getClientRects) {
  Object.defineProperty(Range.prototype, "getClientRects", {
    configurable: true,
    value: () => [],
  });
}

const DOC = String.raw`\title{A \textbf{bold} title}
\author{Ann \and Bob}
\author{Cy}
\begin{frame}{Slide \emph{one}}{Sub}
X
\end{frame}
\begin{theorem}[Main]
Y
\end{theorem}
`;

let view: EditorView | null = null;

function mount(doc = DOC): EditorView {
  const parent = document.createElement("div");
  document.body.append(parent);
  view = new EditorView({
    state: EditorState.create({ doc, selection: { anchor: doc.length }, extensions: [latexTreeSupport()] }),
    parent,
  });
  return parsedView(view);
}

function node(editor: EditorView, needle: string, type: string, child?: string): SyntaxNode {
  const found = ancestorAt(editor.state, positionOf(editor.state.doc.toString(), needle), type);
  const result = child ? found?.getChild(child) : found;
  if (!result) throw new Error(`no ${type} at ${needle}`);
  return result;
}

function selected(editor: EditorView): string {
  const { from, to } = editor.state.selection.main;
  return editor.state.sliceDoc(from, to);
}

afterEach(() => {
  view?.destroy();
  view = null;
  document.body.innerHTML = "";
});

describe("inline widgets", () => {
  it("render their content, compare by value and refresh in place", () => {
    const cases = [
      { widget: new BraceWidget("{"), other: new BraceWidget("}"), text: "{" },
      { widget: new IndicatorWidget("↩"), other: new IndicatorWidget("x"), text: "↩" },
      { widget: new BibItemWidget("7"), other: new BibItemWidget("8"), text: "[7]" },
      { widget: new CharacterWidget("…"), other: new CharacterWidget("§"), text: "…" },
      { widget: new TypstTextWidget("•"), other: new TypstTextWidget("•", "other"), text: "•" },
      { widget: new RawLanguageWidget("rust"), other: new RawLanguageWidget("py"), text: "rust" },
    ];
    for (const { widget, other, text } of cases) {
      const element = widget.toDOM();
      expect(element.textContent, text).toBe(text);
      expect(widget.eq(widget as never)).toBe(true);
      expect(widget.eq(other as never)).toBe(false);
      const stale = other.toDOM();
      expect(widget.updateDOM(stale)).toBe(true);
      expect(stale.textContent).toBe(text);
    }
  });

  it("let the editor handle mouse presses but not other events", () => {
    const widget = new TildeWidget();
    expect(widget.ignoreEvent(new MouseEvent("mousedown"))).toBe(false);
    expect(widget.ignoreEvent(new MouseEvent("mouseup"))).toBe(false);
    expect(widget.ignoreEvent(new KeyboardEvent("keydown"))).toBe(true);
    const element = widget.toDOM();
    expect(element.textContent).toBe(String.fromCodePoint(0xa0));
    expect(widget.coordsAt(element)).toBeDefined();
    expect(widget.eq()).toBe(true);
  });

  it("draws the TeX logos", () => {
    expect(new TexLogoWidget().toDOM().textContent).toBe("TeX");
    expect(new TexLogoWidget().eq()).toBe(true);
    expect(new LatexLogoWidget().eq()).toBe(true);
  });

  it("titles icon braces only when a title is given", () => {
    const titled = new IconBraceWidget("tag", "{", "Label");
    const element = titled.toDOM();
    expect(element.title).toBe("Label");
    expect(element.textContent).toBe("{");
    const untitled = new IconBraceWidget("tag");
    expect(untitled.updateDOM(element)).toBe(true);
    expect(element.hasAttribute("title")).toBe(false);
    expect(titled.eq(new IconBraceWidget("tag", "{", "Label"))).toBe(true);
    expect(titled.eq(new IconBraceWidget("book", "{", "Label"))).toBe(false);
    expect(titled.eq(new IconBraceWidget("tag", "", "Label"))).toBe(false);
    expect(titled.eq(new IconBraceWidget("tag", "{", "Other"))).toBe(false);
  });

  it("marks footnotes and endnotes differently", () => {
    const footnote = new FootnoteWidget();
    const element = footnote.toDOM();
    expect([element.textContent, element.title, element.getAttribute("role")]).toEqual(["*", "visual.footnote", "button"]);
    const endnote = new FootnoteWidget("endnote");
    expect(endnote.updateDOM(element)).toBe(true);
    expect([element.textContent, element.title]).toEqual(["†", "visual.endnote"]);
    expect(footnote.eq(new FootnoteWidget("footnote"))).toBe(true);
    expect(footnote.eq(endnote)).toBe(false);
  });

  it("sets list item and description depths as style properties", () => {
    const item = new ItemWidget("itemize", 2, 1);
    const element = new ItemWidget("enumerate", 1, 1).toDOM();
    expect(item.updateDOM(element)).toBe(true);
    expect(element.style.getPropertyValue("--ofl-list-style")).toBe("disc");
    expect(element.style.getPropertyValue("--ofl-list-suffix")).toBe("' '");
    expect(item.eq(new ItemWidget("itemize", 2, 1))).toBe(true);
    expect(item.eq(new ItemWidget("itemize", 3, 1))).toBe(false);
    const description = new DescriptionItemWidget(2);
    const term = description.toDOM();
    expect(term.style.getPropertyValue("--ofl-list-depth")).toBe("2");
    expect(new DescriptionItemWidget(3).updateDOM(term)).toBe(true);
    expect(term.style.getPropertyValue("--ofl-list-depth")).toBe("3");
    expect(description.eq(new DescriptionItemWidget(2))).toBe(true);
    expect(description.eq(new DescriptionItemWidget(1))).toBe(false);
  });

  it("sizes spaces and recognises only known spacing and symbol commands", () => {
    const space = createSpaceWidget("\\qquad");
    expect(space).toBeInstanceOf(SpaceWidget);
    const element = space?.toDOM() as HTMLElement;
    expect(element.style.width).toBe("2em");
    expect(new SpaceWidget("1em").updateDOM(element)).toBe(true);
    expect(element.style.width).toBe("1em");
    expect(space?.eq(new SpaceWidget("2em"))).toBe(true);
    expect(space?.eq(new SpaceWidget("1em"))).toBe(false);
    expect(createSpaceWidget("\\nothing")).toBeNull();
    expect(hasSpaceSubstitution("quad")).toBe(true);
    expect(hasSpaceSubstitution("\\nothing")).toBe(false);
    expect(createCharacterWidget("\\nothing")).toBeNull();
    expect(createCharacterWidget("ldots")?.content).toBe("…");
    expect(hasCharacterSubstitution("\\S")).toBe(true);
    expect(hasCharacterSubstitution("\\nothing")).toBe(false);
  });
});

describe("rules", () => {
  it("reads explicit lengths and full-width rules and falls back for anything else", () => {
    expect(ruleWidgetFor("\\rule", ["{\\linewidth}", "{0.5mm}"])).toMatchObject({ width: "100%", height: "0.5mm" });
    expect(ruleWidgetFor("\\rule", ["{3 cm}", "{thick}"])).toMatchObject({ width: "3cm", height: "1px" });
    expect(ruleWidgetFor("\\rule", [])).toMatchObject({ width: "2em", height: "1px" });
    expect(ruleWidgetFor("\\hrulefill", [])).toMatchObject({ width: "100%", height: "0.4pt" });
  });

  it("styles the rule element and updates it", () => {
    const rule = new RuleWidget("3cm", "2pt");
    const element = rule.toDOM();
    expect([element.style.width, element.style.borderTopWidth]).toEqual(["3cm", "2pt"]);
    expect(new RuleWidget("1cm", "1pt").updateDOM(element)).toBe(true);
    expect(element.style.width).toBe("1cm");
    expect(rule.eq(new RuleWidget("3cm", "2pt"))).toBe(true);
    expect(rule.eq(new RuleWidget("3cm", "1pt"))).toBe(false);
  });
});

describe("block widgets", () => {
  it("draw dividers, end markers and environment edges", () => {
    const divider = new DividerWidget();
    const element = divider.toDOM();
    expect(element.className).toBe("ofl-visual-divider");
    expect([divider.eq(), divider.updateDOM(), divider.coordsAt(element)]).toEqual([true, true, expect.anything()]);
    const end = new EndWidget();
    expect(end.toDOM().className).toBe("ofl-visual-end");
    expect([end.eq(), end.coordsAt(element)]).toEqual([true, expect.anything()]);
    const begin = new EnvironmentLineWidget("table*", "begin").toDOM();
    expect(begin.className).toBe("ofl-visual-environment-table ofl-visual-environment-edge ofl-visual-environment-top");
    const bottom = new EnvironmentLineWidget("figure", "end");
    expect(bottom.toDOM().firstElementChild?.classList.contains("ofl-visual-environment-last-line")).toBe(true);
    expect(bottom.eq(new EnvironmentLineWidget("figure", "end"))).toBe(true);
    expect(bottom.eq(new EnvironmentLineWidget("figure", "begin"))).toBe(false);
  });

  it("place the cursor after the block on mouse up and only take mouse up events", () => {
    const editor = mount();
    const widget = new EndDocumentWidget();
    const element = widget.toDOM(editor);
    expect(widget.estimatedHeight).toBe(32);
    expect(widget.ignoreEvent(new MouseEvent("mouseup"))).toBe(false);
    expect(widget.ignoreEvent(new MouseEvent("mousedown"))).toBe(true);
    element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
    expect(editor.state.selection.main.head).toBe(editor.lineBlockAtHeight(0).to);
    expect(widget.coordsAt(element)).toBeDefined();
  });

  it("render environment headings and rebuild them on update", () => {
    const editor = mount();
    const begin = new BeginWidget("my env!", "Abstract");
    const element = begin.toDOM(editor);
    expect(element.className).toBe("ofl-visual-begin ofl-visual-begin-myenv");
    expect(element.querySelector(".ofl-visual-environment-name")?.textContent).toBe("Abstract");
    expect(new BeginWidget("proof", "Proof").updateDOM(element, editor)).toBe(true);
    expect(element.className).toBe("ofl-visual-begin ofl-visual-begin-proof");
    expect(begin.eq(new BeginWidget("my env!", "Abstract"))).toBe(true);
    expect(begin.eq(new BeginWidget("my env!", "Summary"))).toBe(false);
  });

  it("typeset the theorem title next to its name", () => {
    const editor = mount();
    const title = node(editor, "Main", "OptionalArgument", "ShortOptionalArg");
    const theorem = new BeginTheoremWidget("theorem", "Theorem", title, "Main");
    const element = theorem.toDOM(editor);
    expect(element.classList.contains("ofl-visual-begin-theorem")).toBe(true);
    expect(element.querySelector(".ofl-visual-environment-name")?.textContent).toBe("Theorem (Main)");
    const untitled = new BeginTheoremWidget("theorem", "Theorem", null, "");
    expect(untitled.updateDOM(element, editor)).toBe(true);
    expect(element.querySelector(".ofl-visual-environment-name")?.textContent).toBe("Theorem");
    expect(element.classList.contains("ofl-visual-begin-theorem")).toBe(true);
    expect(theorem.eq(new BeginTheoremWidget("theorem", "Theorem", title, "Main"))).toBe(true);
    expect(theorem.eq(untitled)).toBe(false);
  });
});

describe("beamer frame widget", () => {
  it("typesets the title and subtitle and selects them on click", () => {
    const editor = mount();
    const [title, subtitle] = node(editor, "Slide", "BeginEnv").getChildren("TextArgument");
    const frame = new FrameWidget({
      title: { node: title, content: "Slide \\emph{one}" },
      subtitle: { node: subtitle, content: "Sub" },
    });
    const element = frame.toDOM(editor);
    const headings = element.querySelectorAll(".ofl-visual-heading");
    expect(Array.from(headings, (heading) => heading.innerHTML)).toEqual(["Slide <em>one</em>", "Sub"]);
    headings[1].dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    expect(selected(editor)).toBe("Sub");
    expect(frame.eq(new FrameWidget({ title: { node: title, content: "Slide \\emph{one}" }, subtitle: { node: subtitle, content: "Sub" } }))).toBe(true);
    expect(frame.eq(new FrameWidget({ title: { node: title, content: "Slide \\emph{one}" } }))).toBe(false);
    const plain = new FrameWidget({ title: { node: title, content: "x" } }).toDOM(editor);
    expect(plain.querySelectorAll(".ofl-visual-heading")).toHaveLength(1);
  });
});

describe("title block widget", () => {
  function preamble(editor: EditorView): Preamble {
    const title = node(editor, "bold", "Title", "TextArgument");
    const first = node(editor, "Ann", "Author", "TextArgument");
    const second = node(editor, "Cy", "Author", "TextArgument");
    return {
      from: 0,
      to: 0,
      title: { node: title, content: "{A \\textbf{bold} title}" },
      authors: [
        { node: first, content: "{Ann \\and Bob}" },
        { node: second, content: "{Cy}" },
      ],
    };
  }

  it("typesets the title and splits authors at \\and", () => {
    const editor = mount();
    const element = new MakeTitleWidget(preamble(editor)).toDOM(editor);
    expect(element.querySelector(".ofl-visual-title")?.innerHTML).toBe("A <b>bold</b> title");
    const authors = Array.from(element.querySelectorAll(".ofl-visual-author"), (author) => author.textContent?.trim());
    expect(authors).toEqual(["Ann", "Bob", "Cy"]);
  });

  it("selects the source of the clicked title or author", () => {
    const editor = mount();
    const element = new MakeTitleWidget(preamble(editor)).toDOM(editor);
    element.querySelector(".ofl-visual-title")?.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    expect(selected(editor)).toBe("A \\textbf{bold} title");
    element.querySelectorAll(".ofl-visual-author")[1].dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    expect(selected(editor)).toBe("Ann \\and Bob");
  });

  it("compares title blocks by their text", () => {
    const editor = mount();
    const base = preamble(editor);
    const widget = new MakeTitleWidget(base);
    expect(widget.eq(new MakeTitleWidget({ ...base }))).toBe(true);
    expect(widget.eq(new MakeTitleWidget({ ...base, title: undefined }))).toBe(false);
    expect(widget.eq(new MakeTitleWidget({ ...base, authors: base.authors.slice(0, 1) }))).toBe(false);
    expect(
      widget.eq(new MakeTitleWidget({ ...base, authors: [base.authors[0], { ...base.authors[1], content: "{Di}" }] })),
    ).toBe(false);
  });

  it("refills the element on update and asks the editor to measure", () => {
    const editor = mount();
    const element = new MakeTitleWidget(preamble(editor)).toDOM(editor);
    const measure = vi.spyOn(editor, "requestMeasure");
    const empty = new MakeTitleWidget({ from: 0, to: 0, authors: [] });
    expect(empty.updateDOM(element, editor)).toBe(true);
    expect(element.childElementCount).toBe(0);
    expect(measure).toHaveBeenCalled();
  });
});

describe("math widget", () => {
  it("renders display math as a block that places the cursor on click", () => {
    const editor = mount();
    const widget = new MathWidget("a\nb", true);
    const element = widget.toDOM(editor);
    expect(element.tagName).toBe("DIV");
    expect(element.className).toBe("ofl-visual-math ofl-visual-math-display");
    expect(widget.estimatedHeight).toBe(80);
    expect(widget.ignoreEvent(new MouseEvent("mouseup"))).toBe(false);
    expect(widget.ignoreEvent(new MouseEvent("mousedown"))).toBe(true);
    element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
    expect(editor.state.selection.main.head).toBe(editor.lineBlockAtHeight(0).to);
    expect(widget.coordsAt(element)).toBeDefined();
  });

  it("renders inline math that lets mouse presses through and repaints on update", () => {
    const editor = mount();
    const widget = new MathWidget("x", false);
    const element = widget.toDOM(editor);
    expect(element.tagName).toBe("SPAN");
    expect(widget.estimatedHeight).toBe(-1);
    expect(widget.ignoreEvent(new MouseEvent("mousedown"))).toBe(false);
    expect(widget.ignoreEvent(new KeyboardEvent("keydown"))).toBe(true);
    expect(new MathWidget("\\frac{1", false).updateDOM(element)).toBe(true);
    expect(element.classList.contains("ofl-visual-math-error")).toBe(true);
    expect(widget.updateDOM(element)).toBe(true);
    expect(element.classList.contains("ofl-visual-math-error")).toBe(false);
    expect(element.hasAttribute("title")).toBe(false);
    expect(widget.eq(new MathWidget("x", false))).toBe(true);
    expect(widget.eq(new MathWidget("x", true))).toBe(false);
  });
});

describe("preamble widget", () => {
  it("collapses the expanded preamble on a primary click and ignores other buttons", () => {
    const editor = mount();
    const dispatch = vi.spyOn(editor, "dispatch");
    const element = new PreambleWidget(true).toDOM(editor);
    const bar = element.querySelector(".ofl-visual-preamble-widget") as HTMLElement;
    bar.dispatchEvent(new MouseEvent("mouseup", { button: 2, bubbles: true }));
    expect(dispatch).not.toHaveBeenCalled();
    bar.dispatchEvent(new MouseEvent("mouseup", { button: 0, bubbles: true }));
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch.mock.calls[0][0]).toMatchObject({ effects: expect.anything() });
    const spec = dispatch.mock.calls[0][0] as { effects: { is: (type: unknown) => boolean; value: boolean } };
    expect(spec.effects.is(collapsePreambleEffect)).toBe(true);
    expect(spec.effects.value).toBe(true);
    expect(new PreambleWidget(true).estimatedHeight).toBe(-1);
    expect(new PreambleWidget(false).estimatedHeight).toBe(44);
  });
});
