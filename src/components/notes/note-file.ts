import { readFrontMatterScalar, setFrontMatterScalar } from "@/features/markdown-document-settings";

const FRONT_MATTER = /^﻿?---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/u;
const SUMMARY_LIMIT = 180;
const NOT_PROSE = /^(?:#{1,6}\s|```|~~~|\||[-*+]\s|\d+[.)]\s|>|\$\$|<|!\[|---|\*\*\*|___)/u;

export interface NoteFacts {
  title: string | null;
  icon?: string;
  agent?: string;
  summary: string;
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
  return {
    title: scalar(text, "title") ?? null,
    icon: scalar(text, "icon"),
    agent: scalar(text, "agent"),
    summary: noteSummary(noteBody(text)),
  };
}

export function newNoteSource(title: string, body = "", agent?: string): string {
  let text = setFrontMatterScalar("", "title", title);
  if (agent) text = setFrontMatterScalar(text, "agent", agent);
  const rest = body.replace(/^\s+/u, "");
  return rest ? `${text.replace(/\n*$/u, "\n\n")}${rest}` : text;
}

export function withNoteIcon(text: string, icon: string | undefined): string {
  return setFrontMatterScalar(text, "icon", icon ?? null);
}

export function withNoteTitle(text: string, title: string): string {
  return setFrontMatterScalar(text, "title", title);
}
