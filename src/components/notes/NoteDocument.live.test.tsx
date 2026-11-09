// @vitest-environment jsdom
import type { Editor } from "@tiptap/core";
import { act, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { TextOperation } from "@/features/collab/live/ot";
import { FakeChannel } from "@/features/collab/live/tests/fake-channel";
import { loadNamespace } from "@/i18n";
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };

const harness = vi.hoisted(() => ({
  editors: [] as Editor[],
  channel: null as FakeChannel | null,
}));

vi.mock("@tiptap/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tiptap/react")>();
  return {
    ...actual,
    useEditor: (...args: Parameters<typeof actual.useEditor>) => {
      const editor = actual.useEditor(...args);
      if (!harness.editors.includes(editor)) harness.editors.push(editor);
      return editor;
    },
  };
});

vi.mock("./NoteAssistant", async () => {
  const { forwardRef } = await import("react");
  return {
    NoteAssistant: forwardRef(function NoteAssistant(props: { review: ReactNode }) {
      return <section data-testid="note-assistant">{props.review}</section>;
    }),
  };
});

vi.mock("@/lib/tauri-collab", () => {
  const transport = () => {
    if (!harness.channel) throw new Error("no channel");
    return harness.channel.transport();
  };
  const opened = new Map<string, ReturnType<typeof transport>>();
  return {
    collabDocOpen: async (_projectId: string, path: string, onMessage: never) => {
      const link = transport();
      const result = await link.open(path, onMessage);
      if (result) opened.set(result.file_id, link);
      return result;
    },
    collabDocChange: (_projectId: string, fileId: string, rev: number, op: never) => opened.get(fileId)?.change(fileId, rev, op),
    collabDocClose: (_projectId: string, fileId: string, session: number) => opened.get(fileId)?.close(fileId, session),
    collabPresenceSet: vi.fn(async () => undefined),
    collabPresenceLeave: vi.fn(async () => undefined),
  };
});

import { useCollabLiveStore } from "@/features/collab/live/live-store";
import { installNoteLive } from "@/features/collab/notes/note-live-port";
import { useCollabEditorGate, useCollabLiveNote } from "@/lib/collab-live-bridge";
import { LIVE_SEND_MS } from "@/features/collab/notes/note-live";
import { NoteDocument } from "./NoteDocument";
import { type NotesData, NotesDataProvider } from "./notes-data";
import type { NoteItem, NoteSource } from "./types";

const NOTE: NoteItem = { id: "note-1", title: "Bench log", project: "Lab", updatedAt: Date.now(), author: "you", summary: "" };
const TEXT = "---\ntitle: Bench log\nkind: note\nid: 3f0c\n---\n\nFirst entry.\n\nSecond entry.\n";

function fakeData() {
  const saveNote = vi.fn(async (_id: string, text: string, _version: string, _base?: string): Promise<NoteSource> => ({
    text,
    version: "saved",
  }));
  const renameNote = vi.fn(async () => undefined);
  const loadNote = vi.fn(async (): Promise<NoteSource> => ({ text: TEXT, version: "v1" }));
  let disk: (() => void) | null = null;
  const watchNote = vi.fn((_id: string, onChange: () => void) => {
    disk = onChange;
    return () => undefined;
  });
  const data: NotesData = {
    notes: [NOTE],
    artifacts: [],
    experiments: [],
    citations: [],
    papers: [],
    loadNote,
    saveNote,
    renameNote,
    watchNote,
  };
  return { data, saveNote, renameNote, loadNote, diskChanged: () => disk?.() };
}

async function wait(ms: number): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

async function exchange(): Promise<void> {
  await wait(LIVE_SEND_MS + 30);
  await act(async () => {
    harness.channel?.drain();
    await Promise.resolve();
  });
  await wait(5);
}

function goLive(role: "editor" | "viewer" = "editor") {
  useCollabLiveStore.setState({ projectId: NOTE.id, role, share: null });
  useCollabLiveNote.setState({ noteId: NOTE.id, session: { projectId: NOTE.id, role, accountId: "me", deviceId: "d" } });
  useCollabEditorGate.setState({ projectId: NOTE.id, viewer: role === "viewer", locked: role === "viewer", connecting: false });
}

async function openTwo(fake: ReturnType<typeof fakeData>) {
  render(
    <NotesDataProvider value={fake.data}>
      <NoteDocument note={NOTE} insertRequest={null} onSendToPaper={() => undefined} />
      <NoteDocument note={NOTE} insertRequest={null} onSendToPaper={() => undefined} />
    </NotesDataProvider>,
  );
  await screen.findAllByLabelText(enNotes.document.titleLabel);
  const [alice, bob] = harness.editors;
  return { alice, bob };
}

function paragraph(editor: Editor, index: number): number {
  let start = 0;
  for (let at = 0; at < index; at += 1) start += editor.state.doc.child(at).nodeSize;
  return start + editor.state.doc.child(index).nodeSize - 1;
}

beforeAll(async () => {
  await Promise.all([loadNamespace("notes"), loadNamespace("collab"), loadNamespace("editor")]);
});

let uninstall: (() => void) | null = null;

beforeEach(() => {
  uninstall = installNoteLive();
  harness.editors = [];
  harness.channel = new FakeChannel(TEXT);
  useCollabLiveNote.setState({ noteId: null, session: null });
  useCollabEditorGate.setState({ projectId: null, viewer: false, locked: false, connecting: false });
  useCollabLiveStore.setState({ projectId: null, role: null, share: null, peers: {} });
});

afterEach(() => {
  uninstall?.();
  uninstall = null;
  useCollabLiveNote.setState({ noteId: null, session: null });
});

describe("a shared note edited live", () => {
  it("shows each person's typing in the other's editor without saving to disk", async () => {
    const fake = fakeData();
    const { alice, bob } = await openTwo(fake);
    await act(async () => {
      goLive();
      await Promise.resolve();
    });
    await exchange();
    act(() => {
      alice.commands.setTextSelection(paragraph(alice, 0));
      alice.commands.insertContent(" Alice was here.");
    });
    await exchange();
    expect(bob.state.doc.child(0).textContent).toBe("First entry. Alice was here.");
    act(() => {
      bob.commands.setTextSelection(paragraph(bob, 1));
      bob.commands.insertContent(" Bob too.");
    });
    await exchange();
    expect(alice.state.doc.child(1).textContent).toBe("Second entry. Bob too.");
    expect(harness.channel?.text).toBe(TEXT.replace("First entry.", "First entry. Alice was here.").replace("Second entry.", "Second entry. Bob too."));
    expect(fake.saveNote).not.toHaveBeenCalled();
    fake.loadNote.mockResolvedValue({ text: TEXT.replace("First entry.", "From disk."), version: "v9" });
    fake.diskChanged();
    await wait(5);
    expect(alice.state.doc.child(0).textContent).toBe("First entry. Alice was here.");
    expect(alice.view.dom.querySelector(".note-diff-insert, .note-diff-block")).toBeNull();
  });

  it("renames the note when a collaborator changes its title", async () => {
    const fake = fakeData();
    const { alice } = await openTwo(fake);
    await act(async () => {
      goLive();
      await Promise.resolve();
    });
    await exchange();
    const at = TEXT.indexOf("Bench log");
    await act(async () => {
      harness.channel?.remote(new TextOperation().retain(at).insert("Daily ").retain(TEXT.length - at));
      harness.channel?.drain();
      await Promise.resolve();
    });
    await wait(5);
    expect(fake.renameNote).toHaveBeenCalledWith(NOTE.id, "Daily Bench log");
    expect(screen.getAllByLabelText<HTMLInputElement>(enNotes.document.titleLabel)[0].value).toBe("Daily Bench log");
    expect(alice.state.doc.child(0).textContent).toBe("First entry.");
  });

  it("gives viewers a read-only note with a notice", async () => {
    const fake = fakeData();
    const { alice } = await openTwo(fake);
    await act(async () => {
      goLive("viewer");
      await Promise.resolve();
    });
    await exchange();
    expect(alice.isEditable).toBe(false);
    expect(screen.getAllByText(enNotes.live.viewOnly)).toHaveLength(2);
    expect(screen.getAllByLabelText<HTMLInputElement>(enNotes.document.titleLabel)[0].readOnly).toBe(true);
  });

  it("saves edits made while connecting once the note turns out not to go live", async () => {
    const fake = fakeData();
    const { alice } = await openTwo(fake);
    act(() => {
      alice.commands.setTextSelection(paragraph(alice, 0));
      alice.commands.insertContent(" Offline.");
      useCollabEditorGate.setState({ projectId: NOTE.id, connecting: true });
    });
    await wait(1_000);
    expect(fake.saveNote).not.toHaveBeenCalled();
    act(() => useCollabEditorGate.setState({ projectId: null, connecting: false }));
    await vi.waitFor(() => expect(fake.saveNote.mock.calls.some((args) => args[1].includes("First entry. Offline."))).toBe(true), {
      timeout: 5_000,
    });
  });

  it("saves unsent edits with the shared base when live editing moves away", async () => {
    const fake = fakeData();
    const { alice } = await openTwo(fake);
    await act(async () => {
      goLive();
      await Promise.resolve();
    });
    await exchange();
    act(() => {
      alice.commands.setTextSelection(paragraph(alice, 1));
      alice.commands.insertContent(" Late.");
    });
    await act(async () => {
      useCollabLiveNote.setState({ session: null });
      await Promise.resolve();
    });
    await wait(5);
    const call = fake.saveNote.mock.calls.find((args) => args[1].includes("Late."));
    expect(call?.[3]).toBe(TEXT);
  });
});
