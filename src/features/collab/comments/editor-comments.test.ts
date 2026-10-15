// @vitest-environment jsdom

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { EditorState, Transaction, type ChangeSpec } from "@codemirror/state";
import { Decoration, EditorView } from "@codemirror/view";
import { remoteChange } from "@oleafly/editor/collaboration";
import { loadNamespace } from "@/i18n";
import {
  commentDraftIn,
  commentLinesIn,
  commentSpansIn,
  editorComments,
  revealComment,
  type CommentSnapshot,
  type CommentSpan,
  type EditorCommentsSource,
} from "./editor-comments";

const DOC = ["The quick brown fox", "jumps over", "the lazy dog."].join("\n");

class Source implements EditorCommentsSource {
  path: string | null = "intro.tex";
  state: CommentSnapshot = { path: "intro.tex", spans: [], selected: null, draft: null };
  readonly listeners = new Set<() => void>();
  readonly open = vi.fn();
  readonly anchorsChanged = vi.fn();

  snapshot(): CommentSnapshot {
    return this.state;
  }

  documentPath(): string | null {
    return this.path;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  set(next: Partial<CommentSnapshot>): void {
    this.state = { ...this.state, ...next };
    for (const listener of this.listeners) listener();
  }
}

const views: EditorView[] = [];

function editor(source: Source, doc = DOC): EditorView {
  const view = new EditorView({
    state: EditorState.create({ doc, extensions: editorComments(source) }),
    parent: document.body,
  });
  views.push(view);
  return view;
}

async function tick(): Promise<void> {
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
}

function tinted(view: EditorView, selector = ".cm-comment-range"): string[] {
  return [...view.contentDOM.querySelectorAll(selector)].map((node) => node.textContent ?? "");
}

function typed(view: EditorView, changes: ChangeSpec): void {
  view.dispatch({ changes, userEvent: "input.type" });
}

function received(view: EditorView, changes: ChangeSpec): void {
  view.dispatch({ changes, annotations: [remoteChange.of(true), Transaction.addToHistory.of(false)] });
}

function markerIds(view: EditorView): (string | null)[] {
  return [...view.dom.querySelectorAll(".cm-comment-marker")].map((marker) => marker.getAttribute("data-comment-ids"));
}

const quick: CommentSpan = { id: "t-quick", from: 4, to: 9, resolved: false };
const lazy: CommentSpan = { id: "t-lazy", from: 35, to: 39, resolved: false };
const fox: CommentSpan = { id: "t-fox", from: 16, to: 19, resolved: true };

beforeAll(async () => {
  await loadNamespace("collab");
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const view of views.splice(0)) view.destroy();
});

describe("comment marks in the editor", () => {
  it("tints open threads, leaves resolved ones plain and marks their lines", async () => {
    const source = new Source();
    source.state = { ...source.state, spans: [quick, lazy, fox] };
    const view = editor(source);
    await tick();
    expect(tinted(view)).toEqual(["quick", "lazy"]);
    expect(commentLinesIn(view.state)).toEqual([1, 3]);
    const markers = [...view.dom.querySelectorAll(".cm-comment-marker")];
    expect(markers.map((marker) => marker.getAttribute("data-comment-ids"))).toEqual(["t-quick", "t-lazy"]);
  });

  it("keeps tints and markers on their text through remote edits without asking again", async () => {
    const source = new Source();
    source.state = { ...source.state, spans: [quick, lazy] };
    const view = editor(source);
    await tick();
    const snapshot = vi.spyOn(source, "snapshot");
    view.dispatch({ changes: { from: 0, insert: "Title\n\n" } });
    view.dispatch({ changes: { from: 11, insert: "very " } });
    view.dispatch({ changes: { from: 43, to: 47, insert: "" } });
    view.dispatch({ changes: { from: 45, insert: "z" } });
    await tick();
    expect(snapshot).not.toHaveBeenCalled();
    expect(tinted(view)).toEqual(["quick", "lazzy"]);
    expect(commentSpansIn(view.state)).toEqual([
      { id: "t-quick", from: 16, to: 21, resolved: false },
      { id: "t-lazy", from: 43, to: 48, resolved: false },
    ]);
    expect(commentLinesIn(view.state)).toEqual([3, 5]);
  });

  it("moves tints, markers and the draft through typing and remote edits without rebuilding them", async () => {
    const source = new Source();
    source.state = { ...source.state, spans: [quick, lazy], selected: "t-lazy", draft: { from: 10, to: 15 } };
    const view = editor(source);
    await tick();
    const rebuilt = vi.spyOn(Decoration, "mark");
    typed(view, { from: 4, insert: "very " });
    received(view, { from: 0, insert: "A " });
    received(view, { from: view.state.doc.line(3).from, insert: "Then " });
    typed(view, { from: view.state.doc.toString().indexOf("zy") + 1, insert: "zz" });
    received(view, { from: view.state.doc.toString().indexOf("dog"), to: view.state.doc.toString().indexOf("dog") + 3 });
    await tick();
    expect(rebuilt).not.toHaveBeenCalled();
    expect(view.state.doc.toString()).toBe("A The very quick brown fox\njumps over\nThen the lazzzy .");
    expect(tinted(view)).toEqual(["quick", "lazzzy"]);
    expect(tinted(view, ".cm-comment-active")).toEqual(["lazzzy"]);
    expect(tinted(view, ".cm-comment-draft")).toEqual(["brown"]);
    expect(commentSpansIn(view.state)).toEqual([
      { id: "t-quick", from: 11, to: 16, resolved: false },
      { id: "t-lazy", from: 47, to: 53, resolved: false },
    ]);
    expect(commentDraftIn(view.state)).toEqual({ from: 17, to: 22 });
    expect(commentLinesIn(view.state)).toEqual([1, 3]);
    expect(markerIds(view)).toEqual(["t-quick", "t-lazy"]);
  });

  it("moves markers to the right lines when edits split or join lines", async () => {
    const source = new Source();
    source.state = { ...source.state, spans: [quick, lazy] };
    const view = editor(source);
    await tick();
    const rebuilt = vi.spyOn(Decoration, "mark");
    typed(view, { from: 4, insert: "\n" });
    await tick();
    expect(commentLinesIn(view.state)).toEqual([2, 4]);
    received(view, { from: view.state.doc.line(3).to, to: view.state.doc.line(4).from });
    await tick();
    expect(commentLinesIn(view.state)).toEqual([2, 3]);
    typed(view, { from: view.state.doc.line(1).to, to: view.state.doc.line(2).from });
    await tick();
    expect(commentLinesIn(view.state)).toEqual([1, 2]);
    received(view, { from: view.state.doc.line(1).to, to: view.state.doc.line(2).from, insert: " " });
    await tick();
    expect(view.state.doc.toString()).toBe("The quick brown fox jumps overthe lazy dog.");
    expect(commentLinesIn(view.state)).toEqual([1]);
    expect(markerIds(view)).toEqual(["t-quick t-lazy"]);
    expect(tinted(view)).toEqual(["quick", "lazy"]);
    expect(rebuilt).not.toHaveBeenCalled();
  });

  it("keeps its own place for a thread the list reports at the same old range", async () => {
    const source = new Source();
    source.state = { ...source.state, spans: [quick] };
    const view = editor(source);
    await tick();
    view.dispatch({ changes: { from: 0, insert: "Title\n" } });
    source.set({ spans: [{ ...quick }] });
    await tick();
    expect(commentSpansIn(view.state)).toEqual([{ ...quick, from: 10, to: 15 }]);
    source.set({ spans: [{ ...quick, resolved: true }] });
    await tick();
    expect(tinted(view)).toEqual([]);
    expect(commentLinesIn(view.state)).toEqual([]);
    source.set({ spans: [{ ...quick, from: 0, to: 5 }] });
    await tick();
    expect(tinted(view)).toEqual(["Title"]);
  });

  it("drops a fresh list onto the current text and clamps it to the document", async () => {
    const source = new Source();
    const view = editor(source, "short");
    await tick();
    source.set({ spans: [{ id: "far", from: 2, to: 400, resolved: false }] });
    await tick();
    expect(commentSpansIn(view.state)).toEqual([{ id: "far", from: 2, to: 5, resolved: false }]);
    expect(tinted(view)).toEqual(["ort"]);
  });

  it("shows nothing for a document the list was not loaded for", async () => {
    const source = new Source();
    source.state = { ...source.state, spans: [quick] };
    source.path = "other.tex";
    const view = editor(source);
    await tick();
    expect(tinted(view)).toEqual([]);
    expect(commentLinesIn(view.state)).toEqual([]);
  });

  it("opens a thread from its marker or its tinted text", async () => {
    const source = new Source();
    source.state = { ...source.state, spans: [quick, lazy] };
    const view = editor(source);
    await tick();
    const marker = view.dom.querySelectorAll(".cm-comment-marker")[1];
    marker.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    expect(source.open).toHaveBeenLastCalledWith("t-lazy", "marker");
    const mark = view.contentDOM.querySelector(".cm-comment-range");
    mark?.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
    expect(source.open).toHaveBeenLastCalledWith("t-quick", "text");
    expect(source.open).toHaveBeenCalledTimes(2);
  });

  it("leaves a click on tinted text to the editor so the cursor still moves there", async () => {
    const source = new Source();
    source.state = { ...source.state, spans: [quick] };
    const view = editor(source);
    await tick();
    const click = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    view.contentDOM.querySelector(".cm-comment-range")?.dispatchEvent(click);
    expect(source.open).toHaveBeenLastCalledWith("t-quick", "text");
    expect(click.defaultPrevented).toBe(false);
  });

  it("ignores modified clicks, clicks on plain text and clicks on the gutter away from a marker", async () => {
    const source = new Source();
    source.state = { ...source.state, spans: [quick] };
    const view = editor(source);
    await tick();
    const mark = view.contentDOM.querySelector(".cm-comment-range");
    for (const modifier of [{ shiftKey: true }, { altKey: true }, { metaKey: true }, { ctrlKey: true }, { button: 1 }]) {
      mark?.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0, ...modifier }));
    }
    view.contentDOM.querySelector(".cm-line")?.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
    view.dom
      .querySelector(".cm-comment-gutter .cm-gutterElement:not(:has(.cm-comment-marker))")
      ?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    expect(source.open).not.toHaveBeenCalled();
  });

  it("puts a thread with an unreadable position at the start of the document", async () => {
    const source = new Source();
    const view = editor(source);
    await tick();
    source.set({ spans: [{ id: "odd", from: Number.NaN, to: 3.7, resolved: false }] });
    await tick();
    expect(commentSpansIn(view.state)).toEqual([{ id: "odd", from: 0, to: 3, resolved: false }]);
  });

  it("does not open a thread when text inside it is being selected", async () => {
    const source = new Source();
    source.state = { ...source.state, spans: [quick] };
    const view = editor(source);
    await tick();
    view.dispatch({ selection: { anchor: 4, head: 8 } });
    view.contentDOM.querySelector(".cm-comment-range")?.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
    expect(source.open).not.toHaveBeenCalled();
  });

  it("gives the selected thread and the draft a stronger tint and maps the draft through edits", async () => {
    const source = new Source();
    source.state = { ...source.state, spans: [quick, lazy], selected: "t-lazy", draft: { from: 10, to: 15 } };
    const view = editor(source);
    await tick();
    expect(tinted(view, ".cm-comment-active")).toEqual(["lazy"]);
    expect(tinted(view, ".cm-comment-draft")).toEqual(["brown"]);
    view.dispatch({ changes: { from: 0, insert: "A " } });
    expect(commentDraftIn(view.state)).toEqual({ from: 12, to: 17 });
    source.set({ selected: null, draft: null });
    await tick();
    expect(tinted(view, ".cm-comment-active")).toEqual([]);
    expect(commentDraftIn(view.state)).toBeNull();
  });

  it("drops the gutter marker of a thread whose text was deleted", async () => {
    const source = new Source();
    source.state = { ...source.state, spans: [quick, lazy] };
    const view = editor(source);
    await tick();
    expect(markerIds(view)).toEqual(["t-quick", "t-lazy"]);
    typed(view, { from: 4, to: 9, insert: "" });
    await tick();
    expect(commentSpansIn(view.state)[0]).toMatchObject({ id: "t-quick", from: 4, to: 4 });
    expect(commentLinesIn(view.state)).toEqual([3]);
    expect(markerIds(view)).toEqual(["t-lazy"]);
    received(view, { from: view.state.doc.toString().indexOf("lazy"), to: view.state.doc.toString().indexOf("lazy") + 4 });
    await tick();
    expect(commentLinesIn(view.state)).toEqual([]);
    expect(markerIds(view)).toEqual([]);
  });

  it("tells the source when anchored text changes and which threads lost all their text", async () => {
    const source = new Source();
    source.state = { ...source.state, spans: [quick, lazy] };
    const view = editor(source);
    await tick();
    source.anchorsChanged.mockClear();
    typed(view, { from: view.state.doc.length, insert: " The end." });
    expect(source.anchorsChanged).not.toHaveBeenCalled();
    typed(view, { from: 6, insert: "i" });
    expect(source.anchorsChanged).toHaveBeenLastCalledWith({ emptied: [], edited: true });
    received(view, { from: 4, to: 10, insert: "" });
    expect(source.anchorsChanged).toHaveBeenLastCalledWith({ emptied: ["t-quick"], edited: true });
    source.set({ spans: [lazy] });
    await tick();
    expect(source.anchorsChanged).toHaveBeenLastCalledWith({ emptied: [], edited: false });
  });

  it("flashes a revealed thread briefly", async () => {
    vi.useFakeTimers();
    const source = new Source();
    source.state = { ...source.state, spans: [quick, lazy] };
    const view = editor(source);
    await tick();
    expect(revealComment(view, "t-lazy")).toBe(true);
    expect(tinted(view, ".cm-comment-flash")).toEqual(["lazy"]);
    vi.advanceTimersByTime(2_000);
    expect(tinted(view, ".cm-comment-flash")).toEqual([]);
    expect(revealComment(view, "missing")).toBe(false);
  });
});
