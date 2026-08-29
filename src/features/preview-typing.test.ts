// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { setEditorView } from "@oleafly/editor";
import {
  armPreviewTyping,
  disarmPreviewTyping,
  isPreviewTypingArmed,
} from "./preview-typing";

let view: EditorView | null = null;

function setup(spanText = "hello world") {
  const parent = document.createElement("div");
  document.body.append(parent);
  view = new EditorView({
    parent,
    state: EditorState.create({ doc: "hello world line" }),
  });
  setEditorView(view);
  view.contentDOM.focus();
  const layer = document.createElement("div");
  layer.className = "textLayer";
  const span = document.createElement("span");
  span.textContent = spanText;
  layer.append(span);
  document.body.append(layer);
  return { span, layer };
}

function key(init: KeyboardEventInit) {
  window.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, ...init }));
}

afterEach(() => {
  disarmPreviewTyping();
  setEditorView(null);
  view?.destroy();
  view = null;
  document.body.replaceChildren();
});

describe("preview typing", () => {
  it("arms at the end of the clicked word and collapses the editor selection", () => {
    const { span } = setup();
    view?.dispatch({ selection: { anchor: 0, head: 5 } });
    expect(armPreviewTyping({ span, offset: 2 })).toBe(true);
    expect(isPreviewTypingArmed()).toBe(true);
    const selection = view?.state.selection.main;
    expect(selection?.empty).toBe(true);
    expect(selection?.head).toBe(5);
    const caret = span.querySelector("[data-pdf-typing-caret]");
    expect(caret?.previousSibling?.textContent).toBe("hello");
  });

  it("mirrors printable keys and backspace into the preview without touching the document", () => {
    const { span } = setup();
    armPreviewTyping({ span, offset: 2 });
    key({ key: "x" });
    key({ key: "y" });
    expect(span.textContent).toBe("helloxy world");
    key({ key: "Backspace" });
    expect(span.textContent).toBe("hellox world");
    expect(view?.state.doc.toString()).toBe("hello world line");
    expect(isPreviewTypingArmed()).toBe(true);
  });

  it("disarms on Escape and keeps the echoed text", () => {
    const { span } = setup();
    armPreviewTyping({ span, offset: 2 });
    key({ key: "x" });
    key({ key: "Escape" });
    expect(isPreviewTypingArmed()).toBe(false);
    expect(span.querySelector("[data-pdf-typing-caret]")).toBeNull();
    expect(span.textContent).toBe("hellox world");
  });

  it("disarms on navigation keys and on shortcuts with a modifier", () => {
    const { span } = setup();
    armPreviewTyping({ span, offset: 2 });
    key({ key: "Shift" });
    expect(isPreviewTypingArmed()).toBe(true);
    key({ key: "ArrowLeft" });
    expect(isPreviewTypingArmed()).toBe(false);

    armPreviewTyping({ span, offset: 2 });
    key({ key: "z", metaKey: true });
    expect(isPreviewTypingArmed()).toBe(false);
  });

  it("disarms when the editor loses focus", () => {
    const { span } = setup();
    armPreviewTyping({ span, offset: 2 });
    view?.contentDOM.blur();
    key({ key: "x" });
    expect(isPreviewTypingArmed()).toBe(false);
    expect(span.textContent).toBe("hello world");
  });

  it("disarms on a mousedown outside the text layer but not inside it", () => {
    const { span } = setup();
    armPreviewTyping({ span, offset: 2 });
    span.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(isPreviewTypingArmed()).toBe(true);
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(isPreviewTypingArmed()).toBe(false);
  });

  it("disarms when the target span is removed by a text layer rebuild", () => {
    const { span, layer } = setup();
    armPreviewTyping({ span, offset: 2 });
    layer.replaceChildren();
    key({ key: "x" });
    expect(isPreviewTypingArmed()).toBe(false);
  });

  it("does not arm without an editor view", () => {
    const { span } = setup();
    setEditorView(null);
    expect(armPreviewTyping({ span, offset: 2 })).toBe(false);
  });
});
