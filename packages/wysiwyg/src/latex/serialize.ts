import type { JSONContent } from "@tiptap/core";

const HEADING_MACRO: Record<number, string> = {
  1: "section",
  2: "subsection",
  3: "subsubsection",
};

function escapeLatexText(text: string): string {
  return text.replace(/([\\{}&%$#_^~])/g, (ch) => {
    if (ch === "\\") return "\\textbackslash{}";
    if (ch === "^") return "\\textasciicircum{}";
    if (ch === "~") return "\\textasciitilde{}";
    return `\\${ch}`;
  });
}

function inlineToLatex(nodes: JSONContent[] = []): string {
  return nodes
    .map((node) => {
      if (node.type === "rawInline") return String(node.attrs?.source ?? "");
      if (node.type !== "text") return "";
      const escaped = escapeLatexText(node.text ?? "");
      const marks = node.marks ?? [];
      const link = marks.find((m) => m.type === "link");
      const base = link ? `\\href{${link.attrs?.href ?? ""}}{${escaped}}` : escaped;
      return marks.reduceRight((acc, mark) => {
        if (mark.type === "bold") return `\\textbf{${acc}}`;
        if (mark.type === "italic") return `\\textit{${acc}}`;
        if (mark.type === "underline") return `\\underline{${acc}}`;
        if (mark.type === "code") return `\\texttt{${acc}}`;
        return acc;
      }, base);
    })
    .join("");
}

function blockToLatex(node: JSONContent): string {
  if (node.type === "heading") {
    const macro = HEADING_MACRO[node.attrs?.level ?? 1] ?? "section";
    return `\\${macro}{${inlineToLatex(node.content)}}`;
  }
  if (node.type === "paragraph") {
    return inlineToLatex(node.content);
  }
  if (node.type === "blockquote") {
    const inner = (node.content ?? []).map(blockToLatex).join("\n");
    return `\\begin{quote}\n${inner}\n\\end{quote}`;
  }
  if (node.type === "bulletList" || node.type === "orderedList") {
    const env = node.type === "bulletList" ? "itemize" : "enumerate";
    const items = (node.content ?? [])
      .map((item) => {
        const paragraph = item.content?.[0];
        return `  \\item ${inlineToLatex(paragraph?.content)}`;
      })
      .join("\n");
    return `\\begin{${env}}\n${items}\n\\end{${env}}`;
  }
  if (node.type === "rawBlock") {
    return String(node.attrs?.source ?? "");
  }
  return "";
}

export function serializeLatexBody(doc: JSONContent): string {
  const blocks = (doc.content ?? []).map(blockToLatex).filter((s) => s.length > 0);
  return `${blocks.join("\n\n")}\n`;
}
