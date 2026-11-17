import { Mark, mergeAttributes } from "@tiptap/core";
import { PANDOC_SYNTAX, pandocOrHtml, pandocSyntaxAttribute } from "./markdown/pandoc-inline";

export const Highlight = Mark.create({
  name: "highlight",

  addAttributes() {
    return pandocSyntaxAttribute;
  },

  parseHTML() {
    return [{ tag: "mark", getAttrs: (element) => (Array.from(element.attributes).some((attribute) => attribute.name !== PANDOC_SYNTAX) ? false : null) }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["mark", mergeAttributes(HTMLAttributes), 0];
  },

  addStorage() {
    return { markdown: { serialize: pandocOrHtml(["<mark>", "</mark>"], ["[", "]{.mark}"]), parse: {} } };
  },
});
