import {
  isTypstEscaped,
  isTypstIdentifierContinueAt,
  maskTypstSource,
  TYPST_LABEL_PATTERN,
  TYPST_NAME_CHARACTER_PATTERN,
  trimTypstReference,
  typstAutolinkEnd,
  typstIdentifierEnd,
  typstRawEnd,
} from "@oleafly/editor/typst-syntax";
import type { FileSymbols, Sym, SymKind } from "./types";

export { maskTypstSource, typstRawEnd } from "@oleafly/editor/typst-syntax";

type SymSpan = {
  readonly from: number;
  readonly to: number;
  readonly nameFrom: number;
  readonly nameTo: number;
};

type SectionHit = SymSpan & {
  readonly name: string;
  readonly level: number;
};

type LexFrame =
  | { mode: "markup"; inBrackets: boolean; depth: number }
  | { mode: "math" }
  | {
      mode: "code";
      line: boolean;
      parens: number;
      braces: number;
      started: boolean;
      inIdent: boolean;
    };

type CallArg = {
  readonly name: string | null;
  readonly valueFrom: number;
  readonly valueTo: number;
};

const KIND_MARKUP = 0;
const KIND_CODE = 1;
const KIND_STRING = 2;
const KIND_COMMENT = 3;
const KIND_RAW = 4;
const KIND_MATH = 5;
const KIND_ESCAPE = 6;

const LINE_KEYWORDS = new Set([
  "let",
  "set",
  "show",
  "import",
  "include",
  "if",
  "for",
  "while",
  "context",
  "return",
]);

const NON_HEADING_PREFIX_KEYWORDS = new Set(["let", "set", "show"]);

function resolveImport(from: string, raw: string): string | null {
  if (raw.startsWith("@") || raw.includes("://") || raw.startsWith("/")) return null;
  const parts = [...from.split("/").slice(0, -1), ...raw.replace(/^\.\//, "").split("/")];
  const normalized: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") normalized.pop();
    else normalized.push(part);
  }
  const target = normalized.join("/");
  const dot = target.indexOf(".", target.lastIndexOf("/") + 1);
  const hasExtension = dot >= 0 && dot < target.length - 1;
  return hasExtension ? target : `${target}.typ`;
}

function blockCommentEnd(text: string, from: number): number {
  let depth = 0;
  let index = from;
  while (index < text.length) {
    if (text.startsWith("/*", index)) {
      depth++;
      index += 2;
    } else if (text.startsWith("*/", index)) {
      depth--;
      index += 2;
      if (depth === 0) return index;
    } else {
      index++;
    }
  }
  return text.length;
}

function commentEndAt(text: string, index: number): number | null {
  if (text.startsWith("//", index)) {
    const newline = text.indexOf("\n", index);
    return newline < 0 ? text.length : newline;
  }
  if (text.startsWith("/*", index)) return blockCommentEnd(text, index);
  return null;
}

function closedStringEnd(text: string, from: number): number | null {
  let index = from + 1;
  while (index < text.length) {
    if (text[index] === "\\") index += 2;
    else if (text[index] === '"') return index;
    else index++;
  }
  return null;
}

function hasLineKeyword(text: string, hashOffset: number): boolean {
  let start = hashOffset + 1;
  while (text[start] === " " || text[start] === "\t") start++;
  const end = typstIdentifierEnd(text, start);
  return end > start && LINE_KEYWORDS.has(text.slice(start, end));
}

function insideBracketMarkup(stack: readonly LexFrame[]): boolean {
  for (let index = stack.length - 1; index >= 0; index--) {
    const frame = stack[index];
    if (frame.mode === "markup") return frame.inBrackets;
  }
  return false;
}

function scanTypstKinds(text: string): Uint8Array {
  const kinds = new Uint8Array(text.length);
  const stack: LexFrame[] = [{ mode: "markup", inBrackets: false, depth: 0 }];
  let index = 0;

  while (index < text.length) {
    const frame = stack.at(-1);
    if (!frame) {
      stack.push({ mode: "markup", inBrackets: false, depth: 0 });
      continue;
    }

    if (frame.mode === "markup") {
      const ch = text[index];
      if (ch === "\\") {
        const next = text[index + 1];
        const end = next === undefined || next === "\n" || next === "\r" ? index + 1 : index + 2;
        kinds.fill(KIND_ESCAPE, index, end);
        index = end;
        continue;
      }
      const link = typstAutolinkEnd(text, index);
      if (link !== null) {
        kinds.fill(KIND_ESCAPE, index, link);
        index = Math.max(link, index + 1);
        continue;
      }
      const commentEnd = commentEndAt(text, index);
      if (commentEnd !== null) {
        kinds.fill(KIND_COMMENT, index, commentEnd);
        index = Math.max(commentEnd, index + 1);
        continue;
      }
      if (ch === "`") {
        const end = typstRawEnd(text, index);
        kinds.fill(KIND_RAW, index, end);
        index = Math.max(end, index + 1);
        continue;
      }
      if (ch === "$") {
        kinds[index] = KIND_MATH;
        stack.push({ mode: "math" });
        index++;
        continue;
      }
      if (ch === "#") {
        kinds[index] = KIND_CODE;
        stack.push({
          mode: "code",
          line: hasLineKeyword(text, index),
          parens: 0,
          braces: 0,
          started: false,
          inIdent: false,
        });
        index++;
        continue;
      }
      if (frame.inBrackets) {
        if (ch === "[") {
          frame.depth++;
        } else if (ch === "]") {
          if (frame.depth === 0) {
            kinds[index] = KIND_CODE;
            stack.pop();
          } else {
            frame.depth--;
          }
        }
      }
      index++;
      continue;
    }

    if (frame.mode === "math") {
      const ch = text[index];
      if (ch === "\\") {
        const next = text[index + 1];
        const end = next === undefined || next === "\n" || next === "\r" ? index + 1 : index + 2;
        kinds.fill(KIND_MATH, index, end);
        index = end;
        continue;
      }
      const commentEnd = commentEndAt(text, index);
      if (commentEnd !== null) {
        kinds.fill(KIND_COMMENT, index, commentEnd);
        index = Math.max(commentEnd, index + 1);
        continue;
      }
      if (ch === '"') {
        const close = closedStringEnd(text, index);
        if (close !== null) {
          kinds.fill(KIND_STRING, index, close + 1);
          index = close + 1;
        } else {
          kinds[index] = KIND_MATH;
          index++;
        }
        continue;
      }
      if (ch === "#") {
        kinds[index] = KIND_CODE;
        stack.push({
          mode: "code",
          line: hasLineKeyword(text, index),
          parens: 0,
          braces: 0,
          started: false,
          inIdent: false,
        });
        index++;
        continue;
      }
      kinds[index] = KIND_MATH;
      if (ch === "$") stack.pop();
      index++;
      continue;
    }

    const commentEnd = commentEndAt(text, index);
    if (commentEnd !== null) {
      if (frame.parens === 0 && frame.braces === 0 && !frame.line) {
        stack.pop();
        continue;
      }
      frame.started = true;
      kinds.fill(KIND_COMMENT, index, commentEnd);
      index = Math.max(commentEnd, index + 1);
      continue;
    }

    const ch = text[index];
    if (ch === "`") {
      if (frame.parens === 0 && frame.braces === 0 && !frame.line && frame.started) {
        stack.pop();
        continue;
      }
      frame.started = true;
      frame.inIdent = false;
      const end = typstRawEnd(text, index);
      kinds.fill(KIND_RAW, index, end);
      index = Math.max(end, index + 1);
      continue;
    }

    if (frame.parens === 0 && frame.braces === 0) {
      if (frame.line) {
        if (ch === "\n" || ch === "\r") {
          stack.pop();
          continue;
        }
        if (ch === ";") {
          kinds[index] = KIND_CODE;
          stack.pop();
          index++;
          continue;
        }
        if ((ch === "]" && insideBracketMarkup(stack)) || ch === ")" || ch === "}") {
          stack.pop();
          continue;
        }
      } else if (!frame.started) {
        const identEnd = typstIdentifierEnd(text, index);
        if (identEnd > index) {
          frame.started = true;
          frame.inIdent = true;
          kinds.fill(KIND_CODE, index, identEnd);
          index = identEnd;
          continue;
        }
        if (ch !== "(" && ch !== "[" && ch !== "{" && ch !== '"') {
          stack.pop();
          continue;
        }
      } else {
        if (ch === ".") {
          const memberEnd = typstIdentifierEnd(text, index + 1);
          if (memberEnd > index + 1) {
            frame.inIdent = true;
            kinds.fill(KIND_CODE, index, memberEnd);
            index = memberEnd;
            continue;
          }
        }
        if (ch !== "(" && ch !== "[") {
          stack.pop();
          continue;
        }
      }
    }

    frame.started = true;
    frame.inIdent = false;
    if (ch === '"') {
      const close = closedStringEnd(text, index);
      if (close !== null) {
        kinds[index] = KIND_CODE;
        kinds.fill(KIND_STRING, index + 1, close);
        kinds[close] = KIND_CODE;
        index = close + 1;
      } else {
        kinds[index] = KIND_CODE;
        index++;
      }
      continue;
    }
    if (ch === "[") {
      kinds[index] = KIND_CODE;
      stack.push({ mode: "markup", inBrackets: true, depth: 0 });
      index++;
      continue;
    }
    kinds[index] = KIND_CODE;
    if (ch === "(") frame.parens++;
    else if (ch === "{") frame.braces++;
    else if (ch === ")" && frame.parens > 0) frame.parens--;
    else if (ch === "}" && frame.braces > 0) frame.braces--;
    index++;
  }

  return kinds;
}

function matchingCodeClose(text: string, kinds: Uint8Array, open: number): number {
  const expected = text[open] === "(" ? ")" : "]";
  let depth = 0;
  for (let index = open; index < text.length; index++) {
    if (kinds[index] !== KIND_CODE) continue;
    const ch = text[index];
    if (ch === "(" || ch === "[" || ch === "{") {
      depth++;
    } else if (ch === ")" || ch === "]" || ch === "}") {
      depth--;
      if (depth === 0) return ch === expected ? index : -1;
    }
  }
  return -1;
}

function skipIgnorable(text: string, kinds: Uint8Array, from: number, to: number): number {
  let cursor = from;
  while (cursor < to && (/\s/u.test(text[cursor]) || kinds[cursor] === KIND_COMMENT)) {
    cursor++;
  }
  return cursor;
}

function trimIgnorableEnd(text: string, kinds: Uint8Array, from: number, to: number): number {
  let cursor = to;
  while (cursor > from && (/\s/u.test(text[cursor - 1]) || kinds[cursor - 1] === KIND_COMMENT)) {
    cursor--;
  }
  return cursor;
}

function splitCallArgs(
  text: string,
  kinds: Uint8Array,
  openParen: number,
  closeParen: number,
): CallArg[] {
  const args: CallArg[] = [];
  let depth = 0;
  let segStart = openParen + 1;

  const pushArg = (segEnd: number) => {
    const start = skipIgnorable(text, kinds, segStart, segEnd);
    const end = trimIgnorableEnd(text, kinds, start, segEnd);
    if (start >= end) return;
    if (kinds[start] === KIND_CODE) {
      const identEnd = typstIdentifierEnd(text, start);
      if (identEnd > start) {
        const colon = skipIgnorable(text, kinds, identEnd, end);
        if (colon < end && text[colon] === ":" && kinds[colon] === KIND_CODE) {
          const valueFrom = skipIgnorable(text, kinds, colon + 1, end);
          args.push({
            name: text.slice(start, identEnd),
            valueFrom,
            valueTo: end,
          });
          return;
        }
      }
    }
    if (text.startsWith("..", start) && kinds[start] === KIND_CODE) return;
    args.push({ name: null, valueFrom: start, valueTo: end });
  };

  for (let index = openParen + 1; index < closeParen; index++) {
    if (kinds[index] !== KIND_CODE) continue;
    const ch = text[index];
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") depth--;
    else if (ch === "," && depth === 0) {
      pushArg(index);
      segStart = index + 1;
    }
  }
  pushArg(closeParen);
  return args;
}

function codeValueText(text: string, kinds: Uint8Array, from: number, to: number): string {
  let out = "";
  for (let index = from; index < to; index++) {
    if (kinds[index] === KIND_COMMENT || /\s/u.test(text[index])) continue;
    out += text[index];
  }
  return out;
}

function parseNonNegativeInt(raw: string): number | null {
  return /^\d+$/u.test(raw) ? Number.parseInt(raw, 10) : null;
}

function decodeTypstString(body: string): string {
  return body.replaceAll(/\\(u\{[0-9a-fA-F]+\}|.)/gu, (_match, escaped: string) => {
    if (escaped.startsWith("u{")) {
      const value = Number.parseInt(escaped.slice(2, -1), 16);
      return Number.isFinite(value) && value <= 0x10ffff ? String.fromCodePoint(value) : "";
    }
    if (escaped === "n" || escaped === "r" || escaped === "t") return " ";
    return escaped;
  });
}

function extractContentTitle(
  text: string,
  kinds: Uint8Array,
  from: number,
  to: number,
): { name: string; nameFrom: number; nameTo: number } | null {
  const nameFrom = skipIgnorable(text, kinds, from, to);
  const nameTo = trimIgnorableEnd(text, kinds, nameFrom, to);
  if (nameFrom >= nameTo) return null;
  let cleaned = "";
  for (let index = nameFrom; index < nameTo; index++) {
    cleaned += kinds[index] === KIND_COMMENT ? " " : text[index];
  }
  const name = cleaned.replace(/\s+/gu, " ").trim();
  if (!name) return null;
  return { name, nameFrom, nameTo };
}

function extractStringTitle(
  text: string,
  kinds: Uint8Array,
  from: number,
  to: number,
): { name: string; nameFrom: number; nameTo: number } | null {
  if (
    to - from < 2 ||
    text[from] !== '"' ||
    text[to - 1] !== '"' ||
    kinds[from] !== KIND_CODE ||
    kinds[to - 1] !== KIND_CODE
  ) {
    return null;
  }
  for (let index = from + 1; index < to - 1; index++) {
    if (kinds[index] !== KIND_STRING && text[index] !== "\n" && text[index] !== "\r") {
      return null;
    }
  }
  const name = decodeTypstString(text.slice(from + 1, to - 1))
    .replace(/\s+/gu, " ")
    .trim();
  if (!name) return null;
  return { name, nameFrom: from + 1, nameTo: to - 1 };
}

function precededByRuleKeyword(text: string, kinds: Uint8Array, identStart: number): boolean {
  let cursor = identStart - 1;
  while (cursor >= 0 && (/\s/u.test(text[cursor]) || kinds[cursor] === KIND_COMMENT)) {
    cursor--;
  }
  if (cursor < 0 || kinds[cursor] !== KIND_CODE) return false;
  let wordStart = cursor;
  while (wordStart > 0 && kinds[wordStart - 1] === KIND_CODE && isTypstIdentifierContinueAt(text, wordStart - 1)) {
    wordStart--;
  }
  const word = text.slice(wordStart, cursor + 1);
  return NON_HEADING_PREFIX_KEYWORDS.has(word);
}

function collectHeadingCalls(text: string, kinds: Uint8Array): SectionHit[] {
  const hits: SectionHit[] = [];
  for (let index = 0; index < text.length; index++) {
    if (kinds[index] !== KIND_CODE || !text.startsWith("heading", index)) continue;
    if (
      index > 0 &&
      (isTypstIdentifierContinueAt(text, index - 1) || text[index - 1] === ".")
    ) {
      continue;
    }
    const after = index + 7;
    const opener = text[after];
    if ((opener !== "[" && opener !== "(") || kinds[after] !== KIND_CODE) continue;
    if (precededByRuleKeyword(text, kinds, index)) continue;

    const callFrom =
      index > 0 && text[index - 1] === "#" && kinds[index - 1] === KIND_CODE
        ? index - 1
        : index;

    if (opener === "[") {
      const closeBracket = matchingCodeClose(text, kinds, after);
      if (closeBracket < 0) continue;
      const body = extractContentTitle(text, kinds, after + 1, closeBracket);
      if (body) {
        hits.push({
          from: callFrom,
          to: closeBracket + 1,
          name: body.name,
          nameFrom: body.nameFrom,
          nameTo: body.nameTo,
          level: 0,
        });
      }
      continue;
    }

    const closeParen = matchingCodeClose(text, kinds, after);
    if (closeParen < 0) continue;
    const args = splitCallArgs(text, kinds, after, closeParen);

    let outlinedArg: CallArg | undefined;
    let levelArg: CallArg | undefined;
    let depthArg: CallArg | undefined;
    let offsetArg: CallArg | undefined;
    let positionalBody: CallArg | undefined;
    for (const arg of args) {
      if (arg.name === "outlined") outlinedArg = arg;
      else if (arg.name === "level") levelArg = arg;
      else if (arg.name === "depth") depthArg = arg;
      else if (arg.name === "offset") offsetArg = arg;
      else if (arg.name === null && !positionalBody) positionalBody = arg;
    }

    if (outlinedArg && codeValueText(text, kinds, outlinedArg.valueFrom, outlinedArg.valueTo) === "false") {
      continue;
    }

    const explicitLevel = levelArg
      ? parseNonNegativeInt(codeValueText(text, kinds, levelArg.valueFrom, levelArg.valueTo))
      : null;
    let level = 0;
    if (explicitLevel !== null && explicitLevel >= 1) {
      level = explicitLevel - 1;
    } else {
      const depthVal = depthArg
        ? parseNonNegativeInt(codeValueText(text, kinds, depthArg.valueFrom, depthArg.valueTo))
        : null;
      const offsetVal = offsetArg
        ? parseNonNegativeInt(codeValueText(text, kinds, offsetArg.valueFrom, offsetArg.valueTo))
        : null;
      const depth = depthVal !== null && depthVal >= 1 ? depthVal : 1;
      const offset = offsetVal ?? 0;
      level = Math.max(0, offset + depth - 1);
    }

    const trailingOpen = closeParen + 1;
    if (text[trailingOpen] === "[" && kinds[trailingOpen] === KIND_CODE) {
      const closeBracket = matchingCodeClose(text, kinds, trailingOpen);
      if (closeBracket < 0) continue;
      const body = extractContentTitle(text, kinds, trailingOpen + 1, closeBracket);
      if (body) {
        hits.push({
          from: callFrom,
          to: closeBracket + 1,
          name: body.name,
          nameFrom: body.nameFrom,
          nameTo: body.nameTo,
          level,
        });
      }
      continue;
    }

    if (!positionalBody) continue;
    const { valueFrom, valueTo } = positionalBody;
    let body: { name: string; nameFrom: number; nameTo: number } | null = null;
    if (
      text[valueFrom] === "[" &&
      kinds[valueFrom] === KIND_CODE &&
      matchingCodeClose(text, kinds, valueFrom) === valueTo - 1
    ) {
      body = extractContentTitle(text, kinds, valueFrom + 1, valueTo - 1);
    } else {
      body = extractStringTitle(text, kinds, valueFrom, valueTo);
    }
    if (body) {
      hits.push({
        from: callFrom,
        to: closeParen + 1,
        name: body.name,
        nameFrom: body.nameFrom,
        nameTo: body.nameTo,
        level,
      });
    }
  }
  return hits;
}

function collectMarkerHeadings(
  text: string,
  kinds: Uint8Array,
  calls: readonly SectionHit[],
): SectionHit[] {
  const hits: SectionHit[] = [];
  let lineStart = 0;

  while (lineStart <= text.length) {
    const newline = text.indexOf("\n", lineStart);
    const rawLineEnd = newline < 0 ? text.length : newline;
    const lineEnd =
      rawLineEnd > lineStart && text[rawLineEnd - 1] === "\r" ? rawLineEnd - 1 : rawLineEnd;

    let eqStart = lineStart;
    while (
      eqStart < lineEnd &&
      (text[eqStart] === " " || text[eqStart] === "\t" || kinds[eqStart] === KIND_COMMENT)
    ) {
      eqStart++;
    }

    if (eqStart < lineEnd && text[eqStart] === "=" && kinds[eqStart] === KIND_MARKUP) {
      let eqEnd = eqStart;
      while (eqEnd < lineEnd && text[eqEnd] === "=" && kinds[eqEnd] === KIND_MARKUP) {
        eqEnd++;
      }
      const hasSeparator =
        eqEnd < lineEnd &&
        (text[eqEnd] === " " || text[eqEnd] === "\t" || kinds[eqEnd] === KIND_COMMENT);
      const insideCall = calls.some((call) => eqStart >= call.from && eqStart < call.to);

      if (hasSeparator && !insideCall) {
        let cleanRest = "";
        let labelCheckRest = "";
        for (let index = eqEnd; index < lineEnd; index++) {
          const kind = kinds[index];
          cleanRest += kind === KIND_COMMENT ? " " : text[index];
          labelCheckRest +=
            kind === KIND_COMMENT ? " " : kind === KIND_RAW ? "a" : text[index];
        }
        const trailingLabel = /(?<![ \t])[ \t]+<[^>]+>[ \t]*$/u.exec(labelCheckRest);
        const bodySlice = trailingLabel ? cleanRest.slice(0, trailingLabel.index) : cleanRest;
        const trimmedStart = bodySlice.length - bodySlice.trimStart().length;
        const trimmed = bodySlice.trim();
        if (trimmed) {
          const nameFrom = eqEnd + trimmedStart;
          const name = trimmed.replace(/[ \t]+/gu, (spaces, offset) => {
            const abs = nameFrom + offset;
            for (let index = abs; index < abs + spaces.length; index++) {
              if (kinds[index] === KIND_COMMENT) return " ";
            }
            return spaces;
          });
          hits.push({
            from: eqStart,
            to: lineEnd,
            name,
            nameFrom,
            nameTo: nameFrom + trimmed.length,
            level: eqEnd - eqStart - 1,
          });
        }
      }
    }

    if (newline < 0) break;
    lineStart = newline + 1;
  }

  return hits;
}

export function parseTypstFile(path: string, rawText: string): FileSymbols {
  const { text, code } = maskTypstSource(rawText);
  const kinds = scanTypstKinds(rawText);
  const defs: Sym[] = [];
  const uses: Sym[] = [];
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") starts.push(i + 1);
  const lineAt = (offset: number) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
  const push = (
    list: Sym[], kind: SymKind, name: string, span: SymSpan, extra?: Partial<Sym>,
  ) => list.push({ kind, name, file: path, line: lineAt(span.from), ...span, ...extra });

  const calls = collectHeadingCalls(rawText, kinds);
  const sections = [...calls, ...collectMarkerHeadings(rawText, kinds, calls)].sort(
    (left, right) => left.from - right.from,
  );
  for (const section of sections) {
    push(
      defs,
      "section",
      section.name,
      {
        from: section.from,
        to: section.to,
        nameFrom: section.nameFrom,
        nameTo: section.nameTo,
      },
      { level: section.level },
    );
  }

  const label = new RegExp(`<(${TYPST_LABEL_PATTERN})>`, "gu");
  for (const match of code.matchAll(label)) {
    if (isTypstEscaped(code, match.index)) continue;
    const nameFrom = match.index + 1;
    push(defs, "label", match[1], {
      from: match.index,
      to: match.index + match[0].length,
      nameFrom,
      nameTo: nameFrom + match[1].length,
    });
  }

  const atUse = new RegExp(
    `(?<!${TYPST_NAME_CHARACTER_PATTERN})@(${TYPST_LABEL_PATTERN})`,
    "gu",
  );
  for (const match of code.matchAll(atUse)) {
    if (isTypstEscaped(code, match.index)) continue;
    const name = trimTypstReference(match[1]);
    const at = match.index;
    const nameFrom = at + 1;
    push(uses, "atuse", name, {
      from: at,
      to: nameFrom + name.length,
      nameFrom,
      nameTo: nameFrom + name.length,
    });
  }

  const input = /#(?:include|import)\s+"([^"]+)"/g;
  for (const match of text.matchAll(input)) {
    const target = resolveImport(path, match[1]);
    if (!target) continue;
    const nameFrom = match.index + match[0].indexOf(match[1]);
    push(uses, "inputedge", match[1], {
      from: match.index,
      to: match.index + match[0].length,
      nameFrom,
      nameTo: nameFrom + match[1].length,
    }, { target });
  }
  return { file: path, defs, uses };
}
