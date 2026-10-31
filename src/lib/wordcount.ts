import { countedWordStarts, maskLatex, maskToProse } from "@oleafly/editor";
import { splitLatexDocument } from "@oleafly/wysiwyg";

export interface WordCountStats {
  words: number;
  characters: number;
  lines: number;
  method: "masked" | "heuristic";
}

export function countWords(tex: string): WordCountStats {
  try {
    const masked = maskLatex(tex);
    const words = countedWordStarts(masked).length;
    const characters = maskToProse(tex).prose.length;
    const lines = masked
      .split("\n")
      .filter((line) => line.trim().length > 0).length;
    return { words, characters, lines, method: "masked" };
  } catch {
    return { ...heuristicCount(tex), method: "heuristic" };
  }
}

function heuristicCount(tex: string): Omit<WordCountStats, "method"> {
  let t = splitLatexDocument(tex).body;
  t = t.replace(/(^|[^\\])%[^\n\r\u2028\u2029]*/gm, "$1");
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
