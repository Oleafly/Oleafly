// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/core";
import { createWysiwygExtensions, serializeLatexBody } from "@oleafly/wysiwyg";

const mocks = vi.hoisted(() => ({
  importImageFiles: vi.fn(),
  image: null as { path: string; latexPath: string } | null,
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    errorUnique: vi.fn(),
    infoUnique: vi.fn(),
  },
  notifyError: vi.fn(),
  locked: vi.fn(() => false),
}));

vi.mock("@/components/editor/figure-import", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/editor/figure-import")>();
  return { ...actual, importImageFiles: mocks.importImageFiles };
});

vi.mock("@/lib/toast", () => ({
  toast: mocks.toast,
  notifyError: mocks.notifyError,
}));

vi.mock("@/lib/editor-mutation-lease", () => ({
  isEditorMutationLocked: () => mocks.locked(),
}));

import { classifyPaste, createVisualPasteHandlers, type PasteData } from "./paste";

let editors: Editor[] = [];

function mount(content = "<p>Hello</p>"): Editor {
  const element = document.createElement("div");
  document.body.append(element);
  const editor = new Editor({
    element,
    extensions: createWysiwygExtensions(),
    content,
    editorProps: { handleScrollToSelection: () => true },
  });
  editors.push(editor);
  editor.commands.setTextSelection(6);
  return editor;
}

function pngFile(name = "image.png"): File {
  return new File([new Uint8Array([137, 80, 78, 71])], name, { type: "image/png" });
}

function transfer(entries: Record<string, string>, files: File[] = []): PasteData & { files: File[] } {
  return {
    types: [...Object.keys(entries), ...(files.length ? ["Files"] : [])],
    getData: (type: string) => entries[type] ?? "",
    files,
  };
}

function pasteEvent(data: PasteData): ClipboardEvent {
  return { clipboardData: data, preventDefault: vi.fn() } as unknown as ClipboardEvent;
}

async function flush(): Promise<void> {
  for (let i = 0; i < 4; i++) await Promise.resolve();
}

function expectNoNotice(): void {
  for (const notify of Object.values(mocks.toast)) expect(notify).not.toHaveBeenCalled();
  expect(mocks.notifyError).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.locked.mockReturnValue(false);
  mocks.image = { path: "figures/pasted.png", latexPath: "figures/pasted.png" };
  mocks.importImageFiles.mockImplementation(
    async (files: File[], place: (image: { path: string; latexPath: string }) => void) => {
      for (const _file of files) if (mocks.image) place(mocks.image);
    },
  );
});

afterEach(() => {
  for (const editor of editors) editor.destroy();
  editors = [];
  document.body.replaceChildren();
});

describe("classifyPaste", () => {
  it("imports image files when no plain text accompanies them", () => {
    const intent = classifyPaste(transfer({}, [pngFile()]));
    expect(intent.kind).toBe("files");
  });

  it("leaves anything that carries plain text to the rich-text editor", () => {
    expect(classifyPaste(transfer({ "text/plain": "caption", "text/html": '<img src="x.png">' }, [pngFile()])).kind).toBe(
      "default",
    );
    expect(classifyPaste(transfer({ "text/plain": "Bold", "text/html": "<b>Bold</b>" })).kind).toBe("default");
    expect(classifyPaste(transfer({ "text/plain": "See $x^2$" })).kind).toBe("default");
  });
});

describe("createVisualPasteHandlers", () => {
  const handlers = createVisualPasteHandlers();

  it("leaves text and markup to the default paste", () => {
    const editor = mount();
    expect(
      handlers.handlePaste(
        editor.view,
        pasteEvent(transfer({ "text/plain": "Bold", "text/html": "<p><b>Bold</b></p>" })),
      ),
    ).toBe(false);
    expect(handlers.handlePaste(editor.view, pasteEvent(transfer({ "text/plain": "just words" })))).toBe(false);
    expect(handlers.handlePaste(editor.view, { clipboardData: null } as unknown as ClipboardEvent)).toBe(false);
    expect(serializeLatexBody(editor.getJSON())).toBe("Hello\n");
  });

  it("does nothing while the document is leased", () => {
    mocks.locked.mockReturnValue(true);
    const editor = mount();
    expect(handlers.handlePaste(editor.view, pasteEvent(transfer({}, [pngFile()])))).toBe(false);
    expect(mocks.importImageFiles).not.toHaveBeenCalled();
  });

  it("imports pasted images and inserts a figure with a focused caption", async () => {
    const editor = mount();
    expect(handlers.handlePaste(editor.view, pasteEvent(transfer({}, [pngFile()])))).toBe(true);
    await flush();
    expect(mocks.importImageFiles).toHaveBeenCalledOnce();
    expect(serializeLatexBody(editor.getJSON())).toContain(
      "\\includegraphics[width=0.8\\linewidth]{figures/pasted.png}\n    \\caption{}\n    \\label{fig:pasted}",
    );
    expect(editor.state.selection.$from.parent.type.name).toBe("figureCaption");
    expectNoNotice();
  });

  it("inserts dropped images at the drop position and skips moves", async () => {
    const editor = mount();
    const view = editor.view;
    vi.spyOn(view, "posAtCoords").mockReturnValue({ pos: 1, inside: 0 });
    const event = { dataTransfer: transfer({}, [pngFile(), pngFile("second.png")]), clientX: 0, clientY: 0 } as unknown as DragEvent;
    expect(handlers.handleDrop(view, event, null, true)).toBe(false);
    expect(handlers.handleDrop(view, event, null, false)).toBe(true);
    await flush();
    expect(mocks.importImageFiles).toHaveBeenCalledOnce();
    expect(mocks.importImageFiles.mock.calls[0][0]).toHaveLength(2);
    expect(editor.getJSON().content?.map((node) => node.type)).toEqual(["paragraph", "figure", "figure", "paragraph"]);
    const latex = serializeLatexBody(editor.getJSON());
    expect(latex.match(/\\begin\{figure\}/gu)).toHaveLength(2);
    expect(latex.endsWith("Hello\n")).toBe(true);
    expectNoNotice();
  });

  it("skips files the importer rejects", async () => {
    mocks.image = null;
    const editor = mount();
    handlers.handlePaste(editor.view, pasteEvent(transfer({}, [pngFile()])));
    await flush();
    expect(serializeLatexBody(editor.getJSON())).toBe("Hello\n");
    expectNoNotice();
  });
});
