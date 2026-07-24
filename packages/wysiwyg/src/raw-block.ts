import { Node, mergeAttributes } from "@tiptap/core";

export const RawBlock = Node.create({
  name: "rawBlock",
  group: "block",
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      source: { default: "" },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="raw-block"]' }];
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-type": "raw-block",
        contenteditable: "false",
      }),
      node.attrs.source,
    ];
  },
});
