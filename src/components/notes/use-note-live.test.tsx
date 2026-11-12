// @vitest-environment jsdom
import type { WorkspaceLayout } from "@oleafly/workspace";
import { createMarkdownSourceSnapshot, type MarkdownSourceSnapshot } from "@oleafly/wysiwyg";
import { act, renderHook, waitFor } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TextOperation } from "@/features/collab/live/ot";
import { FakeChannel } from "@/features/collab/live/tests/fake-channel";
import type { LivePeer } from "@/features/collab/live/live-store";
import { PRESENCE_KEEP_ALIVE_MS } from "@/features/collab/live/presence";
import { RemoteDocumentSession, type RemoteSessionTransport } from "@/features/collab/live/remote-session";
import type { NoteLiveClock } from "@/features/collab/notes/note-live";
import "./tests/setup";

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
  useCollabLiveProject,
  useCollabNoteNotices,
} from "@/lib/collab-live-bridge";
import { useFilesStore } from "@/store/files";
import { noteBaseExtensions, parseNoteMarkdown, serializeNoteMarkdown } from "./note-markdown";
import { NotePeerMarks, peerCaretsOf, peerMarksOf } from "./note-presence-decorations";
import { diffNoteDocs } from "./note-diff";
import { hasPending, NoteSuggestions, showSuggestions } from "./note-suggestions";
import { defaultNotesLayout, openNoteIn } from "./notes-layout";
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
  createNoteLiveEditor,
  LARGE_NOTE_CHARS,
  LIVE_FLUSH_MS,
  LIVE_HEAD_MS,
  LIVE_REBIND_MS,
  makeNoteLive,
  nextLiveNote,
  type NoteLiveHost,
  PARSED_NOTES_KEPT,
  parsedNotesKept,
  useLiveNoteClaim,
  useNoteLiveEditor,
  useNoteLiveMode,
  useNoteReadOnly,
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

function mount(text: string, channel: FakeChannel, extra: Partial<RemoteSessionTransport> = {}) {
  const editor = editorFor(text);
  const host = new Host(editor, text);
  const clock = new Clock();
  const presence = { set: vi.fn(async () => undefined), leave: vi.fn(async () => undefined) };
  const transport = { ...channel.transport(), ...extra };
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

beforeEach(() => {
  vi.clearAllMocks();
  useCollabLiveNote.setState({ noteId: null, session: null });
  useCollabLiveProject.setState({ session: null });
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
    expect(collabHoldsDocument("note.md", NOTE)).toBe(true);
    expect(collabHoldsDocument("note.md", "paper")).toBe(false);
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
    expect(collabHoldsDocument("note.md", NOTE)).toBe(false);
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
    act(() => useCollabLiveStore.setState({ peers: { a: peer("alice", second), c: peer("bob", null) } }));
    expect(peerMarksOf(editor.state).map((mark) => mark.id)).toEqual(["alice"]);
    expect(peerCaretsOf(editor.state).map((caret) => caret.id)).toEqual(["device-alice"]);
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
    act(() => {
      editor.commands.setTextSelection({ from: first, to: first + 5 });
    });
    const start = TEXT.indexOf("First.");
    await waitFor(() => expect(presence.set).toHaveBeenLastCalledWith(NOTE, "note.md", start + 5, start));
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

function around(editor: Editor): string[] {
  const head = peerCaretsOf(editor.state)[0]?.head ?? 0;
  return [editor.state.doc.textBetween(head - 3, head), editor.state.doc.textBetween(head, head + 3)];
}

describe("live note carets and margin bars", () => {
  it("places carets, margin bars and the sent caret on the right block below an empty paragraph", async () => {
    const channel = new FakeChannel(TEXT);
    const { editor, presence } = mount(TEXT, channel);
    await act(async () => {
      goLive();
      await settle();
    });
    editor.commands.setTextSelection(textAt(editor, "First.") + 6);
    editor.commands.splitBlock();
    expect(editor.state.doc.child(2).content.size).toBe(0);
    const second = TEXT.indexOf("Second.");
    act(() => useCollabLiveStore.setState({ peers: { a: peer("alice", second + 3) } }));
    expect(around(editor)).toEqual(["Sec", "ond"]);
    expect(editor.state.doc.nodeAt(peerMarksOf(editor.state)[0].pos)?.textContent).toBe("Second.");
    presence.set.mockClear();
    act(() => {
      editor.commands.setTextSelection(textAt(editor, "Second.") + 2);
    });
    await waitFor(() => expect(presence.set).toHaveBeenLastCalledWith(NOTE, "note.md", second + 2, second + 2));
  });

  it("re-places an idle collaborator's caret only once after their report, then follows the text", async () => {
    const channel = new FakeChannel(TEXT);
    const { editor, clock } = mount(TEXT, channel);
    await act(async () => {
      goLive();
      await settle();
    });
    const at = TEXT.indexOf("Second.");
    act(() => useCollabLiveStore.setState({ peers: { a: peer("alice", at + 3), b: { ...peer("bob", 0), path: "other.md" } } }));
    expect(around(editor)).toEqual(["Sec", "ond"]);
    const remote = (offset: number, text: string) =>
      act(async () => {
        channel.remote(new TextOperation().retain(offset).insert(text).retain(channel.text.length - offset));
        channel.drain();
        clock.flush();
        await settle();
      });
    await remote(channel.text.length - 1, "!");
    expect(around(editor)).toEqual(["Sec", "ond"]);
    await remote(channel.text.indexOf("First."), "Top ");
    expect(around(editor)).toEqual(["Sec", "ond"]);
    await remote(channel.text.indexOf("First."), "More ");
    expect(around(editor)).toEqual(["Sec", "ond"]);
  });

  it("shows a remote edit, the margin bars and a re-placed caret in one transaction", async () => {
    const channel = new FakeChannel(TEXT);
    const { editor, clock } = mount(TEXT, channel);
    await act(async () => {
      goLive();
      await settle();
    });
    const at = TEXT.indexOf("Second.");
    act(() => useCollabLiveStore.setState({ peers: { a: peer("alice", at + 3) } }));
    let transactions = 0;
    const count = () => {
      transactions += 1;
    };
    editor.on("transaction", count);
    await act(async () => {
      channel.remote(new TextOperation().retain(at).insert("Wow").retain(channel.text.length - at));
      channel.drain();
      clock.flush();
      await settle();
    });
    editor.off("transaction", count);
    expect(transactions).toBe(1);
    expect(around(editor)).toEqual(["Wow", "Sec"]);
    expect(editor.state.doc.nodeAt(peerMarksOf(editor.state)[0].pos)?.textContent).toBe("WowSecond.");
  });
});

describe("useNoteLiveEditor while the binding is down", () => {
  it("keeps a viewer's editor read-only while waiting to bind again", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const channel = new FakeChannel(TEXT);
    const { editor, hook } = mount(TEXT, channel, { open: async () => null });
    await act(async () => {
      goLive("viewer");
      await settle();
    });
    expect(hook.result.current.state).toEqual({ live: false, readOnly: true, viewOnly: true });
    expect(editor.isEditable).toBe(false);
    act(() => setRole("editor"));
    expect(hook.result.current.state.readOnly).toBe(false);
    expect(editor.isEditable).toBe(true);
  });

  it("waits for a reconnect when the app flushes instead of ending the live note", async () => {
    const channel = new FakeChannel(TEXT);
    const base = channel.transport();
    let opens = 0;
    let rejects = 0;
    let reopen: () => void = () => undefined;
    const { editor, host, clock, hook } = mount(TEXT, channel, {
      open: (path, onMessage) => {
        opens += 1;
        if (opens === 1) return base.open(path, onMessage);
        return new Promise((resolve) => {
          reopen = () => resolve(base.open(path, onMessage));
        });
      },
      change: (fileId, rev, op) => {
        if (rejects > 0) {
          rejects -= 1;
          return Promise.reject(new Error("The file is not open."));
        }
        return base.change(fileId, rev, op);
      },
    });
    await act(async () => {
      goLive();
      await settle();
    });
    rejects = 1;
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    editor.commands.insertContent(" More");
    hook.result.current.control.localChanged();
    await act(async () => {
      clock.flush();
      await settle();
    });
    expect(opens).toBe(2);
    const flushing = hook.result.current.control.flush();
    await act(async () => {
      await settle();
    });
    await act(async () => {
      reopen();
      await settle();
      channel.drain();
      await flushing;
    });
    expect(host.handBacks).toEqual([]);
    expect(hook.result.current.state.live).toBe(true);
    expect(channel.text).toBe(TEXT.replace("Second.", "Second. More"));
  });

  it("starts the wait to bind again from the shortest after a bind that opened", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const channel = new FakeChannel(TEXT);
    const base = channel.transport();
    const answers = [false, true, false];
    const open = vi.fn<RemoteSessionTransport["open"]>((path, onMessage) =>
      answers.shift() ? base.open(path, onMessage) : Promise.resolve(null),
    );
    const { hook } = mount(TEXT, channel, { open });
    await act(async () => {
      goLive();
      await settle();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LIVE_REBIND_MS[0]);
      await settle();
    });
    expect(open).toHaveBeenCalledTimes(2);
    expect(hook.result.current.state.live).toBe(true);
    const id = channel.opens.at(-1) ?? "";
    await act(async () => {
      channel.clients.get(id)?.outbox.push({ kind: "ack", rev: 99, length: 0 });
      channel.deliverOne(id);
      await settle();
    });
    expect(open).toHaveBeenCalledTimes(3);
    expect(hook.result.current.state.live).toBe(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LIVE_REBIND_MS[0]);
      await settle();
    });
    expect(open).toHaveBeenCalledTimes(4);
  });
});

describe("live note parse cache", () => {
  it("keeps three parsed versions of a note, and two of a large one", () => {
    expect(parsedNotesKept(10)).toBe(PARSED_NOTES_KEPT);
    expect(parsedNotesKept(LARGE_NOTE_CHARS + 1)).toBe(2);
    const editor = editorFor(TEXT);
    const host = new Host(editor, TEXT);
    const adapter = createNoteLiveEditor(editor, () => host, TEXT);
    const first = adapter.parse("A.\n");
    const second = adapter.parse("B.\n");
    expect(adapter.parse("A.\n")).toBe(first);
    adapter.parse("C.\n");
    adapter.parse("D.\n");
    expect(adapter.parse("B.\n")).toBe(second);
    expect(adapter.parse("A.\n")).not.toBe(first);
    const large = (mark: string) => `${mark}${"x".repeat(LARGE_NOTE_CHARS)}\n`;
    const big = adapter.parse(large("a"));
    adapter.parse(large("b"));
    adapter.parse(large("c"));
    expect(adapter.parse(large("a"))).not.toBe(big);
  });
});

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

  it("keeps typing that could not be sent and says so inline", async () => {
    const channel = new FakeChannel(TEXT);
    const { editor, clock, hook } = mount(TEXT, channel);
    await act(async () => {
      goLive();
      await settle();
    });
    const send = vi.spyOn(RemoteDocumentSession.prototype, "applyLocal").mockImplementationOnce(() => {
      throw new Error("The live note lost track of its text.");
    });
    try {
      editor.commands.setTextSelection(editor.state.doc.content.size - 1);
      editor.commands.insertContent(" More");
      hook.result.current.control.localChanged();
      act(() => clock.flush());
    } finally {
      send.mockRestore();
    }
    expect(editor.state.doc.textContent).toContain("Second. More");
    expect(useCollabNoteNotices.getState().notices[NOTE]).toBe("refused");
    expect(mocks.logError).toHaveBeenCalledWith("live note", expect.any(Error));
  });

  it.each([
    ["viewer", true],
    ["commenter", true],
    ["reviewer", true],
    ["editor", false],
    ["owner", false],
  ] as const)("makes a shared note read-only for a %s while it is not live", (role, locked) => {
    useFilesStore.setState({ projects: [{ id: NOTE, main_doc: "note.md", shared: { server_name: "Lab", role } }] } as never);
    const { editor, hook } = mount(TEXT, new FakeChannel(TEXT));
    const gate = renderHook(() => useNoteReadOnly(NOTE));
    expect(hook.result.current.state).toEqual({ live: false, readOnly: locked, viewOnly: locked });
    expect(editor.isEditable).toBe(!locked);
    expect(gate.result.current).toBe(locked);
  });

  it("follows the live role over the role the project list last saw", async () => {
    useFilesStore.setState({ projects: [{ id: NOTE, main_doc: "note.md", shared: { server_name: "Lab", role: "viewer" } }] } as never);
    const { editor, hook } = mount(TEXT, new FakeChannel(TEXT));
    await act(async () => {
      goLive("editor");
      await settle();
    });
    expect(hook.result.current.state).toEqual({ live: true, readOnly: false, viewOnly: false });
    expect(editor.isEditable).toBe(true);
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
    expect(editor.state.doc.textContent).not.toContain("?");
  });
});

describe("live project notes", () => {
  const PLAN = { projectId: "paper", path: "notes/Plan.md" };

  it("publishes the note's place only while its tab is shown", async () => {
    vi.useFakeTimers();
    const editor = editorFor(TEXT);
    const presence = { set: vi.fn(async () => undefined), leave: vi.fn(async () => undefined) };
    install({ transport: () => new FakeChannel(TEXT).transport(), presence, clock: new Clock() });
    const hook = renderHook(
      ({ shown }: { shown: boolean }) => useNoteLiveEditor("project-note:paper:plan", editor, new Host(editor, TEXT), PLAN, shown),
      { initialProps: { shown: false } },
    );
    await act(async () => {
      useCollabLiveProject.setState({ session: { projectId: "paper", role: "editor", accountId: "me", deviceId: "device" } });
      await settle();
    });
    expect(hook.result.current.state.live).toBe(true);
    await act(async () => {
      vi.advanceTimersByTime(PRESENCE_KEEP_ALIVE_MS);
      await settle();
    });
    expect(presence.set).not.toHaveBeenCalled();
    hook.rerender({ shown: true });
    await act(async () => {
      vi.advanceTimersByTime(1);
      await settle();
    });
    expect(presence.set).toHaveBeenCalledExactlyOnceWith("paper", "notes/Plan.md", expect.any(Number), expect.any(Number));
    hook.rerender({ shown: false });
    await act(async () => {
      vi.advanceTimersByTime(PRESENCE_KEEP_ALIVE_MS * 2);
      await settle();
    });
    expect(presence.set).toHaveBeenCalledOnce();
    expect(presence.leave).not.toHaveBeenCalled();
    hook.unmount();
  });
});

describe("peerMarksFor", () => {
  it("places each collaborator on a block once and skips everyone else", () => {
    const blockAt = (offset: number) => blockAtOffset([0, 10, 20], offset);
    const marks = peerMarksFor(
      { a: peer("a", 12), b: peer("a", 13), c: peer("b", 25), d: peer("c", 5, "assets/x.png"), e: peer("d", null) },
      "note.md",
      blockAt,
      "Someone",
    );
    expect(marks).toEqual([
      { id: "a", name: "Person a", hue: 120, index: 1 },
      { id: "b", name: "Person b", hue: 120, index: 2 },
    ]);
    const unnamed = { ...peer("z", 3), person: null };
    expect(peerMarksFor({ z: unnamed }, "note.md", () => 0, "Someone")).toEqual([{ id: "z", name: "Someone", hue: 120, index: 0 }]);
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

  it("shows this person's other devices, since only this device is left out of the peers", async () => {
    const channel = new FakeChannel(TEXT);
    const { editor } = mount(TEXT, channel);
    await act(async () => {
      goLive();
      await settle();
    });
    const laptop = { ...peer("me", TEXT.indexOf("Second.")), deviceId: "laptop" };
    act(() => useCollabLiveStore.setState({ peers: { a: peer("alice", 0), l: laptop } }));
    expect(peerCaretsOf(editor.state).map((caret) => caret.id)).toEqual(["device-alice", "laptop"]);
    expect(peerMarksOf(editor.state).map((mark) => mark.id)).toEqual(["alice", "me"]);
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
