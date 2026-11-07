// @vitest-environment jsdom
import { Editor, Extension, type JSONContent } from "@tiptap/core";
import { createWysiwygExtensions } from "@oleafly/wysiwyg";
import { DecorationSet } from "@tiptap/pm/view";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadNamespace } from "@/i18n";
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import { withBlockViews } from "./block-views";

const mocks = vi.hoisted(() => ({ renderDiagram: vi.fn() }));

vi.mock("@/components/ui/mermaid-diagram", () => ({ renderDiagram: mocks.renderDiagram }));

const CHART = JSON.stringify({ title: "Validation", categories: ["Run 1", "Run 2"], series: [{ name: "A", values: [61, 64] }] });

let editors: Editor[] = [];

function codeBlock(language: string | null, text: string): JSONContent {
  return { type: "codeBlock", attrs: { language }, content: [{ type: "text", text }] };
}

function build(...content: JSONContent[]): Editor {
  const element = document.createElement("div");
  document.body.append(element);
  const editor = new Editor({
    element,
    extensions: createWysiwygExtensions().map(withBlockViews),
    content: { type: "doc", content },
  });
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
  await loadNamespace("notes");
  const rect = new DOMRect(0, 0, 0, 0);
  Range.prototype.getClientRects = () => [rect] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => rect;
});

beforeEach(() => {
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
});

describe("drawn block views", () => {
  it("leaves extensions other than code blocks untouched", () => {
    const extension = Extension.create({ name: "codeBlockless" });
    expect(withBlockViews(extension)).toBe(extension);
    const paragraph = createWysiwygExtensions().find((item) => item.name === "paragraph");
    expect(paragraph && withBlockViews(paragraph)).toBe(paragraph);
  });

  it.each([
    ["python", "print(1)"],
    [null, "plain"],
  ])("shows a %s fence as plain code", (language, text) => {
    const editor = build(codeBlock(language, text));
    const dom = drawn(editor);
    expect(dom).not.toHaveClass("note-drawn");
    expect(dom.querySelector("button")).toBeNull();
    expect(dom.querySelector("pre > code")?.textContent).toBe(text);
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
    expect(preview.querySelector("p")).toHaveClass("note-drawn-empty");
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

  it("explains that Typst has no preview yet", () => {
    const editor = build(codeBlock("{=typst}", "$ E = m c^2 $"));
    const dom = drawn(editor);
    expect(dom.dataset.block).toBe("typst");
    expect(dom.querySelector(".note-drawn-label")?.textContent).toBe("Typst");
    expect(dom.querySelector(".note-drawn-preview")?.textContent).toBe(enNotes.blocks.noPreview);
  });

  it("switches between the preview and the source with a pressed toggle", () => {
    const editor = build(codeBlock("{=typst}", "$ x $"));
    const dom = drawn(editor);
    const toggle = dom.querySelector("button") as HTMLButtonElement;
    expect(toggle.type).toBe("button");
    expect(toggle.contentEditable).toBe("false");
    expect(toggle.textContent).toBe(enNotes.blocks.source);
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

  it("repaints only when the block's text changes", () => {
    const editor = build(codeBlock("mermaid", "flowchart LR\n  A --> B"), { type: "paragraph", content: [{ type: "text", text: "After" }] });
    const dom = drawn(editor);
    expect(mocks.renderDiagram).toHaveBeenCalledTimes(1);

    editor.view.dispatch(editor.state.tr.insertText("!", editor.state.doc.content.size - 1));
    expect(drawn(editor)).toBe(dom);
    expect(mocks.renderDiagram).toHaveBeenCalledTimes(1);

    editor.view.dispatch(editor.state.tr.setNodeMarkup(codeBlockPosition(editor), undefined, { language: "mermaid" }));
    expect(mocks.renderDiagram).toHaveBeenCalledTimes(1);

    replaceCode(editor, "flowchart LR\n  A --> C");
    expect(drawn(editor)).toBe(dom);
    expect(mocks.renderDiagram).toHaveBeenCalledTimes(2);
    expect(mocks.renderDiagram).toHaveBeenLastCalledWith("flowchart LR\n  A --> C", "light");
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
