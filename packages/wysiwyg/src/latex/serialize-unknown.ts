import type { JSONContent } from "@tiptap/core";
import { isDevelopmentBuild } from "./dev";

export function escapeLatexText(text: string): string {
  return text.replace(/([\\{}&%$#_^~])/g, (ch) => {
    if (ch === "\\") return String.raw`\textbackslash{}`;
    if (ch === "^") return String.raw`\textasciicircum{}`;
    if (ch === "~") return String.raw`\textasciitilde{}`;
    return `\\${ch}`;
  });
}

export function textContentOf(node: JSONContent): string {
  if (node.type === "text") return node.text ?? "";
  if (typeof node.attrs?.source === "string") return node.attrs.source;
  return (node.content ?? []).map(textContentOf).join("");
}

export function unknownNodeToLatex(node: JSONContent): string {
  if (isDevelopmentBuild()) {
    throw new Error(`No LaTeX serialization for node type "${node.type ?? "unknown"}"`);
  }
  return escapeLatexText(textContentOf(node));
}
