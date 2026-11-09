// @vitest-environment jsdom
import type { Editor } from "@tiptap/core";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode, RefObject } from "react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { loadNamespace } from "@/i18n";
import enEditor from "@/i18n/locales/en/editor.json" with { type: "json" };
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import type { NoteEditorBridge } from "./NoteAssistant";
import { NoteDocument, type NoteSaveFailure, type SaveStatus } from "./NoteDocument";
import { NOTE_COLOR_HEX } from "./note-icons";
import { flushOpenNotes, noteEditorBusy, noteHistoryAt } from "@/lib/open-note-editors";
import { useShortcutStore } from "@/store/shortcuts";
import { addPendingBatch, pendingBatches, resetPendingSuggestionsForTest } from "./note-pending-suggestions";
import { useCollabEditorGate } from "@/lib/collab-live-bridge";
import { editsAsMarkdown, useNoteTabsStore } from "@/store/note-tabs";
import { NOTE_WIDTH_KEY, saveNoteWidth } from "./note-prefs";
import { type NotesData, NotesDataProvider } from "./notes-data";
import { recordNoteWrite, resetNoteWritesForTest } from "./notes-service";
import { type NoteColor, NoteConflictError, type NoteItem, type NoteSource } from "./types";

const editors = vi.hoisted(() => ({ last: null as Editor | null }));
const prompts = vi.hoisted(() => ({ scope: null as { current: HTMLElement | null } | null }));
const composerFocus = vi.hoisted(() => vi.fn());
const assistant = vi.hoisted(() => ({
  bridge: null as NoteEditorBridge | null,
  quote: vi.fn<(text: string) => void>(),
}));

const logs = vi.hoisted(() => ({ logError: vi.fn(async () => {}) }));
vi.mock("@/lib/log", () => logs);

const toasts = vi.hoisted(() => ({ notifyError: vi.fn() }));
vi.mock("@/lib/toast", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/toast")>()),
  notifyError: toasts.notifyError,
}));

vi.mock("@tiptap/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tiptap/react")>();
  return {
    ...actual,
    useEditor: (...args: Parameters<typeof actual.useEditor>) => {
      const editor = actual.useEditor(...args);
      editors.last = editor;
      return editor;
    },
  };
});

vi.mock("./NoteAssistant", async () => {
  const { forwardRef, useImperativeHandle } = await import("react");
  return {
    NoteAssistant: forwardRef(function NoteAssistant(
      props: {
        note: NoteItem;
        bridge: NoteEditorBridge;
        review: ReactNode;
        shortcutScope?: RefObject<HTMLElement | null>;
      },
      ref,
    ) {
      useImperativeHandle(ref, () => ({ focus: composerFocus, quote: assistant.quote }), []);
      assistant.bridge = props.bridge;
      prompts.scope = props.shortcutScope ?? null;
      return (
        <section data-testid="note-assistant" data-note={props.note.id}>
          {props.review}
        </section>
      );
    }),
  };
});

vi.mock("./IconPicker", () => ({
  IconPicker: (props: {
    trigger: ReactNode;
    value?: string;
    hasIcon: boolean;
    onChange: (icon: string | undefined) => void;
    color?: NoteColor;
    onColorChange?: (color: NoteColor) => void;
  }) => (
    <div>
      <span data-testid="icon-trigger" data-value={props.value ?? "none"} data-color={props.color ?? "none"}>
        {props.trigger}
      </span>
      <button type="button" data-testid="pick-icon" onClick={() => props.onChange("🧪")} />
      {props.hasIcon && <button type="button" data-testid="remove-icon" onClick={() => props.onChange(undefined)} />}
      {props.onColorChange && (
        <button type="button" data-testid="pick-color" onClick={() => props.onColorChange?.("lilac")} />
      )}
    </div>
  ),
}));

const NOTE: NoteItem = {
  id: "note-1",
  title: "Mask ratios",
  project: "Encoder study",
  updatedAt: Date.now() - 5 * 60_000,
  author: "you",
  summary: "",
};
const BODY = "The encoder trains with a mask ratio of 0.75.\n\nMasks are sampled per pixel.\n";
const ID = "5b2e8f1c-7a3d-4c6e-9b0a-1d2c3e4f5a6b";
const NEW_ID = "9e8d7c6b-5a4f-4e3d-8c2b-1a0f9e8d7c6b";
const TEXT = `---\ntitle: Mask ratios\nkind: note\nid: ${ID}\n---\n\n${BODY}`;
const OLD_TEXT = `---\ntitle: Mask ratios\n---\n\n${BODY}`;
const DISK = TEXT.replace("per pixel", "per patch").replace("Mask ratios", "Mask ratio study");

const ACCEPT = enEditor.inlineAi.accept;
const REJECT = enEditor.inlineAi.reject;

function deferred<T>() {
  const handlers = { resolve: (_value: T) => {}, reject: (_reason: unknown) => {} };
  const promise = new Promise<T>((resolve, reject) => {
    handlers.resolve = resolve;
    handlers.reject = reject;
  });
  return { promise, ...handlers };
}

interface FakeOptions {
  text?: string;
  withOptional?: boolean;
}

function fakeData(options: FakeOptions = {}) {
  const text = options.text ?? TEXT;
  let onDisk: (() => void) | null = null;
  let version = 1;
  const loadNote = vi.fn(async (_id: string): Promise<NoteSource> => ({ text, version: "v1" }));
  const saveNote = vi.fn(
    async (_id: string, saved: string, _version: string): Promise<NoteSource> => ({
      text: saved,
      version: `v${++version}`,
    }),
  );
  const renameNote = vi.fn(async (_id: string, _title: string) => {});
  const stopWatching = vi.fn();
  const watchNote = vi.fn((_id: string, onChange: () => void) => {
    onDisk = onChange;
    return stopWatching;
  });
  const data: NotesData = {
    notes: [NOTE],
    artifacts: [],
    experiments: [],
    citations: [],
    papers: [],
    loadNote,
    saveNote,
    ...(options.withOptional === false ? {} : { renameNote, watchNote }),
  };
  const diskChanged = async () => {
    await act(async () => {
      onDisk?.();
    });
  };
  return { data, loadNote, saveNote, renameNote, watchNote, stopWatching, diskChanged };
}

type Fake = ReturnType<typeof fakeData>;

interface OpenOptions {
  note?: NoteItem;
  insertRequest?: { snippet: string; id: number } | null;
  withoutPaper?: boolean;
}

async function openNote(fake: Fake, options: OpenOptions = {}) {
  const onStatusChange = vi.fn<(status: SaveStatus, failure: NoteSaveFailure | null) => void>();
  const onSendToPaper = vi.fn<(text: string) => void>();
  const note = options.note ?? NOTE;
  const tree = (insertRequest: OpenOptions["insertRequest"], shown: NoteItem = note) => (
    <NotesDataProvider value={fake.data}>
      <NoteDocument
        note={shown}
        insertRequest={insertRequest ?? null}
        onSendToPaper={options.withoutPaper ? undefined : onSendToPaper}
        onStatusChange={onStatusChange}
      />
    </NotesDataProvider>
  );
  const view = render(tree(options.insertRequest));
  const title = await screen.findByLabelText<HTMLInputElement>(enNotes.document.titleLabel);
  const editor = editors.last;
  if (!editor) throw new Error("editor not ready");
  return {
    ...view,
    title,
    editor,
    onStatusChange,
    onSendToPaper,
    requestInsert: (insertRequest: OpenOptions["insertRequest"]) => view.rerender(tree(insertRequest)),
    showNote: (shown: NoteItem) => view.rerender(tree(options.insertRequest, shown)),
  };
}

function positionOf(editor: Editor, needle: string): number {
  let found = -1;
  editor.state.doc.descendants((node, position) => {
    if (found >= 0) return false;
    const index = node.isText ? (node.text ?? "").indexOf(needle) : -1;
    if (index >= 0) found = position + index;
    return found < 0;
  });
  if (found < 0) throw new Error(`"${needle}" is not in the note`);
  return found;
}

function typeBefore(editor: Editor, needle: string, text: string) {
  act(() => {
    editor.view.dispatch(editor.state.tr.insertText(text, positionOf(editor, needle)));
  });
}

function deleteText(editor: Editor, needle: string) {
  act(() => {
    const from = positionOf(editor, needle);
    editor.view.dispatch(editor.state.tr.delete(from, from + needle.length));
  });
}

function select(editor: Editor, needle: string) {
  act(() => {
    const from = positionOf(editor, needle);
    editor.commands.setTextSelection({ from, to: from + needle.length });
  });
}

async function flushSave() {
  await act(async () => {
    fireEvent.blur(window);
  });
}

function savedText(fake: Fake, call = -1): string {
  const saved = fake.saveNote.mock.calls.at(call);
  if (!saved) throw new Error("nothing was saved");
  return saved[1];
}

function bodyText(editor: Editor): string {
  return editor.state.doc.textBetween(0, editor.state.doc.content.size, "\n");
}

const scrollIntoView = vi.fn();

beforeAll(async () => {
  await loadNamespace("notes");
  Element.prototype.scrollIntoView = scrollIntoView;
});

afterAll(() => {
  Reflect.deleteProperty(Element.prototype, "scrollIntoView");
});

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  editors.last = null;
  composerFocus.mockClear();
  scrollIntoView.mockClear();
  Reflect.deleteProperty(document, "visibilityState");
  assistant.bridge = null;
  assistant.quote.mockClear();
  cleanup();
  await flushOpenNotes(10);
  localStorage.clear();
  resetPendingSuggestionsForTest();
  resetNoteWritesForTest();
});

describe("opening a note", () => {
  it("shows a spinner until the note loads", async () => {
    const fake = fakeData();
    const load = deferred<NoteSource>();
    fake.loadNote.mockReturnValueOnce(load.promise);
    const { container } = render(
      <NotesDataProvider value={fake.data}>
        <NoteDocument note={NOTE} insertRequest={null} onSendToPaper={vi.fn()} />
      </NotesDataProvider>,
    );
    expect(container.querySelector(".animate-spin")).not.toBeNull();
    expect(screen.queryByLabelText(enNotes.document.titleLabel)).toBeNull();
    await act(async () => {
      load.resolve({ text: TEXT, version: "v1" });
    });
    expect(container.querySelector(".animate-spin")).toBeNull();
    expect(screen.getByLabelText<HTMLInputElement>(enNotes.document.titleLabel).value).toBe("Mask ratios");
    expect(fake.loadNote).toHaveBeenCalledWith("note-1");
  });

  it("explains when the note cannot be opened", async () => {
    const fake = fakeData();
    fake.loadNote.mockRejectedValueOnce(new Error("gone"));
    render(
      <NotesDataProvider value={fake.data}>
        <NoteDocument note={NOTE} insertRequest={null} onSendToPaper={vi.fn()} />
      </NotesDataProvider>,
    );
    expect(await screen.findByText(enNotes.document.loadFailed)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: enNotes.document.closeTab })).toBeNull();
  });

  it("tries again or closes the tab when the note could not be opened", async () => {
    const fake = fakeData();
    const onClose = vi.fn();
    fake.loadNote.mockRejectedValueOnce(new Error("gone"));
    render(
      <NotesDataProvider value={fake.data}>
        <NoteDocument note={NOTE} insertRequest={null} onClose={onClose} />
      </NotesDataProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: enNotes.document.closeTab }));
    expect(onClose).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: enNotes.document.retryLoad }));
    expect((await screen.findByLabelText<HTMLInputElement>(enNotes.document.titleLabel)).value).toBe("Mask ratios");
    expect(fake.loadNote).toHaveBeenCalledTimes(2);
  });

  it("ignores a load that settles after the note closed", async () => {
    const fake = fakeData();
    const loaded = deferred<NoteSource>();
    const failed = deferred<NoteSource>();
    fake.loadNote.mockReturnValueOnce(loaded.promise).mockReturnValueOnce(failed.promise);
    const tree = (
      <NotesDataProvider value={fake.data}>
        <NoteDocument note={NOTE} insertRequest={null} onSendToPaper={vi.fn()} />
      </NotesDataProvider>
    );
    const first = render(tree);
    first.unmount();
    const second = render(tree);
    second.unmount();
    await act(async () => {
      loaded.resolve({ text: TEXT, version: "v1" });
      failed.reject(new Error("gone"));
    });
    expect(fake.loadNote).toHaveBeenCalledTimes(2);
    expect(document.body.textContent).toBe("");
  });

  it("names who wrote the note, its project and when it changed", async () => {
    await openNote(fakeData());
    expect(screen.getByText(new RegExp(`^${enNotes.document.writtenByYou} · Encoder study · `))).toBeInTheDocument();
  });

  it("credits the agent that wrote the note", async () => {
    await openNote(fakeData(), { note: { ...NOTE, author: "agent", agent: "Codex" } });
    const credit = enNotes.document.writtenByAgent.replace("{{agent}}", "Codex");
    expect(screen.getByText(new RegExp(`^${credit} · Encoder study · `))).toBeInTheDocument();
  });

  it("credits nobody on a shared note no agent wrote", async () => {
    await openNote(fakeData(), { note: { ...NOTE, shared: true } });
    const byline = screen.getByText(/Encoder study/u);
    expect(byline.textContent?.startsWith("Encoder study · ")).toBe(true);
    expect(byline).not.toHaveTextContent(enNotes.document.writtenByYou);
  });

  it("credits you when an agent note does not name its agent", async () => {
    await openNote(fakeData(), { note: { ...NOTE, author: "agent" } });
    expect(screen.getByText(new RegExp(`^${enNotes.document.writtenByYou} · `))).toBeInTheDocument();
  });

  it("leaves out the time when the note's edit time is unknown", async () => {
    await openNote(fakeData(), { note: { ...NOTE, updatedAt: 0 } });
    expect(screen.getByText(`${enNotes.document.writtenByYou} · Encoder study`)).toBeInTheDocument();
  });
});

describe("saving", () => {
  it("saves the note 800 ms after the last edit", async () => {
    const fake = fakeData();
    const { editor, onStatusChange } = await openNote(fake);
    vi.useFakeTimers();
    typeBefore(editor, "trains", "really ");
    expect(onStatusChange).toHaveBeenLastCalledWith("saving", null);
    await act(() => vi.advanceTimersByTimeAsync(500));
    typeBefore(editor, "really", "quite ");
    await act(() => vi.advanceTimersByTimeAsync(799));
    expect(fake.saveNote).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(fake.saveNote).toHaveBeenCalledTimes(1);
    expect(fake.saveNote).toHaveBeenCalledWith(
      "note-1",
      TEXT.replace("trains", "quite really trains"),
      "v1",
    );
    expect(onStatusChange).toHaveBeenLastCalledWith("saved", null);
  });

  it("saves at once when the window loses focus", async () => {
    const fake = fakeData();
    const { editor } = await openNote(fake);
    typeBefore(editor, "trains", "really ");
    await flushSave();
    expect(savedText(fake)).toBe(TEXT.replace("trains", "really trains"));
  });

  it("does nothing on focus loss when no save is pending", async () => {
    const fake = fakeData();
    const { onStatusChange } = await openNote(fake);
    await flushSave();
    expect(fake.saveNote).not.toHaveBeenCalled();
    expect(onStatusChange).not.toHaveBeenCalled();
  });

  it("saves when the app is hidden but not when it becomes visible", async () => {
    const fake = fakeData();
    const { editor } = await openNote(fake);
    typeBefore(editor, "trains", "really ");
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(fake.saveNote).not.toHaveBeenCalled();
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(fake.saveNote).toHaveBeenCalledTimes(1);
  });

  it("saves a pending edit when the note closes", async () => {
    const fake = fakeData();
    const { editor, unmount } = await openNote(fake);
    typeBefore(editor, "trains", "really ");
    await act(async () => {
      unmount();
    });
    expect(savedText(fake)).toBe(TEXT.replace("trains", "really trains"));
  });

  it("gives a note without front matter its kind and id when it saves", async () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue(NEW_ID);
    const fake = fakeData({ text: BODY });
    const { editor } = await openNote(fake);
    typeBefore(editor, "trains", "really ");
    await flushSave();
    expect(savedText(fake)).toBe(`---\nkind: note\nid: ${NEW_ID}\n---\n\n${BODY.replace("trains", "really trains")}`);
  });

  it("reports saved without writing when the text matches the last save", async () => {
    const fake = fakeData();
    const { editor, onStatusChange } = await openNote(fake);
    typeBefore(editor, "trains", "really ");
    await flushSave();
    typeBefore(editor, "trains", "x");
    deleteText(editor, "x");
    await flushSave();
    expect(fake.saveNote).toHaveBeenCalledTimes(1);
    expect(onStatusChange).toHaveBeenLastCalledWith("saved", null);
  });

  it("reports a save that fails and writes why to the app log", async () => {
    const fake = fakeData();
    const failure = new Error("disk full");
    fake.saveNote.mockRejectedValueOnce(failure);
    const { editor, onStatusChange } = await openNote(fake);
    typeBefore(editor, "trains", "really ");
    await flushSave();
    expect(onStatusChange).toHaveBeenLastCalledWith("failed", { error: failure, retry: expect.any(Function) });
    expect(logs.logError).toHaveBeenCalledWith("save the note", failure);
    const saves = fake.saveNote.mock.calls.length;
    await act(async () => {
      onStatusChange.mock.lastCall?.[1]?.retry();
      await Promise.resolve();
    });
    expect(fake.saveNote.mock.calls.length).toBe(saves + 1);
  });

  it("sends each save with the version the last save returned", async () => {
    const fake = fakeData();
    const { editor } = await openNote(fake);
    typeBefore(editor, "trains", "really ");
    await flushSave();
    typeBefore(editor, "sampled", "randomly ");
    await flushSave();
    expect(fake.saveNote.mock.calls.map((call) => call[2])).toEqual(["v1", "v2"]);
  });

  it("waits for a running save before starting the next", async () => {
    const fake = fakeData();
    const first = deferred<NoteSource>();
    fake.saveNote.mockReturnValueOnce(first.promise);
    const { editor, onStatusChange } = await openNote(fake);
    typeBefore(editor, "trains", "really ");
    await flushSave();
    typeBefore(editor, "sampled", "randomly ");
    await flushSave();
    expect(fake.saveNote).toHaveBeenCalledTimes(1);
    await act(async () => {
      first.resolve({ text: savedText(fake), version: "v5" });
    });
    expect(fake.saveNote).toHaveBeenCalledTimes(2);
    expect(fake.saveNote.mock.calls[1][2]).toBe("v5");
    expect(savedText(fake)).toBe(TEXT.replace("trains", "really trains").replace("sampled", "randomly sampled"));
    expect(onStatusChange).toHaveBeenLastCalledWith("saved", null);
  });

  it("never runs two saves at once when several wait for the same one", async () => {
    const fake = fakeData();
    const first = deferred<NoteSource>();
    const second = deferred<NoteSource>();
    fake.saveNote.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { editor } = await openNote(fake);
    typeBefore(editor, "trains", "really ");
    await flushSave();
    typeBefore(editor, "sampled", "randomly ");
    await flushSave();
    typeBefore(editor, "Masks", "All ");
    await act(async () => {
      fireEvent(window, new Event("pagehide"));
    });
    await act(async () => {
      first.resolve({ text: savedText(fake), version: "v5" });
    });
    expect(fake.saveNote).toHaveBeenCalledTimes(2);
    typeBefore(editor, "encoder", "big ");
    await flushSave();
    expect(fake.saveNote).toHaveBeenCalledTimes(2);
    await act(async () => {
      second.resolve({ text: savedText(fake), version: "v6" });
    });
    expect(fake.saveNote).toHaveBeenCalledTimes(3);
    expect(fake.saveNote.mock.calls[2][2]).toBe("v6");
  });

  it("offers the disk text as suggestions when a save conflicts, then saves again", async () => {
    const fake = fakeData();
    fake.saveNote.mockRejectedValueOnce(new NoteConflictError({ text: DISK, version: "v9" }));
    const { editor, title, onStatusChange } = await openNote(fake);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    typeBefore(editor, "trains", "really ");
    await flushSave();
    expect(screen.getByRole("button", { name: ACCEPT })).toBeInTheDocument();
    expect(title.value).toBe("Mask ratio study");
    expect(onStatusChange).toHaveBeenLastCalledWith("saving", null);
    expect(bodyText(editor)).toContain("per pixel");
    await act(() => vi.advanceTimersByTimeAsync(800));
    expect(fake.saveNote.mock.calls.at(-1)?.[2]).toBe("v9");
    expect(savedText(fake)).toBe(DISK.replace("trains", "really trains"));
    expect(onStatusChange).toHaveBeenLastCalledWith("saved", null);
  });
});

describe("saving before the app quits", () => {
  it("saves a pending edit at once", async () => {
    const fake = fakeData();
    const { editor } = await openNote(fake);
    typeBefore(editor, "trains", "really ");
    await act(async () => {
      await expect(flushOpenNotes()).resolves.toEqual([]);
    });
    expect(savedText(fake)).toBe(TEXT.replace("trains", "really trains"));
  });

  it("leaves a note alone when nothing changed", async () => {
    const fake = fakeData({ text: OLD_TEXT });
    await openNote(fake);
    await act(async () => {
      await expect(flushOpenNotes()).resolves.toEqual([]);
    });
    expect(fake.saveNote).not.toHaveBeenCalled();
  });

  it("names a note that could not be saved", async () => {
    const fake = fakeData();
    fake.saveNote.mockRejectedValue(new Error("disk full"));
    const { editor } = await openNote(fake);
    typeBefore(editor, "trains", "really ");
    await act(async () => {
      await expect(flushOpenNotes()).resolves.toEqual([{ path: "Mask ratios", reason: "disk full" }]);
    });
    fake.saveNote.mockRejectedValue("refused");
    typeBefore(editor, "trains", "quite ");
    await act(async () => {
      await expect(flushOpenNotes()).resolves.toEqual([{ path: "Mask ratios", reason: "refused" }]);
    });
  });

  it("finishes a save that ran into a change on disk", async () => {
    const fake = fakeData();
    fake.saveNote.mockRejectedValueOnce(new NoteConflictError({ text: DISK, version: "v9" }));
    const { editor } = await openNote(fake);
    typeBefore(editor, "trains", "really ");
    await act(async () => {
      await expect(flushOpenNotes()).resolves.toEqual([]);
    });
    expect(fake.saveNote).toHaveBeenCalledTimes(2);
    expect(savedText(fake)).toBe(DISK.replace("trains", "really trains"));
  });

  it("reports a note whose save keeps running into changes", async () => {
    const fake = fakeData();
    fake.saveNote.mockRejectedValue(new NoteConflictError({ text: DISK, version: "v9" }));
    const { editor } = await openNote(fake);
    typeBefore(editor, "trains", "really ");
    await act(async () => {
      await expect(flushOpenNotes()).resolves.toEqual([{ path: "Mask ratios", reason: enNotes.saving.notSaved }]);
    });
  });

  it("waits for the save a note started when it closed", async () => {
    const fake = fakeData();
    const first = deferred<NoteSource>();
    fake.saveNote.mockReturnValueOnce(first.promise);
    const { editor, unmount } = await openNote(fake);
    typeBefore(editor, "trains", "really ");
    await act(async () => {
      unmount();
    });
    let settled = false;
    const flushing = flushOpenNotes().then((failures) => {
      settled = true;
      return failures;
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(settled).toBe(false);
    first.reject(new Error("disk full"));
    await expect(flushing).resolves.toEqual([{ path: "Mask ratios", reason: "disk full" }]);
  });

  it("tries a failed save again when the note closes", async () => {
    const fake = fakeData();
    fake.saveNote.mockRejectedValueOnce(new Error("disk full"));
    const { editor, unmount, onStatusChange } = await openNote(fake);
    typeBefore(editor, "trains", "really ");
    await flushSave();
    expect(onStatusChange).toHaveBeenLastCalledWith("failed", expect.anything());
    await act(async () => {
      unmount();
    });
    await vi.waitFor(() => expect(fake.saveNote).toHaveBeenCalledTimes(2));
    expect(savedText(fake)).toBe(TEXT.replace("trains", "really trains"));
    await expect(flushOpenNotes()).resolves.toEqual([]);
  });

  it("names a closed note whose save keeps failing when the app quits", async () => {
    const fake = fakeData();
    fake.saveNote.mockRejectedValue(new Error("disk full"));
    const { editor, unmount } = await openNote(fake);
    typeBefore(editor, "trains", "really ");
    await flushSave();
    await act(async () => {
      unmount();
    });
    await vi.waitFor(() => expect(fake.saveNote).toHaveBeenCalledTimes(2));
    await expect(flushOpenNotes()).resolves.toEqual([{ path: "Mask ratios", reason: "disk full" }]);
    expect(fake.saveNote).toHaveBeenCalledTimes(3);
  });

  it("keeps both sides when a closed note's save meets a change on disk", async () => {
    const fake = fakeData();
    fake.saveNote.mockRejectedValueOnce(new NoteConflictError({ text: DISK, version: "v9" }));
    const { editor, unmount } = await openNote(fake);
    typeBefore(editor, "trains", "really ");
    await act(async () => {
      unmount();
    });
    await vi.waitFor(() => expect(fake.saveNote).toHaveBeenCalledTimes(2));
    expect(fake.saveNote.mock.calls[1][2]).toBe("v9");
    expect(savedText(fake)).toBe(DISK.replace("trains", "really trains"));
    await expect(flushOpenNotes()).resolves.toEqual([]);
  });

  it("does not write an untouched note when it closes", async () => {
    const fake = fakeData({ text: OLD_TEXT });
    const { unmount } = await openNote(fake);
    await act(async () => {
      unmount();
    });
    await expect(flushOpenNotes()).resolves.toEqual([]);
    expect(fake.saveNote).not.toHaveBeenCalled();
  });

  it("saves when the page is about to unload", async () => {
    const fake = fakeData();
    const { editor } = await openNote(fake);
    typeBefore(editor, "trains", "really ");
    await act(async () => {
      window.dispatchEvent(new Event("pagehide"));
    });
    expect(savedText(fake)).toBe(TEXT.replace("trains", "really trains"));
  });
});

describe("the note's kind and id", () => {
  it("adds them to a note from an earlier build on its first save and keeps them after", async () => {
    const uuid = vi.spyOn(crypto, "randomUUID").mockReturnValueOnce(NEW_ID).mockReturnValue(ID);
    const fake = fakeData({ text: OLD_TEXT });
    const { editor } = await openNote(fake);
    vi.useFakeTimers();
    typeBefore(editor, "trains", "r");
    typeBefore(editor, "trains", "e");
    typeBefore(editor, "trains", "ally ");
    await act(() => vi.advanceTimersByTimeAsync(800));
    typeBefore(editor, "sampled", "randomly ");
    await act(() => vi.advanceTimersByTimeAsync(800));
    expect(fake.saveNote).toHaveBeenCalledTimes(2);
    const migrated = `---\ntitle: Mask ratios\nkind: note\nid: ${NEW_ID}\n---\n\n${BODY}`;
    expect(savedText(fake, 0)).toBe(migrated.replace("trains", "really trains"));
    expect(savedText(fake, 1)).toBe(migrated.replace("trains", "really trains").replace("sampled", "randomly sampled"));
    expect(uuid).toHaveBeenCalledOnce();
  });

  it("leaves the text and the cursor in the editor where they were", async () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue(NEW_ID);
    const fake = fakeData({ text: OLD_TEXT });
    const { editor } = await openNote(fake);
    typeBefore(editor, "trains", "really ");
    act(() => {
      editor.commands.setTextSelection(positionOf(editor, "really") + 3);
    });
    const doc = editor.state.doc;
    const selection = editor.state.selection;
    const transactions = vi.fn();
    editor.on("transaction", transactions);
    await flushSave();
    editor.off("transaction", transactions);
    expect(savedText(fake)).toContain(`kind: note\nid: ${NEW_ID}\n`);
    expect(editor.state.doc).toBe(doc);
    expect(editor.state.selection.eq(selection)).toBe(true);
    expect(transactions).not.toHaveBeenCalled();
  });

  it("does not write a note from an earlier build only because it was opened", async () => {
    const uuid = vi.spyOn(crypto, "randomUUID").mockReturnValue(NEW_ID);
    const fake = fakeData({ text: OLD_TEXT });
    const { unmount } = await openNote(fake);
    await flushSave();
    await act(async () => {
      unmount();
    });
    expect(fake.saveNote).not.toHaveBeenCalled();
    expect(uuid).not.toHaveBeenCalled();
  });

  it("keeps a quoted kind and the id the note already has", async () => {
    const uuid = vi.spyOn(crypto, "randomUUID").mockReturnValue(NEW_ID);
    const text = TEXT.replace("kind: note", 'kind: "note"');
    const fake = fakeData({ text });
    const { editor } = await openNote(fake);
    typeBefore(editor, "trains", "really ");
    await flushSave();
    expect(savedText(fake)).toBe(text.replace("trains", "really trains"));
    expect(uuid).not.toHaveBeenCalled();
  });

  it("keeps CRLF line endings in the front matter it migrates", async () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue(NEW_ID);
    const fake = fakeData({ text: `---\r\ntitle: Mask ratios\r\n---\r\n\r\n${BODY}` });
    const { editor } = await openNote(fake);
    typeBefore(editor, "trains", "really ");
    await flushSave();
    expect(savedText(fake)).toBe(
      `---\r\ntitle: Mask ratios\r\nkind: note\r\nid: ${NEW_ID}\r\n---\r\n\r\n${BODY.replace("trains", "really trains")}`,
    );
  });

  it("migrates again with the disk's front matter after a conflict", async () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue(NEW_ID);
    const fake = fakeData({ text: OLD_TEXT });
    fake.saveNote.mockRejectedValueOnce(new NoteConflictError({ text: TEXT, version: "v9" }));
    const { editor } = await openNote(fake);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    typeBefore(editor, "trains", "really ");
    await flushSave();
    expect(savedText(fake, 0)).toContain(`id: ${NEW_ID}`);
    await act(() => vi.advanceTimersByTimeAsync(800));
    expect(savedText(fake)).toBe(TEXT.replace("trains", "really trains"));
  });
});

describe("saving after a conflict", () => {
  it("retries with the new version when only the file's version changed", async () => {
    const fake = fakeData();
    fake.saveNote.mockRejectedValueOnce(new NoteConflictError({ text: TEXT, version: "v7" }));
    const { editor, onStatusChange } = await openNote(fake);
    vi.useFakeTimers();
    typeBefore(editor, "trains", "really ");
    await flushSave();
    expect(screen.queryByRole("button", { name: ACCEPT })).toBeNull();
    expect(onStatusChange).toHaveBeenLastCalledWith("saving", null);
    await act(() => vi.advanceTimersByTimeAsync(800));
    expect(fake.saveNote).toHaveBeenCalledTimes(2);
    expect(fake.saveNote.mock.calls[1][2]).toBe("v7");
    expect(savedText(fake)).toBe(TEXT.replace("trains", "really trains"));
    expect(onStatusChange).toHaveBeenLastCalledWith("saved", null);
  });

  it("saves once when an edit was already waiting to save", async () => {
    const fake = fakeData();
    const first = deferred<NoteSource>();
    fake.saveNote.mockReturnValueOnce(first.promise);
    const { editor } = await openNote(fake);
    vi.useFakeTimers();
    typeBefore(editor, "trains", "really ");
    await flushSave();
    typeBefore(editor, "really", "quite ");
    await act(async () => {
      first.reject(new NoteConflictError({ text: DISK, version: "v9" }));
    });
    await act(() => vi.advanceTimersByTimeAsync(800));
    await act(() => vi.advanceTimersByTimeAsync(800));
    expect(fake.saveNote).toHaveBeenCalledTimes(2);
    expect(fake.saveNote.mock.calls[1][2]).toBe("v9");
    expect(savedText(fake)).toBe(DISK.replace("trains", "quite really trains"));
  });
});

describe("changes on disk", () => {
  it("reads the disk again when a hidden note is shown, and takes what the app wrote there meanwhile", async () => {
    const fake = fakeData();
    const tree = (shown: boolean) => (
      <NotesDataProvider value={fake.data}>
        <NoteDocument note={NOTE} insertRequest={null} shown={shown} />
      </NotesDataProvider>
    );
    const view = render(tree(true));
    await screen.findByLabelText(enNotes.document.titleLabel);
    const editor = editors.last as Editor;
    expect(fake.loadNote).toHaveBeenCalledOnce();
    view.rerender(tree(false));
    expect(fake.loadNote).toHaveBeenCalledOnce();
    await recordNoteWrite("note-1", DISK, async () => undefined);
    fake.loadNote.mockResolvedValueOnce({ text: DISK, version: "v4" });
    await act(async () => {
      view.rerender(tree(true));
    });
    expect(fake.loadNote).toHaveBeenCalledTimes(2);
    expect(bodyText(editor)).toContain("per patch");
    expect(screen.queryByRole("button", { name: ACCEPT })).toBeNull();
    await act(async () => {
      view.rerender(tree(true));
    });
    expect(fake.loadNote).toHaveBeenCalledTimes(2);
    typeBefore(editor, "trains", "really ");
    await flushSave();
    expect(fake.saveNote.mock.calls[0][2]).toBe("v4");
  });

  it("says it is busy while a save waits, so a hidden tab is not dropped", async () => {
    const fake = fakeData();
    const { editor } = await openNote(fake);
    expect(noteEditorBusy("note-1")).toBe(false);
    typeBefore(editor, "trains", "really ");
    expect(noteEditorBusy("note-1")).toBe(true);
    await flushSave();
    expect(noteEditorBusy("note-1")).toBe(false);
  });

  it("offers a change made outside the app as suggestions even when nothing here is unsaved", async () => {
    const fake = fakeData();
    const { editor, title } = await openNote(fake);
    fake.loadNote.mockResolvedValueOnce({ text: DISK, version: "v4" });
    await fake.diskChanged();
    expect(title.value).toBe("Mask ratio study");
    expect(bodyText(editor)).toContain("per pixel");
    expect(document.querySelector(".note-diff-insert")).toHaveTextContent("patch");
    expect(screen.getByRole("button", { name: ACCEPT })).toBeInTheDocument();
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: REJECT }));
    });
    await flushSave();
    expect(fake.saveNote).toHaveBeenCalledOnce();
    expect(fake.saveNote.mock.calls[0][2]).toBe("v4");
    expect(savedText(fake)).toBe(TEXT.replace("Mask ratios", "Mask ratio study"));
  });

  it("offers a change from outside that brings back an older save of this app", async () => {
    const fake = fakeData();
    const { editor } = await openNote(fake);
    typeBefore(editor, "trains", "really ");
    await flushSave();
    typeBefore(editor, "really", "quite ");
    await flushSave();
    fake.loadNote.mockResolvedValueOnce({ text: savedText(fake, 0), version: "v9" });
    await fake.diskChanged();
    expect(bodyText(editor)).toContain("quite really trains");
    expect(screen.getByRole("button", { name: REJECT })).toBeInTheDocument();
  });

  it("takes a change this app wrote elsewhere quietly when nothing here is unsaved", async () => {
    const fake = fakeData();
    const { editor, title, onStatusChange } = await openNote(fake);
    await recordNoteWrite("note-1", DISK, async () => undefined);
    fake.loadNote.mockResolvedValueOnce({ text: DISK, version: "v4" });
    await fake.diskChanged();
    expect(title.value).toBe("Mask ratio study");
    expect(bodyText(editor)).toContain("per patch");
    expect(bodyText(editor)).not.toContain("per pixel");
    expect(screen.queryByRole("button", { name: ACCEPT })).toBeNull();
    expect(onStatusChange).not.toHaveBeenCalled();
    await flushSave();
    expect(fake.saveNote).not.toHaveBeenCalled();
    typeBefore(editor, "trains", "really ");
    await flushSave();
    expect(fake.saveNote.mock.calls[0][2]).toBe("v4");
    expect(savedText(fake)).toBe(DISK.replace("trains", "really trains"));
  });

  async function openTwice() {
    const disk = { text: TEXT, version: 1 };
    const watchers = new Set<() => void>();
    const fake = fakeData();
    const changed = () => {
      for (const watcher of watchers) queueMicrotask(watcher);
    };
    fake.loadNote.mockImplementation(async () => ({ text: disk.text, version: `v${disk.version}` }));
    fake.saveNote.mockImplementation(async (_id, saved) => {
      disk.text = saved;
      disk.version += 1;
      changed();
      return { text: saved, version: `v${disk.version}` };
    });
    fake.watchNote.mockImplementation((_id, onChange) => {
      watchers.add(onChange);
      return vi.fn(() => {
        watchers.delete(onChange);
      });
    });
    render(
      <NotesDataProvider value={fake.data}>
        <NoteDocument note={NOTE} insertRequest={null} />
        <NoteDocument note={NOTE} insertRequest={null} />
      </NotesDataProvider>,
    );
    await screen.findAllByLabelText(enNotes.document.titleLabel);
    const [first, second] = [...document.querySelectorAll<HTMLElement & { editor?: Editor }>(".ProseMirror")].map(
      (dom) => dom.editor as Editor,
    );
    const settle = () =>
      act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    const writeOutside = async (text: string) => {
      disk.text = text;
      disk.version += 1;
      changed();
      await settle();
    };
    return { fake, disk, first, second, settle, writeOutside };
  }

  it("keeps a second editor of the same note in step without asking", async () => {
    const { fake, first, second, settle } = await openTwice();
    typeBefore(first, "trains", "really ");
    await flushSave();
    await settle();
    expect(bodyText(second)).toContain("really trains");
    expect(screen.queryByRole("button", { name: ACCEPT })).toBeNull();
    expect(screen.queryByRole("button", { name: REJECT })).toBeNull();
    expect(fake.saveNote).toHaveBeenCalledTimes(1);
    typeBefore(second, "Masks", "All ");
    await flushSave();
    await settle();
    expect(bodyText(first)).toContain("All Masks");
    expect(bodyText(first)).toContain("really trains");
    expect(screen.queryByRole("button", { name: ACCEPT })).toBeNull();
    expect(fake.saveNote).toHaveBeenCalledTimes(2);
  });

  it("does not queue another save when the watcher reports the save that is still running", async () => {
    const fake = fakeData();
    const running = deferred<NoteSource>();
    fake.saveNote.mockReturnValueOnce(running.promise);
    const { editor, onStatusChange } = await openNote(fake);
    typeBefore(editor, "trains", "really ");
    await flushSave();
    const written = savedText(fake);
    fake.loadNote.mockResolvedValueOnce({ text: written, version: "v2" });
    await fake.diskChanged();
    await act(async () => {
      running.resolve({ text: written, version: "v2" });
    });
    expect(noteEditorBusy("note-1")).toBe(false);
    expect(onStatusChange).toHaveBeenLastCalledWith("saved", null);
    expect(screen.queryByRole("button", { name: ACCEPT })).toBeNull();
  });

  it("offers a change made outside the app in every editor of the note, which follow the one that settles it", async () => {
    const { fake, disk, first, second, settle, writeOutside } = await openTwice();
    await writeOutside(TEXT.replace("per pixel", "per patch"));
    expect(screen.getAllByRole("button", { name: REJECT })).toHaveLength(2);
    expect(bodyText(first)).toContain("per pixel");
    expect(bodyText(second)).toContain("per pixel");
    act(() => {
      fireEvent.click(within(first.view.dom.closest("[data-note-width]") as HTMLElement).getByRole("button", { name: REJECT }));
    });
    await flushSave();
    await settle();
    expect(fake.saveNote).toHaveBeenCalledOnce();
    expect(disk.text).toBe(TEXT);
    expect(screen.queryByRole("button", { name: REJECT })).toBeNull();
    expect(screen.queryByRole("button", { name: ACCEPT })).toBeNull();
    expect(bodyText(second)).toContain("per pixel");
  });

  it("offers a changed file as suggestions while this note has unsaved edits", async () => {
    const fake = fakeData();
    const { editor, title } = await openNote(fake);
    typeBefore(editor, "Masks", "All ");
    fake.loadNote.mockResolvedValueOnce({ text: DISK, version: "v4" });
    await fake.diskChanged();
    expect(fake.loadNote).toHaveBeenLastCalledWith("note-1");
    expect(title.value).toBe("Mask ratio study");
    const floating = screen.getByRole("button", { name: ACCEPT }).closest("[data-note-review]");
    expect(floating).toHaveClass("fixed");
    expect(screen.getByTestId("note-assistant")).not.toContainElement(floating as HTMLElement);
    expect(scrollIntoView).not.toHaveBeenCalledWith({ block: "center" });
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: ACCEPT }));
    });
    expect(bodyText(editor)).toContain("per patch");
    expect(screen.queryByRole("button", { name: ACCEPT })).toBeNull();
    expect(screen.getByTestId("note-assistant")).toBeInTheDocument();
  });

  it("drops a disk suggestion that is rejected", async () => {
    const fake = fakeData();
    const { editor } = await openNote(fake);
    typeBefore(editor, "Masks", "All ");
    fake.loadNote.mockResolvedValueOnce({ text: DISK, version: "v4" });
    await fake.diskChanged();
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: REJECT }));
    });
    expect(bodyText(editor)).toContain("per pixel");
    expect(screen.queryByRole("button", { name: REJECT })).toBeNull();
  });

  it("takes the new version quietly when the disk text is what was saved", async () => {
    const fake = fakeData();
    const { editor } = await openNote(fake);
    fake.loadNote.mockResolvedValueOnce({ text: TEXT, version: "v7" });
    await fake.diskChanged();
    expect(screen.queryByRole("button", { name: ACCEPT })).toBeNull();
    typeBefore(editor, "trains", "really ");
    await flushSave();
    expect(fake.saveNote.mock.calls[0][2]).toBe("v7");
  });

  it("keeps quiet when the changed file cannot be read", async () => {
    const fake = fakeData();
    const { editor } = await openNote(fake);
    fake.loadNote.mockRejectedValueOnce(new Error("locked"));
    await fake.diskChanged();
    expect(screen.queryByRole("button", { name: ACCEPT })).toBeNull();
    expect(bodyText(editor)).toContain("per pixel");
  });

  it("keeps disk changes off text edited since the last save", async () => {
    const fake = fakeData();
    const { editor } = await openNote(fake);
    typeBefore(editor, "trains", "really ");
    fake.loadNote.mockResolvedValueOnce({ text: DISK, version: "v4" });
    await fake.diskChanged();
    expect(screen.getByRole("button", { name: ACCEPT })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: enNotes.review.acceptAll })).toBeNull();
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: ACCEPT }));
    });
    expect(bodyText(editor)).toContain("really trains");
    expect(bodyText(editor)).toContain("per patch");
  });

  it("offers disk changes to text that was already saved while other edits wait", async () => {
    const fake = fakeData();
    const { editor } = await openNote(fake);
    typeBefore(editor, "trains", "really ");
    await flushSave();
    typeBefore(editor, "0.75", "about ");
    fake.loadNote.mockResolvedValueOnce({ text: DISK, version: "v4" });
    await fake.diskChanged();
    expect(screen.getByRole("button", { name: enNotes.review.acceptAll })).toBeInTheDocument();
  });

  it("offers disk changes to text that was already saved", async () => {
    const fake = fakeData();
    const { editor } = await openNote(fake);
    typeBefore(editor, "trains", "really ");
    await flushSave();
    fake.loadNote.mockResolvedValueOnce({ text: DISK, version: "v4" });
    await fake.diskChanged();
    expect(screen.getByRole("button", { name: enNotes.review.acceptAll })).toBeInTheDocument();
    expect(bodyText(editor)).toContain("really trains");
    expect(bodyText(editor)).toContain("per pixel");
  });

  it("protects edits made while a save was running", async () => {
    const fake = fakeData();
    const first = deferred<NoteSource>();
    fake.saveNote.mockReturnValueOnce(first.promise);
    const { editor } = await openNote(fake);
    typeBefore(editor, "trains", "really ");
    await flushSave();
    typeBefore(editor, "really", "quite ");
    await act(async () => {
      first.resolve({ text: savedText(fake), version: "v2" });
    });
    fake.loadNote.mockResolvedValueOnce({ text: DISK, version: "v4" });
    await fake.diskChanged();
    expect(screen.getByRole("button", { name: ACCEPT })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: enNotes.review.acceptAll })).toBeNull();
  });

  it("stops watching the file when the note closes", async () => {
    const fake = fakeData();
    const { unmount } = await openNote(fake);
    expect(fake.watchNote).toHaveBeenCalledWith("note-1", expect.any(Function));
    unmount();
    expect(fake.stopWatching).toHaveBeenCalledTimes(1);
  });
});

describe("settling a review", () => {
  function reviewUndo() {
    const bar = document.querySelector<HTMLElement>("[data-note-review]");
    return bar ? within(bar).queryByRole("button", { name: enNotes.review.undo }) : null;
  }

  async function reviewTwo() {
    const fake = fakeData();
    const opened = await openNote(fake);
    typeBefore(opened.editor, "Masks", "All ");
    fake.loadNote.mockResolvedValueOnce({ text: DISK.replace("0.75", "0.60"), version: "v4" });
    await fake.diskChanged();
    return opened;
  }

  it("offers Undo after rejecting every change and puts focus back in the note", async () => {
    const { editor } = await reviewTwo();
    const rejectAll = screen.getByRole("button", { name: enNotes.review.rejectAll });
    act(() => {
      rejectAll.focus();
      fireEvent.click(rejectAll);
    });
    expect(screen.queryByRole("button", { name: enNotes.review.rejectAll })).toBeNull();
    expect(editor.view.hasFocus()).toBe(true);
    const undo = reviewUndo() as HTMLElement;
    act(() => {
      undo.focus();
      fireEvent.click(undo);
    });
    expect(screen.getByRole("button", { name: enNotes.review.rejectAll })).toBeInTheDocument();
    expect(reviewUndo()).toBeNull();
    expect(editor.view.hasFocus()).toBe(true);
  });

  it("puts focus back in the note after accepting a change from the bar", async () => {
    const { editor } = await reviewTwo();
    const accept = screen.getByRole("button", { name: ACCEPT });
    act(() => {
      accept.focus();
      fireEvent.click(accept);
    });
    expect(editor.view.hasFocus()).toBe(true);
  });

  it("drops the Undo once the note is edited again", async () => {
    const { editor } = await reviewTwo();
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: REJECT }));
    });
    expect(reviewUndo()).toBeInTheDocument();
    typeBefore(editor, "encoder", "big ");
    expect(reviewUndo()).toBeNull();
  });

  it("brings back rejected changes from the Edit menu's Undo, as the key does", async () => {
    const { editor } = await reviewTwo();
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: enNotes.review.rejectAll }));
    });
    act(() => {
      noteHistoryAt(editor.view.dom)?.(false);
    });
    expect(screen.getByRole("button", { name: enNotes.review.rejectAll })).toBeInTheDocument();
    expect(bodyText(editor)).toContain("All Masks");
  });
});

describe("front matter edits across changes elsewhere", () => {
  const WITH_STATUS = TEXT.replace(`id: ${ID}\n`, `id: ${ID}\nstatus: draft\n`);
  const DISK_STATUS = WITH_STATUS.replace("per pixel", "per patch").replace("Mask ratios", "Mask ratio study");

  function setStatus(value: string) {
    const status = screen.getByRole("textbox", { name: "Value of status" });
    fireEvent.change(status, { target: { value } });
    fireEvent.blur(status);
  }

  it("saves a property changed just before the file changed on disk", async () => {
    const fake = fakeData({ text: WITH_STATUS });
    const { title } = await openNote(fake);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setStatus("final");
    fake.loadNote.mockResolvedValueOnce({ text: DISK_STATUS, version: "v4" });
    await fake.diskChanged();
    expect(title.value).toBe("Mask ratio study");
    expect(screen.getByRole("textbox", { name: "Value of status" })).toHaveValue("final");
    await act(() => vi.advanceTimersByTimeAsync(800));
    expect(fake.saveNote).toHaveBeenCalledTimes(1);
    expect(fake.saveNote.mock.calls[0][2]).toBe("v4");
    expect(savedText(fake)).toBe(DISK_STATUS.replace("status: draft", "status: final"));
  });

  it("saves a property change whose first save hit a conflict", async () => {
    const fake = fakeData({ text: WITH_STATUS });
    fake.saveNote.mockRejectedValueOnce(new NoteConflictError({ text: DISK_STATUS, version: "v9" }));
    const { onStatusChange } = await openNote(fake);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setStatus("final");
    await flushSave();
    await act(() => vi.advanceTimersByTimeAsync(800));
    expect(fake.saveNote).toHaveBeenCalledTimes(2);
    expect(fake.saveNote.mock.calls[1][2]).toBe("v9");
    expect(savedText(fake)).toBe(DISK_STATUS.replace("status: draft", "status: final"));
    expect(onStatusChange).toHaveBeenLastCalledWith("saved", null);
  });

  it("keeps this note's value when the disk changed the same property", async () => {
    const fake = fakeData({ text: WITH_STATUS });
    await openNote(fake);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setStatus("final");
    fake.loadNote.mockResolvedValueOnce({ text: WITH_STATUS.replace("status: draft", "status: review\nowner: Ada"), version: "v4" });
    await fake.diskChanged();
    await act(() => vi.advanceTimersByTimeAsync(800));
    expect(savedText(fake)).toBe(WITH_STATUS.replace("status: draft", "status: final\nowner: Ada"));
  });

  it("keeps an icon picked before the file changed on disk", async () => {
    const fake = fakeData();
    await openNote(fake);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fireEvent.click(screen.getByTestId("pick-icon"));
    fake.loadNote.mockResolvedValueOnce({ text: DISK, version: "v4" });
    await fake.diskChanged();
    expect(screen.getByTestId("icon-trigger")).toHaveAttribute("data-value", "🧪");
    await act(() => vi.advanceTimersByTimeAsync(800));
    expect(savedText(fake)).toBe(DISK.replace(`id: ${ID}\n`, `id: ${ID}\nicon: 🧪\n`));
  });

  it("does not write when the disk change leaves nothing of this note to save", async () => {
    const fake = fakeData({ text: WITH_STATUS });
    await openNote(fake);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fake.loadNote.mockResolvedValueOnce({ text: DISK_STATUS, version: "v4" });
    await fake.diskChanged();
    await act(() => vi.advanceTimersByTimeAsync(800));
    expect(fake.saveNote).not.toHaveBeenCalled();
  });

  it("keeps focus in the note after removing a property, so undo brings it back", async () => {
    const rect = new DOMRect(0, 0, 0, 0);
    Range.prototype.getClientRects = () => [rect] as unknown as DOMRectList;
    Range.prototype.getBoundingClientRect = () => rect;
    try {
      const fake = fakeData({ text: WITH_STATUS });
      const { editor } = await openNote(fake);
      fireEvent.pointerDown(screen.getByRole("button", { name: "status type: Text" }), { button: 0, ctrlKey: false, pointerType: "mouse" });
      fireEvent.click(screen.getByRole("menuitem", { name: enNotes.kb.properties.remove }));
      expect(screen.queryByRole("textbox", { name: "Value of status" })).toBeNull();
      await vi.waitFor(() => expect(document.activeElement).toBe(editor.view.dom));
      act(() => {
        noteHistoryAt(document.activeElement)?.(false);
      });
      expect(screen.getByRole("textbox", { name: "Value of status" })).toHaveValue("draft");
      act(() => editor.commands.blur());
    } finally {
      Reflect.deleteProperty(Range.prototype, "getClientRects");
      Reflect.deleteProperty(Range.prototype, "getBoundingClientRect");
    }
  });
});

describe("bytes outside the edit", () => {
  it.each([
    ["no blank line", `---\ntitle: Mask ratios\nkind: note\nid: ${ID}\n---\n${BODY}`],
    ["two blank lines", `---\ntitle: Mask ratios\nkind: note\nid: ${ID}\n---\n\n\n${BODY}`],
    ["a document end closer", `---\ntitle: Mask ratios\nkind: note\nid: ${ID}\n...\n\n${BODY}`],
    ["a byte order mark", `\uFEFF---\ntitle: Mask ratios\nkind: note\nid: ${ID}\n---\n\n${BODY}`],
  ])("keeps %s between the front matter and the body", async (_name, text) => {
    const fake = fakeData({ text });
    const { editor } = await openNote(fake);
    typeBefore(editor, "trains", "really ");
    await flushSave();
    expect(savedText(fake)).toBe(text.replace("trains", "really trains"));
  });

  it("gives front matter with a byte order mark its identity in place", async () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue(NEW_ID);
    const fake = fakeData({ text: `\uFEFF---\ntitle: Mask ratios\n...\n\n${BODY}` });
    const { editor } = await openNote(fake);
    typeBefore(editor, "trains", "really ");
    await flushSave();
    expect(savedText(fake)).toBe(
      `\uFEFF---\ntitle: Mask ratios\nkind: note\nid: ${NEW_ID}\n...\n\n${BODY.replace("trains", "really trains")}`,
    );
  });

  it("does not write a CRLF note again when nothing changed since the last save", async () => {
    const fake = fakeData({ text: `${TEXT}\n- first step\n- second step\n`.replace(/\n/gu, "\r\n") });
    fake.saveNote.mockImplementation(async (_id, saved) => ({ text: saved.replace(/\r?\n/gu, "\r\n"), version: "v2" }));
    const { editor, onStatusChange } = await openNote(fake);
    typeBefore(editor, "step", "small ");
    await flushSave();
    expect(savedText(fake)).toContain("- first small step\r\n- second step\r\n");
    typeBefore(editor, "trains", "x");
    deleteText(editor, "x");
    await flushSave();
    expect(fake.saveNote).toHaveBeenCalledTimes(1);
    expect(onStatusChange).toHaveBeenLastCalledWith("saved", null);
  });

  it("does not rewrite an imported title longer than a project name", async () => {
    const long = `${"A".repeat(150)} ${"B".repeat(80)}`;
    const fake = fakeData({ text: TEXT.replace("title: Mask ratios", `title: ${long}`) });
    const { title, unmount } = await openNote(fake, { note: { ...NOTE, title: Array.from(long).slice(0, 200).join("").trim() } });
    expect(title.value).toBe(long);
    await flushSave();
    await act(async () => {
      unmount();
    });
    expect(fake.saveNote).not.toHaveBeenCalled();
  });
});

describe("title and icon", () => {
  it("keeps the WebView's own spell check off the title and properties, which the note's checker does not read", async () => {
    const { title } = await openNote(fakeData());
    expect(title.closest('[spellcheck="false"]')).not.toBeNull();
    expect(title.closest(".group\\/header")).toBe(title.closest('[spellcheck="false"]'));
  });

  it("renames the note and writes the title into the front matter", async () => {
    const fake = fakeData();
    const { title } = await openNote(fake);
    fireEvent.change(title, { target: { value: "  Mask ratio study  " } });
    fireEvent.blur(title);
    expect(fake.renameNote).toHaveBeenCalledWith("note-1", "Mask ratio study");
    await flushSave();
    expect(savedText(fake)).toBe(TEXT.replace("title: Mask ratios", "title: Mask ratio study"));
  });

  it("puts the title back and says so when the rename fails", async () => {
    const fake = fakeData();
    const failure = new Error("name taken");
    fake.renameNote.mockRejectedValueOnce(failure);
    const { title } = await openNote(fake);
    fireEvent.change(title, { target: { value: "Mask ratio study" } });
    await act(async () => {
      fireEvent.blur(title);
    });
    expect(toasts.notifyError).toHaveBeenCalledWith(
      "rename note",
      failure,
      enNotes.library.menu.renameFailed.replace("{{name}}", "Mask ratios"),
    );
    expect(title.value).toBe("Mask ratios");
    await flushSave();
    expect(fake.saveNote).not.toHaveBeenCalled();
  });

  it("commits the title and moves into the body on Enter", async () => {
    const fake = fakeData();
    const { title, editor } = await openNote(fake);
    vi.spyOn(editor.view, "coordsAtPos").mockReturnValue({ top: 0, bottom: 16, left: 0, right: 0 });
    vi.spyOn(window, "scrollBy").mockImplementation(() => {});
    title.focus();
    fireEvent.change(title, { target: { value: "Mask ratio study" } });
    const enter = fireEvent.keyDown(title, { key: "Enter" });
    expect(enter).toBe(false);
    expect(editor.state.selection.from).toBe(1);
    await act(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    expect(document.activeElement).toBe(editor.view.dom);
    expect(fake.renameNote).toHaveBeenCalledWith("note-1", "Mask ratio study");
  });

  it("restores the title on Escape", async () => {
    const fake = fakeData();
    const { title } = await openNote(fake);
    fireEvent.change(title, { target: { value: "Something else" } });
    fireEvent.keyDown(title, { key: "a" });
    expect(title.value).toBe("Something else");
    fireEvent.keyDown(title, { key: "Escape" });
    expect(title.value).toBe("Mask ratios");
    fireEvent.blur(title);
    expect(fake.renameNote).not.toHaveBeenCalled();
  });

  it("restores a title that was cleared", async () => {
    const fake = fakeData();
    const { title, onStatusChange } = await openNote(fake);
    fireEvent.change(title, { target: { value: "   " } });
    fireEvent.blur(title);
    expect(title.value).toBe("Mask ratios");
    expect(fake.renameNote).not.toHaveBeenCalled();
    expect(onStatusChange).not.toHaveBeenCalled();
  });

  it("leaves an unchanged title alone", async () => {
    const fake = fakeData();
    const { title, onStatusChange } = await openNote(fake);
    fireEvent.blur(title);
    expect(fake.renameNote).not.toHaveBeenCalled();
    expect(onStatusChange).not.toHaveBeenCalled();
  });

  it("uses and restores the library title for a note without front matter", async () => {
    const fake = fakeData({ text: BODY });
    const { title } = await openNote(fake, { note: { ...NOTE, title: "Masking notes" } });
    expect(title.value).toBe("Masking notes");
    fireEvent.change(title, { target: { value: "Draft" } });
    fireEvent.keyDown(title, { key: "Escape" });
    expect(title.value).toBe("Masking notes");
    fireEvent.change(title, { target: { value: "" } });
    fireEvent.blur(title);
    expect(title.value).toBe("Masking notes");
    expect(fake.renameNote).not.toHaveBeenCalled();
  });

  it("saves a renamed note without rename or watch support", async () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue(NEW_ID);
    const fake = fakeData({ text: BODY, withOptional: false });
    const { title } = await openNote(fake);
    fireEvent.change(title, { target: { value: "Fresh title" } });
    fireEvent.blur(title);
    await flushSave();
    expect(fake.renameNote).not.toHaveBeenCalled();
    expect(savedText(fake)).toBe(`---\ntitle: Fresh title\nkind: note\nid: ${NEW_ID}\n---\n\n${BODY}`);
  });

  it("adds an icon to the front matter", async () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue(NEW_ID);
    const fake = fakeData({ text: BODY });
    await openNote(fake);
    const trigger = screen.getByTestId("icon-trigger");
    expect(trigger).toHaveAttribute("data-value", "none");
    expect(trigger.querySelector("[data-add-icon]")).toHaveTextContent("Add icon");
    expect(trigger.querySelector("[data-note-color]")).toBeNull();
    expect(screen.queryByTestId("remove-icon")).toBeNull();
    fireEvent.click(screen.getByTestId("pick-icon"));
    expect(screen.getByTestId("icon-trigger")).toHaveTextContent("🧪");
    expect(screen.getByTestId("icon-trigger")).toHaveAttribute("data-value", "🧪");
    await flushSave();
    expect(savedText(fake)).toBe(`---\nicon: 🧪\nkind: note\nid: ${NEW_ID}\n---\n\n${BODY}`);
  });

  it("undoes and redoes an icon change with the note's own undo", async () => {
    const fake = fakeData();
    const { editor } = await openNote(fake);
    fireEvent.click(screen.getByTestId("pick-icon"));
    expect(screen.getByTestId("icon-trigger")).toHaveAttribute("data-value", "🧪");
    act(() => {
      editor.commands.undo();
    });
    expect(screen.getByTestId("icon-trigger")).toHaveAttribute("data-value", "none");
    act(() => {
      editor.commands.redo();
    });
    expect(screen.getByTestId("icon-trigger")).toHaveAttribute("data-value", "🧪");
    act(() => {
      noteHistoryAt(screen.getByTestId("pick-icon"))?.(false);
    });
    expect(screen.getByTestId("icon-trigger")).toHaveAttribute("data-value", "none");
    await flushSave();
    expect(fake.saveNote.mock.calls.every((call) => call[1] === TEXT)).toBe(true);
  });

  it("keeps undo of a property from wiping a change that came from disk since", async () => {
    const fake = fakeData();
    const { editor } = await openNote(fake);
    fireEvent.click(screen.getByTestId("pick-icon"));
    await flushSave();
    fake.loadNote.mockResolvedValueOnce({ text: savedText(fake).replace("Mask ratios", "Mask ratio study"), version: "v9" });
    await fake.diskChanged();
    act(() => {
      editor.commands.undo();
    });
    expect(screen.getByTestId("icon-trigger")).toHaveAttribute("data-value", "none");
    expect(screen.getByLabelText<HTMLInputElement>(enNotes.document.titleLabel).value).toBe("Mask ratio study");
  });

  it("leaves a title change out of the note's undo", async () => {
    const fake = fakeData();
    const { title, editor } = await openNote(fake);
    fireEvent.change(title, { target: { value: "Mask ratio study" } });
    fireEvent.blur(title);
    act(() => {
      editor.commands.undo();
    });
    expect(title.value).toBe("Mask ratio study");
  });

  it("removes the icon from the front matter", async () => {
    const fake = fakeData({ text: TEXT.replace("title: Mask ratios\n", "title: Mask ratios\nicon: 🧪\n") });
    await openNote(fake);
    expect(screen.getByTestId("icon-trigger")).toHaveTextContent("🧪");
    fireEvent.click(screen.getByTestId("remove-icon"));
    expect(screen.getByTestId("icon-trigger").querySelector("[data-add-icon]")).not.toBeNull();
    expect(screen.getByTestId("icon-trigger").querySelector("[data-note-color]")).toBeNull();
    await flushSave();
    expect(savedText(fake)).toBe(TEXT);
  });
});

describe("the note's look", () => {
  it("shows the icon in a large chip tinted with the colour the note's id gives it", async () => {
    await openNote(fakeData({ text: TEXT.replace("title: Mask ratios\n", "title: Mask ratios\nicon: lucide:atom\n") }));
    const chip = screen.getByTestId("icon-trigger").querySelector("[data-note-color]") as HTMLElement;
    expect(chip).toHaveAttribute("data-note-color", "cream");
    expect(chip).toHaveClass("note-chip", "size-14");
    expect(chip.style.getPropertyValue("--note-color")).toBe(NOTE_COLOR_HEX.cream);
    expect(chip.querySelector("svg")).toHaveClass("lucide-atom", "text-current");
    expect(screen.getByTestId("icon-trigger")).toHaveAttribute("data-color", "cream");
  });

  it("uses the colour the front matter names", async () => {
    await openNote(fakeData({ text: TEXT.replace("title: Mask ratios\n", "title: Mask ratios\nicon: lucide:atom\ncolor: rose\n") }));
    expect(screen.getByTestId("icon-trigger").querySelector("[data-note-color]")).toHaveAttribute("data-note-color", "rose");
    expect(screen.getByTestId("icon-trigger")).toHaveAttribute("data-color", "rose");
  });

  it("saves a colour picked in the icon picker to the front matter", async () => {
    const fake = fakeData();
    await openNote(fake);
    fireEvent.click(screen.getByTestId("pick-color"));
    expect(screen.getByTestId("icon-trigger")).toHaveAttribute("data-color", "lilac");
    await flushSave();
    expect(savedText(fake)).toBe(`---\ntitle: Mask ratios\nkind: note\nid: ${ID}\ncolor: lilac\n---\n\n${BODY}`);
  });

  it("replaces the colour the front matter already names", async () => {
    const fake = fakeData({ text: TEXT.replace("title: Mask ratios\n", "title: Mask ratios\ncolor: rose\n") });
    await openNote(fake);
    fireEvent.click(screen.getByTestId("pick-color"));
    await flushSave();
    expect(savedText(fake)).toBe(TEXT.replace("title: Mask ratios\n", "title: Mask ratios\ncolor: lilac\n"));
  });

  it("lays the note out at the width the person picked, in every open note", async () => {
    localStorage.removeItem(NOTE_WIDTH_KEY);
    await openNote(fakeData());
    const article = screen.getByRole("article");
    expect(article).toHaveClass("max-w-[44rem]", "px-4");
    act(() => saveNoteWidth("wide"));
    expect(article).toHaveClass("max-w-[58rem]");
    act(() => saveNoteWidth("full"));
    expect(article).toHaveClass("max-w-none", "px-[max(1rem,5%)]");
    expect(article.closest("[data-note-width]")).toHaveAttribute("data-note-width", "full");
    act(() => saveNoteWidth("standard"));
  });

  it("listens for the prompt shortcut across the whole note", async () => {
    await openNote(fakeData());
    expect(prompts.scope?.current).toBe(screen.getByRole("article").parentElement);
  });
});

describe("renames made elsewhere", () => {
  const renamed = { ...NOTE, title: "Encoder ablations" };

  it("takes the library name on load when the front matter title differs", async () => {
    const fake = fakeData();
    const { title } = await openNote(fake, { note: renamed });
    expect(title.value).toBe("Encoder ablations");
    await flushSave();
    expect(savedText(fake)).toBe(TEXT.replace("title: Mask ratios", "title: Encoder ablations"));
    expect(fake.renameNote).not.toHaveBeenCalled();
  });

  it("adopts a rename from the sidebar into the title and the front matter", async () => {
    const fake = fakeData();
    const { title, showNote } = await openNote(fake);
    showNote(renamed);
    expect(title.value).toBe("Encoder ablations");
    await flushSave();
    expect(savedText(fake)).toBe(TEXT.replace("title: Mask ratios", "title: Encoder ablations"));
    expect(fake.renameNote).not.toHaveBeenCalled();
  });

  it("follows a rename of a note without a title in its front matter, without writing", async () => {
    const fake = fakeData({ text: BODY });
    const { title, showNote, onStatusChange } = await openNote(fake);
    showNote(renamed);
    expect(title.value).toBe("Encoder ablations");
    expect(onStatusChange).not.toHaveBeenCalled();
  });

  it("leaves the field alone while the person edits it and keeps their own name", async () => {
    const fake = fakeData();
    const { title, showNote } = await openNote(fake);
    fireEvent.focus(title);
    fireEvent.change(title, { target: { value: "My own name" } });
    showNote(renamed);
    expect(title.value).toBe("My own name");
    fireEvent.blur(title);
    expect(fake.renameNote).toHaveBeenCalledWith("note-1", "My own name");
    await flushSave();
    expect(savedText(fake)).toBe(TEXT.replace("title: Mask ratios", "title: My own name"));
  });

  it("takes the rename once the person leaves the field unchanged", async () => {
    const fake = fakeData();
    const { title, showNote } = await openNote(fake);
    fireEvent.focus(title);
    showNote(renamed);
    expect(title.value).toBe("Mask ratios");
    fireEvent.blur(title);
    expect(title.value).toBe("Encoder ablations");
    expect(fake.renameNote).not.toHaveBeenCalled();
    await flushSave();
    expect(savedText(fake)).toBe(TEXT.replace("title: Mask ratios", "title: Encoder ablations"));
  });

  it("takes the rename when the person clears the field", async () => {
    const fake = fakeData();
    const { title, showNote } = await openNote(fake);
    fireEvent.focus(title);
    showNote(renamed);
    fireEvent.change(title, { target: { value: "  " } });
    fireEvent.blur(title);
    expect(title.value).toBe("Encoder ablations");
    expect(fake.renameNote).not.toHaveBeenCalled();
  });
});

describe("the assistant", () => {
  function bridge(): NoteEditorBridge {
    if (!assistant.bridge) throw new Error("assistant not shown");
    return assistant.bridge;
  }

  function propose(...edits: { find: string; replace: string }[]): number {
    let count = 0;
    act(() => {
      count = bridge().propose(edits);
    });
    return count;
  }

  it("shows suggestions the assistant made while the note was closed", async () => {
    addPendingBatch("note-1", [{ find: "per pixel", replace: "per patch" }]);
    const { editor } = await openNote(fakeData());
    expect(screen.getByRole("button", { name: ACCEPT })).toBeInTheDocument();
    expect(pendingBatches("note-1")).toEqual([]);
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: ACCEPT }));
    });
    expect(bodyText(editor)).toContain("per patch");
  });

  it("keeps the suggestions on screen when the note closes and shows them again when it reopens", async () => {
    const fake = fakeData();
    const { unmount } = await openNote(fake);
    expect(propose({ find: "per pixel", replace: "per patch" })).toBe(1);
    await act(async () => {
      unmount();
    });
    expect(pendingBatches("note-1")).toHaveLength(1);
    expect(fake.saveNote).not.toHaveBeenCalled();
    const { editor } = await openNote(fake);
    expect(screen.getByRole("button", { name: ACCEPT })).toBeInTheDocument();
    expect(bodyText(editor)).toContain("per pixel");
  });

  it("waits until a live note can be edited before it shows stored suggestions", async () => {
    addPendingBatch("note-1", [{ find: "per pixel", replace: "per patch" }]);
    useCollabEditorGate.setState({ projectId: "note-1", connecting: true });
    try {
      await openNote(fakeData());
      expect(screen.queryByRole("button", { name: ACCEPT })).toBeNull();
      expect(pendingBatches("note-1")).toHaveLength(1);
      act(() => useCollabEditorGate.setState({ connecting: false }));
      expect(screen.getByRole("button", { name: ACCEPT })).toBeInTheDocument();
    } finally {
      useCollabEditorGate.setState({ projectId: null, connecting: false });
    }
  });

  it("shows the assistant for the open note and remounts it for another note", async () => {
    const { showNote } = await openNote(fakeData());
    expect(screen.getByTestId("note-assistant")).toHaveAttribute("data-note", "note-1");
    showNote({ ...NOTE, id: "note-2" });
    expect(screen.getByTestId("note-assistant")).toHaveAttribute("data-note", "note-2");
  });

  it("reads the note's current Markdown, front matter included", async () => {
    const { editor } = await openNote(fakeData());
    expect(bridge().readSource()).toBe(TEXT);
    typeBefore(editor, "Masks", "Random ");
    expect(bridge().readSource()).toContain("Random Masks are sampled");
  });

  it("reads a note without front matter as its body before any save", async () => {
    await openNote(fakeData({ text: BODY }));
    expect(bridge().readSource()).toBe(BODY);
  });

  it("turns proposed edits into suggestions the person reviews", async () => {
    const { editor } = await openNote(fakeData());
    expect(propose({ find: "0.75", replace: "0.60" })).toBe(1);
    expect(bridge().pending()).toBe(1);
    expect(bodyText(editor)).toContain("0.75");
    expect(bridge().readSource()).toContain("ratio of 0.60.");
    fireEvent.click(screen.getByRole("button", { name: ACCEPT }));
    expect(bodyText(editor)).toContain("ratio of 0.60.");
    expect(bridge().pending()).toBe(0);
  });

  it("keeps earlier suggestions when the assistant proposes more in the same turn", async () => {
    const { editor } = await openNote(fakeData());
    propose({ find: "0.75", replace: "0.60" });
    expect(propose({ find: "per pixel", replace: "per patch" })).toBe(2);
    const position = (current: number) =>
      enNotes.review.position.replace("{{current}}", String(current)).replace("{{total}}", "2");
    expect(screen.getByText(position(1))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: enEditor.diff.nextChange }));
    expect(screen.getByText(position(2))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: enEditor.diff.previousChange }));
    expect(screen.getByText(position(1))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: enNotes.review.rejectAll }));
    expect(bodyText(editor)).toContain("0.75");
    expect(bodyText(editor)).toContain("per pixel");
    propose({ find: "0.75", replace: "0.60" }, { find: "per pixel", replace: "per patch" });
    fireEvent.click(screen.getByRole("button", { name: enNotes.review.acceptAll }));
    expect(bodyText(editor)).toContain("0.60");
    expect(bodyText(editor)).toContain("per patch");
  });

  it("places edits on the note as shown when its Markdown reads back differently", async () => {
    const { editor } = await openNote(fakeData());
    act(() => {
      editor.view.dispatch(editor.state.tr.insert(editor.state.doc.content.size, editor.schema.nodes.paragraph.create()));
    });
    propose({ find: "0.75", replace: "0.60" });
    fireEvent.click(screen.getByRole("button", { name: ACCEPT }));
    expect(bodyText(editor)).toContain("ratio of 0.60.");
    expect(bodyText(editor)).toContain("per pixel.");
  });

  it("reports no suggestions for an edit that changes nothing visible", async () => {
    await openNote(fakeData());
    expect(propose({ find: "title: Mask ratios", replace: "title: Masks" })).toBe(0);
    expect(screen.queryByRole("button", { name: ACCEPT })).toBeNull();
  });

});

describe("a note that can't be edited right now", () => {
  it("leaves out every control that would change it until it can be edited again", async () => {
    useCollabEditorGate.setState({ projectId: "note-1", connecting: true });
    try {
      const fake = fakeData({ text: TEXT.replace(`id: ${ID}\n`, `id: ${ID}\nstatus: draft\n`) });
      const { editor, title, requestInsert } = await openNote(fake);
      expect(editor.isEditable).toBe(false);
      expect(title).toHaveAttribute("readonly");
      expect(screen.queryByTestId("pick-icon")).toBeNull();
      expect(screen.queryByRole("button", { name: enNotes.toolbar.blockType })).toBeNull();
      expect(screen.getByRole("textbox", { name: "Value of status" })).toBeDisabled();
      requestInsert({ snippet: "![Loss](figs/loss.png)", id: 1 });
      expect(bodyText(editor)).not.toContain("Loss");
      act(() => useCollabEditorGate.setState({ connecting: false }));
      expect(editor.isEditable).toBe(true);
      expect(screen.getByRole("button", { name: enNotes.toolbar.blockType })).toBeInTheDocument();
      expect(screen.getByRole("textbox", { name: "Value of status" })).toBeEnabled();
    } finally {
      useCollabEditorGate.setState({ projectId: null, connecting: false });
    }
  });
});

describe("front matter that can't be read", () => {
  const BROKEN = "---\ntitle: [Mask\n---\n\nBody\n";

  it("opens a personal note's Markdown in its project", async () => {
    const fake = fakeData({ text: BROKEN });
    const openProject = vi.fn();
    fake.data.openProject = openProject;
    await openNote(fake);
    fireEvent.click(screen.getByRole("button", { name: enNotes.kb.properties.editSource }));
    expect(openProject).toHaveBeenCalledWith("note-1");
  });

  it("switches a project note to Markdown editing", async () => {
    const fake = fakeData({ text: BROKEN });
    await openNote(fake, { note: { ...NOTE, home: { projectId: "paper", path: "notes/a.md" } } });
    fireEvent.click(screen.getByRole("button", { name: enNotes.kb.properties.editSource }));
    expect(editsAsMarkdown(useNoteTabsStore.getState(), "paper", "notes/a.md")).toBe(true);
    useNoteTabsStore.getState().setMarkdown("paper", "notes/a.md", false);
  });
});

describe("selection bubble", () => {
  function bubbleButton(name: string) {
    return screen.queryByRole("button", { name });
  }

  async function frame() {
    await act(async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });
  }

  async function openWithSelection(fake: Fake, top = 200) {
    const opened = await openNote(fake);
    vi.spyOn(opened.editor.view, "coordsAtPos").mockReturnValue({ top, bottom: top + 16, left: 48, right: 90 });
    select(opened.editor, "mask ratio");
    await frame();
    return opened;
  }

  it("opens below a selection at the top of the window", async () => {
    await openWithSelection(fakeData(), 20);
    expect(bubbleButton(enNotes.document.askAgent)?.parentElement).toHaveStyle({ top: "44px", left: "48px" });
  });

  it("quotes the selection with the Ask agent shortcut", async () => {
    const { editor } = await openWithSelection(fakeData());
    act(() => editor.view.focus());
    const key = new KeyboardEvent("keydown", { key: "j", ctrlKey: true, bubbles: true, cancelable: true });
    act(() => {
      editor.view.dom.dispatchEvent(key);
    });
    expect(assistant.quote).toHaveBeenCalledWith("mask ratio");
    expect(key.defaultPrevented).toBe(true);
    act(() => {
      editor.commands.setTextSelection(3);
    });
    const empty = new KeyboardEvent("keydown", { key: "j", ctrlKey: true, bubbles: true, cancelable: true });
    act(() => {
      editor.view.dom.dispatchEvent(empty);
    });
    expect(assistant.quote).toHaveBeenCalledTimes(1);
    expect(empty.defaultPrevented).toBe(false);
  });

  it("sends a selection across blocks as Markdown", async () => {
    const fake = fakeData({ text: `${TEXT}\n- first step\n- second step\n` });
    const opened = await openNote(fake);
    vi.spyOn(opened.editor.view, "coordsAtPos").mockReturnValue({ top: 200, bottom: 216, left: 48, right: 90 });
    act(() => {
      const from = positionOf(opened.editor, "Masks");
      const to = positionOf(opened.editor, "second step") + "second step".length;
      opened.editor.commands.setTextSelection({ from, to });
    });
    await frame();
    fireEvent.click(bubbleButton(enNotes.document.sendToPaper) as HTMLElement);
    expect(opened.onSendToPaper.mock.lastCall?.[0]).toMatch(/^Masks are sampled per pixel\.\n\n[-*] first step\n[-*] second step$/u);
    fireEvent.click(bubbleButton(enNotes.document.askAgent) as HTMLElement);
    expect(assistant.quote.mock.lastCall?.[0]).toBe(opened.onSendToPaper.mock.lastCall?.[0]);
  });

  it("follows the Ask agent shortcut set in Settings and shows it on the button", async () => {
    useShortcutStore.getState().setBinding("notesAskAgent", { key: "k", mod: true, shift: true });
    try {
      const { editor } = await openWithSelection(fakeData());
      expect(bubbleButton(enNotes.document.askAgent)).toHaveTextContent("Ctrl+Shift+K");
      act(() => editor.view.focus());
      const old = new KeyboardEvent("keydown", { key: "j", ctrlKey: true, bubbles: true, cancelable: true });
      act(() => {
        editor.view.dom.dispatchEvent(old);
      });
      expect(assistant.quote).not.toHaveBeenCalled();
      const rebound = new KeyboardEvent("keydown", { key: "K", ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true });
      act(() => {
        editor.view.dom.dispatchEvent(rebound);
      });
      expect(assistant.quote).toHaveBeenCalledWith("mask ratio");
    } finally {
      useShortcutStore.getState().resetAll();
    }
  });

  it("takes Command and not Control for the Ask agent shortcut on a Mac", async () => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    const { editor } = await openWithSelection(fakeData());
    act(() => editor.view.focus());
    const control = new KeyboardEvent("keydown", { key: "j", ctrlKey: true, bubbles: true, cancelable: true });
    act(() => {
      editor.view.dom.dispatchEvent(control);
    });
    expect(assistant.quote).not.toHaveBeenCalled();
    const command = new KeyboardEvent("keydown", { key: "j", metaKey: true, bubbles: true, cancelable: true });
    act(() => {
      editor.view.dom.dispatchEvent(command);
    });
    expect(assistant.quote).toHaveBeenCalledWith("mask ratio");
  });

  it("appears above a selection and sends it to the paper", async () => {
    const { onSendToPaper } = await openWithSelection(fakeData());
    const send = bubbleButton(enNotes.document.sendToPaper);
    expect(send).not.toBeNull();
    expect(send?.parentElement).toHaveStyle({ top: "160px", left: "48px" });
    expect(fireEvent.mouseDown(send as HTMLElement)).toBe(false);
    fireEvent.click(send as HTMLElement);
    expect(onSendToPaper).toHaveBeenCalledWith("mask ratio");
  });

  it("offers no Send to paper when there is no paper to send to", async () => {
    const opened = await openNote(fakeData(), { withoutPaper: true });
    vi.spyOn(opened.editor.view, "coordsAtPos").mockReturnValue({ top: 200, bottom: 216, left: 48, right: 90 });
    select(opened.editor, "mask ratio");
    await frame();
    expect(bubbleButton(enNotes.document.askAgent)).not.toBeNull();
    expect(bubbleButton(enNotes.document.sendToPaper)).toBeNull();
  });

  it("hands the selection to the assistant as a quote", async () => {
    await openWithSelection(fakeData());
    const ask = bubbleButton(enNotes.document.askAgent) as HTMLElement;
    expect(fireEvent.mouseDown(ask)).toBe(false);
    fireEvent.click(ask);
    expect(assistant.quote).toHaveBeenCalledWith("mask ratio");
  });

  it("hides when the selection collapses", async () => {
    const { editor } = await openWithSelection(fakeData());
    act(() => {
      editor.commands.setTextSelection(3);
    });
    expect(bubbleButton(enNotes.document.askAgent)).toBeNull();
  });

  it("hides for a selection of blank space", async () => {
    const { editor } = await openWithSelection(fakeData());
    act(() => {
      const from = positionOf(editor, " mask");
      editor.commands.setTextSelection({ from, to: from + 1 });
    });
    await frame();
    expect(bubbleButton(enNotes.document.askAgent)).toBeNull();
  });

  it("hides when the editor loses focus", async () => {
    const { editor } = await openWithSelection(fakeData());
    act(() => {
      fireEvent.blur(editor.view.dom);
    });
    expect(bubbleButton(enNotes.document.askAgent)).toBeNull();
  });

  it("hides when the note scrolls", async () => {
    const { container } = await openWithSelection(fakeData());
    act(() => {
      fireEvent.scroll(container.firstElementChild as HTMLElement);
    });
    expect(bubbleButton(enNotes.document.askAgent)).toBeNull();
  });
});

describe("artifact inserts", () => {
  beforeAll(() => {
    const rect = new DOMRect(0, 0, 0, 0);
    Range.prototype.getClientRects = () => [rect] as unknown as DOMRectList;
    Range.prototype.getBoundingClientRect = () => rect;
  });

  afterAll(async () => {
    await new Promise((settle) => setTimeout(settle, 50));
    Reflect.deleteProperty(Range.prototype, "getClientRects");
    Reflect.deleteProperty(Range.prototype, "getBoundingClientRect");
  });

  it("adds a snippet at the end of the note", async () => {
    const fake = fakeData();
    const { editor, requestInsert } = await openNote(fake);
    requestInsert({ snippet: "**Figure 2** shows the loss.", id: 1 });
    expect(bodyText(editor).endsWith("Figure 2 shows the loss.")).toBe(true);
    await flushSave();
    expect(savedText(fake)).toBe(`${TEXT}\n**Figure 2** shows the loss.\n`);
  });

  it("adds the same snippet again for each new request", async () => {
    const fake = fakeData();
    const { editor, requestInsert } = await openNote(fake);
    requestInsert({ snippet: "[Metrics](metrics.csv)", id: 1 });
    requestInsert({ snippet: "[Metrics](metrics.csv)", id: 2 });
    expect(bodyText(editor).match(/Metrics/gu)).toHaveLength(2);
    await flushSave();
    expect(savedText(fake)).toBe(`${TEXT}\n[Metrics](metrics.csv)\n\n[Metrics](metrics.csv)\n`);
  });

  it("adds a requested snippet once, not again when the note opens again", async () => {
    const fake = fakeData();
    const request = { snippet: "**Figure 2** shows the loss.", id: 1 };
    const first = await openNote(fake, { insertRequest: request });
    expect(bodyText(first.editor)).toContain("Figure 2 shows the loss.");
    await act(async () => {
      first.unmount();
    });
    const second = await openNote(fake, { insertRequest: request });
    expect(bodyText(second.editor)).not.toContain("Figure 2");
  });

  it("jumps to a requested heading once, not again when the note opens again", async () => {
    const fake = fakeData({ text: `${TEXT}\n## Results\n\nDone.\n` });
    const request = { slug: "results", id: 1 };
    const tree = () => (
      <NotesDataProvider value={fake.data}>
        <NoteDocument note={NOTE} insertRequest={null} openHeading={request} />
      </NotesDataProvider>
    );
    const first = render(tree());
    await screen.findByLabelText(enNotes.document.titleLabel);
    const heading = positionOf(editors.last as Editor, "Results");
    expect(editors.last?.state.selection.from).toBe(heading);
    first.unmount();
    render(tree());
    await screen.findByLabelText(enNotes.document.titleLabel);
    expect(editors.last?.state.selection.from).not.toBe(positionOf(editors.last as Editor, "Results"));
  });

  it("ignores an empty snippet", async () => {
    const fake = fakeData();
    const { editor, requestInsert, onStatusChange } = await openNote(fake);
    requestInsert({ snippet: "", id: 2 });
    expect(bodyText(editor)).toBe("The encoder trains with a mask ratio of 0.75.\nMasks are sampled per pixel.");
    expect(onStatusChange).not.toHaveBeenCalled();
  });

  it("shows a copied figure from the note's own files", async () => {
    const fake = fakeData();
    const resolveAsset = vi.fn(async (_noteId: string, path: string) => `blob:${path}`);
    fake.data = { ...fake.data, resolveAsset };
    const { editor, requestInsert } = await openNote(fake);
    requestInsert({ snippet: "![Loss curve](figures/loss.png)", id: 1 });
    await act(async () => {});
    expect(resolveAsset).toHaveBeenCalledWith("note-1", "figures/loss.png");
    const image = editor.view.dom.querySelector<HTMLImageElement>("figure.note-image img");
    expect(image?.getAttribute("src")).toBe("blob:figures/loss.png");
    expect(image?.alt).toBe("Loss curve");
    await flushSave();
    expect(savedText(fake)).toBe(`${TEXT}\n![Loss curve](figures/loss.png)\n`);
  });
});

describe("images", () => {
  const WITH_IMAGE = `${TEXT}\n![Loss curve](./figures/loss%20curve.png)\n`;

  it("asks for each image in the note by its path next to the note", async () => {
    const fake = fakeData({ text: WITH_IMAGE });
    const resolveAsset = vi.fn(async () => "blob:loss");
    fake.data = { ...fake.data, resolveAsset };
    const { editor } = await openNote(fake);
    await act(async () => {});
    expect(resolveAsset).toHaveBeenCalledWith("note-1", "figures/loss curve.png");
    const image = editor.view.dom.querySelector<HTMLImageElement>("figure.note-image img");
    expect(image?.getAttribute("src")).toBe("blob:loss");
    expect(image?.hidden).toBe(false);
  });

  it("asks the newest lookup the app hands over", async () => {
    const fake = fakeData({ text: WITH_IMAGE });
    const first = vi.fn(async () => "blob:first");
    const second = vi.fn(async () => "blob:second");
    fake.data = { ...fake.data, resolveAsset: first };
    const { editor, rerender } = await openNote(fake);
    await act(async () => {});
    rerender(
      <NotesDataProvider value={{ ...fake.data, resolveAsset: second }}>
        <NoteDocument note={NOTE} insertRequest={{ snippet: "![Again](figures/again.png)", id: 1 }} onSendToPaper={vi.fn()} />
      </NotesDataProvider>,
    );
    await act(async () => {});
    expect(first).not.toHaveBeenCalledWith("note-1", "figures/again.png");
    expect(second).toHaveBeenCalledWith("note-1", "figures/again.png");
    const images = editor.view.dom.querySelectorAll<HTMLImageElement>("figure.note-image img");
    expect(images[1]?.getAttribute("src")).toBe("blob:second");
  });

  it("says an image is missing when the app cannot look up files", async () => {
    const { editor } = await openNote(fakeData({ text: WITH_IMAGE }));
    await act(async () => {});
    const missing = editor.view.dom.querySelector<HTMLElement>("figure.note-image .note-drawn-empty");
    expect(missing?.hidden).toBe(false);
    expect(missing?.textContent).toBe(
      enNotes.blocks.imageMissing.replace("{{path}}", "./figures/loss%20curve.png"),
    );
  });
});

describe("find and replace", () => {
  it("opens the find bar with Ctrl+F from the title or the body and replaces in the note", async () => {
    const fake = fakeData({ text: "---\ntitle: Find\n---\nAlpha beta alpha\n" });
    const { editor, title } = await openNote(fake);
    expect(screen.queryByRole("search", { name: enEditor.package.search.panel })).toBeNull();
    fireEvent.keyDown(title, { key: "f", ctrlKey: true });
    const field = screen.getByRole("textbox", { name: enEditor.package.search.find });
    fireEvent.change(field, { target: { value: "alpha" } });
    expect(editor.view.dom.querySelectorAll(".note-find-match")).toHaveLength(2);
    fireEvent.keyDown(field, { key: "Enter" });
    await act(async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });
    expect(editor.view.dom.querySelectorAll(".note-find-match-active")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: enNotes.document.askAgent })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: enEditor.package.search.toggleReplace }));
    fireEvent.change(screen.getByRole("textbox", { name: enEditor.package.search.replace }), { target: { value: "gamma" } });
    fireEvent.click(screen.getByRole("button", { name: enEditor.package.search.replaceAllAction }));
    expect(bodyText(editor)).toContain("gamma beta gamma");
    fireEvent.keyDown(field, { key: "Escape" });
    expect(screen.queryByRole("search", { name: enEditor.package.search.panel })).toBeNull();
    fireEvent.keyDown(editor.view.dom, { key: "f", ctrlKey: true });
    expect(screen.getByRole("search", { name: enEditor.package.search.panel })).toBeInTheDocument();
  });
});
