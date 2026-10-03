import { CODE_MODE, MARKUP_MODE, MATH_MODE, TypstLexer, isMathAlphabetic } from "./typst-lexer";
import { K, baseKind } from "./typst-nodes";

const MAX_DEPTH = 256;
const MAX_TREE_DEPTH = 500;

const CONTINUE = -1;
const STOP = -2;
const CONTEXTUAL_CONTINUE = -3;
const STOP_PARBREAK = -4;

const KIND_COUNT = Object.keys(K).length;

function kindSet(...kinds: number[]): Uint8Array {
  const set = new Uint8Array(KIND_COUNT);
  for (const kind of kinds) set[kind] = 1;
  return set;
}

function union(...sets: Uint8Array[]): Uint8Array {
  const set = new Uint8Array(KIND_COUNT);
  for (const source of sets) {
    for (let index = 0; index < KIND_COUNT; index += 1) set[index] |= source[index];
  }
  return set;
}

const EMPTY = kindSet();
const STMT = kindSet(K.Let, K.Set, K.Show, K.Import, K.Include, K.Return);
const MATH_EXPR = kindSet(
  K.Hash,
  K.MathIdent,
  K.MathFieldAccess,
  K.Dot,
  K.Comma,
  K.Semicolon,
  K.LeftBrace,
  K.RightBrace,
  K.LeftParen,
  K.RightParen,
  K.MathText,
  K.MathShorthand,
  K.Linebreak,
  K.MathAlignPoint,
  K.MathPrimes,
  K.Escape,
  K.Str,
  K.Root,
  K.Bang,
);
const ATOMIC_CODE_EXPR = kindSet(
  K.Ident,
  K.LeftBrace,
  K.LeftBracket,
  K.LeftParen,
  K.Dollar,
  K.Let,
  K.Set,
  K.Show,
  K.Context,
  K.If,
  K.While,
  K.For,
  K.Import,
  K.Include,
  K.Break,
  K.Continue,
  K.Return,
  K.None,
  K.Auto,
  K.Int,
  K.Float,
  K.Bool,
  K.Numeric,
  K.Str,
  K.Label,
  K.Raw,
);
const UNARY_OP = kindSet(K.Plus, K.Minus, K.Not);
const CODE_EXPR = union(ATOMIC_CODE_EXPR, UNARY_OP, kindSet(K.Underscore));
const BINARY_OP = kindSet(
  K.Plus,
  K.Minus,
  K.Star,
  K.Slash,
  K.And,
  K.Or,
  K.EqEq,
  K.ExclEq,
  K.Lt,
  K.LtEq,
  K.Gt,
  K.GtEq,
  K.Eq,
  K.In,
  K.PlusEq,
  K.HyphEq,
  K.StarEq,
  K.SlashEq,
);
const ARG = union(CODE_EXPR, kindSet(K.Dots));
const PATTERN_LEAF = ATOMIC_CODE_EXPR;
const PATTERN = union(PATTERN_LEAF, kindSet(K.LeftParen, K.Underscore));
const PARAM = union(PATTERN, kindSet(K.Dots));
const TERMINATOR = kindSet(K.End, K.Semicolon, K.RightBrace, K.RightParen, K.RightBracket);
const KEYWORD = kindSet(
  K.Not,
  K.And,
  K.Or,
  K.None,
  K.Auto,
  K.Let,
  K.Set,
  K.Show,
  K.Context,
  K.If,
  K.Else,
  K.For,
  K.In,
  K.While,
  K.Break,
  K.Continue,
  K.Return,
  K.Import,
  K.Include,
  K.As,
);
const TRIVIA = kindSet(K.Shebang, K.LineComment, K.BlockComment, K.Space, K.Parbreak);
const SILENT = kindSet(K.End, K.Text, K.Space, K.Parbreak, K.RawTrimmed);
const OPENING = kindSet(K.LeftBracket, K.LeftBrace, K.LeftParen);
const CLOSING = kindSet(K.RightBracket, K.RightBrace, K.RightParen);

const STRONG_STOP = kindSet(K.Star, K.RightBracket, K.End);
const EMPH_STOP = kindSet(K.Underscore, K.RightBracket, K.End);
const HEADING_STOP = kindSet(K.Label, K.RightBracket, K.End);
const ITEM_STOP = kindSet(K.RightBracket, K.End);
const TERM_STOP = kindSet(K.Colon, K.RightBracket, K.End);
const EQUATION_STOP = kindSet(K.Dollar, K.End);
const DELIMITED_STOP = kindSet(K.Dollar, K.End, K.RightBrace, K.RightParen);
const MATH_ARG_STOP = kindSet(K.End, K.Dollar, K.Comma, K.Semicolon, K.RightParen);
const CODE_BLOCK_STOP = kindSet(K.RightBrace, K.RightBracket, K.RightParen, K.End);
const CHAIN_BOTH = kindSet(K.Hat, K.Underscore);
const CHAIN_HAT = kindSet(K.Hat);
const CHAIN_UNDERSCORE = kindSet(K.Underscore);

const HASH_VARIANT = new Map<number, number>([
  [K.Let, K.HashKeyword],
  [K.Set, K.HashKeyword],
  [K.Show, K.HashKeyword],
  [K.Context, K.HashKeyword],
  [K.If, K.HashKeyword],
  [K.While, K.HashKeyword],
  [K.For, K.HashKeyword],
  [K.Import, K.HashKeyword],
  [K.Include, K.HashKeyword],
  [K.Break, K.HashKeyword],
  [K.Continue, K.HashKeyword],
  [K.Return, K.HashKeyword],
  [K.None, K.HashLiteral],
  [K.Auto, K.HashLiteral],
  [K.Bool, K.HashLiteral],
  [K.Str, K.HashString],
  [K.Int, K.HashNumber],
  [K.Float, K.HashNumber],
  [K.Numeric, K.HashNumber],
  [K.IdentFunction, K.HashFunction],
  [K.Ident, K.HashVariable],
  [K.IdentField, K.HashVariable],
]);

interface Token {
  kind: number;
  actual: number;
  start: number;
  end: number;
  trivia: number;
  triviaIndex: number;
  newline: boolean;
  column: number;
  parbreak: boolean;
  prevEnd: number;
  aux: number[] | null;
}

interface Marker {
  index: number;
  pos: number;
}

interface Checkpoint {
  length: number;
  cursor: number;
  mode: number;
  token: Token;
}

interface Memo {
  entries: number[];
  cursor: number;
  mode: number;
  token: Token;
}

interface Group {
  count: number;
  maybeJustParens: boolean;
  kind: number;
  seen: Set<string>;
}

interface MathOperator {
  readonly wrapper: number;
  readonly associativity: number;
  readonly precedence: number;
}

const MATH_FRACTION: MathOperator = { wrapper: K.MathFrac, associativity: 1, precedence: 1 };
const MATH_SCRIPT: MathOperator = { wrapper: K.MathAttach, associativity: 2, precedence: 2 };
const MATH_PRIMES: MathOperator = { wrapper: K.MathAttach, associativity: 0, precedence: 2 };
const MATH_FACTORIAL: MathOperator = { wrapper: K.Math, associativity: 0, precedence: 3 };

function attachChain(kind: number): Uint8Array {
  if (kind === K.Hat) return CHAIN_UNDERSCORE;
  if (kind === K.Underscore) return CHAIN_HAT;
  return CHAIN_BOTH;
}

function groupKind(group: Group): number {
  if (group.maybeJustParens && group.count === 1) return K.Parenthesized;
  return group.kind >= 0 ? group.kind : K.Array;
}

function tooDeep(entries: number[]): Uint8Array | null {
  const count = entries.length >> 2;
  const open: number[] = [];
  let drop: Uint8Array | null = null;
  for (let entry = count - 1; entry >= 0; entry -= 1) {
    while ((open.at(-1) ?? -1) > entry) open.pop();
    const size = entries[entry * 4 + 3];
    if (size === 4) continue;
    if (open.length >= MAX_TREE_DEPTH) {
      drop ??= new Uint8Array(count);
      drop[entry] = 1;
    }
    open.push(entry - (size >> 2) + 1);
  }
  return drop;
}

function compact(entries: number[]): number[] {
  const out: number[] = [];
  const starts = new Int32Array(entries.length / 4 + 1);
  const drop = tooDeep(entries);
  for (let index = 0; index < entries.length; index += 4) {
    starts[index >> 2] = out.length;
    const type = entries[index];
    const size = entries[index + 3];
    if (size === 4) {
      if (SILENT[type] !== 1) out.push(type, entries[index + 1], entries[index + 2], 4);
      continue;
    }
    if (drop?.[index >> 2] === 1) continue;
    const first = (index + 4 - size) >> 2;
    out.push(type, entries[index + 1], entries[index + 2], out.length - starts[first] + 4);
  }
  return out;
}

function binaryPrecedence(kind: number): number {
  switch (kind) {
    case K.Star:
    case K.Slash:
      return 6;
    case K.Plus:
    case K.Minus:
      return 5;
    case K.And:
      return 3;
    case K.Or:
      return 2;
    case K.Eq:
    case K.PlusEq:
    case K.HyphEq:
    case K.StarEq:
    case K.SlashEq:
      return 1;
    default:
      return 4;
  }
}

function rightAssociative(kind: number): boolean {
  return kind === K.Eq || kind === K.PlusEq || kind === K.HyphEq || kind === K.StarEq || kind === K.SlashEq;
}

export class TypstParserCore {
  readonly lexer: TypstLexer;
  buf: number[] = [];
  tok: Token;
  nesting = 0;
  atStart = true;
  errorBefore = false;
  private nlMode = CONTINUE;
  private depth = 0;
  private readonly memo = new Map<number, Memo>();

  constructor(
    readonly text: string,
    from: number,
    end: number,
  ) {
    this.lexer = new TypstLexer(text, end);
    this.lexer.pos = from;
    this.lexer.reach = from;
    this.tok = this.lex();
    this.atStart = true;
  }

  get kind(): number {
    return this.tok.kind;
  }

  resetAt(pos: number, prevEnd: number, errorBefore: boolean): void {
    this.lexer.mode = MARKUP_MODE;
    this.lexer.pos = pos;
    this.nlMode = CONTINUE;
    this.buf = [];
    this.memo.clear();
    this.nesting = 0;
    this.atStart = true;
    this.errorBefore = errorBefore;
    const token = this.lex();
    token.prevEnd = prevEnd;
    token.trivia = Math.max(token.trivia, 1);
    token.newline = true;
    token.column = this.lexer.column(token.start);
    this.tok = token;
  }

  takeBuffer(): number[] {
    const entries = this.buf;
    const last = this.tok.triviaIndex - 4;
    this.errorBefore = last >= 0 ? entries[last] === K.Error : this.errorBefore;
    this.buf = [];
    this.tok.triviaIndex = 0;
    this.memo.clear();
    return compact(entries);
  }

  topLevelStep(): void {
    this.nesting = this.markupExpr(this.atStart, this.nesting);
    this.atStart = this.tok.newline;
  }

  private stops(mode: number, token: Token): boolean {
    switch (mode) {
      case CONTINUE:
        return false;
      case STOP:
        return true;
      case CONTEXTUAL_CONTINUE:
        return token.actual !== K.Else && token.actual !== K.Dot;
      case STOP_PARBREAK:
        return token.parbreak;
      default:
        return token.column >= 0 && token.column <= mode;
    }
  }

  private lex(): Token {
    const lexer = this.lexer;
    const prevEnd = lexer.pos;
    const triviaIndex = this.buf.length;
    let start = prevEnd;
    let kind = lexer.next();
    let trivia = 0;
    let newline = false;
    let parbreak = false;
    while (TRIVIA[kind] === 1) {
      newline ||= lexer.newline;
      parbreak ||= kind === K.Parbreak;
      trivia += 1;
      this.buf.push(kind, start, lexer.pos, 4);
      start = lexer.pos;
      kind = lexer.next();
    }
    const token: Token = {
      kind,
      actual: kind,
      start,
      end: lexer.pos,
      trivia,
      triviaIndex,
      newline,
      column: -1,
      parbreak,
      prevEnd,
      aux: lexer.aux,
    };
    if (newline) {
      if (lexer.mode === MARKUP_MODE) token.column = lexer.column(start);
      if (this.stops(this.nlMode, token)) token.kind = K.End;
    }
    return token;
  }

  private pushToken(token: Token, kind: number): void {
    const buf = this.buf;
    const aux = token.aux;
    if (kind === K.Raw && aux) {
      const hasLang = aux[1] >= 0;
      buf.push(K.RawDelim, token.start, aux[0], 4);
      if (hasLang) buf.push(K.RawLang, aux[1], aux[2], 4);
      buf.push(K.RawDelim, aux[3], token.end, 4, K.Raw, token.start, token.end, hasLang ? 16 : 12);
      return;
    }
    if (kind === K.MathFieldAccess && aux) {
      const before = buf.length;
      buf.push(K.MathIdent, token.start, aux[0], 4);
      for (let index = 1; index < aux.length; index += 1) {
        const dot = aux[index - 1];
        const size = buf.length - before + 12;
        buf.push(K.Dot, dot, dot + 1, 4, K.MathIdent, dot + 1, aux[index], 4, K.MathFieldAccess, token.start, aux[index], size);
      }
      return;
    }
    buf.push(kind, token.start, token.end, 4);
  }

  private at(kind: number): boolean {
    return this.tok.kind === kind;
  }

  private end(): boolean {
    return this.tok.kind === K.End;
  }

  private directlyAt(kind: number): boolean {
    return this.tok.kind === kind && this.tok.trivia === 0;
  }

  private hadTrivia(): boolean {
    return this.tok.trivia > 0;
  }

  private currentText(): string {
    return this.text.slice(this.tok.start, this.tok.end);
  }

  private currentColumn(): number {
    const token = this.tok;
    return token.newline && token.column >= 0 ? token.column : this.lexer.column(token.start);
  }

  private marker(): Marker {
    return { index: this.buf.length, pos: this.tok.start };
  }

  private beforeTrivia(): Marker {
    return { index: this.tok.triviaIndex, pos: this.tok.prevEnd };
  }

  private eat(): void {
    this.pushToken(this.tok, this.tok.actual);
    this.tok = this.lex();
  }

  private convertAndEat(kind: number): void {
    this.pushToken(this.tok, kind);
    this.tok = this.lex();
  }

  private eatAsError(): void {
    this.buf.push(K.Error, this.tok.start, this.tok.end, 4);
    this.tok = this.lex();
  }

  private eatIf(kind: number): boolean {
    if (this.tok.kind !== kind) return false;
    this.eat();
    return true;
  }

  private assert(): void {
    this.eat();
  }

  private flushTrivia(): void {
    this.tok.trivia = 0;
    this.tok.prevEnd = this.tok.start;
    this.tok.triviaIndex = this.buf.length;
  }

  private insert(index: number, kind: number, from: number, to: number, size: number): void {
    if (index === this.buf.length) this.buf.push(kind, from, to, size);
    else this.buf.splice(index, 0, kind, from, to, size);
    if (index <= this.tok.triviaIndex) this.tok.triviaIndex += 4;
  }

  private startOf(marker: Marker, toIndex: number, to: number): number {
    return marker.index < toIndex ? this.buf[marker.index + 1] : to;
  }

  private wrap(marker: Marker, kind: number): void {
    const toIndex = this.tok.triviaIndex;
    const to = this.tok.prevEnd;
    const fromIndex = Math.min(marker.index, toIndex);
    this.insert(toIndex, kind, this.startOf(marker, toIndex, to), to, toIndex - fromIndex + 4);
  }

  private wrapError(marker: Marker): void {
    const toIndex = this.tok.triviaIndex;
    const to = this.tok.prevEnd;
    const fromIndex = Math.min(marker.index, toIndex);
    const from = this.startOf(marker, toIndex, to);
    this.buf.splice(fromIndex, toIndex - fromIndex, K.Error, from, to, 4);
    this.tok.triviaIndex = fromIndex + 4;
  }

  private rootAt(index: number): number {
    const buf = this.buf;
    let root = this.tok.triviaIndex - 4;
    while (root >= index) {
      const start = root + 4 - buf[root + 3];
      if (start === index) return root;
      if (start < index) return -1;
      root = start - 4;
    }
    return -1;
  }

  private kindAt(marker: Marker): number {
    const root = this.rootAt(marker.index);
    return root < 0 ? -1 : this.buf[root];
  }

  private retypeAt(marker: Marker, kind: number): void {
    const root = this.rootAt(marker.index);
    if (root >= 0) this.buf[root] = kind;
  }

  private lastRoot(): number {
    return this.tok.triviaIndex - 4;
  }

  private expectedAt(marker: Marker): void {
    const buf = this.buf;
    let pos = marker.pos;
    if (marker.index >= 4) pos = buf[marker.index - 2];
    else if (marker.index < buf.length) pos = buf[marker.index + 1];
    this.insert(marker.index, K.Error, pos, pos, 4);
  }

  private trimErrors(): void {
    const buf = this.buf;
    const end = this.tok.triviaIndex;
    let start = end;
    while (start >= 4 && buf[start - 4] === K.Error && buf[start - 3] === buf[start - 2] && buf[start - 1] === 4) {
      start -= 4;
    }
    if (start < end) {
      buf.splice(start, end - start);
      this.tok.triviaIndex = start;
    }
  }

  private afterError(): boolean {
    const index = this.tok.triviaIndex;
    return index > 0 ? this.buf[index - 4] === K.Error : this.errorBefore;
  }

  private expected(): void {
    if (this.tok.kind === K.Error) {
      this.trimErrors();
      this.eat();
    } else if (!this.afterError()) {
      this.expectedAt(this.beforeTrivia());
    }
  }

  private unexpected(): void {
    this.trimErrors();
    this.eatAsError();
  }

  private expect(kind: number): boolean {
    if (this.tok.kind === kind) {
      this.eat();
      return true;
    }
    if (kind === K.Ident && KEYWORD[this.tok.kind] === 1) {
      this.trimErrors();
      this.eatAsError();
    } else {
      this.expected();
    }
    return false;
  }

  private expectClosingDelimiter(open: Marker, kind: number): boolean {
    if (this.eatIf(kind)) return true;
    if (open.index < this.buf.length) this.buf[open.index] = K.Error;
    return false;
  }

  private pushNl(mode: number): number {
    const previous = this.nlMode;
    this.nlMode = mode;
    return previous;
  }

  private popNl(mode: number, previous: number): void {
    this.nlMode = previous;
    const token = this.tok;
    if (token.newline && mode !== previous) {
      token.kind = this.stops(previous, token) ? K.End : token.actual;
    }
  }

  private pushMode(mode: number): number {
    const previous = this.lexer.mode;
    this.lexer.mode = mode;
    return previous;
  }

  private popMode(mode: number, previous: number): void {
    if (mode === previous) return;
    this.lexer.mode = previous;
    this.lexer.pos = this.tok.prevEnd;
    this.buf.length = this.tok.triviaIndex;
    this.tok = this.lex();
  }

  private checkpoint(): Checkpoint {
    return {
      length: this.buf.length,
      cursor: this.lexer.pos,
      mode: this.lexer.mode,
      token: { ...this.tok },
    };
  }

  private restore(checkpoint: Checkpoint): void {
    this.buf.length = checkpoint.length;
    this.lexer.pos = checkpoint.cursor;
    this.lexer.mode = checkpoint.mode;
    this.tok = { ...checkpoint.token };
  }

  private increaseDepth(): boolean {
    if (this.depth < MAX_DEPTH) {
      this.depth += 1;
      return true;
    }
    this.depthCheckError(null);
    return false;
  }

  private checkDepthUntil(stop: Uint8Array): boolean {
    if (this.depth < MAX_DEPTH) return true;
    this.depthCheckError(stop);
    return false;
  }

  private depthCheckError(stop: Uint8Array | null): void {
    const marker = this.marker();
    let balance = 0;
    const previous = this.pushNl(CONTINUE);
    for (;;) {
      if (OPENING[this.tok.kind] === 1) balance += 1;
      else if (CLOSING[this.tok.kind] === 1) balance = Math.max(0, balance - 1);
      this.eat();
      const atStop = stop === null || stop[this.tok.kind] === 1;
      if ((balance === 0 && atStop) || this.end()) break;
    }
    this.popNl(CONTINUE, previous);
    this.wrapError(marker);
  }

  private markup(atStart: boolean, wrapTrivia: boolean, stop: Uint8Array): void {
    const marker = wrapTrivia ? this.beforeTrivia() : this.marker();
    this.markupExprs(atStart, stop);
    if (wrapTrivia) this.flushTrivia();
    this.wrap(marker, K.Markup);
  }

  private markupExprs(atStartIn: boolean, stop: Uint8Array): void {
    if (!this.checkDepthUntil(stop)) return;
    let atStart = atStartIn || this.tok.newline;
    let nesting = 0;
    while (stop[this.tok.kind] !== 1 || (nesting > 0 && this.tok.kind === K.RightBracket)) {
      nesting = this.markupExpr(atStart, nesting);
      atStart = this.tok.newline;
    }
  }

  private markupExpr(atStart: boolean, nestingIn: number): number {
    let nesting = nestingIn;
    if (!this.increaseDepth()) return nesting;
    switch (this.tok.kind) {
      case K.LeftBracket:
        nesting += 1;
        this.convertAndEat(K.Text);
        break;
      case K.RightBracket:
        if (nesting > 0) {
          nesting -= 1;
          this.convertAndEat(K.Text);
        } else {
          this.unexpected();
        }
        break;
      case K.Shebang:
      case K.Text:
      case K.Linebreak:
      case K.Escape:
      case K.Shorthand:
      case K.SmartQuote:
      case K.Link:
      case K.Label:
      case K.Raw:
        this.eat();
        break;
      case K.Hash:
        this.embeddedCodeExpr();
        break;
      case K.Star:
        this.strong();
        break;
      case K.Underscore:
        this.emph();
        break;
      case K.HeadingMarker:
      case K.ListMarker:
      case K.EnumMarker:
      case K.TermMarker:
        if (atStart) this.lineItem(this.tok.kind);
        else this.convertAndEat(K.Text);
        break;
      case K.RefMarker:
        this.reference();
        break;
      case K.Dollar:
        this.equation();
        break;
      case K.Colon:
        this.convertAndEat(K.Text);
        break;
      default:
        this.unexpected();
        break;
    }
    this.depth -= 1;
    return nesting;
  }

  private lineItem(marker: number): void {
    switch (marker) {
      case K.HeadingMarker:
        this.heading();
        break;
      case K.ListMarker:
        this.listItem(K.ListItem);
        break;
      case K.EnumMarker:
        this.listItem(K.EnumItem);
        break;
      default:
        this.termItem();
        break;
    }
  }

  private delimitedMarkup(delimiter: number, wrapper: number, stop: Uint8Array): void {
    const previous = this.pushNl(STOP_PARBREAK);
    const marker = this.marker();
    this.assert();
    this.markup(false, true, stop);
    this.expectClosingDelimiter(marker, delimiter);
    this.wrap(marker, wrapper);
    this.popNl(STOP_PARBREAK, previous);
  }

  private strong(): void {
    this.delimitedMarkup(K.Star, K.Strong, STRONG_STOP);
  }

  private emph(): void {
    this.delimitedMarkup(K.Underscore, K.Emph, EMPH_STOP);
  }

  private heading(): void {
    const previous = this.pushNl(STOP);
    const marker = this.marker();
    this.assert();
    this.markup(false, false, HEADING_STOP);
    this.wrap(marker, K.Heading);
    this.popNl(STOP, previous);
  }

  private listItem(kind: number): void {
    const column = this.currentColumn();
    const previous = this.pushNl(column);
    const marker = this.marker();
    this.assert();
    this.markup(true, false, ITEM_STOP);
    this.wrap(marker, kind);
    this.popNl(column, previous);
  }

  private termItem(): void {
    const column = this.currentColumn();
    const previous = this.pushNl(column);
    const marker = this.marker();
    const inner = this.pushNl(STOP);
    this.assert();
    this.markup(false, false, TERM_STOP);
    this.buf[this.lastRoot()] = K.TermMarkup;
    this.popNl(STOP, inner);
    this.expect(K.Colon);
    this.markup(true, false, ITEM_STOP);
    this.wrap(marker, K.TermItem);
    this.popNl(column, previous);
  }

  private reference(): void {
    const marker = this.marker();
    this.assert();
    if (this.directlyAt(K.LeftBracket)) this.contentBlock();
    this.wrap(marker, K.Ref);
  }

  private equation(): void {
    const marker = this.marker();
    const mode = this.pushMode(MATH_MODE);
    const previous = this.pushNl(CONTINUE);
    this.assert();
    this.math(EQUATION_STOP);
    this.expectClosingDelimiter(marker, K.Dollar);
    this.popNl(CONTINUE, previous);
    this.popMode(MATH_MODE, mode);
    this.wrap(marker, K.Equation);
  }

  private math(stop: Uint8Array): void {
    const marker = this.marker();
    this.mathExprs(stop);
    this.wrap(marker, K.Math);
  }

  private mathExprs(stop: Uint8Array): number {
    if (!this.checkDepthUntil(stop)) return 1;
    let count = 0;
    while (stop[this.tok.kind] !== 1) {
      if (MATH_EXPR[this.tok.kind] === 1) this.mathExprPrec(0, EMPTY);
      else this.unexpected();
      count += 1;
    }
    return count;
  }

  private mathExprPrec(minPrec: number, stop: Uint8Array): void {
    if (!this.increaseDepth()) return;
    const marker = this.marker();
    const continuable = this.mathPrimary(marker, minPrec);
    if (
      continuable &&
      minPrec <= 2 &&
      !this.hadTrivia() &&
      (this.tok.kind === K.LeftBrace || this.tok.kind === K.LeftParen)
    ) {
      this.mathDelimited();
      this.wrap(marker, K.Math);
    }
    for (;;) {
      if (stop[this.tok.kind] === 1) break;
      const operator = this.mathOperator();
      if (operator === null || operator.precedence < minPrec) break;
      this.mathOperation(marker, operator, stop);
    }
    this.depth -= 1;
  }

  private mathPrimary(marker: Marker, minPrec: number): boolean {
    switch (this.tok.kind) {
      case K.Hash:
        this.embeddedCodeExpr();
        return false;
      case K.MathIdent:
      case K.MathFieldAccess:
        return this.mathIdentOrCall(marker, minPrec);
      case K.LeftBrace:
      case K.LeftParen:
        this.mathDelimited();
        return false;
      case K.RightBrace:
        this.convertAndEat(this.currentText() === "|]" ? K.MathShorthand : K.MathText);
        return false;
      case K.Dot:
      case K.Bang:
      case K.Comma:
      case K.Semicolon:
      case K.RightParen:
        this.convertAndEat(K.MathText);
        return false;
      case K.MathText: {
        const continuable = isMathAlphabetic(this.currentText());
        this.eat();
        return continuable;
      }
      case K.Linebreak:
      case K.MathAlignPoint:
      case K.MathShorthand:
        this.eat();
        return false;
      case K.MathPrimes:
      case K.Escape:
      case K.Str:
        this.eat();
        return true;
      case K.Root:
        this.mathRoot(marker);
        return false;
      default:
        this.expected();
        return false;
    }
  }

  private mathIdentOrCall(marker: Marker, minPrec: number): boolean {
    this.eat();
    if (minPrec > 2 || !this.directlyAt(K.LeftParen)) return true;
    this.mathArgs();
    this.wrap(marker, K.MathCall);
    return false;
  }

  private mathRoot(marker: Marker): void {
    this.eat();
    this.mathOperand(2, EMPTY);
    this.wrap(marker, K.MathRoot);
  }

  private mathOperand(minPrec: number, stop: Uint8Array): void {
    const operand = this.marker();
    this.mathExprPrec(minPrec, stop);
    this.mathUnparen(operand);
  }

  private mathOperator(): MathOperator | null {
    const kind = this.tok.kind;
    if (kind === K.Slash) return MATH_FRACTION;
    if (kind === K.Underscore || kind === K.Hat) return MATH_SCRIPT;
    if (this.hadTrivia()) return null;
    if (kind === K.MathPrimes) return MATH_PRIMES;
    return kind === K.Bang ? MATH_FACTORIAL : null;
  }

  private mathOperation(marker: Marker, operator: MathOperator, stop: Uint8Array): void {
    const op = this.tok.kind;
    const { wrapper, associativity, precedence } = operator;
    const chain = wrapper === K.MathAttach ? attachChain(op) : EMPTY;
    if (op === K.Bang) this.convertAndEat(K.MathText);
    else this.eat();
    if (wrapper === K.MathFrac) this.mathUnparen(marker);
    if (associativity !== 0) this.mathOperand(associativity === 1 ? precedence + 1 : precedence, chain);
    if (op !== K.MathPrimes || stop[this.tok.kind] !== 1) this.mathChain(chain, precedence);
    this.wrap(marker, wrapper);
  }

  private mathChain(first: Uint8Array, precedence: number): void {
    let chain = first;
    while (chain[this.tok.kind] === 1) {
      chain = chain === CHAIN_BOTH ? attachChain(this.tok.kind) : EMPTY;
      this.eat();
      this.mathOperand(precedence, chain);
    }
  }

  private mathDelimited(): void {
    const marker = this.marker();
    this.convertAndEat(this.currentText() === "[|" ? K.MathShorthand : K.MathText);
    const body = this.marker();
    this.mathExprs(DELIMITED_STOP);
    if (this.tok.kind === K.RightBrace || this.tok.kind === K.RightParen) {
      this.wrap(body, K.Math);
      this.convertAndEat(this.currentText() === "|]" ? K.MathShorthand : K.MathText);
      this.wrap(marker, K.MathDelimited);
    } else {
      this.wrap(marker, K.Math);
    }
  }

  private mathUnparen(marker: Marker): void {
    const root = this.rootAt(marker.index);
    if (root < 0 || this.buf[root] !== K.MathDelimited) return;
    const buf = this.buf;
    const first = marker.index;
    const last = root - 4;
    if (last <= first) return;
    const opens = this.text.slice(buf[first + 1], buf[first + 2]) === "(";
    const closes = this.text.slice(buf[last + 1], buf[last + 2]) === ")";
    if (!opens || !closes) return;
    buf[first] = K.LeftParen;
    buf[last] = K.RightParen;
    buf[root] = K.Math;
  }

  private mathArgs(): void {
    const marker = this.marker();
    this.assert();
    const seen = new Set<string>();
    while (!this.at(K.End) && !this.at(K.Dollar) && !this.at(K.RightParen)) {
      this.mathArg(seen);
      const kind = this.tok.kind;
      if (kind === K.End || kind === K.Dollar || kind === K.RightParen) continue;
      if (kind === K.Semicolon || kind === K.Comma) this.eat();
      else this.expected();
    }
    this.expectClosingDelimiter(marker, K.RightParen);
    this.wrap(marker, K.MathArgs);
  }

  private mathArg(seen: Set<string>): void {
    const marker = this.marker();
    const start = this.tok.start;
    let argKind = -1;
    if (this.lexer.mathSpreadArg(start)) {
      argKind = K.Spread;
      this.tok.actual = K.Dots;
      this.tok.end = this.lexer.pos;
      this.tok.aux = null;
      this.eat();
    } else if (this.lexer.mathNamedArg(start)) {
      argKind = K.Named;
      this.tok.end = this.lexer.pos;
      const name = this.currentText();
      this.tok.actual = name === "_" ? K.Error : K.IdentProperty;
      this.tok.aux = null;
      this.eat();
      this.convertAndEat(K.Colon);
      if (seen.has(name)) this.retypeAt(marker, K.Error);
      else seen.add(name);
    }
    const value = this.marker();
    const count = this.mathExprs(MATH_ARG_STOP);
    if (count === 0 && argKind === K.Named) this.expected();
    if (count !== 1) this.wrap(value, K.Math);
    if (argKind >= 0) this.wrap(marker, argKind);
  }

  private code(stop: Uint8Array): void {
    const marker = this.marker();
    this.codeExprs(stop);
    this.wrap(marker, K.Code);
  }

  private codeExprs(stop: Uint8Array): void {
    if (!this.checkDepthUntil(stop)) return;
    while (stop[this.tok.kind] !== 1) {
      const previous = this.pushNl(CONTEXTUAL_CONTINUE);
      if (CODE_EXPR[this.tok.kind] !== 1) {
        this.unexpected();
      } else {
        this.codeExprPrec(false, 0);
        if (stop[this.tok.kind] !== 1 && !this.eatIf(K.Semicolon)) this.expected();
      }
      this.popNl(CONTEXTUAL_CONTINUE, previous);
    }
  }

  private embeddedCodeExpr(): void {
    const mode = this.pushMode(CODE_MODE);
    const previous = this.pushNl(STOP);
    const hash = this.buf.length;
    const hashEnd = this.tok.end;
    this.assert();
    if (this.hadTrivia() || this.end()) {
      this.expected();
    } else {
      const statement = STMT[this.tok.kind] === 1;
      this.codeExprPrec(true, 0);
      const semicolon = (statement || this.directlyAt(K.Semicolon)) && this.eatIf(K.Semicolon);
      if (statement && !semicolon && !this.end() && !this.at(K.RightBracket)) this.expected();
    }
    this.markHash(hash, hashEnd);
    this.popNl(STOP, previous);
    this.popMode(CODE_MODE, mode);
  }

  private markHash(hash: number, hashEnd: number): void {
    const buf = this.buf;
    const next = hash + 4;
    if (buf[hash] !== K.Hash || next >= buf.length || buf[next + 1] !== hashEnd) return;
    const variant = HASH_VARIANT.get(buf[next]);
    if (variant !== undefined) buf[hash] = variant;
  }

  private codeExprPrec(atomic: boolean, minPrec: number): void {
    if (!this.increaseDepth()) return;
    const marker = this.marker();
    if (UNARY_OP[this.tok.kind] === 1) this.unary(marker, atomic);
    else this.codePrimary(atomic);
    for (;;) {
      if (this.directlyAt(K.LeftParen) || this.directlyAt(K.LeftBracket)) {
        this.call(marker);
        continue;
      }
      const atField = this.directlyAt(K.Dot) && this.peekAfterDot() === K.Ident;
      if (atomic && !atField) break;
      if (this.eatIf(K.Dot)) this.fieldAccess(marker);
      else if (!this.binary(marker, minPrec)) break;
    }
    this.depth -= 1;
  }

  private unary(marker: Marker, atomic: boolean): void {
    if (atomic) {
      this.unexpected();
      return;
    }
    const precedence = this.tok.kind === K.Not ? 4 : 7;
    this.eat();
    this.codeExprPrec(false, precedence);
    this.wrap(marker, K.Unary);
  }

  private call(marker: Marker): void {
    this.args();
    this.markCallee();
    this.wrap(marker, K.FuncCall);
  }

  private fieldAccess(marker: Marker): void {
    if (this.expect(K.Ident)) this.buf[this.lastRoot()] = K.IdentField;
    this.wrap(marker, K.FieldAccess);
  }

  private binary(marker: Marker, minPrec: number): boolean {
    const op = this.binaryOperator(minPrec);
    if (op < 0) return false;
    const precedence = binaryPrecedence(op);
    if (precedence < minPrec) return false;
    this.eat();
    this.codeExprPrec(false, rightAssociative(op) ? precedence : precedence + 1);
    this.wrap(marker, K.Binary);
    return true;
  }

  private binaryOperator(minPrec: number): number {
    if (BINARY_OP[this.tok.kind] === 1) return this.tok.kind;
    if (minPrec > 4 || !this.eatIf(K.Not)) return -1;
    if (this.at(K.In)) return K.In;
    this.expected();
    return -1;
  }

  private peekAfterDot(): number {
    const lexer = this.lexer;
    const pos = lexer.pos;
    const start = lexer.start;
    const newline = lexer.newline;
    const aux = lexer.aux;
    const kind = lexer.next();
    lexer.pos = pos;
    lexer.start = start;
    lexer.newline = newline;
    lexer.aux = aux;
    return kind;
  }

  private markCallee(): void {
    const buf = this.buf;
    const args = this.lastRoot();
    if (args < 0) return;
    const callee = args - buf[args + 3];
    if (callee < 0) return;
    this.markFunctionName(callee);
  }

  private markFunctionName(root: number): void {
    const buf = this.buf;
    const kind = buf[root];
    if (baseKind(kind) === K.Ident) {
      buf[root] = K.IdentFunction;
    } else if (kind === K.FieldAccess && root >= 4 && baseKind(buf[root - 4]) === K.Ident) {
      buf[root - 4] = K.IdentFunction;
    }
  }

  private codePrimary(atomic: boolean): void {
    const marker = this.marker();
    switch (this.tok.kind) {
      case K.Ident:
        this.eat();
        if (!atomic && this.at(K.Arrow)) {
          this.buf[this.lastRoot()] = K.IdentDefinition;
          this.wrap(marker, K.Params);
          this.assert();
          this.codeExprPrec(false, 0);
          this.wrap(marker, K.Closure);
        }
        return;
      case K.Underscore:
        if (atomic) break;
        this.eat();
        if (this.at(K.Arrow)) {
          this.wrap(marker, K.Params);
          this.eat();
          this.codeExprPrec(false, 0);
          this.wrap(marker, K.Closure);
        } else if (this.eatIf(K.Eq)) {
          this.codeExprPrec(false, 0);
          this.wrap(marker, K.DestructAssignment);
        } else {
          this.retypeAt(marker, K.Error);
        }
        return;
      case K.LeftBrace:
        this.codeBlock();
        return;
      case K.LeftBracket:
        this.contentBlock();
        return;
      case K.LeftParen:
        this.exprWithParen(atomic);
        return;
      case K.Dollar:
        this.equation();
        return;
      case K.Let:
        this.letBinding();
        return;
      case K.Set:
        this.setRule();
        return;
      case K.Show:
        this.showRule();
        return;
      case K.Context:
        this.keywordWith(K.Contextual, atomic);
        return;
      case K.If:
        this.conditional();
        return;
      case K.While:
        this.whileLoop();
        return;
      case K.For:
        this.forLoop();
        return;
      case K.Import:
        this.moduleImport();
        return;
      case K.Include:
        this.keywordWith(K.ModuleInclude, false);
        return;
      case K.Break:
        this.eat();
        this.wrap(marker, K.LoopBreak);
        return;
      case K.Continue:
        this.eat();
        this.wrap(marker, K.LoopContinue);
        return;
      case K.Return:
        this.eat();
        if (CODE_EXPR[this.tok.kind] === 1) this.codeExprPrec(false, 0);
        this.wrap(marker, K.FuncReturn);
        return;
      case K.Raw:
      case K.None:
      case K.Auto:
      case K.Int:
      case K.Float:
      case K.Bool:
      case K.Numeric:
      case K.Str:
      case K.Label:
        this.eat();
        return;
      default:
        break;
    }
    if (atomic) this.unexpected();
    else this.expected();
  }

  private keywordWith(wrapper: number, atomic: boolean): void {
    const marker = this.marker();
    this.assert();
    this.codeExprPrec(atomic, 0);
    this.wrap(marker, wrapper);
  }

  private block(): void {
    if (this.tok.kind === K.LeftBracket) this.contentBlock();
    else if (this.tok.kind === K.LeftBrace) this.codeBlock();
    else this.expected();
  }

  private codeBlock(): void {
    const marker = this.marker();
    const mode = this.pushMode(CODE_MODE);
    const previous = this.pushNl(CONTINUE);
    this.assert();
    this.code(CODE_BLOCK_STOP);
    this.expectClosingDelimiter(marker, K.RightBrace);
    this.popNl(CONTINUE, previous);
    this.popMode(CODE_MODE, mode);
    this.wrap(marker, K.CodeBlock);
  }

  private contentBlock(): void {
    const marker = this.marker();
    const mode = this.pushMode(MARKUP_MODE);
    const previous = this.pushNl(CONTINUE);
    this.assert();
    this.markup(true, true, ITEM_STOP);
    this.expectClosingDelimiter(marker, K.RightBracket);
    this.popNl(CONTINUE, previous);
    this.popMode(MARKUP_MODE, mode);
    this.wrap(marker, K.ContentBlock);
  }

  private letBinding(): void {
    const marker = this.marker();
    this.assert();
    const binding = this.marker();
    let closure = false;
    let other = false;
    if (this.eatIf(K.Ident)) {
      const name = this.lastRoot();
      if (this.directlyAt(K.LeftParen)) {
        this.params();
        closure = true;
      }
      this.buf[name] = closure ? K.IdentFunction : K.IdentDefinition;
    } else {
      this.pattern(false, new Set());
      other = true;
    }
    const assigned = closure || other ? this.expect(K.Eq) : this.eatIf(K.Eq);
    if (assigned) this.codeExprPrec(false, 0);
    if (closure) this.wrap(binding, K.Closure);
    this.wrap(marker, K.LetBinding);
  }

  private setRule(): void {
    const marker = this.marker();
    this.assert();
    const target = this.marker();
    this.expect(K.Ident);
    while (this.eatIf(K.Dot)) {
      if (this.expect(K.Ident)) this.buf[this.lastRoot()] = K.IdentField;
      this.wrap(target, K.FieldAccess);
    }
    const root = this.lastRoot();
    if (root >= target.index) this.markFunctionName(root);
    this.args();
    if (this.eatIf(K.If)) this.codeExprPrec(false, 0);
    this.wrap(marker, K.SetRule);
  }

  private showRule(): void {
    const marker = this.marker();
    this.assert();
    const colon = this.beforeTrivia();
    if (!this.at(K.Colon)) {
      const selector = this.marker();
      this.codeExprPrec(false, 0);
      this.markShowTarget(selector);
    }
    if (this.eatIf(K.Colon)) {
      const transform = this.marker();
      this.codeExprPrec(false, 0);
      this.markShowTarget(transform);
    } else {
      this.expectedAt(colon);
    }
    this.wrap(marker, K.ShowRule);
  }

  private markShowTarget(marker: Marker): void {
    const root = this.rootAt(marker.index);
    if (root < 0) return;
    const kind = this.buf[root];
    if (baseKind(kind) === K.Ident || kind === K.FieldAccess) this.markFunctionName(root);
  }

  private conditional(): void {
    const marker = this.marker();
    this.assert();
    this.codeExprPrec(false, 0);
    this.block();
    if (this.eatIf(K.Else)) {
      if (this.at(K.If)) this.conditional();
      else this.block();
    }
    this.wrap(marker, K.Conditional);
  }

  private whileLoop(): void {
    const marker = this.marker();
    this.assert();
    this.codeExprPrec(false, 0);
    this.block();
    this.wrap(marker, K.WhileLoop);
  }

  private forLoop(): void {
    const marker = this.marker();
    this.assert();
    const seen = new Set<string>();
    this.pattern(false, seen);
    if (this.at(K.Comma)) {
      this.eatAsError();
      if (PATTERN[this.tok.kind] === 1) this.pattern(false, seen);
    }
    this.expect(K.In);
    this.codeExprPrec(false, 0);
    this.block();
    this.wrap(marker, K.ForLoop);
  }

  private moduleImport(): void {
    const marker = this.marker();
    this.assert();
    this.codeExprPrec(false, 0);
    if (this.eatIf(K.As)) {
      if (this.expect(K.Ident)) this.buf[this.lastRoot()] = K.IdentDefinition;
    }
    if (this.eatIf(K.Colon)) {
      if (this.at(K.LeftParen)) {
        const previous = this.pushNl(CONTINUE);
        const open = this.marker();
        this.assert();
        this.importItems();
        this.expectClosingDelimiter(open, K.RightParen);
        this.popNl(CONTINUE, previous);
      } else if (!this.eatIf(K.Star)) {
        this.importItems();
      }
    }
    this.wrap(marker, K.ModuleImport);
  }

  private importItems(): void {
    const marker = this.marker();
    while (TERMINATOR[this.tok.kind] !== 1) {
      const item = this.marker();
      if (!this.eatIf(K.Ident)) this.unexpected();
      while (this.eatIf(K.Dot)) {
        if (this.expect(K.Ident)) this.buf[this.lastRoot()] = K.IdentField;
      }
      this.wrap(item, K.ImportItemPath);
      if (this.eatIf(K.As)) {
        if (this.expect(K.Ident)) this.buf[this.lastRoot()] = K.IdentDefinition;
        this.wrap(item, K.RenamedImportItem);
      }
      if (TERMINATOR[this.tok.kind] !== 1) this.expect(K.Comma);
    }
    this.wrap(marker, K.ImportItems);
  }

  private exprWithParen(atomic: boolean): void {
    if (atomic) {
      this.parenthesizedOrArrayOrDict();
      return;
    }
    const key = this.tok.start;
    const memo = this.memo.get(key);
    if (memo) {
      const base = this.buf.length;
      for (const value of memo.entries) this.buf.push(value);
      this.lexer.pos = memo.cursor;
      this.lexer.mode = memo.mode;
      this.tok = { ...memo.token, triviaIndex: memo.token.triviaIndex + base };
      return;
    }
    const checkpoint = this.checkpoint();
    const kind = this.parenthesizedOrArrayOrDict();
    if (this.at(K.Arrow)) {
      this.restore(checkpoint);
      const marker = this.marker();
      this.params();
      if (!this.expect(K.Arrow)) return;
      this.codeExprPrec(false, 0);
      this.wrap(marker, K.Closure);
    } else if (this.at(K.Eq) && kind !== K.Parenthesized) {
      this.restore(checkpoint);
      const marker = this.marker();
      this.destructuringOrParenthesized(true, new Set());
      if (!this.expect(K.Eq)) return;
      this.codeExprPrec(false, 0);
      this.wrap(marker, K.DestructAssignment);
    } else {
      return;
    }
    this.memo.set(key, {
      entries: this.buf.slice(checkpoint.length),
      cursor: this.lexer.pos,
      mode: this.lexer.mode,
      token: { ...this.tok, triviaIndex: this.tok.triviaIndex - checkpoint.length },
    });
  }

  private parenthesizedOrArrayOrDict(): number {
    const group: Group = { count: 0, maybeJustParens: true, kind: -1, seen: new Set() };
    const marker = this.marker();
    const previous = this.pushNl(CONTINUE);
    this.assert();
    if (this.eatIf(K.Colon)) group.kind = K.Dict;
    while (TERMINATOR[this.tok.kind] !== 1) {
      if (ARG[this.tok.kind] !== 1) {
        this.unexpected();
        continue;
      }
      this.arrayOrDictItem(group);
      group.count += 1;
      if (TERMINATOR[this.tok.kind] !== 1 && this.expect(K.Comma)) group.maybeJustParens = false;
    }
    this.expectClosingDelimiter(marker, K.RightParen);
    this.popNl(CONTINUE, previous);
    const kind = groupKind(group);
    this.wrap(marker, kind);
    return kind;
  }

  private arrayOrDictItem(group: Group): void {
    const marker = this.marker();
    if (this.eatIf(K.Dots)) {
      this.codeExprPrec(false, 0);
      this.wrap(marker, K.Spread);
      group.maybeJustParens = false;
      return;
    }
    this.codeExprPrec(false, 0);
    if (this.eatIf(K.Colon)) this.pairItem(marker, group);
    else if (group.kind === K.Dict) this.retypeAt(marker, K.Error);
    else group.kind = K.Array;
  }

  private pairItem(marker: Marker, group: Group): void {
    this.codeExprPrec(false, 0);
    const named = this.markPairKey(marker, group);
    this.wrap(marker, named ? K.Named : K.Keyed);
    group.maybeJustParens = false;
    if (group.kind === K.Array) this.retypeAt(marker, K.Error);
    else group.kind = K.Dict;
  }

  private markPairKey(marker: Marker, group: Group): boolean {
    const root = this.rootAt(marker.index);
    const keyKind = root >= 0 ? this.buf[root] : -1;
    const named = baseKind(keyKind) === K.Ident;
    if (!named && keyKind !== K.Str) return false;
    const raw = this.text.slice(this.buf[root + 1], this.buf[root + 2]);
    const key = named ? raw : raw.slice(1, -1);
    if (group.seen.has(key)) {
      this.buf[root] = K.Error;
    } else {
      group.seen.add(key);
      if (named) this.buf[root] = K.IdentProperty;
    }
    return named;
  }

  private args(): void {
    if (!this.directlyAt(K.LeftParen) && !this.directlyAt(K.LeftBracket)) this.expected();
    const marker = this.marker();
    if (this.at(K.LeftParen)) {
      const open = this.marker();
      const previous = this.pushNl(CONTINUE);
      this.assert();
      const seen = new Set<string>();
      while (TERMINATOR[this.tok.kind] !== 1) {
        if (ARG[this.tok.kind] !== 1) {
          this.unexpected();
          continue;
        }
        this.arg(seen);
        if (TERMINATOR[this.tok.kind] !== 1) this.expect(K.Comma);
      }
      this.expectClosingDelimiter(open, K.RightParen);
      this.popNl(CONTINUE, previous);
    }
    while (this.directlyAt(K.LeftBracket)) this.contentBlock();
    this.wrap(marker, K.Args);
  }

  private arg(seen: Set<string>): void {
    const marker = this.marker();
    if (this.eatIf(K.Dots)) {
      this.codeExprPrec(false, 0);
      this.wrap(marker, K.Spread);
      return;
    }
    const wasAtExpr = CODE_EXPR[this.tok.kind] === 1;
    const text = this.currentText();
    this.codeExprPrec(false, 0);
    if (this.eatIf(K.Colon)) {
      if (wasAtExpr) {
        const root = this.rootAt(marker.index);
        if (root >= 0) {
          if (baseKind(this.buf[root]) !== K.Ident || seen.has(text)) {
            this.buf[root] = K.Error;
          } else {
            seen.add(text);
            this.buf[root] = K.IdentProperty;
          }
        }
      }
      this.codeExprPrec(false, 0);
      this.wrap(marker, K.Named);
    }
  }

  private params(): void {
    const marker = this.marker();
    const previous = this.pushNl(CONTINUE);
    this.assert();
    const seen = new Set<string>();
    const sink = { taken: false };
    while (TERMINATOR[this.tok.kind] !== 1) {
      if (PARAM[this.tok.kind] !== 1) {
        this.unexpected();
        continue;
      }
      this.param(seen, sink);
      if (TERMINATOR[this.tok.kind] !== 1) this.expect(K.Comma);
    }
    this.expectClosingDelimiter(marker, K.RightParen);
    this.popNl(CONTINUE, previous);
    this.wrap(marker, K.Params);
  }

  private param(seen: Set<string>, sink: { taken: boolean }): void {
    const marker = this.marker();
    if (this.eatIf(K.Dots)) {
      if (PATTERN_LEAF[this.tok.kind] === 1) this.patternLeaf(false, seen);
      this.wrap(marker, K.Spread);
      if (sink.taken) this.retypeAt(marker, K.Error);
      sink.taken = true;
      return;
    }
    const wasAtPattern = PATTERN[this.tok.kind] === 1;
    this.pattern(false, seen);
    if (this.eatIf(K.Colon)) {
      if (wasAtPattern && baseKind(this.kindAt(marker)) !== K.Ident) this.retypeAt(marker, K.Error);
      this.codeExprPrec(false, 0);
      this.wrap(marker, K.Named);
    }
  }

  private pattern(reassignment: boolean, seen: Set<string>): void {
    if (!this.increaseDepth()) return;
    if (this.tok.kind === K.Underscore) this.eat();
    else if (this.tok.kind === K.LeftParen) this.destructuringOrParenthesized(reassignment, seen);
    else this.patternLeaf(reassignment, seen);
    this.depth -= 1;
  }

  private destructuringOrParenthesized(reassignment: boolean, seen: Set<string>): void {
    const sink = { taken: false };
    const state = { maybeJustParens: true };
    let count = 0;
    const marker = this.marker();
    const previous = this.pushNl(CONTINUE);
    this.assert();
    while (TERMINATOR[this.tok.kind] !== 1) {
      if (PARAM[this.tok.kind] !== 1) {
        this.unexpected();
        continue;
      }
      this.destructuringItem(reassignment, seen, state, sink);
      count += 1;
      if (TERMINATOR[this.tok.kind] !== 1 && this.expect(K.Comma)) state.maybeJustParens = false;
    }
    this.expectClosingDelimiter(marker, K.RightParen);
    this.popNl(CONTINUE, previous);
    const plain = state.maybeJustParens && count === 1 && !sink.taken;
    this.wrap(marker, plain ? K.Parenthesized : K.Destructuring);
  }

  private destructuringItem(
    reassignment: boolean,
    seen: Set<string>,
    state: { maybeJustParens: boolean },
    sink: { taken: boolean },
  ): void {
    const marker = this.marker();
    if (this.eatIf(K.Dots)) {
      if (PATTERN_LEAF[this.tok.kind] === 1) this.patternLeaf(reassignment, seen);
      this.wrap(marker, K.Spread);
      if (sink.taken) this.retypeAt(marker, K.Error);
      sink.taken = true;
      return;
    }
    const wasAtPattern = PATTERN[this.tok.kind] === 1;
    const checkpoint = this.checkpoint();
    if (!(this.eatIf(K.Ident) && this.at(K.Colon))) {
      this.restore(checkpoint);
      this.pattern(reassignment, seen);
    } else {
      this.buf[this.lastRoot()] = K.IdentProperty;
    }
    if (this.eatIf(K.Colon)) {
      if (wasAtPattern && baseKind(this.kindAt(marker)) !== K.Ident) this.retypeAt(marker, K.Error);
      this.pattern(reassignment, seen);
      this.wrap(marker, K.Named);
      state.maybeJustParens = false;
    }
  }

  private patternLeaf(reassignment: boolean, seen: Set<string>): void {
    if (KEYWORD[this.tok.kind] === 1) {
      this.eatAsError();
      return;
    }
    if (PATTERN_LEAF[this.tok.kind] !== 1) {
      this.expected();
      return;
    }
    const marker = this.marker();
    const text = this.currentText();
    this.codeExprPrec(true, 0);
    if (reassignment) return;
    const root = this.rootAt(marker.index);
    if (root < 0) return;
    if (baseKind(this.buf[root]) !== K.Ident || seen.has(text)) {
      this.buf[root] = K.Error;
    } else {
      seen.add(text);
      this.buf[root] = K.IdentDefinition;
    }
  }
}
