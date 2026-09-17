import { Node, mergeAttributes, type NodeViewRenderer } from "@tiptap/core";
import type { MarkdownNodeSpec } from "tiptap-markdown";
import { wysiwygMessage } from "../messages";
import type { MathRenderPort } from "../options";
import {
  atomNodeViewChrome,
  createSourceEditor,
  OPEN_SOURCE_EDITOR_EVENT,
  openSelectedSourceEditor,
  updateNodeAttribute,
} from "../source-editing";
import { mathRenderInput, splitMathSource } from "./source";

export interface MathNodeOptions {
  renderMath: MathRenderPort | null;
}

function sourceElement(source: string): HTMLElement {
  const code = document.createElement("code");
  code.className = "math-source";
  code.textContent = source;
  return code;
}

function errorElement(message: string): HTMLElement {
  const error = document.createElement("span");
  error.className = "math-error";
  error.setAttribute("role", "status");
  error.textContent = message;
  return error;
}

export function paintMath(target: HTMLElement, source: string, renderMath: MathRenderPort | null): void {
  target.replaceChildren();
  target.classList.remove("is-error", "is-unrendered");
  const input = mathRenderInput(source);
  if (!input || !renderMath) {
    target.classList.add(input ? "is-unrendered" : "is-error");
    target.append(sourceElement(source));
    return;
  }
  const result = renderMath(input.body, input.display);
  if (result.status === "ready") {
    target.innerHTML = result.html;
    return;
  }
  target.classList.add("is-error");
  target.append(sourceElement(source), errorElement(result.message ?? wysiwygMessage("math.renderFailed")));
}

function mathNodeView(display: boolean, options: MathNodeOptions): NodeViewRenderer {
  return ({ node: initialNode, view, getPos }) => {
    let currentNode = initialNode;
    const tag = display ? "div" : "span";
    const dom = document.createElement(tag);
    dom.dataset.type = display ? "math-display" : "math-inline";
    dom.setAttribute("contenteditable", "false");
    dom.setAttribute("aria-label", wysiwygMessage(display ? "math.displayLabel" : "math.inlineLabel"));
    const rendered = document.createElement(tag);
    rendered.className = "math-rendered";
    const preview = document.createElement(tag);
    preview.className = "math-live-preview";
    preview.setAttribute("aria-label", wysiwygMessage("math.previewLabel"));
    dom.append(rendered);

    const source = () => String(currentNode.attrs.source ?? "");
    const updatePresentation = () => {
      dom.dataset.mathKind = splitMathSource(source())?.display ? "display" : "inline";
      paintMath(rendered, source(), options.renderMath);
    };
    updatePresentation();

    const editor = createSourceEditor({
      multiline: display,
      className: "math-input",
      label: wysiwygMessage("math.inputLabel"),
      read: source,
      mount: (input) => {
        rendered.hidden = true;
        dom.append(input, preview);
        paintMath(preview, input.value, options.renderMath);
      },
      onInput: (value) => paintMath(preview, value, options.renderMath),
      onOpen: () => {
        dom.dataset.mathEditing = "true";
      },
      onClose: () => {
        delete dom.dataset.mathEditing;
        preview.remove();
        rendered.hidden = false;
        updatePresentation();
      },
      commit: (value) => {
        updateNodeAttribute(view, getPos, currentNode.type, "source", value);
      },
      focusAfter: () => view.dom.focus({ preventScroll: true }),
    });
    rendered.addEventListener("click", editor.open);
    dom.addEventListener(OPEN_SOURCE_EDITOR_EVENT, editor.open);

    return {
      dom,
      ...atomNodeViewChrome(dom, ".math-input"),
      update(nextNode) {
        if (nextNode.type !== currentNode.type) return false;
        currentNode = nextNode;
        if (!editor.editing) updatePresentation();
        return true;
      },
      destroy() {
        editor.close();
        rendered.removeEventListener("click", editor.open);
        dom.removeEventListener(OPEN_SOURCE_EDITOR_EVENT, editor.open);
      },
    };
  };
}

function markdownSpec(block: boolean): MarkdownNodeSpec {
  return {
    serialize(state, node) {
      state.write(String(node.attrs.source ?? ""));
      if (block) state.closeBlock(node);
    },
  };
}

export const MathInline = Node.create<MathNodeOptions>({
  name: "mathInline",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addOptions() {
    return { renderMath: null };
  },

  addAttributes() {
    return { source: { default: "" } };
  },

  addStorage() {
    return { markdown: markdownSpec(false) };
  },

  parseHTML() {
    return [{ tag: 'span[data-type="math-inline"]' }];
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, { "data-type": "math-inline", contenteditable: "false" }),
      node.attrs.source,
    ];
  },

  addKeyboardShortcuts() {
    return { Enter: () => openSelectedSourceEditor(this.editor.view, this.name) };
  },

  addNodeView() {
    return mathNodeView(false, this.options);
  },
});

export const MathDisplay = Node.create<MathNodeOptions>({
  name: "mathDisplay",
  group: "block",
  atom: true,
  selectable: true,
  draggable: false,

  addOptions() {
    return { renderMath: null };
  },

  addAttributes() {
    return { source: { default: "" } };
  },

  addStorage() {
    return { markdown: markdownSpec(true) };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="math-display"]' }];
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-type": "math-display", contenteditable: "false" }),
      node.attrs.source,
    ];
  },

  addKeyboardShortcuts() {
    return { Enter: () => openSelectedSourceEditor(this.editor.view, this.name) };
  },

  addNodeView() {
    return mathNodeView(true, this.options);
  },
});
