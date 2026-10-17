import type { PathReference } from "./types";

const FENCE = /^(?:[ \t]{0,3}>[ \t]?)*[ \t]{0,3}(`{3,}|~{3,})/;
const DEFINITION = /^[ \t]{0,3}\[(?!\^)[^\]\n]+\]:[ \t]*/gm;

function blank(characters: string[], from: number, to: number): void {
  for (let index = from; index < to; index += 1) {
    if (characters[index] !== "\n") characters[index] = " ";
  }
}

function maskFences(characters: string[], text: string): void {
  let offset = 0;
  let fence: string | null = null;
  for (const line of text.split(/(?<=\n)/)) {
    const marker = FENCE.exec(line)?.[1] ?? null;
    if (fence) {
      blank(characters, offset, offset + line.length);
      if (marker?.startsWith(fence[0]) && marker.length >= fence.length) fence = null;
    } else if (marker) {
      fence = marker;
      blank(characters, offset, offset + line.length);
    }
    offset += line.length;
  }
}

function maskInline(characters: string[]): void {
  const text = characters.join("");
  for (const comment of text.matchAll(/<!--[\s\S]*?(?:-->|$)/g)) {
    blank(characters, comment.index, comment.index + comment[0].length);
  }
  const visible = characters.join("");
  let index = 0;
  while (index < visible.length) {
    if (visible[index] !== "`") {
      index += 1;
      continue;
    }
    let runEnd = index + 1;
    while (visible[runEnd] === "`") runEnd += 1;
    const delimiter = visible.slice(index, runEnd);
    let close = visible.indexOf(delimiter, runEnd);
    while (close >= 0 && visible[close + delimiter.length] === "`") {
      close = visible.indexOf(delimiter, close + delimiter.length + 1);
    }
    if (close < 0) {
      index = runEnd;
      continue;
    }
    blank(characters, index, close + delimiter.length);
    index = close + delimiter.length;
  }
}

function wrappedDestination(text: string, cursor: number): PathReference | null {
  const close = text.indexOf(">", cursor + 1);
  const newline = text.indexOf("\n", cursor + 1);
  if (close < 0 || (newline >= 0 && newline < close)) return null;
  return pathPart(text, cursor + 1, close, true);
}

function bareDestinationEnd(text: string, cursor: number, inline: boolean): number {
  let depth = 0;
  let end = cursor;
  while (end < text.length && !/\s/.test(text[end])) {
    if (text[end] === "\\") {
      end += 2;
      continue;
    }
    if (inline && text[end] === "(") depth += 1;
    if (inline && text[end] === ")") {
      if (depth === 0) break;
      depth -= 1;
    }
    end += 1;
  }
  return end;
}

function destination(text: string, start: number, inline: boolean): PathReference | null {
  let cursor = start;
  while (text[cursor] === " " || text[cursor] === "\t") cursor += 1;
  if (text[cursor] === "<") return wrappedDestination(text, cursor);
  return pathPart(text, cursor, Math.min(bareDestinationEnd(text, cursor, inline), text.length), false);
}

function pathPart(text: string, from: number, to: number, wrapped: boolean): PathReference | null {
  const target = text.slice(from, to);
  const cut = target.search(/[#?]/);
  const raw = cut >= 0 ? target.slice(0, cut) : target;
  if (!raw) return null;
  return {
    language: "markdown",
    kind: "markdown",
    command: "link",
    from,
    to: from + raw.length,
    raw,
    ...(wrapped ? { wrapped } : {}),
  };
}

export function scanMarkdownReferences(source: string): PathReference[] {
  const characters = source.split("");
  maskFences(characters, source);
  maskInline(characters);
  const visible = characters.join("");
  const references: PathReference[] = [];
  for (let index = visible.indexOf("]("); index >= 0; index = visible.indexOf("](", index + 2)) {
    const found = destination(visible, index + 2, true);
    if (found) references.push(found);
  }
  for (const match of visible.matchAll(DEFINITION)) {
    const found = destination(visible, match.index + match[0].length, false);
    if (found) references.push({ ...found, command: "definition" });
  }
  return references
    .filter((found) => found.raw === source.slice(found.from, found.to))
    .sort((left, right) => left.from - right.from);
}
