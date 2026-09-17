export interface ScannedArgument {
  kind: "optional" | "mandatory";
  value: string;
}

export interface ScannedMacroArguments {
  starred: boolean;
  args: ScannedArgument[];
  end: number;
}

export interface EnvironmentParts {
  name: string;
  optional: string | null;
  body: string;
}

function skipWhitespace(source: string, index: number, limit: number): number {
  let cursor = index;
  while (cursor < limit && /\s/u.test(source[cursor])) cursor++;
  return cursor;
}

function braceDelta(character: string): number {
  if (character === "{") return 1;
  if (character === "}") return -1;
  return 0;
}

function delimiterDelta(character: string, open: string, close: string, braces: number): number {
  if (open === "{") return braceDelta(character);
  if (braces !== 0) return 0;
  if (character === open) return 1;
  if (character === close) return -1;
  return 0;
}

export function readBalanced(
  source: string,
  start: number,
  open: string,
  close: string,
  limit = source.length,
): number | null {
  if (source[start] !== open) return null;
  let depth = 0;
  let braces = 0;
  for (let cursor = start; cursor < limit; cursor++) {
    const character = source[cursor];
    if (character === "\\") {
      cursor++;
      continue;
    }
    braces += braceDelta(character);
    if (braces < 0) return null;
    depth += delimiterDelta(character, open, close, braces);
    if (depth === 0) return cursor + 1;
  }
  return null;
}

export function scanMacroArguments(
  source: string,
  offset: number,
  limit = source.length,
): ScannedMacroArguments {
  const args: ScannedArgument[] = [];
  let cursor = offset;
  let starred = false;
  if (source[cursor] === "*") {
    starred = true;
    cursor++;
  }
  let end = cursor;
  for (;;) {
    const next = skipWhitespace(source, cursor, limit);
    const opener = source[next];
    if (opener !== "[" && opener !== "{") break;
    const close = readBalanced(source, next, opener, opener === "[" ? "]" : "}", limit);
    if (close === null) break;
    args.push({
      kind: opener === "[" ? "optional" : "mandatory",
      value: source.slice(next + 1, close - 1),
    });
    cursor = close;
    end = close;
  }
  return { starred, args, end };
}

export function splitEnvironmentSource(source: string): EnvironmentParts | null {
  const begin = /^\\begin\{([^{}]+)\}/u.exec(source);
  if (!begin) return null;
  const name = begin[1];
  const endMarker = `\\end{${name}}`;
  if (!source.endsWith(endMarker)) return null;
  const contentEnd = source.length - endMarker.length;
  let bodyStart = begin[0].length;
  let optional: string | null = null;
  const optionalStart = skipWhitespace(source, bodyStart, contentEnd);
  if (source[optionalStart] === "[") {
    const close = readBalanced(source, optionalStart, "[", "]", contentEnd);
    if (close !== null) {
      optional = source.slice(optionalStart + 1, close - 1);
      bodyStart = close;
    }
  }
  return { name, optional, body: source.slice(bodyStart, contentEnd) };
}

export function stripLatexComments(source: string): string {
  let out = "";
  for (let cursor = 0; cursor < source.length; cursor++) {
    const character = source[cursor];
    if (character === "\\") {
      out += character + (source[cursor + 1] ?? "");
      cursor++;
      continue;
    }
    if (character === "%") {
      const lineEnd = source.indexOf("\n", cursor);
      if (lineEnd === -1) break;
      cursor = lineEnd - 1;
      continue;
    }
    out += character;
  }
  return out;
}

export function splitTopLevel(source: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let cursor = 0; cursor < source.length; cursor++) {
    const character = source[cursor];
    if (character === "\\") {
      if (depth === 0 && source.startsWith(separator, cursor)) {
        parts.push(source.slice(start, cursor));
        cursor += separator.length - 1;
        start = cursor + 1;
        continue;
      }
      cursor++;
      continue;
    }
    if (character === "{") depth++;
    else if (character === "}") depth--;
    else if (depth === 0 && source.startsWith(separator, cursor)) {
      parts.push(source.slice(start, cursor));
      cursor += separator.length - 1;
      start = cursor + 1;
    }
  }
  parts.push(source.slice(start));
  return parts;
}

export function findEnvironment(
  source: string,
  name: string,
): { start: number; end: number; inner: string } | null {
  const begin = `\\begin{${name}}`;
  const end = `\\end{${name}}`;
  const start = source.indexOf(begin);
  if (start === -1) return null;
  let depth = 0;
  let cursor = start;
  while (cursor < source.length) {
    if (source.startsWith(begin, cursor)) {
      depth++;
      cursor += begin.length;
      continue;
    }
    if (source.startsWith(end, cursor)) {
      depth--;
      if (depth === 0) {
        return {
          start,
          end: cursor + end.length,
          inner: source.slice(start + begin.length, cursor),
        };
      }
      cursor += end.length;
      continue;
    }
    cursor++;
  }
  return null;
}
