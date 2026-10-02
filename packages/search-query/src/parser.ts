import { lex, type Span, type TermToken, type Token } from "./lexer";

export const MAX_GROUP_DEPTH = 5;

export type SyntaxCode =
  | "unclosed-group"
  | "unexpected-close"
  | "dangling-operator"
  | "too-deep"
  | "empty-group"
  | "unterminated-quote";

export interface SyntaxIssue {
  readonly code: SyntaxCode;
  readonly span: Span;
}

export type QueryNode =
  | { readonly type: "and" | "or"; readonly span: Span; readonly children: readonly QueryNode[] }
  | { readonly type: "not"; readonly span: Span; readonly child: QueryNode }
  | { readonly type: "term"; readonly span: Span; readonly term: TermToken };

export interface ParsedQuery {
  readonly source: string;
  readonly tokens: readonly Token[];
  readonly root: QueryNode | null;
  readonly issues: readonly SyntaxIssue[];
}

type Significant = Exclude<Token, { kind: "space" }>;

function joinSpan(first: Span, last: Span): Span {
  return { start: first.start, end: last.end };
}

function combine(type: "and" | "or", children: QueryNode[]): QueryNode | null {
  if (children.length === 0) return null;
  if (children.length === 1) return children[0];
  return { type, span: joinSpan(children[0].span, children.at(-1)!.span), children };
}

class Parser {
  private at = 0;
  readonly issues: SyntaxIssue[] = [];

  constructor(private readonly tokens: readonly Significant[]) {}

  parse(): QueryNode | null {
    const parts: QueryNode[] = [];
    let more = true;
    while (more) {
      const node = this.parseOr(0);
      if (node) parts.push(node);
      const stray = this.peek();
      more = stray !== undefined;
      if (stray) {
        this.issues.push({ code: "unexpected-close", span: stray.span });
        this.at += 1;
      }
    }
    return combine("and", parts);
  }

  private peek(): Significant | undefined {
    return this.tokens[this.at];
  }

  private endsOperand(token: Significant | undefined): boolean {
    return !token || token.kind === "close" || token.kind === "and" || token.kind === "or";
  }

  private parseOr(depth: number): QueryNode | null {
    const children: QueryNode[] = [];
    const first = this.parseAnd(depth);
    if (first) children.push(first);
    while (this.peek()?.kind === "or") {
      const operator = this.peek()!;
      this.at += 1;
      if (children.length === 0 || this.endsOperand(this.peek())) {
        this.issues.push({ code: "dangling-operator", span: operator.span });
      }
      const next = this.parseAnd(depth);
      if (next) children.push(next);
    }
    return combine("or", children);
  }

  private continuesAnd(): boolean {
    const token = this.peek();
    return token !== undefined && token.kind !== "close" && token.kind !== "or";
  }

  private parseAnd(depth: number): QueryNode | null {
    const children: QueryNode[] = [];
    while (this.continuesAnd()) {
      const token = this.peek()!;
      if (token.kind === "and") {
        this.at += 1;
        if (children.length === 0 || this.endsOperand(this.peek())) {
          this.issues.push({ code: "dangling-operator", span: token.span });
        }
      } else {
        const node = this.parseUnary(depth);
        if (node) children.push(node);
      }
    }
    return combine("and", children);
  }

  private parseUnary(depth: number): QueryNode | null {
    const token = this.peek()!;
    if (token.kind !== "not") return this.parsePrimary(depth);
    this.at += 1;
    if (this.endsOperand(this.peek())) {
      this.issues.push({ code: "dangling-operator", span: token.span });
      return null;
    }
    const child = this.parseUnary(depth);
    return child ? { type: "not", span: joinSpan(token.span, child.span), child } : null;
  }

  private parsePrimary(depth: number): QueryNode | null {
    const token = this.peek()!;
    this.at += 1;
    if (token.kind === "open") return this.parseGroup(token.span, depth + 1);
    if (token.kind !== "term") return null;
    if (token.items.some((item) => item.unterminated)) {
      this.issues.push({ code: "unterminated-quote", span: token.span });
    }
    if (!token.key && token.items.length === 0) return null;
    const term: QueryNode = { type: "term", span: token.span, term: token };
    if (!token.negation) return term;
    return { type: "not", span: token.span, child: term };
  }

  private parseGroup(open: Span, depth: number): QueryNode | null {
    if (depth > MAX_GROUP_DEPTH) this.issues.push({ code: "too-deep", span: open });
    const inner = this.parseOr(depth);
    const close = this.peek();
    let span: Span;
    if (close?.kind === "close") {
      this.at += 1;
      span = joinSpan(open, close.span);
    } else {
      this.issues.push({ code: "unclosed-group", span: open });
      span = inner ? joinSpan(open, inner.span) : open;
    }
    if (!inner) {
      this.issues.push({ code: "empty-group", span });
      return null;
    }
    return { ...inner, span };
  }
}

export function parse(source: string): ParsedQuery {
  const tokens = lex(source);
  const parser = new Parser(tokens.filter((token): token is Significant => token.kind !== "space"));
  const root = parser.parse();
  return { source, tokens, root, issues: parser.issues };
}
