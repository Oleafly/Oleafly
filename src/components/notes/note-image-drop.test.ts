// @vitest-environment jsdom
import type { Editor } from "@tiptap/core";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { loadNamespace } from "@/i18n";
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import { useToastStore } from "@/store/toast";
import { attachFile, canAttach, NoteImageDrop, type NoteImageTarget, noteImageName, noteImageTarget } from "./note-image-drop";
import { NOTE_FILE_MAX_BYTES } from "./note-path";
import type { NotesData } from "./notes-data";
import { destroyKbEditors, kbEditor, kbMarkdown, positionOf } from "./tests/kb-editor-fixtures";
import "./tests/setup";

const tauri = vi.hoisted(() => ({ write: vi.fn(async (..._args: unknown[]) => ({})) }));
const native = vi.hoisted(() => ({ drop: vi.fn(() => false), take: vi.fn(async (): Promise<{ name: string; read: () => Promise<File> }[]> => []) }));

vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  writeProjectBytes: tauri.write,
}));
vi.mock("@/lib/native-drop", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/native-drop")>()),
  isNativeFileDrop: native.drop,
  takeNativeDrop: native.take,
}));

type Attach = NonNullable<NotesData["attachFile"]>;

function build(target: NoteImageTarget | null = { projectId: "note-1", notePath: null }, attach?: Attach): Editor {
  const editor = kbEditor("Hello world", undefined, [NoteImageDrop.configure({ target: () => target, attach: () => attach })]);
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

function toasts(): string[] {
  return useToastStore.getState().toasts.map((toast) => toast.message);
}

beforeAll(async () => {
  await loadNamespace("editor");
  const rect = new DOMRect(0, 0, 0, 0);
  Range.prototype.getClientRects = () => [rect] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => rect;
  Element.prototype.getClientRects = () => [rect] as unknown as DOMRectList;
});

afterEach(() => {
  destroyKbEditors();
  tauri.write.mockReset();
  tauri.write.mockImplementation(async () => ({}));
  native.drop.mockReset();
  native.drop.mockImplementation(() => false);
  native.take.mockReset();
  native.take.mockImplementation(async () => []);
  useToastStore.setState({ toasts: [] });
});

describe("where note files go", () => {
  it("writes into the note itself or next to a project note", () => {
    expect(noteImageTarget({ id: "note-1" })).toEqual({ projectId: "note-1", notePath: null });
    expect(noteImageTarget({ id: "key", home: { projectId: "paper", path: "notes/a.md" } })).toEqual({
      projectId: "paper",
      notePath: "notes/a.md",
    });
  });

  it("names a file after its name and its content", () => {
    const name = noteImageName(png("Loss curve.png"), "abc", new Date(2026, 0, 2, 3, 4, 5));
    expect(name).toMatch(/^assets\/Loss-curve-[0-9a-f]{8}\.png$/u);
    expect(noteImageName(png("Loss curve.png"), "abc", new Date())).toBe(name);
    expect(noteImageName(png("Loss curve.png"), "abd", new Date())).not.toBe(name);
  });

  it.each([
    ["録音.m4a", "audio/mp4", /^assets\/audio-[0-9a-f]{8}\.m4a$/u],
    ["запись.mp3", "audio/mpeg", /^assets\/audio-[0-9a-f]{8}\.mp3$/u],
    ["image.mp4", "video/mp4", /^assets\/video-[0-9a-f]{8}\.mp4$/u],
    ["blob", "video/webm", /^assets\/video-[0-9a-f]{8}\.webm$/u],
    ["論文.PDF", "application/pdf", /^assets\/pdf-[0-9a-f]{8}\.PDF$/u],
    ["数据.csv", "text/csv", /^assets\/table-[0-9a-f]{8}\.csv$/u],
    ["talk.mp4", "video/mp4", /^assets\/talk-[0-9a-f]{8}\.mp4$/u],
    ["Field recording", "audio/mpeg", /^assets\/Field-recording-[0-9a-f]{8}\.mp3$/u],
  ])("keeps the type of %s (%s) in its name, never a picture's", (name, type, pattern) => {
    expect(noteImageName(new File(["x"], name, { type }), "abc", new Date(2026, 10, 11, 12))).toMatch(pattern);
  });
});

describe("pasting and dropping files into a note", () => {
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

  it("writes a project note's file next to the note and links it from the note", async () => {
    const editor = build({ projectId: "paper", notePath: "notes/a.md" });
    drop(editor, transfer([png()]));
    await vi.waitFor(() => expect(images(editor)).toHaveLength(1));
    const [projectId, path] = tauri.write.mock.calls[0];
    expect(projectId).toBe("paper");
    expect(path).toMatch(/^notes\/assets\/shot-[0-9a-f]{8}\.png$/u);
    expect(images(editor)[0]).toBe(String(path).slice("notes/".length));
  });

  it.each([
    ["results.csv", "csv", "path: assets/results-"],
    ["panel.xlsx", "csv", "path: assets/panel-"],
    ["1abc.pdb", "molecule", "path: assets/1abc-"],
    ["sweep.ipynb", "notebook", "assets/sweep-"],
  ])("shows a dropped %s in the block that reads it", async (name, language, start) => {
    const editor = build();
    drop(editor, transfer([new File(["a,b\n1,2"], name)]));
    await vi.waitFor(() => expect(editor.state.doc.firstChild?.type.name).toBe("codeBlock"));
    expect(editor.state.doc.firstChild?.attrs.language).toBe(language);
    expect(editor.state.doc.firstChild?.textContent.startsWith(start)).toBe(true);
  });

  it("puts a dropped file where it was dropped, even after typing during the copy", async () => {
    let finish: () => void = () => {};
    tauri.write.mockImplementation(() => new Promise((resolve) => (finish = () => resolve({}))));
    const editor = build();
    vi.mocked(editor.view.posAtCoords).mockReturnValue({ pos: positionOf(editor, " world"), inside: -1 });
    drop(editor, transfer([png()]));
    await vi.waitFor(() => expect(tauri.write).toHaveBeenCalled());
    editor.view.dispatch(editor.state.tr.insertText("Big ", 1));
    finish();
    await vi.waitFor(() => expect(images(editor)).toHaveLength(1));
    expect(kbMarkdown(editor)).toMatch(/^Big Hello\n\n!\[\]\(assets\/shot-[0-9a-f]{8}\.png\)\n\n world/u);
  });

  it("refuses a file over the size limit without reading it", async () => {
    const editor = build();
    const huge = png("huge.png");
    Object.defineProperty(huge, "size", { value: NOTE_FILE_MAX_BYTES + 1 });
    const read = vi.spyOn(huge, "arrayBuffer");
    drop(editor, transfer([huge]));
    await vi.waitFor(() => expect(toasts()).toEqual([enNotes.document.fileTooLarge.replace("{{name}}", "huge.png")]));
    expect(read).not.toHaveBeenCalled();
    expect(tauri.write).not.toHaveBeenCalled();
  });

  it("keeps other file drops out of the note and says which files a note can hold", () => {
    const editor = build();
    const pdf = new File(["PK"], "bundle.zip", { type: "application/zip" });
    const { handled, event } = drop(editor, transfer([pdf]));
    expect(handled).toBe(true);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(paste(editor, transfer([pdf])).handled).toBe(false);
    expect(tauri.write).not.toHaveBeenCalled();
    expect(editor.getText()).toBe("Hello world");
    expect(toasts()).toEqual([enNotes.document.unsupportedFile]);
    drop(editor, transfer([pdf]));
    expect(toasts()).toHaveLength(1);
    expect(drop(editor, transfer([], ["text/plain"])).handled).toBe(false);
  });

  it("reads files dropped from the Linux file manager through the app, and says so when none fits", async () => {
    native.drop.mockReturnValue(true);
    native.take.mockResolvedValue([{ name: "drop.png", read: async () => png("drop.png") }]);
    const editor = build();
    expect(drop(editor, transfer([], ["text/uri-list"])).handled).toBe(true);
    await vi.waitFor(() => expect(images(editor)).toHaveLength(1));
    expect(String(tauri.write.mock.calls[0][1])).toMatch(/^assets\/drop-/u);
    native.take.mockResolvedValue([{ name: "bundle.zip", read: async () => png() }]);
    drop(editor, transfer([], ["text/uri-list"]));
    await vi.waitFor(() => expect(toasts()).toEqual([enNotes.document.unsupportedFile]));
  });

  it("takes dropped audio, video and PDF files as embeds", async () => {
    const editor = build();
    drop(editor, transfer([new File(["ID3"], "talk.mp3", { type: "audio/mpeg" }), new File(["%PDF"], "paper.pdf", { type: "application/pdf" })]));
    await vi.waitFor(() => expect(images(editor)).toHaveLength(2));
    expect(tauri.write.mock.calls.map((call) => String(call[1]))).toEqual([expect.stringMatching(/^assets\/talk-.*\.mp3$/u), expect.stringMatching(/^assets\/paper-.*\.pdf$/u)]);
    drop(editor, transfer([new File(["x"], "clip", { type: "video/webm" })]));
    await vi.waitFor(() => expect(images(editor)).toHaveLength(3));
    expect(images(editor)[2]).toMatch(/^assets\/clip-[0-9a-f]{8}\.webm$/u);
  });

  it("refuses audio or video in a format a note can't play, instead of showing it as a broken image", async () => {
    const editor = build();
    drop(editor, transfer([new File(["x"], "clip.mkv", { type: "video/x-matroska" }), new File(["x"], "memo.wma", { type: "audio/x-ms-wma" })]));
    expect(toasts()).toEqual([enNotes.document.unsupportedFile]);
    await Promise.resolve();
    expect(tauri.write).not.toHaveBeenCalled();
    expect(images(editor)).toEqual([]);
  });

  it("saves pasted audio, video and PDF files the way it saves dropped ones", async () => {
    const editor = build();
    const files = [new File(["ID3"], "memo.mp3", { type: "audio/mpeg" }), new File(["%PDF"], "paper.pdf", { type: "application/pdf" })];
    const { handled, event } = paste(editor, transfer(files));
    expect(handled).toBe(true);
    expect(event.preventDefault).toHaveBeenCalled();
    await vi.waitFor(() => expect(images(editor)).toHaveLength(2));
    expect(images(editor)).toEqual([expect.stringMatching(/^assets\/memo-.*\.mp3$/u), expect.stringMatching(/^assets\/paper-.*\.pdf$/u)]);
  });

  it("says once when files could not be saved", async () => {
    tauri.write.mockRejectedValue(new Error("disk full"));
    const editor = build();
    paste(editor, transfer([png("a.png"), png("b.png")]));
    await vi.waitFor(() => expect(toasts()).toEqual([enNotes.document.fileFailed.replace("{{error}}", "disk full")]));
    expect(images(editor)).toEqual([]);
  });

  it("ignores files while the note can't be edited", () => {
    const editor = build(null);
    expect(drop(editor, transfer([png()])).handled).toBe(true);
    expect(paste(editor, transfer([png()])).handled).toBe(false);
    expect(tauri.write).not.toHaveBeenCalled();
  });
});

describe("attaching a picked file", () => {
  it("offers attaching only to an editable note whose data can copy files", () => {
    expect(canAttach(build())).toBe(false);
    expect(canAttach(build(null, vi.fn()))).toBe(false);
    expect(canAttach(build(undefined, vi.fn()))).toBe(true);
  });

  it("copies the picked file into the note and inserts its block where the cursor was", async () => {
    let finish: (path: string | null) => void = () => {};
    const attach = vi.fn<Attach>(() => new Promise((resolve) => (finish = resolve)));
    const editor = build(undefined, attach);
    editor.commands.setTextSelection(positionOf(editor, " world"));
    const done = attachFile(editor, "image");
    expect(attach).toHaveBeenCalledWith("note-1", expect.objectContaining({ extensions: expect.arrayContaining(["png", "webp", "svg"]) }));
    expect(attach.mock.calls[0][1].extensions).not.toContain("csv");
    editor.commands.insertContentAt(1, "Big ");
    finish("assets/plot-1a2b3c4d.png");
    await done;
    expect(kbMarkdown(editor)).toMatch(/^Big Hello\n\n!\[\]\(assets\/plot-1a2b3c4d\.png\)\n\n world/u);
  });

  it("leaves the note alone when the dialog is closed, and says why a copy failed", async () => {
    const attach = vi.fn<Attach>(async () => null);
    const editor = build(undefined, attach);
    await attachFile(editor, "file");
    expect(kbMarkdown(editor)).toBe("Hello world");
    attach.mockRejectedValueOnce(new Error("The file is larger than the 64 MiB limit."));
    await attachFile(editor, "file");
    expect(toasts()).toEqual([enNotes.document.fileFailed.replace("{{error}}", "The file is larger than the 64 MiB limit.")]);
  });

  it("drops the block when the note closed while the dialog was open", async () => {
    let finish: (path: string) => void = () => {};
    const editor = build(undefined, () => new Promise((resolve) => (finish = resolve)));
    const done = attachFile(editor, "file");
    destroyKbEditors();
    finish("assets/run.ipynb");
    await expect(done).resolves.toBeUndefined();
    expect(toasts()).toEqual([]);
  });
});
