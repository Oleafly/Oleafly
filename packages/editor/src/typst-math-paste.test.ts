// @vitest-environment jsdom
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { installEnglishEditorMessages } from "./test-messages";
import {
  applyTypstMathPaste,
  convertLatexMathSelection,
  latexMathPasteKind,
  typstMathPaste,
  typstMathPasteOffer,
} from "./typst-math-paste";

installEnglishEditorMessages();

let view: EditorView | null = null;

afterEach(() => {
  view?.destroy();
  view = null;
  document.body.replaceChildren();
});

function mount(doc: string, anchor = doc.length, head = anchor): EditorView {
  view = new EditorView({
    state: EditorState.create({
      doc,
      selection: EditorSelection.single(anchor, head),
      extensions: [typstMathPaste()],
    }),
    parent: document.body,
  });
  return view;
}

function paste(editor: EditorView, text: string) {
  const { from, to } = editor.state.selection.main;
  editor.dispatch({
    changes: { from, to, insert: text },
    selection: { anchor: from + text.length },
    userEvent: "input.paste",
  });
}

describe("latexMathPasteKind", () => {
  it.each([
    [String.raw`$\frac{a}{b}$`, "delimited"],
    [String.raw`where $x^{2}$ holds`, "delimited"],
    [String.raw`\[ a + b \]`, "delimited"],
    ["$$a$$", "delimited"],
    [String.raw`\begin{align} a &= b \end{align}`, "delimited"],
    ["$x^2$", null],
    ["plain text", null],
    [String.raw`$a \ b$`, null],
    [String.raw`\frac{a}{b}`, null],
  ])("classifies %s outside math", (text, kind) => {
    expect(latexMathPasteKind(text, false)).toBe(kind);
  });

  it("offers a bare LaTeX body only inside Typst math", () => {
    expect(latexMathPasteKind(String.raw`\alpha^{2}`, true)).toBe("body");
    expect(latexMathPasteKind("x^2", true)).toBeNull();
    expect(latexMathPasteKind(String.raw`a\,b`, true)).toBeNull();
  });
});

describe("Paste as Typst math", () => {
  it("offers the conversion after a LaTeX math paste and leaves the paste untouched", () => {
    const editor = mount("Text: ");
    paste(editor, String.raw`$\frac{a}{b}$`);
    expect(editor.state.doc.toString()).toBe(String.raw`Text: $\frac{a}{b}$`);
    expect(typstMathPasteOffer(editor.state)).toMatchObject({ from: 6, kind: "delimited" });
    expect(document.querySelector(".cm-typst-paste-offer button")?.textContent).toBe("Paste as Typst math");
  });

  it("replaces the pasted LaTeX with Typst math when accepted", async () => {
    const editor = mount("Text: ");
    paste(editor, String.raw`$\frac{a}{b}$ and \[\sqrt{x}\]`);
    await expect(applyTypstMathPaste(editor)).resolves.toBe(true);
    expect(editor.state.doc.toString()).toBe("Text: $frac(a, b)$ and $ sqrt(x) $");
    expect(typstMathPasteOffer(editor.state)).toBeNull();
  });

  it("converts a bare LaTeX body pasted inside an equation", async () => {
    const editor = mount("$  $", 2);
    paste(editor, String.raw`\alpha^{2}`);
    expect(typstMathPasteOffer(editor.state)?.kind).toBe("body");
    await applyTypstMathPaste(editor);
    expect(editor.state.doc.toString()).toBe("$ alpha^2 $");
  });

  it("accepts the offer from its button", async () => {
    const editor = mount("");
    paste(editor, String.raw`$\beta$`);
    (document.querySelector(".cm-typst-paste-offer button") as HTMLButtonElement).click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(editor.state.doc.toString()).toBe("$beta$");
  });

  it("does not offer anything for a Typst or plain paste", () => {
    const editor = mount("");
    paste(editor, "$x^2$ and text");
    expect(typstMathPasteOffer(editor.state)).toBeNull();
  });

  it("withdraws the offer on the next edit, on Escape, and when the caret leaves", () => {
    const editor = mount("");
    paste(editor, String.raw`$\gamma$`);
    editor.dispatch({ changes: { from: editor.state.doc.length, insert: " " } });
    expect(typstMathPasteOffer(editor.state)).toBeNull();

    paste(editor, String.raw`$\delta$`);
    editor.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(typstMathPasteOffer(editor.state)).toBeNull();

    editor.dispatch({ selection: { anchor: editor.state.doc.length } });
    paste(editor, String.raw`$\epsilon$`);
    editor.dispatch({ selection: { anchor: 0 } });
    expect(typstMathPasteOffer(editor.state)).toBeNull();
  });

  it("refuses a stale offer after the pasted text changed", async () => {
    const editor = mount("");
    paste(editor, String.raw`$\zeta$`);
    const offer = typstMathPasteOffer(editor.state);
    expect(offer).not.toBeNull();
    editor.dispatch({ changes: { from: 0, to: 1, insert: "#" } });
    await expect(applyTypstMathPaste(editor)).resolves.toBe(false);
    expect(editor.state.doc.toString()).toBe(String.raw`#\zeta$`);
  });
});

describe("convertLatexMathSelection", () => {
  it("wraps a bare LaTeX selection outside math in an equation", async () => {
    const doc = String.raw`See \frac{1}{2} here`;
    const editor = mount(doc, 4, 4 + String.raw`\frac{1}{2}`.length);
    await expect(convertLatexMathSelection(editor)).resolves.toBe(true);
    expect(editor.state.doc.toString()).toBe("See $frac(1, 2)$ here");
  });

  it("converts LaTeX spans inside a selected passage", async () => {
    const doc = String.raw`Let $\alpha$ and $\beta_{1}$.`;
    const editor = mount(doc, 0, doc.length);
    await convertLatexMathSelection(editor);
    expect(editor.state.doc.toString()).toBe("Let $alpha$ and $beta_1$.");
  });

  it("converts the LaTeX body of the equation at the caret", async () => {
    const doc = String.raw`Value $ \sqrt{x} + 1 $ end`;
    const editor = mount(doc, doc.indexOf("sqrt"));
    await convertLatexMathSelection(editor);
    expect(editor.state.doc.toString()).toBe("Value $ sqrt(x) + 1 $ end");
  });

  it("reports when there is nothing to convert", async () => {
    const editor = mount("Plain $x^2$ text", 8);
    await expect(convertLatexMathSelection(editor)).resolves.toBe(false);
    expect(editor.state.doc.toString()).toBe("Plain $x^2$ text");
  });
});
