import { scanFences } from "@/lib/code-fences";

export interface ReleaseNotesSection {
  heading: string;
  body: string;
}

export interface ReleaseNotesOutline {
  lead: string;
  sections: ReleaseNotesSection[];
}

function isBlank(char: string | undefined): boolean {
  return char === " " || char === "\t";
}

export function withoutClosingHashes(text: string): string {
  let end = text.length;
  while (end > 0 && isBlank(text[end - 1])) end -= 1;
  let start = end;
  while (start > 0 && text[start - 1] === "#") start -= 1;
  if (start < end && (start === 0 || isBlank(text[start - 1]))) end = start;
  return text.slice(0, end).trim();
}

function isRule(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.length >= 3 && /^-+$/.test(trimmed) && line.length - line.trimStart().length < 4;
}

export function inAppReleaseNotes(notes: string | undefined): string {
  const lines = (notes ?? "").replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n");
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (!isRule(lines[index])) continue;
    let next = index + 1;
    while (next < lines.length && lines[next].trim() === "") next += 1;
    if (next < lines.length && lines[next].trimStart().startsWith("**Downloads:**")) {
      return lines.slice(0, index).join("\n").trim();
    }
  }
  return lines.join("\n").trim();
}

function sectionHeading(line: string): string | null {
  const marker = /^#{2,3}[ \t]/.exec(line);
  if (!marker) return null;
  const heading = withoutClosingHashes(line.slice(marker[0].length));
  return heading || null;
}

export function outlineReleaseNotes(body: string): ReleaseNotesOutline {
  const lead: string[] = [];
  const sections: { heading: string; lines: string[] }[] = [];
  const text = body.replaceAll("\r\n", "\n");
  const fences = scanFences(text);
  let lineFrom = 0;
  for (const line of text.split("\n")) {
    const current = sections.at(-1);
    const inFence = fences.some((fence) => fence.from <= lineFrom && fence.to >= lineFrom);
    lineFrom += line.length + 1;
    const heading = inFence ? null : sectionHeading(line);
    if (heading) {
      sections.push({ heading, lines: [] });
      continue;
    }
    (current ? current.lines : lead).push(line);
  }
  return {
    lead: lead.join("\n").trim(),
    sections: sections.map(({ heading, lines }) => ({ heading, body: lines.join("\n").trim() })),
  };
}
