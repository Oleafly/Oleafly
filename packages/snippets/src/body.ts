import { validRegexTransform } from "./helpers";
import {
  type BodyError,
  type BodyErrorCode,
  type BodyNode,
  type BodyParseResult,
  HELPERS,
  isOneOf,
  PROJECT_FIELD_KINDS,
  type RegexTransform,
} from "./types";

export const KNOWN_VARIABLES: ReadonlySet<string> = new Set([
  "CURRENT_YEAR",
  "CURRENT_YEAR_SHORT",
  "CURRENT_MONTH",
  "CURRENT_MONTH_NAME",
  "CURRENT_MONTH_NAME_SHORT",
  "CURRENT_DATE",
  "CURRENT_DAY_NAME",
  "CURRENT_DAY_NAME_SHORT",
  "CURRENT_HOUR",
  "CURRENT_MINUTE",
  "CURRENT_SECOND",
  "TM_FILENAME",
  "TM_FILENAME_BASE",
  "CLIPBOARD",
  "LINE_COMMENT",
  "SELECTION",
  "UUID",
  "RANDOM",
  "DATE",
  "PROJECT_NAME",
]);

const MESSAGES: Readonly<Record<BodyErrorCode, string>> = {
  unclosed: "A field opened here is never closed",
  "bad-field": "This is not a field. Write $1, ${1:text} or a variable such as ${SELECTION}",
  "unknown-helper": "Unknown helper. Use slug, lower, upper, title or initials",
  "unknown-project-field": "Unknown project field. Use image, label, cite, ref or file",
  "bad-transform": "This transform has an invalid regular expression or flags",
};

const DIGITS = /\d+/y;
const NAME = /[_a-zA-Z][_a-zA-Z0-9]*/y;
const CAPTURE = /\[\[(\d+)\]\]/y;
const KIND = /[a-z]*/y;

class Unclosed {
  constructor(readonly offset: number) {}
}

class Invalid {
  constructor(
    readonly offset: number,
    readonly code: BodyErrorCode,
  ) {}
}

type Owned = Extract<BodyNode, { index: number }>;

function normaliseName(name: string): string {
  return name === "TM_SELECTED_TEXT" ? "SELECTION" : name;
}

function pushText(nodes: BodyNode[], text: string): void {
  if (!text) return;
  const last = nodes.at(-1);
  if (last?.kind === "text") last.text += text;
  else nodes.push({ kind: "text", text });
}

class BodyParser {
  private pos = 0;
  private owners = new Map<number, Owned>();
  readonly errors: BodyError[] = [];

  constructor(private readonly source: string) {}

  parse(): BodyNode[] {
    const nodes: BodyNode[] = [];
    try {
      this.nodesUntil(nodes, false);
    } catch (error) {
      if (!(error instanceof Unclosed)) throw error;
      this.error(error.offset, "unclosed");
      pushText(nodes, this.source.slice(error.offset));
    }
    return nodes;
  }

  private error(offset: number, code: BodyErrorCode): void {
    this.errors.push({ offset, code, message: MESSAGES[code] });
  }

  private sticky(pattern: RegExp): string | null {
    pattern.lastIndex = this.pos;
    const match = pattern.exec(this.source);
    if (!match) return null;
    this.pos += match[0].length;
    return match[0];
  }

  private expect(char: string, start: number): void {
    if (this.pos >= this.source.length) throw new Unclosed(start);
    if (this.source[this.pos] !== char) throw new Invalid(start, "bad-field");
    this.pos += 1;
  }

  private nodesUntil(nodes: BodyNode[], inPlaceholder: boolean): BodyNode[] {
    const source = this.source;
    while (this.pos < source.length) {
      const char = source[this.pos];
      if (char === "\\") {
        const next = source[this.pos + 1];
        if (next === "$" || next === "}" || next === "\\") {
          pushText(nodes, next);
          this.pos += 2;
        } else {
          pushText(nodes, "\\");
          this.pos += 1;
        }
        continue;
      }
      if (char === "}" && inPlaceholder) return nodes;
      if (char === "$") {
        const node = this.dollar();
        if (node) nodes.push(node);
        else {
          pushText(nodes, "$");
          this.pos += 1;
        }
        continue;
      }
      if (char === "[") {
        CAPTURE.lastIndex = this.pos;
        const capture = CAPTURE.exec(source);
        if (capture) {
          nodes.push({ kind: "capture", group: Number(capture[1]) + 1 });
          this.pos += capture[0].length;
          continue;
        }
      }
      pushText(nodes, char);
      this.pos += 1;
    }
    return nodes;
  }

  private dollar(): BodyNode | null {
    const start = this.pos;
    const next = this.source[start + 1];
    if (next === "{") {
      this.pos += 2;
      try {
        return this.braced(start);
      } catch (error) {
        if (error instanceof Unclosed) throw new Unclosed(start);
        if (!(error instanceof Invalid)) throw error;
        this.error(start, error.code);
        this.pos = start;
        return null;
      }
    }
    this.pos += 1;
    const digits = this.sticky(DIGITS);
    if (digits !== null) return this.tabstop(Number(digits));
    const name = this.sticky(NAME);
    if (name !== null && KNOWN_VARIABLES.has(normaliseName(name))) {
      return { kind: "variable", name: normaliseName(name), fallback: [] };
    }
    this.pos = start;
    return null;
  }

  private tabstop(index: number): BodyNode {
    if (this.owners.has(index)) return { kind: "mirror", index };
    const node: Owned = { kind: "field", index, placeholder: [] };
    this.owners.set(index, node);
    return node;
  }

  private own<T extends Owned>(node: T): BodyNode {
    if (this.owners.has(node.index)) return { kind: "mirror", index: node.index };
    this.owners.set(node.index, node);
    return node;
  }

  private braced(start: number): BodyNode {
    if (this.pos >= this.source.length) throw new Unclosed(start);
    const digits = this.sticky(DIGITS);
    if (digits !== null) return this.numbered(Number(digits), start);
    const name = this.sticky(NAME);
    if (name !== null) return this.variable(normaliseName(name), start);
    throw new Invalid(start, "bad-field");
  }

  private numbered(index: number, start: number): BodyNode {
    if (this.pos >= this.source.length) throw new Unclosed(start);
    const char = this.source[this.pos];
    this.pos += 1;
    switch (char) {
      case "}":
        return this.tabstop(index);
      case ":":
        return this.field(index, start);
      case "|":
        return this.own({ kind: "choice", index, options: this.choice(start) });
      case "/":
        return this.mirror(index, start);
      case "@":
        return this.project(index, start);
      default:
        throw new Invalid(start, "bad-field");
    }
  }

  private field(index: number, start: number): BodyNode {
    const owner = this.owners.get(index);
    const saved = owner ? new Map(this.owners) : null;
    const node: Owned = { kind: "field", index, placeholder: [] };
    if (!owner) this.owners.set(index, node);
    const placeholder = this.nodesUntil([], true);
    this.expect("}", start);
    if (!owner) {
      node.placeholder = placeholder;
      return node;
    }
    if (owner.kind === "field" && owner.placeholder.length === 0 && placeholder.length > 0) {
      owner.placeholder = placeholder;
    } else if (saved) {
      this.owners = saved;
    }
    return { kind: "mirror", index };
  }

  private choice(start: number): string[] {
    const options: string[] = [];
    let current = "";
    const source = this.source;
    while (this.pos < source.length) {
      const char = source[this.pos];
      if (char === "\\" && ",|\\$}".includes(source[this.pos + 1] ?? "")) {
        current += source[this.pos + 1];
        this.pos += 2;
        continue;
      }
      if (char === "|" && source[this.pos + 1] === "}") {
        options.push(current);
        this.pos += 2;
        return options;
      }
      if (char === ",") {
        options.push(current);
        current = "";
      } else {
        current += char;
      }
      this.pos += 1;
    }
    throw new Unclosed(start);
  }

  private plainUntilBrace(start: number): string {
    let value = "";
    const source = this.source;
    while (this.pos < source.length) {
      const char = source[this.pos];
      if (char === "\\" && "$}\\".includes(source[this.pos + 1] ?? "")) {
        value += source[this.pos + 1];
        this.pos += 2;
        continue;
      }
      if (char === "}") {
        this.pos += 1;
        return value;
      }
      value += char;
      this.pos += 1;
    }
    throw new Unclosed(start);
  }

  private project(index: number, start: number): BodyNode {
    const kind = this.sticky(KIND) ?? "";
    if (this.pos >= this.source.length) throw new Unclosed(start);
    if (!isOneOf(PROJECT_FIELD_KINDS, kind)) {
      this.plainUntilBrace(start);
      throw new Invalid(start, "unknown-project-field");
    }
    const char = this.source[this.pos];
    this.pos += 1;
    let placeholder = "";
    if (char === ":") placeholder = this.plainUntilBrace(start);
    else if (char !== "}") throw new Invalid(start, "bad-field");
    return this.own({ kind: "project", index, field: kind, placeholder });
  }

  private regexPart(start: number): string {
    let value = "";
    const source = this.source;
    while (this.pos < source.length) {
      const char = source[this.pos];
      if (char === "\\" && this.pos + 1 < source.length) {
        const next = source[this.pos + 1];
        value += next === "/" ? "/" : char + next;
        this.pos += 2;
        continue;
      }
      if (char === "/") {
        this.pos += 1;
        return value;
      }
      value += char;
      this.pos += 1;
    }
    throw new Unclosed(start);
  }

  private formatPart(start: number): string {
    let value = "";
    let depth = 0;
    const source = this.source;
    while (this.pos < source.length) {
      const char = source[this.pos];
      if (char === "\\" && this.pos + 1 < source.length) {
        value += char + source[this.pos + 1];
        this.pos += 2;
        continue;
      }
      if (char === "/" && depth === 0) {
        this.pos += 1;
        return value;
      }
      if (char === "$" && source[this.pos + 1] === "{") {
        depth += 1;
        value += "${";
        this.pos += 2;
        continue;
      }
      if (char === "}" && depth > 0) depth -= 1;
      value += char;
      this.pos += 1;
    }
    throw new Unclosed(start);
  }

  private transform(start: number): RegexTransform {
    const source = this.regexPart(start);
    const format = this.formatPart(start);
    const flags = this.plainUntilBrace(start);
    const transform = { source, format, flags };
    if (!validRegexTransform(transform)) throw new Invalid(start, "bad-transform");
    return transform;
  }

  private mirror(index: number, start: number): BodyNode {
    const source = this.source;
    let scan = this.pos;
    while (scan < source.length && source[scan] !== "/" && source[scan] !== "}") {
      scan += source[scan] === "\\" ? 2 : 1;
    }
    if (scan >= source.length) throw new Unclosed(start);
    if (source[scan] === "}") {
      const helper = source.slice(this.pos, scan);
      this.pos = scan + 1;
      if (!isOneOf(HELPERS, helper)) throw new Invalid(start, "unknown-helper");
      return { kind: "mirror", index, helper };
    }
    return { kind: "mirror", index, regex: this.transform(start) };
  }

  private variable(name: string, start: number): BodyNode {
    if (this.pos >= this.source.length) throw new Unclosed(start);
    const char = this.source[this.pos];
    this.pos += 1;
    if (char === "}") return { kind: "variable", name, fallback: [] };
    if (char === "/") return { kind: "variable", name, regex: this.transform(start), fallback: [] };
    if (char !== ":") throw new Invalid(start, "bad-field");
    if (name === "DATE") return { kind: "variable", name, format: this.plainUntilBrace(start), fallback: [] };
    const fallback = this.nodesUntil([], true);
    this.expect("}", start);
    return { kind: "variable", name, fallback };
  }
}

export function parseBody(body: string): BodyParseResult {
  const parser = new BodyParser(body);
  const nodes = parser.parse();
  return { nodes, errors: parser.errors };
}

export type EscapeMode = "top" | "placeholder" | "choice";

const ESCAPED: Readonly<Record<EscapeMode, string>> = { top: "$", placeholder: "$}", choice: ",|" };
const AFTER_BACKSLASH: Readonly<Record<EscapeMode, string>> = {
  top: "$}\\",
  placeholder: "$}\\",
  choice: ",|\\$}",
};

export function escapeBodyText(text: string, mode: EscapeMode): string {
  let out = "";
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (char === "\\") {
      let end = index;
      while (text[end] === "\\") end += 1;
      const run = end - index;
      const next = text[end];
      const double = run > 1 || next === undefined || AFTER_BACKSLASH[mode].includes(next);
      out += double ? "\\\\".repeat(run) : "\\";
      index = end;
      continue;
    }
    out += ESCAPED[mode].includes(char) ? `\\${char}` : char;
    index += 1;
  }
  return out;
}

function tabstopText(index: number, next: BodyNode | undefined): string {
  return next?.kind === "text" && /^\d/u.test(next.text) ? `\${${index}}` : `$${index}`;
}

function transformText(transform: RegexTransform): string {
  return `/${transform.source.replaceAll("/", "\\/")}/${transform.format}/${transform.flags}`;
}

function nodeText(node: BodyNode, next: BodyNode | undefined, mode: EscapeMode): string {
  switch (node.kind) {
    case "text":
      return escapeBodyText(node.text, mode);
    case "field":
      return node.placeholder.length === 0
        ? tabstopText(node.index, next)
        : `\${${node.index}:${serializeNodes(node.placeholder, "placeholder")}}`;
    case "choice":
      return `\${${node.index}|${node.options.map((option) => escapeBodyText(option, "choice")).join(",")}|}`;
    case "project":
      return node.placeholder
        ? `\${${node.index}@${node.field}:${escapeBodyText(node.placeholder, "placeholder")}}`
        : `\${${node.index}@${node.field}}`;
    case "mirror":
      if (node.helper) return `\${${node.index}/${node.helper}}`;
      if (node.regex) return `\${${node.index}${transformText(node.regex)}}`;
      return tabstopText(node.index, next);
    case "variable":
      if (node.format !== undefined) return `\${${node.name}:${escapeBodyText(node.format, "placeholder")}}`;
      if (node.regex) return `\${${node.name}${transformText(node.regex)}}`;
      if (node.fallback.length > 0) return `\${${node.name}:${serializeNodes(node.fallback, "placeholder")}}`;
      return `\${${node.name}}`;
    case "capture":
      return `[[${node.group - 1}]]`;
  }
}

function serializeNodes(nodes: readonly BodyNode[], mode: EscapeMode): string {
  return nodes.map((node, index) => nodeText(node, nodes[index + 1], mode)).join("");
}

export function serializeBody(nodes: readonly BodyNode[]): string {
  return serializeNodes(nodes, "top");
}

export function bodyUses(nodes: readonly BodyNode[], variable: string): boolean {
  return nodes.some((node) => {
    if (node.kind === "variable") return node.name === variable || bodyUses(node.fallback, variable);
    if (node.kind === "field") return bodyUses(node.placeholder, variable);
    return false;
  });
}
