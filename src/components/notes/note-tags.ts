import { nameTone, type Tone } from "@/components/ui/tones";

export interface TagRange {
  from: number;
  to: number;
  tag: string;
}

const TAG_RUN = /[\p{L}\p{N}_\-/]+/uy;
const NOT_DIGIT = /[^\p{N}]/u;
const SPACE = /\s/u;
const SCHEME_URL = /[A-Za-z][A-Za-z0-9+.-]*:\/\/\S*/uy;
const SCHEME_CHAR = /[A-Za-z0-9+.-]/u;

function stripSlashes(run: string): { lead: number; tag: string } {
  let start = 0;
  let end = run.length;
  while (start < end && run[start] === "/") start++;
  while (end > start && run[end - 1] === "/") end--;
  return { lead: start, tag: run.slice(start, end) };
}

export function isTagStart(text: string, index: number): boolean {
  if (text[index] !== "#") return false;
  if (index === 0) return true;
  const before = text[index - 1];
  return before === "(" || SPACE.test(before);
}

export function tagAt(text: string, index: number): TagRange | null {
  if (!isTagStart(text, index)) return null;
  TAG_RUN.lastIndex = index + 1;
  const run = TAG_RUN.exec(text)?.[0];
  if (!run) return null;
  const { lead, tag } = stripSlashes(run);
  if (!tag || !NOT_DIGIT.test(tag)) return null;
  return { from: index, to: index + 1 + lead + tag.length, tag };
}

function urlEnd(text: string, index: number): number {
  if (index > 0 && SCHEME_CHAR.test(text[index - 1])) return index;
  SCHEME_URL.lastIndex = index;
  const url = SCHEME_URL.exec(text)?.[0];
  return url ? index + url.length : index;
}

export function plainTextTags(text: string): TagRange[] {
  const found: TagRange[] = [];
  let index = 0;
  while (index < text.length) {
    const end = urlEnd(text, index);
    if (end > index) {
      index = end;
      continue;
    }
    const tag = tagAt(text, index);
    if (tag) {
      found.push(tag);
      index = tag.to;
      continue;
    }
    index++;
  }
  return found;
}

export function tagKey(tag: string): string {
  return tag.toLowerCase();
}

export function tagTone(tag: string): Tone {
  return nameTone(tagKey(tag.replace(/^#+/u, "")));
}
