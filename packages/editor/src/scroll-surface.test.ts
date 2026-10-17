// @vitest-environment jsdom
import { syntaxTreeAvailable } from "@codemirror/language";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { latexLanguage } from "./latex";
import { NATIVE_SCROLLBAR_HIDDEN_CLASS, OVERLAY_SCROLLBAR_ATTRIBUTE } from "./overlay-scrollbar";
import { backgroundFullParse, editorOverlayScrollbars } from "./scroll-surface";

const PARAGRAPH = String.raw`\section{Means} Text with $x^2 + \alpha$ and \emph{emphasis} \cite{key}. % note
`;

function longLatex(chars: number): string {
  return PARAGRAPH.repeat(Math.ceil(chars / PARAGRAPH.length));
}

const views: EditorView[] = [];

function mount(doc: string, extensions: Extension) {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const view = new EditorView({ state: EditorState.create({ doc, extensions }), parent });
  views.push(view);
  return view;
}

async function until(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return predicate();
}

afterEach(() => {
  for (const view of views.splice(0)) {
    view.dom.parentElement?.remove();
    view.destroy();
  }
});

describe("backgroundFullParse", () => {
  it("parses a long LaTeX document to its end without the viewport reaching it", async () => {
    const doc = longLatex(260_000);
    const view = mount(doc, [latexLanguage(), backgroundFullParse()]);
    expect(syntaxTreeAvailable(view.state, doc.length)).toBe(false);
    expect(await until(() => syntaxTreeAvailable(view.state, view.state.doc.length), 8_000)).toBe(true);
  }, 15_000);

  it("leaves the parse to the viewport without the extension", async () => {
    const doc = longLatex(260_000);
    const view = mount(doc, [latexLanguage()]);
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(syntaxTreeAvailable(view.state, doc.length)).toBe(false);
  });

  it("parses again to the end after an edit at the start", async () => {
    const doc = longLatex(260_000);
    const view = mount(doc, [latexLanguage(), backgroundFullParse()]);
    expect(await until(() => syntaxTreeAvailable(view.state, view.state.doc.length), 8_000)).toBe(true);
    view.dispatch({ changes: { from: 0, insert: "\\begin{verbatim}\n" } });
    expect(await until(() => syntaxTreeAvailable(view.state, view.state.doc.length), 8_000)).toBe(true);
  }, 20_000);
});

describe("editorOverlayScrollbars", () => {
  it("mounts both bars in the editor and hides the native scrollbar until destroyed", () => {
    const view = mount("a\nb", [editorOverlayScrollbars()]);
    expect(view.dom.querySelector(`[${OVERLAY_SCROLLBAR_ATTRIBUTE}="y"]`)).not.toBeNull();
    expect(view.dom.querySelector(`[${OVERLAY_SCROLLBAR_ATTRIBUTE}="x"]`)).not.toBeNull();
    expect(view.scrollDOM.classList.contains(NATIVE_SCROLLBAR_HIDDEN_CLASS)).toBe(true);
    const dom = view.dom;
    views.splice(views.indexOf(view), 1);
    view.destroy();
    expect(dom.querySelector(`[${OVERLAY_SCROLLBAR_ATTRIBUTE}]`)).toBeNull();
    dom.parentElement?.remove();
  });
});
