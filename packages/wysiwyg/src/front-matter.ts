const OPENING_FENCE = /^\uFEFF?---[ \t]*\r?\n/u;
const CLOSING_FENCE = /(?:---|\.\.\.)[ \t]*(?=\r?\n|$)/uy;
const BLANK_LINES = /\r?\n(?:[ \t]*\r?\n)*/uy;

export interface MarkdownFrontMatterSplit {
  frontmatter: string;
  separator: string;
  body: string;
}

function closingFenceEnd(source: string, firstLine: number): number {
  for (let line = firstLine; line > 0; line = source.indexOf("\n", line) + 1) {
    CLOSING_FENCE.lastIndex = line;
    const fence = CLOSING_FENCE.exec(source);
    if (fence) return line + fence[0].length;
  }
  return -1;
}

export function splitMarkdownFrontMatter(source: string): MarkdownFrontMatterSplit {
  const opening = OPENING_FENCE.exec(source);
  const end = opening ? closingFenceEnd(source, opening[0].length) : -1;
  if (end < 0) return { frontmatter: "", separator: "", body: source };
  BLANK_LINES.lastIndex = end;
  const separator = BLANK_LINES.exec(source)?.[0] ?? "";
  return { frontmatter: source.slice(0, end), separator, body: source.slice(end + separator.length) };
}
