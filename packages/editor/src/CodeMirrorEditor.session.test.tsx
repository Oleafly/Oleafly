// @vitest-environment jsdom

import { createElement } from "react";
import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { create } from "zustand";
import { undo, undoDepth } from "@codemirror/commands";
import { Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { CodeMirrorEditor, type EditorHost } from "./CodeMirrorEditor";
import { editBackgroundDocument, getEditorView, waitForEditorDocument } from "./controller";
import { LocalDocumentSession, type DocumentSession, type RemoteChange, type Utf16Edit } from "./document-session";
import { englishEditorMessage } from "./test-messages";

if (typeof Range !== "undefined" && !Range.prototype.getClientRects) {
  Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, value: () => [] });
}

interface HostState {
  activePath: string | null;
  docVersion: number;
  files: Record<string, string>;
}

const SETTINGS: ReturnType<EditorHost["useSettings"]> = {
  keymap: "default",
  tabSize: 2,
  lineWrap: true,
  spellcheck: false,
  harper: false,
  editorTheme: "system",
  autocomplete: false,
  autoCloseBrackets: false,
  cursorBlinking: "blink",
  highlightCurrentLine: true,
  cursorHeight: "text",
  ghostCompletion: false,
  stickyScroll: false,
  mathPreview: false,
};

let unmountEditor: (() => void) | null = null;

afterEach(() => {
  unmountEditor?.();
  unmountEditor = null;
  vi.restoreAllMocks();
});

async function mountEditor(initial: HostState, sessions: Map<string, DocumentSession>) {
  const store = create<HostState>(() => initial);
  const setContent = vi.fn((path: string, content: string) => {
    store.setState((s) => ({ files: { ...s.files, [path]: content } }));
  });
  const host: EditorHost = {
    t: englishEditorMessage,
    useActivePath: () => store((s) => s.activePath),
    getActivePath: () => store.getState().activePath,
    useDocVersion: () => store((s) => s.docVersion),
    useCompletionSyntax: () => "latex",
    getContent: (path) => store.getState().files[path] ?? "",
    setContent,
    documentSession: (path) => sessions.get(path) ?? null,
    useSettings: () => SETTINGS,
    useVisualMode: () => false,
    useEditorKeymap: () => ({}),
    useLintRefreshDeps: () => [],
  };
  unmountEditor = render(createElement(CodeMirrorEditor, { active: true, host })).unmount;
  await act(async () => {});
  return { store, setContent };
}

type HostStore = Awaited<ReturnType<typeof mountEditor>>["store"];

async function open(store: HostStore, path: string | null): Promise<void> {
  await act(async () => store.setState({ activePath: path }));
}

async function bumpVersion(store: HostStore): Promise<void> {
  await act(async () => store.setState((s) => ({ docVersion: s.docVersion + 1 })));
}

function view(): EditorView {
  const current = getEditorView();
  if (!current) throw new Error("The editor did not mount.");
  return current;
}

function typeAt(pos: number, text: string): void {
  view().dispatch({
    changes: { from: pos, insert: text },
    selection: { anchor: pos + text.length },
    annotations: Transaction.userEvent.of("input.type"),
  });
}

// Takes remote text exactly as sent, carriage returns included, the way a
// shared document fed by an older client can. Local edits must be LF.
class UncheckedRemoteSession implements DocumentSession {
  path: string;
  readonly readOnly = false;
  private content: string;
  private revision = 0;
  private readonly listeners = new Set<(change: RemoteChange) => void>();

  constructor(path: string, text: string) {
    this.path = path;
    this.content = text;
  }

  version(): number {
    return this.revision;
  }

  text(): string {
    return this.content;
  }

  applyLocal(edits: Utf16Edit[], baseVersion: number): void {
    if (baseVersion !== this.revision) throw new Error("stale edit");
    if (edits.some((edit) => edit.insert.includes("\r"))) throw new RangeError("Edits must use LF line breaks.");
    this.content = applied(this.content, edits);
    this.revision += 1;
  }

  pushRemote(edits: Utf16Edit[]): void {
    this.content = applied(this.content, edits);
    this.revision += 1;
    for (const listener of Array.from(this.listeners)) listener({ edits, version: this.revision });
  }

  subscribe(listener: (change: RemoteChange) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

function applied(text: string, edits: readonly Utf16Edit[]): string {
  let result = "";
  let position = 0;
  for (const edit of edits) {
    result += text.slice(position, edit.from) + edit.insert;
    position = edit.to;
  }
  return result + text.slice(position);
}

function sessionsOf(...sessions: DocumentSession[]): Map<string, DocumentSession> {
  return new Map(sessions.map((session) => [session.path, session] as const));
}

function listeners(session: LocalDocumentSession): () => number {
  let live = 0;
  const subscribe = session.subscribe.bind(session);
  vi.spyOn(session, "subscribe").mockImplementation((listener) => {
    live += 1;
    const stop = subscribe(listener);
    return () => {
      live -= 1;
      stop();
    };
  });
  return () => live;
}

describe("an editor bound to a document session", () => {
  it("sends minimal local edits and applies remote edits without feedback", async () => {
    const session = new LocalDocumentSession("main.tex", "hello");
    const applyLocal = vi.spyOn(session, "applyLocal");
    const { setContent } = await mountEditor(
      { activePath: "main.tex", docVersion: 0, files: { "main.tex": "stale store text" } },
      sessionsOf(session),
    );
    expect(view().state.doc.toString()).toBe("hello");

    await act(async () => view().dispatch({ changes: { from: 1, to: 5, insert: "i" } }));
    expect(applyLocal).toHaveBeenCalledExactlyOnceWith([{ from: 1, to: 5, insert: "i" }], 0);
    expect(session.text()).toBe("hi");
    expect(setContent).not.toHaveBeenCalled();

    await act(async () => session.pushRemote([{ from: 0, to: 0, insert: "A" }]));
    expect(view().state.doc.toString()).toBe("Ahi");
    expect(applyLocal).toHaveBeenCalledOnce();
  });

  it("sends each local transaction of one update with the version it was based on", async () => {
    const session = new LocalDocumentSession("main.tex", "abc");
    const applyLocal = vi.spyOn(session, "applyLocal");
    await mountEditor({ activePath: "main.tex", docVersion: 0, files: {} }, sessionsOf(session));
    const first = view().state.update({ changes: { from: 0, insert: "1" } });
    const moved = first.state.update({ selection: { anchor: 0 } });
    const second = moved.state.update({ changes: { from: 4, insert: "2" } });

    await act(async () => view().dispatch([first, moved, second]));

    expect(applyLocal.mock.calls).toEqual([
      [[{ from: 0, to: 0, insert: "1" }], 0],
      [[{ from: 4, to: 4, insert: "2" }], 1],
    ]);
    expect(session.text()).toBe("1abc2");
    expect(view().state.doc.toString()).toBe("1abc2");
  });

  it("keeps the local selection and local undo across a remote change", async () => {
    const session = new LocalDocumentSession("main.tex", "hello world");
    await mountEditor({ activePath: "main.tex", docVersion: 0, files: {} }, sessionsOf(session));
    await act(async () => typeAt(5, ","));

    await act(async () => session.pushRemote([{ from: 0, to: 0, insert: "Oh, " }]));

    expect(view().state.doc.toString()).toBe("Oh, hello, world");
    expect(view().state.selection.main.head).toBe(10);
    expect(undoDepth(view().state)).toBe(1);
    await act(async () => {
      undo(view());
    });
    expect(view().state.doc.toString()).toBe("Oh, hello world");
    expect(session.text()).toBe("Oh, hello world");
    expect(undoDepth(view().state)).toBe(0);
  });

  it("keeps a read-only session read-only and still shows remote edits", async () => {
    const session = new LocalDocumentSession("main.tex", "hello", true);
    const applyLocal = vi.spyOn(session, "applyLocal");
    const { setContent } = await mountEditor(
      { activePath: "main.tex", docVersion: 0, files: { "main.tex": "local staging text" } },
      sessionsOf(session),
    );
    expect(view().state.readOnly).toBe(true);
    expect(view().state.facet(EditorView.editable)).toBe(false);

    await act(async () => view().dispatch({ changes: { from: 0, insert: "blocked" } }));
    expect(view().state.doc.toString()).toBe("hello");
    expect(applyLocal).not.toHaveBeenCalled();
    expect(setContent).not.toHaveBeenCalled();

    await act(async () => session.pushRemote([{ from: 5, to: 5, insert: " world" }]));
    expect(view().state.doc.toString()).toBe("hello world");
  });

  it("never takes the text of a session file from the store when the store version changes", async () => {
    const session = new LocalDocumentSession("main.tex", "session text");
    const { store, setContent } = await mountEditor(
      { activePath: "main.tex", docVersion: 0, files: { "main.tex": "store text" } },
      sessionsOf(session),
    );
    const applyLocal = vi.spyOn(session, "applyLocal");

    await act(async () =>
      store.setState((s) => ({ files: { ...s.files, "main.tex": "newer store text" }, docVersion: s.docVersion + 1 })),
    );

    expect(view().state.doc.toString()).toBe("session text");
    expect(applyLocal).not.toHaveBeenCalled();
    expect(setContent).not.toHaveBeenCalled();
  });

  it("catches up with session text changed elsewhere without sending it back", async () => {
    const session = new LocalDocumentSession("main.tex", "hello");
    const { store } = await mountEditor({ activePath: "main.tex", docVersion: 0, files: {} }, sessionsOf(session));
    session.applyLocal([{ from: 5, to: 5, insert: " there" }], 0);
    const applyLocal = vi.spyOn(session, "applyLocal");

    await bumpVersion(store);
    expect(view().state.doc.toString()).toBe("hello there");
    expect(applyLocal).not.toHaveBeenCalled();

    await act(async () => typeAt(11, "!"));
    expect(applyLocal).toHaveBeenCalledExactlyOnceWith([{ from: 11, to: 11, insert: "!" }], 1);
    expect(session.text()).toBe("hello there!");
  });

  it("binds a session that appears for the open file and lets go of it again", async () => {
    const sessions = new Map<string, DocumentSession>();
    const { store, setContent } = await mountEditor(
      { activePath: "main.tex", docVersion: 0, files: { "main.tex": "local" } },
      sessions,
    );
    const session = new LocalDocumentSession("main.tex", "shared");
    sessions.set("main.tex", session);
    await bumpVersion(store);
    expect(view().state.doc.toString()).toBe("shared");
    await act(async () => typeAt(6, "!"));
    expect(session.text()).toBe("shared!");
    expect(setContent).not.toHaveBeenCalled();

    sessions.delete("main.tex");
    await bumpVersion(store);
    expect(view().state.doc.toString()).toBe("local");
    await act(async () => session.pushRemote([{ from: 0, to: 0, insert: ">" }]));
    expect(view().state.doc.toString()).toBe("local");
    await act(async () => typeAt(5, "?"));
    expect(setContent).toHaveBeenLastCalledWith("main.tex", "local?");
  });

  it("keeps UTF-16 offsets next to an emoji and in a CRLF file", async () => {
    const session = new LocalDocumentSession("main.tex", "a😀b\r\nline two\r\n");
    const applyLocal = vi.spyOn(session, "applyLocal");
    await mountEditor(
      { activePath: "main.tex", docVersion: 0, files: { "main.tex": "a😀b\nline two\n" } },
      sessionsOf(session),
    );
    expect(view().state.doc.toString()).toBe("a😀b\nline two\n");

    await act(async () => typeAt(3, "!"));
    expect(applyLocal).toHaveBeenLastCalledWith([{ from: 3, to: 3, insert: "!" }], 0);
    await act(async () => view().dispatch({ changes: { from: 1, to: 3 } }));
    expect(applyLocal).toHaveBeenLastCalledWith([{ from: 1, to: 3, insert: "" }], 1);

    const lineTwo = view().state.doc.line(2).from;
    expect(lineTwo).toBe(4);
    await act(async () => session.pushRemote([{ from: lineTwo, to: lineTwo + 4, insert: "row" }]));
    expect(view().state.doc.toString()).toBe("a!b\nrow two\n");
    expect(session.text()).toBe(view().state.doc.toString());
  });
});

describe("carriage returns in a shared document", () => {
  it("counts a remote CRLF as two characters so the editor stays as long as the session", async () => {
    const session = new UncheckedRemoteSession("refs.bib", "@book{a,\n  title={A}\n}\n");
    await mountEditor({ activePath: "refs.bib", docVersion: 0, files: {} }, sessionsOf(session));
    const end = session.text().length;

    await act(async () => session.pushRemote([{ from: end, to: end, insert: "@article{b,\r\n  title={B}\r\n}\r\n" }]));
    expect(view().state.doc.length).toBe(session.text().length);

    await act(async () => typeAt(view().state.doc.length, "X"));
    expect(session.text()).toBe("@book{a,\n  title={A}\n}\n@article{b,\r\n  title={B}\r\n}\r\nX");
    expect(view().state.doc.toString()).toBe(session.text());
  });

  it("opens a session text that holds CRLF without shifting later edits", async () => {
    const session = new UncheckedRemoteSession("main.tex", "one\r\ntwo\r\n");
    await mountEditor({ activePath: "main.tex", docVersion: 0, files: {} }, sessionsOf(session));
    expect(view().state.doc.length).toBe(session.text().length);

    await act(async () => session.pushRemote([{ from: 5, to: 8, insert: "TWO" }]));
    expect(view().state.doc.toString()).toBe("one\r\nTWO\r\n");
  });

  it("sends a local insert that carries CRLF as LF and keeps the editor on the session text", async () => {
    const session = new UncheckedRemoteSession("main.tex", "end\n");
    await mountEditor({ activePath: "main.tex", docVersion: 0, files: {} }, sessionsOf(session));

    await act(async () => view().dispatch({ changes: { from: 0, insert: "x\r\ny\r\n" } }));
    expect(session.text()).toBe("x\ny\nend\n");
    expect(view().state.doc.toString()).toBe(session.text());

    await act(async () => typeAt(view().state.doc.length, "!"));
    expect(session.text()).toBe("x\ny\nend\n!");
  });

  it("still reads CRLF as one line break in a file without a session", async () => {
    const session = new UncheckedRemoteSession("shared.tex", "a\r\nb");
    const { store, setContent } = await mountEditor(
      { activePath: "shared.tex", docVersion: 0, files: { "solo.tex": "solo\n" } },
      sessionsOf(session),
    );
    await open(store, "solo.tex");

    await act(async () => view().dispatch({ changes: { from: 0, insert: "x\r\ny\r\n" } }));
    expect(view().state.doc.toString()).toBe("x\ny\nsolo\n");
    expect(setContent).toHaveBeenLastCalledWith("solo.tex", "x\ny\nsolo\n");
  });

  it("puts the session's text back when a remote change does not fit the editor", async () => {
    const session = new UncheckedRemoteSession("main.tex", "abc");
    await mountEditor({ activePath: "main.tex", docVersion: 0, files: {} }, sessionsOf(session));
    vi.spyOn(console, "error").mockImplementation(() => {});

    await act(async () => session.pushRemote([{ from: 3, to: 3, insert: "d" }, { from: 9, to: 9, insert: "?" }]));

    expect(view().state.doc.toString()).toBe(session.text());
  });
});

describe("where the focus goes when the document changes", () => {
  function outsideField(tag: "textarea" | "input"): HTMLElement {
    const field = document.createElement(tag);
    document.body.append(field);
    field.focus();
    return field;
  }

  afterEach(() => {
    for (const field of Array.from(document.body.querySelectorAll(":scope > textarea, :scope > input"))) field.remove();
  });

  it("leaves the focus in another field when the open file is resynced", async () => {
    const { store } = await mountEditor({ activePath: "main.tex", docVersion: 0, files: { "main.tex": "a" } }, new Map());
    const comment = outsideField("textarea");

    await act(async () => store.setState((s) => ({ files: { ...s.files, "main.tex": "a reloaded" } })));
    await bumpVersion(store);

    expect(view().state.doc.toString()).toBe("a reloaded");
    expect(document.activeElement).toBe(comment);
    expect(view().hasFocus).toBe(false);
  });

  it("does not take the focus out of a text field when the open file switches", async () => {
    const { store } = await mountEditor(
      { activePath: "a.tex", docVersion: 0, files: { "a.tex": "a", "b.tex": "b" } },
      new Map(),
    );
    const search = outsideField("input");

    await open(store, "b.tex");

    expect(view().state.doc.toString()).toBe("b");
    expect(document.activeElement).toBe(search);
  });

  it("still takes the focus when a file is opened from somewhere that isn't a text field", async () => {
    const { store } = await mountEditor(
      { activePath: "a.tex", docVersion: 0, files: { "a.tex": "a", "b.tex": "b" } },
      new Map(),
    );
    const treeRow = document.createElement("button");
    document.body.append(treeRow);
    treeRow.focus();

    await open(store, "b.tex");

    expect(view().hasFocus).toBe(true);
    treeRow.remove();
  });
});

describe("switching between session files", () => {
  it("follows the session of the file it switches to", async () => {
    const a = new LocalDocumentSession("a.tex", "alpha");
    const b = new LocalDocumentSession("b.tex", "beta");
    const applyA = vi.spyOn(a, "applyLocal");
    const applyB = vi.spyOn(b, "applyLocal");
    const { store } = await mountEditor({ activePath: "a.tex", docVersion: 0, files: {} }, sessionsOf(a, b));

    await open(store, "b.tex");
    expect(view().state.doc.toString()).toBe("beta");
    await act(async () => a.pushRemote([{ from: 0, to: 0, insert: ">" }]));
    expect(view().state.doc.toString()).toBe("beta");
    await act(async () => b.pushRemote([{ from: 4, to: 4, insert: "!" }]));
    await act(async () => typeAt(0, "x"));

    expect(applyB).toHaveBeenCalledExactlyOnceWith([{ from: 0, to: 0, insert: "x" }], 1);
    expect(applyA).not.toHaveBeenCalled();
    expect(b.text()).toBe("xbeta!");
    expect(view().state.doc.toString()).toBe("xbeta!");
  });

  it("sends an edit made as soon as a session file is shown", async () => {
    const a = new LocalDocumentSession("a.tex", "a");
    const b = new LocalDocumentSession("b.tex", "b");
    const { store } = await mountEditor({ activePath: "a.tex", docVersion: 0, files: {} }, sessionsOf(a, b));
    const edited = waitForEditorDocument("b.tex").then((shown) => {
      shown?.dispatch({ changes: { from: 1, insert: "!" } });
    });

    await open(store, "b.tex");
    await edited;

    expect(b.text()).toBe("b!");
    expect(view().state.doc.toString()).toBe("b!");
  });

  it("keeps the undo history of a file whose session changed in a background tab", async () => {
    const a = new LocalDocumentSession("a.tex", "first line\nsecond line\n");
    const b = new LocalDocumentSession("b.tex", "b");
    const { store } = await mountEditor({ activePath: "a.tex", docVersion: 0, files: {} }, sessionsOf(a, b));
    await act(async () => typeAt(0, "% "));
    await open(store, "b.tex");

    const end = a.text().length;
    await act(async () => a.pushRemote([{ from: end, to: end, insert: "third line\n" }]));
    await open(store, "a.tex");

    expect(view().state.doc.toString()).toBe("% first line\nsecond line\nthird line\n");
    expect(view().state.selection.main.head).toBe(2);
    expect(undoDepth(view().state)).toBe(1);
    await act(async () => {
      undo(view());
    });
    expect(a.text()).toBe("first line\nsecond line\nthird line\n");
  });

  it("keeps the undo history of a large background file through many remote edits", async () => {
    const big = Array.from({ length: 300 }, (_, index) => `Line ${index} of a long chapter.`).join("\n");
    const a = new LocalDocumentSession("a.tex", big);
    const b = new LocalDocumentSession("b.tex", "b");
    const { store } = await mountEditor({ activePath: "a.tex", docVersion: 0, files: {} }, sessionsOf(a, b));
    await act(async () => typeAt(0, "% "));
    await open(store, "b.tex");

    await act(async () => {
      for (let index = 0; index < 200; index += 1) {
        const end = a.text().length;
        a.pushRemote([{ from: end, to: end, insert: index % 2 === 0 ? "x" : "\n" }]);
      }
    });
    await open(store, "a.tex");

    expect(view().state.doc.toString()).toBe(a.text());
    expect(view().state.selection.main.head).toBe(2);
    expect(undoDepth(view().state)).toBe(1);
    await act(async () => {
      undo(view());
    });
    expect(a.text().startsWith("Line 0 of a long chapter.")).toBe(true);
  });

  it("carries a background file's undo history to its new name when the file is renamed", async () => {
    const a = new UncheckedRemoteSession("a.tex", "first line\n");
    const b = new UncheckedRemoteSession("b.tex", "b");
    const sessions = sessionsOf(a, b);
    const listening = vi.fn();
    const subscribe = a.subscribe.bind(a);
    let live = 0;
    vi.spyOn(a, "subscribe").mockImplementation((listener) => {
      live += 1;
      listening(live);
      const stop = subscribe(listener);
      return () => {
        live -= 1;
        stop();
      };
    });
    const { store } = await mountEditor({ activePath: "a.tex", docVersion: 0, files: {} }, sessions);
    await act(async () => typeAt(0, "% "));
    await open(store, "b.tex");

    a.path = "renamed.tex";
    sessions.delete("a.tex");
    sessions.set("renamed.tex", a);
    const end = a.text().length;
    await act(async () => a.pushRemote([{ from: end, to: end, insert: "second line\n" }]));
    await open(store, "renamed.tex");

    expect(view().state.doc.toString()).toBe("% first line\nsecond line\n");
    expect(undoDepth(view().state)).toBe(1);
    expect(live).toBe(1);
  });

  it("declines background edits to a file a session holds", async () => {
    const a = new LocalDocumentSession("a.tex", "greet greet\n");
    const { store } = await mountEditor(
      { activePath: "a.tex", docVersion: 0, files: { "b.tex": "b" } },
      sessionsOf(a),
    );
    await open(store, "b.tex");

    expect(editBackgroundDocument("a.tex", "greet greet\n", [{ from: 0, to: 5, insert: "hello" }])).toBe(false);

    await open(store, "a.tex");
    expect(view().state.doc.toString()).toBe("greet greet\n");
    expect(a.text()).toBe("greet greet\n");
  });

  it("lets go of a background session once its file leaves the recent files", async () => {
    const a = new LocalDocumentSession("a.tex", "a");
    const listening = listeners(a);
    const others = Array.from({ length: 21 }, (_, index) => `other-${index}.tex`);
    const { store } = await mountEditor(
      {
        activePath: "a.tex",
        docVersion: 0,
        files: Object.fromEntries(others.map((path) => [path, `${path}\n`])),
      },
      sessionsOf(a),
    );

    for (const path of others) await open(store, path);
    expect(listening()).toBe(0);

    await act(async () => a.pushRemote([{ from: 1, to: 1, insert: "!" }]));
    await open(store, "a.tex");
    expect(view().state.doc.toString()).toBe("a!");
    expect(undoDepth(view().state)).toBe(0);
  });

  it("stops listening to every session when the editor unmounts", async () => {
    const a = new LocalDocumentSession("a.tex", "a");
    const b = new LocalDocumentSession("b.tex", "b");
    const listeningA = listeners(a);
    const listeningB = listeners(b);
    const { store } = await mountEditor({ activePath: "a.tex", docVersion: 0, files: {} }, sessionsOf(a, b));
    await open(store, "b.tex");
    expect([listeningA(), listeningB()]).toEqual([1, 1]);

    unmountEditor?.();
    unmountEditor = null;

    expect([listeningA(), listeningB()]).toEqual([0, 0]);
  });

  it("stops listening to every session when the project closes", async () => {
    const a = new LocalDocumentSession("a.tex", "a");
    const b = new LocalDocumentSession("b.tex", "b");
    const listeningA = listeners(a);
    const listeningB = listeners(b);
    const { store } = await mountEditor({ activePath: "a.tex", docVersion: 0, files: {} }, sessionsOf(a, b));
    await open(store, "b.tex");

    await open(store, null);

    expect([listeningA(), listeningB()]).toEqual([0, 0]);
    expect(view().state.doc.toString()).toBe("");
  });
});
