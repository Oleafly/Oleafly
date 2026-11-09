import { noteBody } from "./note-file";

export const PREVIEW_LIMIT = 3000;

const FENCE = /^ {0,3}(`{3,}|~{3,})/u;
const HEADING_ONE = /^ {0,3}#[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/u;

function closes(line: string, fence: string): boolean {
  const marker = FENCE.exec(line)?.[1];
  return marker !== undefined && marker[0] === fence[0] && marker.length >= fence.length && line.trim() === marker;
}

function blocksOf(body: string): string[] {
  const blocks: string[] = [];
  let current: string[] = [];
  let fence: string | null = null;
  for (const line of body.split(/\r?\n/u)) {
    if (fence !== null) {
      current.push(line);
      if (closes(line, fence)) fence = null;
      continue;
    }
    if (line.trim() === "") {
      if (current.length > 0) blocks.push(current.join("\n"));
      current = [];
      continue;
    }
    fence = FENCE.exec(line)?.[1] ?? null;
    current.push(line);
  }
  if (current.length > 0) blocks.push(current.join("\n"));
  return blocks;
}

function withoutTitle(blocks: string[], title: string | undefined): string[] {
  const wanted = title?.trim().toLocaleLowerCase();
  if (!wanted || blocks.length === 0) return blocks;
  const [first, ...rest] = blocks[0].split("\n");
  if (HEADING_ONE.exec(first)?.[1].trim().toLocaleLowerCase() !== wanted) return blocks;
  return rest.length > 0 ? [rest.join("\n"), ...blocks.slice(1)] : blocks.slice(1);
}

function cut(block: string): string {
  const lines: string[] = [];
  let size = 0;
  for (const line of block.split("\n")) {
    const next = size + (lines.length > 0 ? 1 : 0) + line.length;
    if (next > PREVIEW_LIMIT) break;
    lines.push(line);
    size = next;
  }
  if (lines.length > 0) return lines.join("\n");
  const start = block.slice(0, PREVIEW_LIMIT);
  const space = start.lastIndexOf(" ");
  return `${(space > PREVIEW_LIMIT / 2 ? start.slice(0, space) : start).trimEnd()}…`;
}

export function notePreviewSource(text: string, title?: string): string {
  const kept: string[] = [];
  let size = 0;
  for (const block of withoutTitle(blocksOf(noteBody(text)), title)) {
    const next = size + (kept.length > 0 ? 2 : 0) + block.length;
    if (next > PREVIEW_LIMIT) {
      if (kept.length === 0) kept.push(cut(block));
      break;
    }
    kept.push(block);
    size = next;
  }
  return kept.join("\n\n");
}
