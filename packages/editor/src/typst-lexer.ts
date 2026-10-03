import { K } from "./typst-nodes";

export const MARKUP_MODE = 0;
export const MATH_MODE = 1;
export const CODE_MODE = 2;

const XID_START = /\p{XID_Start}/u;
const XID_CONTINUE = /\p{XID_Continue}/u;
const ALPHABETIC = /\p{Alphabetic}/u;
const NUMERIC = /\p{N}/u;
const WIDE_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const GRAPHEME_EXTEND = /[\p{M}\u200c\ufe00-\ufe0f\u{1F3FB}-\u{1F3FF}\u{E0020}-\u{E007F}]/u;
const MATH_OPENING = new Set(
  [..."([{\u2308\u230a\u231c\u231e\u2772\u27e6\u27e8\u27ea\u27ec\u27ee\u2983\u2985\u2987\u2989\u298b\u298d\u298f\u2991\u2993\u2995\u2997\u29d8\u29da\u29fc\u23b0\u27c5"].map(
    (character) => character.codePointAt(0) ?? 0,
  ),
);
const MATH_CLOSING = new Set(
  [...")]}\u2309\u230b\u231d\u231f\u2773\u27e7\u27e9\u27eb\u27ed\u27ef\u2984\u2986\u2988\u298a\u298c\u298e\u2990\u2992\u2994\u2996\u2998\u29d9\u29db\u29fd\u23b1\u27c6"].map(
    (character) => character.codePointAt(0) ?? 0,
  ),
);
const MATH_ALPHABETIC_EXTRA = new Set([
  0x0608, 0x2118, 0x1d6c1, 0x1d6db, 0x1d6fb, 0x1d715, 0x1d735, 0x1d74f, 0x1d76f, 0x1d789, 0x1d7a9,
  0x1d7c3,
]);

const KEYWORDS = new Map<string, number>([
  ["none", K.None],
  ["auto", K.Auto],
  ["true", K.Bool],
  ["false", K.Bool],
  ["not", K.Not],
  ["and", K.And],
  ["or", K.Or],
  ["let", K.Let],
  ["set", K.Set],
  ["show", K.Show],
  ["context", K.Context],
  ["if", K.If],
  ["else", K.Else],
  ["for", K.For],
  ["in", K.In],
  ["while", K.While],
  ["break", K.Break],
  ["continue", K.Continue],
  ["return", K.Return],
  ["import", K.Import],
  ["include", K.Include],
  ["as", K.As],
]);

const NUMBER_SUFFIXES = new Set(["", "pt", "mm", "cm", "in", "deg", "rad", "em", "fr", "%"]);

const TEXT_STOP = new Uint8Array(128);
for (const character of " \t\n\u000b\u000c\r\\/[]~-.'\"*_:h`$<>@#") {
  TEXT_STOP[character.charCodeAt(0)] = 1;
}

const LINK_CHARACTER = new Uint8Array(128);
for (const character of "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ!#$%&*+,-./:;=?@_~'") {
  LINK_CHARACTER[character.charCodeAt(0)] = 1;
}

const MATH_SHORTHANDS: Readonly<Record<string, readonly string[]>> = {
  "-": [">>", ">", "->"],
  ":": ["=", ":="],
  "!": ["="],
  ".": [".."],
  "<": ["==>", "-->", "--", "-<", "->", "<-", "<<", "=>", "==", "~~", "=", "<", "-", "~"],
  ">": ["->", ">>", "=", ">"],
  "=": ["=>", ">", ":"],
  "|": ["->", "=>", "|"],
  "~": ["~>", ">"],
};

function character(code: number): string {
  return String.fromCodePoint(code);
}

export function isNewline(code: number): boolean {
  return (
    code === 10 || code === 11 || code === 12 || code === 13 || code === 0x85 || code === 0x2028 || code === 0x2029
  );
}

export function isWhitespace(code: number): boolean {
  return (
    (code >= 9 && code <= 13) ||
    code === 32 ||
    code === 0x85 ||
    code === 0xa0 ||
    code === 0x1680 ||
    (code >= 0x2000 && code <= 0x200a) ||
    code === 0x2028 ||
    code === 0x2029 ||
    code === 0x202f ||
    code === 0x205f ||
    code === 0x3000
  );
}

function isAsciiLetter(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isAsciiDigit(code: number): boolean {
  return code >= 48 && code <= 57;
}

function isAsciiAlphanumeric(code: number): boolean {
  return isAsciiLetter(code) || isAsciiDigit(code);
}

export function isIdStart(code: number): boolean {
  if (code < 0) return false;
  if (code < 128) return isAsciiLetter(code) || code === 95;
  return XID_START.test(character(code));
}

export function isIdContinue(code: number): boolean {
  if (code < 0) return false;
  if (code < 128) return isAsciiAlphanumeric(code) || code === 95 || code === 45;
  return XID_CONTINUE.test(character(code));
}

function isMathIdStart(code: number): boolean {
  if (code < 0) return false;
  if (code < 128) return isAsciiLetter(code);
  return XID_START.test(character(code));
}

function isMathIdContinue(code: number): boolean {
  if (code < 0) return false;
  if (code < 128) return isAsciiAlphanumeric(code);
  return XID_CONTINUE.test(character(code));
}

function isLabelCharacter(code: number): boolean {
  return isIdContinue(code) || code === 58 || code === 46;
}

function isNumeric(code: number): boolean {
  if (code < 0) return false;
  if (code < 128) return isAsciiDigit(code);
  return NUMERIC.test(character(code));
}

function isAlphanumeric(code: number): boolean {
  if (code < 0) return false;
  if (code < 128) return isAsciiAlphanumeric(code);
  const text = character(code);
  return ALPHABETIC.test(text) || NUMERIC.test(text);
}

function isWordy(code: number): boolean {
  if (!isAlphanumeric(code)) return false;
  return code < 128 || !WIDE_SCRIPT.test(character(code));
}

export function isMathAlphabetic(text: string): boolean {
  const first = text.codePointAt(0);
  if (first === undefined) return false;
  if (text.length === (first > 0xffff ? 2 : 1)) {
    return ALPHABETIC.test(text) || MATH_ALPHABETIC_EXTRA.has(first);
  }
  for (const part of text) {
    if (!ALPHABETIC.test(part)) return false;
  }
  return true;
}

function width(code: number): number {
  return code > 0xffff ? 2 : 1;
}

export class TypstLexer {
  pos = 0;
  start = 0;
  mode = MARKUP_MODE;
  newline = false;
  reach = 0;
  aux: number[] | null = null;

  constructor(
    readonly text: string,
    readonly end: number,
  ) {}

  unit(index: number): number {
    if (index >= this.reach) this.reach = index + 1;
    return index < this.end && index >= 0 ? this.text.charCodeAt(index) : -1;
  }

  point(index: number): number {
    const code = this.unit(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const low = this.unit(index + 1);
      if (low >= 0xdc00 && low <= 0xdfff) return ((code - 0xd800) << 10) + (low - 0xdc00) + 0x10000;
    }
    return code;
  }

  private pointBefore(index: number): number {
    if (index <= 0) return -1;
    const code = this.text.charCodeAt(index - 1);
    if (code >= 0xdc00 && code <= 0xdfff && index >= 2) {
      const high = this.text.charCodeAt(index - 2);
      if (high >= 0xd800 && high <= 0xdbff) return ((high - 0xd800) << 10) + (code - 0xdc00) + 0x10000;
    }
    return code;
  }

  private peek(): number {
    return this.point(this.pos);
  }

  private eat(): number {
    const code = this.point(this.pos);
    if (code >= 0) this.pos += width(code);
    return code;
  }

  private eatIf(code: number): boolean {
    if (this.unit(this.pos) !== code) return false;
    this.pos += 1;
    return true;
  }

  private at(literal: string, offset = 0): boolean {
    for (let index = 0; index < literal.length; index += 1) {
      if (this.unit(this.pos + offset + index) !== literal.charCodeAt(index)) return false;
    }
    return true;
  }

  private eatLiteral(literal: string): boolean {
    if (!this.at(literal)) return false;
    this.pos += literal.length;
    return true;
  }

  private eatWhile(test: (code: number) => boolean): number {
    const from = this.pos;
    for (;;) {
      const code = this.point(this.pos);
      if (code < 0 || !test(code)) break;
      this.pos += width(code);
    }
    return this.pos - from;
  }

  private eatUntilNewline(): void {
    for (;;) {
      const code = this.unit(this.pos);
      if (code < 0 || isNewline(code)) return;
      this.pos += 1;
    }
  }

  column(index: number): number {
    let count = 0;
    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
      const code = this.text.charCodeAt(cursor);
      if (isNewline(code)) break;
      if (code < 0xdc00 || code > 0xdfff) count += 1;
    }
    return count;
  }

  next(): number {
    const start = this.pos;
    this.start = start;
    this.newline = false;
    this.aux = null;
    const code = this.eat();
    if (code < 0) return K.End;
    if (this.mode === MARKUP_MODE ? code === 32 || code === 9 || isNewline(code) : isWhitespace(code)) {
      return this.whitespace(start, code);
    }
    if (code === 35 && start === 0 && this.eatIf(33)) {
      this.eatUntilNewline();
      return K.Shebang;
    }
    if (code === 47 && this.eatIf(47)) {
      this.eatUntilNewline();
      return K.LineComment;
    }
    if (code === 47 && this.eatIf(42)) return this.blockComment();
    if (code === 42 && this.eatIf(47)) return K.Error;
    if (code === 96 && this.mode !== MATH_MODE) return this.raw(start);
    if (this.mode === MARKUP_MODE) return this.markup(start, code);
    if (this.mode === MATH_MODE) return this.math(start, code);
    return this.code(start, code);
  }

  private whitespace(start: number, first: number): number {
    const markup = this.mode === MARKUP_MODE;
    const more = this.eatWhile((code) =>
      markup ? code === 32 || code === 9 || isNewline(code) : isWhitespace(code),
    );
    let newlines = 0;
    if (first !== 32 || more > 0) {
      for (let index = start; index < this.pos; index += 1) {
        const code = this.text.charCodeAt(index);
        if (!isNewline(code)) continue;
        if (code === 13 && index + 1 < this.pos && this.text.charCodeAt(index + 1) === 10) index += 1;
        newlines += 1;
      }
    }
    this.newline = newlines > 0;
    return markup && newlines >= 2 ? K.Parbreak : K.Space;
  }

  private blockComment(): number {
    let state = 0;
    let depth = 1;
    for (;;) {
      const code = this.eat();
      if (code < 0) break;
      if (state === 42 && code === 47) {
        depth -= 1;
        if (depth === 0) break;
        state = 0;
      } else if (state === 47 && code === 42) {
        depth += 1;
        state = 0;
      } else {
        state = code;
      }
    }
    return K.BlockComment;
  }

  private raw(start: number): number {
    let backticks = 1;
    while (this.eatIf(96)) backticks += 1;
    if (backticks === 2) {
      this.aux = [start + 1, -1, -1, start + 1];
      return K.Raw;
    }
    let found = 0;
    while (found < backticks) {
      const code = this.eat();
      if (code < 0) return K.Error;
      found = code === 96 ? found + 1 : 0;
    }
    const end = this.pos;
    const innerStart = start + backticks;
    const innerEnd = end - backticks;
    let langFrom = -1;
    let langTo = -1;
    if (backticks >= 3) {
      const first = innerStart < innerEnd ? this.point(innerStart) : -1;
      if (first >= 0 && !isWhitespace(first) && first !== 96 && isIdStart(first)) {
        let cursor = innerStart + width(first);
        while (cursor < innerEnd) {
          const code = this.point(cursor);
          if (!isIdContinue(code)) break;
          cursor += width(code);
        }
        langFrom = innerStart;
        langTo = cursor;
      }
    }
    this.aux = [innerStart, langFrom, langTo, innerEnd];
    return K.Raw;
  }

  private inWord(start: number): boolean {
    return isWordy(this.pointBefore(start)) && isWordy(this.peek());
  }

  private spaceOrEnd(): boolean {
    const code = this.peek();
    return code < 0 || isWhitespace(code) || this.at("//") || this.at("/*");
  }

  private markup(start: number, code: number): number {
    switch (code) {
      case 92:
        return this.backslash();
      case 104:
        if (this.eatLiteral("ttp://") || this.eatLiteral("ttps://")) return this.link();
        return this.plainText();
      case 60:
        return isIdContinue(this.peek()) ? this.label() : this.plainText();
      case 64:
        return isIdContinue(this.peek()) ? this.refMarker() : this.plainText();
      case 46:
        return this.eatLiteral("..") ? K.Shorthand : this.plainText();
      case 45:
        if (this.eatLiteral("--") || this.eatIf(45) || this.eatIf(63) || isNumeric(this.peek())) {
          return K.Shorthand;
        }
        return this.spaceOrEnd() ? K.ListMarker : this.plainText();
      case 42:
        return this.inWord(start) ? this.plainText() : K.Star;
      case 95:
        return this.inWord(start) ? this.plainText() : K.Underscore;
      case 35:
        return K.Hash;
      case 91:
        return K.LeftBracket;
      case 93:
        return K.RightBracket;
      case 39:
      case 34:
        return K.SmartQuote;
      case 36:
        return K.Dollar;
      case 126:
        return K.Shorthand;
      case 58:
        return K.Colon;
      case 61:
        while (this.eatIf(61));
        return this.spaceOrEnd() ? K.HeadingMarker : this.plainText();
      case 43:
        return this.spaceOrEnd() ? K.EnumMarker : this.plainText();
      case 47:
        return this.spaceOrEnd() ? K.TermMarker : this.plainText();
      default:
        if (isAsciiDigit(code)) return this.numbering(start);
        return this.plainText();
    }
  }

  private backslash(): number {
    if (this.eatLiteral("u{")) {
      const hexStart = this.pos;
      this.eatWhile(isAsciiAlphanumeric);
      const hex = this.text.slice(hexStart, this.pos);
      if (!this.eatIf(125)) return K.Error;
      const value = /^[0-9a-fA-F]+$/.test(hex) ? Number.parseInt(hex, 16) : Number.NaN;
      if (!(value <= 0x10ffff) || (value >= 0xd800 && value <= 0xdfff)) return K.Error;
      return K.Escape;
    }
    const next = this.peek();
    if (next < 0 || isWhitespace(next)) return K.Linebreak;
    this.eat();
    return K.Escape;
  }

  private link(): number {
    const brackets: number[] = [];
    for (;;) {
      const code = this.unit(this.pos);
      if (code < 0 || code >= 128) break;
      if (code === 91 || code === 40) {
        brackets.push(code);
      } else if (code === 93 || code === 41) {
        if (brackets.pop() !== (code === 93 ? 91 : 40)) break;
      } else if (LINK_CHARACTER[code] !== 1) {
        break;
      }
      this.pos += 1;
    }
    while ("!,.:;?'".includes(this.text[this.pos - 1])) this.pos -= 1;
    return brackets.length === 0 ? K.Link : K.Error;
  }

  private numbering(start: number): number {
    this.eatWhile(isAsciiDigit);
    const digits = this.text.slice(start, this.pos);
    if (this.eatIf(46) && this.spaceOrEnd() && fitsU64(digits)) return K.EnumMarker;
    return this.plainText();
  }

  private refMarker(): number {
    this.eatWhile(isLabelCharacter);
    while (this.text[this.pos - 1] === "." || this.text[this.pos - 1] === ":") this.pos -= 1;
    return K.RefMarker;
  }

  private label(): number {
    this.eatWhile(isLabelCharacter);
    return this.eatIf(62) ? K.Label : K.Error;
  }

  private plainText(): number {
    for (;;) {
      for (;;) {
        const code = this.unit(this.pos);
        if (code < 0) break;
        if (code < 128 ? TEXT_STOP[code] === 1 : isWhitespace(code)) break;
        this.pos += 1;
      }
      const code = this.unit(this.pos);
      const after = this.pos + 1;
      let proceed = false;
      if (code === 32) proceed = isAlphanumeric(this.point(after));
      else if (code === 47) proceed = !this.at("/", 1) && !this.at("*", 1);
      else if (code === 45) proceed = !this.at("-", 1) && !this.at("?", 1);
      else if (code === 46) proceed = !this.at("..", 1);
      else if (code === 104) proceed = !this.at("ttp://", 1) && !this.at("ttps://", 1);
      else if (code === 64) proceed = !isLabelCharacter(this.point(after));
      if (!proceed) return K.Text;
      this.pos = after;
    }
  }

  private math(start: number, code: number): number {
    if (code === 92) return this.backslash();
    if (code === 34) return this.string();
    const shorthands = MATH_SHORTHANDS[character(code)];
    if (shorthands) {
      for (const tail of shorthands) {
        if (this.eatLiteral(tail)) return K.MathShorthand;
      }
    }
    switch (code) {
      case 42:
      case 45:
      case 126:
        return K.MathShorthand;
      case 46:
        return K.Dot;
      case 44:
        return K.Comma;
      case 59:
        return K.Semicolon;
      case 35:
        return K.Hash;
      case 95:
        return K.Underscore;
      case 36:
        return K.Dollar;
      case 47:
        return K.Slash;
      case 94:
        return K.Hat;
      case 38:
        return K.MathAlignPoint;
      case 0x221a:
      case 0x221b:
      case 0x221c:
        return K.Root;
      case 33:
        return K.Bang;
      case 39:
        while (this.eatIf(39));
        return K.MathPrimes;
      case 40:
        return K.LeftParen;
      case 41:
        return K.RightParen;
      default:
        break;
    }
    if (code === 91 && this.eatIf(124)) return K.LeftBrace;
    if (code === 124 && this.eatIf(93)) return K.RightBrace;
    if (MATH_OPENING.has(code)) return K.LeftBrace;
    if (MATH_CLOSING.has(code)) return K.RightBrace;
    if (isMathIdStart(code) && isMathIdContinue(this.peek())) {
      this.eatWhile(isMathIdContinue);
      if (this.graphemeEnd(start) >= this.pos) return K.MathText;
      return this.mathIdentOrField();
    }
    return this.mathText(start, code);
  }

  private graphemeEnd(start: number): number {
    const first = this.point(start);
    let cursor = start + width(first);
    for (;;) {
      const code = this.point(cursor);
      if (code === 0x200d) {
        const joined = this.point(cursor + 1);
        if (joined < 0) return cursor + 1;
        cursor += 1 + width(joined);
        continue;
      }
      if (code < 0 || !GRAPHEME_EXTEND.test(character(code))) return cursor;
      cursor += width(code);
    }
  }

  private mathIdentOrField(): number {
    const ends = [this.pos];
    for (;;) {
      if (this.unit(this.pos) !== 46 || !isMathIdStart(this.point(this.pos + 1))) break;
      this.pos += 1;
      this.eat();
      this.eatWhile(isMathIdContinue);
      ends.push(this.pos);
    }
    if (ends.length === 1) return K.MathIdent;
    this.aux = ends;
    return K.MathFieldAccess;
  }

  private mathText(start: number, code: number): number {
    if (isNumeric(code)) {
      this.eatWhile(isNumeric);
      const save = this.pos;
      if (this.eatIf(46) && this.eatWhile(isNumeric) > 0) return K.MathText;
      this.pos = save;
      return K.MathText;
    }
    this.pos = this.graphemeEnd(start);
    return K.MathText;
  }

  mathNamedArg(start: number): boolean {
    const cursor = this.pos;
    this.pos = start;
    if (isIdStart(this.peek())) {
      this.eat();
      this.eatWhile(isIdContinue);
      if (this.at(":") && !this.at(":=") && !this.at("::=")) return true;
    }
    this.pos = cursor;
    return false;
  }

  mathSpreadArg(start: number): boolean {
    const cursor = this.pos;
    this.pos = start;
    if (this.eatLiteral("..")) {
      const next = this.unit(this.pos);
      if (!this.spaceOrEnd() && next !== 46 && next !== 44 && next !== 59 && next !== 41 && next !== 36) {
        return true;
      }
    }
    this.pos = cursor;
    return false;
  }

  private code(start: number, code: number): number {
    if (code === 60 && isIdContinue(this.peek())) return this.label();
    if (isAsciiDigit(code)) return this.number(start, code);
    if (code === 46 && isAsciiDigit(this.unit(this.pos))) return this.number(start, code);
    if (code === 34) return this.string();
    const next = this.unit(this.pos);
    switch (code) {
      case 61:
        if (next === 61) return this.take(K.EqEq);
        if (next === 62) return this.take(K.Arrow);
        return K.Eq;
      case 33:
        if (next === 61) return this.take(K.ExclEq);
        return K.Error;
      case 60:
        return next === 61 ? this.take(K.LtEq) : K.Lt;
      case 62:
        return next === 61 ? this.take(K.GtEq) : K.Gt;
      case 43:
        return next === 61 ? this.take(K.PlusEq) : K.Plus;
      case 45:
      case 0x2212:
        return next === 61 ? this.take(K.HyphEq) : K.Minus;
      case 42:
        return next === 61 ? this.take(K.StarEq) : K.Star;
      case 47:
        return next === 61 ? this.take(K.SlashEq) : K.Slash;
      case 46:
        return next === 46 ? this.take(K.Dots) : K.Dot;
      case 123:
        return K.LeftBrace;
      case 125:
        return K.RightBrace;
      case 91:
        return K.LeftBracket;
      case 93:
        return K.RightBracket;
      case 40:
        return K.LeftParen;
      case 41:
        return K.RightParen;
      case 36:
        return K.Dollar;
      case 44:
        return K.Comma;
      case 59:
        return K.Semicolon;
      case 58:
        return K.Colon;
      case 38:
        if (next === 38) this.pos += 1;
        return K.Error;
      case 124:
        if (next === 124) this.pos += 1;
        return K.Error;
      case 126:
        if (next === 61) this.pos += 1;
        return K.Error;
      default:
        break;
    }
    if (isIdStart(code)) return this.ident(start);
    return K.Error;
  }

  private take(kind: number): number {
    this.pos += 1;
    return kind;
  }

  private ident(start: number): number {
    this.eatWhile(isIdContinue);
    const name = this.text.slice(start, this.pos);
    const before = start > 0 ? this.text.charCodeAt(start - 1) : -1;
    const afterDots = before === 46 && start > 1 && this.text.charCodeAt(start - 2) === 46;
    if (!(before === 46 || before === 64) || afterDots) {
      const keyword = KEYWORDS.get(name);
      if (keyword !== undefined) return keyword;
    }
    return name === "_" ? K.Underscore : K.Ident;
  }

  private number(start: number, first: number): number {
    let base = 10;
    if (first === 48) {
      if (this.eatIf(98)) base = 2;
      else if (this.eatIf(111)) base = 8;
      else if (this.eatIf(120)) base = 16;
    }
    if (base === 16) this.eatWhile(isAsciiAlphanumeric);
    else this.eatWhile(isAsciiDigit);
    let isFloat = false;
    if (base === 10) {
      if (first === 46) {
        isFloat = true;
      } else if (!this.at("..") && !isIdStart(this.point(this.pos + 1)) && this.eatIf(46)) {
        isFloat = true;
        this.eatWhile(isAsciiDigit);
      }
      if (!this.at("em") && (this.eatIf(101) || this.eatIf(69))) {
        isFloat = true;
        if (!this.eatIf(43)) this.eatIf(45);
        this.eatWhile(isAsciiDigit);
      }
    }
    const number = this.text.slice(start, this.pos);
    const suffixStart = this.pos;
    this.eatWhile((code) => isAsciiAlphanumeric(code) || code === 37);
    const suffix = this.text.slice(suffixStart, this.pos);
    if (!NUMBER_SUFFIXES.has(suffix)) return K.Error;
    if (base !== 10) {
      if (suffix !== "") return K.Error;
      const digits = number.slice(2);
      const valid = base === 2 ? /^[01]+$/ : base === 8 ? /^[0-7]+$/ : /^[0-9a-fA-F]+$/;
      return valid.test(digits) ? K.Int : K.Error;
    }
    if (isFloat && !/^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(number)) return K.Error;
    if (suffix !== "") return K.Numeric;
    return isFloat ? K.Float : K.Int;
  }

  private string(): number {
    let escaped = false;
    for (;;) {
      const code = this.unit(this.pos);
      if (code < 0) return K.Error;
      if (code === 34 && !escaped) {
        this.pos += 1;
        return K.Str;
      }
      escaped = code === 92 && !escaped;
      this.pos += 1;
    }
  }
}

function fitsU64(digits: string): boolean {
  const trimmed = digits.replace(/^0+(?=\d)/u, "");
  if (trimmed.length !== 20) return trimmed.length < 20;
  return trimmed <= "18446744073709551615";
}
