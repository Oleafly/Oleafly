// @vitest-environment jsdom

import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { setEditorView } from "@oleafly/editor";
import { afterEach, describe, expect, it } from "vitest";
import { LATEX_ENGINE } from "@/lib/document-engine";
import { useFilesStore } from "@/store/files";
import { insertCitationKey } from "./cite-insert";

if (typeof Range !== "undefined" && !Range.prototype.getClientRects) {
  Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, value: () => [] });
}

function editor(path: string, marked: string): EditorView {
  const from = marked.indexOf("|");
  const to = marked.lastIndexOf("|") - (from === marked.lastIndexOf("|") ? 0 : 1);
  const view = new EditorView({
    state: EditorState.create({ doc: marked.replaceAll("|", ""), selection: { anchor: from, head: to } }),
    parent: document.body,
  });
  useFilesStore.setState({ activePath: path, engine: LATEX_ENGINE, engineLoaded: true });
  setEditorView(view);
  return view;
}

function result(view: EditorView): string {
  const head = view.state.selection.main.head;
  const text = view.state.doc.toString();
  return `${text.slice(0, head)}|${text.slice(head)}`;
}

afterEach(() => {
  setEditorView(null);
  document.body.replaceChildren();
  useFilesStore.setState({ activePath: null });
});

describe("insertCitationKey", () => {
  it("adds the key to the LaTeX cite list the caret is in", () => {
    const view = editor("main.tex", "See \\cite{efron1979bootstrap,benjamini1995controlling|} now.");
    expect(insertCitationKey("cox1972regression")).toBe("cox1972regression");
    expect(result(view)).toBe("See \\cite{efron1979bootstrap,benjamini1995controlling,cox1972regression|} now.");
  });

  it("writes a whole citation in LaTeX prose with the document's command", () => {
    const view = editor("main.tex", "\\parencite{a} and |");
    expect(insertCitationKey("cox1972regression")).toBe("\\parencite{cox1972regression}");
    expect(result(view)).toBe("\\parencite{a} and \\parencite{cox1972regression}|");
  });

  it("replaces a selection in prose", () => {
    const view = editor("main.tex", "See |placeholder|.");
    insertCitationKey("k");
    expect(result(view)).toBe("See \\cite{k}|.");
  });

  it("adds a Typst reference next to the one under the caret", () => {
    const view = editor("main.typ", "As @efron|.");
    expect(insertCitationKey("cox1972regression")).toBe("@cox1972regression");
    expect(result(view)).toBe("As @efron @cox1972regression|.");
  });

  it("joins an existing Markdown citation group", () => {
    const grouped = editor("paper.md", "As [@a; @b|] shows");
    expect(insertCitationKey("k")).toBe("@k");
    expect(result(grouped)).toBe("As [@a; @b; @k|] shows");
    const prose = editor("paper.md", "As |");
    insertCitationKey("k");
    expect(result(prose)).toBe("As [@k]|");
  });

  it("does nothing outside a source file", () => {
    const view = editor("notes.txt", "Plain |text");
    expect(insertCitationKey("k")).toBeNull();
    expect(view.state.doc.toString()).toBe("Plain text");
  });
});
