// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { Editor, type JSONContent } from "@tiptap/core";
import { WYSIWYG_EXTENSIONS } from "./schema";
import { theoremLabel } from "./theorem";

let editors: Editor[] = [];

function mount(theorem: JSONContent): { editor: Editor; element: HTMLElement } {
  const element = document.createElement("div");
  document.body.append(element);
  const editor = new Editor({ element, extensions: WYSIWYG_EXTENSIONS, content: { type: "doc", content: [theorem] } });
  editors.push(editor);
  return { editor, element };
}

const lemma: JSONContent = {
  type: "theorem",
  attrs: { environment: "lemma", title: "Key" },
  content: [{ type: "paragraph", content: [{ type: "text", text: "Body." }] }],
};

afterEach(() => {
  for (const editor of editors) editor.destroy();
  editors = [];
  document.body.replaceChildren();
});

describe("theoremLabel", () => {
  it("uses catalog names for standard environments and capitalises custom ones", () => {
    expect(theoremLabel("lemma")).toBe("theorem.name.lemma");
    expect(theoremLabel("theorem*")).toBe("theorem.name.theorem");
    expect(theoremLabel("mytheorem")).toBe("Mytheorem");
  });
});

describe("Theorem", () => {
  it("renders a non-editable header with the name and title and an editable body", () => {
    const { editor, element } = mount(lemma);
    const node = element.querySelector<HTMLElement>('[data-type="theorem"]');
    expect(node?.dataset.environment).toBe("lemma");
    expect(node?.querySelector(".theorem-header")?.getAttribute("contenteditable")).toBe("false");
    expect(node?.querySelector(".theorem-name")).toHaveTextContent("theorem.name.lemma");
    expect(node?.querySelector(".theorem-title")).toHaveTextContent("(Key)");
    expect(node?.querySelector(".theorem-body p")).toHaveTextContent("Body.");
    editor.commands.setTextSelection(7);
    editor.commands.insertContent(" More");
    expect((editor.getJSON() as JSONContent).content?.[0].content?.[0].content?.[0].text).toBe("Body. More");
  });

  it("edits the title inline and clears it when emptied", () => {
    const { editor, element } = mount(lemma);
    element.querySelector<HTMLButtonElement>(".theorem-edit-title")?.click();
    const input = element.querySelector<HTMLInputElement>("input.theorem-title-input");
    expect(input?.value).toBe("Key");
    if (!input) throw new Error("input missing");
    input.value = "Renamed";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect((editor.getJSON() as JSONContent).content?.[0].attrs?.title).toBe("Renamed");
    expect(element.querySelector(".theorem-title")).toHaveTextContent("(Renamed)");
    element.querySelector<HTMLElement>(".theorem-title")?.click();
    const again = element.querySelector<HTMLInputElement>("input.theorem-title-input");
    if (!again) throw new Error("input missing");
    again.value = "  ";
    again.dispatchEvent(new FocusEvent("blur"));
    expect((editor.getJSON() as JSONContent).content?.[0].attrs?.title).toBeNull();
    expect(element.querySelector(".theorem-title")).toHaveTextContent("");
  });

  it("round-trips through HTML with its attributes", () => {
    const { editor } = mount(lemma);
    const html = editor.getHTML();
    expect(html).toContain('data-environment="lemma"');
    expect(html).toContain('data-title="Key"');
    const reparsed = new Editor({ element: document.createElement("div"), extensions: WYSIWYG_EXTENSIONS, content: html });
    editors.push(reparsed);
    expect(reparsed.getJSON()).toEqual(editor.getJSON());
  });
});

describe("Theorem node view details", () => {
  it("opens an empty title field for a theorem without a title", () => {
    const { element } = mount({
      type: "theorem",
      attrs: { environment: "definition", title: null },
      content: [{ type: "paragraph" }],
    });

    expect(element.querySelector(".theorem-title")).toHaveTextContent("");
    element.querySelector<HTMLButtonElement>(".theorem-edit-title")?.click();

    expect(element.querySelector<HTMLInputElement>("input.theorem-title-input")?.value).toBe("");
  });

  it("follows environment and title changes made elsewhere", () => {
    const { editor, element } = mount(lemma);

    editor.view.dispatch(editor.state.tr.setNodeMarkup(0, undefined, { environment: "proof", title: "Sketch" }));

    const node = element.querySelector<HTMLElement>('[data-type="theorem"]');
    expect(node?.dataset.environment).toBe("proof");
    expect(node?.querySelector(".theorem-name")).toHaveTextContent("theorem.name.proof");
    expect(node?.querySelector(".theorem-title")).toHaveTextContent("(Sketch)");
  });

  it("keeps keys pressed in the header away from the editor and lets body keys through", () => {
    const handleKeyDown = vi.fn((_view: unknown, _event: KeyboardEvent) => false);
    const element = document.createElement("div");
    document.body.append(element);
    const editor = new Editor({
      element,
      extensions: WYSIWYG_EXTENSIONS,
      editorProps: { handleKeyDown },
      content: { type: "doc", content: [lemma] },
    });
    editors.push(editor);
    const press = (target: EventTarget, key: string) =>
      target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));

    press(element.querySelector(".theorem-edit-title") as HTMLElement, "a");
    expect(handleKeyDown).not.toHaveBeenCalled();

    press(element.querySelector(".theorem-body p") as HTMLElement, "b");
    expect(handleKeyDown.mock.calls.map(([, event]) => event.key)).toEqual(["b"]);
  });

  it("parses a theorem from HTML without environment or title data as a plain theorem", () => {
    const editor = new Editor({
      element: document.createElement("div"),
      extensions: WYSIWYG_EXTENSIONS,
      content: '<section data-type="theorem"><div class="theorem-body"><p>Claim.</p></div></section>',
    });
    editors.push(editor);

    expect(editor.getJSON().content?.[0]).toMatchObject({
      type: "theorem",
      attrs: { environment: "theorem", title: null },
    });
  });
});
