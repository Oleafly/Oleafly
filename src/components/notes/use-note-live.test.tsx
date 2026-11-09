// @vitest-environment jsdom
import type { WorkspaceLayout } from "@oleafly/workspace";
import { createMarkdownSourceSnapshot, type MarkdownSourceSnapshot } from "@oleafly/wysiwyg";
import { act, renderHook } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { TextOperation } from "@/features/collab/live/ot";
import { FakeChannel } from "@/features/collab/live/tests/fake-channel";
import type { LivePeer } from "@/features/collab/live/live-store";
import { PRESENCE_INTERVAL_MS } from "@/features/collab/live/presence";
import type { NoteLiveClock } from "@/features/collab/notes/note-live";

const mocks = vi.hoisted(() => ({
  toast: { info: vi.fn() },
  logError: vi.fn(async () => undefined),
}));

vi.mock("@/lib/toast", () => ({ toast: mocks.toast }));
vi.mock("@/lib/log", () => ({ logError: mocks.logError }));
vi.mock("@/lib/tauri-collab", () => ({
  collabDocOpen: vi.fn(),
  collabDocChange: vi.fn(),
  collabDocClose: vi.fn(),
  collabPresenceSet: vi.fn(),
  collabPresenceLeave: vi.fn(),
}));
vi.mock("@/store/files", async () => {
  const { create } = await import("zustand");
  return { useFilesStore: create(() => ({ projectId: null, projects: [] as { id: string; main_doc: string }[] })) };
});

import { useCollabLiveStore } from "@/features/collab/live/live-store";
import {
  claimLiveNote,
  collabHoldsDocument,
  noteLiveHolds,
  useCollabEditorGate,
  useCollabLiveNote,
  useCollabNoteNotices,
} from "@/lib/collab-live-bridge";
import { useFilesStore } from "@/store/files";
import { noteBaseExtensions, parseNoteMarkdown, serializeNoteMarkdown } from "./note-markdown";
import { NotePeerMarks, peerCaretsOf, peerMarksOf } from "./note-presence-decorations";
import { diffNoteDocs } from "./note-diff";
import { hasPending, NoteSuggestions, showSuggestions } from "./note-suggestions";
import { defaultNotesLayout, openNoteIn } from "./notes-layout";
import { loadNamespace } from "@/i18n";
import {
  handBackNote,
  installNoteLive,
  jumpToNotePeer,
  jumpToNotePeerWhenBound,
  type NoteLiveDeps,
  peerCaretsFor,
  peerMarksFor,
} from "@/features/collab/notes/note-live-port";
import type { NoteHandBack } from "@/lib/collab-live-bridge";
import { blockAtOffset } from "./note-live-doc";
import {
  COMPOSITION_SETTLE_MS,
  LIVE_FLUSH_MS,
  LIVE_HEAD_MS,
  LIVE_REBIND_MS,
  makeNoteLive,
  nextLiveNote,
  type NoteLiveHost,
  useLiveNoteClaim,
  useNoteLiveEditor,
  useNoteLiveMode,
} from "./use-note-live";
import type { NoteItem } from "./types";
import { NotesDataProvider, type NotesData } from "./notes-data";
import type { ReactNode } from "react";

const NOTE = "note-1";
const OTHER = "note-2";

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

class Host implements NoteLiveHost {
  snapshot: MarkdownSourceSnapshot | null;
  frontMatter: string;
  saved: string;
  savedDoc: ProseMirrorNode | null;
  readonly handBacks: NoteHandBack[] = [];
  readonly adopted: string[] = [];
  settled = 0;

  constructor(
    readonly editor: Editor,
    text: string,
  ) {
    const parsed = parseNoteMarkdown(text);
    this.frontMatter = parsed.frontmatter;
    this.snapshot = createMarkdownSourceSnapshot(parsed.layout, editor.getJSON());
    this.saved = text;
    this.savedDoc = editor.state.doc;
  }

  sourceOf = (doc: ProseMirrorNode): string => {
    const body = serializeNoteMarkdown(doc.toJSON(), this.snapshot);
    return this.frontMatter ? `${this.frontMatter}\n\n${body}` : body;
  };

  baseline = () => ({ text: this.saved, serialized: this.savedDoc ? this.sourceOf(this.savedDoc) : this.saved });

  settle = async () => {
    this.settled += 1;
  };

  adopt = ({ frontmatter, snapshot }: { frontmatter: string; snapshot: MarkdownSourceSnapshot | null }) => {
    this.snapshot = snapshot;
    if (frontmatter !== this.frontMatter) this.adopted.push(frontmatter);
    this.frontMatter = frontmatter;
  };

  handBack = (state: NoteHandBack) => {
    this.handBacks.push(state);
  };
}

let editors: Editor[] = [];

function editorFor(text: string): Editor {
  const editor = new Editor({
    element: document.createElement("div"),
    extensions: [...noteBaseExtensions(), NoteSuggestions, NotePeerMarks],
    content: parseNoteMarkdown(text).doc,
  });
  editors.push(editor);
  return editor;
}

async function settle(): Promise<void> {
  for (let index = 0; index < 20; index += 1) await Promise.resolve();
}

function goLive(role: "editor" | "viewer" = "editor") {
  useCollabLiveStore.setState({
    projectId: NOTE,
    role,
    share: {
      project_id: NOTE,
      server_id: "s",
      server_name: "Lab",
      server_url: "https://collab.example.org",
      shared_project_id: "shared",
      role,
      link: "https://collab.example.org/p/shared",
      account_id: "me",
    },
  });
  useCollabLiveNote.setState({ noteId: NOTE, session: { projectId: NOTE, role, accountId: "me", deviceId: "device" } });
  setRole(role);
}

function setRole(role: "editor" | "viewer") {
  useCollabLiveStore.setState({ role });
  useCollabEditorGate.setState({ projectId: NOTE, viewer: role === "viewer", locked: role === "viewer", connecting: false });
}

function peer(accountId: string, cursor: number | null, path = "note.md"): LivePeer {
  return {
    deviceId: `device-${accountId}`,
    accountId,
    person: { account_id: accountId, display_name: `Person ${accountId}`, avatar_url: null, email: null, login: null },
    path,
    cursor,
    anchor: cursor,
    seenAt: Date.now(),
    hue: 120,
  };
}

function mount(text: string, channel: FakeChannel, extra: { open?: () => Promise<null> } = {}) {
  const editor = editorFor(text);
  const host = new Host(editor, text);
  const clock = new Clock();
  const presence = { set: vi.fn(async () => undefined), leave: vi.fn(async () => undefined) };
  const transport = channel.transport();
  if (extra.open) transport.open = extra.open;
  install({ transport: () => transport, presence, clock });
  const hook = renderHook(() => useNoteLiveEditor(NOTE, editor, host));
  return { editor, host, clock, presence, hook };
}

let uninstall: (() => void) | null = null;

function install(deps: NoteLiveDeps): void {
  uninstall?.();
  uninstall = installNoteLive(deps);
}

const TEXT = "---\ntitle: Lab\nkind: note\n---\n\n# Lab\n\nFirst.\n\nSecond.\n";

beforeAll(async () => {
  await loadNamespace("notes");
});

beforeEach(() => {
  vi.clearAllMocks();
  useCollabLiveNote.setState({ noteId: null, session: null });
  useCollabNoteNotices.setState({ notices: {} });
  useCollabEditorGate.setState({ projectId: null, viewer: false, locked: false, connecting: false });
  useCollabLiveStore.setState({ projectId: null, role: null, share: null, peers: {}, status: null, pending: 0 });
  useFilesStore.setState({ projects: [{ id: NOTE, main_doc: "note.md" }] } as never);
});

afterEach(() => {
  uninstall?.();
  uninstall = null;
  for (const editor of editors) editor.destroy();
  editors = [];
  vi.useRealTimers();
});

describe("nextLiveNote", () => {
  const all = (ids: string[]) => new Set(ids);

  it("keeps the live note while it is open and shared", () => {
    expect(nextLiveNote(NOTE, { focused: null, open: all([NOTE]), visible: all([]), shared: all([NOTE]) })).toBe(NOTE);
  });

  it("drops a note that was closed or is no longer shared", () => {
    expect(nextLiveNote(NOTE, { focused: null, open: all([]), visible: all([]), shared: all([NOTE]) })).toBeNull();
    expect(nextLiveNote(NOTE, { focused: null, open: all([NOTE]), visible: all([NOTE]), shared: all([]) })).toBeNull();
  });

  it("moves to the focused shared note when the live one is not on screen", () => {
    const input = { focused: OTHER, open: all([NOTE, OTHER]), visible: all([OTHER]), shared: all([NOTE, OTHER]) };
    expect(nextLiveNote(NOTE, input)).toBe(OTHER);
    expect(nextLiveNote(null, input)).toBe(OTHER);
  });

  it("stays on a live note that is still on screen next to the focused one", () => {
    const input = { focused: OTHER, open: all([NOTE, OTHER]), visible: all([NOTE, OTHER]), shared: all([NOTE, OTHER]) };
    expect(nextLiveNote(NOTE, input)).toBe(NOTE);
  });

  it("ignores a focused note that is not shared", () => {
    expect(nextLiveNote(null, { focused: OTHER, open: all([OTHER]), visible: all([OTHER]), shared: all([]) })).toBeNull();
  });
});

describe("useLiveNoteClaim", () => {
  function layoutWith(...ids: string[]): WorkspaceLayout {
    let layout = defaultNotesLayout();
    for (const id of ids) layout = openNoteIn(layout, id, null);
    return layout;
  }

  const note = (id: string, shared: boolean) => ({ id, shared }) as NoteItem;

  it("claims the focused shared note and releases the slot on unmount", () => {
    const layout = layoutWith(NOTE);
    const { rerender, unmount } = renderHook(
      ({ focused, notes }: { focused: string | null; notes: NoteItem[] }) => useLiveNoteClaim(layout, focused, notes),
      { initialProps: { focused: NOTE, notes: [note(NOTE, true)] } },
    );
    expect(useCollabLiveNote.getState().noteId).toBe(NOTE);
    rerender({ focused: NOTE, notes: [note(NOTE, false)] });
    expect(useCollabLiveNote.getState().noteId).toBeNull();
    rerender({ focused: NOTE, notes: [note(NOTE, true)] });
    act(() => makeNoteLive(OTHER));
    expect(useCollabLiveNote.getState().noteId).toBe(NOTE);
    unmount();
    expect(useCollabLiveNote.getState().noteId).toBeNull();
  });
});

describe("useNoteLiveMode", () => {
  it("reports where live editing is for this note", () => {
    const { result } = renderHook(() => useNoteLiveMode(NOTE, true));
    expect(result.current).toBe("local");
    act(() => claimLiveNote(OTHER));
    expect(result.current).toBe("elsewhere");
    act(() => {
      claimLiveNote(NOTE);
      useCollabEditorGate.setState({ projectId: NOTE, connecting: true });
    });
    expect(result.current).toBe("connecting");
    act(() => useCollabLiveNote.setState({ session: { projectId: NOTE, role: "editor", accountId: "me", deviceId: "d" } }));
    expect(result.current).toBe("live");
  });

  it("stays local for a note that is not shared", () => {
    claimLiveNote(OTHER);
    const { result } = renderHook(() => useNoteLiveMode(NOTE, false));
    expect(result.current).toBe("local");
  });
});

describe("useNoteLiveEditor", () => {
  it("sends unsent typing at once when the app saves before quitting", async () => {
    const channel = new FakeChannel(TEXT);
    const { editor, host, hook } = mount(TEXT, channel);
    await hook.result.current.control.flush();
    await act(async () => {
      goLive();
      await settle();
    });
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    editor.commands.insertContent(" More");
    hook.result.current.control.localChanged();
    const flushing = hook.result.current.control.flush();
    channel.drain();
    await act(async () => {
      await flushing;
    });
    expect(channel.text).toBe(TEXT.replace("Second.", "Second. More"));
    expect(hook.result.current.state.live).toBe(true);
    expect(host.handBacks).toEqual([]);
  });

  it("hands the note back to be saved when the server does not confirm in time", async () => {
    const channel = new FakeChannel(TEXT);
    const { editor, host, hook } = mount(TEXT, channel);
    await act(async () => {
      goLive();
      await settle();
    });
    vi.useFakeTimers();
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    editor.commands.insertContent(" More");
    const flushing = hook.result.current.control.flush();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LIVE_FLUSH_MS);
      await flushing;
    });
    expect(host.handBacks).toEqual([
      { text: TEXT.replace("Second.", "Second. More"), base: TEXT, edited: true, reason: "dropped" },
    ]);
    expect(hook.result.current.state.live).toBe(false);
  });

  it("binds to the shared note, sends local typing and shows remote edits", async () => {
    const channel = new FakeChannel(TEXT);
    const { editor, host, clock, hook } = mount(TEXT, channel);
    expect(hook.result.current.state.live).toBe(false);
    expect(hook.result.current.control.holds()).toBe(false);
    await act(async () => {
      goLive();
      await settle();
    });
    expect(host.settled).toBe(1);
    expect(hook.result.current.state).toEqual({ live: true, readOnly: false, viewOnly: false });
    expect(hook.result.current.control.holds()).toBe(true);

    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    editor.commands.insertContent(" More");
    hook.result.current.control.localChanged();
    clock.flush();
    channel.drain();
    clock.flush();
    expect(channel.text).toBe(TEXT.replace("Second.", "Second. More"));

    const at = channel.text.indexOf("First.");
    act(() => {
      channel.remote(new TextOperation().retain(at).insert("Remote ").retain(channel.text.length - at));
      channel.drain();
      clock.flush();
    });
    expect(host.sourceOf(editor.state.doc)).toBe(channel.text);

    act(() => useCollabLiveNote.setState({ session: null }));
    expect(hook.result.current.state.live).toBe(false);
    expect(host.handBacks).toEqual([{ text: channel.text, base: channel.text, edited: false, reason: "released" }]);
  });

  it("accepts pending disk changes before binding", async () => {
    const channel = new FakeChannel(TEXT);
    const { editor, hook } = mount(TEXT, channel);
    const changed = editor.schema.nodeFromJSON(parseNoteMarkdown(TEXT.replace("First.", "First from disk.")).doc);
    showSuggestions(editor, diffNoteDocs(editor.state.doc, changed), "disk");
    expect(hasPending(editor, "disk")).toBe(true);
    await act(async () => {
      goLive();
      await settle();
    });
    expect(hasPending(editor, "disk")).toBe(false);
    expect(editor.state.doc.textContent).toContain("First from disk.");
    expect(hook.result.current.state.live).toBe(true);
  });

  it("makes the editor read-only for viewers and while connecting", async () => {
    const channel = new FakeChannel(TEXT);
    const { editor, hook } = mount(TEXT, channel);
    act(() => useCollabEditorGate.setState({ projectId: NOTE, connecting: true }));
    expect(hook.result.current.state.readOnly).toBe(true);
    expect(hook.result.current.control.holds()).toBe(true);
    expect(editor.isEditable).toBe(false);
    const proposal = editor.schema.nodeFromJSON(parseNoteMarkdown(TEXT.replace("First.", "First, proposed.")).doc);
    act(() => showSuggestions(editor, diffNoteDocs(editor.state.doc, proposal), "agent"));
    expect(hasPending(editor, "agent")).toBe(true);
    await act(async () => {
      useCollabEditorGate.setState({ projectId: NOTE, connecting: false });
      goLive("viewer");
      await settle();
    });
    expect(hook.result.current.state).toEqual({ live: true, readOnly: true, viewOnly: true });
    expect(editor.isEditable).toBe(false);
    expect(hasPending(editor, "agent")).toBe(false);
    act(() => setRole("editor"));
    expect(hook.result.current.state.readOnly).toBe(false);
    expect(editor.isEditable).toBe(true);
    act(() => setRole("viewer"));
    expect(hook.result.current.state.viewOnly).toBe(true);
  });

  it("hands unsent edits back to the save path when the live slot moves away", async () => {
    const channel = new FakeChannel(TEXT);
    const { editor, host, hook } = mount(TEXT, channel);
    await act(async () => {
      goLive();
      await settle();
    });
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    editor.commands.insertContent("!");
    hook.result.current.control.localChanged();
    act(() => useCollabLiveNote.setState({ session: null }));
    expect(host.handBacks).toHaveLength(1);
    expect(host.handBacks[0].edited).toBe(true);
    expect(host.handBacks[0].base).toBe(TEXT);
    expect(host.handBacks[0].text).toBe(TEXT.replace("Second.", "Second.!"));
  });

  it("hands back when the note cannot be opened on the server", async () => {
    const channel = new FakeChannel(TEXT);
    const { host, hook } = mount(TEXT, channel, { open: async () => null });
    await act(async () => {
      goLive();
      await settle();
    });
    expect(hook.result.current.state.live).toBe(false);
    expect(host.handBacks).toEqual([{ text: TEXT, base: TEXT, edited: false, reason: "dropped" }]);
  });

  it("binds again after the server drops the note, waiting longer each time", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const channel = new FakeChannel(TEXT);
    const open = vi.fn(async () => null);
    const { host, hook } = mount(TEXT, channel, { open });
    await act(async () => {
      goLive();
      await settle();
    });
    expect(open).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LIVE_REBIND_MS[0]);
      await settle();
    });
    expect(open).toHaveBeenCalledTimes(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LIVE_REBIND_MS[0]);
      await settle();
    });
    expect(open).toHaveBeenCalledTimes(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LIVE_REBIND_MS[1]);
      await settle();
    });
    expect(open).toHaveBeenCalledTimes(3);
    expect(host.handBacks.every((state) => state.reason === "dropped")).toBe(true);
    hook.unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LIVE_REBIND_MS[2]);
    });
    expect(open).toHaveBeenCalledTimes(3);
  });

  it("does not bind an editor inside an inert part of the window, and binds once it is usable", async () => {
    const channel = new FakeChannel(TEXT);
    const editor = editorFor(TEXT);
    const cover = document.createElement("div");
    cover.setAttribute("inert", "");
    cover.append(editor.view.dom);
    document.body.append(cover);
    try {
      install({ transport: () => channel.transport(), clock: new Clock() });
      const hook = renderHook(() => useNoteLiveEditor(NOTE, editor, new Host(editor, TEXT)));
      await act(async () => {
        goLive();
        await settle();
      });
      expect(channel.opens).toEqual([]);
      await act(async () => {
        cover.removeAttribute("inert");
        await new Promise((resolve) => setTimeout(resolve, 0));
        await settle();
      });
      expect(channel.opens).toHaveLength(1);
      expect(hook.result.current.state.live).toBe(true);
    } finally {
      cover.remove();
    }
  });

  it("keeps typing and a pending remote edit when the live store has already moved on at hand back", async () => {
    const channel = new FakeChannel(TEXT);
    const { editor, hook } = mount(TEXT, channel);
    await act(async () => {
      goLive();
      await settle();
    });
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    editor.commands.insertContent(" More");
    hook.result.current.control.localChanged();
    const at = channel.text.indexOf("First.");
    channel.remote(new TextOperation().retain(at).insert("Remote ").retain(channel.text.length - at));
    channel.drain();
    act(() => {
      useCollabLiveStore.setState({ projectId: "elsewhere", role: null });
      useCollabLiveNote.setState({ session: null });
    });
    expect(editor.state.doc.textContent).toContain("Remote First.");
    expect(editor.state.doc.textContent).toContain("Second. More");
  });

  it("holds the note's path while bound, finds its jumper by path and sends typing when handed back", async () => {
    const channel = new FakeChannel(TEXT);
    const { editor, hook } = mount(TEXT, channel);
    const waiting = jumpToNotePeerWhenBound(NOTE, "note.md", "alice", 5_000);
    await act(async () => {
      goLive();
      await settle();
    });
    await expect(waiting).resolves.toBe(true);
    expect(collabHoldsDocument("note.md")).toBe(true);
    expect(noteLiveHolds(NOTE, "note.md")).toBe(true);
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    editor.commands.insertContent("!");
    hook.result.current.control.localChanged();
    const handing = handBackNote(NOTE, 50);
    channel.drain();
    await act(async () => {
      await handing;
    });
    expect(channel.text).toBe(TEXT.replace("Second.", "Second.!"));
    act(() => useCollabLiveNote.setState({ session: null }));
    expect(collabHoldsDocument("note.md")).toBe(false);
    await expect(jumpToNotePeerWhenBound(NOTE, "note.md", "alice", 10)).resolves.toBe(false);
  });

  it("says inline, not in a toast, when edits were dropped", async () => {
    const channel = new FakeChannel(TEXT);
    channel.refuseChanges = true;
    const { editor, clock, hook } = mount(TEXT, channel);
    await act(async () => {
      goLive();
      await settle();
    });
    editor.commands.insertContent("x");
    hook.result.current.control.localChanged();
    act(() => {
      clock.flush();
      channel.drain();
      clock.flush();
      channel.drain();
      clock.flush();
    });
    expect(useCollabNoteNotices.getState().notices[NOTE]).toBe("refused");
    expect(mocks.toast.info).not.toHaveBeenCalled();
  });

  it("logs a failed start and stays local", async () => {
    const channel = new FakeChannel(TEXT);
    const editor = editorFor(TEXT);
    const host = new Host(editor, TEXT);
    host.settle = async () => {
      throw new Error("save failed");
    };
    install({ transport: () => channel.transport(), clock: new Clock() });
    const hook = renderHook(() => useNoteLiveEditor(NOTE, editor, host));
    await act(async () => {
      goLive();
      await settle();
    });
    expect(mocks.logError).toHaveBeenCalledWith("live note", expect.any(Error));
    expect(hook.result.current.state.live).toBe(false);
  });

  it("sends the composed text once the input method finishes", async () => {
    const channel = new FakeChannel(TEXT);
    const { editor, clock, hook } = mount(TEXT, channel);
    await act(async () => {
      goLive();
      await settle();
    });
    vi.useFakeTimers();
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    editor.commands.insertContent("你");
    editor.view.dom.dispatchEvent(new Event("compositionend"));
    editor.view.dom.dispatchEvent(new Event("compositionend"));
    vi.advanceTimersByTime(COMPOSITION_SETTLE_MS);
    clock.flush();
    channel.drain();
    expect(channel.text).toContain("Second.你");
    hook.unmount();
  });

  it("publishes presence and draws collaborators in the margin", async () => {
    const channel = new FakeChannel(TEXT);
    const { editor, presence } = mount(TEXT, channel);
    await act(async () => {
      goLive();
      await settle();
    });
    expect(presence.set).toHaveBeenCalledWith(NOTE, "note.md", expect.any(Number), expect.any(Number));
    const second = TEXT.indexOf("Second.");
    act(() => useCollabLiveStore.setState({ peers: { a: peer("alice", second), b: peer("me", 0), c: peer("bob", null) } }));
    expect(peerMarksOf(editor.state).map((mark) => mark.id)).toEqual(["alice"]);
    const alice = peerCaretsOf(editor.state).find((caret) => caret.id === "device-alice");
    expect(editor.state.doc.textBetween(alice?.head ?? 0, (alice?.head ?? 0) + 7)).toBe("Second.");
    expect(editor.view.dom.querySelector('[data-note-peer-caret="device-alice"]')?.textContent).toBe("Person alice");
    const scroll = vi.fn();
    const dom = editor.view.nodeDOM(peerMarksOf(editor.state)[0].pos) as HTMLElement;
    dom.scrollIntoView = scroll;
    jumpToNotePeer(NOTE, "alice");
    expect(scroll).toHaveBeenCalledWith({ block: "center", behavior: "smooth" });
    jumpToNotePeer(NOTE, "nobody");
    expect(scroll).toHaveBeenCalledTimes(1);
    act(() => useCollabLiveNote.setState({ session: null }));
    jumpToNotePeer(NOTE, "alice");
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(peerMarksOf(editor.state)).toEqual([]);
    expect(peerCaretsOf(editor.state)).toEqual([]);
  });

  it("sends the local selection and draws a collaborator's selection", async () => {
    const channel = new FakeChannel(TEXT);
    const { editor, presence } = mount(TEXT, channel);
    await act(async () => {
      goLive();
      await settle();
    });
    const first = textAt(editor, "First.");
    presence.set.mockClear();
    await act(async () => {
      editor.commands.setTextSelection({ from: first, to: first + 5 });
      await new Promise((resolve) => setTimeout(resolve, PRESENCE_INTERVAL_MS + 20));
    });
    const start = TEXT.indexOf("First.");
    expect(presence.set).toHaveBeenLastCalledWith(NOTE, "note.md", start + 5, start);
    const at = TEXT.indexOf("Second.");
    act(() => useCollabLiveStore.setState({ peers: { a: { ...peer("alice", at + 6), anchor: at } } }));
    expect(editor.view.dom.querySelector(".note-remote-selection")?.textContent).toBe("Second");
  });

  it("places a collaborator's caret again from their report once their edit arrives", async () => {
    const channel = new FakeChannel(TEXT);
    const { editor, clock } = mount(TEXT, channel);
    await act(async () => {
      goLive();
      await settle();
    });
    const at = TEXT.indexOf("Second.");
    act(() => useCollabLiveStore.setState({ peers: { a: peer("alice", at + 3) } }));
    const around = () => {
      const head = peerCaretsOf(editor.state)[0]?.head ?? 0;
      return [editor.state.doc.textBetween(head - 3, head), editor.state.doc.textBetween(head, head + 3)];
    };
    expect(around()).toEqual(["Sec", "ond"]);
    await act(async () => {
      channel.remote(new TextOperation().retain(at).insert("Wow").retain(channel.text.length - at));
      channel.drain();
      clock.flush();
      await settle();
    });
    expect(editor.state.doc.textContent).toContain("WowSecond.");
    expect(around()).toEqual(["Wow", "Sec"]);
  });
});

function textAt(editor: Editor, text: string): number {
  let found = -1;
  editor.state.doc.descendants((node, pos) => {
    if (found >= 0 || !node.isText) return found < 0;
    const index = node.text?.indexOf(text) ?? -1;
    if (index >= 0) found = pos + index;
    return false;
  });
  return found;
}

describe("useNoteLiveEditor edge cases", () => {
  it("does not bind when the live slot moves away before saves settle", async () => {
    const channel = new FakeChannel(TEXT);
    const editor = editorFor(TEXT);
    const host = new Host(editor, TEXT);
    let release: () => void = () => undefined;
    host.settle = () =>
      new Promise<void>((resolve) => {
        release = resolve;
      });
    install({ transport: () => channel.transport(), clock: new Clock() });
    const hook = renderHook(() => useNoteLiveEditor(NOTE, editor, host));
    await act(async () => {
      goLive();
      await settle();
    });
    act(() => useCollabLiveNote.setState({ session: null }));
    await act(async () => {
      release();
      await settle();
    });
    expect(channel.opens).toEqual([]);
    expect(hook.result.current.state.live).toBe(false);
  });

  it("logs presence that fails to send and scrolls without motion when motion is reduced", async () => {
    const channel = new FakeChannel(TEXT);
    const { editor, presence } = mount(TEXT, channel);
    presence.set.mockRejectedValue(new Error("offline"));
    const matchMedia = vi.fn(() => ({ matches: true }));
    vi.stubGlobal("matchMedia", matchMedia);
    try {
      await act(async () => {
        goLive();
        await settle();
      });
      expect(mocks.logError).toHaveBeenCalledWith("live note presence", expect.any(Error));
      act(() => useCollabLiveStore.setState({ peers: { a: peer("alice", 0) } }));
      const dom = editor.view.nodeDOM(peerMarksOf(editor.state)[0].pos) as HTMLElement;
      dom.scrollIntoView = vi.fn();
      jumpToNotePeer(NOTE, "alice");
      expect(dom.scrollIntoView).toHaveBeenCalledWith({ block: "center", behavior: "auto" });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("says edits were not sent when the role became read-only", async () => {
    const channel = new FakeChannel(TEXT);
    const { editor, clock, hook } = mount(TEXT, channel);
    await act(async () => {
      goLive();
      await settle();
    });
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    editor.commands.insertContent("?");
    hook.result.current.control.localChanged();
    act(() => clock.flush());
    act(() => {
      setRole("viewer");
      channel.reset(TEXT);
      channel.drain();
      clock.flush();
    });
    expect(useCollabNoteNotices.getState().notices[NOTE]).toBe("read_only");
    expect(mocks.toast.info).not.toHaveBeenCalled();
    expect(host(editor)).toBe(TEXT);
  });
});

function host(editor: Editor): string {
  const pad = new Host(editor, TEXT);
  return pad.sourceOf(editor.state.doc);
}

describe("peerMarksFor", () => {
  it("places each collaborator on a block once and skips everyone else", () => {
    const blockAt = (offset: number) => blockAtOffset([0, 10, 20], offset);
    const marks = peerMarksFor(
      { a: peer("a", 12), b: peer("a", 13), c: peer("b", 25), d: peer("c", 5, "assets/x.png"), e: peer("me", 1) },
      "me",
      "note.md",
      blockAt,
      "Someone",
    );
    expect(marks).toEqual([
      { id: "a", name: "Person a", hue: 120, index: 1 },
      { id: "b", name: "Person b", hue: 120, index: 2 },
    ]);
    const unnamed = { ...peer("z", 3), person: null };
    expect(peerMarksFor({ z: unnamed }, null, "note.md", () => 0, "Someone")).toEqual([{ id: "z", name: "Someone", hue: 120, index: 0 }]);
  });
});

describe("peerCaretsFor", () => {
  it("draws every other device on this file, its selection and an unnamed caret, in a stable order", () => {
    const carets = peerCaretsFor(
      {
        z: { ...peer("z", 9), anchor: 4 },
        a: { ...peer("a", 3), anchor: null, person: null },
        b: peer("b", null),
        c: peer("c", 2, "assets/x.png"),
      },
      "note.md",
    );
    expect(carets).toEqual([
      { id: "device-a", name: null, hue: 120, head: 3, anchor: 3 },
      { id: "device-z", name: "Person z", hue: 120, head: 9, anchor: 4 },
    ]);
  });
});

describe("live note heads", () => {
  it("passes remote text and, after a pause, local live text to the note list", async () => {
    const channel = new FakeChannel(TEXT);
    const editor = editorFor(TEXT);
    const host = new Host(editor, TEXT);
    const clock = new Clock();
    install({ transport: () => channel.transport(), clock });
    const noteTextChanged = vi.fn();
    const value = { notes: [], noteTextChanged } as unknown as NotesData;
    const hook = renderHook(() => useNoteLiveEditor(NOTE, editor, host), {
      wrapper: ({ children }: { children: ReactNode }) => <NotesDataProvider value={value}>{children}</NotesDataProvider>,
    });
    hook.result.current.control.localChanged();
    await act(async () => {
      goLive();
      await settle();
    });
    const at = channel.text.indexOf("First.");
    act(() => {
      channel.remote(new TextOperation().retain(at).insert("Remote ").retain(channel.text.length - at));
      channel.drain();
      clock.flush();
    });
    expect(noteTextChanged).toHaveBeenLastCalledWith(NOTE, channel.text);
    noteTextChanged.mockClear();
    vi.useFakeTimers();
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    editor.commands.insertContent(" More");
    hook.result.current.control.localChanged();
    hook.result.current.control.localChanged();
    vi.advanceTimersByTime(LIVE_HEAD_MS - 1);
    expect(noteTextChanged).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(noteTextChanged).toHaveBeenCalledTimes(1);
    expect(noteTextChanged).toHaveBeenCalledWith(NOTE, host.sourceOf(editor.state.doc));
    hook.result.current.control.localChanged();
    hook.unmount();
    vi.advanceTimersByTime(LIVE_HEAD_MS);
    expect(noteTextChanged).toHaveBeenCalledTimes(1);
  });
});
