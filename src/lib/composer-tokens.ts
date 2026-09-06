export type ComposerTokenKind = "text" | "skill" | "mention";

export interface ComposerToken {
  kind: ComposerTokenKind;
  start: number;
  end: number;
  value: string;
}

export interface ComposerTokenSources {
  skillIds?: readonly string[];
  paths?: Iterable<string>;
}

const TRAILING_PUNCTUATION = /[.,;:!?)\]}'"]+$/u;
const TRAILING_SLASHES = /\/+$/u;
const WHITESPACE = /\s/u;
const MENTION_LOOKBACK = 256;

export function normalizeMentionPath(value: string): string {
  return value.trim().replace(TRAILING_SLASHES, "");
}

function knownPathSet(paths: Iterable<string> | undefined): Set<string> {
  const known = new Set<string>();
  if (!paths) return known;
  for (const path of paths) {
    const normalized = normalizeMentionPath(path);
    if (normalized) known.add(normalized);
  }
  return known;
}

function skillTokenAt(
  text: string,
  skillIds: readonly string[],
): { start: number; end: number; value: string } | null {
  const start = text.length - text.trimStart().length;
  if (text.charAt(start) !== "/") return null;
  let best: string | null = null;
  for (const id of skillIds) {
    if (!id) continue;
    const token = `/${id}`;
    if (!text.startsWith(token, start)) continue;
    const next = text.charAt(start + token.length);
    if (next !== "" && !WHITESPACE.test(next)) continue;
    if (!best || id.length > best.length) best = id;
  }
  if (!best) return null;
  return { start, end: start + best.length + 1, value: best };
}

function mentionAt(
  text: string,
  index: number,
  known: ReadonlySet<string>,
): { end: number; value: string } | null {
  if (index > 0 && !WHITESPACE.test(text.charAt(index - 1))) return null;
  if (text.charAt(index + 1) === '"') {
    const close = text.indexOf('"', index + 2);
    if (close < 0) return null;
    const value = normalizeMentionPath(text.slice(index + 2, close));
    if (!value || !known.has(value)) return null;
    return { end: close + 1, value };
  }
  const raw = text.slice(index + 1).match(/^\S+/u)?.[0] ?? "";
  if (!raw) return null;
  for (const candidate of [raw, raw.replace(TRAILING_PUNCTUATION, "")]) {
    const value = normalizeMentionPath(candidate);
    if (value && known.has(value)) {
      return { end: index + 1 + candidate.length, value };
    }
  }
  return null;
}

export function tokenizeComposer(
  text: string,
  sources: ComposerTokenSources = {},
): ComposerToken[] {
  const skillIds = sources.skillIds ?? [];
  const known = knownPathSet(sources.paths);
  const tokens: ComposerToken[] = [];
  let plainStart = 0;
  const pushText = (end: number) => {
    if (end <= plainStart) return;
    tokens.push({
      kind: "text",
      start: plainStart,
      end,
      value: text.slice(plainStart, end),
    });
  };
  let index = 0;
  const skill = skillIds.length > 0 ? skillTokenAt(text, skillIds) : null;
  if (skill) {
    pushText(skill.start);
    tokens.push({ kind: "skill", ...skill });
    plainStart = skill.end;
    index = skill.end;
  }
  if (known.size > 0) {
    for (; index < text.length; index += 1) {
      if (text.charAt(index) !== "@") continue;
      const mention = mentionAt(text, index, known);
      if (!mention) continue;
      pushText(index);
      tokens.push({
        kind: "mention",
        start: index,
        end: mention.end,
        value: mention.value,
      });
      plainStart = mention.end;
      index = mention.end - 1;
    }
  }
  pushText(text.length);
  return tokens;
}

export function composerMentionPaths(
  text: string,
  paths: Iterable<string>,
): string[] {
  const seen = new Set<string>();
  for (const token of tokenizeComposer(text, { paths })) {
    if (token.kind === "mention") seen.add(token.value);
  }
  return [...seen];
}

export function mentionInsertText(path: string, isDir: boolean): string {
  const cleaned = normalizeMentionPath(path);
  const shown = isDir ? `${cleaned}/` : cleaned;
  return WHITESPACE.test(shown) ? `@"${shown}" ` : `@${shown} `;
}

export function activeMentionQuery(
  text: string,
  caret: number,
): { start: number; query: string } | null {
  const limit = Math.max(0, Math.min(caret, text.length));
  const floor = Math.max(0, limit - MENTION_LOOKBACK);
  for (let index = limit - 1; index >= floor; index -= 1) {
    if (text.charAt(index) !== "@") continue;
    if (index > 0 && !WHITESPACE.test(text.charAt(index - 1))) return null;
    const raw = text.slice(index + 1, limit);
    if (raw.startsWith('"')) {
      return raw.slice(1).includes('"') ? null : { start: index, query: raw.slice(1) };
    }
    return WHITESPACE.test(raw) ? null : { start: index, query: raw };
  }
  return null;
}

export function mentionTokenEnd(text: string, start: number): number {
  if (text.charAt(start + 1) === '"') {
    const close = text.indexOf('"', start + 2);
    if (close >= 0) return close + 1;
    return text.length;
  }
  const raw = text.slice(start + 1).match(/^\S*/u)?.[0] ?? "";
  return start + 1 + raw.length;
}
