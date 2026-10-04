// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/core";
import { StarterKit } from "@tiptap/starter-kit";
import { setWysiwygTranslator } from "./messages";
import { RawBlock } from "./raw-block";

describe("RawBlock", () => {
  it("round-trips through getJSON/setContent with its source attr intact", () => {
    const editor = new Editor({
      element: document.createElement("div"),
      extensions: [StarterKit.configure({ codeBlock: false, horizontalRule: false }), RawBlock],
      content: { type: "doc", content: [{ type: "rawBlock", attrs: { source: "\\foo{bar}" } }] },
    });
    const json = editor.getJSON();
    expect(json.content?.[0]).toMatchObject({ type: "rawBlock", attrs: { source: "\\foo{bar}" } });
    editor.destroy();
  });

  it("preserves special characters through getJSON without DOM escaping corruption", () => {
    const source = "<script>&amp;\nline one\n\nline three";
    const editor = new Editor({
      element: document.createElement("div"),
      extensions: [StarterKit.configure({ codeBlock: false, horizontalRule: false }), RawBlock],
      content: { type: "doc", content: [{ type: "rawBlock", attrs: { source } }] },
    });
    const json = editor.getJSON();
    expect(json.content?.[0]?.attrs?.source).toBe(source);
    editor.destroy();
  });

  it("preserves special characters through a render-to-HTML and reparse round trip", () => {
    const source = 'line1\nline2\n\nline3 <x> & "quotes" \'single\'';
    const editor = new Editor({
      element: document.createElement("div"),
      extensions: [StarterKit.configure({ codeBlock: false, horizontalRule: false }), RawBlock],
      content: { type: "doc", content: [{ type: "rawBlock", attrs: { source } }] },
    });
    const html = editor.getHTML();
    editor.destroy();

    const reparsed = new Editor({
      element: document.createElement("div"),
      extensions: [StarterKit.configure({ codeBlock: false, horizontalRule: false }), RawBlock],
      content: html,
    });
    const json = reparsed.getJSON();
    expect(json.content?.[0]?.attrs?.source).toBe(source);
    reparsed.destroy();
  });
});

function mountBlock(source: string, handleKeyDown: (view: unknown, event: KeyboardEvent) => boolean = () => false) {
  const element = document.createElement("div");
  document.body.append(element);
  const editor = new Editor({
    element,
    editorProps: { handleKeyDown },
    extensions: [StarterKit.configure({ codeBlock: false, horizontalRule: false }), RawBlock],
    content: {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Intro" }] },
        { type: "rawBlock", attrs: { source } },
      ],
    },
  });
  const block = element.querySelector<HTMLElement>('[data-type="raw-block"]') as HTMLElement;
  const blockPos = editor.state.doc.child(0).nodeSize;
  const parts = {
    label: () => block.querySelector(".raw-block-label")?.textContent,
    preview: () => block.querySelector(".raw-block-preview")?.textContent,
    summary: () => block.querySelector<HTMLElement>(".raw-block-summary") as HTMLElement,
    editButton: () => block.querySelector<HTMLButtonElement>(".raw-block-edit") as HTMLButtonElement,
    input: () => block.querySelector<HTMLTextAreaElement>(".raw-block-input"),
    source: () => editor.state.doc.nodeAt(blockPos)?.attrs.source as string | undefined,
  };
  const teardown = () => {
    editor.destroy();
    element.remove();
  };
  return { editor, element, block, blockPos, teardown, ...parts };
}

function key(target: EventTarget, init: KeyboardEventInit) {
  target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
}

describe("RawBlock node view", () => {
  beforeEach(() => {
    setWysiwygTranslator((messageKey, params) =>
      params ? `${messageKey}(${Object.values(params).join(",")})` : messageKey,
    );
  });

  afterEach(() => {
    setWysiwygTranslator(null);
    document.body.innerHTML = "";
  });

  it("summarises the source with a label, a preview and an edit button", () => {
    const view = mountBlock(String.raw`\title{On Graphs}`);

    expect(view.label()).toBe("block.title");
    expect(view.preview()).toBe("On Graphs");
    expect(view.block).toHaveAttribute("aria-label", "block.summaryLabel(block.title)");
    expect(view.editButton()).toHaveTextContent("block.editSource");
    expect(view.input()).toBeNull();
    view.teardown();
  });

  it("opens the exact source for editing, sized to its lines within bounds", () => {
    const view = mountBlock(String.raw`\title{On Graphs}`);

    view.editButton().click();
    const input = view.input() as HTMLTextAreaElement;

    expect(input.value).toBe(String.raw`\title{On Graphs}`);
    expect(input.rows).toBe(3);
    expect(input).toHaveAttribute("aria-label", "block.inputLabel");
    expect(input.spellcheck).toBe(false);
    expect(view.summary().hidden).toBe(true);
    expect(document.activeElement).toBe(input);
    view.teardown();

    const tall = mountBlock(Array.from({ length: 20 }, (_, index) => `line ${index}`).join("\r\n"));
    tall.editButton().click();
    expect(tall.input()?.rows).toBe(14);
    tall.teardown();

    const medium = mountBlock("a\nb\nc\nd\ne");
    medium.editButton().click();
    expect(medium.input()?.rows).toBe(5);
    medium.teardown();
  });

  it("opens only one source box when edit is pressed twice", () => {
    const view = mountBlock(String.raw`\title{On Graphs}`);

    view.editButton().click();
    view.editButton().click();

    expect(view.block.querySelectorAll(".raw-block-input")).toHaveLength(1);
    view.teardown();
  });

  it.each([{ ctrlKey: true }, { metaKey: true }])("commits the edit with %o + Enter", (modifier) => {
    const view = mountBlock(String.raw`\title{On Graphs}`);
    view.editButton().click();
    const input = view.input() as HTMLTextAreaElement;

    input.value = String.raw`\author{Ada}`;
    key(input, { key: "Enter", ...modifier });

    expect(view.source()).toBe(String.raw`\author{Ada}`);
    expect(view.input()).toBeNull();
    expect(view.summary().hidden).toBe(false);
    expect(view.label()).toBe("block.author");
    expect(view.preview()).toBe("Ada");
    view.teardown();
  });

  it("treats a plain Enter as a newline in the source", () => {
    const view = mountBlock(String.raw`\title{On Graphs}`);
    view.editButton().click();
    const input = view.input() as HTMLTextAreaElement;

    input.value = "changed";
    key(input, { key: "Enter" });

    expect(view.input()).toBe(input);
    expect(view.source()).toBe(String.raw`\title{On Graphs}`);
    view.teardown();
  });

  it("discards the edit on Escape", () => {
    const view = mountBlock(String.raw`\title{On Graphs}`);
    view.editButton().click();
    const input = view.input() as HTMLTextAreaElement;

    input.value = "discarded";
    key(input, { key: "Escape" });
    input.dispatchEvent(new FocusEvent("blur"));

    expect(view.source()).toBe(String.raw`\title{On Graphs}`);
    expect(view.input()).toBeNull();
    expect(view.summary().hidden).toBe(false);
    view.teardown();
  });

  it("commits the edit when the source box loses focus", () => {
    const view = mountBlock(String.raw`\title{On Graphs}`);
    view.editButton().click();
    const input = view.input() as HTMLTextAreaElement;

    input.value = String.raw`\date{2026}`;
    input.blur();

    expect(view.source()).toBe(String.raw`\date{2026}`);
    expect(view.label()).toBe("block.date");
    expect(view.input()).toBeNull();
    view.teardown();
  });

  it("leaves the document untouched when the source did not change", () => {
    const view = mountBlock(String.raw`\title{On Graphs}`);
    const docChanges = vi.fn();
    view.editor.on("transaction", ({ transaction }) => {
      if (transaction.docChanged) docChanges();
    });
    view.editButton().click();

    key(view.input() as HTMLTextAreaElement, { key: "Enter", ctrlKey: true });

    expect(docChanges).not.toHaveBeenCalled();
    expect(view.input()).toBeNull();
    view.teardown();
  });

  it("ignores Escape and the commit chord while an input method is composing", () => {
    const view = mountBlock(String.raw`\title{On Graphs}`);
    view.editButton().click();
    const input = view.input() as HTMLTextAreaElement;
    input.value = "composed";

    input.dispatchEvent(new CompositionEvent("compositionstart"));
    key(input, { key: "Escape" });
    key(input, { key: "Enter", ctrlKey: true });
    expect(view.input()).toBe(input);
    expect(view.source()).toBe(String.raw`\title{On Graphs}`);

    input.dispatchEvent(new CompositionEvent("compositionend"));
    key(input, { key: "Enter", ctrlKey: true });
    expect(view.source()).toBe("composed");
    view.teardown();
  });

  it("follows source changes made elsewhere, but not while being edited", () => {
    const view = mountBlock(String.raw`\title{On Graphs}`);
    const setSource = (source: string) =>
      view.editor.view.dispatch(view.editor.state.tr.setNodeMarkup(view.blockPos, undefined, { source }));

    setSource(String.raw`\author{Ada}`);
    expect(view.label()).toBe("block.author");

    view.editButton().click();
    setSource(String.raw`\date{2026}`);
    expect(view.label()).toBe("block.author");
    expect(view.input()?.value).toBe(String.raw`\author{Ada}`);

    key(view.input() as HTMLTextAreaElement, { key: "Escape" });
    expect(view.label()).toBe("block.date");
    view.teardown();
  });

  it("shows and clears the selected state", () => {
    const view = mountBlock(String.raw`\title{On Graphs}`);

    view.editor.commands.setNodeSelection(view.blockPos);
    expect(view.block).toHaveClass("ProseMirror-selectednode");

    view.editor.commands.setTextSelection(1);
    expect(view.block).not.toHaveClass("ProseMirror-selectednode");
    view.teardown();
  });

  it("keeps keystrokes in the source box away from the editor's key handling", () => {
    const handleKeyDown = vi.fn((_view: unknown, _event: KeyboardEvent) => false);
    const view = mountBlock(String.raw`\title{On Graphs}`, handleKeyDown);
    view.editButton().click();

    key(view.input() as HTMLTextAreaElement, { key: "a" });
    key(view.editButton(), { key: "a" });
    expect(handleKeyDown).not.toHaveBeenCalled();

    key(view.block.querySelector(".raw-block-preview") as HTMLElement, { key: "b" });
    key(view.block.querySelector(".raw-block-label")?.firstChild as Node, { key: "c" });
    expect(handleKeyDown.mock.calls.map(([, event]) => event.key)).toEqual(["b", "c"]);
    view.teardown();
  });

  it("keeps its source box through the editor's DOM observation", async () => {
    const view = mountBlock(String.raw`\title{On Graphs}`);
    view.editButton().click();
    const input = view.input();

    await Promise.resolve();

    expect(view.input()).toBe(input);
    expect(view.source()).toBe(String.raw`\title{On Graphs}`);
    view.teardown();
  });

  it("drops a pending edit whose block was deleted meanwhile", () => {
    const view = mountBlock(String.raw`\title{On Graphs}`);
    view.editButton().click();
    const input = view.input() as HTMLTextAreaElement;
    input.value = "orphaned";

    view.editor.commands.setContent({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Replaced" }] }],
    });
    input.dispatchEvent(new FocusEvent("blur"));

    expect(view.editor.getText()).toBe("Replaced");
    expect(JSON.stringify(view.editor.getJSON())).not.toContain("orphaned");
    view.teardown();
  });

  it("stops listening to its edit button once destroyed", () => {
    const view = mountBlock(String.raw`\title{On Graphs}`);
    const { block } = view;
    const button = view.editButton();
    view.teardown();

    button.click();

    expect(block.querySelector(".raw-block-input")).toBeNull();
  });
});
