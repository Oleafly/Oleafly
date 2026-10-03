import {
  decodedWords,
  writeDecodedWords,
  writeProsePlaceholder,
  type DecodedLatexProse,
  type MaskSpan,
  type ProseMask,
} from "./latex-mask";
import { EMAIL_ADDRESS_PATTERN, type SpellingWord } from "./spelling-words";
import {
  isTypstIdentifierContinueAt,
  typstAutolinkEnd,
  typstIdentifierEnd,
  typstReferenceEnd,
} from "./typst-syntax";

export interface TypstWordRange {
  from: number;
  to: number;
  word: string;
}

export type DecodedTypstProse = DecodedLatexProse;

type RegionKind = "block" | "inline";

interface TypstRegion extends MaskSpan {
  kind: RegionKind;
}

interface TypstConstruct extends MaskSpan {
  text: string;
}

interface TypstExpression {
  start: number;
  runStart: number;
  kind: RegionKind;
  hasContent: boolean;
  segments: MaskSpan[];
}

type CodeCloser = ")" | "}";

type OpenCode = Record<CodeCloser, number>;

interface MarkupFrame {
  type: "markup";
  owner: TypstExpression | null;
  closes: boolean;
  depth: number;
  parent: MarkupFrame | null;
  savedCode: OpenCode;
}

interface CodeFrame {
  type: "code";
  owner: TypstExpression;
  close: CodeCloser;
}

interface StatementFrame {
  type: "statement";
  owner: TypstExpression;
}

interface ControlFrame {
  type: "control";
  owner: TypstExpression;
  loop: boolean;
  afterBody: boolean;
}

interface ChainFrame {
  type: "chain";
  owner: TypstExpression;
}

interface ExpressionFrame {
  type: "expression";
  owner: TypstExpression;
  root: boolean;
  skipSpace: boolean;
  started: boolean;
}

type TypstFrame =
  | MarkupFrame
  | CodeFrame
  | StatementFrame
  | ControlFrame
  | ChainFrame
  | ExpressionFrame;

interface TypstScan {
  masked: string;
  regions: TypstRegion[];
  constructs: TypstConstruct[];
}

const STATEMENT_KEYWORDS = new Set(["let", "set", "show", "import", "return"]);
const CONTROL_KEYWORDS = new Set(["if", "for", "while"]);
const EXPRESSION_KEYWORDS = new Set(["context", "include"]);

function blank(
  characters: string[],
  from: number,
  to: number,
): void {
  for (let index = from; index < to; index += 1) {
    if (
      characters[index] !== "\n" &&
      characters[index] !== "\r"
    ) {
      characters[index] = " ";
    }
  }
}

function endOfLine(text: string, from: number): number {
  const newline = text.indexOf("\n", from);
  return newline < 0 ? text.length : newline;
}

function closingQuote(text: string, from: number): number {
  for (let cursor = from; cursor < text.length; cursor += 1) {
    if (text[cursor] === "\\") {
      cursor += 1;
      continue;
    }
    if (text[cursor] === '"') return cursor + 1;
  }
  return text.length;
}

function closingBlockComment(text: string, from: number): number {
  let depth = 1;
  for (let cursor = from + 2; cursor < text.length; cursor += 1) {
    if (text.startsWith("/*", cursor)) {
      depth += 1;
      cursor += 1;
      continue;
    }
    if (!text.startsWith("*/", cursor)) continue;
    depth -= 1;
    cursor += 1;
    if (depth === 0) return cursor + 1;
  }
  return text.length;
}

function closingRawSpan(text: string, from: number): number {
  let width = 1;
  while (text[from + width] === "`") width += 1;
  const fence = "`".repeat(width);
  const close = text.indexOf(fence, from + width);
  return close < 0 ? text.length : close + width;
}

function closingMath(text: string, from: number): number {
  for (let cursor = from + 1; cursor < text.length; cursor += 1) {
    if (text[cursor] === "\\") {
      cursor += 1;
      continue;
    }
    if (text[cursor] === "$") return cursor + 1;
  }
  return text.length;
}

function isSpace(character: string | undefined): boolean {
  return character === " " || character === "\t";
}

function isDigit(character: string | undefined): boolean {
  return character !== undefined && character >= "0" && character <= "9";
}

function isHexDigit(character: string | undefined): boolean {
  return character !== undefined && /[\dA-Fa-f]/u.test(character);
}

function numberEnd(text: string, from: number): number {
  let end = from;
  while (isDigit(text[end])) end += 1;
  if (text[end] === "." && isDigit(text[end + 1])) {
    end += 1;
    while (isDigit(text[end])) end += 1;
  }
  while (end < text.length && /[\p{L}%]/u.test(text[end])) end += 1;
  return end;
}

function rawKind(text: string, from: number, to: number): RegionKind {
  return text.startsWith("```", from) || text.slice(from, to).includes("\n")
    ? "block"
    : "inline";
}

function mathKind(text: string, from: number, to: number): RegionKind {
  const display =
    to - from >= 3 &&
    text[to - 1] === "$" &&
    /\s/u.test(text[from + 1]) &&
    /\s/u.test(text[to - 2]);
  return display ? "block" : "inline";
}

function labelEnd(text: string, from: number): number | null {
  let end = typstReferenceEnd(text, from + 1);
  if (end === from + 1) return null;
  while (text[end] === "." || text[end] === ":") end += 1;
  return text[end] === ">" ? end + 1 : null;
}

function codeOpaqueEnd(text: string, cursor: number): number | null {
  const character = text[cursor];
  if (character === '"') return closingQuote(text, cursor + 1);
  if (text.startsWith("//", cursor)) return endOfLine(text, cursor);
  if (text.startsWith("/*", cursor)) return closingBlockComment(text, cursor);
  if (character === "`") return closingRawSpan(text, cursor);
  if (character === "$") return closingMath(text, cursor);
  return null;
}

function standsAlone(text: string, from: number, to: number): boolean {
  let before = from - 1;
  while (isSpace(text[before])) before -= 1;
  let after = to;
  while (isSpace(text[after])) after += 1;
  return (
    (before < 0 || text[before] === "\n") &&
    (after >= text.length || text[after] === "\n" || text[after] === "\r")
  );
}

class TypstScanner {
  readonly characters: string[];
  readonly regions: TypstRegion[] = [];
  readonly constructs: TypstConstruct[] = [];
  private readonly stack: TypstFrame[] = [];
  private markup: MarkupFrame;
  private openCode: OpenCode = { ")": 0, "}": 0 };

  constructor(private readonly text: string) {
    this.characters = text.split("");
    this.markup = {
      type: "markup",
      owner: null,
      closes: false,
      depth: 0,
      parent: null,
      savedCode: this.openCode,
    };
    this.stack.push(this.markup);
  }

  run(): void {
    let cursor = 0;
    while (cursor < this.text.length) cursor = this.step(cursor);
    while (this.stack.length > 1) this.pop(this.text.length);
  }

  mask(from: number, to: number, kind: RegionKind): number {
    if (to <= from) return to;
    blank(this.characters, from, to);
    const standalone =
      kind === "inline" && standsAlone(this.text, from, to);
    this.regions.push({ from, to, kind: standalone ? "block" : kind });
    return to;
  }

  private top(): TypstFrame {
    return this.stack.at(-1) ?? this.markup;
  }

  private step(cursor: number): number {
    const frame = this.top();
    switch (frame.type) {
      case "markup":
        return this.markupStep(frame, cursor);
      case "chain":
        return this.chainStep(frame, cursor);
      case "expression":
        return this.expressionStep(frame, cursor);
      case "control":
        return this.controlStep(frame, cursor);
      case "statement":
        return this.statementStep(frame, cursor);
      default:
        return this.codeStep(frame, cursor);
    }
  }

  private pushCode(owner: TypstExpression, close: CodeCloser): void {
    this.openCode[close] += 1;
    this.stack.push({ type: "code", owner, close });
  }

  private openContent(owner: TypstExpression, at: number): void {
    owner.hasContent = true;
    this.closeRun(owner, at + 1);
    this.markup = {
      type: "markup",
      owner,
      closes: true,
      depth: 0,
      parent: this.markup,
      savedCode: this.openCode,
    };
    this.openCode = { ")": 0, "}": 0 };
    this.stack.push(this.markup);
  }

  private pop(at: number): void {
    const frame = this.stack.pop();
    if (!frame) return;
    if (frame.type === "markup") {
      this.markup = frame.parent ?? this.markup;
      this.openCode = frame.savedCode;
      if (frame.owner) frame.owner.runStart = at;
      return;
    }
    if (frame.type === "code") this.openCode[frame.close] -= 1;
    if (frame.type === "expression" && frame.root) this.finish(frame.owner, at);
  }

  private closeRun(owner: TypstExpression, to: number): void {
    if (to > owner.runStart) {
      owner.segments.push({ from: owner.runStart, to });
    }
    owner.runStart = to;
  }

  private finish(owner: TypstExpression, at: number): void {
    this.closeRun(owner, at);
    const kind = owner.hasContent ? "block" : owner.kind;
    for (const segment of owner.segments) {
      this.mask(segment.from, segment.to, kind);
    }
  }

  private markupStep(frame: MarkupFrame, cursor: number): number {
    const character = this.text[cursor];
    if (character === "[") {
      frame.depth += 1;
      return cursor + 1;
    }
    if (character === "]") {
      if (frame.depth > 0) frame.depth -= 1;
      else if (frame.closes) this.pop(cursor);
      return cursor + 1;
    }
    if (character === "#") return this.startExpression(cursor);
    return this.markupToken(cursor);
  }

  private markupToken(cursor: number): number {
    const text = this.text;
    const character = text[cursor];
    if (character === "\\") return this.escape(cursor);
    const link = typstAutolinkEnd(text, cursor);
    if (link !== null) return this.mask(cursor, link, "inline");
    if (text.startsWith("//", cursor)) {
      return this.mask(cursor, endOfLine(text, cursor), "block");
    }
    if (text.startsWith("/*", cursor)) {
      return this.mask(cursor, closingBlockComment(text, cursor), "block");
    }
    if (character === "`") {
      const end = closingRawSpan(text, cursor);
      return this.mask(cursor, end, rawKind(text, cursor, end));
    }
    if (character === "$") {
      const end = closingMath(text, cursor);
      return this.mask(cursor, end, mathKind(text, cursor, end));
    }
    if (character === "<") {
      const end = labelEnd(text, cursor);
      if (end !== null) return this.mask(cursor, end, "block");
    }
    if (character === "@") {
      const end = typstReferenceEnd(text, cursor + 1);
      if (end > cursor + 1) return this.mask(cursor, end, "inline");
    }
    return cursor + 1;
  }

  private escape(cursor: number): number {
    const text = this.text;
    if (text.startsWith("u{", cursor + 1)) return this.unicodeEscape(cursor);
    const codePoint = text.codePointAt(cursor + 1);
    if (codePoint === undefined) return this.mask(cursor, cursor + 1, "block");
    const escaped = String.fromCodePoint(codePoint);
    if (escaped === "@" || /[\p{L}\p{N}\s]/u.test(escaped)) {
      return this.mask(cursor, cursor + 1, "block");
    }
    return this.mask(cursor, cursor + 1 + escaped.length, "block");
  }

  private unicodeEscape(cursor: number): number {
    const text = this.text;
    const digitsStart = cursor + 3;
    let end = digitsStart;
    while (isHexDigit(text[end])) end += 1;
    if (text[end] !== "}") return this.mask(cursor, end, "block");
    const digits = end - digitsStart;
    const value =
      digits > 0 && digits <= 6
        ? Number.parseInt(text.slice(digitsStart, end), 16)
        : Number.NaN;
    this.mask(cursor, end + 1, "block");
    if (value <= 0x10ffff && (value < 0xd800 || value > 0xdfff)) {
      this.constructs.push({
        from: cursor,
        to: end + 1,
        text: String.fromCodePoint(value),
      });
    }
    return end + 1;
  }

  private startExpression(cursor: number): number {
    const owner: TypstExpression = {
      start: cursor,
      runStart: cursor,
      kind: "inline",
      hasContent: false,
      segments: [],
    };
    this.stack.push({
      type: "expression",
      owner,
      root: true,
      skipSpace: false,
      started: false,
    });
    return cursor + 1;
  }

  private expressionStep(frame: ExpressionFrame, cursor: number): number {
    if (frame.started) {
      this.pop(cursor);
      return cursor;
    }
    frame.started = true;
    let at = cursor;
    if (frame.skipSpace) while (isSpace(this.text[at])) at += 1;
    const end = this.startAtom(frame.owner, at);
    if (end !== null) return end;
    if (frame.root) frame.owner.kind = "block";
    this.pop(at);
    return at;
  }

  private startAtom(owner: TypstExpression, at: number): number | null {
    const text = this.text;
    const character = text[at];
    const identifierEnd = typstIdentifierEnd(text, at);
    if (identifierEnd > at) return this.startIdentifier(owner, at, identifierEnd);
    if (character === "[") {
      this.stack.push({ type: "chain", owner });
      this.openContent(owner, at);
      return at + 1;
    }
    if (character !== "{" && character !== "(" && character !== '"' && !isDigit(character)) {
      return null;
    }
    this.stack.push({ type: "chain", owner });
    if (character === "{") this.pushCode(owner, "}");
    if (character === "(") this.pushCode(owner, ")");
    if (character === '"') return closingQuote(text, at + 1);
    return isDigit(character) ? numberEnd(text, at) : at + 1;
  }

  private startIdentifier(
    owner: TypstExpression,
    at: number,
    end: number,
  ): number {
    const name = this.text.slice(at, end);
    if (STATEMENT_KEYWORDS.has(name)) {
      owner.kind = "block";
      this.stack.push({ type: "statement", owner });
    } else if (CONTROL_KEYWORDS.has(name)) {
      owner.kind = "block";
      this.stack.push({
        type: "control",
        owner,
        loop: name !== "if",
        afterBody: false,
      });
    } else if (EXPRESSION_KEYWORDS.has(name)) {
      if (name === "include") owner.kind = "block";
      this.stack.push({
        type: "expression",
        owner,
        root: false,
        skipSpace: true,
        started: false,
      });
    } else {
      this.stack.push({ type: "chain", owner });
    }
    return end;
  }

  private chainStep(frame: ChainFrame, cursor: number): number {
    const character = this.text[cursor];
    if (character === "(") {
      this.pushCode(frame.owner, ")");
      return cursor + 1;
    }
    if (character === "[") {
      this.openContent(frame.owner, cursor);
      return cursor + 1;
    }
    if (character === ".") {
      const end = typstIdentifierEnd(this.text, cursor + 1);
      if (end > cursor + 1) return end;
    }
    this.pop(cursor);
    return cursor;
  }

  private codeStep(frame: CodeFrame, cursor: number): number {
    if (this.text[cursor] === frame.close) {
      this.pop(cursor + 1);
      return cursor + 1;
    }
    return this.codeToken(frame.owner, cursor);
  }

  private statementStep(frame: StatementFrame, cursor: number): number {
    const character = this.text[cursor];
    if (character === "\n") {
      this.pop(cursor);
      return cursor;
    }
    if (character === ";") {
      this.pop(cursor + 1);
      return cursor + 1;
    }
    return this.codeToken(frame.owner, cursor);
  }

  private controlStep(frame: ControlFrame, cursor: number): number {
    if (frame.afterBody) return this.afterControlBody(frame, cursor);
    const character = this.text[cursor];
    if (character === "\n" || character === ";") {
      this.pop(cursor);
      return cursor;
    }
    if (character === "[") {
      frame.afterBody = true;
      this.openContent(frame.owner, cursor);
      return cursor + 1;
    }
    if (character === "{") {
      frame.afterBody = true;
      this.pushCode(frame.owner, "}");
      return cursor + 1;
    }
    return this.codeToken(frame.owner, cursor);
  }

  private afterControlBody(frame: ControlFrame, cursor: number): number {
    frame.afterBody = false;
    let at = cursor;
    while (!frame.loop && isSpace(this.text[at])) at += 1;
    if (
      !frame.loop &&
      this.text.startsWith("else", at) &&
      !isTypstIdentifierContinueAt(this.text, at + 4)
    ) {
      return at + 4;
    }
    this.pop(cursor);
    return cursor;
  }

  private codeToken(owner: TypstExpression, cursor: number): number {
    const character = this.text[cursor];
    const opaque = codeOpaqueEnd(this.text, cursor);
    if (opaque !== null) return opaque;
    if (character === "(" || character === "{") {
      this.pushCode(owner, character === "(" ? ")" : "}");
      return cursor + 1;
    }
    if (character === "[") {
      this.openContent(owner, cursor);
      return cursor + 1;
    }
    if (character === ")" || character === "}" || character === "]") {
      return this.strayCloser(character, cursor);
    }
    return cursor + 1;
  }

  private strayCloser(character: string, cursor: number): number {
    const accepts = (frame: TypstFrame): boolean =>
      character === "]"
        ? frame.type === "markup"
        : frame.type === "code" && frame.close === character;
    const open =
      character === "]"
        ? this.markup.closes
        : this.openCode[character as CodeCloser] > 0;
    if (!open) return cursor + 1;
    while (!accepts(this.top())) this.pop(cursor);
    return cursor;
  }
}

function maskRemoteTargets(scanner: TypstScanner, source: string): void {
  const text = scanner.characters.join("");
  const patterns: [RegExp, string][] = [
    [/(?:https?:\/\/|www\.)[^\s<>()[\]{}]+/giu, text],
    [EMAIL_ADDRESS_PATTERN, source],
  ];
  for (const [pattern, input] of patterns) {
    for (const match of input.matchAll(pattern)) {
      if (match.index === undefined) continue;
      scanner.mask(match.index, match.index + match[0].length, "inline");
    }
  }
}

const TYPST_MARKUP_MARKERS = [
  /^[ \t]*(=+)(?=[ \t])/gmu,
  /^[ \t]*([-+])(?=[ \t])/gmu,
  /^[ \t]*(\/)(?=[ \t])/gmu,
];

function maskTypstMarkupMarkers(scanner: TypstScanner): void {
  const markup = scanner.characters.join("");
  for (const pattern of TYPST_MARKUP_MARKERS) {
    for (const match of markup.matchAll(pattern)) {
      if (match.index === undefined) continue;
      const marker = match[1];
      const markerOffset = match[0].lastIndexOf(marker);
      scanner.mask(
        match.index + markerOffset,
        match.index + markerOffset + marker.length,
        "block",
      );
    }
  }
}

function maskTypstDelimiters(scanner: TypstScanner): void {
  const { characters } = scanner;
  for (let index = 0; index < characters.length; index += 1) {
    if (
      (characters[index] === "[" ||
        characters[index] === "]" ||
        characters[index] === "*" ||
        characters[index] === "_") &&
      (index === 0 || characters[index - 1] !== "\\")
    ) {
      scanner.mask(index, index + 1, "block");
    }
  }
}

function separateRegions(regions: TypstRegion[]): TypstRegion[] {
  const sorted = [...regions].sort(
    (left, right) => left.from - right.from || right.to - left.to,
  );
  const separated: TypstRegion[] = [];
  let applied = 0;
  for (const region of sorted) {
    if (region.to <= applied) continue;
    separated.push({ ...region, from: Math.max(region.from, applied) });
    applied = region.to;
  }
  return separated;
}

function scanTypst(text: string): TypstScan {
  const scanner = new TypstScanner(text);
  scanner.run();
  maskRemoteTargets(scanner, text);
  maskTypstMarkupMarkers(scanner);
  maskTypstDelimiters(scanner);
  return {
    masked: scanner.characters.join(""),
    regions: separateRegions(scanner.regions),
    constructs: scanner.constructs,
  };
}

function decodeScan(text: string, scan: TypstScan): DecodedTypstProse {
  const { masked, constructs } = scan;
  if (constructs.length === 0) {
    return {
      text: masked,
      decoded: false,
      start: (index) => index,
      end: (index) => index + 1,
    };
  }
  const pieces: string[] = [];
  const starts: number[] = [];
  const ends: number[] = [];
  let cursor = 0;
  const keepUntil = (to: number) => {
    pieces.push(masked.slice(cursor, to));
    for (; cursor < to; cursor += 1) {
      starts.push(cursor);
      ends.push(cursor + 1);
    }
  };
  for (const construct of constructs) {
    keepUntil(construct.from);
    pieces.push(construct.text);
    for (let unit = 0; unit < construct.text.length; unit += 1) {
      starts.push(construct.from);
      ends.push(construct.to);
    }
    cursor = construct.to;
  }
  keepUntil(masked.length);
  return {
    text: pieces.join(""),
    decoded: true,
    start: (index) => starts[index] ?? text.length,
    end: (index) => ends[index] ?? text.length,
  };
}

/**
 * Produces a same-UTF-16-length Typst string containing only visible markup
 * prose. Code expressions, comments, math, raw blocks, labels, citations,
 * URLs, and email addresses become spaces while line breaks are retained.
 */
export function maskTypstToProse(text: string): string {
  return scanTypst(text).masked;
}

export function decodeTypstProse(text: string): DecodedTypstProse {
  return decodeScan(text, scanTypst(text));
}

export function maskTypstForProseRegions(text: string): ProseMask {
  const scan = scanTypst(text);
  const out = scan.masked.split("");
  const masked: MaskSpan[] = [];
  for (const region of scan.regions) {
    masked.push({ from: region.from, to: region.to });
    if (region.kind === "inline") {
      writeProsePlaceholder(out, text, region.from, region.to);
    }
  }
  const regions = writeDecodedWords(out, masked, text, decodeScan(text, scan));
  return { prose: out.join(""), masked: regions };
}

export function typstToProse(text: string): {
  prose: string;
  map: number[];
} {
  const decoded = decodeTypstProse(text);
  const source = decoded.text;
  let prose = "";
  const map: number[] = [];
  let pendingSpace = -1;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (/\s/u.test(character)) {
      if (prose.length > 0) pendingSpace = decoded.start(index);
      continue;
    }
    if (pendingSpace >= 0) {
      prose += " ";
      map.push(pendingSpace);
      pendingSpace = -1;
    }
    prose += character;
    const lastUnit =
      index + 1 >= source.length ||
      decoded.start(index + 1) !== decoded.start(index);
    map.push(lastUnit ? decoded.end(index) - 1 : decoded.start(index));
  }
  return { prose, map };
}

export function typstSpellcheckRanges(
  text: string,
): SpellingWord[] {
  return decodedWords(decodeTypstProse(text), text).filter(
    (range) => range.word.length >= 2,
  );
}
