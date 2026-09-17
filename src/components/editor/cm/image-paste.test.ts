// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

const mocks = vi.hoisted(() => ({
  importImageFile: vi.fn(),
  success: vi.fn(),
}));

vi.mock("@/components/editor/figure-import", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/editor/figure-import")>();
  return { ...actual, importImageFile: mocks.importImageFile };
});

vi.mock("@/lib/toast", () => ({
  toast: { success: mocks.success, error: vi.fn(), info: vi.fn() },
  notifyError: vi.fn(),
}));

vi.mock("@/components/editor/cm/controller", () => ({
  insertEnvironment: vi.fn(),
  insertTemplate: vi.fn(),
  wrapSelectionOrPlaceholder: vi.fn(),
}));

import { imagePasteExtension, imageTransferFiles } from "./image-paste";

let views: EditorView[] = [];

function mount(doc = "Hello\n"): EditorView {
  const parent = document.createElement("div");
  document.body.append(parent);
  const view = new EditorView({
    state: EditorState.create({ doc, extensions: [imagePasteExtension()] }),
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

beforeEach(() => {
  vi.clearAllMocks();
  mocks.importImageFile.mockResolvedValue({ path: "figures/pasted.png", latexPath: "figures/pasted.png" });
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
    expect(mocks.success).toHaveBeenCalledOnce();
  });

  it("leaves plain text pastes to CodeMirror", () => {
    const view = mount();
    dispatch(view, "paste", transfer(["text/plain"], [pngFile()]));
    expect(mocks.importImageFile).not.toHaveBeenCalled();
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

  it("skips images the importer rejects", async () => {
    mocks.importImageFile.mockResolvedValue(null);
    const view = mount();
    dispatch(view, "paste", transfer(["Files"], [pngFile()]));
    await flush();
    expect(view.state.doc.toString()).toBe("Hello\n");
  });
});
