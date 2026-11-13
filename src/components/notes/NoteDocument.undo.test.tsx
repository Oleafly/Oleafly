// @vitest-environment jsdom
import type { Editor } from "@tiptap/core";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { loadNamespace } from "@/i18n";
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import { useCollabEditorGate } from "@/lib/collab-live-bridge";
import { flushOpenNotes } from "@/lib/open-note-editors";
import { useSettingsStore } from "@/store/settings";
import { NoteDocument } from "./NoteDocument";
import { type NotesData, NotesDataProvider } from "./notes-data";
import { resetNoteWritesForTest } from "./notes-service";
import type { UndoRecord } from "./note-undo-store";
import { deleteText, typeBefore } from "./tests/kb-editor-fixtures";
import { deferred, fakeNotesData } from "./tests/notes-data-fixture";
import type { NoteItem, NoteSource } from "./types";
import "./tests/setup";

const harness = vi.hoisted(() => ({ editor: null as Editor | null }));

const undo = vi.hoisted(() => {
  const rows = new Map<string, UndoRecord>();
  return {
    rows,
    store: {
      read: vi.fn(async (id: string) => rows.get(id) ?? null),
      write: vi.fn(async (id: string, record: UndoRecord) => {
        rows.set(id, record);
      }),
      remove: vi.fn(async (id: string) => {
        rows.delete(id);
      }),
      clear: vi.fn(async () => rows.clear()),
      sweep: vi.fn(async () => undefined),
    },
  };
});

vi.mock("./note-undo-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./note-undo-store")>()),
  indexedUndoStore: undo.store,
}));

vi.mock("@tiptap/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tiptap/react")>();
  return {
    ...actual,
    useEditor: (...args: Parameters<typeof actual.useEditor>) => {
      const editor = actual.useEditor(...args);
      harness.editor = editor;
      return editor;
    },
  };
});

vi.mock("./NoteAssistant", async () => {
  const { forwardRef } = await import("react");
  return { NoteAssistant: forwardRef(function NoteAssistant() { return null; }) };
});

const NOTE: NoteItem = { id: "note-1", title: "Bench log", project: "Lab", updatedAt: Date.now(), author: "you", summary: "" };
const TEXT = "---\ntitle: Bench log\nkind: note\nid: 3f0c\n---\n\nFirst entry.\n\nSecond entry.\n";

function fakeDisk(text = TEXT) {
  const disk = { text, version: 1 };
  const loadNote = vi.fn(async (): Promise<NoteSource> => ({ text: disk.text, version: `v${disk.version}` }));
  const saveNote = vi.fn(async (_id: string, saved: string): Promise<NoteSource> => {
    disk.text = saved;
    disk.version += 1;
    return { text: saved, version: `v${disk.version}` };
  });
  const data: NotesData = fakeNotesData({ notes: [NOTE], loadNote, saveNote });
  return { disk, data, loadNote, saveNote };
}

type Disk = ReturnType<typeof fakeDisk>;

async function open(fake: Disk, props: Partial<Parameters<typeof NoteDocument>[0]> = {}): Promise<Editor> {
  harness.editor = null;
  render(
    <NotesDataProvider value={fake.data}>
      <NoteDocument note={NOTE} insertRequest={null} {...props} />
    </NotesDataProvider>,
  );
  await screen.findByLabelText(enNotes.document.titleLabel);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  const editor = harness.editor as Editor | null;
  if (!editor) throw new Error("editor not ready");
  return editor;
}

function body(editor: Editor): string {
  return editor.state.doc.textBetween(0, editor.state.doc.content.size, "\n");
}

async function saveNow() {
  await act(async () => {
    fireEvent.blur(window);
  });
}

async function close() {
  await act(async () => {
    cleanup();
  });
  await act(async () => {
    await flushOpenNotes(1_000);
  });
}

beforeAll(async () => {
  await Promise.all([loadNamespace("collab"), loadNamespace("editor")]);
});

afterEach(async () => {
  cleanup();
  await flushOpenNotes(10);
  undo.rows.clear();
  for (const fn of Object.values(undo.store)) fn.mockClear();
  useSettingsStore.setState({ notesKeepUndo: true });
  useCollabEditorGate.setState({ projectId: null, viewer: false, locked: false, connecting: false });
  localStorage.clear();
  resetNoteWritesForTest();
});

describe("undo kept after closing a note", () => {
  it("brings back undo when the note is opened again after a save", async () => {
    const fake = fakeDisk();
    const editor = await open(fake);
    act(() => typeBefore(editor, "entry.", "long "));
    await saveNow();
    expect(undo.store.write).toHaveBeenCalledWith(NOTE.id, expect.objectContaining({ entries: [expect.anything()] }));
    await close();

    const reopened = await open(fake);
    expect(undo.store.read).toHaveBeenCalledWith(NOTE.id);
    expect(body(reopened)).toBe("First long entry.\nSecond entry.");
    expect(reopened.can().undo()).toBe(true);
    act(() => reopened.commands.undo());
    expect(body(reopened)).toBe("First entry.\nSecond entry.");
  });

  it("keeps the last edit's undo when the note closes before the save runs", async () => {
    const fake = fakeDisk();
    const editor = await open(fake);
    act(() => typeBefore(editor, "Second", "Also "));
    expect(undo.store.write).not.toHaveBeenCalled();
    await close();
    expect(fake.disk.text).toContain("Also Second entry.");
    expect(undo.store.write).toHaveBeenCalledTimes(1);

    const reopened = await open(fake);
    expect(reopened.can().undo()).toBe(true);
    act(() => reopened.commands.undo());
    expect(body(reopened)).toBe("First entry.\nSecond entry.");
  });

  it("finishes a quit flush only after the undo history is written", async () => {
    const fake = fakeDisk();
    const editor = await open(fake);
    const written = deferred<undefined>();
    undo.store.write.mockImplementationOnce(async (id, record) => {
      await written.promise;
      undo.rows.set(id, record);
    });
    act(() => typeBefore(editor, "entry.", "late "));
    let finished = false;
    const flushing = flushOpenNotes().then((failures) => {
      finished = true;
      return failures;
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(fake.disk.text).toContain("First late entry.");
    expect(undo.store.write).toHaveBeenCalledTimes(1);
    expect(finished).toBe(false);
    written.resolve(undefined);
    await act(async () => {
      await expect(flushing).resolves.toEqual([]);
    });
    expect(undo.rows.has(NOTE.id)).toBe(true);
  });

  it("reads and writes nothing while Keep undo is off", async () => {
    useSettingsStore.setState({ notesKeepUndo: false });
    const fake = fakeDisk();
    const editor = await open(fake);
    act(() => typeBefore(editor, "entry.", "quiet "));
    await saveNow();
    await close();
    expect(undo.store.read).not.toHaveBeenCalled();
    expect(undo.store.write).not.toHaveBeenCalled();
  });

  it("starts an empty history when the note changed somewhere else", async () => {
    const fake = fakeDisk();
    const editor = await open(fake);
    act(() => typeBefore(editor, "entry.", "mine "));
    await close();
    fake.disk.text = TEXT.replace("Second", "Their second");
    const reopened = await open(fake);
    expect(body(reopened)).toBe("First entry.\nTheir second entry.");
    expect(reopened.can().undo()).toBe(false);
  });

  it("does not replace edits made before the kept history arrives", async () => {
    const fake = fakeDisk();
    const editor = await open(fake);
    act(() => typeBefore(editor, "entry.", "kept "));
    await close();
    const read = deferred<UndoRecord | null>();
    undo.store.read.mockReturnValueOnce(read.promise);
    const reopened = await open(fake);
    act(() => deleteText(reopened, "Second "));
    await act(async () => {
      read.resolve(undo.rows.get(NOTE.id) ?? null);
      await read.promise;
    });
    expect(body(reopened)).toBe("First kept entry.\nentry.");
    act(() => typeBefore(reopened, "entry.", "new "));
    await saveNow();
    expect(undo.rows.get(NOTE.id)?.entries).toHaveLength(1);
  });

  it.each([
    ["a shared note", { note: { ...NOTE, shared: true } }],
    ["a note in a live session", { live: { projectId: "lab", path: "notes/bench.md" } }],
  ])("skips %s", async (_name, props) => {
    const fake = fakeDisk();
    await open(fake, props);
    expect(undo.store.read).not.toHaveBeenCalled();
  });

  it("skips a note that opens read-only", async () => {
    useCollabEditorGate.setState({ projectId: NOTE.id, viewer: true, locked: true, connecting: false });
    const fake = fakeDisk();
    await open(fake);
    expect(undo.store.read).not.toHaveBeenCalled();
  });
});
