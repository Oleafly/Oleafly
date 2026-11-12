// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Editor } from "@tiptap/core";
import { Slice } from "@tiptap/pm/model";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import { remoteImageAllowed, resetRemoteImagesForTest } from "@/lib/remote-image";
import { NoteImageDrop } from "./note-image-drop";
import { NoteLinkChoice } from "./note-link-choice";
import { chooseSlash, NoteSlash, visibleSlashItems } from "./note-slash";
import { destroyKbEditors, kbEditor, kbMarkdown, placeCursor, positionOf, pressKey, typeInto } from "./tests/kb-editor-fixtures";
import "./tests/setup";

const bridge = vi.hoisted(() => ({ preview: vi.fn() }));

vi.mock("@/lib/tauri", async (importOriginal) => ({ ...(await importOriginal<object>()), noteLinkPreview: bridge.preview }));
vi.mock("@/lib/log", async (importOriginal) => ({ ...(await importOriginal<object>()), logError: vi.fn(async () => undefined) }));

const media = enNotes.blocks.media;
const bookmark = enNotes.blocks.bookmark;
const FENCE = "```";
const PAGE = "https://example.org/page";

beforeEach(() => {
  bridge.preview.mockReset();
  resetRemoteImagesForTest();
});

afterEach(() => {
  cleanup();
  destroyKbEditors();
});

function noteDrop() {
  return NoteImageDrop.configure({ target: () => null, attach: () => undefined });
}

function onEmptyLine(): Editor {
  const editor = kbEditor("Intro", undefined, [noteDrop(), NoteSlash]);
  editor.commands.insertContentAt(editor.state.doc.content.size, { type: "paragraph" });
  editor.commands.setTextSelection(editor.state.doc.content.size - 1);
  editor.view.coordsAtPos = () => ({ top: 100, bottom: 120, left: 40, right: 60 });
  render(<NoteLinkChoice editor={editor} />);
  return editor;
}

function newLine(editor: Editor): void {
  editor.commands.insertContentAt(editor.state.doc.content.size, { type: "paragraph" });
  editor.commands.setTextSelection(editor.state.doc.content.size - 1);
}

function paste(editor: Editor, text: string): boolean {
  const clipboardData = { files: [], types: ["text/plain"], getData: (type: string) => (type === "text/plain" ? text : "") };
  const event = { clipboardData, preventDefault: vi.fn() } as unknown as ClipboardEvent;
  let handled = false;
  act(() => {
    handled = editor.view.someProp("handlePaste", (handle) => handle(editor.view, event, Slice.empty)) ?? false;
  });
  return handled;
}

function images(editor: Editor): string[] {
  const found: string[] = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name === "image") found.push(String(node.attrs.src));
  });
  return found;
}

function links(editor: Editor): [string, string][] {
  const found: [string, string][] = [];
  editor.state.doc.descendants((node) => {
    const link = node.marks.find((mark) => mark.type.name === "link");
    if (node.isText && link) found.push([node.text ?? "", String(link.attrs.href)]);
  });
  return found;
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe("pasting a video link", () => {
  it("pastes the link and asks whether to embed it, then embeds it on request", () => {
    const editor = onEmptyLine();
    expect(paste(editor, " https://youtu.be/dQw4w9WgXcQ ")).toBe(true);
    expect(kbMarkdown(editor)).toBe("Intro\n\n<https://youtu.be/dQw4w9WgXcQ>");
    expect(screen.getByRole("group", { name: media.pasteChoice })).toBeInTheDocument();
    expect(remoteImageAllowed("https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: media.embedChoice }));
    expect(images(editor)).toEqual(["https://youtu.be/dQw4w9WgXcQ"]);
    expect(remoteImageAllowed("https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg")).toBe(true);
    expect(screen.queryByRole("group", { name: media.pasteChoice })).not.toBeInTheDocument();
    expect(bridge.preview).not.toHaveBeenCalled();
  });

  it("keeps the link when the person says so, presses Escape or just keeps typing", () => {
    const editor = onEmptyLine();
    paste(editor, "https://vimeo.com/76979871");
    fireEvent.click(screen.getByRole("button", { name: media.linkChoice }));
    expect(screen.queryByRole("group", { name: media.pasteChoice })).not.toBeInTheDocument();
    expect(images(editor)).toEqual([]);
    expect(kbMarkdown(editor)).toBe("Intro\n\n<https://vimeo.com/76979871>");
    expect(links(editor)).toEqual([["https://vimeo.com/76979871", "https://vimeo.com/76979871"]]);

    newLine(editor);
    paste(editor, "https://youtu.be/dQw4w9WgXcQ");
    act(() => {
      fireEvent.keyDown(window, { key: "Escape" });
    });
    expect(screen.queryByRole("group", { name: media.pasteChoice })).not.toBeInTheDocument();
    expect(kbMarkdown(editor)).toBe("Intro\n\n<https://vimeo.com/76979871>\n\n<https://youtu.be/dQw4w9WgXcQ>");
    expect(links(editor)).toEqual([
      ["https://vimeo.com/76979871", "https://vimeo.com/76979871"],
      ["https://youtu.be/dQw4w9WgXcQ", "https://youtu.be/dQw4w9WgXcQ"],
    ]);
    expect(images(editor)).toEqual([]);

    newLine(editor);
    paste(editor, "https://youtu.be/dQw4w9WgXcQ");
    act(() => typeInto(editor, " "));
    expect(screen.queryByRole("group", { name: media.pasteChoice })).not.toBeInTheDocument();
    expect(images(editor)).toEqual([]);
  });

  it("leaves plain text, addresses with spaces and lines with text to the normal paste", () => {
    const editor = onEmptyLine();
    expect(paste(editor, "not a link")).toBe(false);
    expect(paste(editor, "https://example.org/a page")).toBe(false);
    expect(paste(editor, "ftp://example.org/file")).toBe(false);
    editor.commands.setTextSelection(3);
    expect(paste(editor, "https://youtu.be/dQw4w9WgXcQ")).toBe(false);
    expect(paste(editor, PAGE)).toBe(false);
    expect(screen.queryByRole("group")).not.toBeInTheDocument();
  });
});

describe("pasting a web link", () => {
  it("offers a bookmark card and keeps the plain link when asked", () => {
    const editor = onEmptyLine();
    expect(paste(editor, PAGE)).toBe(true);
    expect(screen.getByRole("group", { name: bookmark.pasteChoice })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: media.embedChoice })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: media.linkChoice }));
    expect(screen.queryByRole("group", { name: bookmark.pasteChoice })).not.toBeInTheDocument();
    expect(kbMarkdown(editor)).toBe(`Intro\n\n<${PAGE}>`);
    expect(links(editor)).toEqual([[PAGE, PAGE]]);
    expect(bridge.preview).not.toHaveBeenCalled();
  });

  it("turns the link into a bookmark card and fills it from the page preview", async () => {
    const pending = deferred<object>();
    bridge.preview.mockReturnValue(pending.promise);
    const editor = onEmptyLine();
    paste(editor, PAGE);
    fireEvent.click(screen.getByRole("button", { name: bookmark.cardChoice }));
    expect(screen.queryByRole("group", { name: bookmark.pasteChoice })).not.toBeInTheDocument();
    expect(bridge.preview).toHaveBeenCalledWith(PAGE);
    expect(kbMarkdown(editor)).toBe(`Intro\n\n${FENCE}bookmark\nurl: ${PAGE}\n${FENCE}`);
    expect(links(editor)).toEqual([]);
    expect(editor.state.selection.$from.parent.type.name).toBe("paragraph");

    pending.resolve({
      url: PAGE,
      title: "Example page",
      description: "One line\nof text",
      siteName: "Example",
      image: "https://cdn.example.org/og.png",
      favicon: null,
    });
    await settle();
    expect(kbMarkdown(editor)).toBe(
      [
        "Intro",
        "",
        `${FENCE}bookmark`,
        `url: ${PAGE}`,
        "title: Example page",
        "description: One line of text",
        "image: https://cdn.example.org/og.png",
        "site: Example",
        FENCE,
      ].join("\n"),
    );
  });

  it("keeps a card with the address when the preview fails", async () => {
    bridge.preview.mockRejectedValue(new Error("offline"));
    const editor = onEmptyLine();
    paste(editor, PAGE);
    fireEvent.click(screen.getByRole("button", { name: bookmark.cardChoice }));
    await settle();
    expect(kbMarkdown(editor)).toBe(`Intro\n\n${FENCE}bookmark\nurl: ${PAGE}\n${FENCE}`);
  });

  it("leaves a card alone when it was edited before the preview arrived", async () => {
    const pending = deferred<object>();
    bridge.preview.mockReturnValue(pending.promise);
    const editor = onEmptyLine();
    paste(editor, PAGE);
    fireEvent.click(screen.getByRole("button", { name: bookmark.cardChoice }));
    let at = -1;
    editor.state.doc.descendants((node, position) => {
      if (node.type.name === "codeBlock") at = position + 1 + node.content.size;
    });
    editor.view.dispatch(editor.state.tr.insertText("\ntitle: Mine", at));
    pending.resolve({ url: PAGE, title: "Theirs", description: null, siteName: null, image: null, favicon: null });
    await settle();
    expect(kbMarkdown(editor)).toBe(`Intro\n\n${FENCE}bookmark\nurl: ${PAGE}\ntitle: Mine\n${FENCE}`);
  });
});

describe("the Bookmark slash command", () => {
  it("asks for an address and makes a card from it", async () => {
    bridge.preview.mockResolvedValue({ url: PAGE, title: "Example page", description: null, siteName: null, image: null, favicon: null });
    const editor = onEmptyLine();
    act(() => typeInto(editor, "/bookmark"));
    const index = visibleSlashItems(editor).findIndex((item) => item.id === "bookmark");
    expect(index).toBe(0);
    expect(visibleSlashItems(editor)[0].label).toBe(bookmark.label);
    act(() => {
      chooseSlash(editor, index);
    });
    expect(kbMarkdown(editor)).toBe("Intro");
    expect(screen.getByRole("group", { name: bookmark.ask })).toBeInTheDocument();
    const field = screen.getByRole("textbox", { name: enNotes.toolbar.linkAddress });
    expect(field).toHaveFocus();

    fireEvent.change(field, { target: { value: "example.org" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(screen.getByRole("alert")).toHaveTextContent(enNotes.toolbar.linkInvalid);
    expect(bridge.preview).not.toHaveBeenCalled();

    fireEvent.change(field, { target: { value: ` ${PAGE} ` } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(screen.queryByRole("group", { name: bookmark.ask })).not.toBeInTheDocument();
    expect(bridge.preview).toHaveBeenCalledWith(PAGE);
    await settle();
    expect(kbMarkdown(editor)).toBe(`Intro\n\n${FENCE}bookmark\nurl: ${PAGE}\ntitle: Example page\n${FENCE}`);
  });

  it("closes the address field on Escape without changing the note", () => {
    const editor = onEmptyLine();
    act(() => typeInto(editor, "/bookmark"));
    act(() => {
      chooseSlash(editor, 0);
    });
    expect(screen.getByRole("group", { name: bookmark.ask })).toBeInTheDocument();
    act(() => {
      fireEvent.keyDown(window, { key: "Escape" });
    });
    expect(screen.queryByRole("group", { name: bookmark.ask })).not.toBeInTheDocument();
    expect(kbMarkdown(editor)).toBe("Intro");
    expect(bridge.preview).not.toHaveBeenCalled();
  });

  it("is offered only where a card can go", () => {
    const first = kbEditor("- a", undefined, [noteDrop(), NoteSlash]);
    placeCursor(first, "a", 1);
    pressKey(first, "Enter");
    typeInto(first, "/bookmark");
    expect(visibleSlashItems(first).map((item) => item.id)).not.toContain("bookmark");
    expect(kbMarkdown(first)).toBe("- a\n- /bookmark");

    const second = kbEditor("- a\n\n  b", undefined, [noteDrop(), NoteSlash]);
    const at = positionOf(second, "b");
    second.view.dispatch(second.state.tr.delete(at, at + 1));
    second.commands.setTextSelection(at);
    typeInto(second, "/bookmark");
    const index = visibleSlashItems(second).findIndex((item) => item.id === "bookmark");
    expect(index).toBeGreaterThanOrEqual(0);
    expect(chooseSlash(second, index)).toBe(true);
  });

  it("is not offered by an editor that can't ask for the address, such as quick capture", () => {
    const editor = kbEditor("Intro", undefined, [NoteSlash]);
    editor.commands.insertContentAt(editor.state.doc.content.size, { type: "paragraph" });
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    typeInto(editor, "/bookmark");
    expect(visibleSlashItems(editor).map((item) => item.id)).not.toContain("bookmark");
  });
});
