// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { Editor, type JSONContent } from "@tiptap/core";
import { WYSIWYG_EXTENSIONS } from "./schema";
import { createSourceEditor, openSelectedSourceEditor, updateNodeAttribute, type SourceEditorOptions } from "./source-editing";

let editors: Editor[] = [];

function build(overrides: Partial<SourceEditorOptions> = {}) {
  const host = document.createElement("div");
  document.body.append(host);
  const commit = vi.fn();
  const focusAfter = vi.fn();
  const onInput = vi.fn();
  const editor = createSourceEditor({
    multiline: false,
    className: "probe-input",
    label: "Probe",
    read: () => "initial",
    mount: (input) => host.append(input),
    commit,
    focusAfter,
    onInput,
    ...overrides,
  });
  const input = () => host.querySelector<HTMLInputElement | HTMLTextAreaElement>(".probe-input");
  return { host, editor, commit, focusAfter, onInput, input };
}

afterEach(() => {
  for (const editor of editors) editor.destroy();
  editors = [];
  document.body.replaceChildren();
});

describe("createSourceEditor", () => {
  it("mounts a focused, selected input carrying the label and placeholder", () => {
    const { editor, input } = build({ placeholder: "Type here" });
    editor.open();
    const element = input();
    expect(editor.editing).toBe(true);
    expect(element?.value).toBe("initial");
    expect(element?.getAttribute("aria-label")).toBe("Probe");
    expect(element?.placeholder).toBe("Type here");
    expect(document.activeElement).toBe(element);
    editor.open();
    expect(document.querySelectorAll(".probe-input")).toHaveLength(1);
  });

  it("submits single-line inputs on Enter and reports typing", () => {
    const { editor, commit, focusAfter, onInput, input } = build();
    editor.open();
    const element = input();
    if (!element) throw new Error("input missing");
    element.value = "typed";
    element.dispatchEvent(new Event("input"));
    expect(onInput).toHaveBeenCalledWith("typed");
    element.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(commit).toHaveBeenCalledWith("typed");
    expect(focusAfter).toHaveBeenCalled();
    expect(editor.editing).toBe(false);
    expect(input()).toBeNull();
  });

  it("uses a textarea for multiline sources that only submits with a modifier", () => {
    const { editor, commit, input } = build({ multiline: true, read: () => "a\nb\nc" });
    editor.open();
    const element = input();
    expect(element).toBeInstanceOf(HTMLTextAreaElement);
    expect((element as HTMLTextAreaElement).rows).toBe(3);
    element?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(commit).not.toHaveBeenCalled();
    element?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", metaKey: true }));
    expect(commit).toHaveBeenCalledWith("a\nb\nc");
  });

  it("cancels on Escape, commits on blur and ignores keys while composing", () => {
    const { editor, commit, input } = build();
    editor.open();
    const element = input();
    if (!element) throw new Error("input missing");
    element.dispatchEvent(new CompositionEvent("compositionstart"));
    element.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(editor.editing).toBe(true);
    element.dispatchEvent(new CompositionEvent("compositionend"));
    element.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(commit).not.toHaveBeenCalled();
    expect(editor.editing).toBe(false);

    editor.open();
    const reopened = input();
    if (!reopened) throw new Error("input missing");
    reopened.value = "blurred";
    reopened.dispatchEvent(new FocusEvent("blur"));
    expect(commit).toHaveBeenCalledWith("blurred");
    reopened.dispatchEvent(new FocusEvent("blur"));
    expect(commit).toHaveBeenCalledTimes(1);
    editor.close();
  });
});

describe("updateNodeAttribute and openSelectedSourceEditor", () => {
  it("dispatches only when the live node exists and the value changes", () => {
    const editor = new Editor({
      element: document.createElement("div"),
      extensions: WYSIWYG_EXTENSIONS,
      content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "rawInline", attrs: { source: "\\x" } }] }] },
    });
    editors.push(editor);
    const type = editor.schema.nodes.rawInline;
    expect(updateNodeAttribute(editor.view, () => 1, type, "source", "\\x")).toBe(false);
    expect(updateNodeAttribute(editor.view, () => undefined, type, "source", "\\y")).toBe(false);
    expect(updateNodeAttribute(editor.view, () => 0, type, "source", "\\y")).toBe(false);
    expect(updateNodeAttribute(editor.view, () => 1, type, "source", "\\y")).toBe(true);
    expect((editor.getJSON() as JSONContent).content?.[0].content?.[0].attrs?.source).toBe("\\y");
    expect(openSelectedSourceEditor(editor.view, "rawInline")).toBe(false);
    editor.commands.setNodeSelection(1);
    expect(openSelectedSourceEditor(editor.view, "mathInline")).toBe(false);
    const dom = editor.view.nodeDOM(1);
    const listener = vi.fn();
    dom?.addEventListener("oleafly-open-source-editor", listener);
    expect(openSelectedSourceEditor(editor.view, "rawInline")).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
