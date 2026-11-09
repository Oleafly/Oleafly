// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/store/files", async () => {
  const { create } = await import("zustand");
  return { useFilesStore: create(() => ({ projectId: null, projects: [] as { id: string; main_doc: string }[] })) };
});

import {
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
  useCollabLiveNote.setState({ noteId: null, session: null });
  useCollabLiveProject.setState({ session: null });
  useCollabEditorGate.setState({ projectId: null, viewer: false, locked: false, connecting: false });
});

afterEach(() => {
  uninstall();
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
    expect(bound[0]).toMatchObject({ noteId: "paper", path: "notes/Plan.md", session: SESSION });
    expect(hook.result.current.state).toEqual({ live: true, readOnly: false, viewOnly: false });
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
    expect(hook.result.current.state).toEqual({ live: true, readOnly: true, viewOnly: true });
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
