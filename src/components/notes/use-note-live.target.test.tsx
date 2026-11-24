// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/store/files", async () => {
  const { create } = await import("zustand");
  return { useFilesStore: create(() => ({ projectId: null, projects: [] as { id: string; main_doc: string }[] })) };
});

import { LocalDocumentSession } from "@oleafly/editor/document-session";
import {
  collabRelive,
  installCollabEditorPort,
  installNoteLivePort,
  type NoteLiveBindRequest,
  type NoteLiveHandle,
  useCollabEditorGate,
  useCollabLiveNote,
  useCollabLiveProject,
} from "@/lib/collab-live-bridge";
import { noteBaseExtensions, parseNoteMarkdown } from "./note-markdown";
import { NotePeerMarks } from "./note-presence-decorations";
import { NoteSuggestions } from "./note-suggestions";
import { type NoteLiveHost, useNoteLiveEditor } from "./use-note-live";

const KEY = "project-note:paper:p1";
const TARGET = { projectId: "paper", path: "notes/Plan.md" };
const TEXT = "---\ntitle: Plan\nkind: note\n---\n\nFirst.\n";
const SESSION = { projectId: "paper", role: "editor" as const, accountId: "me", deviceId: "device" };

let editor: Editor;
let uninstall: () => void = () => {};
let uninstallDocuments: () => void = () => {};
let shared: LocalDocumentSession | null = null;
const bound: NoteLiveBindRequest[] = [];
const handle: NoteLiveHandle = {
  localChanged: vi.fn(),
  compositionEnd: vi.fn(),
  resync: vi.fn(),
  flush: vi.fn(async () => {}),
  end: vi.fn(),
};

function host(): NoteLiveHost {
  return {
    sourceOf: () => TEXT,
    baseline: () => ({ text: TEXT, serialized: TEXT }),
    settle: async () => {},
    adopt: () => {},
    handBack: vi.fn(),
  };
}

async function settle(): Promise<void> {
  for (let index = 0; index < 10; index += 1) await Promise.resolve();
}

beforeEach(() => {
  bound.length = 0;
  vi.clearAllMocks();
  editor = new Editor({
    element: document.createElement("div"),
    extensions: [...noteBaseExtensions(), NoteSuggestions, NotePeerMarks],
    content: parseNoteMarkdown(TEXT).doc,
  });
  uninstall = installNoteLivePort({
    bind: (request) => {
      bound.push(request);
      return handle;
    },
  });
  shared = new LocalDocumentSession(TARGET.path, TEXT);
  uninstallDocuments = installCollabEditorPort({
    documentSession: (path) => (path === TARGET.path ? shared : null),
    flush: async () => {},
  });
  useCollabLiveNote.setState({ noteId: null, session: null });
  useCollabLiveProject.setState({ session: null });
  useCollabEditorGate.setState({ projectId: null, viewer: false, locked: false, connecting: false, suggesting: false });
});

afterEach(() => {
  uninstall();
  uninstallDocuments();
  editor.destroy();
});

describe("live project notes", () => {
  it("binds to the project's live session for the note's file", async () => {
    const hook = renderHook(() => useNoteLiveEditor(KEY, editor, host(), TARGET));
    expect(bound).toHaveLength(0);
    await act(async () => {
      useCollabEditorGate.setState({ projectId: "paper" });
      useCollabLiveProject.setState({ session: SESSION });
      await settle();
    });
    expect(bound).toHaveLength(1);
    expect(bound[0]).toMatchObject({ noteId: "paper", noticeId: KEY, path: "notes/Plan.md", session: SESSION });
    expect(bound[0].document).toBe(shared);
    expect(hook.result.current.state).toEqual({ live: true, readOnly: false, viewOnly: false, suggesting: false });
    expect(hook.result.current.control.holds()).toBe(true);
    hook.unmount();
    expect(handle.end).toHaveBeenCalled();
  });

  it("is read-only for viewers and while the project connects", async () => {
    useCollabEditorGate.setState({ projectId: "paper", connecting: true });
    const hook = renderHook(() => useNoteLiveEditor(KEY, editor, host(), TARGET));
    expect(hook.result.current.state.readOnly).toBe(true);
    expect(hook.result.current.control.holds()).toBe(true);
    await act(async () => {
      useCollabEditorGate.setState({ projectId: "paper", connecting: false, locked: true, viewer: true });
      useCollabLiveProject.setState({ session: { ...SESSION, role: "viewer" } });
      await settle();
    });
    expect(hook.result.current.state).toEqual({ live: true, readOnly: true, viewOnly: true, suggesting: false });
  });

  it("shares the editor's live session for the file and stays local when the file has none", async () => {
    shared = null;
    const hook = renderHook(() => useNoteLiveEditor(KEY, editor, host(), TARGET));
    await act(async () => {
      useCollabEditorGate.setState({ projectId: "paper" });
      useCollabLiveProject.setState({ session: SESSION });
      await settle();
    });
    expect(bound).toHaveLength(0);
    expect(hook.result.current.state.live).toBe(false);
  });

  it("binds a project note that had no live session once its file is made live again", async () => {
    const waiting = shared;
    shared = null;
    renderHook(() => useNoteLiveEditor(KEY, editor, host(), TARGET));
    await act(async () => {
      useCollabEditorGate.setState({ projectId: "paper" });
      useCollabLiveProject.setState({ session: SESSION });
      await settle();
    });
    expect(bound).toHaveLength(0);
    await act(async () => {
      collabRelive("notes/Other.md");
      await settle();
    });
    expect(bound).toHaveLength(0);
    shared = waiting;
    await act(async () => {
      collabRelive(TARGET.path);
      await settle();
    });
    expect(bound).toHaveLength(1);
    expect(bound[0].document).toBe(waiting);
    await act(async () => {
      collabRelive(TARGET.path);
      await settle();
    });
    expect(bound).toHaveLength(1);
  });

  it("is read-only while my edits in the project are suggestions, and says so", async () => {
    useCollabEditorGate.setState({ projectId: "paper", suggesting: true });
    const hook = renderHook(() => useNoteLiveEditor(KEY, editor, host(), TARGET));
    expect(hook.result.current.state).toMatchObject({ readOnly: true, viewOnly: false, suggesting: true });
    act(() => useCollabEditorGate.setState({ suggesting: false }));
    expect(hook.result.current.state).toMatchObject({ readOnly: false, suggesting: false });
  });

  it("ignores a library note session and another project's session", async () => {
    renderHook(() => useNoteLiveEditor(KEY, editor, host(), TARGET));
    await act(async () => {
      useCollabLiveNote.setState({ noteId: KEY, session: { ...SESSION, projectId: KEY } });
      useCollabLiveProject.setState({ session: { ...SESSION, projectId: "thesis" } });
      await settle();
    });
    expect(bound).toHaveLength(0);
  });

  it("keeps library notes on their own session", async () => {
    renderHook(() => useNoteLiveEditor("note-1", editor, host()));
    await act(async () => {
      useCollabLiveProject.setState({ session: { ...SESSION, projectId: "note-1" } });
      await settle();
    });
    expect(bound).toHaveLength(0);
    await act(async () => {
      useCollabLiveNote.setState({ noteId: "note-1", session: { ...SESSION, projectId: "note-1" } });
      await settle();
    });
    expect(bound[0]).toMatchObject({ noteId: "note-1", path: "note.md" });
  });
});
