import { countedWordStarts, maskTypstToProse } from "@oleafly/editor";
import {
  isTypstIdentifierContinueAt,
  typstAutolinkEnd,
  typstIdentifierEnd,
  typstReferenceEnd,
} from "@oleafly/editor/typst-syntax";

export interface TypstDocumentSummary {
  words: number;
  wordsInText: number;
  wordsInHeaders: number;
  wordsOutsideText: number;
  headingsByLevel: number[];
  figures: number;
  tables: number;
  mathInline: number;
  mathDisplayed: number;
  citations: number;
  footnotes: number;
  labels: number;
}

export interface TypstDocumentCounts {
  summary: TypstDocumentSummary;
  characters: number;
  lines: number;
}

export interface TypstDocumentScan {
  prose: string;
  classes: Uint8Array;
  headingLevels: number[];
  figures: number;
  tables: number;
  footnotes: number;
  cites: number;
  references: string[];
  labels: Set<string>;
  labelCount: number;
  mathInline: number;
  mathDisplayed: number;
}

const TEXT = 0;
const HEADER = 1;
const OUTSIDE = 2;
const UNCOUNTED = 3;

const NO_CALL = 0;
const OTHER_CALL = 1;
const FIGURE = 2;
const TABLE = 3;
const FOOTNOTE = 4;
const CITE = 5;
const HEADING = 6;

const MARKUP = 0;
const PAREN = 1;
const BRACE = 2;
const STATEMENT = 3;
const CHAIN = 4;
const COND = 5;

const CONDITION = 0;
const AFTER_BODY = 1;
const ELSE_BODY = 2;
const DONE = 3;

const MAX_HEADING_LEVEL = 6;
const MAX_LEVEL_DIGITS = 3;

const NEWLINE = 0x0a;
const CARRIAGE_RETURN = 0x0d;
const SPACE = 0x20;
const TAB = 0x09;
const QUOTE = 0x22;
const HASH = 0x23;
const DOLLAR = 0x24;
const OPEN_PAREN = 0x28;
const CLOSE_PAREN = 0x29;
const STAR = 0x2a;
const DOT = 0x2e;
const SLASH = 0x2f;
const COLON = 0x3a;
const SEMICOLON = 0x3b;
const LESS = 0x3c;
const EQUALS = 0x3d;
const GREATER = 0x3e;
const AT = 0x40;
const OPEN_BRACKET = 0x5b;
const BACKSLASH = 0x5c;
const CLOSE_BRACKET = 0x5d;
const BACKTICK = 0x60;
const OPEN_BRACE = 0x7b;
const CLOSE_BRACE = 0x7d;

const CALLEES = new Map<string, number>([
  ["figure", FIGURE],
  ["table", TABLE],
  ["footnote", FOOTNOTE],
  ["cite", CITE],
  ["heading", HEADING],
]);

const DEFINITION_KEYWORDS = new Set(["let", "set", "import", "include"]);
const BLOCK_KEYWORDS = new Set(["if", "for", "while"]);

const WORD_CHARACTER = /[\p{L}\p{M}\p{N}]/u;
const ESCAPE_KEEPS_NEXT = /[\p{L}\p{N}\s]/u;

interface Frame {
  kind: number;
  cls: number;
  top: boolean;
  depth: number;
  heading: boolean;
  atLineStart: boolean;
  callee: number;
  headingIndex: number;
  state: number;
}

function frame(kind: number, cls: number, callee = NO_CALL): Frame {
  return {
    kind,
    cls,
    top: false,
    depth: 0,
    heading: false,
    atLineStart: true,
    callee,
    headingIndex: -1,
    state: CONDITION,
  };
}

function isSpace(unit: number): boolean {
  return (
    (unit >= 0x09 && unit <= 0x0d) ||
    unit === 0x20 ||
    unit === 0xa0 ||
    unit === 0x1680 ||
    (unit >= 0x2000 && unit <= 0x200a) ||
    unit === 0x2028 ||
    unit === 0x2029 ||
    unit === 0x202f ||
    unit === 0x205f ||
    unit === 0x3000 ||
    unit === 0xfeff
  );
}

function isInlineSpace(unit: number): boolean {
  return unit === SPACE || unit === TAB;
}

function isDigit(unit: number): boolean {
  return unit >= 0x30 && unit <= 0x39;
}

function isHexDigit(unit: number): boolean {
  return isDigit(unit) || (unit >= 0x41 && unit <= 0x46) || (unit >= 0x61 && unit <= 0x66);
}

function isAsciiLetter(unit: number): boolean {
  return (unit >= 0x41 && unit <= 0x5a) || (unit >= 0x61 && unit <= 0x7a);
}

function isCloser(unit: number): boolean {
  return unit === CLOSE_PAREN || unit === CLOSE_BRACKET || unit === CLOSE_BRACE;
}

function calleeClass(cls: number, callee: number): number {
  if (cls === UNCOUNTED) return UNCOUNTED;
  if (callee === FOOTNOTE) return OUTSIDE;
  if (callee === HEADING) return HEADER;
  return cls;
}

function calleeOf(name: string): number {
  return CALLEES.get(name) ?? OTHER_CALL;
}

function escapeEnd(text: string, at: number): number {
  const next = text.codePointAt(at + 1);
  if (next === undefined) return at + 1;
  if (text.startsWith("u{", at + 1)) {
    let end = at + 3;
    while (end < text.length && isHexDigit(text.charCodeAt(end))) end += 1;
    if (text.charCodeAt(end) === CLOSE_BRACE) end += 1;
    return end;
  }
  const escaped = String.fromCodePoint(next);
  if (next === AT || ESCAPE_KEEPS_NEXT.test(escaped)) return at + 1;
  return at + 1 + escaped.length;
}

function lineEnd(text: string, from: number): number {
  const newline = text.indexOf("\n", from);
  return newline < 0 ? text.length : newline;
}

function blockCommentEnd(text: string, at: number): number {
  let depth = 1;
  let end = at + 2;
  while (end < text.length && depth > 0) {
    if (text.startsWith("/*", end)) {
      depth += 1;
      end += 2;
    } else if (text.startsWith("*/", end)) {
      depth -= 1;
      end += 2;
    } else {
      end += 1;
    }
  }
  return Math.min(end, text.length);
}

function rawEnd(text: string, at: number): number {
  let width = 1;
  while (text.charCodeAt(at + width) === BACKTICK) width += 1;
  let run = 0;
  for (let index = at + width; index < text.length; index += 1) {
    if (text.charCodeAt(index) !== BACKTICK) {
      run = 0;
      continue;
    }
    run += 1;
    if (run === width) return index + 1;
  }
  return text.length;
}

function quoteEnd(text: string, from: number): number {
  for (let index = from; index < text.length; index += 1) {
    const unit = text.charCodeAt(index);
    if (unit === BACKSLASH) {
      index += 1;
      continue;
    }
    if (unit === QUOTE) return index + 1;
  }
  return text.length;
}

function numberEnd(text: string, at: number): number {
  let end = at;
  while (end < text.length && isDigit(text.charCodeAt(end))) end += 1;
  if (text.charCodeAt(end) === DOT && isDigit(text.charCodeAt(end + 1))) {
    end += 1;
    while (end < text.length && isDigit(text.charCodeAt(end))) end += 1;
  }
  while (end < text.length && isAsciiLetter(text.charCodeAt(end))) end += 1;
  if (text.charCodeAt(end) === 0x25) end += 1;
  return end;
}

function labelEnd(text: string, at: number): number {
  let end = typstReferenceEnd(text, at + 1);
  if (end === at + 1) return -1;
  while (text.charCodeAt(end) === DOT || text.charCodeAt(end) === COLON) end += 1;
  return text.charCodeAt(end) === GREATER ? end + 1 : -1;
}

function codePointBefore(text: string, at: number): number {
  const last = text.charCodeAt(at - 1);
  if (last >= 0xdc00 && last <= 0xdfff && at >= 2) {
    const high = text.charCodeAt(at - 2);
    if (high >= 0xd800 && high <= 0xdbff) return text.codePointAt(at - 2) ?? last;
  }
  return last;
}

interface MathSpan {
  end: number;
  display: boolean;
}

function mathSpan(text: string, at: number): MathSpan {
  let end = at + 1;
  while (end < text.length) {
    const unit = text.charCodeAt(end);
    if (unit === BACKSLASH) {
      end += 2;
      continue;
    }
    if (unit === DOLLAR) {
      const display =
        end > at + 1 &&
        isSpace(text.charCodeAt(at + 1)) &&
        isSpace(text.charCodeAt(end - 1));
      return { end: end + 1, display };
    }
    end += 1;
  }
  return { end: text.length, display: false };
}

function blankRun(text: string): string {
  return text.replace(/[^\n\r]/g, " ");
}

class TypstScanner {
  private readonly n: number;
  private readonly stack: Frame[] = [];
  private readonly blanks: number[] = [];
  private lastIdentEnd = -1;
  private lastIdentCallee = NO_CALL;
  private lastCallEnd = -1;
  private lastCallCallee = NO_CALL;
  readonly classes: Uint8Array;
  readonly headingLevels: number[] = [];
  readonly references: string[] = [];
  readonly labels = new Set<string>();
  labelCount = 0;
  figures = 0;
  tables = 0;
  footnotes = 0;
  cites = 0;
  mathInline = 0;
  mathDisplayed = 0;

  constructor(private readonly text: string) {
    this.n = text.length;
    this.classes = new Uint8Array(text.length);
  }

  scan(): string {
    const top = frame(MARKUP, TEXT);
    top.top = true;
    this.stack.push(top);
    let index = 0;
    while (index < this.n) {
      const current = this.stack[this.stack.length - 1];
      if (current.kind === MARKUP) index = this.markupStep(current, index);
      else if (current.kind === CHAIN) index = this.chainStep(current, index);
      else if (current.kind === COND) index = this.condStep(current, index);
      else index = this.codeStep(current, index);
    }
    return this.prose();
  }

  private unit(index: number): number {
    return this.text.charCodeAt(index);
  }

  private push(next: Frame): void {
    this.stack.push(next);
  }

  private pop(): void {
    this.stack.pop();
  }

  private replaceTop(next: Frame): void {
    this.stack[this.stack.length - 1] = next;
  }

  private emit(from: number, to: number, kept: boolean, cls: number): void {
    const end = Math.min(to, this.n);
    if (from >= end) return;
    if (kept) {
      if (cls !== TEXT) this.classes.fill(cls, from, end);
      return;
    }
    const last = this.blanks.length - 1;
    if (last > 0 && this.blanks[last] === from) {
      this.blanks[last] = end;
      return;
    }
    this.blanks.push(from, end);
  }

  private code(from: number, to: number): void {
    this.emit(from, to, false, UNCOUNTED);
  }

  private prose(): string {
    const parts: string[] = [];
    let previous = 0;
    for (let index = 0; index < this.blanks.length; index += 2) {
      const from = this.blanks[index];
      const to = this.blanks[index + 1];
      parts.push(this.text.slice(previous, from), blankRun(this.text.slice(from, to)));
      previous = to;
    }
    parts.push(this.text.slice(previous));
    return parts.join("");
  }

  private registerCall(callee: number, cls: number): number {
    if (cls === UNCOUNTED) return -1;
    if (callee === FIGURE) this.figures += 1;
    else if (callee === TABLE) this.tables += 1;
    else if (callee === FOOTNOTE) this.footnotes += 1;
    else if (callee === CITE) this.cites += 1;
    else if (callee === HEADING) {
      this.headingLevels.push(1);
      return this.headingLevels.length - 1;
    }
    return -1;
  }

  private trailingCallee(index: number, cls: number): number {
    if (this.lastIdentEnd === index) {
      this.registerCall(this.lastIdentCallee, cls);
      return this.lastIdentCallee;
    }
    if (this.lastCallEnd === index) return this.lastCallCallee;
    return NO_CALL;
  }

  private openParen(index: number, cls: number): number {
    const direct = this.lastIdentEnd === index;
    const callee = direct ? this.lastIdentCallee : NO_CALL;
    const paren = frame(PAREN, calleeClass(cls, callee), callee);
    if (direct) paren.headingIndex = this.registerCall(callee, cls);
    this.code(index, index + 1);
    this.push(paren);
    return index + 1;
  }

  private openContent(index: number, cls: number, callee: number): number {
    this.code(index, index + 1);
    this.push(frame(MARKUP, cls, callee));
    return index + 1;
  }

  private countMath(span: MathSpan): void {
    if (span.display) this.mathDisplayed += 1;
    else this.mathInline += 1;
  }

  private showClass(from: number, cls: number): number {
    let index = from;
    while (index < this.n && isInlineSpace(this.unit(index))) index += 1;
    return this.unit(index) === COLON ? cls : UNCOUNTED;
  }

  private isCaptionArgument(index: number): boolean {
    let cursor = index - 1;
    while (cursor >= 0 && isSpace(this.unit(cursor))) cursor -= 1;
    if (cursor < 0 || this.unit(cursor) !== COLON) return false;
    cursor -= 1;
    while (cursor >= 0 && isSpace(this.unit(cursor))) cursor -= 1;
    const start = cursor - 6;
    if (start < 0 || !this.text.startsWith("caption", start)) return false;
    return start === 0 || !isTypstIdentifierContinueAt(this.text, start - 1);
  }

  private headingLevel(paren: Frame, from: number): void {
    let index = from;
    while (index < this.n && isInlineSpace(this.unit(index))) index += 1;
    if (this.unit(index) !== COLON) return;
    index += 1;
    while (index < this.n && isInlineSpace(this.unit(index))) index += 1;
    let value = 0;
    let digits = 0;
    while (digits < MAX_LEVEL_DIGITS && index < this.n && isDigit(this.unit(index))) {
      value = value * 10 + (this.unit(index) - 0x30);
      index += 1;
      digits += 1;
    }
    if (digits === 0) return;
    this.headingLevels[paren.headingIndex] = Math.min(Math.max(value, 1), MAX_HEADING_LEVEL);
  }

  private markupStep(current: Frame, index: number): number {
    let cls = current.cls;
    if (cls !== UNCOUNTED && current.heading) cls = HEADER;
    const kept = cls !== UNCOUNTED;
    const unit = this.unit(index);
    if (unit === NEWLINE || unit === CARRIAGE_RETURN) {
      current.heading = false;
      current.atLineStart = true;
      this.emit(index, index + 1, kept, cls);
      return index + 1;
    }
    if (isInlineSpace(unit)) {
      this.emit(index, index + 1, kept, cls);
      return index + 1;
    }
    if (unit === EQUALS && current.atLineStart) {
      current.atLineStart = false;
      let end = index;
      while (end < this.n && this.unit(end) === EQUALS) end += 1;
      this.emit(index, end, kept, cls);
      if (kept && end < this.n && isInlineSpace(this.unit(end))) {
        this.headingLevels.push(Math.min(end - index, MAX_HEADING_LEVEL));
        current.heading = true;
      }
      return end;
    }
    current.atLineStart = false;
    const end = this.markupTokenEnd(index, unit, kept);
    if (end > index) {
      this.emit(index, end, kept, cls);
      return end;
    }
    if (unit === HASH) {
      this.code(index, index + 1);
      return this.embedded(index + 1, cls);
    }
    if (!current.top && unit === OPEN_BRACKET) current.depth += 1;
    if (!current.top && unit === CLOSE_BRACKET) {
      if (current.depth === 0) {
        this.pop();
        this.code(index, index + 1);
        if (current.callee !== NO_CALL) {
          this.lastCallEnd = index + 1;
          this.lastCallCallee = current.callee;
        }
        return index + 1;
      }
      current.depth -= 1;
    }
    this.emit(index, index + 1, kept, cls);
    return index + 1;
  }

  private markupTokenEnd(index: number, unit: number, counted: boolean): number {
    const text = this.text;
    if (unit === BACKSLASH) return escapeEnd(text, index);
    const link = typstAutolinkEnd(text, index);
    if (link !== null) return link;
    const next = this.unit(index + 1);
    if (unit === SLASH && next === SLASH) return lineEnd(text, index + 2);
    if (unit === SLASH && next === STAR) return blockCommentEnd(text, index);
    if (unit === BACKTICK) return rawEnd(text, index);
    if (unit === DOLLAR) {
      const span = mathSpan(text, index);
      if (counted) this.countMath(span);
      return span.end;
    }
    if (unit === LESS) {
      const end = labelEnd(text, index);
      if (end < 0) return index;
      if (counted) {
        this.labelCount += 1;
        this.labels.add(text.slice(index + 1, end - 1));
      }
      return end;
    }
    if (unit === AT) {
      const end = typstReferenceEnd(text, index + 1);
      if (end <= index + 1) return index;
      const glued =
        index > 0 && WORD_CHARACTER.test(String.fromCodePoint(codePointBefore(text, index)));
      if (counted && !glued) this.references.push(text.slice(index + 1, end));
      return end;
    }
    return index;
  }

  private embedded(start: number, cls: number): number {
    const chain = frame(CHAIN, cls);
    this.push(chain);
    let index = start;
    for (;;) {
      if (index >= this.n) {
        this.pop();
        return index;
      }
      const unit = this.unit(index);
      if (unit === OPEN_BRACE) {
        this.code(index, index + 1);
        this.push(frame(BRACE, cls));
        return index + 1;
      }
      if (unit === OPEN_PAREN) {
        this.code(index, index + 1);
        this.push(frame(PAREN, cls));
        return index + 1;
      }
      if (unit === OPEN_BRACKET) return this.openContent(index, cls, NO_CALL);
      if (unit === QUOTE) {
        const end = quoteEnd(this.text, index + 1);
        this.code(index, end);
        return end;
      }
      const end = typstIdentifierEnd(this.text, index);
      if (end > index) {
        const name = this.text.slice(index, end);
        this.code(index, end);
        if (DEFINITION_KEYWORDS.has(name)) {
          this.replaceTop(frame(STATEMENT, UNCOUNTED));
          return end;
        }
        if (name === "show") {
          this.replaceTop(frame(STATEMENT, this.showClass(end, cls)));
          return end;
        }
        if (name === "return") {
          this.replaceTop(frame(STATEMENT, cls));
          return end;
        }
        if (BLOCK_KEYWORDS.has(name)) {
          this.replaceTop(frame(COND, cls));
          return end;
        }
        if (name === "context") {
          let after = end;
          while (after < this.n && isInlineSpace(this.unit(after))) after += 1;
          this.code(end, after);
          index = after;
          continue;
        }
        this.lastIdentEnd = end;
        this.lastIdentCallee = calleeOf(name);
        return end;
      }
      this.pop();
      if (!isDigit(unit)) return index;
      const number = numberEnd(this.text, index);
      this.code(index, number);
      return number;
    }
  }

  private chainStep(chain: Frame, index: number): number {
    const unit = this.unit(index);
    if (unit === OPEN_PAREN) return this.openParen(index, chain.cls);
    if (unit === OPEN_BRACKET) {
      const callee = this.trailingCallee(index, chain.cls);
      return this.openContent(index, calleeClass(chain.cls, callee), callee);
    }
    if (unit === DOT) {
      const end = typstIdentifierEnd(this.text, index + 1);
      if (end > index + 1) {
        this.code(index, end);
        this.lastIdentEnd = end;
        this.lastIdentCallee = calleeOf(this.text.slice(index + 1, end));
        return end;
      }
    }
    this.pop();
    return index;
  }

  private condStep(cond: Frame, index: number): number {
    const unit = this.unit(index);
    if (cond.state === CONDITION) {
      if (unit === NEWLINE || unit === CARRIAGE_RETURN || isCloser(unit)) {
        this.pop();
        return index;
      }
      if (unit === OPEN_BRACE) {
        cond.state = AFTER_BODY;
        this.code(index, index + 1);
        this.push(frame(BRACE, cond.cls));
        return index + 1;
      }
      if (unit === OPEN_BRACKET && index > 0 && isSpace(this.unit(index - 1))) {
        cond.state = AFTER_BODY;
        return this.openContent(index, cond.cls, NO_CALL);
      }
      return this.codeToken(cond, index, unit);
    }
    if (cond.state === AFTER_BODY) return this.afterBody(cond, index);
    if (cond.state === ELSE_BODY) {
      if (unit === OPEN_BRACE) {
        cond.state = DONE;
        this.code(index, index + 1);
        this.push(frame(BRACE, cond.cls));
        return index + 1;
      }
      if (unit === OPEN_BRACKET) {
        cond.state = DONE;
        return this.openContent(index, cond.cls, NO_CALL);
      }
    }
    this.pop();
    return index;
  }

  private afterBody(cond: Frame, index: number): number {
    let cursor = index;
    while (cursor < this.n && isInlineSpace(this.unit(cursor))) cursor += 1;
    if (
      !this.text.startsWith("else", cursor) ||
      isTypstIdentifierContinueAt(this.text, cursor + 4)
    ) {
      this.pop();
      return index;
    }
    let after = cursor + 4;
    while (after < this.n && isInlineSpace(this.unit(after))) after += 1;
    if (this.text.startsWith("if", after) && !isTypstIdentifierContinueAt(this.text, after + 2)) {
      this.code(index, after + 2);
      cond.state = CONDITION;
      return after + 2;
    }
    this.code(index, after);
    cond.state = ELSE_BODY;
    return after;
  }

  private codeStep(current: Frame, index: number): number {
    const unit = this.unit(index);
    if (current.kind === STATEMENT) {
      if (unit === NEWLINE || unit === CARRIAGE_RETURN || isCloser(unit)) {
        this.pop();
        return index;
      }
      if (unit === SEMICOLON) {
        this.code(index, index + 1);
        this.pop();
        return index + 1;
      }
    } else if (current.kind === PAREN && unit === CLOSE_PAREN) {
      this.code(index, index + 1);
      this.pop();
      this.lastCallEnd = index + 1;
      this.lastCallCallee = current.callee;
      return index + 1;
    } else if (current.kind === BRACE && unit === CLOSE_BRACE) {
      this.code(index, index + 1);
      this.pop();
      return index + 1;
    }
    return this.codeToken(current, index, unit);
  }

  private codeToken(current: Frame, index: number, unit: number): number {
    const text = this.text;
    const cls = current.kind === COND ? UNCOUNTED : current.cls;
    const end = this.codeOpaqueEnd(index, unit, cls);
    if (end > index) {
      this.code(index, end);
      return end;
    }
    if (unit === OPEN_PAREN) return this.openParen(index, cls);
    if (unit === OPEN_BRACE) {
      this.code(index, index + 1);
      this.push(frame(BRACE, cls));
      return index + 1;
    }
    if (unit === OPEN_BRACKET) {
      const callee = this.trailingCallee(index, cls);
      let content = calleeClass(cls, callee);
      if (content !== UNCOUNTED && this.isCaptionArgument(index)) content = OUTSIDE;
      return this.openContent(index, content, callee);
    }
    const identifierEnd = typstIdentifierEnd(text, index);
    if (identifierEnd === index) {
      this.code(index, index + 1);
      return index + 1;
    }
    const name = text.slice(index, identifierEnd);
    this.code(index, identifierEnd);
    if (DEFINITION_KEYWORDS.has(name)) {
      this.push(frame(STATEMENT, UNCOUNTED));
      return identifierEnd;
    }
    if (name === "show") {
      this.push(frame(STATEMENT, this.showClass(identifierEnd, cls)));
      return identifierEnd;
    }
    if (
      name === "level" &&
      current.kind === PAREN &&
      current.callee === HEADING &&
      current.headingIndex >= 0
    ) {
      this.headingLevel(current, identifierEnd);
    }
    this.lastIdentEnd = identifierEnd;
    this.lastIdentCallee = calleeOf(name);
    return identifierEnd;
  }

  private codeOpaqueEnd(index: number, unit: number, cls: number): number {
    const text = this.text;
    if (unit === QUOTE) return quoteEnd(text, index + 1);
    const link = typstAutolinkEnd(text, index);
    if (link !== null) return link;
    const next = this.unit(index + 1);
    if (unit === SLASH && next === SLASH) return lineEnd(text, index + 2);
    if (unit === SLASH && next === STAR) return blockCommentEnd(text, index);
    if (unit === BACKTICK) return rawEnd(text, index);
    if (unit === BACKSLASH) return Math.min(index + 2, this.n);
    if (unit === DOLLAR) {
      const span = mathSpan(text, index);
      if (cls !== UNCOUNTED) this.countMath(span);
      return span.end;
    }
    return index;
  }
}

export function scanTypstDocument(text: string): TypstDocumentScan {
  const scanner = new TypstScanner(text);
  const prose = scanner.scan();
  return {
    prose,
    classes: scanner.classes,
    headingLevels: scanner.headingLevels,
    figures: scanner.figures,
    tables: scanner.tables,
    footnotes: scanner.footnotes,
    cites: scanner.cites,
    references: scanner.references,
    labels: scanner.labels,
    labelCount: scanner.labelCount,
    mathInline: scanner.mathInline,
    mathDisplayed: scanner.mathDisplayed,
  };
}

function proseCharacters(masked: string): number {
  let count = 0;
  let pending = false;
  for (let index = 0; index < masked.length; index += 1) {
    if (isSpace(masked.charCodeAt(index))) {
      if (count > 0) pending = true;
      continue;
    }
    if (pending) {
      count += 1;
      pending = false;
    }
    count += 1;
  }
  return count;
}

function headingsByLevel(levels: readonly number[]): number[] {
  const counts: number[] = [];
  for (const level of levels) {
    while (counts.length < level) counts.push(0);
    counts[level - 1] += 1;
  }
  return counts;
}

export function typstDocumentCounts(text: string): TypstDocumentCounts {
  const scan = scanTypstDocument(text);
  const masked = maskTypstToProse(scan.prose);
  const starts = countedWordStarts(masked);
  let wordsInHeaders = 0;
  let wordsOutsideText = 0;
  for (const start of starts) {
    const cls = scan.classes[start];
    if (cls === HEADER) wordsInHeaders += 1;
    else if (cls === OUTSIDE) wordsOutsideText += 1;
  }
  const references = scan.references.filter((key) => !scan.labels.has(key)).length;
  return {
    summary: {
      words: starts.length,
      wordsInText: starts.length - wordsInHeaders - wordsOutsideText,
      wordsInHeaders,
      wordsOutsideText,
      headingsByLevel: headingsByLevel(scan.headingLevels),
      figures: scan.figures,
      tables: scan.tables,
      mathInline: scan.mathInline,
      mathDisplayed: scan.mathDisplayed,
      citations: references + scan.cites,
      footnotes: scan.footnotes,
      labels: scan.labelCount,
    },
    characters: proseCharacters(masked),
    lines: masked.split("\n").filter((line) => line.trim().length > 0).length,
  };
}

export function typstDocumentSummary(text: string): TypstDocumentSummary {
  return typstDocumentCounts(text).summary;
}
