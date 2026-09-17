// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { Editor, type JSONContent } from "@tiptap/core";
import type { MathRenderPort, WysiwygExtensionOptions } from "../options";
import { createWysiwygExtensions } from "../schema";
import { paintMath } from "./nodes";

const renderMath: MathRenderPort = (body, display) =>
  body.includes("bad")
    ? { status: "error", html: "", message: "nope" }
    : { status: "ready", html: `<span class="katex">${display ? "D" : "I"}:${body}</span>` };

let editors: Editor[] = [];

function mount(content: JSONContent, options: WysiwygExtensionOptions = { renderMath }): { editor: Editor; element: HTMLElement } {
  const element = document.createElement("div");
  document.body.append(element);
  const editor = new Editor({ element, extensions: createWysiwygExtensions(options), content });
  editors.push(editor);
  return { editor, element };
}

function inlineDoc(source: string): JSONContent {
  return { type: "doc", content: [{ type: "paragraph", content: [{ type: "mathInline", attrs: { source } }] }] };
}

afterEach(() => {
  for (const editor of editors) editor.destroy();
  editors = [];
  document.body.replaceChildren();
});

describe("math nodes", () => {
  it("renders inline math through the renderer port in inline mode", () => {
    const { element } = mount(inlineDoc("$x$"));
    const node = element.querySelector<HTMLElement>('[data-type="math-inline"]');
    expect(node?.dataset.mathKind).toBe("inline");
    expect(node?.querySelector(".math-rendered .katex")).toHaveTextContent("I:x");
  });

  it("renders display math nodes in display mode and passes environments intact", () => {
    const { element } = mount({
      type: "doc",
      content: [
        { type: "mathDisplay", attrs: { source: "\\[y\\]" } },
        { type: "mathDisplay", attrs: { source: "\\begin{align}a\\end{align}" } },
      ],
    });
    const nodes = element.querySelectorAll<HTMLElement>('[data-type="math-display"]');
    expect(nodes[0].dataset.mathKind).toBe("display");
    expect(nodes[0].querySelector(".katex")).toHaveTextContent("D:y");
    expect(nodes[1].querySelector(".katex")).toHaveTextContent("D:\\begin{align}a\\end{align}");
  });

  it("renders display delimiters inline as display mode inside inline nodes", () => {
    const { element } = mount(inlineDoc("$$z$$"));
    const node = element.querySelector<HTMLElement>('[data-type="math-inline"]');
    expect(node?.dataset.mathKind).toBe("display");
    expect(node?.querySelector(".katex")).toHaveTextContent("D:z");
  });

  it("shows the source and the message when rendering fails", () => {
    const { element } = mount(inlineDoc("$bad$"));
    const rendered = element.querySelector(".math-rendered");
    expect(rendered).toHaveClass("is-error");
    expect(rendered?.querySelector(".math-source")).toHaveTextContent("$bad$");
    expect(rendered?.querySelector(".math-error")).toHaveTextContent("nope");
  });

  it("shows the exact source unrendered without a renderer or with unparsable delimiters", () => {
    const { element } = mount(inlineDoc("$x$"), {});
    expect(element.querySelector(".math-rendered")).toHaveClass("is-unrendered");
    expect(element.querySelector(".math-source")).toHaveTextContent("$x$");
    const target = document.createElement("span");
    paintMath(target, "broken", renderMath);
    expect(target).toHaveClass("is-error");
    expect(target.querySelector(".math-source")).toHaveTextContent("broken");
  });

  it("edits in place with a live preview and commits on Mod-Enter", () => {
    const { editor, element } = mount(inlineDoc("$x$"));
    element.querySelector<HTMLElement>(".math-rendered")?.click();
    const node = element.querySelector<HTMLElement>('[data-type="math-inline"]');
    const input = node?.querySelector<HTMLInputElement>("input.math-input");
    expect(node?.dataset.mathEditing).toBe("true");
    expect(input?.value).toBe("$x$");
    expect(input).toBe(document.activeElement);
    if (!input) throw new Error("input missing");
    input.value = "$z$";
    input.dispatchEvent(new Event("input"));
    expect(node?.querySelector(".math-live-preview .katex")).toHaveTextContent("I:z");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }));
    expect((editor.getJSON() as JSONContent).content?.[0].content?.[0].attrs?.source).toBe("$z$");
    expect(node?.querySelector(".math-input")).toBeNull();
    expect(node?.querySelector(".math-rendered .katex")).toHaveTextContent("I:z");
  });

  it("cancels on Escape without changing the source", () => {
    const { editor, element } = mount(inlineDoc("$x$"));
    element.querySelector<HTMLElement>(".math-rendered")?.click();
    const input = element.querySelector<HTMLInputElement>(".math-input");
    if (!input) throw new Error("input missing");
    input.value = "$changed$";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect((editor.getJSON() as JSONContent).content?.[0].content?.[0].attrs?.source).toBe("$x$");
    expect(element.querySelector(".math-input")).toBeNull();
  });

  it("commits on blur and uses a textarea for display math", () => {
    const { editor, element } = mount({ type: "doc", content: [{ type: "mathDisplay", attrs: { source: "\\[y\\]" } }] });
    element.querySelector<HTMLElement>(".math-rendered")?.click();
    const input = element.querySelector<HTMLTextAreaElement>("textarea.math-input");
    if (!input) throw new Error("textarea missing");
    input.value = "\\[y+1\\]";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(element.querySelector(".math-input")).not.toBeNull();
    input.dispatchEvent(new FocusEvent("blur"));
    expect((editor.getJSON() as JSONContent).content?.[0].attrs?.source).toBe("\\[y+1\\]");
  });

  it("opens the editor with Enter when the node is selected", () => {
    const { editor, element } = mount(inlineDoc("$x$"));
    editor.commands.setNodeSelection(1);
    expect(editor.commands.keyboardShortcut("Enter")).toBe(true);
    expect(element.querySelector(".math-input")).not.toBeNull();
    editor.commands.setTextSelection(0);
    element.querySelector<HTMLInputElement>(".math-input")?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  });

  it("serializes to markdown and HTML with the exact source", () => {
    const { editor } = mount({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "a " }, { type: "mathInline", attrs: { source: "$x$" } }] },
        { type: "mathDisplay", attrs: { source: "$$y$$" } },
      ],
    });
    expect(editor.storage.markdown.getMarkdown()).toBe("a $x$\n\n$$y$$");
    const reparsed = new Editor({ element: document.createElement("div"), extensions: createWysiwygExtensions({ renderMath }), content: editor.getHTML() });
    editors.push(reparsed);
    expect(reparsed.getJSON()).toEqual(editor.getJSON());
  });

  it("keeps the presentation current when the node changes and ignores internal mutations", () => {
    const { editor, element } = mount(inlineDoc("$x$"));
    editor.commands.command(({ tr }) => {
      tr.setNodeMarkup(1, undefined, { source: "$w$" });
      return true;
    });
    expect(element.querySelector(".math-rendered .katex")).toHaveTextContent("I:w");
  });
});
