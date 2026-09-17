import { Mark, mergeAttributes } from "@tiptap/core";
import { latexColorToCss } from "./latex-color";

function colorAttribute(dataName: string, property: "color" | "background-color") {
  return {
    color: {
      default: "",
      parseHTML: (element: HTMLElement) => element.getAttribute(dataName) ?? "",
      renderHTML: (attributes: Record<string, unknown>) => {
        const spec = typeof attributes.color === "string" ? attributes.color : "";
        const css = latexColorToCss(spec);
        return { [dataName]: spec, style: css ? `${property}: ${css}` : null };
      },
    },
  };
}

export const TextColor = Mark.create({
  name: "textColor",

  addAttributes() {
    return colorAttribute("data-text-color", "color");
  },

  parseHTML() {
    return [{ tag: "span[data-text-color]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes), 0];
  },
});

export const ColorBox = Mark.create({
  name: "colorBox",

  addAttributes() {
    return colorAttribute("data-color-box", "background-color");
  },

  parseHTML() {
    return [{ tag: "span[data-color-box]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes), 0];
  },
});
