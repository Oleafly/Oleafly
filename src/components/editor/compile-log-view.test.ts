// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  compileLogViewer,
  logLineCategory,
  logLineDepth,
  setLogHomeRanges,
  syncLogDocument,
} from "./compile-log-view";

if (typeof Range !== "undefined" && !Range.prototype.getClientRects) {
  Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, value: () => [] });
}

const noHomes = () => [];
const views: EditorView[] = [];

function viewer(
  doc: string,
  homeRanges: (text: string) => (readonly [number, number])[] = noHomes,
  extra: Extension = [],
) {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const view = new EditorView({
    parent,
    state: EditorState.create({ doc, extensions: [compileLogViewer(homeRanges), extra] }),
  });
  views.push(view);
  return view;
}

afterEach(() => {
  for (const view of views.splice(0)) {
    view.dom.parentElement?.remove();
    view.destroy();
  }
});

function naiveDepths(text: string): number[] {
  const depths: number[] = [];
  let depth = 0;
  for (const line of text.split("\n")) {
    depths.push(depth);
    const opens = (line.match(/\(/g) || []).length;
    const closes = (line.match(/\)/g) || []).length;
    depth = Math.max(0, depth + opens - closes);
  }
  return depths;
}

describe("log line categories", () => {
  it.each([
    ["! Undefined control sequence.", "error"],
    ["Runaway argument?", "warn"],
    ["! Emergency stop.", "error"],
    ["<inserted text> ", "warn"],
    ["l.42 \\notacommand", "lineref"],
    ["\\count@=\\count266", "register"],
    ["(./main.tex", "normal"],
    ["", "normal"],
  ])("classifies %j as %s", (line, category) => {
    expect(logLineCategory(line)).toBe(category);
  });
});

describe("log nesting depth", () => {
  it("matches a full rescan after every streamed chunk, including chunks that end mid-line", () => {
    const full = [
      "This is pdfTeX",
      "(./main.tex (./a.sty",
      "Package: a",
      ")) (./b.sty",
      "(./c.cfg)",
      "))))",
      "(./d.tex",
      "text (inline) more",
      ")",
    ].join("\n");
    const view = viewer("");
    let previous = "";
    for (let end = 3; end < full.length + 7; end += 7) {
      const next = full.slice(0, Math.min(end, full.length));
      syncLogDocument(view, previous, next);
      previous = next;
      const expected = naiveDepths(next);
      const actual = expected.map((_, index) => logLineDepth(view.state, index + 1));
      expect(actual).toEqual(expected);
    }
    expect(view.state.doc.toString()).toBe(full);
  });

  it("gives the same depths whichever line is asked for first", () => {
    const lines = Array.from({ length: 3_000 }, (_, index) =>
      index % 7 === 0 ? `(./file${index}.tex` : index % 5 === 0 ? ")" : `text ${index}`,
    );
    const text = lines.join("\n");
    const expected = naiveDepths(text);
    const state = EditorState.create({ doc: text, extensions: compileLogViewer(noHomes) });
    for (const line of [2_999, 10, 1_500, 3_000, 1]) {
      expect(logLineDepth(state, line)).toBe(expected[line - 1]);
    }
    const view = viewer(text);
    expect(logLineDepth(view.state, 2_000)).toBe(expected[1_999]);
    syncLogDocument(view, text, `${text} (more\nnext`);
    const grown = naiveDepths(`${text} (more\nnext`);
    expect(logLineDepth(view.state, 3_001)).toBe(grown[3_000]);
    expect(logLineDepth(view.state, 1_000)).toBe(grown[999]);
  });

  it("starts over when the log is replaced instead of extended", () => {
    const view = viewer("(((\nx");
    syncLogDocument(view, "(((\nx", "a\nb)\nc");
    expect(view.state.doc.toString()).toBe("a\nb)\nc");
    expect([1, 2, 3].map((line) => logLineDepth(view.state, line))).toEqual([0, 0, 0]);
  });
});

describe("log document sync", () => {
  it("appends only the new text and drops carriage returns", () => {
    const changed: (readonly [number, number])[] = [];
    const view = viewer(
      "",
      noHomes,
      EditorView.updateListener.of((update) => {
        update.changes.iterChangedRanges((fromA, toA) => changed.push([fromA, toA]));
      }),
    );
    syncLogDocument(view, "", "a\r\nb");
    syncLogDocument(view, "a\r\nb", "a\r\nb\r\nc");
    syncLogDocument(view, "a\r\nb\r\nc", "a\r\nb\r\nc\r");
    syncLogDocument(view, "a\r\nb\r\nc\r", "a\r\nb\r\nc\r\nd");
    expect(view.state.doc.toString()).toBe("a\nb\nc\nd");
    expect(changed).toEqual([
      [0, 0],
      [3, 3],
      [5, 5],
    ]);
  });

  it("keeps an unchanged log as it is", () => {
    const view = viewer("same");
    const before = view.state;
    syncLogDocument(view, "same", "same");
    expect(view.state).toBe(before);
  });
});

describe("log rendering", () => {
  it("colours errors, warnings, line references, registers and inline tokens", () => {
    const view = viewer(
      [
        "(./main.tex",
        "\\count@=\\count266",
        "Runaway argument?",
        "\\begin {document} (./intro.tex)",
        "! Undefined control sequence.",
        "l.42 \\notacommand",
        ")",
      ].join("\n"),
    );
    const lines = [...view.contentDOM.querySelectorAll(".cm-line")];
    expect(lines.map((line) => line.textContent)).toEqual([
      "(./main.tex",
      "\\count@=\\count266",
      "Runaway argument?",
      "\\begin {document} (./intro.tex)",
      "! Undefined control sequence.",
      "l.42 \\notacommand",
      ")",
    ]);
    expect(view.contentDOM.querySelector(".text-muted-foreground\\/40")?.textContent).toBe("\\count@=\\count266");
    expect(view.contentDOM.querySelector(".text-red-400")?.textContent).toBe("Runaway argument?");
    expect(view.contentDOM.querySelector(".text-red-500")?.textContent).toBe("! Undefined control sequence.");
    expect([...view.contentDOM.querySelectorAll(".text-primary")].map((node) => node.textContent)).toContain(
      "(./intro.tex)",
    );
    expect([...view.contentDOM.querySelectorAll(".text-fuchsia-500")].map((node) => node.textContent)).toEqual([
      "{",
      "}",
    ]);
    expect(view.contentDOM.querySelector(".font-semibold.text-primary")?.textContent).toBe("l.42");
    expect(lines[0].className).not.toMatch(/cm-log-indent-[1-9]/);
    expect(lines[1].className).toMatch(/cm-log-indent-1\b/);
    expect(lines[4].className).not.toMatch(/cm-log-indent-[1-9]/);
  });

  it("shows home paths as ~ while the document keeps the real text", () => {
    const raw = "(/Users/ada/.oleafly/tinytex/article.cls";
    const ranges = (text: string) => {
      const at = text.indexOf("/Users/ada");
      return at < 0 ? [] : [[at, at + "/Users/ada".length] as const];
    };
    const view = viewer(raw, ranges);
    expect(view.contentDOM.textContent).toBe("(~/.oleafly/tinytex/article.cls");
    expect(view.state.doc.toString()).toBe(raw);
  });

  it("redraws home paths when the home folder becomes known", () => {
    const raw = "(/Users/ada/x.sty";
    const view = viewer(raw);
    expect(view.contentDOM.textContent).toBe(raw);
    view.dispatch({ effects: setLogHomeRanges.of((text) => (text.includes("/Users/ada") ? [[1, 11]] : [])) });
    expect(view.contentDOM.textContent).toBe("(~/x.sty");
  });

  it("copies the selected text from the document", () => {
    const view = viewer("first line\nsecond line");
    const line = view.contentDOM.querySelector(".cm-line") as HTMLElement;
    const range = document.createRange();
    range.setStart(line.firstChild as Text, 0);
    range.setEnd(line.firstChild as Text, 5);
    document.getSelection()?.removeAllRanges();
    document.getSelection()?.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
    const setData = vi.fn();
    const event = new Event("copy", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: { setData, clearData: vi.fn(), getData: () => "" } });
    line.dispatchEvent(event);
    document.getSelection()?.removeAllRanges();
    expect(setData).toHaveBeenCalledWith("text/plain", "first");
  });

  it("copies nothing when nothing is selected instead of the whole line", () => {
    const view = viewer("first line\nsecond line");
    const line = view.contentDOM.querySelector(".cm-line") as HTMLElement;
    const caret = document.createRange();
    caret.setStart(line.firstChild as Text, 3);
    document.getSelection()?.removeAllRanges();
    document.getSelection()?.addRange(caret);
    document.dispatchEvent(new Event("selectionchange"));
    const setData = vi.fn();
    const event = new Event("copy", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: { setData, clearData: vi.fn(), getData: () => "" } });
    line.dispatchEvent(event);
    document.getSelection()?.removeAllRanges();
    expect(setData).not.toHaveBeenCalled();
  });

  it("is read-only and not focusable as a text field", () => {
    const view = viewer("a");
    expect(view.state.readOnly).toBe(true);
    expect(view.contentDOM.getAttribute("contenteditable")).toBe("false");
  });
});
