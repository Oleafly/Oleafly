import type { Diagnostic } from "./analyze";
import type { Span, TermToken, Token } from "./lexer";

export type SegmentKind = "text" | "phrase" | "negation" | "key" | "value" | "operator" | "paren";

export interface Segment {
  readonly start: number;
  readonly end: number;
  readonly kind: SegmentKind;
  readonly error: boolean;
}

interface Piece {
  readonly start: number;
  readonly end: number;
  readonly kind: SegmentKind;
}

function termPieces(token: TermToken, unknown: ReadonlySet<number>): Piece[] {
  const pieces: Piece[] = [];
  if (token.negation) pieces.push({ ...token.negation, kind: "negation" });
  if (token.key) {
    const value = unknown.has(token.key.span.start) ? "text" : "value";
    pieces.push({ start: token.key.span.start, end: token.key.colon.end, kind: "key" });
    for (const item of token.items) {
      if (item.span.end > item.span.start) pieces.push({ ...item.span, kind: value });
    }
    return pieces;
  }
  for (const item of token.items) {
    pieces.push({ ...item.span, kind: item.quoted ? "phrase" : "text" });
  }
  return pieces;
}

function tokenPieces(token: Token, unknown: ReadonlySet<number>): Piece[] {
  if (token.kind === "term") return termPieces(token, unknown);
  if (token.kind === "open" || token.kind === "close") return [{ ...token.span, kind: "paren" }];
  if (token.kind === "space") return [];
  return [{ ...token.span, kind: token.kind === "not" ? "negation" : "operator" }];
}

function overlaps(piece: Piece, spans: readonly Span[]): boolean {
  return spans.some((span) =>
    span.end === span.start
      ? piece.start <= span.start && span.start < piece.end
      : piece.start < span.end && span.start < piece.end,
  );
}

export function highlight(
  source: string,
  tokens: readonly Token[],
  diagnostics: readonly Diagnostic[] = [],
): Segment[] {
  const errors = diagnostics.map((diagnostic) => diagnostic.span);
  const unknown = new Set(
    diagnostics.filter((diagnostic) => diagnostic.code === "unknown-qualifier").map((diagnostic) => diagnostic.span.start),
  );
  const segments: Segment[] = [];
  let at = 0;
  for (const piece of tokens.flatMap((token) => tokenPieces(token, unknown))) {
    if (piece.start > at) segments.push({ start: at, end: piece.start, kind: "text", error: false });
    segments.push({ ...piece, error: overlaps(piece, errors) });
    at = piece.end;
  }
  if (at < source.length) segments.push({ start: at, end: source.length, kind: "text", error: false });
  return segments;
}
