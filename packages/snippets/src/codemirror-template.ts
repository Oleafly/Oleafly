import type { BodyNode } from "./types";

type CmNode = { kind: "text"; text: string } | { kind: "field"; seq: number | null; name: string; children: CmNode[] };
type CmField = Extract<CmNode, { kind: "field" }>;

const DIGITS = /\d+/y;

function pushText(nodes: CmNode[], text: string): void {
  const last = nodes.at(-1);
  if (last?.kind === "text") last.text += text;
  else nodes.push({ kind: "text", text });
}

function flatten(nodes: readonly CmNode[]): string {
  return nodes.map((node) => (node.kind === "text" ? node.text : node.name)).join("");
}

class TemplateParser {
  private pos = 0;

  constructor(private readonly source: string) {}

  parse(): CmNode[] {
    const nodes: CmNode[] = [];
    const source = this.source;
    while (this.pos < source.length) {
      const char = source[this.pos];
      const next = source[this.pos + 1];
      if (char === "\\" && (next === "{" || next === "}")) {
        pushText(nodes, next);
        this.pos += 2;
        continue;
      }
      if ((char === "$" || char === "#") && next === "{") {
        const field = this.field(this.pos);
        if (field) {
          nodes.push(field);
          continue;
        }
      }
      pushText(nodes, char);
      this.pos += 1;
    }
    return nodes;
  }

  private field(start: number): CmField | null {
    this.pos = start + 2;
    DIGITS.lastIndex = this.pos;
    const digits = DIGITS.exec(this.source);
    if (digits) {
      this.pos += digits[0].length;
      const seq = Number(digits[0]);
      if (this.source[this.pos] === "}") {
        this.pos += 1;
        return { kind: "field", seq, name: "", children: [] };
      }
      if (this.source[this.pos] === ":") {
        this.pos += 1;
        const children = this.content(true);
        if (children && this.source[this.pos] === "}") {
          this.pos += 1;
          return { kind: "field", seq, name: flatten(children), children };
        }
      }
      this.pos = start + 2;
    }
    const children = this.content(false);
    if (children && this.source[this.pos] === "}") {
      this.pos += 1;
      return { kind: "field", seq: null, name: flatten(children), children };
    }
    this.pos = start;
    return null;
  }

  private content(numbered: boolean): CmNode[] | null {
    const nodes: CmNode[] = [];
    const source = this.source;
    while (this.pos < source.length) {
      const char = source[this.pos];
      const next = source[this.pos + 1];
      if (char === "}") return nodes;
      if (char === "{" || char === "\n" || char === "\r") return null;
      if (char === "\\" && (next === "{" || next === "}")) {
        if (numbered) return null;
        pushText(nodes, next);
        this.pos += 2;
        continue;
      }
      if ((char === "$" || char === "#") && next === "{") {
        const resume = this.pos;
        const field = this.field(resume);
        if (field) {
          nodes.push(field);
          continue;
        }
        this.pos = resume;
      }
      pushText(nodes, char);
      this.pos += 1;
    }
    return null;
  }
}

function keyOf(field: CmField, unnamed: Map<CmField, string>): string {
  if (field.seq !== null) return `#${field.seq}`;
  if (field.name) return `:${field.name}`;
  let key = unnamed.get(field);
  if (!key) {
    key = `!${unnamed.size}`;
    unnamed.set(field, key);
  }
  return key;
}

export function parseCodeMirrorTemplate(template: string): BodyNode[] {
  const tree = new TemplateParser(template).parse();
  const unnamed = new Map<CmField, string>();
  const numbered = new Map<string, number>();
  const others: string[] = [];
  const visit = (nodes: readonly CmNode[]): void => {
    for (const node of nodes) {
      if (node.kind !== "field") continue;
      visit(node.children);
      const key = keyOf(node, unnamed);
      if (node.seq !== null) numbered.set(key, node.seq === 0 ? 1e9 : node.seq);
      else if (!others.includes(key)) others.push(key);
    }
  };
  visit(tree);
  const ordered = [...[...numbered].sort((a, b) => a[1] - b[1]).map(([key]) => key), ...others];
  const indexes = new Map(ordered.map((key, position) => [key, position === ordered.length - 1 ? 0 : position + 1]));
  const owned = new Set<string>();
  const build = (nodes: readonly CmNode[]): BodyNode[] =>
    nodes.map((node): BodyNode => {
      if (node.kind === "text") return { kind: "text", text: node.text };
      const key = keyOf(node, unnamed);
      const index = indexes.get(key) as number;
      if (owned.has(key)) return { kind: "mirror", index };
      owned.add(key);
      return { kind: "field", index, placeholder: build(node.children) };
    });
  return build(tree);
}
