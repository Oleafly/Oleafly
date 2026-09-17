import type { JSONContent } from "@tiptap/core";
import { inlineToLatex } from "./serialize-inline";

const FIGURE_INDENT = "    ";

function optionalArgument(value: unknown): string {
  return typeof value === "string" && value !== "" ? `[${value}]` : "";
}

export function graphicsOptions(width: unknown, options: unknown): string {
  const entries = [
    typeof width === "string" && width !== "" ? `width=${width}` : null,
    typeof options === "string" && options !== "" ? options : null,
  ].filter((entry): entry is string => entry !== null);
  return entries.length ? `[${entries.join(",")}]` : "";
}

export function figureToLatex(node: JSONContent): string {
  const attrs = node.attrs ?? {};
  const command = attrs.graphicsCommand === "includesvg" ? "includesvg" : "includegraphics";
  const lines = [String.raw`\begin{figure}${optionalArgument(attrs.placement)}`];
  if (attrs.centering === true) lines.push(String.raw`${FIGURE_INDENT}\centering`);
  lines.push(`${FIGURE_INDENT}\\${command}${graphicsOptions(attrs.width, attrs.options)}{${String(attrs.path ?? "")}}`);
  const caption = node.content?.find((child) => child.type === "figureCaption");
  if (caption) lines.push(String.raw`${FIGURE_INDENT}\caption{${inlineToLatex(caption.content)}}`);
  if (typeof attrs.label === "string" && attrs.label !== "") lines.push(String.raw`${FIGURE_INDENT}\label{${attrs.label}}`);
  lines.push(String.raw`\end{figure}`);
  return lines.join("\n");
}
