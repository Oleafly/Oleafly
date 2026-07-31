import type { DocumentParagraph } from "./types";

const DEFAULT_MIN_LENGTH = 30;
const DEFAULT_MAX_PARAGRAPHS = 20;
const DEFAULT_MAX_TERMS = 15;

/** English + academic stop words (OpenLeaf baseline). */
const STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "have",
  "has",
  "had",
  "do",
  "does",
  "did",
  "will",
  "would",
  "could",
  "should",
  "may",
  "might",
  "shall",
  "can",
  "need",
  "dare",
  "ought",
  "used",
  "to",
  "of",
  "in",
  "for",
  "on",
  "with",
  "at",
  "by",
  "from",
  "as",
  "into",
  "through",
  "during",
  "before",
  "after",
  "above",
  "below",
  "between",
  "out",
  "off",
  "over",
  "under",
  "again",
  "further",
  "then",
  "once",
  "here",
  "there",
  "when",
  "where",
  "why",
  "how",
  "all",
  "each",
  "every",
  "both",
  "few",
  "more",
  "most",
  "other",
  "some",
  "such",
  "no",
  "nor",
  "not",
  "only",
  "own",
  "same",
  "so",
  "than",
  "too",
  "very",
  "just",
  "because",
  "but",
  "and",
  "or",
  "if",
  "while",
  "although",
  "that",
  "which",
  "who",
  "whom",
  "this",
  "these",
  "those",
  "what",
  "about",
  "up",
  "its",
  "it",
  "he",
  "she",
  "they",
  "we",
  "you",
  "i",
  "me",
  "my",
  "our",
  "your",
  "his",
  "her",
  "their",
  "also",
  "however",
  "thus",
  "hence",
  "therefore",
  "moreover",
  "furthermore",
  "additionally",
  "nevertheless",
  "nonetheless",
  "yet",
  "still",
  "even",
  "already",
  "since",
  "until",
  "unless",
  "whether",
  "though",
  "whereas",
]);

const STRUCTURAL_RE =
  /^\\(begin|end|usepackage|documentclass|title|author|date|maketitle|tableofcontents|bibliography|bibliographystyle|appendix)\b/;

const HEADING_ONLY_RE =
  /^\\(section|subsection|subsubsection|chapter|part)\*?\{[^}]*\}\s*$/;

export interface SplitParagraphOptions {
  minLength?: number;
  maxParagraphs?: number;
}

/**
 * Split LaTeX source into prose paragraphs for citation scanning.
 * Uses body between `\begin{document}` … `\end{document}` when present.
 */
export function splitIntoParagraphs(
  source: string,
  options?: SplitParagraphOptions,
): DocumentParagraph[] {
  const minLength = options?.minLength ?? DEFAULT_MIN_LENGTH;
  const maxParagraphs = options?.maxParagraphs ?? DEFAULT_MAX_PARAGRAPHS;

  let text = source;

  const beginDocMatch = text.match(/\\begin\{document\}/);
  if (beginDocMatch && beginDocMatch.index !== undefined) {
    text = text.slice(beginDocMatch.index + beginDocMatch[0].length);
  }

  const endDocMatch = text.match(/\\end\{document\}/);
  if (endDocMatch && endDocMatch.index !== undefined) {
    text = text.slice(0, endDocMatch.index);
  }

  const raw = text.split(/\n\s*\n|\n\\par\b/);
  const paragraphs: DocumentParagraph[] = [];

  for (const chunk of raw) {
    const trimmed = chunk.trim();
    if (trimmed.length < minLength) continue;
    if (STRUCTURAL_RE.test(trimmed)) continue;
    if (trimmed.split("\n").every((line) => line.trim().startsWith("%"))) continue;
    if (HEADING_ONLY_RE.test(trimmed)) continue;
    paragraphs.push({ index: paragraphs.length, text: trimmed });
    if (paragraphs.length >= maxParagraphs) break;
  }

  return paragraphs;
}

/**
 * Clean LaTeX and produce a short keyword query for literature search.
 * Short cleaned prose (≤200 chars) is returned as-is; longer text is
 * reduced to the first `maxTerms` content tokens (default 15).
 */
export function extractKeywords(text: string, maxTerms: number = DEFAULT_MAX_TERMS): string {
  let cleaned = text;
  cleaned = cleaned.replace(/%.*$/gm, "");
  cleaned = cleaned.replace(/\$\$[\s\S]*?\$\$/g, " ");
  cleaned = cleaned.replace(/\\\[[\s\S]*?\\\]/g, " ");
  cleaned = cleaned.replace(/\$[^$]*\$/g, " ");
  cleaned = cleaned.replace(/\\\([\s\S]*?\\\)/g, " ");
  cleaned = cleaned.replace(
    /\\begin\{(figure|table|equation|align|eqnarray|lstlisting|verbatim|tikzpicture)\*?\}[\s\S]*?\\end\{\1\*?\}/g,
    " ",
  );
  cleaned = cleaned.replace(
    /\\(cite[tp]?|ref|label|eqref|autoref|cref|Cref)\{[^}]*\}/g,
    " ",
  );
  cleaned = cleaned.replace(
    /\\(textbf|textit|emph|underline|text|textrm|textsc|texttt)\{([^}]*)\}/g,
    "$2",
  );
  cleaned = cleaned.replace(
    /\\(section|subsection|subsubsection|chapter|paragraph|subparagraph)\*?\{([^}]*)\}/g,
    "$2",
  );
  cleaned = cleaned.replace(/\\[a-zA-Z]+\{[^}]*\}/g, " ");
  cleaned = cleaned.replace(/\\[a-zA-Z]+/g, " ");
  cleaned = cleaned.replace(/[{}~\\&%$#_^]/g, " ");
  cleaned = cleaned.replace(/\s+/g, " ").trim();

  if (!cleaned || cleaned.length < 10) return "";
  if (cleaned.length <= 200) return cleaned;

  const words = cleaned
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w.toLowerCase()));
  return words.slice(0, maxTerms).join(" ");
}

/** Strip simple LaTeX markup to plain text. */
export function cleanLatex(text: string): string {
  let cleaned = text;
  cleaned = cleaned.replace(/%.*$/gm, "");
  cleaned = cleaned.replace(/\$[^$]*\$/g, " ");
  cleaned = cleaned.replace(/\\(cite[tp]?|ref|label)\{[^}]*\}/g, " ");
  cleaned = cleaned.replace(/\\(textbf|textit|emph)\{([^}]*)\}/g, "$2");
  cleaned = cleaned.replace(/\\[a-zA-Z]+\{[^}]*\}/g, " ");
  cleaned = cleaned.replace(/\\[a-zA-Z]+/g, " ");
  cleaned = cleaned.replace(/[{}~\\&%$#_^]/g, " ");
  cleaned = cleaned.replace(/\s+/g, " ").trim();
  return cleaned;
}
