import {
  readFrontMatterScalar,
  readMarkdownDocumentSettings,
  setFrontMatterScalar,
} from "@/features/markdown-document-settings";
import { LINE_ICON_PREFIX, LINE_ICONS } from "./note-icons";
import type { NoteColor } from "./types";

export const NOTE_KIND = "note";
const BOM = "\uFEFF";
const OPENING_FENCE = /^\uFEFF?---[ \t]*(?:\r?\n|$)/u;
const FRONT_MATTER = /^﻿?---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/u;
const SUMMARY_LIMIT = 180;
const NOT_PROSE = /^(?:#{1,6}\s|```|~~~|\||[-*+]\s|\d+[.)]\s|>|\$\$|<|!\[|---|\*\*\*|___)/u;

export const NOTE_COLORS: readonly NoteColor[] = [
  "violet",
  "blue",
  "sky",
  "teal",
  "emerald",
  "lime",
  "amber",
  "orange",
  "rose",
  "pink",
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
  return text.replace(FRONT_MATTER, "");
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
  let fenced = false;
  for (const raw of body.split(/\r?\n/u)) {
    const line = raw.trim();
    if (/^(?:```|~~~)/u.test(line)) {
      fenced = !fenced;
      if (lines.length > 0) break;
      continue;
    }
    if (fenced) continue;
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

function scalar(text: string, key: string): string | undefined {
  const value = readFrontMatterScalar(text, key)?.trim();
  return value ? value : undefined;
}

export function readNoteFacts(text: string): NoteFacts {
  const title = scalar(text, "title") ?? null;
  const id = scalar(text, "id");
  const declared = scalar(text, "color")?.toLowerCase();
  return {
    title,
    id,
    icon: scalar(text, "icon"),
    color: isNoteColor(declared) ? declared : noteColorFor(id ?? title ?? ""),
    agent: scalar(text, "agent"),
    summary: noteSummary(noteBody(text)),
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
  const declared = scalar(opened, "kind") === NOTE_KIND ? opened : setFrontMatterScalar(opened, "kind", NOTE_KIND);
  return scalar(declared, "id") ? declared : setFrontMatterScalar(declared, "id", id ?? crypto.randomUUID());
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

export function withNoteTitle(text: string, title: string): string {
  return setFrontMatterScalar(text, "title", title);
}
