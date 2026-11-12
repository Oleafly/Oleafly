// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import type { NoteLinkRecord } from "@/lib/tauri";
import { isMac } from "@/lib/utils";

const mocks = vi.hoisted(() => ({
  writeClipboardText: vi.fn(async (_text: string) => undefined),
  success: vi.fn(),
  error: vi.fn(),
  notifyError: vi.fn(),
}));

vi.mock("@/lib/clipboard", () => ({ writeClipboardText: mocks.writeClipboardText }));
vi.mock("@/lib/toast", () => ({
  toast: { success: mocks.success, error: mocks.error },
  notifyError: mocks.notifyError,
}));

import { NoteBlockHandle } from "./NoteBlockHandle";
import { findDocBlock } from "./note-block-links";
import { createBlockRefs } from "./note-block-refs";
import { NotesDataProvider } from "./notes-data";
import { fakeNotesData } from "./tests/notes-data-fixture";
import { destroyKbEditors, kbEditor, kbMarkdown, placeCursor, positionOf } from "./tests/kb-editor-fixtures";
import type { NoteItem } from "./types";
import { NoteLinkIndexProvider } from "./use-note-links";
import "./tests/setup";

const copy = enNotes.linksSearch.blocks;

const NOTES: NoteItem[] = [
  { id: "lib-1", noteId: "n-1", title: "Masking report", project: "SSL", updatedAt: 0, author: "you", summary: "" },
  { id: "lib-2", noteId: "n-2", title: "Reading notes", project: "SSL", updatedAt: 0, author: "you", summary: "" },
];

const RECORDS: NoteLinkRecord[] = [
  { projectId: "lib-1", noteId: "n-1", title: "Masking report", links: [], blocks: ["acc"] },
  {
    projectId: "lib-2",
    noteId: "n-2",
    title: "Reading notes",
    links: [
      { kind: "note", id: "n-1", snippet: "See the accuracy claim", block: "acc", line: 4 },
      { kind: "note", id: "n-1", snippet: "Whole note", line: 5 },
    ],
    blocks: [],
  },
];

beforeEach(() => {
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    callback(0);
    return 0;
  });
});

afterEach(() => {
  destroyKbEditors();
  vi.restoreAllMocks();
  for (const mock of Object.values(mocks)) mock.mockClear();
});

function setup(markdown = "Accuracy rose ^acc\n\nNo id here\n") {
  const refs = createBlockRefs();
  const editor = kbEditor(markdown, { callout: null }, [refs.extension]);
  const scrollRef = createRef<HTMLDivElement>();
  const onOpenNote = vi.fn();
  vi.spyOn(editor.view.dom, "getBoundingClientRect").mockReturnValue({ top: 0, bottom: 400, left: 100, right: 600, width: 500, height: 400, x: 100, y: 0, toJSON: () => ({}) });
  const view = render(
    <NotesDataProvider value={fakeNotesData({ notes: NOTES, noteLinks: () => Promise.resolve(RECORDS) })}>
      <NoteLinkIndexProvider>
        <div ref={scrollRef} data-testid="scroller" />
        <NoteBlockHandle editor={editor} noteId="n-1" refs={refs} scrollRef={scrollRef} onOpenNote={onOpenNote} />
      </NoteLinkIndexProvider>
    </NotesDataProvider>,
  );
  scrollRef.current?.append(editor.view.dom.parentElement as HTMLElement);
  return { editor, refs, onOpenNote, view };
}

function hover(editor: ReturnType<typeof setup>["editor"], text: string) {
  vi.spyOn(editor.view, "posAtCoords").mockReturnValue({ pos: positionOf(editor, text) + 1, inside: -1 });
  fireEvent.mouseMove(screen.getByTestId("scroller"), { clientX: 120, clientY: 20 });
}

describe("NoteBlockHandle", () => {
  it("shows a handle next to the hovered block and copies a link that gives the block an ID", async () => {
    const user = userEvent.setup();
    const { editor } = setup();
    hover(editor, "No id here");
    await user.click(await screen.findByRole("button", { name: copy.handle }));
    await user.click(await screen.findByRole("menuitem", { name: new RegExp(copy.copyLink) }));
    const id = /No id here \^([a-z0-9]{6})/u.exec(kbMarkdown(editor))?.[1];
    expect(id).toBeDefined();
    await waitFor(() => expect(mocks.writeClipboardText).toHaveBeenCalledWith(`oleafly://note/n-1#^${id}`));
    expect(mocks.success).toHaveBeenCalledWith(copy.linkCopied);
  });

  it("copies the block under the cursor with the shortcut and says when a block can't get an ID", async () => {
    const { editor } = setup();
    vi.spyOn(editor.view, "hasFocus").mockReturnValue(true);
    placeCursor(editor, "Accuracy", 2);
    fireEvent.keyDown(editor.view.dom, { key: "L", shiftKey: true, ...(isMac ? { metaKey: true } : { ctrlKey: true }) });
    await waitFor(() => expect(mocks.writeClipboardText).toHaveBeenCalledWith("oleafly://note/n-1#^acc"));
    editor.setEditable(false);
    placeCursor(editor, "No id", 1);
    fireEvent.keyDown(editor.view.dom, { key: "L", shiftKey: true, ...(isMac ? { metaKey: true } : { ctrlKey: true }) });
    expect(mocks.error).toHaveBeenCalledWith(copy.noId);
  });

  it("counts the notes that link to a block and lists them from the count", async () => {
    const user = userEvent.setup();
    const { editor, onOpenNote } = setup();
    const chip = await waitFor(() => {
      const found = editor.view.dom.querySelector<HTMLElement>("[data-block-refs='acc']");
      if (!found) throw new Error("no chip yet");
      return found;
    });
    expect(chip).toHaveTextContent("1");
    expect(chip).toHaveAttribute("aria-label", copy.links_one.replace("{{count}}", "1"));
    act(() => {
      editor.view.dispatch(editor.state.tr.insertText("Very ", 1));
    });
    const moved = editor.view.dom.querySelector<HTMLElement>("[data-block-refs='acc']");
    expect(moved).not.toBeNull();
    fireEvent.mouseDown(moved as HTMLElement);
    const item = await screen.findByRole("menuitem", { name: copy.openLinked.replace("{{title}}", "Reading notes") });
    expect(item).toHaveTextContent("See the accuracy claim");
    await user.click(item);
    expect(onOpenNote).toHaveBeenCalledWith("n-2", { newTab: false, projectId: "lib-2" });
    expect(findDocBlock(editor.state.doc, "acc")?.text).toBe("Very Accuracy rose");
  });

  it("puts counts after list items and after tables, and drops them when nothing links there", () => {
    const refs = createBlockRefs();
    const editor = kbEditor("- item ^it\n\n| a |\n| --- |\n| 1 |\n\n^tbl\n", { callout: null }, [refs.extension]);
    act(() => refs.setCounts(new Map([["it", 2], ["tbl", 1]]), (count) => `${count} links`));
    const chips = [...editor.view.dom.querySelectorAll<HTMLElement>(".note-block-refs")];
    expect(chips.map((chip) => [chip.dataset.blockRefs, chip.textContent, chip.closest("li") !== null])).toEqual([
      ["it", "2", true],
      ["tbl", "1", false],
    ]);
    act(() => refs.setCounts(new Map(), (count) => `${count}`));
    expect(editor.view.dom.querySelector(".note-block-refs")).toBeNull();
    act(() => refs.setCounts(new Map(), (count) => `${count}`));
    expect(editor.view.dom.querySelector(".note-block-refs")).toBeNull();
  });

  it("places the handle at the top of a table or code block", async () => {
    const { editor } = setup("| a |\n| --- |\n| 1 |\n\n```js\nx\n```\n");
    hover(editor, "a");
    expect(await screen.findByRole("button", { name: copy.handle })).toBeInTheDocument();
  });

  it("hides the handle when the pointer leaves the note or the note scrolls", async () => {
    vi.useFakeTimers();
    const { editor } = setup();
    hover(editor, "Accuracy");
    expect(screen.getByRole("button", { name: copy.handle })).toBeInTheDocument();
    fireEvent.mouseMove(screen.getByTestId("scroller"), { clientX: 120, clientY: 900 });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.queryByRole("button", { name: copy.handle })).toBeNull();
    hover(editor, "Accuracy");
    fireEvent.scroll(screen.getByTestId("scroller"));
    expect(screen.queryByRole("button", { name: copy.handle })).toBeNull();
    vi.useRealTimers();
  });
});
