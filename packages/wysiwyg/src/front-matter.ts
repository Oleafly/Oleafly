const FRONTMATTER_RE =
  /^(﻿?---[ \t]*\r?\n(?:[\s\S]*?\r?\n)??(?:---|\.\.\.)[ \t]*)(?=\r?\n|$)((?:\r?\n)(?:[ \t]*\r?\n)*)?/u;

export interface MarkdownFrontMatterSplit {
  frontmatter: string;
  separator: string;
  body: string;
}

export function splitMarkdownFrontMatter(source: string): MarkdownFrontMatterSplit {
  const match = FRONTMATTER_RE.exec(source);
  if (!match) return { frontmatter: "", separator: "", body: source };
  return { frontmatter: match[1], separator: match[2] ?? "", body: source.slice(match[0].length) };
}
