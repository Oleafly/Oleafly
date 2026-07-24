const BEGIN_RE = /\\begin\{document\}\r?\n?/;
const END_RE = /\\end\{document\}/;

export interface LatexDocumentSplit {
  preamble: string;
  body: string;
  suffix: string;
  hasDocumentEnv: boolean;
}

export function splitLatexDocument(source: string): LatexDocumentSplit {
  const beginMatch = BEGIN_RE.exec(source);
  const endMatch = END_RE.exec(source);
  if (!beginMatch || !endMatch || endMatch.index < beginMatch.index) {
    return { preamble: "", body: source, suffix: "", hasDocumentEnv: false };
  }
  const preamble = source.slice(0, beginMatch.index + beginMatch[0].length);
  const body = source.slice(beginMatch.index + beginMatch[0].length, endMatch.index);
  const suffix = source.slice(endMatch.index);
  return { preamble, body, suffix, hasDocumentEnv: true };
}

export function joinLatexDocument(split: Pick<LatexDocumentSplit, "preamble" | "body" | "suffix">): string {
  return `${split.preamble}${split.body}${split.suffix}`;
}
