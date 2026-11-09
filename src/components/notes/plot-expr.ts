export type ExpressionError =
  | "empty"
  | "length"
  | "depth"
  | "name"
  | "call"
  | "arguments"
  | "parenthesis"
  | "syntax"
  | "end";

export type Scope = Readonly<Record<string, number>>;
export type Evaluate = (scope: Scope) => number;

export type CompiledExpression =
  | { ok: true; evaluate: Evaluate; constant: boolean }
  | { ok: false; error: ExpressionError; detail?: string };

export const MAX_EXPRESSION_LENGTH = 1000;
export const MAX_EXPRESSION_DEPTH = 64;

type Operator = "+" | "-" | "*" | "/" | "^" | "(" | ")" | ",";

type Token =
  | { kind: "number"; value: number; text: string }
  | { kind: "name"; name: string; text: string }
  | { kind: "op"; op: Operator; text: string };

interface Compiled {
  run: Evaluate;
  value?: number;
}

const SYMBOLS: ReadonlyMap<string, Operator> = new Map([
  ["+", "+"],
  ["-", "-"],
  ["−", "-"],
  ["*", "*"],
  ["×", "*"],
  ["·", "*"],
  ["⋅", "*"],
  ["/", "/"],
  ["÷", "/"],
  ["^", "^"],
  ["(", "("],
  [")", ")"],
  [",", ","],
]);

const CONSTANTS: ReadonlyMap<string, number> = new Map([
  ["pi", Math.PI],
  ["e", Math.E],
]);

const UNARY: ReadonlyMap<string, (value: number) => number> = new Map([
  ["sin", Math.sin],
  ["cos", Math.cos],
  ["tan", Math.tan],
  ["asin", Math.asin],
  ["acos", Math.acos],
  ["atan", Math.atan],
  ["sinh", Math.sinh],
  ["cosh", Math.cosh],
  ["tanh", Math.tanh],
  ["exp", Math.exp],
  ["ln", Math.log],
  ["log", Math.log],
  ["log10", Math.log10],
  ["sqrt", Math.sqrt],
  ["abs", Math.abs],
  ["floor", Math.floor],
  ["ceil", Math.ceil],
]);

const VARIADIC: ReadonlyMap<string, (...values: number[]) => number> = new Map([
  ["min", Math.min],
  ["max", Math.max],
]);

const BINARY: Readonly<Record<"+" | "-" | "*" | "/" | "^", (left: number, right: number) => number>> = {
  "+": (left, right) => left + right,
  "-": (left, right) => left - right,
  "*": (left, right) => left * right,
  "/": (left, right) => left / right,
  "^": (left, right) => left ** right,
};

const NUMBER = /\d+(?:\.\d*)?(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?/y;
const NAME = /[A-Za-z_][A-Za-z0-9_]*/y;
const SPACE = /\s/u;

class ExpressionFailure extends Error {
  constructor(
    readonly error: ExpressionError,
    readonly detail?: string,
  ) {
    super(error);
  }
}

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < text.length) {
    const character = text[index];
    if (SPACE.test(character)) {
      index += 1;
      continue;
    }
    if (character === "*" && text[index + 1] === "*") {
      tokens.push({ kind: "op", op: "^", text: "**" });
      index += 2;
      continue;
    }
    const symbol = SYMBOLS.get(character);
    if (symbol) {
      tokens.push({ kind: "op", op: symbol, text: character });
      index += 1;
      continue;
    }
    if (character === "π") {
      tokens.push({ kind: "name", name: "pi", text: character });
      index += 1;
      continue;
    }
    NUMBER.lastIndex = index;
    const number = NUMBER.exec(text);
    if (number) {
      tokens.push({ kind: "number", value: Number(number[0]), text: number[0] });
      index += number[0].length;
      continue;
    }
    NAME.lastIndex = index;
    const name = NAME.exec(text);
    if (name) {
      tokens.push({ kind: "name", name: name[0].toLowerCase(), text: name[0] });
      index += name[0].length;
      continue;
    }
    throw new ExpressionFailure("syntax", String.fromCodePoint(text.codePointAt(index) as number));
  }
  return tokens;
}

function constant(value: number): Compiled {
  return { run: () => value, value };
}

function unary(apply: (value: number) => number, operand: Compiled): Compiled {
  if (operand.value !== undefined) return constant(apply(operand.value));
  const run = operand.run;
  return { run: (scope) => apply(run(scope)) };
}

function binary(apply: (left: number, right: number) => number, left: Compiled, right: Compiled): Compiled {
  if (left.value !== undefined && right.value !== undefined) return constant(apply(left.value, right.value));
  const first = left.run;
  const second = right.run;
  return { run: (scope) => apply(first(scope), second(scope)) };
}

function variadic(apply: (...values: number[]) => number, operands: Compiled[]): Compiled {
  if (operands.every((operand) => operand.value !== undefined)) {
    return constant(apply(...operands.map((operand) => operand.value as number)));
  }
  const runs = operands.map((operand) => operand.run);
  return { run: (scope) => apply(...runs.map((run) => run(scope))) };
}

function negate(value: number): number {
  return -value;
}

class Parser {
  private index = 0;
  private depth = 0;

  constructor(
    private readonly tokens: readonly Token[],
    private readonly variables: ReadonlyMap<string, string>,
  ) {}

  parse(): Compiled {
    const result = this.expression();
    const rest = this.tokens[this.index];
    if (rest) {
      if (rest.kind === "op" && rest.op === ")") throw new ExpressionFailure("parenthesis");
      throw new ExpressionFailure("syntax", rest.text);
    }
    return result;
  }

  private peek(): Token | undefined {
    return this.tokens[this.index];
  }

  private isOp(token: Token | undefined, ...ops: Operator[]): token is Extract<Token, { kind: "op" }> {
    return token?.kind === "op" && ops.includes(token.op);
  }

  private nest<T>(parse: () => T): T {
    this.depth += 1;
    if (this.depth > MAX_EXPRESSION_DEPTH) throw new ExpressionFailure("depth");
    const result = parse();
    this.depth -= 1;
    return result;
  }

  private expression(): Compiled {
    let left = this.term();
    for (let token = this.peek(); this.isOp(token, "+", "-"); token = this.peek()) {
      this.index += 1;
      left = binary(BINARY[token.op as "+" | "-"], left, this.term());
    }
    return left;
  }

  private term(): Compiled {
    let left = this.unary();
    for (;;) {
      const token = this.peek();
      if (this.isOp(token, "*", "/")) {
        this.index += 1;
        left = binary(BINARY[token.op as "*" | "/"], left, this.unary());
        continue;
      }
      if (token?.kind === "name" || this.isOp(token, "(")) {
        left = binary(BINARY["*"], left, this.power());
        continue;
      }
      return left;
    }
  }

  private unary(): Compiled {
    const token = this.peek();
    if (this.isOp(token, "-", "+")) {
      this.index += 1;
      const operand = this.nest(() => this.unary());
      return token.op === "-" ? unary(negate, operand) : operand;
    }
    return this.power();
  }

  private power(): Compiled {
    const base = this.primary();
    if (!this.isOp(this.peek(), "^")) return base;
    this.index += 1;
    return binary(BINARY["^"], base, this.nest(() => this.unary()));
  }

  private primary(): Compiled {
    const token = this.peek();
    if (!token) throw new ExpressionFailure("end");
    this.index += 1;
    if (token.kind === "number") return constant(token.value);
    if (token.kind === "name") return this.name(token);
    if (token.op === "(") {
      const inner = this.nest(() => this.expression());
      this.close();
      return inner;
    }
    if (token.op === ")") throw new ExpressionFailure("parenthesis");
    throw new ExpressionFailure("syntax", token.text);
  }

  private close(): void {
    if (!this.isOp(this.peek(), ")")) throw new ExpressionFailure("parenthesis");
    this.index += 1;
  }

  private name(token: Extract<Token, { kind: "name" }>): Compiled {
    const variable = this.variables.get(token.name);
    if (variable !== undefined) return { run: (scope) => scope[variable] ?? Number.NaN };
    const value = CONSTANTS.get(token.name);
    if (value !== undefined) return constant(value);
    const single = UNARY.get(token.name);
    const many = VARIADIC.get(token.name);
    if (!single && !many) throw new ExpressionFailure("name", token.text);
    if (!this.isOp(this.peek(), "(")) throw new ExpressionFailure("call", token.text);
    this.index += 1;
    const operands = this.nest(() => this.operands());
    this.close();
    if (single) {
      if (operands.length !== 1) throw new ExpressionFailure("arguments", token.text);
      return unary(single, operands[0]);
    }
    if (operands.length === 0) throw new ExpressionFailure("arguments", token.text);
    return variadic(many as (...values: number[]) => number, operands);
  }

  private operands(): Compiled[] {
    if (this.isOp(this.peek(), ")")) return [];
    const operands = [this.expression()];
    while (this.isOp(this.peek(), ",")) {
      this.index += 1;
      operands.push(this.expression());
    }
    return operands;
  }
}

export function compileExpression(text: string, variables: readonly string[]): CompiledExpression {
  if (text.length > MAX_EXPRESSION_LENGTH) return { ok: false, error: "length" };
  if (!text.trim()) return { ok: false, error: "empty" };
  try {
    const tokens = tokenize(text);
    const names = new Map(variables.map((name) => [name.toLowerCase(), name]));
    const compiled = new Parser(tokens, names).parse();
    return { ok: true, evaluate: compiled.run, constant: compiled.value !== undefined };
  } catch (thrown) {
    const failure = thrown as ExpressionFailure;
    return failure.detail === undefined
      ? { ok: false, error: failure.error }
      : { ok: false, error: failure.error, detail: failure.detail };
  }
}
