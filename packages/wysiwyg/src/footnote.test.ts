// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { Editor, type JSONContent } from "@tiptap/core";
import { WYSIWYG_EXTENSIONS } from "./schema";

let editors: Editor[] = [];

function mount(source: string): { editor: Editor; element: HTMLElement } {
  const element = document.createElement("div");
  document.body.append(element);
  const editor = new Editor({
    element,
    extensions: WYSIWYG_EXTENSIONS,
    content: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Text" }, { type: "footnote", attrs: { source } }, { type: "text", text: " more" }],
        },
      ],
    },
  });
  editors.push(editor);
  return { editor, element };
}

afterEach(() => {
  for (const editor of editors) editor.destroy();
  editors = [];
  document.body.replaceChildren();
});

describe("Footnote", () => {
  it("renders a superscript marker that carries the note text", () => {
    const { element } = mount("A note");
    const marker = element.querySelector<HTMLButtonElement>('[data-type="footnote"] .footnote-marker');
    expect(marker?.title).toBe("A note");
    expect(marker?.getAttribute("aria-label")).toContain("A note");
  });

  it("opens an inline editor on click and commits on blur", () => {
    const { editor, element } = mount("A note");
    element.querySelector<HTMLButtonElement>(".footnote-marker")?.click();
    const node = element.querySelector<HTMLElement>('[data-type="footnote"]');
    const input = node?.querySelector<HTMLTextAreaElement>("textarea.footnote-input");
    expect(node?.dataset.footnoteEditing).toBe("true");
    expect(input?.value).toBe("A note");
    if (!input) throw new Error("textarea missing");
    input.value = "Edited \\emph{note}";
    input.dispatchEvent(new FocusEvent("blur"));
    expect((editor.getJSON() as JSONContent).content?.[0].content?.[1].attrs?.source).toBe("Edited \\emph{note}");
    expect(node?.querySelector(".footnote-input")).toBeNull();
    expect(node?.querySelector<HTMLButtonElement>(".footnote-marker")?.title).toBe("Edited \\emph{note}");
  });

  it("cancels on Escape and opens with Enter when selected", () => {
    const { editor, element } = mount("A note");
    editor.commands.setNodeSelection(5);
    expect(editor.commands.keyboardShortcut("Enter")).toBe(true);
    const input = element.querySelector<HTMLTextAreaElement>(".footnote-input");
    if (!input) throw new Error("textarea missing");
    input.value = "changed";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect((editor.getJSON() as JSONContent).content?.[0].content?.[1].attrs?.source).toBe("A note");
    expect(element.querySelector(".footnote-input")).toBeNull();
  });

  it("round-trips through HTML and serializes to markdown as an inline note", () => {
    const { editor } = mount("A note");
    expect(editor.storage.markdown.getMarkdown()).toBe("Text^[A note] more");
    const element = document.createElement("div");
    const reparsed = new Editor({ element, extensions: WYSIWYG_EXTENSIONS, content: editor.getHTML() });
    editors.push(reparsed);
    expect(reparsed.getJSON()).toEqual(editor.getJSON());
  });
});
