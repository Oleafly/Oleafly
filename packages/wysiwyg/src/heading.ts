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
            parseHTML: (element) => element.getAttribute("data-command"),
            renderHTML: (attributes) => ({ "data-command": attributes.command ?? null }),
          },
          starred: {
            default: false,
            parseHTML: (element) => element.getAttribute("data-starred") === "true",
            renderHTML: (attributes) => ({ "data-starred": attributes.starred ? "true" : null }),
          },
          shortTitle: {
            default: null,
            parseHTML: (element) => element.getAttribute("data-short-title"),
            renderHTML: (attributes) => ({ "data-short-title": attributes.shortTitle ?? null }),
          },
        },
      },
    ];
  },
});
