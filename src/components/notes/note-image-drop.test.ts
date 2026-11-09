// @vitest-environment jsdom
import { createWysiwygExtensions } from "@oleafly/wysiwyg";
import { Editor } from "@tiptap/core";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { loadNamespace } from "@/i18n";
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import { useToastStore } from "@/store/toast";
import { NoteImageDrop, type NoteImageTarget, noteImageName, noteImageTarget } from "./note-image-drop";

const tauri = vi.hoisted(() => ({ write: vi.fn(async (..._args: unknown[]) => ({})) }));
const native = vi.hoisted(() => ({ drop: vi.fn(() => false), images: vi.fn(async (): Promise<File[]> => []) }));

vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  writeProjectBytes: tauri.write,
}));
vi.mock("@/lib/native-drop", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/native-drop")>()),
  isNativeFileDrop: native.drop,
}));
vi.mock("@/components/editor/figure-import", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/editor/figure-import")>()),
  nativeDroppedImages: native.images,
}));

const editors: Editor[] = [];

function build(target: NoteImageTarget | null = { projectId: "note-1", notePath: null }): Editor {
  const element = document.createElement("div");
  document.body.append(element);
  const editor = new Editor({
    element,
    extensions: [...createWysiwygExtensions(), NoteImageDrop.configure({ target: () => target })],
    content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Hello" }] }] },
  });
  editors.push(editor);
  vi.spyOn(editor.view, "posAtCoords").mockReturnValue(null);
  return editor;
}

function png(name = "shot.png"): File {
  return new File([new Uint8Array([137, 80, 78, 71])], name, { type: "image/png" });
}

function transfer(files: File[], types: string[] = ["Files"]) {
  return { files, types, getData: () => "" } as unknown as DataTransfer;
}

function paste(editor: Editor, data: DataTransfer) {
  const event = { clipboardData: data, preventDefault: vi.fn() } as unknown as ClipboardEvent;
  const handled = editor.view.someProp("handlePaste", (handle) => handle(editor.view, event, {} as never)) ?? false;
  return { handled, event };
}

function drop(editor: Editor, data: DataTransfer) {
  const event = { dataTransfer: data, clientX: 0, clientY: 0, preventDefault: vi.fn() } as unknown as DragEvent;
  const handled = editor.view.someProp("handleDrop", (handle) => handle(editor.view, event, {} as never, false)) ?? false;
  return { handled, event };
}

function images(editor: Editor): string[] {
  const found: string[] = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name === "image") found.push(String(node.attrs.src));
  });
  return found;
}

beforeAll(async () => {
  await loadNamespace("notes");
});

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  tauri.write.mockReset();
  tauri.write.mockImplementation(async () => ({}));
  native.drop.mockReset();
  native.drop.mockImplementation(() => false);
  native.images.mockReset();
  useToastStore.setState({ toasts: [] });
});

describe("where note images go", () => {
  it("writes into the note itself or next to a project note", () => {
    expect(noteImageTarget({ id: "note-1" })).toEqual({ projectId: "note-1", notePath: null });
    expect(noteImageTarget({ id: "key", home: { projectId: "paper", path: "notes/a.md" } })).toEqual({
      projectId: "paper",
      notePath: "notes/a.md",
    });
  });

  it("names an image after the file and its content", () => {
    const name = noteImageName(png("Loss curve.png"), "abc", new Date(2026, 0, 2, 3, 4, 5));
    expect(name).toMatch(/^assets\/Loss-curve-[0-9a-f]{8}\.png$/u);
    expect(noteImageName(png("Loss curve.png"), "abc", new Date())).toBe(name);
    expect(noteImageName(png("Loss curve.png"), "abd", new Date())).not.toBe(name);
  });
});

describe("pasting and dropping images into a note", () => {
  it("saves a pasted image into the note's assets and shows it in place", async () => {
    const editor = build();
    const { handled, event } = paste(editor, transfer([png()]));
    expect(handled).toBe(true);
    expect(event.preventDefault).toHaveBeenCalled();
    await vi.waitFor(() => expect(images(editor)).toHaveLength(1));
    const [projectId, path, data] = tauri.write.mock.calls[0];
    expect(projectId).toBe("note-1");
    expect(path).toMatch(/^assets\/shot-[0-9a-f]{8}\.png$/u);
    expect(data).toBe("iVBORw==");
    expect(images(editor)).toEqual([path]);
  });

  it("leaves pasted text alone", () => {
    const editor = build();
    expect(paste(editor, transfer([png()], ["Files", "text/plain"])).handled).toBe(false);
    expect(paste(editor, transfer([])).handled).toBe(false);
  });

  it("writes a project note's image next to the note and links it from the note", async () => {
    const editor = build({ projectId: "paper", notePath: "notes/a.md" });
    drop(editor, transfer([png()]));
    await vi.waitFor(() => expect(images(editor)).toHaveLength(1));
    const [projectId, path] = tauri.write.mock.calls[0];
    expect(projectId).toBe("paper");
    expect(path).toMatch(/^notes\/assets\/shot-[0-9a-f]{8}\.png$/u);
    expect(images(editor)[0]).toBe(String(path).slice("notes/".length));
  });

  it("swallows other file drops instead of typing a file address", () => {
    const editor = build();
    const pdf = new File(["%PDF"], "paper.pdf", { type: "application/pdf" });
    const { handled, event } = drop(editor, transfer([pdf]));
    expect(handled).toBe(true);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(tauri.write).not.toHaveBeenCalled();
    expect(editor.getText()).toBe("Hello");
    expect(drop(editor, transfer([], ["text/plain"])).handled).toBe(false);
  });

  it("reads images dropped from the Linux file manager through the app", async () => {
    native.drop.mockReturnValue(true);
    native.images.mockResolvedValue([png("drop.png")]);
    const editor = build();
    const { handled } = drop(editor, transfer([], ["text/uri-list"]));
    expect(handled).toBe(true);
    await vi.waitFor(() => expect(images(editor)).toHaveLength(1));
    expect(String(tauri.write.mock.calls[0][1])).toMatch(/^assets\/drop-/u);
  });

  it("says once when an image could not be saved", async () => {
    tauri.write.mockRejectedValue(new Error("disk full"));
    const editor = build();
    paste(editor, transfer([png("a.png"), png("b.png")]));
    await vi.waitFor(() => expect(useToastStore.getState().toasts).toHaveLength(1));
    expect(useToastStore.getState().toasts[0].message).toBe(enNotes.document.imageFailed);
    expect(images(editor)).toEqual([]);
  });

  it("ignores files while the note can't be edited", () => {
    const editor = build(null);
    expect(drop(editor, transfer([png()])).handled).toBe(true);
    expect(paste(editor, transfer([png()])).handled).toBe(false);
    expect(tauri.write).not.toHaveBeenCalled();
  });
});
