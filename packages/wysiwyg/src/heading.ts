import { Extension } from "@tiptap/core";

export const LatexHeadingAttributes = Extension.create({
  name: "latexHeadingAttributes",

  addGlobalAttributes() {
    return [
      {
        types: ["heading"],
        attributes: {
          command: {
            default: null,
            parseHTML: (element) => element.dataset.command ?? null,
            renderHTML: (attributes) => ({ "data-command": attributes.command ?? null }),
          },
          starred: {
            default: false,
            parseHTML: (element) => element.dataset.starred === "true",
            renderHTML: (attributes) => ({ "data-starred": attributes.starred ? "true" : null }),
          },
          shortTitle: {
            default: null,
            parseHTML: (element) => element.dataset.shortTitle ?? null,
            renderHTML: (attributes) => ({ "data-short-title": attributes.shortTitle ?? null }),
          },
        },
      },
    ];
  },
});
