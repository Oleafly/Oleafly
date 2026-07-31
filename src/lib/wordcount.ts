import { maskLatex, maskToProse, spellcheckRanges } from "@oleafly/editor";
import { splitLatexDocument } from "@oleafly/wysiwyg";

export interface WordCountStats {
  words: number;
  characters: number;
  lines: number;
  /**
   * "masked" — counts derive from the spellchecker's LaTeX mask, the accurate
   * prose boundary (math bodies, verbatim/code, tikz, labels/cite keys and
   * other machine arguments are excluded). "heuristic" — the legacy regex
   * fallback used when masking throws.
   */
  method: "masked" | "heuristic";
}

/**
 * Counts prose words/characters/lines in a (LaTeX) document.
 *
 * Words are the tokens the spellchecker would check (`spellcheckRanges`), so
 * the count matches what a reader perceives as prose: equation bodies, code
 * listings, comments, keys, and dimension arguments do not inflate it.
 * Characters and lines come from the same mask: characters over the compacted
 * prose (`maskToProse`), lines as the trimmed non-empty lines of the masked
 * text.
 */
export function countWords(tex: string): WordCountStats {
  try {
    const words = spellcheckRanges(tex).length;
    const characters = maskToProse(tex).prose.length;
    const lines = maskLatex(tex)
      .split("\n")
      .filter((line) => line.trim().length > 0).length;
    return { words, characters, lines, method: "masked" };
  } catch {
    return { ...heuristicCount(tex), method: "heuristic" };
  }
}

// Legacy regex-based counting, kept only as the fallback when the mask fails.
function heuristicCount(tex: string): Omit<WordCountStats, "method"> {
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
