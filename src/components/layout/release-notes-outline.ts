import { scanFences } from "@/lib/code-fences";

export interface ReleaseNotesSection {
  heading: string;
  body: string;
  items: number;
}

export interface ReleaseNotesOutline {
  lead: string;
  sections: ReleaseNotesSection[];
}

const OPEN_SECTIONS = new Set(["added", "changed"]);
const FOLD_SECTION_ITEMS = 4;
const FOLD_OPEN_SECTION_ITEMS = 13;
const SHORT_LEAD_CHARS = 600;

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

function isTopLevelItem(line: string): boolean {
  return /^(?:[-*+]|\d{1,9}[.)])[ \t]/.test(line);
}

export function outlineReleaseNotes(body: string): ReleaseNotesOutline {
  const lead: string[] = [];
  const sections: { heading: string; lines: string[]; items: number }[] = [];
  const text = body.replaceAll("\r\n", "\n");
  const fences = scanFences(text);
  let lineFrom = 0;
  for (const line of text.split("\n")) {
    const current = sections[sections.length - 1];
    // From where the line starts, so an item that opens with a fence counts.
    const inFence = fences.some((fence) => fence.from <= lineFrom && fence.to >= lineFrom);
    lineFrom += line.length + 1;
    if (!inFence) {
      const heading = sectionHeading(line);
      if (heading) {
        sections.push({ heading, lines: [], items: 0 });
        continue;
      }
      if (current && isTopLevelItem(line)) current.items += 1;
    }
    (current ? current.lines : lead).push(line);
  }
  return {
    lead: lead.join("\n").trim(),
    sections: sections.map(({ heading, lines, items }) => ({ heading, body: lines.join("\n").trim(), items })),
  };
}

export function releaseSectionFolds(section: ReleaseNotesSection): boolean {
  const limit = OPEN_SECTIONS.has(section.heading.toLowerCase()) ? FOLD_OPEN_SECTION_ITEMS : FOLD_SECTION_ITEMS;
  return section.items >= limit;
}

export function leadStaysVisible(lead: string): boolean {
  if (!lead || lead.length > SHORT_LEAD_CHARS) return false;
  return !lead.split("\n").some(isTopLevelItem);
}
