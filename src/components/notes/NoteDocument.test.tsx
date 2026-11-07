// @vitest-environment jsdom
import type { Editor } from "@tiptap/core";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode, RefObject } from "react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { loadNamespace } from "@/i18n";
import enEditor from "@/i18n/locales/en/editor.json" with { type: "json" };
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import type { PromptRequest } from "./AgentPrompt";
import { NoteDocument, type SaveStatus } from "./NoteDocument";
import type { NoteEdit } from "./note-edits";
import { type NotesData, NotesDataProvider } from "./notes-data";
import { type ArtifactItem, type EditRequest, NoteConflictError, type NoteItem, type NoteSource } from "./types";

const editors = vi.hoisted(() => ({ last: null as Editor | null }));
const composerFocus = vi.hoisted(() => vi.fn());

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

vi.mock("./AgentPrompt", () => ({
  AgentPrompt: (props: {
    composerRef: RefObject<{ focus: () => void } | null>;
    working: boolean;
    quote: string | null;
    message: string | null;
    onClearQuote: () => void;
    onSend: (request: PromptRequest) => void;
    onStop: () => void;
  }) => {
    props.composerRef.current = { focus: composerFocus };
    return (
      <section data-testid="agent-prompt" data-working={String(props.working)}>
        {props.message && <p>{props.message}</p>}
        {props.quote && <blockquote>{props.quote}</blockquote>}
        <button
          type="button"
          data-testid="send-request"
          onClick={() => props.onSend({ agent: "Claude", actionId: null, prompt: "Tighten it" })}
        />
        <button type="button" data-testid="stop-request" onClick={props.onStop} />
        <button type="button" data-testid="clear-quote" onClick={props.onClearQuote} />
      </section>
    );
  },
}));

vi.mock("./IconPicker", () => ({
  IconPicker: (props: { trigger: ReactNode; hasIcon: boolean; onChange: (icon: string | undefined) => void }) => (
    <div>
      <span data-testid="icon-trigger">{props.trigger}</span>
      <button type="button" data-testid="pick-icon" onClick={() => props.onChange("🧪")} />
      {props.hasIcon && <button type="button" data-testid="remove-icon" onClick={() => props.onChange(undefined)} />}
    </div>
  ),
}));

const NOTE: NoteItem = {
  id: "note-1",
  title: "Masking notes",
  project: "Encoder study",
  updatedAt: Date.now() - 5 * 60_000,
  author: "you",
  summary: "",
};
const BODY = "The encoder trains with a mask ratio of 0.75.\n\nMasks are sampled per pixel.\n";
const TEXT = `---\ntitle: Mask ratios\n---\n\n${BODY}`;
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
  agents?: string[];
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
  const proposeEdits = vi.fn(
    async (_request: EditRequest, _signal: AbortSignal): Promise<readonly NoteEdit[]> => [],
  );
  const stopWatching = vi.fn();
  const watchNote = vi.fn((_id: string, onChange: () => void) => {
    onDisk = onChange;
    return stopWatching;
  });
  const data: NotesData = {
    notes: [NOTE],
    artifacts: [],
    experiments: [],
    agents: options.agents ?? ["Claude"],
    citations: [],
    papers: [],
    loadNote,
    saveNote,
    proposeEdits,
    ...(options.withOptional === false ? {} : { renameNote, watchNote }),
  };
  const diskChanged = async () => {
    await act(async () => {
      onDisk?.();
    });
  };
  return { data, loadNote, saveNote, renameNote, proposeEdits, watchNote, stopWatching, diskChanged };
}

type Fake = ReturnType<typeof fakeData>;

interface OpenOptions {
  note?: NoteItem;
  insertRequest?: { artifact: ArtifactItem; id: number } | null;
}

async function openNote(fake: Fake, options: OpenOptions = {}) {
  const onStatusChange = vi.fn<(status: SaveStatus) => void>();
  const onSendToPaper = vi.fn<(text: string) => void>();
  const note = options.note ?? NOTE;
  const tree = (insertRequest: OpenOptions["insertRequest"]) => (
    <NotesDataProvider value={fake.data}>
      <NoteDocument
        note={note}
        insertRequest={insertRequest ?? null}
        onSendToPaper={onSendToPaper}
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

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  editors.last = null;
  composerFocus.mockClear();
  scrollIntoView.mockClear();
  Reflect.deleteProperty(document, "visibilityState");
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

  it("credits you when an agent note does not name its agent", async () => {
    await openNote(fakeData(), { note: { ...NOTE, author: "agent" } });
    expect(screen.getByText(new RegExp(`^${enNotes.document.writtenByYou} · `))).toBeInTheDocument();
  });
});

describe("saving", () => {
  it("saves the note 800 ms after the last edit", async () => {
    const fake = fakeData();
    const { editor, onStatusChange } = await openNote(fake);
    vi.useFakeTimers();
    typeBefore(editor, "trains", "really ");
    expect(onStatusChange).toHaveBeenLastCalledWith("saving");
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
    expect(onStatusChange).toHaveBeenLastCalledWith("saved");
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

  it("saves a note without front matter as plain Markdown", async () => {
    const fake = fakeData({ text: BODY });
    const { editor } = await openNote(fake);
    typeBefore(editor, "trains", "really ");
    await flushSave();
    expect(savedText(fake)).toBe(BODY.replace("trains", "really trains"));
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
    expect(onStatusChange).toHaveBeenLastCalledWith("saved");
  });

  it("reports a save that fails", async () => {
    const fake = fakeData();
    fake.saveNote.mockRejectedValueOnce(new Error("disk full"));
    const { editor, onStatusChange } = await openNote(fake);
    typeBefore(editor, "trains", "really ");
    await flushSave();
    expect(onStatusChange).toHaveBeenLastCalledWith("failed");
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
    expect(onStatusChange).toHaveBeenLastCalledWith("saved");
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
    expect(onStatusChange).toHaveBeenLastCalledWith("saving");
    expect(bodyText(editor)).toContain("per pixel");
    await act(() => vi.advanceTimersByTimeAsync(800));
    expect(fake.saveNote.mock.calls.at(-1)?.[2]).toBe("v9");
    expect(savedText(fake)).toBe(DISK.replace("trains", "really trains"));
    expect(onStatusChange).toHaveBeenLastCalledWith("saved");
  });
});

describe("changes on disk", () => {
  it("offers a changed file as suggestions to accept", async () => {
    const fake = fakeData();
    const { editor, title } = await openNote(fake);
    fake.loadNote.mockResolvedValueOnce({ text: DISK, version: "v4" });
    await fake.diskChanged();
    expect(fake.loadNote).toHaveBeenLastCalledWith("note-1");
    expect(title.value).toBe("Mask ratio study");
    expect(screen.queryByTestId("agent-prompt")).toBeNull();
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "center" });
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: ACCEPT }));
    });
    expect(bodyText(editor)).toContain("per patch");
    expect(screen.queryByRole("button", { name: ACCEPT })).toBeNull();
    expect(screen.getByTestId("agent-prompt")).toBeInTheDocument();
  });

  it("drops a disk suggestion that is rejected", async () => {
    const fake = fakeData();
    const { editor } = await openNote(fake);
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

  it("offers disk changes to text that was already saved", async () => {
    const fake = fakeData();
    const { editor } = await openNote(fake);
    typeBefore(editor, "trains", "really ");
    await flushSave();
    fake.loadNote.mockResolvedValueOnce({ text: DISK, version: "v4" });
    await fake.diskChanged();
    expect(screen.getByRole("button", { name: enNotes.review.acceptAll })).toBeInTheDocument();
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

describe("title and icon", () => {
  it("renames the note and writes the title into the front matter", async () => {
    const fake = fakeData();
    const { title } = await openNote(fake);
    fireEvent.change(title, { target: { value: "  Mask ratio study  " } });
    fireEvent.blur(title);
    expect(fake.renameNote).toHaveBeenCalledWith("note-1", "Mask ratio study");
    await flushSave();
    expect(savedText(fake)).toBe(TEXT.replace("title: Mask ratios", "title: Mask ratio study"));
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
    const { title } = await openNote(fake);
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
    const fake = fakeData({ text: BODY, withOptional: false });
    const { title } = await openNote(fake);
    fireEvent.change(title, { target: { value: "Fresh title" } });
    fireEvent.blur(title);
    await flushSave();
    expect(fake.renameNote).not.toHaveBeenCalled();
    expect(savedText(fake)).toBe(`---\ntitle: Fresh title\n---\n\n${BODY}`);
  });

  it("adds an icon to the front matter", async () => {
    const fake = fakeData({ text: BODY });
    await openNote(fake);
    expect(screen.getByTestId("icon-trigger")).toHaveTextContent(enNotes.document.addIcon);
    expect(screen.queryByTestId("remove-icon")).toBeNull();
    fireEvent.click(screen.getByTestId("pick-icon"));
    expect(screen.getByTestId("icon-trigger")).toHaveTextContent("🧪");
    await flushSave();
    expect(savedText(fake)).toBe(`---\nicon: 🧪\n---\n\n${BODY}`);
  });

  it("removes the icon from the front matter", async () => {
    const fake = fakeData({ text: `---\ntitle: Mask ratios\nicon: 🧪\n---\n\n${BODY}` });
    await openNote(fake);
    expect(screen.getByTestId("icon-trigger")).toHaveTextContent("🧪");
    fireEvent.click(screen.getByTestId("remove-icon"));
    expect(screen.getByTestId("icon-trigger")).toHaveTextContent(enNotes.document.addIcon);
    await flushSave();
    expect(savedText(fake)).toBe(TEXT);
  });
});

describe("agent edits", () => {
  function prompt() {
    return screen.getByTestId("agent-prompt");
  }

  function sendRequest() {
    act(() => {
      fireEvent.click(screen.getByTestId("send-request"));
    });
  }

  it("hides the agent prompt when no agent is available", async () => {
    await openNote(fakeData({ agents: [] }));
    expect(screen.queryByTestId("agent-prompt")).toBeNull();
  });

  it("sends the note to the agent and shows its edits for review", async () => {
    const fake = fakeData();
    fake.proposeEdits.mockResolvedValueOnce([{ find: "0.75", replace: "0.60" }]);
    const { editor } = await openNote(fake);
    sendRequest();
    expect(prompt()).toHaveAttribute("data-working", "true");
    expect(fake.proposeEdits).toHaveBeenCalledWith(
      { noteId: "note-1", agent: "Claude", actionId: null, prompt: "Tighten it", quote: null, source: TEXT },
      expect.any(AbortSignal),
    );
    await act(async () => {});
    expect(bodyText(editor)).toContain("0.75");
    fireEvent.click(screen.getByRole("button", { name: ACCEPT }));
    expect(bodyText(editor)).toContain("ratio of 0.60.");
    expect(prompt()).toHaveAttribute("data-working", "false");
  });

  it("steps through several agent edits and settles them", async () => {
    const fake = fakeData();
    fake.proposeEdits.mockResolvedValue([
      { find: "0.75", replace: "0.60" },
      { find: "per pixel", replace: "per patch" },
    ]);
    const { editor } = await openNote(fake);
    sendRequest();
    await act(async () => {});
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
    sendRequest();
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: enNotes.review.acceptAll }));
    expect(bodyText(editor)).toContain("0.60");
    expect(bodyText(editor)).toContain("per patch");
  });

  it("places agent edits on the note as shown when its Markdown reads back differently", async () => {
    const fake = fakeData();
    fake.proposeEdits.mockResolvedValueOnce([{ find: "0.75", replace: "0.60" }]);
    const { editor } = await openNote(fake);
    act(() => {
      editor.view.dispatch(editor.state.tr.insert(editor.state.doc.content.size, editor.schema.nodes.paragraph.create()));
    });
    sendRequest();
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: ACCEPT }));
    expect(bodyText(editor)).toContain("ratio of 0.60.");
    expect(bodyText(editor)).toContain("per pixel.");
  });

  it("tells you when the agent has no changes", async () => {
    const fake = fakeData();
    const { editor } = await openNote(fake);
    sendRequest();
    await act(async () => {});
    expect(screen.getByText(enNotes.document.noChanges.replace("{{agent}}", "Claude"))).toBeInTheDocument();
    expect(bodyText(editor)).toContain("0.75");
  });

  it("says how many edits did not match the note", async () => {
    const fake = fakeData();
    fake.proposeEdits.mockResolvedValueOnce([
      { find: "0.75", replace: "0.60" },
      { find: "missing", replace: "x" },
      { find: "also missing", replace: "y" },
    ]);
    await openNote(fake);
    sendRequest();
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: REJECT }));
    expect(screen.getByText(enNotes.document.skipped_other.replace("{{count}}", "2"))).toBeInTheDocument();
  });

  it("shows the agent's error", async () => {
    const fake = fakeData();
    fake.proposeEdits.mockRejectedValueOnce(new Error("Agent offline"));
    await openNote(fake);
    sendRequest();
    await act(async () => {});
    expect(screen.getByText("Agent offline")).toBeInTheDocument();
    expect(prompt()).toHaveAttribute("data-working", "false");
  });

  it("shows a failure that is not an error as text", async () => {
    const fake = fakeData();
    fake.proposeEdits.mockRejectedValueOnce("quota exhausted");
    await openNote(fake);
    sendRequest();
    await act(async () => {});
    expect(screen.getByText("quota exhausted")).toBeInTheDocument();
  });

  it("stops a running request and ignores its late answer", async () => {
    const fake = fakeData();
    const run = deferred<readonly NoteEdit[]>();
    fake.proposeEdits.mockReturnValueOnce(run.promise);
    const { editor } = await openNote(fake);
    sendRequest();
    fireEvent.click(screen.getByTestId("stop-request"));
    expect(prompt()).toHaveAttribute("data-working", "false");
    expect(fake.proposeEdits.mock.calls[0][1].aborted).toBe(true);
    await act(async () => {
      run.resolve([{ find: "0.75", replace: "0.60" }]);
    });
    expect(screen.queryByRole("button", { name: ACCEPT })).toBeNull();
    expect(bodyText(editor)).toContain("0.75");
  });

  it("ignores a failure that arrives after the request was stopped", async () => {
    const fake = fakeData();
    const run = deferred<readonly NoteEdit[]>();
    fake.proposeEdits.mockReturnValueOnce(run.promise);
    await openNote(fake);
    sendRequest();
    fireEvent.click(screen.getByTestId("stop-request"));
    await act(async () => {
      run.reject(new Error("aborted"));
    });
    expect(screen.queryByText("aborted")).toBeNull();
  });

  it("replaces a running request with a new one", async () => {
    const fake = fakeData();
    const first = deferred<readonly NoteEdit[]>();
    const second = deferred<readonly NoteEdit[]>();
    fake.proposeEdits.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    await openNote(fake);
    sendRequest();
    sendRequest();
    expect(fake.proposeEdits.mock.calls[0][1].aborted).toBe(true);
    expect(fake.proposeEdits.mock.calls[1][1].aborted).toBe(false);
    await act(async () => {
      first.resolve([{ find: "0.75", replace: "0.60" }]);
    });
    expect(prompt()).toHaveAttribute("data-working", "true");
    expect(screen.queryByRole("button", { name: ACCEPT })).toBeNull();
    await act(async () => {
      second.resolve([{ find: "per pixel", replace: "per patch" }]);
    });
    expect(screen.getByRole("button", { name: ACCEPT })).toBeInTheDocument();
  });

  it("cancels a running request when the note closes", async () => {
    const fake = fakeData();
    fake.proposeEdits.mockReturnValueOnce(deferred<readonly NoteEdit[]>().promise);
    const { unmount } = await openNote(fake);
    sendRequest();
    unmount();
    expect(fake.proposeEdits.mock.calls[0][1].aborted).toBe(true);
  });
});

describe("selection bubble", () => {
  function bubbleButton(name: string) {
    return screen.queryByRole("button", { name });
  }

  async function openWithSelection(fake: Fake) {
    const opened = await openNote(fake);
    vi.spyOn(opened.editor.view, "coordsAtPos").mockReturnValue({ top: 200, bottom: 216, left: 48, right: 90 });
    select(opened.editor, "mask ratio");
    return opened;
  }

  it("appears above a selection and sends it to the paper", async () => {
    const { onSendToPaper } = await openWithSelection(fakeData());
    const send = bubbleButton(enNotes.document.sendToPaper);
    expect(send).not.toBeNull();
    expect(send?.parentElement).toHaveStyle({ top: "160px", left: "48px" });
    expect(fireEvent.mouseDown(send as HTMLElement)).toBe(false);
    fireEvent.click(send as HTMLElement);
    expect(onSendToPaper).toHaveBeenCalledWith("mask ratio");
  });

  it("quotes the selection in the next agent request", async () => {
    const fake = fakeData();
    await openWithSelection(fake);
    const ask = bubbleButton(enNotes.document.askAgent) as HTMLElement;
    expect(fireEvent.mouseDown(ask)).toBe(false);
    fireEvent.click(ask);
    expect(composerFocus).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("blockquote")).toHaveTextContent("mask ratio");
    act(() => {
      fireEvent.click(screen.getByTestId("send-request"));
    });
    expect(fake.proposeEdits.mock.calls[0][0].quote).toBe("mask ratio");
    expect(screen.queryByRole("blockquote")).toBeNull();
  });

  it("drops a quote that is cleared", async () => {
    await openWithSelection(fakeData());
    fireEvent.click(bubbleButton(enNotes.document.askAgent) as HTMLElement);
    fireEvent.click(screen.getByTestId("clear-quote"));
    expect(screen.queryByRole("blockquote")).toBeNull();
  });

  it("quotes a selection even without an agent prompt on screen", async () => {
    await openWithSelection(fakeData({ agents: [] }));
    fireEvent.click(bubbleButton(enNotes.document.askAgent) as HTMLElement);
    expect(composerFocus).not.toHaveBeenCalled();
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
  const ARTIFACT: ArtifactItem = {
    id: "artifact-1",
    title: "Loss curve",
    kind: "figure",
    project: "Encoder study",
    noteIds: ["note-1"],
    updatedAt: NOTE.updatedAt,
    author: "agent",
    agent: "Claude",
    chat: "Plot the loss",
    summary: "Training loss",
    snippet: "**Figure 2** shows the loss.",
  };

  it("adds an artifact's snippet at the end of the note", async () => {
    const fake = fakeData();
    const { editor, requestInsert } = await openNote(fake);
    requestInsert({ artifact: ARTIFACT, id: 1 });
    expect(bodyText(editor).endsWith("Figure 2 shows the loss.")).toBe(true);
    await flushSave();
    expect(savedText(fake)).toBe(`${TEXT}\n**Figure 2** shows the loss.\n`);
  });

  it("ignores an artifact without a snippet", async () => {
    const fake = fakeData();
    const { editor, requestInsert, onStatusChange } = await openNote(fake);
    requestInsert({ artifact: { ...ARTIFACT, snippet: undefined }, id: 2 });
    expect(bodyText(editor)).toBe("The encoder trains with a mask ratio of 0.75.\nMasks are sampled per pixel.");
    expect(onStatusChange).not.toHaveBeenCalled();
  });
});
