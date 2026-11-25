// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import type { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getEditorView } from "@oleafly/editor";
import { CodeMirrorEditor, type EditorHost } from "@oleafly/editor/CodeMirrorEditor";
import { parseMarkdownBody } from "@oleafly/wysiwyg";
import { LiveSessions } from "@/features/collab/live/live-sessions";
import { TextOperation } from "@/features/collab/live/ot";
import { RemoteDocumentSession } from "@/features/collab/live/remote-session";
import { FakeChannel } from "@/features/collab/live/tests/fake-channel";
import { installNoteLive } from "@/features/collab/notes/note-live-port";
import type { NoteLiveClock } from "@/features/collab/notes/note-live";
import {
  collabDocumentSession,
  installCollabEditorPort,
  noteCommentSurface,
  noteLiveHolds,
  useCollabEditorGate,
  useCollabLiveProject,
} from "@/lib/collab-live-bridge";
import { mirrorFileText } from "@/lib/live-file-mirror";
import { useFilesStore } from "@/store/files";
import { markdownMathRanges } from "./markdown-source";
import { flushWysiwygPendingEdits } from "./controller";
import { WysiwygEditor } from "./WysiwygEditor";

let lastEditor: Editor | null = null;

vi.mock("@tiptap/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tiptap/react")>();
  return {
    ...actual,
    useEditor: (...args: Parameters<typeof actual.useEditor>) => {
      const editor = actual.useEditor(...args);
      lastEditor = editor;
      return editor;
    },
  };
});

class Clock implements NoteLiveClock {
  timers: { run: () => void; live: boolean }[] = [];
  micro: (() => void)[] = [];
  later(run: () => void): () => void {
    const timer = { run, live: true };
    this.timers.push(timer);
    return () => {
      timer.live = false;
    };
  }
  soon(run: () => void): void {
    this.micro.push(run);
  }
  flush(): void {
    for (let round = 0; round < 20; round += 1) {
      while (this.micro.length > 0) this.micro.shift()?.();
      const live = this.timers.filter((timer) => timer.live);
      this.timers = [];
      if (live.length === 0 && this.micro.length === 0) return;
      for (const timer of live) {
        timer.live = false;
        timer.run();
      }
    }
  }
}

const PROJECT = "p1";
const PATH = "notes.md";
const SESSION = { projectId: PROJECT, role: "editor" as const, accountId: "me", deviceId: "laptop" };

const BLOCKS = Array.from({ length: 40 }, (_, index) =>
  index % 5 === 0 ? `Block ${index} has __strong__ and +plain+ text.` : `Block ${index} reads plainly.`,
);
const LONG = `${BLOCKS.join("\n\n")}\n`;

const ROUND_TRIP = [
  "---",
  "title: Shared",
  "---",
  "# Results",
  "",
  "We measure $E = mc^2$ twice.",
  "",
  "```python",
  "print('hi')",
  "```",
  "",
  "See [the notes](<docs/my notes.md>) first.",
  "",
  "| a | b |",
  "| --- | --- |",
  "| 1 | 2 |",
  "",
  "Coffee ☕ and a 😀 here.",
  "",
  "Closing words.",
  "",
].join("\n");

interface Rig {
  channel: FakeChannel;
  document: RemoteDocumentSession;
  clock: Clock;
  editor: Editor;
  sessionFor: { current: RemoteDocumentSession | null };
  showVisual(shown: boolean): void;
}

const cleanups: (() => void)[] = [];

const SOURCE_SETTINGS: ReturnType<EditorHost["useSettings"]> = {
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

const SOURCE_HOST: EditorHost = {
  t: (key) => key,
  useActivePath: () => PATH,
  getActivePath: () => PATH,
  useDocVersion: () => useFilesStore((state) => state.docVersion),
  useCompletionSyntax: () => "latex",
  getContent: (path) => useFilesStore.getState().files[path]?.content ?? "",
  setContent: (path, content) => useFilesStore.getState().setContent(path, content),
  documentSession: collabDocumentSession,
  useSettings: () => SOURCE_SETTINGS,
  useVisualMode: () => false,
  useEditorKeymap: () => ({}),
  useLintRefreshDeps: () => [],
};

function openFile(text: string, role: "editor" | "viewer"): void {
  useFilesStore.setState({
    projectId: PROJECT,
    activePath: PATH,
    files: { [PATH]: { content: text, dirty: false } },
  } as unknown as ReturnType<typeof useFilesStore.getState>);
  const viewer = role === "viewer";
  useCollabEditorGate.setState({ projectId: PROJECT, viewer, locked: viewer, connecting: false, suggesting: false });
  useCollabLiveProject.setState({ session: { ...SESSION, role } });
}

function mountVisual(documentSession: (path: string) => RemoteDocumentSession | null) {
  const clock = new Clock();
  cleanups.push(
    installCollabEditorPort({ documentSession, flush: async () => {} }),
    installNoteLive({
      clock,
      presence: { set: vi.fn(async () => undefined), leave: vi.fn(async () => undefined) },
    }),
  );
  const mounted = render(<WysiwygEditor wysiwyg={true} />);
  if (!lastEditor) throw new Error("the Visual editor did not mount");
  const showVisual = (shown: boolean) => mounted.rerender(<WysiwygEditor wysiwyg={shown} />);
  return { clock, editor: lastEditor, showVisual };
}

async function mountLive(text: string, options: { role?: "editor" | "viewer"; readOnly?: boolean } = {}): Promise<Rig> {
  const channel = new FakeChannel(text);
  const document = new RemoteDocumentSession(PATH, text, {
    transport: channel.transport(),
    readOnly: () => options.readOnly ?? false,
  });
  await document.open();
  cleanups.push(() => document.close());
  const sessionFor: { current: RemoteDocumentSession | null } = { current: document };
  openFile(text, options.role ?? "editor");
  return {
    channel,
    document,
    sessionFor,
    ...mountVisual((path) => (path === PATH ? sessionFor.current : null)),
  };
}

async function mountSessions(text: string) {
  const channel = new FakeChannel(text);
  openFile(text, "editor");
  const sessions = new LiveSessions({
    transport: channel.transport(),
    readOnly: () => false,
    initialText: (path) => useFilesStore.getState().files[path]?.content ?? null,
    mirror: (path, next) => mirrorFileText(PROJECT, path, next),
    detached: (path, next, edited, shared) => {
      const files = useFilesStore.getState();
      if (edited) files.setContent(path, next, { unsaved: true, base: shared });
      files.bumpDocVersion();
    },
  });
  cleanups.push(() => sessions.close());
  const visual = mountVisual((path) => sessions.documentSession(path));
  await act(async () => {});
  return { channel, sessions, ...visual };
}

function endOf(editor: Editor, text: string): number {
  let found = -1;
  editor.state.doc.descendants((node, pos) => {
    if (found >= 0 || !node.isText || !node.text) return found < 0;
    const at = node.text.indexOf(text);
    if (at >= 0) found = pos + at + text.length;
    return false;
  });
  if (found < 0) throw new Error(`"${text}" is not in the Visual editor`);
  return found;
}

function typeAt(editor: Editor, pos: number, text: string): void {
  act(() => {
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos)));
    for (const character of text) {
      const at = editor.state.selection.head;
      editor.view.dispatch(editor.state.tr.insertText(character, at));
    }
  });
}

function settle(rig: Rig): void {
  act(() => {
    for (let round = 0; round < 5; round += 1) {
      rig.clock.flush();
      rig.channel.drain();
    }
    rig.clock.flush();
  });
}

function insertAfter(text: string, anchor: string, inserted: string): TextOperation {
  const at = text.indexOf(anchor) + anchor.length;
  return new TextOperation().retain(at).insert(inserted).retain(text.length - at);
}

function caretContext(editor: Editor): string {
  const { $head } = editor.state.selection;
  return $head.parent.textBetween(0, $head.parentOffset);
}

beforeEach(() => {
  lastEditor = null;
});

afterEach(() => {
  cleanup();
  for (const stop of cleanups.splice(0).reverse()) stop();
  useCollabLiveProject.setState({ session: null });
  useCollabEditorGate.setState({ projectId: null, viewer: false, locked: false, connecting: false, suggesting: false });
  useFilesStore.setState({ projectId: null, activePath: null, files: {} } as unknown as ReturnType<typeof useFilesStore.getState>);
});

describe("Markdown Visual on a live project", () => {
  it("visual_edit_becomes_minimal_ops: a typed character is one insert between two retains", async () => {
    const rig = await mountLive(LONG);
    expect(rig.editor.isEditable).toBe(true);
    expect(noteLiveHolds(PROJECT, PATH)).toBe(true);
    typeAt(rig.editor, endOf(rig.editor, "Block 21 reads"), "!");
    settle(rig);
    const sent = rig.channel.sent.map((change) => change.op);
    expect(sent).toHaveLength(1);
    const at = LONG.indexOf("Block 21 reads") + "Block 21 reads".length;
    expect(sent[0]).toEqual([at, "!", LONG.length - at]);
    expect(rig.channel.text).toBe(`${LONG.slice(0, at)}!${LONG.slice(at)}`);
    expect(rig.channel.text).toContain("Block 20 has __strong__ and +plain+ text.");
  });

  it("turns an edit in a block the serializer would rewrite into small edits inside that block", async () => {
    const rig = await mountLive(LONG);
    typeAt(rig.editor, endOf(rig.editor, "Block 20 has "), "X");
    settle(rig);
    const [op] = rig.channel.sent.map((change) => change.op);
    const start = LONG.indexOf("Block 20 has ");
    const end = start + BLOCKS[20].length;
    let position = 0;
    for (const step of op) {
      if (typeof step === "number" && step > 0) {
        position += step;
        continue;
      }
      expect(position).toBeGreaterThanOrEqual(start);
      expect(position).toBeLessThanOrEqual(end);
      if (typeof step === "number") position -= step;
    }
    expect(rig.channel.text.slice(0, start)).toBe(LONG.slice(0, start));
    expect(rig.channel.text.slice(rig.channel.text.length - (LONG.length - end))).toBe(LONG.slice(end));
    expect(rig.channel.text).toContain("Block 20 has X");
  });

  it("markdown_visual_roundtrip_while_coauthor_types: both sides' typing survives and the text converges", async () => {
    const rig = await mountLive(ROUND_TRIP);
    typeAt(rig.editor, endOf(rig.editor, "We measure "), "now ");
    act(() => {
      rig.channel.remote(insertAfter(rig.channel.text, "Closing", " kind"));
      rig.channel.remote(insertAfter(rig.channel.text, "twice", " or thrice"));
    });
    typeAt(rig.editor, endOf(rig.editor, "first"), " please");
    settle(rig);
    act(() => {
      rig.channel.remote(insertAfter(rig.channel.text, "Coffee", " (hot)"));
    });
    typeAt(rig.editor, endOf(rig.editor, "Results"), " 2");
    settle(rig);
    const shared = rig.channel.text;
    expect(rig.document.text()).toBe(shared);
    for (const piece of ["now ", " kind", " or thrice", " please", " (hot)", "Results 2"]) expect(shared).toContain(piece);
    expect(shared.startsWith("---\ntitle: Shared\n---\n# Results 2\n")).toBe(true);
    expect(shared).toContain("```python\nprint('hi')\n```");
    expect(shared).toContain("[the notes](<docs/my notes.md>)");
    expect(shared).toContain("| 1 | 2 |");
    expect(shared).toContain("Coffee (hot) ☕ and a 😀 here.");
    expect(shared).toContain("$E = mc^2$");
    const expected = parseMarkdownBody(shared, { preservedInlineRanges: markdownMathRanges(shared) }).doc;
    expect(rig.editor.getJSON()).toEqual(expected);
    act(() => flushWysiwygPendingEdits());
    settle(rig);
    expect(rig.channel.text).toBe(shared);
  });

  it("keeps the caret and the user's half-typed word across a coauthor's edit above it", async () => {
    const rig = await mountLive(ROUND_TRIP);
    typeAt(rig.editor, endOf(rig.editor, "Closing"), " thoug");
    expect(caretContext(rig.editor)).toBe("Closing thoug");
    act(() => {
      rig.channel.remote(insertAfter(rig.channel.text, "# Results", " for May"));
    });
    settle(rig);
    expect(rig.editor.getText()).toContain("Results for May");
    expect(caretContext(rig.editor)).toBe("Closing thoug");
    typeAt(rig.editor, rig.editor.state.selection.head, "hts");
    settle(rig);
    expect(rig.channel.text).toContain("Closing thoughts words.");
    expect(rig.channel.text).toContain("# Results for May");
  });

  it("is read-only for a viewer and still shows a coauthor's edits", async () => {
    const rig = await mountLive(ROUND_TRIP, { role: "viewer", readOnly: true });
    expect(rig.editor.isEditable).toBe(false);
    expect(screen.getByTestId("visual-live-notice")).toHaveAttribute("data-lock", "view");
    act(() => {
      rig.channel.remote(insertAfter(rig.channel.text, "Closing", " remarks and"));
    });
    settle(rig);
    expect(rig.editor.getText()).toContain("Closing remarks and words.");
    expect(rig.channel.sent).toHaveLength(0);
  });

  it("registers the comment surface on the shared session and drops it when the binding ends", async () => {
    const rig = await mountLive(ROUND_TRIP);
    const surface = noteCommentSurface(PROJECT, PATH);
    expect(surface?.session).toBe(rig.document);
    const quote = "Closing";
    const from = rig.document.text().indexOf(quote);
    act(() => surface?.show({ spans: [{ id: "t1", from, to: from + quote.length, resolved: false }], selected: null, draft: null }));
    expect(rig.editor.view.dom.querySelector('[data-note-comment="t1"]')?.textContent).toBe(quote);
    act(() => {
      const start = endOf(rig.editor, "We measure ") - "We measure ".length;
      rig.editor.view.dispatch(
        rig.editor.state.tr.setSelection(TextSelection.create(rig.editor.state.doc, start, start + "We measure".length)),
      );
    });
    expect(surface?.target()).toEqual({
      from: rig.document.text().indexOf("We measure"),
      to: rig.document.text().indexOf("We measure") + "We measure".length,
      quote: "We measure",
    });
    const version = useFilesStore.getState().docVersion;
    act(() => rig.showVisual(false));
    expect(noteCommentSurface(PROJECT, PATH)).toBeNull();
    expect(noteLiveHolds(PROJECT, PATH)).toBe(false);
    expect(useFilesStore.getState().docVersion).toBeGreaterThan(version);
  });

  it("hands typing it could not send back to the file when the session detaches", async () => {
    const rig = await mountLive(ROUND_TRIP);
    typeAt(rig.editor, endOf(rig.editor, "Closing"), " late");
    act(() => {
      const [client] = rig.channel.clients.keys();
      rig.sessionFor.current = null;
      rig.channel.detach(client, "removed");
      rig.channel.drain();
    });
    expect(rig.document.phase).toBe("detached");
    expect(noteLiveHolds(PROJECT, PATH)).toBe(false);
    const file = useFilesStore.getState().files[PATH];
    expect(file.content).toContain("Closing late words.");
    expect(file.dirty).toBe(true);
    expect(rig.channel.sent).toHaveLength(0);
  });

  it("keeps the hidden source editor on the same text as Visual, and Visual on the text of the source editor", async () => {
    const rig = await mountLive(ROUND_TRIP);
    render(<CodeMirrorEditor active={false} host={SOURCE_HOST} />);
    await act(async () => {});
    const source = () => getEditorView()?.state.doc.toString();
    expect(source()).toBe(ROUND_TRIP);
    typeAt(rig.editor, endOf(rig.editor, "Closing"), " soon");
    act(() => rig.clock.flush());
    expect(rig.document.text()).toContain("Closing soon words.");
    expect(source()).toBe(rig.document.text());
    act(() => {
      const at = rig.document.text().indexOf("# Results") + "# Results".length;
      getEditorView()?.dispatch({ changes: { from: at, insert: " too" } });
    });
    expect(rig.document.text()).toContain("# Results too\n");
    expect(rig.document.text()).toContain("Closing soon words.");
    act(() => rig.clock.flush());
    expect(rig.editor.getText()).toContain("Results too");
    settle(rig);
    expect(rig.channel.text).toBe(rig.document.text());
    expect(source()).toBe(rig.document.text());
  });

  it.each([
    ["the service lets go of the document", (rig) => {
      const [client] = rig.channel.clients.keys();
      rig.channel.detach(client, "unknown_op");
      rig.channel.deliverOne(client);
    }],
    ["live editing stops", (rig) => rig.sessions.close()],
    ["the project is handed back", (rig) => rig.sessions.handBack(0)],
  ] satisfies [string, (rig: Awaited<ReturnType<typeof mountSessions>>) => unknown][])(
    "keeps typing it had not sent yet, next to typing nobody confirmed, when %s",
    async (_when, leave) => {
      const rig = await mountSessions(ROUND_TRIP);
      typeAt(rig.editor, endOf(rig.editor, "Closing"), " first");
      act(() => rig.clock.flush());
      expect(rig.channel.sent).toHaveLength(1);
      typeAt(rig.editor, endOf(rig.editor, "Closing first"), " late");
      await act(async () => {
        await leave(rig);
      });
      const file = useFilesStore.getState().files[PATH];
      expect(file.content).toContain("Closing first late words.");
      expect(file.dirty).toBe(true);
      act(() => rig.clock.flush());
    },
  );

  it("holds a coauthor's edit while the user composes and shows it once the composition ends", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const rig = await mountLive(ROUND_TRIP);
      const view = rig.editor.view;
      Object.defineProperty(view, "composing", { configurable: true, get: () => true });
      act(() => {
        rig.channel.remote(insertAfter(rig.channel.text, "Closing", " held"));
        rig.channel.drain();
        rig.clock.flush();
      });
      expect(rig.editor.getText()).not.toContain("Closing held");
      Object.defineProperty(view, "composing", { configurable: true, get: () => false });
      act(() => {
        view.dom.dispatchEvent(new Event("compositionend"));
        vi.advanceTimersByTime(100);
        rig.clock.flush();
      });
      expect(rig.editor.getText()).toContain("Closing held words.");
    } finally {
      vi.useRealTimers();
    }
  });
});
