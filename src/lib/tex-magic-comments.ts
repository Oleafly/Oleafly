/**
 * The `% !TEX root` and `% !TEX program` comments, read from a file's text.
 * Kept free of stores so the analysis worker can use it; see `tex-root.ts` for
 * how the active file's root overrides the main document.
 */

export interface TexMagicComments {
  root: string | null;
  program: string | null;
}

export type TexMagicCommentRule = "shared" | "library";

const MAGIC_COMMENT_RULES: Record<TexMagicCommentRule, { pattern: RegExp; maxLines: number }> = {
  shared: { pattern: /^\s*%\s*(?:!\s*)?TeX\s+(root|program)\s*=/i, maxLines: 50 },
  library: { pattern: /^%\s*!\s*TEX\s+(root|program)\s*=/i, maxLines: 10 },
};

export function parseTexMagicComments(
  text: string,
  rule: TexMagicCommentRule = "shared",
): TexMagicComments {
  const { pattern, maxLines } = MAGIC_COMMENT_RULES[rule];
  const result: TexMagicComments = { root: null, program: null };
  let start = 0;
  for (let line = 0; line < maxLines && start <= text.length; line++) {
    let end = text.indexOf("\n", start);
    if (end < 0) end = text.length;
    const lineText = text.slice(start, end);
    const match = pattern.exec(lineText);
    const value = match ? lineText.slice(match[0].length).trim() : "";
    if (match && value) {
      const key = match[1].toLowerCase() as keyof TexMagicComments;
      result[key] ??= value;
    }
    start = end + 1;
  }
  return result;
}
