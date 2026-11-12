// @vitest-environment jsdom
import { Editor, Extension, type JSONContent } from "@tiptap/core";
import { createWysiwygExtensions } from "@oleafly/wysiwyg";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import { DecorationSet } from "@tiptap/pm/view";
import { Network } from "lucide-react";
import { within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MermaidRemoteContentError } from "@/components/ui/mermaid-remote";
import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import enCore from "@/i18n/locales/en/core.json" with { type: "json" };
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import {
  BLOCK_REPAINT_MS,
  caretAfterDrawnBlock,
  EDITING_CLASS,
  type NoteAssetActions,
  noteAssetActions,
  SOURCE_CLASS,
  withBlockViews,
  withImageView,
} from "./block-views";
import { type PaintContext, registerNoteBlock } from "./note-blocks";
import { showNoteDoc } from "./note-live-doc";
import { allowRemoteImage, resetRemoteImagesForTest } from "@/lib/remote-image";
import { useToastStore } from "@/store/toast";
import { NotebookTooLargeError } from "./notebook-block";
import { deferred } from "./tests/notes-data-fixture";
import "./tests/setup";

const mocks = vi.hoisted(() => ({ renderDiagram: vi.fn() }));
const bridge = vi.hoisted(() => ({
  origin: vi.fn(async () => "http://127.0.0.1:4545"),
  preview: vi.fn(async (url: string) => ({ url, title: null, description: null, siteName: null, image: null, favicon: null }) as {
    url: string;
    title: string | null;
    description: string | null;
    siteName: string | null;
    image: string | null;
    favicon: string | null;
  }),
}));

vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  noteVideoFrameOrigin: bridge.origin,
  noteLinkPreview: bridge.preview,
}));

vi.mock("@/components/ui/mermaid-diagram", () => ({ renderDiagram: mocks.renderDiagram }));

const notebooks = vi.hoisted(() => ({ render: vi.fn(), unmount: vi.fn(), hosts: [] as HTMLElement[] }));

vi.mock("./NotebookView", () => ({
  mountNotebook: (host: HTMLElement) => {
    notebooks.hosts.push(host);
    return { render: notebooks.render, unmount: notebooks.unmount };
  },
}));

const CHART = JSON.stringify({ title: "Validation", categories: ["Run 1", "Run 2"], series: [{ name: "A", values: [61, 64] }] });

let editors: Editor[] = [];

function codeBlock(language: string | null, text: string): JSONContent {
  return { type: "codeBlock", attrs: { language }, content: [{ type: "text", text }] };
}

function build(...content: JSONContent[]): Editor {
  return buildWith(createWysiwygExtensions().map(withBlockViews), content);
}

function buildWith(extensions: ReturnType<typeof createWysiwygExtensions>, content: JSONContent[]): Editor {
  const element = document.createElement("div");
  document.body.append(element);
  const editor = new Editor({ element, extensions, content: { type: "doc", content } });
  editors.push(editor);
  return editor;
}

function drawn(editor: Editor, index = 0): HTMLElement {
  return editor.view.dom.querySelectorAll<HTMLElement>(".note-code")[index];
}

function svg(): SVGSVGElement {
  const element = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  element.setAttribute("data-testid", "diagram");
  return element;
}

function codeBlockPosition(editor: Editor, index = 0): number {
  const positions: number[] = [];
  editor.state.doc.descendants((node, position) => {
    if (node.type.name === "codeBlock") positions.push(position);
  });
  return positions[index];
}

function codeBlockView(editor: Editor) {
  const create = editor.extensionManager.nodeViews.codeBlock;
  return create(editor.state.doc.child(0), editor.view, () => 0, [], DecorationSet.empty);
}

function replaceCode(editor: Editor, text: string, index = 0) {
  const position = codeBlockPosition(editor, index);
  const node = editor.state.doc.nodeAt(position);
  editor.view.dispatch(editor.state.tr.insertText(text, position + 1, position + 1 + (node?.content.size ?? 0)));
}

beforeAll(async () => {
  const rect = new DOMRect(0, 0, 0, 0);
  Range.prototype.getClientRects = () => [rect] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => rect;
});

beforeEach(() => {
  notebooks.render.mockReset();
  notebooks.unmount.mockReset();
  notebooks.hosts = [];
  mocks.renderDiagram.mockReset();
  mocks.renderDiagram.mockImplementation(async () => svg());
});

afterEach(() => {
  for (const editor of editors) {
    editor.view.dom.parentElement?.remove();
    editor.destroy();
  }
  editors = [];
  document.documentElement.classList.remove("dark");
  resetRemoteImagesForTest();
});

describe("drawn block views", () => {
  it("leaves extensions other than code blocks untouched", () => {
    const extension = Extension.create({ name: "codeBlockless" });
    expect(withBlockViews(extension)).toBe(extension);
    const paragraph = createWysiwygExtensions().find((item) => item.name === "paragraph");
    expect(paragraph && withBlockViews(paragraph)).toBe(paragraph);
  });

  it.each([
    ["klingon", "qaplah"],
    [null, "plain"],
  ])("shows a %s fence as plain code that can still be copied", (language, text) => {
    const editor = build(codeBlock(language, text));
    const dom = drawn(editor);
    expect(dom).not.toHaveClass("note-drawn");
    expect(dom).not.toHaveClass("note-code-lang");
    const copy = dom.querySelector("button") as HTMLButtonElement;
    expect(copy.getAttribute("aria-label")).toBe(enNotes.blocks.code.copyLabel);
    expect(copy.tabIndex).toBe(0);
    expect(dom.querySelector("pre > code")?.textContent).toBe(text);
  });

  it("keeps a python fence editable code with a copy button", () => {
    const editor = build(codeBlock("python", "print(1)"));
    const dom = drawn(editor);
    expect(dom).not.toHaveClass("note-drawn");
    expect(dom).toHaveClass("note-code-lang");
    expect(dom.dataset.language).toBe("python");
    expect(dom.querySelector("pre > code")?.textContent).toBe("print(1)");
    expect(dom.querySelector("button")?.getAttribute("aria-label")).toBe(enNotes.blocks.code.copyLabel);
  });

  it("draws a Mermaid diagram from its source with the light theme", async () => {
    const editor = build(codeBlock("mermaid", "flowchart LR\n  A --> B"));
    const dom = drawn(editor);
    expect(dom).toHaveClass("note-drawn");
    expect(dom.dataset.block).toBe("mermaid");
    expect(dom.querySelector(".note-drawn-label")?.textContent).toBe("Mermaid");
    expect(mocks.renderDiagram).toHaveBeenCalledWith("flowchart LR\n  A --> B", "light");
    await vi.waitFor(() => expect(dom.querySelector(".note-drawn-preview [data-testid=diagram]")).not.toBeNull());
    expect((dom.querySelector(".note-drawn-preview") as HTMLElement).contentEditable).toBe("false");
    expect((dom.querySelector(".note-drawn-label") as HTMLElement).contentEditable).toBe("false");
    expect(editor.getJSON().content?.[0]).toEqual(codeBlock("mermaid", "flowchart LR\n  A --> B"));
  });

  it("draws Mermaid with the dark theme when the app is dark", () => {
    document.documentElement.classList.add("dark");
    build(codeBlock("mermaid", "flowchart TD\n  A --> B"));
    expect(mocks.renderDiagram).toHaveBeenCalledWith("flowchart TD\n  A --> B", "dark");
  });

  it("says when a Mermaid diagram has an error", async () => {
    mocks.renderDiagram.mockRejectedValue(new Error("Parse error"));
    const editor = build(codeBlock("mermaid", "flowchart ??"));
    const preview = drawn(editor).querySelector(".note-drawn-preview") as HTMLElement;
    await vi.waitFor(() => expect(preview.textContent).toBe(enNotes.blocks.diagramError));
  });

  it("says when a Mermaid diagram was not drawn because it loads from the internet", async () => {
    mocks.renderDiagram.mockRejectedValue(new MermaidRemoteContentError());
    const editor = build(codeBlock("mermaid", 'flowchart LR\n  A@{ img: "https://attacker.example/p.png" }'));
    const preview = drawn(editor).querySelector(".note-drawn-preview") as HTMLElement;
    await vi.waitFor(() => expect(preview.textContent).toBe(enCore.mermaid.remoteBlocked));
  });

  it("draws a chart and labels it with the translated name", () => {
    const editor = build(codeBlock("chart", CHART));
    const dom = drawn(editor);
    expect(dom.dataset.block).toBe("chart");
    expect(dom.querySelector(".note-drawn-label")?.textContent).toBe(enNotes.blocks.chart);
    expect(dom.querySelector(".note-drawn-preview svg")?.getAttribute("aria-label")).toBe("Validation");
  });

  it("renders LaTeX math with KaTeX", () => {
    const editor = build(codeBlock("{=latex}", "\\begin{equation}\n  E = mc^2\n\\end{equation}"));
    const dom = drawn(editor);
    expect(dom.dataset.block).toBe("latex");
    expect(dom.querySelector(".note-drawn-label")?.textContent).toBe("LaTeX");
    expect(dom.querySelector(".note-drawn-preview .katex")).not.toBeNull();
  });

  it("explains that LaTeX that is not math has no preview yet", () => {
    const editor = build(codeBlock("{=latex}", "\\section{Introduction}\nText \\cite{he2022}."));
    const preview = drawn(editor).querySelector(".note-drawn-preview");
    expect(preview?.querySelector(".katex")).toBeNull();
    expect(preview?.textContent).toBe(enNotes.blocks.noPreview);
  });

  it("says Typst previews need the desktop app outside it", () => {
    const editor = build(codeBlock("{=typst}", "$ E = m c^2 $"));
    const dom = drawn(editor);
    expect(dom.dataset.block).toBe("typst");
    expect(dom.querySelector(".note-drawn-label")?.textContent).toBe("Typst");
    expect(dom.querySelector(".note-drawn-preview")?.textContent).toBe(enNotes.blocks.typst.desktopOnly);
  });

  it("switches between the preview and the source with a pressed toggle", () => {
    const editor = build({ type: "paragraph", content: [{ type: "text", text: "Before" }] }, codeBlock("{=typst}", "$ x $"));
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 2)));
    const dom = drawn(editor);
    const toggle = within(dom).getByRole<HTMLButtonElement>("button", { name: enNotes.blocks.source });
    expect(toggle.type).toBe("button");
    expect(toggle).toHaveAttribute("aria-pressed", "false");

    const press = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    toggle.dispatchEvent(press);
    expect(press.defaultPrevented).toBe(true);

    toggle.click();
    expect(dom).toHaveClass("note-drawn-source");
    expect(toggle.textContent).toBe(enNotes.blocks.preview);
    expect(toggle).toHaveAttribute("aria-pressed", "true");

    toggle.click();
    expect(dom).not.toHaveClass("note-drawn-source");
    expect(toggle.textContent).toBe(enNotes.blocks.source);
    expect(toggle).toHaveAttribute("aria-pressed", "false");
  });

  it("repaints only when the block's text changes, once typing pauses", async () => {
    vi.useFakeTimers();
    try {
      const editor = build(codeBlock("mermaid", "flowchart LR\n  A --> B"), { type: "paragraph", content: [{ type: "text", text: "After" }] });
      const dom = drawn(editor);
      expect(mocks.renderDiagram).toHaveBeenCalledTimes(1);

      editor.view.dispatch(editor.state.tr.insertText("!", editor.state.doc.content.size - 1));
      expect(drawn(editor)).toBe(dom);
      await vi.advanceTimersByTimeAsync(BLOCK_REPAINT_MS);
      expect(mocks.renderDiagram).toHaveBeenCalledTimes(1);

      editor.view.dispatch(editor.state.tr.setNodeMarkup(codeBlockPosition(editor), undefined, { language: "mermaid" }));
      await vi.advanceTimersByTimeAsync(BLOCK_REPAINT_MS);
      expect(mocks.renderDiagram).toHaveBeenCalledTimes(1);

      replaceCode(editor, "flowchart LR\n  A --> C");
      replaceCode(editor, "flowchart LR\n  A --> D");
      expect(drawn(editor)).toBe(dom);
      expect(mocks.renderDiagram).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(BLOCK_REPAINT_MS);
      expect(mocks.renderDiagram).toHaveBeenCalledTimes(2);
      expect(mocks.renderDiagram).toHaveBeenLastCalledWith("flowchart LR\n  A --> D", "light");

      replaceCode(editor, "flowchart LR\n  A --> E");
      replaceCode(editor, "flowchart LR\n  A --> D");
      await vi.advanceTimersByTimeAsync(BLOCK_REPAINT_MS);
      expect(mocks.renderDiagram).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("paints a block only once it comes near the screen, with the text it has by then", async () => {
    const watched: { fire: (near: boolean) => void; stopped: boolean }[] = [];
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        private readonly targets: Element[] = [];
        private readonly record = { fire: (near: boolean) => this.notify(near), stopped: false };
        constructor(private readonly callback: IntersectionObserverCallback) {
          watched.push(this.record);
        }
        observe(target: Element) {
          this.targets.push(target);
        }
        unobserve() {}
        disconnect() {
          this.record.stopped = true;
        }
        private notify(near: boolean) {
          const entries = this.targets.map((target) => ({ target, isIntersecting: near }) as IntersectionObserverEntry);
          this.callback(entries, this as unknown as IntersectionObserver);
        }
      },
    );
    vi.useFakeTimers();
    try {
      const editor = build(codeBlock("mermaid", "flowchart LR\n  A --> B"), codeBlock("mermaid", "flowchart LR\n  C --> D"));
      replaceCode(editor, "flowchart LR\n  A --> E");
      await vi.advanceTimersByTimeAsync(BLOCK_REPAINT_MS);
      expect(mocks.renderDiagram).not.toHaveBeenCalled();
      watched[0].fire(false);
      expect(mocks.renderDiagram).not.toHaveBeenCalled();
      watched[0].fire(true);
      expect(mocks.renderDiagram.mock.calls.map(([source]) => source)).toEqual([
        "flowchart LR\n  A --> E",
        "flowchart LR\n  C --> D",
      ]);
      editors = editors.filter((open) => open !== editor);
      editor.view.dom.parentElement?.remove();
      editor.destroy();
      expect(watched[0].stopped).toBe(true);
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });

  it("redraws the block from scratch when its language changes", () => {
    const editor = build(codeBlock("{=typst}", "$ x $"));
    const before = drawn(editor);
    editor.view.dispatch(editor.state.tr.setNodeMarkup(codeBlockPosition(editor), undefined, { language: "mermaid" }));
    const after = drawn(editor);
    expect(after).not.toBe(before);
    expect(after.dataset.block).toBe("mermaid");
    expect(mocks.renderDiagram).toHaveBeenCalledWith("$ x $", "light");
  });

  it("gives up the view when the block turns into another kind of node", () => {
    const editor = build(codeBlock("mermaid", "flowchart LR"));
    const nodeView = codeBlockView(editor);
    const paragraph = editor.schema.nodes.paragraph.create();
    expect(nodeView.update?.(paragraph, [], DecorationSet.empty)).toBe(false);
  });

  it("keeps the drawing when the editor hands back a block with the same text", () => {
    const editor = build(codeBlock("mermaid", "flowchart LR"));
    const nodeView = codeBlockView(editor);
    mocks.renderDiagram.mockClear();
    expect(nodeView.update?.(editor.state.doc.child(0), [], DecorationSet.empty)).toBe(true);
    expect(mocks.renderDiagram).not.toHaveBeenCalled();
  });

  it("lets the editor watch typing in the source but not changes to the preview", () => {
    const editor = build(codeBlock("mermaid", "flowchart LR"));
    const nodeView = codeBlockView(editor);
    const code = nodeView.contentDOM as HTMLElement;
    const preview = (nodeView.dom as HTMLElement).querySelector(".note-drawn-preview") as HTMLElement;
    const typed = { type: "characterData", target: code.firstChild ?? code } as unknown as MutationRecord;
    const painted = { type: "childList", target: preview } as unknown as MutationRecord;
    expect(nodeView.ignoreMutation?.(typed)).toBe(false);
    expect(nodeView.ignoreMutation?.(painted)).toBe(true);
  });

  it("keeps the document unchanged while a drawing finishes in the preview", async () => {
    const editor = build(codeBlock("mermaid", "flowchart LR\n  A --> B"));
    const before = editor.getJSON();
    await vi.waitFor(() => expect(drawn(editor).querySelector("[data-testid=diagram]")).not.toBeNull());
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(editor.getJSON()).toEqual(before);
  });
});

function paragraph(text = ""): JSONContent {
  return text ? { type: "paragraph", content: [{ type: "text", text }] } : { type: "paragraph" };
}

function caretIn(editor: Editor, position: number) {
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, position)));
}

describe("editing a drawn block's source", () => {
  it("shows the hidden source while the caret is inside the block, so typing is never invisible", () => {
    const editor = build(paragraph("Before"), codeBlock("mermaid", "flowchart LR"), paragraph("After"));
    const dom = drawn(editor);
    expect(dom).not.toHaveClass(EDITING_CLASS);
    caretIn(editor, codeBlockPosition(editor) + 3);
    expect(dom).toHaveClass(EDITING_CLASS);
    expect(dom).toHaveClass("note-drawn");
    caretIn(editor, 2);
    expect(dom).not.toHaveClass(EDITING_CLASS);
  });

  it("keeps the source hidden for a selection that only passes through the block or selects it whole", () => {
    const editor = build(paragraph("Before"), codeBlock("mermaid", "flowchart LR"), paragraph("After"));
    const position = codeBlockPosition(editor);
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 2, position + 3)));
    expect(drawn(editor)).not.toHaveClass(EDITING_CLASS);
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, position)));
    expect(drawn(editor)).not.toHaveClass(EDITING_CLASS);
  });

  it("does not mark plain code blocks", () => {
    const editor = build(codeBlock("python", "print(1)"));
    caretIn(editor, 2);
    expect(editor.view.dom.querySelector(`.${EDITING_CLASS}`)).toBeNull();
  });

  it("follows the block while its source is edited and keeps the drawing", () => {
    const editor = build(paragraph("Before"), codeBlock("mermaid", "flowchart LR"));
    caretIn(editor, codeBlockPosition(editor) + 3);
    editor.commands.insertContent("x");
    expect(drawn(editor)).toHaveClass(EDITING_CLASS);
    expect(drawn(editor).querySelector("pre > code")?.textContent).toBe("flxowchart LR");
  });

  it.each([
    ["at the end of the note", [paragraph("Intro")], ["paragraph", "codeBlock", "paragraph"]],
    ["before an empty paragraph", [paragraph("Intro"), paragraph()], ["paragraph", "codeBlock", "paragraph"]],
    ["before more text", [paragraph("Intro"), paragraph("Next")], ["paragraph", "codeBlock", "paragraph", "paragraph"]],
  ])("puts the caret on an empty line after a block inserted %s", (_case, content, types) => {
    const editor = build(...content);
    caretIn(editor, 6);
    editor
      .chain()
      .insertContent(codeBlock("mermaid", "flowchart LR"))
      .command(caretAfterDrawnBlock)
      .run();
    expect((editor.getJSON().content ?? []).map((node) => node.type)).toEqual(types);
    const { $head } = editor.state.selection;
    expect($head.parent.type.name).toBe("paragraph");
    expect($head.parent.content.size).toBe(0);
    expect($head.index($head.depth - 1)).toBe(2);
    expect(drawn(editor)).not.toHaveClass(EDITING_CLASS);
  });

  it("leaves the caret alone after inserting plain code", () => {
    const editor = build(paragraph("Intro"));
    caretIn(editor, 6);
    editor.chain().insertContent(codeBlock("python", "print(1)")).command(caretAfterDrawnBlock).run();
    expect(editor.state.selection.$head.parent.type.name).toBe("codeBlock");
  });
});

function toggleOf(editor: Editor, index = 0): HTMLButtonElement {
  return drawn(editor, index).querySelector(".note-drawn-toggle") as HTMLButtonElement;
}

function sourceText(editor: Editor, index = 0): string {
  return editor.state.doc.nodeAt(codeBlockPosition(editor, index))?.textContent ?? "";
}

function shows(editor: Editor, label: string, pressed: boolean, index = 0) {
  expect(toggleOf(editor, index).textContent).toBe(label);
  expect(toggleOf(editor, index)).toHaveAttribute("aria-pressed", String(pressed));
}

describe("a note that starts with a drawn block", () => {
  function opened(): Editor {
    const editor = build(codeBlock("mermaid", "flowchart LR"), paragraph("After"));
    expect(editor.state.selection.$head.parent.type.name).toBe("codeBlock");
    return editor;
  }

  function hidden(editor: Editor) {
    expect(drawn(editor)).not.toHaveClass(EDITING_CLASS);
    expect(drawn(editor)).not.toHaveClass(SOURCE_CLASS);
    shows(editor, enNotes.blocks.source, false);
  }

  function open(editor: Editor) {
    expect(drawn(editor)).toHaveClass(EDITING_CLASS);
    shows(editor, enNotes.blocks.preview, true);
  }

  function reloaded(editor: Editor, block: string, after: string) {
    const target = editor.schema.nodeFromJSON({ type: "doc", content: [codeBlock("mermaid", block), paragraph(after)] });
    showNoteDoc(editor, target);
    expect(editor.state.doc.eq(target)).toBe(true);
  }

  it("opens with the source hidden although the caret starts inside the block", () => {
    hidden(opened());
  });

  it("shows the source once the arrow keys move the caret into the block", () => {
    const editor = opened();
    const after = editor.state.doc.child(0).nodeSize + 1;
    caretIn(editor, after);
    hidden(editor);
    caretIn(editor, after - 2);
    open(editor);
  });

  it("shows the source once the caret moves within the block it starts in", () => {
    const editor = opened();
    caretIn(editor, 3);
    open(editor);
  });

  it("shows the source when typing at the caret the note opened with", () => {
    const editor = opened();
    editor.view.dispatch(editor.state.tr.insertText("x"));
    expect(sourceText(editor)).toBe("xflowchart LR");
    open(editor);
  });

  it("shows the source and puts the caret in it from the Source button", () => {
    const editor = opened();
    toggleOf(editor).click();
    open(editor);
    expect(drawn(editor)).toHaveClass(SOURCE_CLASS);
    expect(editor.state.selection.$head.parentOffset).toBe("flowchart LR".length);
  });

  it("keeps the source hidden when the note changes away from the caret", () => {
    const editor = opened();
    editor.view.dispatch(editor.state.tr.insertText("!", editor.state.doc.content.size - 1));
    expect(editor.state.doc.child(1).textContent).toBe("After!");
    hidden(editor);
  });

  it("keeps the source hidden when a disk reload replaces the note with the caret still at the start", () => {
    const editor = opened();
    reloaded(editor, "flowchart TD", "After the reload");
    expect(editor.state.selection.$head.parent.type.name).toBe("codeBlock");
    hidden(editor);
  });

  it("keeps a source the person opened through a disk reload", () => {
    const editor = opened();
    caretIn(editor, 3);
    reloaded(editor, "flowchart LR", "After the reload");
    expect(editor.state.selection.head).toBe(3);
    open(editor);
  });
});

describe("the Source and Preview toggle of a drawn block", () => {
  it("puts the caret at the end of the source it shows, so typing goes into the visible source", () => {
    const editor = build(paragraph("Before"), codeBlock("notebook", "run.ipynb"), paragraph("After"));
    caretIn(editor, 2);
    toggleOf(editor).click();
    const dom = drawn(editor);
    expect(dom).toHaveClass(SOURCE_CLASS);
    expect(dom).toHaveClass(EDITING_CLASS);
    shows(editor, enNotes.blocks.preview, true);
    const { $head } = editor.state.selection;
    expect($head.parent.type.name).toBe("codeBlock");
    expect($head.parentOffset).toBe("run.ipynb".length);

    editor.commands.keyboardShortcut("Enter");
    editor.commands.insertContent("cells: 2-3");
    editor.commands.keyboardShortcut("Enter");
    editor.commands.insertContent("code: hide");
    expect(sourceText(editor)).toBe("run.ipynb\ncells: 2-3\ncode: hide");
    expect(editor.state.doc.childCount).toBe(3);

    toggleOf(editor).click();
    expect(dom).not.toHaveClass(SOURCE_CLASS);
    expect(dom).not.toHaveClass(EDITING_CLASS);
    shows(editor, enNotes.blocks.source, false);
    expect(editor.state.selection.$head.parent.textContent).toBe("After");
    expect(editor.state.selection.$head.parentOffset).toBe(0);
    expect(sourceText(editor)).toBe("run.ipynb\ncells: 2-3\ncode: hide");
    expect(editor.state.doc.childCount).toBe(3);
  });

  it("names the toggle Preview while the caret has opened the source, and hides it on click", () => {
    const editor = build(paragraph("Before"), codeBlock("mermaid", "flowchart LR"), paragraph("After"));
    caretIn(editor, 2);
    shows(editor, enNotes.blocks.source, false);
    caretIn(editor, codeBlockPosition(editor) + 3);
    expect(drawn(editor)).toHaveClass(EDITING_CLASS);
    shows(editor, enNotes.blocks.preview, true);

    toggleOf(editor).click();
    expect(drawn(editor)).not.toHaveClass(EDITING_CLASS);
    expect(drawn(editor)).not.toHaveClass(SOURCE_CLASS);
    shows(editor, enNotes.blocks.source, false);
    expect(editor.state.selection.$head.parent.textContent).toBe("After");
    expect(editor.state.doc.childCount).toBe(3);
  });

  it("keeps a source opened with the toggle after the caret leaves the block", () => {
    const editor = build(paragraph("Before"), codeBlock("mermaid", "flowchart LR"));
    caretIn(editor, 2);
    toggleOf(editor).click();
    caretIn(editor, 2);
    expect(drawn(editor)).toHaveClass(SOURCE_CLASS);
    expect(drawn(editor)).not.toHaveClass(EDITING_CLASS);
    shows(editor, enNotes.blocks.preview, true);
    toggleOf(editor).click();
    expect(drawn(editor)).not.toHaveClass(SOURCE_CLASS);
    shows(editor, enNotes.blocks.source, false);
    expect(editor.state.selection.$head.parent.textContent).toBe("Before");
  });

  it("leaves the caret on a new empty line when the block ends the note", () => {
    const editor = build(paragraph("Before"), codeBlock("mermaid", "flowchart LR"));
    caretIn(editor, codeBlockPosition(editor) + 3);
    toggleOf(editor).click();
    expect((editor.getJSON().content ?? []).map((node) => node.type)).toEqual(["paragraph", "codeBlock", "paragraph"]);
    const { $head } = editor.state.selection;
    expect($head.parent.type.name).toBe("paragraph");
    expect($head.index($head.depth - 1)).toBe(2);
    expect(drawn(editor)).not.toHaveClass(EDITING_CLASS);
  });

  it("does not move the caret into the next drawn block's hidden source", () => {
    const editor = build(codeBlock("mermaid", "flowchart LR"), codeBlock("latex", "x^2"));
    caretIn(editor, 3);
    toggleOf(editor).click();
    expect((editor.getJSON().content ?? []).map((node) => node.type).slice(0, 3)).toEqual(["codeBlock", "paragraph", "codeBlock"]);
    const { $head } = editor.state.selection;
    expect($head.parent.type.name).toBe("paragraph");
    expect($head.index($head.depth - 1)).toBe(1);
    expect(editor.view.dom.querySelector(`.${EDITING_CLASS}`)).toBeNull();
  });

  it("only switches the view in a note that can't be edited", () => {
    const editor = build(paragraph("Before"), codeBlock("mermaid", "flowchart LR"));
    caretIn(editor, 2);
    editor.setEditable(false);
    toggleOf(editor).click();
    expect(drawn(editor)).toHaveClass(SOURCE_CLASS);
    expect(editor.state.selection.$head.parent.textContent).toBe("Before");
    shows(editor, enNotes.blocks.preview, true);
  });
});

describe("blocks that save their own settings", () => {
  const probe = { paints: [] as string[], contexts: [] as PaintContext[] };

  beforeAll(() => {
    registerNoteBlock({
      name: "probe-block",
      label: () => "Probe",
      icon: Network,
      paint: (_preview, source, context) => {
        probe.paints.push(source);
        probe.contexts.push(context);
        return undefined;
      },
    });
  });

  beforeEach(() => {
    probe.paints = [];
    probe.contexts = [];
  });

  it("rewrites the block's source as one edit and keeps the drawing it already shows", async () => {
    vi.useFakeTimers();
    try {
      const editor = build(paragraph("Before"), codeBlock("probe-block", "style: a\ndata"));
      const rewrite = probe.contexts[0].rewrite;
      rewrite?.((source) => source.replace("style: a", "style: b"));
      expect(editor.state.doc.child(1).textContent).toBe("style: b\ndata");
      await vi.advanceTimersByTimeAsync(BLOCK_REPAINT_MS * 2);
      expect(probe.paints).toEqual(["style: a\ndata"]);
      editor.commands.undo();
      expect(editor.state.doc.child(1).textContent).toBe("style: a\ndata");
    } finally {
      vi.useRealTimers();
    }
  });

  it("repaints when the source had changed before the block rewrote it", async () => {
    vi.useFakeTimers();
    try {
      const editor = build(codeBlock("probe-block", "style: a"));
      replaceCode(editor, "style: a\nmore");
      probe.contexts[0].rewrite?.((source) => `${source}!`);
      await vi.advanceTimersByTimeAsync(BLOCK_REPAINT_MS * 2);
      expect(probe.paints).toEqual(["style: a", "style: a\nmore!"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the source hidden when a control in the preview rewrites it", () => {
    const editor = build(codeBlock("probe-block", "style: a"), paragraph("After"));
    probe.contexts[0].rewrite?.((source) => source.replace("style: a", "style: b"));
    expect(editor.state.doc.child(0).textContent).toBe("style: b");
    expect(editor.state.selection.$head.parent.type.name).toBe("codeBlock");
    expect(drawn(editor)).not.toHaveClass(EDITING_CLASS);
  });

  it("leaves a read-only note and an unchanged source alone", () => {
    const editor = build(codeBlock("probe-block", "style: a"));
    const before = editor.state.doc;
    probe.contexts[0].rewrite?.((source) => source);
    expect(editor.state.doc).toBe(before);
    editor.setEditable(false);
    probe.contexts[0].rewrite?.(() => "style: b");
    expect(editor.state.doc.child(0).textContent).toBe("style: a");
  });
});

type Resolve = (path: string) => Promise<string | null>;

function image(src: string | null, alt?: string): JSONContent {
  return { type: "image", attrs: alt === undefined ? { src } : { src, alt } };
}

function buildImages(resolve: Resolve, ...content: JSONContent[]): Editor {
  return buildMedia(resolve, {}, ...content);
}

function buildMedia(resolve: Resolve, actions: NoteAssetActions, ...content: JSONContent[]): Editor {
  const extensions = createWysiwygExtensions()
    .map(withBlockViews)
    .map((extension) => withImageView(extension, resolve, undefined, () => actions));
  return buildWith(extensions, content);
}

function imageView(editor: Editor, index = 0) {
  const positions: number[] = [];
  editor.state.doc.descendants((node, position) => {
    if (node.type.name === "image") positions.push(position);
  });
  const position = positions[index];
  const node = editor.state.doc.nodeAt(position);
  if (!node) throw new Error("no image there");
  return editor.extensionManager.nodeViews.image(node, editor.view, () => position, [], DecorationSet.empty);
}

function pressOn(target: Element): Event {
  const event = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "target", { value: target });
  return event;
}

async function loaded<T extends Element>(root: Element, selector: string): Promise<T> {
  return vi.waitFor(() => {
    const found = root.querySelector<T>(selector);
    if (!found) throw new Error(`no ${selector} yet`);
    return found;
  });
}

function figure(editor: Editor, index = 0) {
  const dom = editor.view.dom.querySelectorAll<HTMLElement>("figure.note-image")[index];
  return {
    dom,
    img: dom.querySelector("img") as HTMLImageElement,
    missing: dom.querySelector("p") as HTMLParagraphElement,
  };
}

function imagePosition(editor: Editor): number {
  let found = -1;
  editor.state.doc.descendants((node, position) => {
    if (node.type.name === "image" && found < 0) found = position;
  });
  return found;
}

function setImage(editor: Editor, attrs: Record<string, unknown>) {
  const position = imagePosition(editor);
  const node = editor.state.doc.nodeAt(position);
  editor.view.dispatch(editor.state.tr.setNodeMarkup(position, undefined, { ...node?.attrs, ...attrs }));
}

async function settle() {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function missingText(path: string): string {
  return enNotes.blocks.imageMissing.replace("{{path}}", path);
}

function videoTitle(figure: HTMLElement): string | null {
  const title = figure.querySelector<HTMLElement>("figcaption svg[role='img'] + span");
  return title && !title.hidden ? title.textContent : null;
}

describe("image views", () => {
  it("plays a YouTube or Vimeo link only after a click, through the app's own player page", async () => {
    const resolve = vi.fn<Resolve>();
    const editor = buildImages(resolve, image("https://youtu.be/dQw4w9WgXcQ?t=5"), image("https://vimeo.com/76979871/a1b2c3d4e5"));
    const [youtube, vimeo] = [...editor.view.dom.querySelectorAll<HTMLElement>("figure.note-media")];
    expect(youtube.dataset.media).toBe("embed");
    expect(vimeo.dataset.provider).toBe("vimeo");
    expect(editor.view.dom.querySelector("iframe")).toBeNull();
    const start = youtube.querySelector("button") as HTMLButtonElement;
    expect(start.getAttribute("aria-label")).toBe(enNotes.blocks.media.embed.replace("{{site}}", "YouTube"));
    start.click();
    const frame = await loaded<HTMLIFrameElement>(youtube, "iframe");
    expect(youtube.querySelector("figcaption")).toBeNull();
    expect(vimeo.querySelector("figcaption")).not.toBeNull();
    expect(frame.getAttribute("src")).toBe("http://127.0.0.1:4545/video#youtube/dQw4w9WgXcQ?start=5");
    expect(frame.title).toBe(enNotes.blocks.media.embedTitle.replace("{{site}}", "YouTube"));
    expect(frame.referrerPolicy).toBe("strict-origin-when-cross-origin");
    expect(frame.allow).toBe("autoplay; encrypted-media; fullscreen; picture-in-picture");
    expect(vimeo.querySelector("iframe")).toBeNull();
    (vimeo.querySelector("button") as HTMLButtonElement).click();
    expect((await loaded<HTMLIFrameElement>(vimeo, "iframe")).getAttribute("src")).toBe("http://127.0.0.1:4545/video#vimeo/76979871?h=a1b2c3d4e5");
    expect(resolve).not.toHaveBeenCalled();
  });

  it("names a video by its site's logo and offers Watch on the site, which leaves the poster in place", async () => {
    const editor = buildImages(vi.fn<Resolve>(), image("https://youtu.be/dQw4w9WgXcQ?t=5"), image("https://vimeo.com/76979871"));
    const [youtube, vimeo] = [...editor.view.dom.querySelectorAll<HTMLElement>("figure.note-media")];
    for (const [figure, site, colours, page] of [
      [youtube, "YouTube", ["#FF0000", "#FFFFFF"], "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=5"],
      [vimeo, "Vimeo", ["#1AB7EA"], "https://vimeo.com/76979871"],
    ] as const) {
      const bar = figure.querySelector("figcaption") as HTMLElement;
      const logo = within(bar).getByRole("img", { name: site });
      expect([...logo.querySelectorAll("path")].map((path) => path.getAttribute("fill"))).toEqual(colours);
      expect(bar.textContent).toBe(enNotes.blocks.media.watch);
      const watch = within(bar).getByRole("link", { name: enNotes.blocks.media.watchOn.replace("{{site}}", site) });
      expect(watch.textContent).toBe(enNotes.blocks.media.watch);
      expect(watch.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
      expect(watch.getAttribute("href")).toBe(page);
      expect(watch.getAttribute("target")).toBe("_blank");
      expect(watch.getAttribute("rel")).toBe("noopener noreferrer");
    }
    const watch = within(youtube).getByRole("link", { name: enNotes.blocks.media.watchOn.replace("{{site}}", "YouTube") });
    watch.addEventListener("click", (event) => event.preventDefault());
    watch.click();
    await settle();
    expect(youtube.querySelector("iframe")).toBeNull();
    expect((youtube.querySelector("button") as HTMLButtonElement).disabled).toBe(false);
    expect(youtube.querySelector("figcaption")).not.toBeNull();
  });

  it("plays through the provider's own player outside the desktop app", async () => {
    bridge.origin.mockRejectedValueOnce(new Error("not in the desktop app")).mockResolvedValueOnce("https://example.org");
    const editor = buildImages(vi.fn<Resolve>(), image("https://youtu.be/dQw4w9WgXcQ?t=5"), image("https://vimeo.com/76979871"));
    const [youtube, vimeo] = [...editor.view.dom.querySelectorAll<HTMLElement>("figure.note-media")];
    (youtube.querySelector("button") as HTMLButtonElement).click();
    expect((await loaded<HTMLIFrameElement>(youtube, "iframe")).getAttribute("src")).toBe(
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=5&autoplay=1",
    );
    (vimeo.querySelector("button") as HTMLButtonElement).click();
    expect((await loaded<HTMLIFrameElement>(vimeo, "iframe")).getAttribute("src")).toBe("https://player.vimeo.com/video/76979871?dnt=1&autoplay=1");
  });

  it("points to the video site instead of a player the app blocks when its player page is missing", async () => {
    Object.assign(globalThis, { isTauri: true });
    try {
      bridge.origin
        .mockRejectedValueOnce(new Error("could not start the video page server"))
        .mockResolvedValueOnce("https://example.org")
        .mockResolvedValueOnce("http://127.0.0.1:4545");
      const editor = buildImages(vi.fn<Resolve>(), image("https://youtu.be/dQw4w9WgXcQ?t=5"));
      const youtube = editor.view.dom.querySelector("figure.note-media") as HTMLElement;
      const start = youtube.querySelector("button") as HTMLButtonElement;
      const failed = youtube.querySelector("figure > p") as HTMLParagraphElement;
      expect(failed.hidden).toBe(true);
      for (let attempt = 0; attempt < 2; attempt += 1) {
        start.click();
        await vi.waitFor(() => expect(failed.hidden).toBe(false));
        expect(failed.textContent).toBe(enNotes.blocks.media.embedFailed.replace("{{site}}", "YouTube"));
        expect(youtube.querySelector("iframe")).toBeNull();
        expect(start.disabled).toBe(false);
      }
      expect(youtube.querySelector("figcaption a")?.getAttribute("href")).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=5");
      start.click();
      expect(failed.hidden).toBe(true);
      expect((await loaded<HTMLIFrameElement>(youtube, "iframe")).getAttribute("src")).toBe("http://127.0.0.1:4545/video#youtube/dQw4w9WgXcQ?start=5");
    } finally {
      Reflect.deleteProperty(globalThis, "isTauri");
    }
  });

  it("loads no picture from the video site until images from it are allowed", async () => {
    bridge.preview.mockResolvedValue({
      url: "https://vimeo.com/76979871",
      title: "Big Buck Bunny",
      description: null,
      siteName: "Vimeo",
      image: "https://i.vimeocdn.com/video/1.jpg",
      favicon: null,
    });
    const editor = buildImages(vi.fn<Resolve>(), image("https://youtu.be/dQw4w9WgXcQ", "Masking talk"), image("https://vimeo.com/76979871"));
    const [youtube, vimeo] = [...editor.view.dom.querySelectorAll<HTMLElement>("figure.note-media")];
    await settle();
    expect(editor.view.dom.querySelector("img")).toBeNull();
    expect(bridge.preview).not.toHaveBeenCalled();
    expect(videoTitle(youtube)).toBe("Masking talk");
    expect(videoTitle(vimeo)).toBeNull();
    expect(youtube.querySelector(".note-media-badge")).not.toBeNull();
    allowRemoteImage("https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg");
    expect((await loaded<HTMLImageElement>(youtube, "img.note-media-thumb")).getAttribute("src")).toBe(
      "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
    );
    expect(videoTitle(youtube)).toBe("Masking talk");
    expect(vimeo.querySelector("img")).toBeNull();
    allowRemoteImage("https://vimeo.com/76979871");
    expect((await loaded<HTMLImageElement>(vimeo, "img.note-media-thumb")).getAttribute("src")).toBe("https://i.vimeocdn.com/video/1.jpg");
    expect(bridge.preview).toHaveBeenCalledWith("https://vimeo.com/76979871");
    expect(videoTitle(vimeo)).toBe("Big Buck Bunny");
    allowRemoteImage("https://example.org/other.png");
    await settle();
    expect(bridge.preview).toHaveBeenCalledTimes(1);
  });

  it("offers to load a held video picture, the way it does for other web images", async () => {
    const editor = buildImages(vi.fn<Resolve>(), image("https://youtu.be/dQw4w9WgXcQ"));
    const embed = editor.view.dom.querySelector<HTMLElement>("figure.note-media") as HTMLElement;
    const held = await vi.waitFor(() => {
      const found = embed.querySelector<HTMLElement>("[data-remote-image]");
      if (!found) throw new Error("not drawn yet");
      return found;
    });
    expect(held.dataset.remoteImage).toBe("i.ytimg.com");
    (held.querySelector("button") as HTMLButtonElement).click();
    expect((await loaded<HTMLImageElement>(embed, "img.note-media-thumb")).getAttribute("src")).toBe(
      "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
    );
    expect(embed.querySelector(".note-remote-image")).toBeNull();
  });

  it("selects a video from a click on its caption, and leaves its controls to the person", async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockReturnValue(undefined);
    const editor = buildImages(vi.fn<Resolve>(async (path) => `blob:${path}`), image("https://youtu.be/dQw4w9WgXcQ"), image("assets/talk.mp4"));
    const embed = imageView(editor, 0);
    const caption = embed.dom.querySelector("figcaption") as HTMLElement;
    expect(embed.stopEvent?.(pressOn(caption.querySelector("span") as HTMLElement))).toBe(false);
    expect(embed.stopEvent?.(pressOn(within(caption).getByRole("img", { name: "YouTube" })))).toBe(false);
    expect(embed.stopEvent?.(pressOn(embed.dom))).toBe(false);
    expect(embed.stopEvent?.(pressOn(embed.dom.querySelector(".note-media-badge svg") as Element))).toBe(true);
    expect(embed.stopEvent?.(pressOn(caption.querySelector("a") as HTMLElement))).toBe(true);
    const video = imageView(editor, 1);
    const name = video.dom.querySelector("figcaption") as HTMLElement;
    expect(name.textContent).toBe("talk.mp4");
    expect(video.stopEvent?.(pressOn(name))).toBe(false);
    const start = video.dom.querySelector("button") as HTMLButtonElement;
    expect(video.stopEvent?.(pressOn(start))).toBe(true);
    start.click();
    expect(video.stopEvent?.(pressOn(await loaded(video.dom, "video")))).toBe(true);
    video.destroy?.();
    embed.destroy?.();
    editor.commands.clearContent();
    for (const spy of [play, pause]) spy.mockRestore();
  });

  it("plays audio and video only when asked, and frees the loaded file when the block goes", async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockReturnValue(undefined);
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockReturnValue(undefined);
    const resolve = vi.fn<Resolve>(async (path) => `blob:${path}`);
    const editor = buildImages(resolve, image("assets/talk.mp4"), image("assets/memo.m4a"));
    const [video, audio] = [...editor.view.dom.querySelectorAll<HTMLElement>("figure.note-media")];
    expect(video.dataset.media).toBe("video");
    expect(audio.dataset.media).toBe("audio");
    expect(editor.view.dom.querySelector("figure.note-image")).toBeNull();
    const start = video.querySelector("button") as HTMLButtonElement;
    expect(start.getAttribute("aria-label")).toBe(enNotes.blocks.media.play.replace("{{name}}", "talk.mp4"));
    expect(resolve).not.toHaveBeenCalled();
    start.click();
    const player = await vi.waitFor(() => {
      const found = video.querySelector("video");
      if (!found) throw new Error("not loaded yet");
      return found;
    });
    expect(resolve).toHaveBeenCalledWith("assets/talk.mp4");
    expect(player.getAttribute("src")).toBe("blob:assets/talk.mp4");
    expect(player.controls).toBe(true);
    expect(play).toHaveBeenCalledTimes(1);
    expect(audio.querySelector("audio")).toBeNull();
    editor.commands.clearContent();
    expect(pause).toHaveBeenCalled();
    expect(revoke).toHaveBeenCalledWith("blob:assets/talk.mp4");
    for (const spy of [play, pause, revoke]) spy.mockRestore();
  });

  it("says when a media file is missing, and names the PDF page it draws", async () => {
    const resolve = vi.fn<Resolve>(async (path) => (path.endsWith(".pdf#page=3") ? "data:image/png;base64,AAAA" : null));
    const editor = buildImages(resolve, image("assets/gone.mp3"), image("assets/paper.pdf#page=3"));
    const audio = editor.view.dom.querySelector<HTMLElement>("figure.note-media") as HTMLElement;
    (audio.querySelector("button") as HTMLButtonElement).click();
    await vi.waitFor(() => expect(audio.querySelector("p")?.hidden).toBe(false));
    expect(audio.querySelector("p")?.textContent).toBe(enNotes.blocks.media.missing.replace("{{path}}", "assets/gone.mp3"));
    const pdf = figure(editor);
    await vi.waitFor(() => expect(pdf.img.getAttribute("src")).toBe("data:image/png;base64,AAAA"));
    expect(resolve).toHaveBeenCalledWith("assets/paper.pdf#page=3");
    expect(pdf.dom.querySelector("figcaption")?.textContent).toBe("paper.pdf, page 3");
  });

  it("frees a file that finishes loading after its block is gone", async () => {
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockReturnValue(undefined);
    const lookup = deferred<string | null>();
    const editor = buildImages(vi.fn<Resolve>(() => lookup.promise), image("assets/talk.mp4"));
    (editor.view.dom.querySelector("figure.note-media button") as HTMLButtonElement).click();
    editor.commands.clearContent();
    lookup.resolve("blob:late");
    await vi.waitFor(() => expect(revoke).toHaveBeenCalledWith("blob:late"));
    revoke.mockRestore();
  });

  it("says when the computer can't play a file's format, and offers to show the file in its folder", async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockReturnValue(undefined);
    const reveal = vi.fn();
    const editor = buildMedia(vi.fn<Resolve>(async (path) => `blob:${path}`), { reveal }, image("assets/clip.ogv"));
    const video = editor.view.dom.querySelector<HTMLElement>("figure.note-media") as HTMLElement;
    (video.querySelector("button") as HTMLButtonElement).click();
    const player = await loaded<HTMLVideoElement>(video, "video");
    player.dispatchEvent(new Event("error"));
    expect(video.querySelector("video")).toBeNull();
    expect(revoke).toHaveBeenCalledWith("blob:assets/clip.ogv");
    const problem = video.querySelector("p") as HTMLElement;
    expect(problem.hidden).toBe(false);
    expect(problem.querySelector("span")?.textContent).toBe(enNotes.blocks.media.cantPlay.replace("{{name}}", "clip.ogv"));
    const folder = within(problem).getByRole("button", { name: enCore.export.showInFolder });
    folder.click();
    expect(reveal).toHaveBeenCalledWith("assets/clip.ogv");
    for (const spy of [play, revoke]) spy.mockRestore();
  });

  it("says the same when the player refuses the format before it starts", async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockRejectedValue(new DOMException("no decoder", "NotSupportedError"));
    const editor = buildImages(vi.fn<Resolve>(async (path) => `blob:${path}`), image("assets/memo.opus"));
    const audio = editor.view.dom.querySelector<HTMLElement>("figure.note-media") as HTMLElement;
    (audio.querySelector("button") as HTMLButtonElement).click();
    await vi.waitFor(() => expect(audio.querySelector("p")?.hidden).toBe(false));
    expect(audio.querySelector("audio")).toBeNull();
    expect(audio.querySelector("p")?.textContent).toBe(enNotes.blocks.media.cantPlay.replace("{{name}}", "memo.opus"));
    expect(audio.querySelector("p button")).toBeNull();
    play.mockRestore();
  });

  it("says a file that is there but can't be read couldn't be read, not that it is missing", async () => {
    const reveal = vi.fn();
    const editor = buildMedia(vi.fn<Resolve>(async () => Promise.reject(new Error("file exceeds the limit"))), { reveal }, image("assets/huge.wav"));
    const audio = editor.view.dom.querySelector<HTMLElement>("figure.note-media") as HTMLElement;
    const start = audio.querySelector("button") as HTMLButtonElement;
    start.click();
    await vi.waitFor(() => expect(audio.querySelector("p")?.hidden).toBe(false));
    expect(audio.querySelector("p span")?.textContent).toBe(enNotes.blocks.media.unreadable.replace("{{name}}", "huge.wav"));
    expect(start.disabled).toBe(false);
    within(audio.querySelector("p") as HTMLElement).getByRole("button", { name: enCore.export.showInFolder }).click();
    expect(reveal).toHaveBeenCalledWith("assets/huge.wav");
  });

  it("opens the whole PDF from under its page, or shows it in its folder where the note can't open it", async () => {
    const resolve = vi.fn<Resolve>(async () => "data:image/png;base64,AAAA");
    const open = vi.fn();
    const reveal = vi.fn();
    const opening = buildMedia(resolve, { open, reveal }, image("assets/paper.pdf#page=3"));
    const caption = figure(opening).dom.querySelector("figcaption") as HTMLElement;
    const button = within(caption).getByRole("button", { name: enNotes.blocks.media.openPdf });
    const view = imageView(opening);
    expect(view.stopEvent?.(pressOn(within(view.dom).getByRole("button", { name: enNotes.blocks.media.openPdf })))).toBe(true);
    expect(view.stopEvent?.(pressOn(view.dom.querySelector("figcaption span") as HTMLElement))).toBe(false);
    view.destroy?.();
    button.click();
    expect(open).toHaveBeenCalledWith("assets/paper.pdf#page=3");
    const revealing = buildMedia(resolve, { reveal }, image("assets/paper.pdf"));
    within(figure(revealing).dom.querySelector("figcaption") as HTMLElement).getByRole("button", { name: enCore.export.showInFolder }).click();
    expect(reveal).toHaveBeenCalledWith("assets/paper.pdf");
    expect(figure(buildImages(resolve, image("assets/plain.pdf"))).dom.querySelector("figcaption button")).toBeNull();
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("opens note files for the right note and says when that fails", async () => {
    useToastStore.setState({ toasts: [] });
    const data = { openAsset: vi.fn(async () => {}), revealAsset: vi.fn(async () => Promise.reject(new Error("folder gone"))) };
    const actions = noteAssetActions(data, "note-1");
    actions.open?.("assets/paper.pdf");
    expect(data.openAsset).toHaveBeenCalledWith("note-1", "assets/paper.pdf");
    actions.reveal?.("assets/talk.mp4");
    await vi.waitFor(() =>
      expect(useToastStore.getState().toasts.map((toast) => toast.message)).toEqual([
        enNotes.blocks.media.openFailed.replace("{{error}}", "folder gone"),
      ]),
    );
    expect(noteAssetActions({}, "note-1")).toEqual({ open: undefined, reveal: undefined });
  });

  it("resizes from the handle as a share of the column, keeps a click without a drag, and resets on double-click", async () => {
    const editor = buildImages(vi.fn<Resolve>(async () => "asset://plot.png"), image("assets/plot.png", "Plot"));
    await settle();
    const { dom } = figure(editor);
    const frame = dom.querySelector<HTMLElement>(".note-image-frame") as HTMLElement;
    const handle = dom.querySelector<HTMLElement>(".note-image-handle") as HTMLElement;
    Object.defineProperty(dom, "clientWidth", { configurable: true, value: 800 });
    frame.getBoundingClientRect = () => new DOMRect(0, 0, 400, 300);
    handle.setPointerCapture = () => undefined;
    const width = () => editor.state.doc.nodeAt(imagePosition(editor))?.attrs.widthPercent;
    const pointer = (type: string, clientX: number) => {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX });
      Object.defineProperty(event, "pointerId", { value: 1 });
      handle.dispatchEvent(event);
    };
    expect(handle.getAttribute("aria-hidden")).toBe("true");
    pointer("pointerdown", 400);
    pointer("pointerup", 400);
    expect(width()).toBeNull();
    pointer("pointerdown", 400);
    pointer("pointermove", 200);
    expect(frame.style.width).toBe("25%");
    pointer("pointerup", 200);
    expect(width()).toBe(25);
    pointer("pointerdown", 400);
    pointer("pointermove", -900);
    pointer("pointerup", -900);
    expect(width()).toBe(10);
    handle.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
    expect(width()).toBeNull();
    expect(frame.style.width).toBe("");
    expect(frame.hasAttribute("data-sized")).toBe(false);
  });

  it("draws a saved width and ignores the handle in a note that can't be edited", async () => {
    const editor = buildImages(vi.fn<Resolve>(async () => "asset://plot.png"), {
      type: "image",
      attrs: { src: "assets/plot.png", widthPercent: 40 },
    });
    await settle();
    const frame = figure(editor).dom.querySelector<HTMLElement>(".note-image-frame") as HTMLElement;
    expect(frame.style.width).toBe("40%");
    expect(frame.hasAttribute("data-sized")).toBe(true);
    editor.setEditable(false);
    const handle = figure(editor).dom.querySelector<HTMLElement>(".note-image-handle") as HTMLElement;
    handle.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
    expect(editor.state.doc.nodeAt(imagePosition(editor))?.attrs.widthPercent).toBe(40);
  });

  it("leaves extensions other than images untouched", () => {
    const resolve = vi.fn<Resolve>();
    const extension = Extension.create({ name: "imageless" });
    expect(withImageView(extension, resolve)).toBe(extension);
    const codeBlock = createWysiwygExtensions().find((item) => item.name === "codeBlock");
    expect(codeBlock && withImageView(codeBlock, resolve)).toBe(codeBlock);
  });

  it("holds a web image back until the person loads it, without looking for a file", async () => {
    const resolve = vi.fn<Resolve>();
    const editor = buildImages(resolve, image("https://example.org/loss.png", "Loss curve"), image("https://example.org/loss.png"));
    const { dom, img, missing } = figure(editor);
    expect(dom.tagName).toBe("FIGURE");
    expect(img.hasAttribute("src")).toBe(false);
    expect(img.hidden).toBe(true);
    expect(missing.hidden).toBe(true);
    const held = await vi.waitFor(() => {
      const found = dom.querySelector<HTMLElement>("[data-remote-image]");
      if (!found) throw new Error("not drawn yet");
      return found;
    });
    expect(held.dataset.remoteImage).toBe("example.org");
    expect(held.textContent).toContain(enCommon.remoteImage.blocked.replace("{{host}}", "example.org"));
    const load = held.querySelector("button") as HTMLButtonElement;
    expect(load.textContent).toBe(enCommon.remoteImage.load);
    load.click();
    expect(img.getAttribute("src")).toBe("https://example.org/loss.png");
    expect(img.alt).toBe("Loss curve");
    expect(img.draggable).toBe(false);
    expect(img.hidden).toBe(false);
    expect(dom.querySelector(".note-remote-image")).toBeNull();
    expect(figure(editor, 1).img.getAttribute("src")).toBe("https://example.org/loss.png");
    expect(missing.contentEditable).toBe("false");
    expect(resolve).not.toHaveBeenCalled();
  });

  it("shows an embedded image at once", () => {
    const resolve = vi.fn<Resolve>();
    const src = "data:image/png;base64,iVBORw0KGgo=";
    const { img } = figure(buildImages(resolve, image(src)));
    expect(img.getAttribute("src")).toBe(src);
    expect(img.alt).toBe("");
    expect(resolve).not.toHaveBeenCalled();
  });

  it("looks up a file next to the note and shows it once found", async () => {
    const lookup = deferred<string | null>();
    const resolve = vi.fn<Resolve>(() => lookup.promise);
    const editor = buildImages(resolve, image("./figures/loss%20curve.png", "Loss"));
    const { img, missing } = figure(editor);
    expect(resolve).toHaveBeenCalledWith("figures/loss curve.png");
    expect(img.hidden).toBe(true);
    expect(missing.hidden).toBe(true);
    lookup.resolve("blob:loss");
    await settle();
    expect(img.getAttribute("src")).toBe("blob:loss");
    expect(img.hidden).toBe(false);
    expect(missing.hidden).toBe(true);
  });

  it("says the image is missing when the file is not found", async () => {
    const editor = buildImages(vi.fn<Resolve>(async () => null), image("figures/gone.png"));
    await settle();
    const { img, missing } = figure(editor);
    expect(img.hidden).toBe(true);
    expect(img.hasAttribute("src")).toBe(false);
    expect(missing.hidden).toBe(false);
    expect(missing.textContent).toBe(missingText("figures/gone.png"));
  });

  it("says the image is missing when the file cannot be read", async () => {
    const editor = buildImages(
      vi.fn<Resolve>(async () => {
        throw new Error("denied");
      }),
      image("./figures/locked.png"),
    );
    await settle();
    expect(figure(editor).missing.textContent).toBe(missingText("./figures/locked.png"));
  });

  it.each(["/Users/me/loss.png", "file:///Users/me/loss.png", "http://example.org/loss.png"])(
    "refuses the image at %s without looking for it",
    (src) => {
      const resolve = vi.fn<Resolve>();
      const { img, missing } = figure(buildImages(resolve, image(src)));
      expect(resolve).not.toHaveBeenCalled();
      expect(img.hidden).toBe(true);
      expect(missing.hidden).toBe(false);
      expect(missing.textContent).toBe(missingText(src));
    },
  );

  it("says an image without a source is missing", () => {
    const resolve = vi.fn<Resolve>();
    const { missing } = figure(buildImages(resolve, image(null)));
    expect(resolve).not.toHaveBeenCalled();
    expect(missing.textContent).toBe(missingText(""));
  });

  it("shows the newest image when the source changes before the first one loads", async () => {
    const first = deferred<string | null>();
    const second = deferred<string | null>();
    const resolve = vi.fn<Resolve>().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const editor = buildImages(resolve, image("figures/a.png"));
    const view = figure(editor);
    setImage(editor, { src: "figures/b.png" });
    expect(figure(editor).dom).toBe(view.dom);
    expect(resolve).toHaveBeenLastCalledWith("figures/b.png");
    second.resolve("blob:b");
    await settle();
    first.resolve("blob:a");
    await settle();
    expect(view.img.getAttribute("src")).toBe("blob:b");
    expect(view.missing.hidden).toBe(true);
  });

  it("ignores a failed lookup for a source that was replaced", async () => {
    const first = deferred<string | null>();
    const resolve = vi.fn<Resolve>().mockReturnValueOnce(first.promise).mockResolvedValueOnce("blob:b");
    const editor = buildImages(resolve, image("figures/a.png"));
    setImage(editor, { src: "figures/b.png" });
    await settle();
    first.reject(new Error("denied"));
    await settle();
    const { img, missing } = figure(editor);
    expect(img.getAttribute("src")).toBe("blob:b");
    expect(img.hidden).toBe(false);
    expect(missing.hidden).toBe(true);
  });

  it("switches from a missing file to a web image the person already loaded", async () => {
    allowRemoteImage("https://example.org/found.png");
    const resolve = vi.fn<Resolve>(async () => null);
    const editor = buildImages(resolve, image("figures/gone.png"));
    await settle();
    setImage(editor, { src: "https://example.org/found.png" });
    const { img, missing } = figure(editor);
    expect(img.getAttribute("src")).toBe("https://example.org/found.png");
    expect(img.hidden).toBe(false);
    expect(missing.hidden).toBe(true);
  });

  it("says the image is missing once its source is cleared", () => {
    const resolve = vi.fn<Resolve>();
    const editor = buildImages(resolve, image("https://example.org/a.png", "A"));
    setImage(editor, { src: null });
    const { img, missing } = figure(editor);
    expect(img.hidden).toBe(true);
    expect(img.hasAttribute("src")).toBe(false);
    expect(missing.textContent).toBe(missingText(""));
    expect(resolve).not.toHaveBeenCalled();
  });

  it("updates the description without looking for the file again", async () => {
    const resolve = vi.fn<Resolve>(async () => "blob:loss");
    const editor = buildImages(resolve, image("figures/loss.png", "Loss"));
    await settle();
    setImage(editor, { alt: "Training loss" });
    const { img } = figure(editor);
    expect(img.alt).toBe("Training loss");
    expect(img.getAttribute("src")).toBe("blob:loss");
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it("ignores a lookup that finishes after the image is removed", async () => {
    const lookup = deferred<string | null>();
    const editor = buildImages(vi.fn<Resolve>(() => lookup.promise), image("figures/loss.png"), {
      type: "paragraph",
      content: [{ type: "text", text: "After" }],
    });
    const { img, missing } = figure(editor);
    const position = imagePosition(editor);
    editor.view.dispatch(editor.state.tr.delete(position, position + 1));
    expect(editor.view.dom.querySelector("figure.note-image")).toBeNull();
    lookup.resolve("blob:loss");
    await settle();
    expect(img.hasAttribute("src")).toBe(false);
    expect(img.hidden).toBe(true);
    expect(missing.hidden).toBe(true);
  });

  it("ignores a failed lookup that finishes after the image is removed", async () => {
    const lookup = deferred<string | null>();
    const editor = buildImages(vi.fn<Resolve>(() => lookup.promise), image("figures/loss.png"), {
      type: "paragraph",
      content: [{ type: "text", text: "After" }],
    });
    const { missing } = figure(editor);
    const position = imagePosition(editor);
    editor.view.dispatch(editor.state.tr.delete(position, position + 1));
    lookup.reject(new Error("denied"));
    await settle();
    expect(missing.hidden).toBe(true);
    expect(missing.textContent).toBe("");
  });

  it("gives up the view when the image turns into another kind of node", () => {
    const editor = buildImages(vi.fn<Resolve>(async () => null), image("https://example.org/a.png"));
    const create = editor.extensionManager.nodeViews.image;
    const nodeView = create(editor.state.doc.child(0), editor.view, () => 0, [], DecorationSet.empty);
    expect(nodeView.update?.(editor.schema.nodes.paragraph.create(), [], DecorationSet.empty)).toBe(false);
    expect(nodeView.update?.(editor.state.doc.child(0), [], DecorationSet.empty)).toBe(true);
  });
});

const NOTEBOOK = '{"nbformat": 4, "cells": []}';
const NOTEBOOK_URL = `data:application/x-ipynb+json;base64,${btoa(NOTEBOOK)}`;

function notebookCopy(key: keyof typeof enNotes.notebook, path = ""): string {
  return enNotes.notebook[key].replace("{{path}}", path);
}

function notebookPreview(editor: Editor): HTMLElement {
  return drawn(editor).querySelector(".note-drawn-preview") as HTMLElement;
}

describe("notebook views", () => {
  it("reads the notebook next to the note and draws it with the block's options", async () => {
    const resolve = vi.fn<Resolve>(async () => NOTEBOOK_URL);
    const editor = buildImages(resolve, codeBlock("notebook", "./assets/run.ipynb\ncells: 2-3\ncode: hide"));
    const dom = drawn(editor);
    expect(dom.dataset.block).toBe("notebook");
    expect(dom.querySelector(".note-drawn-label")?.textContent).toBe(enNotes.notebook.label);
    expect(notebookPreview(editor).textContent).toBe(enNotes.notebook.loading);
    expect(resolve).toHaveBeenCalledWith("assets/run.ipynb");
    await vi.waitFor(() => expect(notebooks.render).toHaveBeenCalled());
    expect(notebooks.render).toHaveBeenCalledWith({ text: NOTEBOOK, cells: { from: 2, to: 3 }, hideCode: true });
    expect(notebooks.hosts[0]).toHaveClass("note-notebook");
    expect(notebookPreview(editor).firstElementChild).toBe(notebooks.hosts[0]);
    expect(editor.getJSON().content?.[0]).toEqual(codeBlock("notebook", "./assets/run.ipynb\ncells: 2-3\ncode: hide"));
  });

  it("says the notebook is missing when the file is not found", async () => {
    const editor = buildImages(vi.fn<Resolve>(async () => null), codeBlock("notebook", "assets/gone.ipynb"));
    await vi.waitFor(() => expect(notebookPreview(editor).textContent).toBe(notebookCopy("missing", "assets/gone.ipynb")));
    expect(notebooks.render).not.toHaveBeenCalled();
  });

  it("says the notebook is missing when the editor cannot read note files", () => {
    const editor = build(codeBlock("notebook", "assets/run.ipynb"));
    expect(notebookPreview(editor).textContent).toBe(notebookCopy("missing", "assets/run.ipynb"));
  });

  it.each([
    ["../outside.ipynb", "badPath"],
    ["/Users/me/run.ipynb", "badPath"],
    ["assets/run.ipynb\ncells: 9-2", "badCells"],
  ] as const)("explains what is wrong with %j without reading anything", (source, key) => {
    const resolve = vi.fn<Resolve>();
    const editor = buildImages(resolve, codeBlock("notebook", source));
    expect(notebookPreview(editor).textContent).toBe(enNotes.notebook[key]);
    expect(resolve).not.toHaveBeenCalled();
  });

  it("says a notebook over 64 MiB is too large to show", async () => {
    const editor = buildImages(vi.fn<Resolve>(async () => Promise.reject(new NotebookTooLargeError())), codeBlock("notebook", "big.ipynb"));
    await vi.waitFor(() => expect(notebookPreview(editor).textContent).toBe(enNotes.notebook.tooLarge));
  });

  it.each([
    ["the read fails", () => Promise.reject(new Error("denied"))],
    ["the file comes back as a web address", async () => "blob:notebook"],
  ])("says the notebook could not be read when %s", async (_case, read) => {
    const editor = buildImages(vi.fn<Resolve>(read), codeBlock("notebook", "assets/run.ipynb"));
    await vi.waitFor(() => expect(notebookPreview(editor).textContent).toBe(notebookCopy("unreadable", "assets/run.ipynb")));
  });

  it("reads again when the block changes and drops the read it replaced", async () => {
    const first = deferred<string | null>();
    const resolve = vi.fn<Resolve>().mockReturnValueOnce(first.promise).mockResolvedValue(NOTEBOOK_URL);
    const editor = buildImages(resolve, codeBlock("notebook", "one.ipynb"));
    replaceCode(editor, "two.ipynb");
    await vi.waitFor(() => expect(resolve).toHaveBeenLastCalledWith("two.ipynb"));
    await vi.waitFor(() => expect(notebooks.render).toHaveBeenCalledTimes(1));
    first.resolve(NOTEBOOK_URL);
    await settle();
    expect(notebooks.render).toHaveBeenCalledTimes(1);
    replaceCode(editor, "two.ipynb\ncode: hide");
    await vi.waitFor(() => expect(notebooks.unmount).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(notebooks.render).toHaveBeenLastCalledWith({ text: NOTEBOOK, cells: null, hideCode: true }));
  });

  it("ignores a missing file or failed read that finishes after the block changed", async () => {
    const gone = deferred<string | null>();
    const failed = deferred<string | null>();
    const resolve = vi
      .fn<Resolve>()
      .mockReturnValueOnce(gone.promise)
      .mockReturnValueOnce(failed.promise)
      .mockResolvedValue(NOTEBOOK_URL);
    const editor = buildImages(resolve, codeBlock("notebook", "one.ipynb"));
    replaceCode(editor, "two.ipynb");
    await vi.waitFor(() => expect(resolve).toHaveBeenLastCalledWith("two.ipynb"));
    replaceCode(editor, "three.ipynb");
    await vi.waitFor(() => expect(resolve).toHaveBeenLastCalledWith("three.ipynb"));
    await vi.waitFor(() => expect(notebooks.render).toHaveBeenCalledTimes(1));
    gone.resolve(null);
    failed.reject(new Error("late"));
    await settle();
    expect(notebookPreview(editor).firstElementChild).toBe(notebooks.hosts[0]);
  });

  it("skips the sources typed between two pauses", async () => {
    const resolve = vi.fn<Resolve>(async () => NOTEBOOK_URL);
    const editor = buildImages(resolve, codeBlock("notebook", "one.ipynb"));
    replaceCode(editor, "two.ipynb");
    replaceCode(editor, "three.ipynb");
    await vi.waitFor(() => expect(resolve).toHaveBeenCalledTimes(2));
    expect(resolve.mock.calls.map(([path]) => path)).toEqual(["one.ipynb", "three.ipynb"]);
  });

  it("unmounts the notebook when the block is removed", async () => {
    const editor = buildImages(vi.fn<Resolve>(async () => NOTEBOOK_URL), codeBlock("notebook", "run.ipynb"));
    await vi.waitFor(() => expect(notebooks.render).toHaveBeenCalled());
    editor.commands.setContent({ type: "doc", content: [{ type: "paragraph" }] });
    expect(notebooks.unmount).toHaveBeenCalledTimes(1);
  });

  it("keeps clicks and keys inside the drawn notebook away from the editor", () => {
    const editor = buildImages(vi.fn<Resolve>(async () => null), codeBlock("notebook", "run.ipynb"));
    const view = codeBlockView(editor);
    const inside = document.createElement("button");
    (view.dom as HTMLElement).querySelector(".note-drawn-preview")?.append(inside);
    expect(view.stopEvent?.({ target: inside } as unknown as Event)).toBe(true);
    const toggle = within(view.dom as HTMLElement).getByRole("button", { name: enNotes.blocks.source });
    expect(view.stopEvent?.({ target: toggle } as unknown as Event)).toBe(true);
    view.destroy?.();
  });

  it("lets the editor handle events in the drawing of other blocks, but not on their buttons", () => {
    mocks.renderDiagram.mockReturnValue(new Promise(() => {}));
    const view = codeBlockView(build(codeBlock("mermaid", "flowchart LR\n  A --> B")));
    const preview = (view.dom as HTMLElement).querySelector(".note-drawn-preview");
    expect(view.stopEvent?.({ target: preview } as unknown as Event)).toBe(false);
    const toggle = within(view.dom as HTMLElement).getByRole("button", { name: enNotes.blocks.source });
    expect(view.stopEvent?.({ target: toggle } as unknown as Event)).toBe(true);
  });
});
