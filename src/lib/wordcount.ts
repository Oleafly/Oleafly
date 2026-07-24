import { splitLatexDocument } from "@oleafly/wysiwyg";

export function countWords(tex: string): {
  words: number;
  characters: number;
  lines: number;
} {
  let t = splitLatexDocument(tex).body;
  t = t.replace(/(^|[^\\])%.*$/gm, "$1");
  t = t.replace(/\\(begin|end)\s*\{[^}]*\}/g, " ");
  t = t.replace(/\\[a-zA-Z]+\*?\s*\{([^}]*)\}/g, "$1");
  t = t.replace(/\\[a-zA-Z]+\*?/g, " ").replace(/[{}$]/g, " ");
  const contentLines = t
    .split(/\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const words = contentLines.join(" ").split(/\s+/).filter(Boolean);
  return {
    words: words.length,
    characters: contentLines.join("\n").length,
    lines: contentLines.length,
  };
}
