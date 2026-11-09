// @vitest-environment jsdom
import { Editor, Extension, type JSONContent } from "@tiptap/core";
import { createWysiwygExtensions } from "@oleafly/wysiwyg";
import { DecorationSet } from "@tiptap/pm/view";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadNamespace } from "@/i18n";
import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import { BLOCK_REPAINT_MS, withBlockViews, withImageView } from "./block-views";
import { allowRemoteImage, forgetRemoteImages } from "./note-remote-images";
import { NotebookTooLargeError } from "./notebook-block";

const mocks = vi.hoisted(() => ({ renderDiagram: vi.fn() }));

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
  await loadNamespace("notes");
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
  forgetRemoteImages();
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

  it("says Typst previews need the desktop app outside it", () => {
    const editor = build(codeBlock("{=typst}", "$ E = m c^2 $"));
    const dom = drawn(editor);
    expect(dom.dataset.block).toBe("typst");
    expect(dom.querySelector(".note-drawn-label")?.textContent).toBe("Typst");
    expect(dom.querySelector(".note-drawn-preview")?.textContent).toBe(enNotes.blocks.typst.desktopOnly);
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

type Resolve = (path: string) => Promise<string | null>;

function deferred<T>() {
  const handlers = { resolve: (_value: T) => {}, reject: (_reason: unknown) => {} };
  const promise = new Promise<T>((resolve, reject) => {
    handlers.resolve = resolve;
    handlers.reject = reject;
  });
  return { promise, ...handlers };
}

function image(src: string | null, alt?: string): JSONContent {
  return { type: "image", attrs: alt === undefined ? { src } : { src, alt } };
}

function buildImages(resolve: Resolve, ...content: JSONContent[]): Editor {
  const extensions = createWysiwygExtensions()
    .map(withBlockViews)
    .map((extension) => withImageView(extension, resolve));
  return buildWith(extensions, content);
}

function figure(editor: Editor, index = 0) {
  const dom = editor.view.dom.querySelectorAll<HTMLElement>("figure.note-image")[index];
  return {
    dom,
    img: dom.querySelector("img") as HTMLImageElement,
    missing: dom.querySelector("p.note-drawn-empty") as HTMLParagraphElement,
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

async function repainted() {
  await new Promise<void>((resolve) => setTimeout(resolve, BLOCK_REPAINT_MS + 10));
}

function missingText(path: string): string {
  return enNotes.blocks.imageMissing.replace("{{path}}", path);
}

describe("image views", () => {
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
    await repainted();
    expect(resolve).toHaveBeenLastCalledWith("two.ipynb");
    await vi.waitFor(() => expect(notebooks.render).toHaveBeenCalledTimes(1));
    first.resolve(NOTEBOOK_URL);
    await settle();
    expect(notebooks.render).toHaveBeenCalledTimes(1);
    replaceCode(editor, "two.ipynb\ncode: hide");
    await repainted();
    expect(notebooks.unmount).toHaveBeenCalledTimes(1);
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
    await repainted();
    replaceCode(editor, "three.ipynb");
    await repainted();
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
    await repainted();
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
    const toggle = (view.dom as HTMLElement).querySelector(".note-drawn-toggle");
    expect(view.stopEvent?.({ target: toggle } as unknown as Event)).toBe(false);
    view.destroy?.();
  });

  it("lets the editor handle events in other drawn blocks", () => {
    mocks.renderDiagram.mockReturnValue(new Promise(() => {}));
    const editor = build(codeBlock("mermaid", "flowchart LR\n  A --> B"));
    expect(codeBlockView(editor).stopEvent).toBeUndefined();
  });
});
