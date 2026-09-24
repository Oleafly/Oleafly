// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

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
}));

vi.mock("@/components/editor/figure-import", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/editor/figure-import")>();
  return { ...actual, importImageFiles: mocks.importImageFiles };
});

vi.mock("@/lib/toast", () => ({
  toast: mocks.toast,
  notifyError: mocks.notifyError,
}));

vi.mock("@/components/editor/cm/controller", () => ({
  insertEnvironment: vi.fn(),
  insertTemplate: vi.fn(),
  wrapSelectionOrPlaceholder: vi.fn(),
}));

import { imagePasteExtension, imageTransferFiles } from "./image-paste";

let views: EditorView[] = [];

function mount(doc = "Hello\n", readOnly = false): EditorView {
  const parent = document.createElement("div");
  document.body.append(parent);
  const view = new EditorView({
    state: EditorState.create({
      doc,
      extensions: [imagePasteExtension(), EditorState.readOnly.of(readOnly)],
    }),
    parent,
  });
  views.push(view);
  return view;
}

function pngFile(name = "image.png"): File {
  return new File([new Uint8Array([137, 80, 78, 71])], name, { type: "image/png" });
}

function transfer(types: string[], files: File[]) {
  return { types, files, getData: () => "" };
}

function dispatch(view: EditorView, type: "paste" | "drop", data: unknown, extra: Record<string, unknown> = {}): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, type === "paste" ? "clipboardData" : "dataTransfer", { value: data });
  for (const [key, value] of Object.entries(extra)) Object.defineProperty(event, key, { value });
  view.contentDOM.dispatchEvent(event);
  return event;
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
  mocks.image = { path: "figures/pasted.png", latexPath: "figures/pasted.png" };
  mocks.importImageFiles.mockImplementation(
    async (files: File[], place: (image: { path: string; latexPath: string }) => void) => {
      for (const _file of files) if (mocks.image) place(mocks.image);
    },
  );
});

afterEach(() => {
  for (const view of views) view.destroy();
  views = [];
  document.body.replaceChildren();
});

describe("imageTransferFiles", () => {
  it("returns image files only when no plain text accompanies them", () => {
    expect(imageTransferFiles(transfer(["Files"], [pngFile()]))).toHaveLength(1);
    expect(imageTransferFiles(transfer(["text/plain", "Files"], [pngFile()]))).toEqual([]);
    expect(imageTransferFiles(null)).toEqual([]);
  });
});

describe("imagePasteExtension", () => {
  it("imports a pasted image and inserts the figure snippet with the caret in the caption", async () => {
    const view = mount();
    view.dispatch({ selection: { anchor: 6 } });
    const event = dispatch(view, "paste", transfer(["Files"], [pngFile()]));
    expect(event.defaultPrevented).toBe(true);
    await flush();
    const text = view.state.doc.toString();
    expect(text).toContain("\\includegraphics[width=0.8\\linewidth]{figures/pasted.png}");
    expect(text).toContain("\\caption{}");
    expect(text).toContain("\\label{fig:pasted}");
    const caret = view.state.selection.main;
    expect(caret.empty).toBe(true);
    expect(text.slice(caret.from - "\\caption{".length, caret.from)).toBe("\\caption{");
    expectNoNotice();
  });

  it("leaves plain text pastes to CodeMirror", () => {
    const view = mount();
    dispatch(view, "paste", transfer(["text/plain"], [pngFile()]));
    expect(mocks.importImageFiles).not.toHaveBeenCalled();
    expect(view.state.doc.toString()).toBe("Hello\n");
  });

  it("inserts dropped images at the drop position", async () => {
    const view = mount("First\nSecond\n");
    vi.spyOn(view, "posAtCoords").mockReturnValue(6);
    const event = dispatch(view, "drop", transfer(["Files"], [pngFile()]), { clientX: 1, clientY: 1 });
    expect(event.defaultPrevented).toBe(true);
    await flush();
    expect(view.state.doc.toString().startsWith("First\n\\begin{figure}[htbp]")).toBe(true);
  });

  it("inserts every dropped image with no notice per figure", async () => {
    const view = mount();
    dispatch(view, "drop", transfer(["Files"], [pngFile("a.png"), pngFile("b.png"), pngFile("c.png")]), {
      clientX: 1,
      clientY: 1,
    });
    await flush();
    expect(mocks.importImageFiles).toHaveBeenCalledOnce();
    expect(view.state.doc.toString().match(/\\begin\{figure\}/gu)).toHaveLength(3);
    expectNoNotice();
  });

  it("leaves pastes and drops to CodeMirror while the editor is read-only", () => {
    const view = mount("Hello\n", true);
    const paste = dispatch(view, "paste", transfer(["Files"], [pngFile()]));
    const drop = dispatch(view, "drop", transfer(["Files"], [pngFile()]), { clientX: 1, clientY: 1 });
    expect(mocks.importImageFiles).not.toHaveBeenCalled();
    expect(paste.defaultPrevented).toBe(true);
    expect(drop.defaultPrevented).toBe(true);
    expect(view.state.doc.toString()).toBe("Hello\n");
  });

  it("skips images the importer rejects", async () => {
    mocks.image = null;
    const view = mount();
    dispatch(view, "paste", transfer(["Files"], [pngFile()]));
    await flush();
    expect(view.state.doc.toString()).toBe("Hello\n");
    expectNoNotice();
  });
});
