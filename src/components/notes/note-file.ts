import { readMarkdownDocumentSettings, setFrontMatterScalar } from "@/features/markdown-document-settings";
import { fencedLines } from "@/lib/code-fences";
import { frontMatterBody, frontMatterValue, splitFrontMatter, valuesOfLines } from "@/lib/front-matter";
import { NOTE_FILE_KIND } from "@/lib/project-notes";
import { LINE_ICON_PREFIX, LINE_ICONS } from "./note-icons";
import type { NoteColor } from "./types";

export const NOTE_KIND = NOTE_FILE_KIND;
const BOM = "\uFEFF";
const OPENING_FENCE = /^\uFEFF?---[ \t]*(?:\r?\n|$)/u;
const SUMMARY_LIMIT = 180;
const NOT_PROSE = /^(?:#{1,6}\s|```|~~~|\||[-*+]\s|\d+[.)]\s|>|\$\$|<|!\[|---|\*\*\*|___)/u;

export const NOTE_COLORS: readonly NoteColor[] = [
  "blue",
  "cream",
  "peach",
  "rose",
  "pink",
  "lilac",
  "sky",
  "aqua",
  "cyan",
  "mint",
  "spring",
];

export interface NoteFacts {
  title: string | null;
  id?: string;
  icon?: string;
  color: NoteColor;
  agent?: string;
  summary: string;
}

function hashOf(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function isNoteColor(value: string | undefined): value is NoteColor {
  return value !== undefined && (NOTE_COLORS as readonly string[]).includes(value);
}

export function noteColorFor(seed: string): NoteColor {
  return NOTE_COLORS[hashOf(seed) % NOTE_COLORS.length];
}

export function starterIcon(seed: string): string {
  const ids = Object.keys(LINE_ICONS);
  return `${LINE_ICON_PREFIX}${ids[hashOf(`icon:${seed}`) % ids.length]}`;
}

export function noteBody(text: string): string {
  return frontMatterBody(text);
}

function plainInline(line: string): string {
  return line
    .replace(/!?\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replace(/(\*\*|__|\*|_|`)(.+?)\1/gu, "$2")
    .replace(/\s+/gu, " ")
    .trim();
}

export function noteSummary(body: string): string {
  const lines: string[] = [];
  for (const raw of fencedLines(body)) {
    if (raw.fenced) {
      if (lines.length > 0) break;
      continue;
    }
    const line = raw.text.trim();
    if (line === "") {
      if (lines.length > 0) break;
      continue;
    }
    if (NOT_PROSE.test(line)) {
      if (lines.length > 0) break;
      continue;
    }
    lines.push(line);
  }
  const text = plainInline(lines.join(" "));
  if (text.length <= SUMMARY_LIMIT) return text;
  const cut = text.slice(0, SUMMARY_LIMIT);
  const space = cut.lastIndexOf(" ");
  return `${(space > SUMMARY_LIMIT / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

export function readNoteFacts(text: string): NoteFacts {
  const front = splitFrontMatter(text);
  const values = valuesOfLines(front?.lines ?? []);
  const title = values.get("title") ?? null;
  const id = values.get("id");
  const declared = values.get("color")?.toLowerCase();
  return {
    title,
    id,
    icon: values.get("icon"),
    color: isNoteColor(declared) ? declared : noteColorFor(id ?? title ?? ""),
    agent: values.get("agent"),
    summary: noteSummary(front ? front.body : text),
  };
}

function openFrontMatter(text: string): string | null {
  if (OPENING_FENCE.test(text)) return readMarkdownDocumentSettings(text).frontMatter === "present" ? text : null;
  const bom = text.startsWith(BOM) ? BOM : "";
  const rest = text.slice(bom.length);
  const newline = rest.includes("\r\n") ? "\r\n" : "\n";
  const gap = /^(?:\r?\n|$)/u.test(rest) ? "" : newline;
  return `${bom}---${newline}kind: ${NOTE_KIND}${newline}---${newline}${gap}${rest}`;
}

export function withNoteIdentity(text: string, id?: string): string {
  const opened = openFrontMatter(text);
  if (opened === null) return text;
  const declared = frontMatterValue(opened, "kind") === NOTE_KIND ? opened : setFrontMatterScalar(opened, "kind", NOTE_KIND);
  return frontMatterValue(declared, "id") ? declared : setFrontMatterScalar(declared, "id", id ?? crypto.randomUUID());
}

export function newNoteSource(title: string, body = "", agent?: string, id: string = crypto.randomUUID()): string {
  let text = setFrontMatterScalar("", "title", title);
  if (agent) text = setFrontMatterScalar(text, "agent", agent);
  text = setFrontMatterScalar(text, "icon", starterIcon(id));
  text = setFrontMatterScalar(text, "color", noteColorFor(id));
  text = withNoteIdentity(text, id);
  const rest = body.replace(/^\s+/u, "");
  return rest ? `${text.replace(/\n*$/u, "\n\n")}${rest}` : text;
}

export function withNoteIcon(text: string, icon: string | undefined): string {
  return setFrontMatterScalar(text, "icon", icon ?? null);
}

export function withNoteColor(text: string, color: NoteColor): string {
  return setFrontMatterScalar(text, "color", color);
}

export function withNoteTitle(text: string, title: string): string {
  return setFrontMatterScalar(text, "title", title);
}
