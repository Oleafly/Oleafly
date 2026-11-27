interface JsoncError {
  offset: number;
  message: string;
}

export interface JsoncDocument {
  value: unknown;
  keys: ReadonlyMap<string, number>;
}

const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
const LITERALS: ReadonlyArray<readonly [string, unknown]> = [
  ["true", true],
  ["false", false],
  ["null", null],
];
const ESCAPES: Readonly<Record<string, string>> = {
  '"': '"',
  "\\": "\\",
  "/": "/",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
};
const MAX_DEPTH = 256;

class Failure {
  constructor(
    readonly offset: number,
    readonly message: string,
  ) {}
}

class JsoncParser {
  private pos = 0;
  readonly keys = new Map<string, number>();

  constructor(private readonly text: string) {}

  document(): unknown {
    const value = this.value(0);
    this.skip();
    if (this.pos < this.text.length) throw new Failure(this.pos, "Unexpected text after the end");
    return value;
  }

  private skip(): void {
    const text = this.text;
    while (this.pos < text.length) {
      const char = text[this.pos];
      if (char === " " || char === "\t" || char === "\n" || char === "\r" || char === "﻿") {
        this.pos += 1;
      } else if (char === "/" && text[this.pos + 1] === "/") {
        const end = text.indexOf("\n", this.pos);
        this.pos = end < 0 ? text.length : end;
      } else if (char === "/" && text[this.pos + 1] === "*") {
        const end = text.indexOf("*/", this.pos + 2);
        if (end < 0) throw new Failure(this.pos, "Unterminated comment");
        this.pos = end + 2;
      } else {
        return;
      }
    }
  }

  private value(depth: number): unknown {
    if (depth > MAX_DEPTH) throw new Failure(this.pos, "Too deeply nested");
    this.skip();
    const char = this.text[this.pos];
    if (char === "{") return this.object(depth);
    if (char === "[") return this.array(depth);
    if (char === '"') return this.string();
    NUMBER.lastIndex = this.pos;
    const number = NUMBER.exec(this.text);
    if (number) {
      this.pos += number[0].length;
      return Number(number[0]);
    }
    for (const [word, literal] of LITERALS) {
      if (this.text.startsWith(word, this.pos)) {
        this.pos += word.length;
        return literal;
      }
    }
    throw new Failure(this.pos, "Expected a value");
  }

  private object(depth: number): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    this.pos += 1;
    for (;;) {
      this.skip();
      if (this.text[this.pos] === "}") {
        this.pos += 1;
        return result;
      }
      if (this.text[this.pos] !== '"') throw new Failure(this.pos, "Expected a key in double quotes");
      const keyOffset = this.pos;
      const key = this.string();
      if (depth === 0) this.keys.set(key, keyOffset);
      this.skip();
      if (this.text[this.pos] !== ":") throw new Failure(this.pos, "Expected a colon after the key");
      this.pos += 1;
      Object.defineProperty(result, key, {
        value: this.value(depth + 1),
        enumerable: true,
        writable: true,
        configurable: true,
      });
      this.skip();
      if (this.text[this.pos] === ",") this.pos += 1;
      else if (this.text[this.pos] !== "}") throw new Failure(this.pos, "Expected a comma or a closing brace");
    }
  }

  private array(depth: number): unknown[] {
    const result: unknown[] = [];
    this.pos += 1;
    for (;;) {
      this.skip();
      if (this.text[this.pos] === "]") {
        this.pos += 1;
        return result;
      }
      result.push(this.value(depth + 1));
      this.skip();
      if (this.text[this.pos] === ",") this.pos += 1;
      else if (this.text[this.pos] !== "]") throw new Failure(this.pos, "Expected a comma or a closing bracket");
    }
  }

  private string(): string {
    const start = this.pos;
    const text = this.text;
    let out = "";
    this.pos += 1;
    while (this.pos < text.length) {
      const char = text[this.pos];
      if (char === '"') {
        this.pos += 1;
        return out;
      }
      if (char < " ") break;
      if (char === "\\") {
        const next = text[this.pos + 1];
        if (next === "u" && /^[0-9a-fA-F]{4}$/u.test(text.slice(this.pos + 2, this.pos + 6))) {
          out += String.fromCharCode(Number.parseInt(text.slice(this.pos + 2, this.pos + 6), 16));
          this.pos += 6;
          continue;
        }
        const escaped = next === undefined ? undefined : ESCAPES[next];
        if (escaped === undefined) throw new Failure(this.pos, "Invalid escape in a string");
        out += escaped;
        this.pos += 2;
        continue;
      }
      out += char;
      this.pos += 1;
    }
    throw new Failure(start, "Unterminated string");
  }
}

export function parseJsoncDocument(text: string): JsoncDocument | { error: JsoncError } {
  const parser = new JsoncParser(text);
  try {
    const value = parser.document();
    return { value, keys: parser.keys };
  } catch (error) {
    if (!(error instanceof Failure)) throw error;
    return { error: { offset: error.offset, message: error.message } };
  }
}

export function parseJsonc(text: string): { value: unknown } | { error: JsoncError } {
  const result = parseJsoncDocument(text);
  return "error" in result ? result : { value: result.value };
}
