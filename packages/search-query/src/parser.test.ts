import { describe, expect, it } from "vitest";
import { lex, type TermToken } from "./lexer";
import { parse, type QueryNode } from "./parser";

function show(node: QueryNode | null, source: string): string {
  if (!node) return "∅";
  if (node.type === "term") return source.slice(node.term.span.start, node.term.span.end);
  if (node.type === "not") return `NOT(${show(node.child, source)})`;
  return `${node.type.toUpperCase()}(${node.children.map((child) => show(child, source)).join(" ")})`;
}

function tree(source: string): string {
  return show(parse(source).root, source);
}

function terms(source: string): TermToken[] {
  return lex(source).filter((token): token is TermToken => token.kind === "term");
}

describe("lex", () => {
  it("splits qualifiers into key, values and commas", () => {
    const [term] = terms('label:"Needs Testing",bug');
    expect(term.key?.name).toBe("label");
    expect(term.items.map((item) => [item.text, item.quoted])).toEqual([
      ["Needs Testing", true],
      ["bug", false],
    ]);
    expect(term.commas).toHaveLength(1);
  });

  it("lowercases keys but keeps values as typed", () => {
    expect(terms("Engine:Typst")[0]).toMatchObject({ key: { name: "engine" }, items: [{ text: "Typst" }] });
  });

  it("reads a leading dash as negation", () => {
    const [qualifier, word, phrase] = terms('-engine:typst -draft -"exact words"');
    expect(qualifier.negation).not.toBeNull();
    expect(word.items[0].text).toBe("draft");
    expect(phrase.items[0]).toMatchObject({ text: "exact words", quoted: true });
  });

  it("keeps a lone dash as an empty negated term", () => {
    expect(terms("-")[0]).toMatchObject({ items: [], key: null });
  });

  it("only treats upper-case AND, OR and NOT as keywords", () => {
    expect(lex("a AND b or c NOT d").map((token) => token.kind)).toEqual([
      "term", "space", "and", "space", "term", "space", "term", "space", "term", "space", "not", "space", "term",
    ]);
  });

  it("reads a dash before a group as NOT", () => {
    expect(lex("-(a)").map((token) => token.kind)).toEqual(["not", "open", "term", "close"]);
  });

  it("keeps times with colons inside one value", () => {
    expect(terms("created:>2024-01-01T10:00:00Z")[0].items[0].text).toBe(">2024-01-01T10:00:00Z");
  });

  it("marks an unterminated quote and a trailing comma", () => {
    const [quoted] = terms('label:"open');
    expect(quoted.items[0]).toMatchObject({ text: "open", unterminated: true });
    const [comma] = terms("engine:typst,");
    expect(comma.items.map((item) => item.text)).toEqual(["typst", ""]);
  });

  it("covers a key with no value yet", () => {
    expect(terms("engine:")[0]).toMatchObject({ key: { name: "engine" }, items: [] });
  });
});

describe("parse", () => {
  it("joins plain terms with an implicit AND", () => {
    expect(tree("a b c")).toBe("AND(a b c)");
  });

  it("binds AND tighter than OR", () => {
    expect(tree("a b OR c")).toBe("OR(AND(a b) c)");
    expect(tree("a AND b OR c AND d")).toBe("OR(AND(a b) AND(c d))");
  });

  it("groups with parentheses", () => {
    expect(tree("a (b OR c)")).toBe("AND(a OR(b c))");
    expect(tree("(a b) OR c")).toBe("OR(AND(a b) c)");
  });

  it("negates terms, words and groups", () => {
    expect(tree("-a NOT b")).toBe("AND(NOT(-a) NOT(b))");
    expect(tree("NOT (a OR b)")).toBe("NOT(OR(a b))");
    expect(tree("-(a OR b)")).toBe("NOT(OR(a b))");
  });

  it("reports dangling operators and keeps the rest", () => {
    const parsed = parse("a OR");
    expect(parsed.issues.map((issue) => issue.code)).toEqual(["dangling-operator"]);
    expect(show(parsed.root, "a OR")).toBe("a");
    expect(parse("AND a").issues[0].code).toBe("dangling-operator");
    expect(parse("a AND OR b").issues.map((issue) => issue.code)).toEqual(["dangling-operator"]);
    expect(parse("a NOT").issues[0].code).toBe("dangling-operator");
  });

  it("reports unbalanced parentheses", () => {
    expect(parse("(a OR b").issues.map((issue) => issue.code)).toEqual(["unclosed-group"]);
    expect(tree("(a OR b")).toBe("OR(a b)");
    const stray = parse("a) b");
    expect(stray.issues.map((issue) => issue.code)).toEqual(["unexpected-close"]);
    expect(show(stray.root, "a) b")).toBe("AND(a b)");
  });

  it("reports empty groups, deep nesting and open quotes", () => {
    expect(parse("()").issues.map((issue) => issue.code)).toEqual(["empty-group"]);
    expect(parse("((((((a))))))").issues.map((issue) => issue.code)).toContain("too-deep");
    expect(parse("(((((a)))))").issues).toEqual([]);
    expect(parse('"open').issues.map((issue) => issue.code)).toEqual(["unterminated-quote"]);
  });

  it("ignores a lone dash and an empty query", () => {
    expect(parse("").root).toBeNull();
    expect(tree("a -")).toBe("a");
  });

  it("keeps group parentheses in the node span", () => {
    const parsed = parse("x (a OR b)");
    const root = parsed.root;
    expect(root?.type).toBe("and");
    if (root?.type !== "and") return;
    expect(root.children[1].span).toEqual({ start: 2, end: 10 });
  });
});
