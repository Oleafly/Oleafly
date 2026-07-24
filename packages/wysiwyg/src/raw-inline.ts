import { Node, mergeAttributes } from "@tiptap/core";

export const RawInline = Node.create({
  name: "rawInline",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      source: { default: "" },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-type="raw-inline"]' }];
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-type": "raw-inline",
        contenteditable: "false",
      }),
      node.attrs.source,
    ];
  },
});
