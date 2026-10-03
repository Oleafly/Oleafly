import { type TypstMinor, typstVersionSupports } from "./typst-version";

export type TypstInsertContext = "markup" | "math" | "code" | "string" | "raw" | "comment";

export type TypstSymbolSpec =
  | {
      readonly kind: "sym";
      readonly name: string;
      readonly math?: string;
      readonly markup?: string;
      readonly since?: TypstMinor;
      readonly legacy?: string;
      readonly glyph?: string;
    }
  | { readonly kind: "math"; readonly math: string; readonly from: number; readonly to: number }
  | { readonly kind: "text"; readonly math: string; readonly markup: string };

export interface TypstSymbolText {
  readonly text: string;
  readonly from: number;
  readonly to: number;
  readonly identifier: boolean;
}

const sym = (
  name: string,
  options: Omit<Extract<TypstSymbolSpec, { kind: "sym" }>, "kind" | "name"> = {},
): TypstSymbolSpec => ({ kind: "sym", name, ...options });

const op = (math: string): TypstSymbolSpec => ({ kind: "math", math, from: math.length, to: math.length });

const call = (math: string, placeholder: string): TypstSymbolSpec => {
  const from = math.indexOf(placeholder, math.indexOf("(") + 1);
  return { kind: "math", math, from, to: from + placeholder.length };
};

const text = (math: string, markup: string): TypstSymbolSpec => ({ kind: "text", math, markup });

const GREEK_LOWER = [
  "alpha", "beta", "gamma", "delta", "zeta", "eta", "theta", "iota", "kappa", "lambda",
  "mu", "nu", "xi", "pi", "rho", "sigma", "tau", "upsilon", "chi", "psi", "omega",
] as const;

const GREEK_UPPER = [
  "Gamma", "Delta", "Theta", "Lambda", "Xi", "Pi", "Sigma", "Upsilon", "Phi", "Psi", "Omega",
] as const;

const OPERATOR_NAMES = [
  "lim", "sup", "inf", "max", "min", "sin", "cos", "tan", "cot", "sec", "csc", "arcsin",
  "arccos", "arctan", "sinh", "cosh", "tanh", "log", "ln", "exp", "det", "dim", "ker", "arg",
] as const;

const ENTRIES: ReadonlyArray<readonly [string, TypstSymbolSpec]> = [
  ...GREEK_LOWER.map((name) => [`\\${name}`, sym(name)] as const),
  ...GREEK_UPPER.map((name) => [`\\${name}`, sym(name)] as const),
  ["\\epsilon", sym("epsilon.alt")],
  ["\\varepsilon", sym("epsilon")],
  ["\\vartheta", sym("theta.alt")],
  ["\\varpi", sym("pi.alt")],
  ["\\varrho", sym("rho.alt")],
  ["\\varsigma", sym("sigma.alt")],
  ["\\phi", sym("phi.alt")],
  ["\\varphi", sym("phi")],
  ["+", sym("plus", { math: "+" })],
  ["-", sym("minus", { math: "-" })],
  ["\\times", sym("times")],
  ["\\div", sym("div")],
  ["\\cdot", sym("dot.op")],
  ["\\pm", sym("plus.minus")],
  ["\\mp", sym("minus.plus")],
  ["\\ast", sym("ast.op")],
  ["\\star", sym("star.op")],
  ["\\circ", sym("compose")],
  ["\\bullet", sym("bullet")],
  ["\\oplus", sym("plus.o", { since: [0, 14], legacy: "plus.circle" })],
  ["\\ominus", sym("minus.o", { since: [0, 14], legacy: "minus.circle" })],
  ["\\otimes", sym("times.o", { since: [0, 14], legacy: "times.circle" })],
  ["\\odot", sym("dot.o", { since: [0, 14], legacy: "dot.circle" })],
  ["\\dagger", sym("dagger")],
  ["\\ddagger", sym("dagger.double")],
  ["\\nabla", sym("nabla")],
  ["\\partial", sym("partial")],
  ["=", sym("eq", { math: "=" })],
  ["\\neq", sym("eq.not")],
  ["<", sym("lt", { math: "<" })],
  [">", sym("gt", { math: ">" })],
  ["\\leq", sym("lt.eq")],
  ["\\geq", sym("gt.eq")],
  ["\\ll", sym("lt.double")],
  ["\\gg", sym("gt.double")],
  ["\\approx", sym("approx")],
  ["\\sim", sym("tilde.op")],
  ["\\simeq", sym("tilde.eq")],
  ["\\cong", sym("tilde.equiv")],
  ["\\equiv", sym("equiv")],
  ["\\propto", sym("prop")],
  ["\\prec", sym("prec")],
  ["\\succ", sym("succ")],
  ["\\preceq", sym("prec.eq")],
  ["\\succeq", sym("succ.eq")],
  ["\\perp", sym("perp")],
  ["\\parallel", sym("parallel")],
  ["\\mid", sym("divides")],
  ["\\leftarrow", sym("arrow.l")],
  ["\\rightarrow", sym("arrow.r")],
  ["\\uparrow", sym("arrow.t")],
  ["\\downarrow", sym("arrow.b")],
  ["\\leftrightarrow", sym("arrow.l.r")],
  ["\\Leftarrow", sym("arrow.l.double")],
  ["\\Rightarrow", sym("arrow.r.double")],
  ["\\Uparrow", sym("arrow.t.double")],
  ["\\Downarrow", sym("arrow.b.double")],
  ["\\Leftrightarrow", sym("arrow.l.r.double")],
  ["\\mapsto", sym("arrow.r.bar")],
  ["\\longmapsto", sym("arrow.r.long.bar")],
  ["\\longrightarrow", sym("arrow.r.long")],
  ["\\longleftarrow", sym("arrow.l.long")],
  ["\\hookrightarrow", sym("arrow.r.hook")],
  ["\\hookleftarrow", sym("arrow.l.hook")],
  ["\\nearrow", sym("arrow.tr")],
  ["\\searrow", sym("arrow.br")],
  ["\\nwarrow", sym("arrow.tl")],
  ["\\swarrow", sym("arrow.bl")],
  ["\\rightleftharpoons", sym("harpoons.rtlb")],
  ["\\leftharpoonup", sym("harpoon.lt")],
  ["\\rightharpoonup", sym("harpoon.rt")],
  ["\\in", sym("in")],
  ["\\notin", sym("in.not")],
  ["\\ni", sym("in.rev")],
  ["\\subset", sym("subset")],
  ["\\supset", sym("supset")],
  ["\\subseteq", sym("subset.eq")],
  ["\\supseteq", sym("supset.eq")],
  ["\\cup", sym("union")],
  ["\\cap", sym("inter", { since: [0, 13], legacy: "sect" })],
  ["\\bigcup", sym("union.big")],
  ["\\bigcap", sym("inter.big", { since: [0, 13], legacy: "sect.big" })],
  ["\\setminus", sym("without")],
  ["\\emptyset", sym("emptyset")],
  ["\\varnothing", sym("emptyset")],
  ["\\mathbb{N}", sym("NN")],
  ["\\mathbb{Z}", sym("ZZ")],
  ["\\mathbb{Q}", sym("QQ")],
  ["\\mathbb{R}", sym("RR")],
  ["\\mathbb{C}", sym("CC")],
  ["\\forall", sym("forall")],
  ["\\exists", sym("exists")],
  ["\\nexists", sym("exists.not")],
  ["\\neg", sym("not")],
  ["\\land", sym("and")],
  ["\\lor", sym("or")],
  ["\\wedge", sym("and")],
  ["\\vee", sym("or")],
  ["\\implies", sym("arrow.r.double.long")],
  ["\\iff", sym("arrow.l.r.double.long")],
  ["\\therefore", sym("therefore")],
  ["\\because", sym("because")],
  ["\\top", sym("top")],
  ["\\bot", sym("bot")],
  ["\\vdash", sym("tack.r")],
  ["\\models", sym("models")],
  ["\\int", sym("integral")],
  ["\\iint", sym("integral.double")],
  ["\\iiint", sym("integral.triple")],
  ["\\oint", sym("integral.cont")],
  ["\\sum", sym("sum")],
  ["\\prod", sym("product")],
  ["\\coprod", sym("product.co")],
  ["\\infty", sym("infinity")],
  ...OPERATOR_NAMES.map((name) => [`\\${name}`, op(name)] as const),
  ["\\sqrt{}", call("sqrt(x)", "x")],
  ["\\frac{}{}", call("frac(a, b)", "a")],
  ["\\binom{}{}", call("binom(n, k)", "n")],
  ["(", sym("paren.l", { math: "(" })],
  [")", sym("paren.r", { math: ")" })],
  ["[", sym("bracket.l", { math: "[" })],
  ["]", sym("bracket.r", { math: "]" })],
  ["\\{", sym("brace.l", { math: "{" })],
  ["\\}", sym("brace.r", { math: "}" })],
  ["\\langle", sym("chevron.l", { since: [0, 14], legacy: "angle.l" })],
  ["\\rangle", sym("chevron.r", { since: [0, 14], legacy: "angle.r" })],
  ["\\lfloor", sym("floor.l", { since: [0, 12], glyph: "⌊" })],
  ["\\rfloor", sym("floor.r", { since: [0, 12], glyph: "⌋" })],
  ["\\lceil", sym("ceil.l", { since: [0, 12], glyph: "⌈" })],
  ["\\rceil", sym("ceil.r", { since: [0, 12], glyph: "⌉" })],
  ["|", sym("bar.v", { math: "|" })],
  ["\\|", sym("bar.v.double")],
  ["\\left( \\right)", call("lr(( x ))", "x")],
  ["\\left[ \\right]", call("lr([ x ])", "x")],
  ["\\hat{}", call("hat(x)", "x")],
  ["\\bar{}", call("macron(x)", "x")],
  ["\\tilde{}", call("tilde(x)", "x")],
  ["\\vec{}", call("arrow(x)", "x")],
  ["\\dot{}", call("dot(x)", "x")],
  ["\\ddot{}", call("dot.double(x)", "x")],
  ["\\acute{}", call("acute(x)", "x")],
  ["\\grave{}", call("grave(x)", "x")],
  ["\\breve{}", call("breve(x)", "x")],
  ["\\check{}", call("caron(x)", "x")],
  ["\\overline{}", call("overline(x)", "x")],
  ["\\underline{}", call("underline(x)", "x")],
  ["\\overbrace{}", call("overbrace(x)", "x")],
  ["\\underbrace{}", call("underbrace(x)", "x")],
  ["\\cdots", sym("dots.h.c")],
  ["\\ldots", sym("dots.h")],
  ["\\vdots", sym("dots.v")],
  ["\\ddots", sym("dots.down")],
  ["\\quad", text("quad", "#h(1em)")],
  ["\\qquad", text("wide", "#h(2em)")],
  ["\\,", text("thin", "#h(1em / 6)")],
  ["\\;", text("thick", "#h(5em / 18)")],
  ["\\!", text("#h(-1em / 6)", "#h(-1em / 6)")],
  ["\\text{}", call('"text"', "text")],
  ["\\mathrm{}", call("upright(x)", "x")],
  ["\\mathbf{}", call("bold(x)", "x")],
  ["\\mathcal{}", call("cal(A)", "A")],
  ["\\hbar", sym("planck", { since: [0, 14], legacy: "planck.reduce" })],
  ["\\ell", sym("ell")],
  ["\\wp", text("℘", "℘")],
  ["\\Re", sym("Re")],
  ["\\Im", sym("Im")],
  ["\\aleph", sym("aleph")],
  ["\\angle", sym("angle")],
  ["\\triangle", sym("triangle.stroked.t")],
  ["\\diamond", sym("diamond.stroked.small")],
  ["\\square", sym("square.stroked")],
  ["\\lozenge", sym("lozenge.stroked")],
  ["\\clubsuit", sym("suit.club")],
  ["\\diamondsuit", sym("suit.diamond.stroked", { since: [0, 12], glyph: "♢" })],
  ["\\heartsuit", sym("suit.heart.stroked", { since: [0, 12], glyph: "♡" })],
  ["\\spadesuit", sym("suit.spade")],
  ["^{\\circ}", sym("degree")],
  ["\\#", sym("hash", { markup: "\\#" })],
  ["\\$", sym("dollar", { markup: "\\$" })],
  ["\\%", sym("percent", { markup: "%" })],
  ["\\&", sym("amp", { markup: "&" })],
];

const ALIASES: ReadonlyArray<readonly [string, string]> = [
  ["\\to", "\\rightarrow"],
  ["\\gets", "\\leftarrow"],
  ["\\ne", "\\neq"],
  ["\\le", "\\leq"],
  ["\\ge", "\\geq"],
  ["\\lnot", "\\neg"],
  ["\\owns", "\\ni"],
  ["\\lbrace", "\\{"],
  ["\\rbrace", "\\}"],
  ["\\Vert", "\\|"],
  ["\\vert", "|"],
  ["\\dots", "\\ldots"],
  ["\\colon", ":"],
];

export const TYPST_SYMBOLS: ReadonlyMap<string, TypstSymbolSpec> = (() => {
  const map = new Map<string, TypstSymbolSpec>(ENTRIES);
  map.set(":", text(":", ":"));
  for (const [alias, target] of ALIASES) {
    const spec = map.get(target);
    if (spec && !map.has(alias)) map.set(alias, spec);
  }
  return map;
})();

export function typstSymbolName(spec: TypstSymbolSpec, version: string | null | undefined): string | null {
  if (spec.kind !== "sym") return null;
  if (!spec.since || typstVersionSupports(version, spec.since)) return spec.name;
  return spec.legacy ?? null;
}

function literalMarkup(glyph: string): string {
  return /^[\\#$*_`<>@=+\-/[\]~"']$/u.test(glyph) ? `\\${glyph}` : glyph;
}

function plain(value: string, identifier = false): TypstSymbolText {
  return { text: value, from: value.length, to: value.length, identifier };
}

function symText(
  spec: Extract<TypstSymbolSpec, { kind: "sym" }>,
  context: TypstInsertContext,
  version: string | null | undefined,
  glyph: string | undefined,
): TypstSymbolText {
  const name = typstSymbolName(spec, version);
  if (name === null) {
    const literal = spec.glyph ?? glyph ?? "";
    return plain(context === "markup" ? literalMarkup(literal) : literal);
  }
  const versioned = name !== spec.name;
  if (context === "math") {
    const value = !versioned && spec.math ? spec.math : name;
    return plain(value, /^\p{ID_Start}/u.test(value));
  }
  if (context === "code") return plain(`sym.${name}`, true);
  if (context === "markup") {
    const value = !versioned && spec.markup ? spec.markup : `#sym.${name}`;
    return plain(value, value.startsWith("#"));
  }
  return plain(glyph ?? spec.glyph ?? spec.math ?? name);
}

export function typstSymbolText(
  spec: TypstSymbolSpec,
  context: TypstInsertContext,
  version: string | null | undefined,
  glyph?: string,
): TypstSymbolText {
  if (spec.kind === "sym") return symText(spec, context, version, glyph);
  const from = spec.kind === "math" ? spec.from : spec.math.length;
  const to = spec.kind === "math" ? spec.to : spec.math.length;
  if (context === "math") {
    return { text: spec.math, from, to, identifier: /^\p{ID_Start}/u.test(spec.math) };
  }
  if (context === "markup" && spec.kind === "text") {
    return plain(spec.markup, spec.markup.startsWith("#"));
  }
  if (context === "code" && spec.kind === "text") {
    return plain(`$${spec.math}$`);
  }
  if (context === "markup" || context === "code") {
    return { text: `$${spec.math}$`, from: from + 1, to: to + 1, identifier: false };
  }
  return glyph === undefined ? { text: spec.math, from, to, identifier: false } : plain(glyph);
}

export function typstSymbolForLatex(latex: string): TypstSymbolSpec | null {
  return TYPST_SYMBOLS.get(latex) ?? null;
}

export function typstSymbolLabel(latex: string, version: string | null | undefined): string | null {
  const spec = typstSymbolForLatex(latex);
  if (!spec) return null;
  if (spec.kind === "sym") return typstSymbolName(spec, version) ?? spec.glyph ?? null;
  return spec.math;
}

export function typstGlyphSpec(glyph: string): TypstSymbolSpec {
  return text(glyph, literalMarkup(glyph));
}

export interface TypstSymbolInsertion {
  readonly insert: string;
  readonly from: number;
  readonly to: number;
}

const IDENTIFIER_BEFORE = /(?!_)\p{ID_Continue}$/u;
const MATH_IDENTIFIER_AFTER = /^[\p{ID_Continue}.(]/u;
const MARKUP_EXPRESSION_AFTER = /^[\p{L}\p{N}_\-.([]/u;

export function typstSymbolInsertion(
  spec: TypstSymbolSpec,
  context: TypstInsertContext,
  version: string | null | undefined,
  before: string,
  after: string,
  glyph?: string,
): TypstSymbolInsertion {
  const value = typstSymbolText(spec, context, version, glyph);
  if (!value.identifier) return { insert: value.text, from: value.from, to: value.to };
  const atEnd = value.from === value.text.length;
  if (context === "math" || context === "code") {
    const lead = IDENTIFIER_BEFORE.test(before) ? " " : "";
    const trail = atEnd && MATH_IDENTIFIER_AFTER.test(after) ? " " : "";
    const insert = `${lead}${value.text}${trail}`;
    if (atEnd) return { insert, from: insert.length, to: insert.length };
    return { insert, from: lead.length + value.from, to: lead.length + value.to };
  }
  const trail = MARKUP_EXPRESSION_AFTER.test(after) ? ";" : "";
  const insert = `${value.text}${trail}`;
  return atEnd ? { insert, from: insert.length, to: insert.length } : { insert, from: value.from, to: value.to };
}
