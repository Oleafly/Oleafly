import { Node, mergeAttributes } from "@tiptap/core";
import type { MarkdownNodeSpec } from "tiptap-markdown";
import { wysiwygMessage } from "./messages";
import {
  atomNodeViewChrome,
  createSourceEditor,
  OPEN_SOURCE_EDITOR_EVENT,
  openSelectedSourceEditor,
  updateNodeAttribute,
} from "./source-editing";

export const Footnote = Node.create({
  name: "footnote",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return { source: { default: "" } };
  },

  addStorage() {
    const markdown: MarkdownNodeSpec = {
      serialize(state, node) {
        state.write(`^[${String(node.attrs.source ?? "")}]`);
      },
    };
    return { markdown };
  },

  parseHTML() {
    return [{ tag: 'sup[data-type="footnote"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "sup",
      mergeAttributes(HTMLAttributes, { "data-type": "footnote", contenteditable: "false" }),
      wysiwygMessage("footnote.marker"),
    ];
  },

  addKeyboardShortcuts() {
    return { Enter: () => openSelectedSourceEditor(this.editor.view, this.name) };
  },

  addNodeView() {
    return ({ node: initialNode, view, getPos }) => {
      let currentNode = initialNode;
      const dom = document.createElement("sup");
      dom.dataset.type = "footnote";
      dom.setAttribute("contenteditable", "false");

      const marker = document.createElement("button");
      marker.type = "button";
      marker.className = "footnote-marker";
      marker.textContent = wysiwygMessage("footnote.marker");
      dom.append(marker);

      const source = () => String(currentNode.attrs.source ?? "");
      const updatePresentation = () => {
        marker.title = source();
        marker.setAttribute("aria-label", `${wysiwygMessage("footnote.label")}: ${source()}`);
        dom.setAttribute("aria-label", wysiwygMessage("footnote.label"));
      };
      updatePresentation();

      const editor = createSourceEditor({
        multiline: true,
        className: "footnote-input",
        label: wysiwygMessage("footnote.inputLabel"),
        read: source,
        mount: (input) => {
          marker.hidden = true;
          dom.append(input);
        },
        onOpen: () => {
          dom.dataset.footnoteEditing = "true";
        },
        onClose: () => {
          delete dom.dataset.footnoteEditing;
          marker.hidden = false;
          updatePresentation();
        },
        commit: (value) => {
          updateNodeAttribute(view, getPos, currentNode.type, "source", value);
        },
        focusAfter: () => view.dom.focus({ preventScroll: true }),
      });
      marker.addEventListener("click", editor.open);
      dom.addEventListener(OPEN_SOURCE_EDITOR_EVENT, editor.open);

      return {
        dom,
        ...atomNodeViewChrome(dom, ".footnote-marker, .footnote-input"),
        update(nextNode) {
          if (nextNode.type !== currentNode.type) return false;
          currentNode = nextNode;
          if (!editor.editing) updatePresentation();
          return true;
        },
        destroy() {
          editor.close();
          marker.removeEventListener("click", editor.open);
          dom.removeEventListener(OPEN_SOURCE_EDITOR_EVENT, editor.open);
        },
      };
    };
  },
});
