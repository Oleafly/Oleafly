import type { CollabCommentMember } from "@/lib/tauri";

export interface MentionQuery {
  start: number;
  query: string;
}

export interface MentionSegment {
  text: string;
  mention: boolean;
}

export const MENTION_LIMIT = 8;
const MAX_QUERY = 40;
const WORD = /[\p{L}\p{N}_]/u;

function opensMention(text: string, index: number): boolean {
  const before = index > 0 ? text[index - 1] : "";
  return text[index] === "@" && before !== "@" && !WORD.test(before);
}

export function mentionQuery(text: string, caret: number): MentionQuery | null {
  const head = text.slice(Math.max(0, caret - MAX_QUERY - 1), caret);
  const at = head.lastIndexOf("@");
  if (at < 0) return null;
  const start = caret - head.length + at;
  const query = text.slice(start + 1, caret);
  if (/[\n\r@]/u.test(query) || query.startsWith(" ") || query.includes("  ")) return null;
  return opensMention(text, start) ? { start, query } : null;
}

function rank(member: CollabCommentMember, needle: string): number | null {
  if (!needle) return 0;
  const name = member.displayName.toLocaleLowerCase();
  const login = (member.login ?? "").toLocaleLowerCase();
  if (name.startsWith(needle)) return 0;
  if (login.startsWith(needle)) return 1;
  if (name.split(/\s+/u).some((word) => word.startsWith(needle))) return 2;
  if (name.includes(needle) || login.includes(needle)) return 3;
  return null;
}

export function matchMembers(
  members: readonly CollabCommentMember[],
  query: string,
  self: string | null,
  limit = MENTION_LIMIT,
): CollabCommentMember[] {
  const needle = query.trimStart().toLocaleLowerCase();
  return members
    .filter((member) => member.accountId !== self && member.displayName.trim() !== "")
    .flatMap((member) => {
      const score = rank(member, needle);
      return score === null ? [] : [{ member, score }];
    })
    .sort((left, right) => left.score - right.score || left.member.displayName.localeCompare(right.member.displayName))
    .slice(0, limit)
    .map(({ member }) => member);
}

export function insertMention(
  text: string,
  start: number,
  caret: number,
  member: CollabCommentMember,
): { text: string; caret: number } {
  const before = text.slice(0, start);
  const after = text.slice(caret);
  const handle = `@${member.displayName.trim()}`;
  const spaced = /^\s/u.test(after) ? handle : `${handle} `;
  return { text: `${before}${spaced}${after}`, caret: before.length + handle.length + 1 };
}

function handlesOf(members: readonly CollabCommentMember[]): string[] {
  const handles = new Set<string>();
  for (const member of members) {
    for (const handle of [member.displayName, member.login ?? ""]) {
      if (handle.trim()) handles.add(handle.trim());
    }
  }
  return [...handles].sort((left, right) => right.length - left.length);
}

function mentionAt(body: string, index: number, handles: readonly string[]): number {
  if (!opensMention(body, index)) return 0;
  for (const handle of handles) {
    const end = index + 1 + handle.length;
    const candidate = body.slice(index + 1, end);
    if (candidate.toLocaleLowerCase() !== handle.toLocaleLowerCase()) continue;
    if (end < body.length && WORD.test(body[end])) continue;
    return handle.length + 1;
  }
  return 0;
}

export function mentionSegments(body: string, members: readonly CollabCommentMember[]): MentionSegment[] {
  const handles = handlesOf(members);
  const segments: MentionSegment[] = [];
  let plain = "";
  let index = 0;
  while (index < body.length) {
    const length = handles.length > 0 ? mentionAt(body, index, handles) : 0;
    if (length === 0) {
      plain += body[index];
      index += 1;
      continue;
    }
    if (plain) segments.push({ text: plain, mention: false });
    plain = "";
    segments.push({ text: body.slice(index, index + length), mention: true });
    index += length;
  }
  if (plain || segments.length === 0) segments.push({ text: plain, mention: false });
  return segments;
}
