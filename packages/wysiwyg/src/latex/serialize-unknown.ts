import type { JSONContent } from "@tiptap/core";
import { escapeLatexText } from "@oleafly/latex";
import { isDevelopmentBuild } from "./dev";

export { escapeLatexText };

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
