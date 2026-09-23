import { latexIgnoredRanges, type LatexIgnoredRange } from "./latex-lexical";

export type NovalidateDirective = "file" | "begin" | "end" | null;

export interface NovalidateRegion {
  readonly from: number;
  readonly to: number;
}

export interface NovalidateScan {
  readonly fileDisabled: boolean;
  readonly regions: readonly NovalidateRegion[];
}

const NOVALIDATE_LINE =
  /^[ \t]*%+[ \t]*(?:(begin|end)[ \t]+)?novalidate[ \t]*\r?$/u;

export function novalidateDirective(line: string): NovalidateDirective {
  const match = NOVALIDATE_LINE.exec(line);
  if (!match) return null;
  return (match[1] as "begin" | "end" | undefined) ?? "file";
}

function commentOwnsLine(text: string, cursor: number): boolean {
  let index = cursor - 1;
  while (index >= 0 && (text[index] === " " || text[index] === "\t")) {
    index -= 1;
  }
  return index < 0 || text[index] === "\n";
}

export function novalidateDirectiveAt(
  text: string,
  from: number,
  to: number,
): NovalidateDirective {
  if (!commentOwnsLine(text, from)) return null;
  return novalidateDirective(text.slice(from, to));
}

export function skipNovalidateRegion(text: string, from: number): number {
  let lineStart = text[from] === "\n" ? from + 1 : from;
  while (lineStart < text.length) {
    const lineEnd = text.indexOf("\n", lineStart);
    const stop = lineEnd < 0 ? text.length : lineEnd;
    if (novalidateDirective(text.slice(lineStart, stop)) === "end") {
      return lineEnd < 0 ? text.length : lineEnd + 1;
    }
    if (lineEnd < 0) return text.length;
    lineStart = lineEnd + 1;
  }
  return text.length;
}

export function scanLatexNovalidate(
  text: string,
  ranges: readonly LatexIgnoredRange[] = latexIgnoredRanges(text),
): NovalidateScan {
  const regions: NovalidateRegion[] = [];
  let resumeAt = 0;
  for (const range of ranges) {
    if (range.kind !== "comment" || range.from < resumeAt) continue;
    const directive = novalidateDirectiveAt(text, range.from, range.to);
    if (directive === "file") return { fileDisabled: true, regions: [] };
    if (directive !== "begin") continue;
    resumeAt = skipNovalidateRegion(text, range.to);
    regions.push({ from: range.from, to: resumeAt });
  }
  return { fileDisabled: false, regions };
}

export function maskNovalidateRegions(
  text: string,
  regions: readonly NovalidateRegion[],
): string {
  if (regions.length === 0) return text;
  const characters = text.split("");
  for (const region of regions) {
    for (let cursor = region.from; cursor < region.to; cursor += 1) {
      if (characters[cursor] !== "\n") characters[cursor] = " ";
    }
  }
  return characters.join("");
}
