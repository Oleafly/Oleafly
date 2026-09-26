// @vitest-environment jsdom

import { createElement } from "react";
import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { create } from "zustand";
import { undo, undoDepth } from "@codemirror/commands";
import { Transaction } from "@codemirror/state";
import { CodeMirrorEditor, minimalReplacement, type EditorHost } from "./CodeMirrorEditor";
import { getEditorView } from "./controller";
import { englishEditorMessage } from "./test-messages";

if (typeof Range !== "undefined" && !Range.prototype.getClientRects) {
  Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, value: () => [] });
}

interface HostState {
  activePath: string | null;
  docVersion: number;
  files: Record<string, string>;
}

let unmount: (() => void) | null = null;

afterEach(() => {
  unmount?.();
  unmount = null;
});

async function mountEditor(initial: HostState) {
  const store = create<HostState>(() => initial);
  const host: EditorHost = {
    t: englishEditorMessage,
    useActivePath: () => store((s) => s.activePath),
    getActivePath: () => store.getState().activePath,
    useDocVersion: () => store((s) => s.docVersion),
    useCompletionSyntax: () => "latex",
    getContent: (path) => store.getState().files[path] ?? "",
    setContent: (path, content) =>
      store.setState((s) => ({ files: { ...s.files, [path]: content } })),
    useSettings: () => ({
      keymap: "default", tabSize: 2, lineWrap: true, spellcheck: false, harper: false,
      editorTheme: "system", autocomplete: false, autoCloseBrackets: false,
      nonBlinkingCursor: false, ghostCompletion: false, stickyScroll: false, mathPreview: false,
    }),
    useVisualMode: () => false,
    useEditorKeymap: () => ({}),
    useLintRefreshDeps: () => [],
  };
  unmount = render(createElement(CodeMirrorEditor, { active: true, host })).unmount;
  await act(async () => {});
  return store;
}

async function switchTo(store: Awaited<ReturnType<typeof mountEditor>>, path: string) {
  await act(async () => store.setState({ activePath: path }));
}

async function replaceOnDisk(store: Awaited<ReturnType<typeof mountEditor>>, path: string, content: string) {
  await act(async () =>
    store.setState((s) => ({ files: { ...s.files, [path]: content }, docVersion: s.docVersion + 1 })),
  );
}

function typeAt(pos: number, text: string) {
  const view = getEditorView()!;
  view.dispatch({
    changes: { from: pos, insert: text },
    selection: { anchor: pos + text.length },
    annotations: Transaction.userEvent.of("input.type"),
  });
}

const CHAPTER = Array.from(
  { length: 200 },
  (_, i) => `Odstavec ${i + 1}: Tento text je součástí kapitoly.`,
).join("\n");

describe("switching files", () => {
  it("brings back the cursor and undo history of a file after visiting another tab", async () => {
    const store = await mountEditor({
      activePath: "a.tex",
      docVersion: 0,
      files: { "a.tex": CHAPTER, "b.tex": "\\section{B}\n" },
    });
    const lineStart = getEditorView()!.state.doc.line(150).from;
    await act(async () => typeAt(lineStart, "NOVÉ "));
    const cursor = getEditorView()!.state.selection.main.head;

    await switchTo(store, "b.tex");
    expect(undoDepth(getEditorView()!.state)).toBe(0);
    await switchTo(store, "a.tex");

    const view = getEditorView()!;
    expect(view.state.selection.main.head).toBe(cursor);
    expect(undoDepth(view.state)).toBe(1);
    await act(async () => { undo(view); });
    expect(store.getState().files["a.tex"]).toBe(CHAPTER);
    expect(store.getState().files["b.tex"]).toBe("\\section{B}\n");
  });

  it("starts a fresh history when the file changed while it was in the background", async () => {
    const store = await mountEditor({
      activePath: "a.tex",
      docVersion: 0,
      files: { "a.tex": CHAPTER, "b.tex": "b" },
    });
    await act(async () => typeAt(getEditorView()!.state.doc.length, "\nkonec"));
    await switchTo(store, "b.tex");
    await act(async () => store.setState((s) => ({ files: { ...s.files, "a.tex": "kratší" } })));
    await switchTo(store, "a.tex");

    const view = getEditorView()!;
    expect(view.state.doc.toString()).toBe("kratší");
    expect(undoDepth(view.state)).toBe(0);
    expect(view.state.selection.main.head).toBeLessThanOrEqual("kratší".length);
  });
});

describe("external changes to the open file", () => {
  it("keeps the cursor in place when a clean file changes elsewhere", async () => {
    const store = await mountEditor({ activePath: "a.tex", docVersion: 0, files: { "a.tex": CHAPTER } });
    const view = getEditorView()!;
    const cursor = view.state.doc.line(150).from + 3;
    await act(async () => view.dispatch({ selection: { anchor: cursor } }));

    await replaceOnDisk(store, "a.tex", CHAPTER.replace("Odstavec 3:", "Odstavek 3:"));
    expect(getEditorView()!.state.selection.main.head).toBe(cursor);

    await replaceOnDisk(store, "a.tex", `${store.getState().files["a.tex"]}\nkonec`);
    expect(getEditorView()!.state.selection.main.head).toBe(cursor);

    const heading = "\\section{Úvod}\n";
    await replaceOnDisk(store, "a.tex", `${heading}${store.getState().files["a.tex"]}`);
    expect(getEditorView()!.state.selection.main.head).toBe(cursor + heading.length);
  });

  it("undoes only the user's own typing, not the external change", async () => {
    const store = await mountEditor({ activePath: "a.tex", docVersion: 0, files: { "a.tex": CHAPTER } });
    const lineStart = getEditorView()!.state.doc.line(150).from;
    await act(async () => typeAt(lineStart, "X"));
    const heading = "\\section{Úvod}\n";
    await replaceOnDisk(store, "a.tex", `${heading}${store.getState().files["a.tex"]}`);

    const view = getEditorView()!;
    await act(async () => { undo(view); });
    expect(store.getState().files["a.tex"]).toBe(`${heading}${CHAPTER}`);
  });
});

describe("minimalReplacement", () => {
  it("replaces only the changed middle of the text", () => {
    expect(minimalReplacement("abcdef", "abXYef")).toEqual({ from: 2, to: 4, insert: "XY" });
    expect(minimalReplacement("aaa", "aaaa")).toEqual({ from: 3, to: 3, insert: "a" });
    expect(minimalReplacement("aaaa", "aa")).toEqual({ from: 2, to: 4, insert: "" });
    expect(minimalReplacement("same", "same")).toEqual({ from: 4, to: 4, insert: "" });
  });

  it("never splits a surrogate pair", () => {
    const change = minimalReplacement("x😀y", "x😁y");
    expect(change).toEqual({ from: 1, to: 3, insert: "😁" });
  });

  it("rebuilds the new text for empty, astral and decomposed documents", () => {
    const splits = (text: string, at: number) =>
      at > 0 && at < text.length && /[\uD800-\uDBFF]/u.test(text[at - 1]) && /[\uDC00-\uDFFF]/u.test(text[at]);
    const pairs: Array<[string, string]> = [
      ["", "\\section{Úvod}\n"],
      ["\\section{Úvod}\n", ""],
      ["\uD83D\uDE00z", "\uD83E\uDE00z"],
      ["😀😀", "😀"],
      ["Cafe\u0301 noir", "Cafe\u0301\u0327 noir"],
      ["Příliš žluťoučký kůň", "Příliš žlutý kůň"],
      ["𝔄𝔅ℭ", "𝔄ℭ"],
    ];
    for (const [before, after] of pairs) {
      const { from, to, insert } = minimalReplacement(before, after);
      expect(before.slice(0, from) + insert + before.slice(to)).toBe(after);
      expect(splits(before, from) || splits(before, to)).toBe(false);
    }
  });
});
