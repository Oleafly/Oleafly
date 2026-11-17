import { Mark, mergeAttributes } from "@tiptap/core";

export const Highlight = Mark.create({
  name: "highlight",

  parseHTML() {
    return [{ tag: "mark", getAttrs: (element) => (element.attributes.length > 0 ? false : null) }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["mark", mergeAttributes(HTMLAttributes), 0];
  },

  addStorage() {
    return { markdown: { serialize: { open: "<mark>", close: "</mark>" }, parse: {} } };
  },
});
