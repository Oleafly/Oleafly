import { Mark, mergeAttributes } from "@tiptap/core";

function scriptMark(name: string, tag: "sup" | "sub", align: "super" | "sub", other: string, shortcut: string) {
  return Mark.create({
    name,
    excludes: `${name} ${other}`,

    parseHTML() {
      return [
        { tag, getAttrs: (element) => (element.hasAttribute("data-type") ? false : null) },
        { style: "vertical-align", getAttrs: (value) => (value === align ? null : false) },
      ];
    },

    renderHTML({ HTMLAttributes }) {
      return [tag, mergeAttributes(HTMLAttributes), 0];
    },

    addStorage() {
      return { markdown: { serialize: { open: `<${tag}>`, close: `</${tag}>` }, parse: {} } };
    },

    addKeyboardShortcuts() {
      return { [shortcut]: () => this.editor.commands.toggleMark(name) };
    },
  });
}

export const Superscript = scriptMark("superscript", "sup", "super", "subscript", "Mod-.");
export const Subscript = scriptMark("subscript", "sub", "sub", "superscript", "Mod-Shift-,");
