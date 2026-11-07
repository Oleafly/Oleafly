// @vitest-environment jsdom
import type { Editor } from "@tiptap/core";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode, RefObject } from "react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { loadNamespace } from "@/i18n";
import enEditor from "@/i18n/locales/en/editor.json" with { type: "json" };
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import type { ModelSelectorGroup } from "@/components/ai/ModelSelector";
import type { PromptRequest } from "./AgentPrompt";
import { NoteDocument, type SaveStatus } from "./NoteDocument";
import { NOTE_WIDTH_KEY, saveNoteWidth } from "./note-prefs";
import type { NoteEdit } from "./note-edits";
import { type NotesData, NotesDataProvider } from "./notes-data";
import {
  type EditRequest,
  type NoteAgentChoice,
  NoteConflictError,
  type NoteItem,
  type NoteSource,
  type ResearchActionId,
} from "./types";

const editors = vi.hoisted(() => ({ last: null as Editor | null }));
const prompts = vi.hoisted(() => ({ scope: null as { current: HTMLElement | null } | null }));
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
    shortcutScope?: RefObject<HTMLElement | null>;
    hiddenActions: ReadonlySet<ResearchActionId>;
    choice: NoteAgentChoice;
    onChoice: (choice: NoteAgentChoice) => void;
    working: boolean;
    quote: string | null;
    message: string | null;
    onClearQuote: () => void;
    onSend: (request: PromptRequest) => void;
    onStop: () => void;
  }) => {
    props.composerRef.current = { focus: composerFocus };
    prompts.scope = props.shortcutScope ?? null;
    return (
      <section
        data-testid="agent-prompt"
        data-working={String(props.working)}
        data-agent={props.choice.label}
        data-hidden={[...props.hiddenActions].sort().join(",")}
      >
        {props.message && <p>{props.message}</p>}
        {props.quote && <blockquote>{props.quote}</blockquote>}
        <button
          type="button"
          data-testid="send-request"
          onClick={() => props.onSend({ actionId: null, prompt: "Tighten it" })}
        />
        <button
          type="button"
          data-testid="send-latest-run"
          onClick={() => props.onSend({ actionId: "latestRun", prompt: "" })}
        />
        <button
          type="button"
          data-testid="send-proofread"
          onClick={() => props.onSend({ actionId: "proofread", prompt: "" })}
        />
        <button
          type="button"
          data-testid="pick-agent"
          onClick={() => props.onChoice({ providerId: "openai", modelId: "gpt", label: "GPT" })}
        />
        <button type="button" data-testid="stop-request" onClick={props.onStop} />
        <button type="button" data-testid="clear-quote" onClick={props.onClearQuote} />
      </section>
    );
  },
}));

vi.mock("./IconPicker", () => ({
  IconPicker: (props: {
    trigger: ReactNode;
    value?: string;
    hasIcon: boolean;
    onChange: (icon: string | undefined) => void;
  }) => (
    <div>
      <span data-testid="icon-trigger" data-value={props.value ?? "none"}>
        {props.trigger}
      </span>
      <button type="button" data-testid="pick-icon" onClick={() => props.onChange("🧪")} />
      {props.hasIcon && <button type="button" data-testid="remove-icon" onClick={() => props.onChange(undefined)} />}
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

const CLAUDE: ModelSelectorGroup = { id: "acp:claude", name: "Claude", models: [{ id: "default", name: "Default" }] };
const OPENAI: ModelSelectorGroup = { id: "openai", name: "OpenAI", models: [{ id: "gpt", name: "GPT" }] };
const CLAUDE_CHOICE = { providerId: "acp:claude", modelId: "default", label: "Claude" };

interface FakeOptions {
  text?: string;
  agents?: ModelSelectorGroup[];
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
    agents: options.agents ?? [CLAUDE],
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
  insertRequest?: { snippet: string; id: number } | null;
}

async function openNote(fake: Fake, options: OpenOptions = {}) {
  const onStatusChange = vi.fn<(status: SaveStatus) => void>();
  const onSendToPaper = vi.fn<(text: string) => void>();
  const note = options.note ?? NOTE;
  const tree = (insertRequest: OpenOptions["insertRequest"], shown: NoteItem = note) => (
    <NotesDataProvider value={fake.data}>
      <NoteDocument
        note={shown}
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

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  editors.last = null;
  composerFocus.mockClear();
  scrollIntoView.mockClear();
  Reflect.deleteProperty(document, "visibilityState");
  localStorage.removeItem("oleafly.notes.agent");
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
      `---\r\ntitle: Mask ratios\r\nkind: note\r\nid: ${NEW_ID}\r\n---\n\n${BODY.replace("trains", "really trains")}`,
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
    expect(onStatusChange).toHaveBeenLastCalledWith("saving");
    await act(() => vi.advanceTimersByTimeAsync(800));
    expect(fake.saveNote).toHaveBeenCalledTimes(2);
    expect(fake.saveNote.mock.calls[1][2]).toBe("v7");
    expect(savedText(fake)).toBe(TEXT.replace("trains", "really trains"));
    expect(onStatusChange).toHaveBeenLastCalledWith("saved");
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
    expect(trigger.querySelector(".lucide-notebook-pen")).not.toBeNull();
    expect(screen.queryByTestId("remove-icon")).toBeNull();
    fireEvent.click(screen.getByTestId("pick-icon"));
    expect(screen.getByTestId("icon-trigger")).toHaveTextContent("🧪");
    expect(screen.getByTestId("icon-trigger")).toHaveAttribute("data-value", "🧪");
    await flushSave();
    expect(savedText(fake)).toBe(`---\nicon: 🧪\nkind: note\nid: ${NEW_ID}\n---\n\n${BODY}`);
  });

  it("removes the icon from the front matter", async () => {
    const fake = fakeData({ text: TEXT.replace("title: Mask ratios\n", "title: Mask ratios\nicon: 🧪\n") });
    await openNote(fake);
    expect(screen.getByTestId("icon-trigger")).toHaveTextContent("🧪");
    fireEvent.click(screen.getByTestId("remove-icon"));
    expect(screen.getByTestId("icon-trigger").querySelector(".lucide-notebook-pen")).not.toBeNull();
    await flushSave();
    expect(savedText(fake)).toBe(TEXT);
  });
});

describe("the note's look", () => {
  it("shows the icon in a large chip tinted with the colour the note's id gives it", async () => {
    await openNote(fakeData({ text: TEXT.replace("title: Mask ratios\n", "title: Mask ratios\nicon: lucide:atom\n") }));
    const chip = screen.getByTestId("icon-trigger").querySelector("[data-note-color]") as HTMLElement;
    expect(chip).toHaveAttribute("data-note-color", "sky");
    expect(chip).toHaveClass("size-14", "bg-sky-500/10");
    expect(chip.querySelector("svg")).toHaveClass("lucide-atom", "text-sky-600");
  });

  it("uses the colour the front matter names", async () => {
    await openNote(fakeData({ text: TEXT.replace("title: Mask ratios\n", "title: Mask ratios\ncolor: rose\n") }));
    expect(screen.getByTestId("icon-trigger").querySelector("[data-note-color]")).toHaveAttribute("data-note-color", "rose");
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

describe("agent edits", () => {
  function prompt() {
    return screen.getByTestId("agent-prompt");
  }

  function sendRequest() {
    act(() => {
      fireEvent.click(screen.getByTestId("send-request"));
    });
  }

  it("sends a note without front matter as its body before any save", async () => {
    const fake = fakeData({ text: BODY });
    await openNote(fake);
    sendRequest();
    expect(fake.proposeEdits.mock.calls[0][0].source).toBe(BODY);
    await act(async () => {});
    expect(fake.saveNote).not.toHaveBeenCalled();
  });

  it("hides the agent prompt when no agent is available", async () => {
    await openNote(fakeData({ agents: [] }));
    expect(screen.queryByTestId("agent-prompt")).toBeNull();
    expect(screen.queryByText(enNotes.prompt.noAgents)).toBeNull();
  });

  it("points to the AI settings when no agent is available and settings can open", async () => {
    const fake = fakeData({ agents: [] });
    const openAgentSettings = vi.fn();
    fake.data = { ...fake.data, openAgentSettings };
    await openNote(fake);
    expect(screen.getByText(enNotes.prompt.noAgents)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: enNotes.prompt.setUp }));
    expect(openAgentSettings).toHaveBeenCalledTimes(1);
  });

  it("starts with the app's own model when nothing was picked before", async () => {
    const fake = fakeData({ agents: [CLAUDE, OPENAI] });
    fake.data = { ...fake.data, preferredAgent: { providerId: "openai", modelId: "gpt" } };
    await openNote(fake);
    expect(prompt()).toHaveAttribute("data-agent", "GPT");
  });

  it("remembers the agent the person picks and sends to it", async () => {
    const fake = fakeData({ agents: [CLAUDE, OPENAI] });
    await openNote(fake);
    expect(prompt()).toHaveAttribute("data-agent", "Claude");
    fireEvent.click(screen.getByTestId("pick-agent"));
    expect(prompt()).toHaveAttribute("data-agent", "GPT");
    expect(JSON.parse(localStorage.getItem("oleafly.notes.agent") ?? "null")).toEqual({ providerId: "openai", modelId: "gpt" });
    sendRequest();
    expect(fake.proposeEdits.mock.calls[0][0].agent).toEqual({ providerId: "openai", modelId: "gpt", label: "GPT" });
    await act(async () => {});
    expect(screen.getByText(enNotes.document.noChanges.replace("{{agent}}", "GPT"))).toBeInTheDocument();
  });

  it("keeps the picked agent while it is still offered and falls back once it is gone", async () => {
    const fake = fakeData({ agents: [CLAUDE, OPENAI] });
    const { rerender } = await openNote(fake);
    fireEvent.click(screen.getByTestId("pick-agent"));
    const offer = (agents: ModelSelectorGroup[]) =>
      rerender(
        <NotesDataProvider value={{ ...fake.data, agents }}>
          <NoteDocument note={NOTE} insertRequest={null} onSendToPaper={vi.fn()} />
        </NotesDataProvider>,
      );
    offer([OPENAI, CLAUDE]);
    expect(prompt()).toHaveAttribute("data-agent", "GPT");
    offer([CLAUDE]);
    expect(prompt()).toHaveAttribute("data-agent", "Claude");
  });

  it("goes back to the saved agent when the note opens again", async () => {
    localStorage.setItem("oleafly.notes.agent", JSON.stringify({ providerId: "openai", modelId: "gpt" }));
    await openNote(fakeData({ agents: [CLAUDE, OPENAI] }));
    expect(prompt()).toHaveAttribute("data-agent", "GPT");
  });

  it("sends the note to the agent and shows its edits for review", async () => {
    const fake = fakeData();
    fake.proposeEdits.mockResolvedValueOnce([{ find: "0.75", replace: "0.60" }]);
    const { editor } = await openNote(fake);
    sendRequest();
    expect(prompt()).toHaveAttribute("data-working", "true");
    expect(fake.proposeEdits).toHaveBeenCalledWith(
      { noteId: "note-1", agent: CLAUDE_CHOICE, actionId: null, prompt: "Tighten it", quote: null, source: TEXT },
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

describe("the latest research task", () => {
  const RUN = "Task: Sweep mask ratios\nSummary:\nBest ratio 0.6";

  function prompt() {
    return screen.getByTestId("agent-prompt");
  }

  function withRun(fake: Fake, latestRun: (noteId: string) => string | null) {
    const spy = vi.fn(latestRun);
    fake.data = { ...fake.data, latestRun: spy };
    return spy;
  }

  it("keeps the latest run action out of the menu when the app has no runs", async () => {
    await openNote(fakeData());
    expect(prompt()).toHaveAttribute("data-hidden", "claims,latestRun");
  });

  it("keeps the latest run action out of the menu while the note's project has no run", async () => {
    const fake = fakeData();
    const latestRun = withRun(fake, () => null);
    await openNote(fake);
    expect(latestRun).toHaveBeenCalledWith("note-1");
    expect(prompt()).toHaveAttribute("data-hidden", "claims,latestRun");
  });

  it("offers the latest run action once the note's project has a run", async () => {
    const fake = fakeData();
    withRun(fake, () => RUN);
    await openNote(fake);
    expect(prompt()).toHaveAttribute("data-hidden", "claims");
  });

  it("hands the latest run to the agent with the latest run action", async () => {
    const fake = fakeData();
    const latestRun = withRun(fake, () => RUN);
    await openNote(fake);
    latestRun.mockClear();
    act(() => {
      fireEvent.click(screen.getByTestId("send-latest-run"));
    });
    expect(latestRun).toHaveBeenCalledWith("note-1");
    expect(fake.proposeEdits.mock.calls[0][0]).toMatchObject({ actionId: "latestRun", prompt: "", latestRun: RUN });
    await act(async () => {});
  });

  it("keeps the run out of other requests", async () => {
    const fake = fakeData();
    withRun(fake, () => RUN);
    await openNote(fake);
    act(() => {
      fireEvent.click(screen.getByTestId("send-proofread"));
    });
    act(() => {
      fireEvent.click(screen.getByTestId("send-request"));
    });
    expect(fake.proposeEdits.mock.calls[0][0].actionId).toBe("proofread");
    expect(fake.proposeEdits.mock.calls[0][0].latestRun).toBeUndefined();
    expect(fake.proposeEdits.mock.calls[1][0].latestRun).toBeUndefined();
    await act(async () => {});
  });

  it("sends the latest run action without a run when there is none to read", async () => {
    const withoutReader = fakeData();
    await openNote(withoutReader);
    act(() => {
      fireEvent.click(screen.getByTestId("send-latest-run"));
    });
    expect(withoutReader.proposeEdits.mock.calls[0][0]).toMatchObject({ actionId: "latestRun" });
    expect(withoutReader.proposeEdits.mock.calls[0][0].latestRun).toBeUndefined();
    await act(async () => {});
  });

  it("sends the latest run action without a run once the run is gone", async () => {
    const fake = fakeData();
    withRun(fake, () => null);
    await openNote(fake);
    act(() => {
      fireEvent.click(screen.getByTestId("send-latest-run"));
    });
    expect(fake.proposeEdits.mock.calls[0][0].latestRun).toBeUndefined();
    await act(async () => {});
  });
});
