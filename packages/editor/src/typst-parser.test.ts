import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { NodeProp, Tree, type TreeBuffer, TreeFragment, type SyntaxNode } from "@lezer/common";
import { describe, expect, it } from "vitest";
import { parseTypst, typstParser, typstPlainTitle } from "./typst-parser";

function shape(node: SyntaxNode): string {
  if (node.type.isError) return "⚠";
  const children: string[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) children.push(shape(child));
  return children.length > 0 ? `${node.name}(${children.join(" ")})` : node.name;
}

function positioned(node: SyntaxNode): string {
  const head = `${node.type.isError ? "⚠" : node.name}[${node.from},${node.to}]`;
  if (node.type.isError) return head;
  const children: string[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) children.push(positioned(child));
  return children.length > 0 ? `${head}(${children.join(" ")})` : head;
}

function topLevel(tree: Tree, render: (node: SyntaxNode) => string): string {
  const parts: string[] = [];
  for (let child = tree.topNode.firstChild; child; child = child.nextSibling) parts.push(render(child));
  return parts.join(" ");
}

const structure = (text: string): string => topLevel(parseTypst(text), shape);

function errorsIn(tree: Tree): number {
  let count = 0;
  tree.iterate({
    enter(node) {
      if (node.type.isError) count += 1;
    },
  });
  return count;
}

function namesIn(text: string, name: string): string[] {
  const found: string[] = [];
  parseTypst(text).iterate({
    enter(node) {
      if (node.name === name) found.push(text.slice(node.from, node.to));
    },
  });
  return found;
}

const SEEDS = fileURLToPath(new URL("../../../fixtures/research-seeds/", import.meta.url));

function seedFiles(): { path: string; text: string }[] {
  return readdirSync(SEEDS, { recursive: true, encoding: "utf8" })
    .map((path) => path.replaceAll("\\", "/"))
    .filter((path) => /^[^/]+-typst\//u.test(path) && path.endsWith(".typ"))
    .sort()
    .map((path) => ({ path, text: readFileSync(`${SEEDS}${path}`, "utf8").replaceAll("\r\n", "\n") }));
}

function chunksOf(tree: Tree): Set<Tree | TreeBuffer> {
  const chunks = new Set<Tree | TreeBuffer>();
  const visit = (node: Tree) => {
    for (const child of node.children) {
      const balance =
        child instanceof Tree &&
        child.type.isAnonymous &&
        child.children.length > 0 &&
        child.children.every((inner) => inner instanceof Tree && inner.type.isAnonymous);
      if (balance) visit(child);
      else chunks.add(child);
    }
  };
  visit(tree);
  return chunks;
}

describe("Typst syntax tree", () => {
  it.each([
    [
      "headings",
      "= One\n== Two\n====== Six",
      "Heading(HeadingMarker Markup) Heading(HeadingMarker Markup) Heading(HeadingMarker Markup)",
    ],
    ["a heading label", "= Results <results>", "Heading(HeadingMarker Markup) Label"],
    [
      "lists, enums and terms",
      "- first\n  continued\n+ auto\n2. explicit\n/ Term: description",
      "ListItem(ListMarker Markup) EnumItem(EnumMarker Markup) EnumItem(EnumMarker Markup) TermItem(TermMarker Markup Colon Markup)",
    ],
    [
      "strong and emphasis",
      "*bold _both_* and _emph_ and snake_case",
      "Strong(Star Markup(Emph(Underscore Markup Underscore)) Star) Emph(Underscore Markup Underscore)",
    ],
    [
      "escapes, line breaks, shorthands and smart quotes",
      "\\# \\u{1F600} line \\\n~ -- --- ... -? \"quoted\" 'single'",
      "Escape Escape Linebreak Shorthand Shorthand Shorthand Shorthand Shorthand SmartQuote SmartQuote SmartQuote SmartQuote",
    ],
    ["nested comments", "/* outer /* inner */ still */ text // trailing", "BlockComment LineComment"],
    [
      "inline and fenced raw",
      "`inline` ```python\nprint(1)\n```",
      "Raw(RawDelim RawDelim) Raw(RawDelim RawLang RawDelim)",
    ],
    ["strings with escapes", '#"a \\"b\\" \\u{41}"', "Hash Str"],
    [
      "labels and references",
      "<intro> @intro @fig:a[Figure] @eq.1.",
      "Label Ref(RefMarker) Ref(RefMarker ContentBlock(LeftBracket Markup RightBracket)) Ref(RefMarker)",
    ],
    ["links", "See https://typst.app/docs.", "Link"],
    [
      "math with code interpolation",
      "$ x^2 + #f(y) / 2 $ and $a_i'$",
      "Equation(Dollar Math(MathAttach(MathText Hat MathText) MathText MathFrac(Hash FuncCall(Ident Args(LeftParen Ident RightParen)) Slash MathText)) Dollar) Equation(Dollar Math(MathAttach(MathText Underscore MathAttach(MathText MathPrimes))) Dollar)",
    ],
    [
      "math calls, matrices and field access",
      "$sqrt(x) mat(1, 2; 3, 4) lr(( a )) arrow.r$",
      "Equation(Dollar Math(MathCall(MathIdent MathArgs(LeftParen MathText RightParen)) MathCall(MathIdent MathArgs(LeftParen MathText Comma MathText Semicolon MathText Comma MathText RightParen)) MathCall(MathIdent MathArgs(LeftParen MathDelimited(MathText Math(MathText) MathText) RightParen)) MathFieldAccess(MathIdent Dot MathIdent)) Dollar)",
    ],
    [
      "calls with positional, named and trailing content arguments",
      '#figure(image("a.png"), caption: [A *b*])[Body]',
      "Hash FuncCall(Ident Args(LeftParen FuncCall(Ident Args(LeftParen Str RightParen)) Comma Named(Ident Colon ContentBlock(LeftBracket Markup(Strong(Star Markup Star)) RightBracket)) RightParen ContentBlock(LeftBracket Markup RightBracket)))",
    ],
    [
      "field access and method chains",
      "#a.b.c(1).d()",
      "Hash FuncCall(FieldAccess(FuncCall(FieldAccess(FieldAccess(Ident Dot Ident) Dot Ident) Args(LeftParen Int RightParen)) Dot Ident) Args(LeftParen RightParen))",
    ],
    [
      "set and show rules with selectors",
      "#set text(size: 11pt) if dark\n#show heading.where(level: 1): it => [#it.body]\n#show: doc => doc",
      "Hash SetRule(Set Ident Args(LeftParen Named(Ident Colon Numeric) RightParen) If Ident) Hash ShowRule(Show FuncCall(FieldAccess(Ident Dot Ident) Args(LeftParen Named(Ident Colon Int) RightParen)) Colon Closure(Params(Ident) Arrow ContentBlock(LeftBracket Markup(Hash FieldAccess(Ident Dot Ident)) RightBracket))) Hash ShowRule(Show Colon Closure(Params(Ident) Arrow Ident))",
    ],
    [
      "let bindings and closures",
      "#let f(x, y: 2, ..rest) = x + y\n#let g = (a, b) => a * b",
      "Hash LetBinding(Let Closure(Ident Params(LeftParen Ident Comma Named(Ident Colon Int) Comma Spread(Dots Ident) RightParen) Eq Binary(Ident Plus Ident))) Hash LetBinding(Let Ident Eq Closure(Params(LeftParen Ident Comma Ident RightParen) Arrow Binary(Ident Star Ident)))",
    ],
    [
      "imports and includes",
      '#import "m.typ": a, b as c\n#include "c.typ"',
      "Hash ModuleImport(Import Str Colon ImportItems(ImportItemPath(Ident) Comma RenamedImportItem(ImportItemPath(Ident) As Ident))) Hash ModuleInclude(Include Str)",
    ],
    ["context", "#context text.lang", "Hash Contextual(Context FieldAccess(Ident Dot Ident))"],
    [
      "if, else if and else",
      "#if a { b } else if c [d] else { e }",
      "Hash Conditional(If Ident CodeBlock(LeftBrace Code(Ident) RightBrace) Else Conditional(If Ident ContentBlock(LeftBracket Markup RightBracket) Else CodeBlock(LeftBrace Code(Ident) RightBrace)))",
    ],
    [
      "loops with break and continue",
      "#for (k, v) in d { continue }\n#while x < 3 { x += 1; break }",
      "Hash ForLoop(For Destructuring(LeftParen Ident Comma Ident RightParen) In Ident CodeBlock(LeftBrace Code(LoopContinue(Continue)) RightBrace)) Hash WhileLoop(While Binary(Ident Lt Int) CodeBlock(LeftBrace Code(Binary(Ident PlusEq Int) Semicolon LoopBreak(Break)) RightBrace))",
    ],
    [
      "return",
      "#let h() = { return none }",
      "Hash LetBinding(Let Closure(Ident Params(LeftParen RightParen) Eq CodeBlock(LeftBrace Code(FuncReturn(Return None)) RightBrace)))",
    ],
    [
      "dictionaries and arrays",
      '#(a: 1, "b": 2) #(1, 2, ..rest) #(:) #(1,)',
      "Hash Dict(LeftParen Named(Ident Colon Int) Comma Keyed(Str Colon Int) RightParen) Hash Array(LeftParen Int Comma Int Comma Spread(Dots Ident) RightParen) Hash Dict(LeftParen Colon RightParen) Hash Array(LeftParen Int Comma RightParen)",
    ],
    [
      "code blocks with keywords and no hash",
      "#{\n  let k = x => x\n  let (a, b) = (1, 2)\n  if a > 1 { b } else { k(a) }\n  for i in range(3) [#i]\n}",
      "Hash CodeBlock(LeftBrace Code(LetBinding(Let Ident Eq Closure(Params(Ident) Arrow Ident)) LetBinding(Let Destructuring(LeftParen Ident Comma Ident RightParen) Eq Array(LeftParen Int Comma Int RightParen)) Conditional(If Binary(Ident Gt Int) CodeBlock(LeftBrace Code(Ident) RightBrace) Else CodeBlock(LeftBrace Code(FuncCall(Ident Args(LeftParen Ident RightParen))) RightBrace)) ForLoop(For Ident In FuncCall(Ident Args(LeftParen Int RightParen)) ContentBlock(LeftBracket Markup(Hash Ident) RightBracket))) RightBrace)",
    ],
    [
      "content blocks returning to markup inside code",
      "#box[*bold* #x and $y$]",
      "Hash FuncCall(Ident Args(ContentBlock(LeftBracket Markup(Strong(Star Markup Star) Hash Ident Equation(Dollar Math(MathText) Dollar)) RightBracket)))",
    ],
    ["unclosed delimiters", "#f(a, [b", "Hash FuncCall(Ident Args(⚠ Ident Comma ContentBlock(⚠ Markup)))"],
  ])("matches Typst's own tree for %s", (_name, text, expected) => {
    expect(structure(text)).toBe(expected);
  });

  it("matches Typst's positions, including the gap a heading label leaves", () => {
    const text = "= Hi *there* <l>\n#let f(x) = x + 1\n- a\n  b\n$ x^2 $ @ref[s] `raw` #f(1)[c]";
    expect(topLevel(parseTypst(text), positioned)).toBe(
      "Heading[0,12](HeadingMarker[0,1] Markup[2,12](Strong[5,12](Star[5,6] Markup[6,11] Star[11,12]))) Label[13,16] Hash[17,18] LetBinding[18,34](Let[18,21] Closure[22,34](Ident[22,23] Params[23,26](LeftParen[23,24] Ident[24,25] RightParen[25,26]) Eq[27,28] Binary[29,34](Ident[29,30] Plus[31,32] Int[33,34]))) ListItem[35,42](ListMarker[35,36] Markup[37,42]) Equation[43,50](Dollar[43,44] Math[45,48](MathAttach[45,48](MathText[45,46] Hat[46,47] MathText[47,48])) Dollar[49,50]) Ref[51,58](RefMarker[51,55] ContentBlock[55,58](LeftBracket[55,56] Markup[56,57] RightBracket[57,58])) Raw[59,64](RawDelim[59,60] RawDelim[63,64]) Hash[65,66] FuncCall[66,73](Ident[66,67] Args[67,73](LeftParen[67,68] Int[68,69] RightParen[69,70] ContentBlock[70,73](LeftBracket[70,71] Markup[71,72] RightBracket[72,73])))",
    );
  });

  it("ends an embedded expression at whitespace and a statement at the line end", () => {
    expect(structure("#f (x) and #x.y z")).toBe("Hash Ident Hash FieldAccess(Ident Dot Ident)");
    expect(structure("#let x = 1 + 2\nprose + more")).toBe(
      "Hash LetBinding(Let Ident Eq Binary(Int Plus Int))",
    );
  });

  it("keeps markup markers literal away from a line start", () => {
    expect(structure("a - b + c / d: e = f")).toBe("");
  });

  it("does not treat code-looking prose as code", () => {
    expect(namesIn("true story about 3 cats and none left", "Bool")).toEqual([]);
    expect(namesIn("true story about 3 cats and none left", "Int")).toEqual([]);
  });

  it("names the role of hashes and identifiers through groups", () => {
    const tree = parseTypst('#let x = 1\n#figure(x) #x #"s" #12pt #none #(1)');
    const roles: string[] = [];
    tree.iterate({
      enter(node) {
        if (node.name !== "Hash" && node.name !== "Ident") return;
        const groups = node.type.prop(NodeProp.group) ?? [];
        roles.push(`${node.name}:${groups.join(",") || "-"}`);
      },
    });
    expect(roles).toEqual([
      "Hash:HashKeyword",
      "Ident:DefinedName",
      "Hash:HashFunction",
      "Ident:FunctionName",
      "Ident:VariableName",
      "Hash:HashVariable",
      "Ident:VariableName",
      "Hash:HashString",
      "Hash:HashNumber",
      "Hash:HashLiteral",
      "Hash:-",
    ]);
  });

  it.each([
    ["$√x ∛(a+b) x! a'^2 x^a_b x_i' 1/2/3$", "Equation(Dollar Math(MathRoot(Root MathText) MathRoot(Root Math(LeftParen Math(MathText MathText MathText) RightParen)) Math(MathText MathText) MathAttach(MathText MathPrimes Hat MathText) MathAttach(MathText Hat MathText Underscore MathText) MathAttach(MathText Underscore MathAttach(MathText MathPrimes)) MathFrac(MathFrac(MathText Slash MathText) Slash MathText)) Dollar)"],
    ["$a' b'$ $f(x)' x!!$", "Equation(Dollar Math(MathAttach(MathText MathPrimes) MathAttach(MathText MathPrimes)) Dollar) Equation(Dollar Math(MathAttach(Math(MathText MathDelimited(MathText Math(MathText) MathText)) MathPrimes) Math(Math(MathText MathText) MathText)) Dollar)"],
    ["#(a not in b) #(a not b)", "Hash Parenthesized(LeftParen Binary(Ident Not In Ident) RightParen) Hash Array(LeftParen Ident Not ⚠ Ident RightParen)"],
    ["#-x and #(not true)", "Hash ⚠ Hash Parenthesized(LeftParen Unary(Not Bool) RightParen)"],
    ['#(a: 1, a: 2, "b": 3, "b": 4)', "Hash Dict(LeftParen Named(Ident Colon Int) Comma Named(⚠ Colon Int) Comma Keyed(Str Colon Int) Comma Keyed(⚠ Colon Int) RightParen)"],
    ["#(1, a: 2) #(a: 1, 2)", "Hash Array(LeftParen Int Comma ⚠ RightParen) Hash Dict(LeftParen Named(Ident Colon Int) Comma ⚠ RightParen)"],
  ])("keeps math operators, unary and binary code and duplicate keys in %j", (text, expected) => {
    expect(structure(text)).toBe(expected);
  });

  it("produces no error nodes for any research seed, all of which Typst compiles", () => {
    const seeds = seedFiles();
    expect(seeds.length).toBeGreaterThan(60);
    for (const seed of seeds) {
      expect({ path: seed.path, errors: errorsIn(parseTypst(seed.text)) }).toEqual({
        path: seed.path,
        errors: 0,
      });
    }
  });
});

describe("Typst syntax tree for destructuring, imports and math arguments", () => {
  it.each([
    [
      "a destructuring assignment in parentheses",
      "#((a, b) = (1, 2))",
      "Hash Parenthesized(LeftParen DestructAssignment(Destructuring(LeftParen Ident Comma Ident RightParen) Eq Array(LeftParen Int Comma Int RightParen)) RightParen)",
    ],
    [
      "a named destructuring assignment in code",
      "#{ (a: b) = c }",
      "Hash CodeBlock(LeftBrace Code(DestructAssignment(Destructuring(LeftParen Named(Ident Colon Ident) RightParen) Eq Ident)) RightBrace)",
    ],
    [
      "a parenthesised closure parameter",
      "#{ (x) => x }",
      "Hash CodeBlock(LeftBrace Code(Closure(Params(LeftParen Ident RightParen) Arrow Ident)) RightBrace)",
    ],
    [
      "closures without, with trailing and with sink parameters",
      "#{ () => 1 }\n#{ (a, b,) => 1 }\n#{ (..) => 1 }",
      "Hash CodeBlock(LeftBrace Code(Closure(Params(LeftParen RightParen) Arrow Int)) RightBrace) Hash CodeBlock(LeftBrace Code(Closure(Params(LeftParen Ident Comma Ident Comma RightParen) Arrow Int)) RightBrace) Hash CodeBlock(LeftBrace Code(Closure(Params(LeftParen Spread(Dots) RightParen) Arrow Int)) RightBrace)",
    ],
    [
      "spread, named, placeholder and nested destructuring in let bindings",
      "#let (a, ..rest) = arr\n#let (a: x, ..) = d\n#let (_, b) = p\n#let ((a, b), c) = p",
      "Hash LetBinding(Let Destructuring(LeftParen Ident Comma Spread(Dots Ident) RightParen) Eq Ident) Hash LetBinding(Let Destructuring(LeftParen Named(Ident Colon Ident) Comma Spread(Dots) RightParen) Eq Ident) Hash LetBinding(Let Destructuring(LeftParen Underscore Comma Ident RightParen) Eq Ident) Hash LetBinding(Let Destructuring(LeftParen Destructuring(LeftParen Ident Comma Ident RightParen) Comma Ident RightParen) Eq Ident)",
    ],
    [
      "renamed, wildcard, parenthesised and nested imports",
      '#import "m.typ" as n\n#import "m.typ": *\n#import "m.typ": (a, b)\n#import "m.typ": a.b as c',
      "Hash ModuleImport(Import Str As Ident) Hash ModuleImport(Import Str Colon Star) Hash ModuleImport(Import Str Colon LeftParen ImportItems(ImportItemPath(Ident) Comma ImportItemPath(Ident)) RightParen) Hash ModuleImport(Import Str Colon ImportItems(RenamedImportItem(ImportItemPath(Ident Dot Ident) As Ident)))",
    ],
    [
      "spread and named arguments in math calls",
      '$mat(..x) mat(delim: "[", 1, 2)$',
      'Equation(Dollar Math(MathCall(MathIdent MathArgs(LeftParen Spread(Dots MathText) RightParen)) MathCall(MathIdent MathArgs(LeftParen Named(Ident Colon Str) Comma MathText Comma MathText RightParen))) Dollar)',
    ],
    [
      "bracket shorthands and primes in math",
      "$[| x |]$ $ a'' b $",
      "Equation(Dollar Math(MathDelimited(MathShorthand Math(MathText) MathShorthand)) Dollar) Equation(Dollar Math(MathAttach(MathText MathPrimes) MathText) Dollar)",
    ],
    [
      "an underscore parameter and chained content arguments",
      "#let f(_) = 1\n#f[a][b]",
      "Hash LetBinding(Let Closure(Ident Params(LeftParen Underscore RightParen) Eq Int)) Hash FuncCall(Ident Args(ContentBlock(LeftBracket Markup RightBracket) ContentBlock(LeftBracket Markup RightBracket)))",
    ],
  ])("parses %s", (_name, text, expected) => {
    expect(structure(text)).toBe(expected);
    expect(errorsIn(parseTypst(text))).toBe(0);
  });

  it.each([
    ["a repeated binding", "#let (a, a) = p", "LetBinding"],
    ["two sinks", "#let (..a, ..b) = p", "LetBinding"],
    ["a literal in a pattern", "#let (1) = p", "LetBinding"],
    ["a keyword in a pattern", "#let (let) = p", "LetBinding"],
    ["a repeated parameter", "#let f(x, x) = 1", "LetBinding"],
    ["two sink parameters", "#let f(..a, ..b) = 1", "LetBinding"],
    ["a literal parameter", "#let f(1) = 1", "LetBinding"],
    ["a repeated named parameter", "#let f(a: 1, a: 2) = 1", "LetBinding"],
    ["a repeated key", '#("a": 1, "a": 2)', "Dict"],
    ["a positional item after a named one", "#(a: 1, 2)", "Dict"],
    ["a named item after a positional one", "#(1, b: 2)", "Array"],
    ["a repeated named argument", "#f(a: 1, a: 2)", "FuncCall"],
    ["a repeated named math argument", "$func(a: 1, a: 2)$", "Equation"],
    ["a placeholder math argument name", "$func(_: 1)$", "Equation"],
    ["an empty spread", "#f(..)", "FuncCall"],
    ["a missing binding body", "#let f(x) =", "LetBinding"],
    ["a missing rename", '#import "m.typ": a as', "ModuleImport"],
    ["an expression after break", "#{ break 1 }", "CodeBlock"],
    ["an incomplete loop", "#for x in", "ForLoop"],
  ])("recovers from %s", (_name, text, outer) => {
    expect(errorsIn(parseTypst(text))).toBeGreaterThan(0);
    expect(structure(text)).toContain(`${outer}(`);
  });
});

describe("incremental Typst parsing", () => {
  const document = seedFiles()
    .map((seed) => seed.text)
    .join("\n\n");

  function edit(text: string, from: number, to: number, insert: string) {
    const tree = parseTypst(text);
    const next = text.slice(0, from) + insert + text.slice(to);
    const fragments = TreeFragment.applyChanges(TreeFragment.addTree(tree), [
      { fromA: from, toA: to, fromB: from, toB: from + insert.length },
    ]);
    return { tree, next, reparsed: typstParser.parse(next, fragments) };
  }

  it("reparses only around an edit and reuses the rest of the tree", () => {
    const at = Math.floor(document.length / 2);
    const { tree, next, reparsed } = edit(document, at, at, "x");
    expect(topLevel(reparsed, positioned)).toBe(topLevel(parseTypst(next), positioned));
    const before = chunksOf(tree);
    const after = chunksOf(reparsed);
    const reused = [...after].filter((chunk) => before.has(chunk)).length;
    expect(after.size).toBeGreaterThan(50);
    expect(reused).toBeGreaterThanOrEqual(after.size - 3);
  });

  it("re-parses structure that an edit changes far from the edit", () => {
    const text = "#let a = 1\n\n= Heading\n\nSome *text*.\n\n#f(x)\n";
    const opened = edit(text, 0, 0, "#[");
    expect(topLevel(opened.reparsed, shape)).toBe(topLevel(parseTypst(opened.next), shape));
    expect(errorsIn(opened.reparsed)).toBe(1);
    const fenced = edit(text, 0, 0, "```\n");
    expect(topLevel(fenced.reparsed, shape)).toBe("⚠");
  });

  it("resumes a stopped parse into the same tree as a full parse", () => {
    const parse = typstParser.startParse(document);
    parse.stopAt(Math.floor(document.length / 3));
    let partial: Tree | null = null;
    while (!(partial = parse.advance()));
    expect(partial.length).toBeLessThan(document.length);
    const resumed = typstParser.parse(document, TreeFragment.addTree(partial, [], true));
    expect(topLevel(resumed, positioned)).toBe(topLevel(parseTypst(document), positioned));
  });

  it("matches a full parse after a sequence of structural edits", () => {
    const inserts = ["[", "]", "#{", "}", "`", "```", '"', "/*", "*/", "\n- ", "*", "$", "\n= "];
    let text = document.slice(0, 20_000);
    let tree = parseTypst(text);
    let seed = 7;
    for (let step = 0; step < 80; step += 1) {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      const from = seed % (text.length + 1);
      const insert = inserts[step % inserts.length];
      const next = text.slice(0, from) + insert + text.slice(from);
      const fragments = TreeFragment.applyChanges(TreeFragment.addTree(tree), [
        { fromA: from, toA: from, fromB: from, toB: from + insert.length },
      ]);
      tree = typstParser.parse(next, fragments);
      expect(topLevel(tree, positioned)).toBe(topLevel(parseTypst(next), positioned));
      text = next;
    }
  });
});

describe("Typst parsing stays linear", () => {
  const LARGE = 100_000;

  it.each([
    ["deep parentheses", `#${"(".repeat(LARGE)}`],
    ["balanced parentheses", `#${"(".repeat(LARGE)}${")".repeat(LARGE)}`],
    ["markup brackets", "[".repeat(LARGE)],
    ["nested content blocks", "#f[".repeat(LARGE / 3)],
    ["nested code blocks", `#${"{".repeat(LARGE)}`],
    ["alternating strong and emphasis", "*_".repeat(LARGE / 2)],
    ["unclosed strong on every line", "*a\n".repeat(LARGE / 3)],
    ["closures that force backtracking", `#${"(x: ".repeat(LARGE / 6)}(x) => y${") => y".repeat(LARGE / 6)}`],
    ["destructuring that forces backtracking", `#let ${"((a, ".repeat(LARGE / 6)}b${"))".repeat(LARGE / 6)} = 1`],
    ["a very long prose line", "word ".repeat(LARGE / 5)],
    ["a very long fraction chain", `$${"a^b_c/".repeat(LARGE / 6)}$`],
    ["an unclosed string", `#"${"x".repeat(LARGE)}`],
    ["an unclosed raw fence", `\`\`\`${"x\n".repeat(LARGE / 2)}`],
    ["nested comment openers", "/*".repeat(LARGE / 2)],
    ["label openers", "<a".repeat(LARGE / 2)],
    ["references ending in dots", `@a${".".repeat(50)} `.repeat(LARGE / 53)],
    ["a link full of parentheses", `https://x.y/${"(".repeat(LARGE)}`],
    ["math parentheses", `$${"(".repeat(LARGE)}$`],
    ["a binary chain", `#{${"1 + ".repeat(LARGE / 4)}1}`],
    ["a call chain", `#f${"()".repeat(LARGE / 2)}`],
    ["many named arguments", `#f(${Array.from({ length: LARGE / 8 }, (_, index) => `a${index}: 1`).join(", ")})`],
  ])("on %s", (_name, source) => {
    const started = performance.now();
    const tree = parseTypst(source);
    expect(tree).toHaveLength(source.length);
    let depth = 0;
    let deepest = 0;
    tree.iterate({
      enter() {
        depth += 1;
        deepest = Math.max(deepest, depth);
      },
      leave() {
        depth -= 1;
      },
    });
    expect(deepest).toBeLessThan(520);
    expect(performance.now() - started).toBeLessThan(2_000);
  });
});

describe("Typst outline titles", () => {
  it.each([
    ["Results *with* _emphasis_ and `code`", "Results with emphasis and code"],
    ["Price \\$5 -- cheap ~ fast...", "Price $5 \u2013 cheap fast\u2026"],
    ["#emph[Deep] learning #text(fill: red)[now]", "Deep learning now"],
    ['#link("https://typst.app")[Typst] and #"strings"', "Typst and strings"],
    ["Energy $E = m c^2$ // note", "Energy E = m c^2"],
    ["1. Not a list - and not + markers", "1. Not a list - and not + markers"],
    ["Escaped \\u{1F600} and \\#hash", "Escaped \u{1F600} and #hash"],
  ])("renders %j without markup", (source, expected) => {
    expect(typstPlainTitle(source)).toBe(expected);
  });
});
