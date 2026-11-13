import { type FencedLine, fencedLines } from "@/lib/code-fences";
import { frontMatterBody, frontMatterValues } from "@/lib/front-matter";
import { setScalar } from "@/lib/front-matter-yaml";
import { sourceHash } from "@/lib/project-intelligence/source";
import { NOTE_FILE_KIND } from "@/lib/project-notes";
import { trimTrailingCharacter } from "@/lib/trim-character";
import { LINE_ICON_PREFIX, LINE_ICONS } from "./note-icons";
import type { NoteColor } from "./types";

const SUMMARY_LIMIT = 180;
const NOT_PROSE = /^(?:#{1,6}\s|```|~~~|\||[-*+]\s|\d+[.)]\s|>|\$\$|<(?!mark data-color=")|!\[|---|\*\*\*|___)/u;

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
  return Number.parseInt(sourceHash(text), 16);
}

export function isNoteColor(value: string | undefined): value is NoteColor {
  return value !== undefined && (NOTE_COLORS as readonly string[]).includes(value);
}

export function noteColorFor(seed: string): NoteColor {
  return NOTE_COLORS[hashOf(seed) % NOTE_COLORS.length];
}

export function noteColorOf(declared: string | null | undefined, seed: string): NoteColor {
  const color = declared?.toLowerCase();
  return isNoteColor(color) ? color : noteColorFor(seed);
}

export function starterIcon(seed: string): string {
  const ids = Object.keys(LINE_ICONS);
  const index = hashOf(`icon:${seed}`) % ids.length;
  return `${LINE_ICON_PREFIX}${ids[index]}`;
}

function withLinkLabels(text: string): string {
  let result = "";
  let from = 0;
  let open = text.indexOf("[");
  while (open >= 0) {
    const close = text.indexOf("]", open + 1);
    if (close < 0) break;
    if (text[close + 1] === "(") {
      const end = text.indexOf(")", close + 2);
      if (end < 0) break;
      const start = text[open - 1] === "!" ? open - 1 : open;
      result += text.slice(from, start) + text.slice(open + 1, close);
      from = end + 1;
    }
    open = text.indexOf("[", Math.max(from, close + 1));
  }
  return result + text.slice(from);
}

function plainInline(line: string): string {
  const unmarked = line
    .replaceAll(/<mark data-color="[a-z]+">(.*?)<\/mark>/gu, "$1")
    .replaceAll(/(!\[[^\]]*\]\([^)]*\))\{width=\d{1,3}%\}/gu, "$1");
  return withLinkLabels(unmarked)
    .replaceAll(/==(?![\s=])(.+?)(?<!\s)==/gu, "$1")
    .replaceAll(/(\*\*|__|\*|_|`)(.+?)\1/gu, "$2")
    .replaceAll(/\s+/gu, " ")
    .trim();
}

function proseLine(raw: FencedLine): string | null {
  if (raw.fenced) return null;
  const line = raw.text.trim();
  return line === "" || NOT_PROSE.test(line) ? null : line;
}

export function noteSummary(body: string): string {
  const lines: string[] = [];
  for (const raw of fencedLines(body)) {
    const line = proseLine(raw);
    if (line !== null) lines.push(line);
    else if (lines.length > 0) break;
  }
  const text = plainInline(lines.join(" "));
  if (text.length <= SUMMARY_LIMIT) return text;
  const cut = text.slice(0, SUMMARY_LIMIT);
  const space = cut.lastIndexOf(" ");
  return `${(space > SUMMARY_LIMIT / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

export function readNoteFacts(text: string): NoteFacts {
  const values = frontMatterValues(text);
  const title = values.get("title") ?? null;
  const id = values.get("id");
  return {
    title,
    id,
    icon: values.get("icon"),
    color: noteColorOf(values.get("color"), id ?? title ?? ""),
    agent: values.get("agent"),
    summary: noteSummary(frontMatterBody(text)),
  };
}

export function withNoteIdentity(text: string, id?: string): string {
  const declared = frontMatterValues(text).get("kind") === NOTE_FILE_KIND ? text : setScalar(text, "kind", NOTE_FILE_KIND);
  if (declared === text && frontMatterValues(text).get("kind") !== NOTE_FILE_KIND) return text;
  return frontMatterValues(declared).get("id") ? declared : setScalar(declared, "id", id ?? crypto.randomUUID());
}

export function newNoteSource(title: string, body = "", agent?: string, id: string = crypto.randomUUID()): string {
  let text = setScalar("", "title", title);
  if (agent) text = setScalar(text, "agent", agent);
  text = setScalar(text, "icon", starterIcon(id));
  text = setScalar(text, "color", noteColorFor(id));
  text = withNoteIdentity(text, id);
  const rest = body.replace(/^\s+/u, "");
  return rest ? `${trimTrailingCharacter(text, "\n")}\n\n${rest}` : text;
}

export function withNoteIcon(text: string, icon: string | undefined): string {
  return setScalar(text, "icon", icon ?? null);
}

export function withNoteColor(text: string, color: NoteColor): string {
  return setScalar(text, "color", color);
}

export function withNoteTitle(text: string, title: string): string {
  return setScalar(text, "title", title);
}
