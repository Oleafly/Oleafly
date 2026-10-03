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
  [String.raw`\epsilon`, sym("epsilon.alt")],
  [String.raw`\varepsilon`, sym("epsilon")],
  [String.raw`\vartheta`, sym("theta.alt")],
  [String.raw`\varpi`, sym("pi.alt")],
  [String.raw`\varrho`, sym("rho.alt")],
  [String.raw`\varsigma`, sym("sigma.alt")],
  [String.raw`\phi`, sym("phi.alt")],
  [String.raw`\varphi`, sym("phi")],
  ["+", sym("plus", { math: "+" })],
  ["-", sym("minus", { math: "-" })],
  [String.raw`\times`, sym("times")],
  [String.raw`\div`, sym("div")],
  [String.raw`\cdot`, sym("dot.op")],
  [String.raw`\pm`, sym("plus.minus")],
  [String.raw`\mp`, sym("minus.plus")],
  [String.raw`\ast`, sym("ast.op")],
  [String.raw`\star`, sym("star.op")],
  [String.raw`\circ`, sym("compose")],
  [String.raw`\bullet`, sym("bullet")],
  [String.raw`\oplus`, sym("plus.o", { since: [0, 14], legacy: "plus.circle" })],
  [String.raw`\ominus`, sym("minus.o", { since: [0, 14], legacy: "minus.circle" })],
  [String.raw`\otimes`, sym("times.o", { since: [0, 14], legacy: "times.circle" })],
  [String.raw`\odot`, sym("dot.o", { since: [0, 14], legacy: "dot.circle" })],
  [String.raw`\dagger`, sym("dagger")],
  [String.raw`\ddagger`, sym("dagger.double")],
  [String.raw`\nabla`, sym("nabla")],
  [String.raw`\partial`, sym("partial")],
  ["=", sym("eq", { math: "=" })],
  [String.raw`\neq`, sym("eq.not")],
  ["<", sym("lt", { math: "<" })],
  [">", sym("gt", { math: ">" })],
  [String.raw`\leq`, sym("lt.eq")],
  [String.raw`\geq`, sym("gt.eq")],
  [String.raw`\ll`, sym("lt.double")],
  [String.raw`\gg`, sym("gt.double")],
  [String.raw`\approx`, sym("approx")],
  [String.raw`\sim`, sym("tilde.op")],
  [String.raw`\simeq`, sym("tilde.eq")],
  [String.raw`\cong`, sym("tilde.equiv")],
  [String.raw`\equiv`, sym("equiv")],
  [String.raw`\propto`, sym("prop")],
  [String.raw`\prec`, sym("prec")],
  [String.raw`\succ`, sym("succ")],
  [String.raw`\preceq`, sym("prec.eq")],
  [String.raw`\succeq`, sym("succ.eq")],
  [String.raw`\perp`, sym("perp")],
  [String.raw`\parallel`, sym("parallel")],
  [String.raw`\mid`, sym("divides")],
  [String.raw`\leftarrow`, sym("arrow.l")],
  [String.raw`\rightarrow`, sym("arrow.r")],
  [String.raw`\uparrow`, sym("arrow.t")],
  [String.raw`\downarrow`, sym("arrow.b")],
  [String.raw`\leftrightarrow`, sym("arrow.l.r")],
  [String.raw`\Leftarrow`, sym("arrow.l.double")],
  [String.raw`\Rightarrow`, sym("arrow.r.double")],
  [String.raw`\Uparrow`, sym("arrow.t.double")],
  [String.raw`\Downarrow`, sym("arrow.b.double")],
  [String.raw`\Leftrightarrow`, sym("arrow.l.r.double")],
  [String.raw`\mapsto`, sym("arrow.r.bar")],
  [String.raw`\longmapsto`, sym("arrow.r.long.bar")],
  [String.raw`\longrightarrow`, sym("arrow.r.long")],
  [String.raw`\longleftarrow`, sym("arrow.l.long")],
  [String.raw`\hookrightarrow`, sym("arrow.r.hook")],
  [String.raw`\hookleftarrow`, sym("arrow.l.hook")],
  [String.raw`\nearrow`, sym("arrow.tr")],
  [String.raw`\searrow`, sym("arrow.br")],
  [String.raw`\nwarrow`, sym("arrow.tl")],
  [String.raw`\swarrow`, sym("arrow.bl")],
  [String.raw`\rightleftharpoons`, sym("harpoons.rtlb")],
  [String.raw`\leftharpoonup`, sym("harpoon.lt")],
  [String.raw`\rightharpoonup`, sym("harpoon.rt")],
  [String.raw`\in`, sym("in")],
  [String.raw`\notin`, sym("in.not")],
  [String.raw`\ni`, sym("in.rev")],
  [String.raw`\subset`, sym("subset")],
  [String.raw`\supset`, sym("supset")],
  [String.raw`\subseteq`, sym("subset.eq")],
  [String.raw`\supseteq`, sym("supset.eq")],
  [String.raw`\cup`, sym("union")],
  [String.raw`\cap`, sym("inter", { since: [0, 13], legacy: "sect" })],
  [String.raw`\bigcup`, sym("union.big")],
  [String.raw`\bigcap`, sym("inter.big", { since: [0, 13], legacy: "sect.big" })],
  [String.raw`\setminus`, sym("without")],
  [String.raw`\emptyset`, sym("emptyset")],
  [String.raw`\varnothing`, sym("emptyset")],
  [String.raw`\mathbb{N}`, sym("NN")],
  [String.raw`\mathbb{Z}`, sym("ZZ")],
  [String.raw`\mathbb{Q}`, sym("QQ")],
  [String.raw`\mathbb{R}`, sym("RR")],
  [String.raw`\mathbb{C}`, sym("CC")],
  [String.raw`\forall`, sym("forall")],
  [String.raw`\exists`, sym("exists")],
  [String.raw`\nexists`, sym("exists.not")],
  [String.raw`\neg`, sym("not")],
  [String.raw`\land`, sym("and")],
  [String.raw`\lor`, sym("or")],
  [String.raw`\wedge`, sym("and")],
  [String.raw`\vee`, sym("or")],
  [String.raw`\implies`, sym("arrow.r.double.long")],
  [String.raw`\iff`, sym("arrow.l.r.double.long")],
  [String.raw`\therefore`, sym("therefore")],
  [String.raw`\because`, sym("because")],
  [String.raw`\top`, sym("top")],
  [String.raw`\bot`, sym("bot")],
  [String.raw`\vdash`, sym("tack.r")],
  [String.raw`\models`, sym("models")],
  [String.raw`\int`, sym("integral")],
  [String.raw`\iint`, sym("integral.double")],
  [String.raw`\iiint`, sym("integral.triple")],
  [String.raw`\oint`, sym("integral.cont")],
  [String.raw`\sum`, sym("sum")],
  [String.raw`\prod`, sym("product")],
  [String.raw`\coprod`, sym("product.co")],
  [String.raw`\infty`, sym("infinity")],
  ...OPERATOR_NAMES.map((name) => [`\\${name}`, op(name)] as const),
  [String.raw`\sqrt{}`, call("sqrt(x)", "x")],
  [String.raw`\frac{}{}`, call("frac(a, b)", "a")],
  [String.raw`\binom{}{}`, call("binom(n, k)", "n")],
  ["(", sym("paren.l", { math: "(" })],
  [")", sym("paren.r", { math: ")" })],
  ["[", sym("bracket.l", { math: "[" })],
  ["]", sym("bracket.r", { math: "]" })],
  [String.raw`\{`, sym("brace.l", { math: "{" })],
  [String.raw`\}`, sym("brace.r", { math: "}" })],
  [String.raw`\langle`, sym("chevron.l", { since: [0, 14], legacy: "angle.l" })],
  [String.raw`\rangle`, sym("chevron.r", { since: [0, 14], legacy: "angle.r" })],
  [String.raw`\lfloor`, sym("floor.l", { since: [0, 12], glyph: "⌊" })],
  [String.raw`\rfloor`, sym("floor.r", { since: [0, 12], glyph: "⌋" })],
  [String.raw`\lceil`, sym("ceil.l", { since: [0, 12], glyph: "⌈" })],
  [String.raw`\rceil`, sym("ceil.r", { since: [0, 12], glyph: "⌉" })],
  ["|", sym("bar.v", { math: "|" })],
  [String.raw`\|`, sym("bar.v.double")],
  [String.raw`\left( \right)`, call("lr(( x ))", "x")],
  [String.raw`\left[ \right]`, call("lr([ x ])", "x")],
  [String.raw`\hat{}`, call("hat(x)", "x")],
  [String.raw`\bar{}`, call("macron(x)", "x")],
  [String.raw`\tilde{}`, call("tilde(x)", "x")],
  [String.raw`\vec{}`, call("arrow(x)", "x")],
  [String.raw`\dot{}`, call("dot(x)", "x")],
  [String.raw`\ddot{}`, call("dot.double(x)", "x")],
  [String.raw`\acute{}`, call("acute(x)", "x")],
  [String.raw`\grave{}`, call("grave(x)", "x")],
  [String.raw`\breve{}`, call("breve(x)", "x")],
  [String.raw`\check{}`, call("caron(x)", "x")],
  [String.raw`\overline{}`, call("overline(x)", "x")],
  [String.raw`\underline{}`, call("underline(x)", "x")],
  [String.raw`\overbrace{}`, call("overbrace(x)", "x")],
  [String.raw`\underbrace{}`, call("underbrace(x)", "x")],
  [String.raw`\cdots`, sym("dots.h.c")],
  [String.raw`\ldots`, sym("dots.h")],
  [String.raw`\vdots`, sym("dots.v")],
  [String.raw`\ddots`, sym("dots.down")],
  [String.raw`\quad`, text("quad", "#h(1em)")],
  [String.raw`\qquad`, text("wide", "#h(2em)")],
  [String.raw`\,`, text("thin", "#h(1em / 6)")],
  [String.raw`\;`, text("thick", "#h(5em / 18)")],
  [String.raw`\!`, text("#h(-1em / 6)", "#h(-1em / 6)")],
  [String.raw`\text{}`, call('"text"', "text")],
  [String.raw`\mathrm{}`, call("upright(x)", "x")],
  [String.raw`\mathbf{}`, call("bold(x)", "x")],
  [String.raw`\mathcal{}`, call("cal(A)", "A")],
  [String.raw`\hbar`, sym("planck", { since: [0, 14], legacy: "planck.reduce" })],
  [String.raw`\ell`, sym("ell")],
  [String.raw`\wp`, text("℘", "℘")],
  [String.raw`\Re`, sym("Re")],
  [String.raw`\Im`, sym("Im")],
  [String.raw`\aleph`, sym("aleph")],
  [String.raw`\angle`, sym("angle")],
  [String.raw`\triangle`, sym("triangle.stroked.t")],
  [String.raw`\diamond`, sym("diamond.stroked.small")],
  [String.raw`\square`, sym("square.stroked")],
  [String.raw`\lozenge`, sym("lozenge.stroked")],
  [String.raw`\clubsuit`, sym("suit.club")],
  [String.raw`\diamondsuit`, sym("suit.diamond.stroked", { since: [0, 12], glyph: "♢" })],
  [String.raw`\heartsuit`, sym("suit.heart.stroked", { since: [0, 12], glyph: "♡" })],
  [String.raw`\spadesuit`, sym("suit.spade")],
  [String.raw`^{\circ}`, sym("degree")],
  [String.raw`\#`, sym("hash", { markup: String.raw`\#` })],
  [String.raw`\$`, sym("dollar", { markup: String.raw`\$` })],
  [String.raw`\%`, sym("percent", { markup: "%" })],
  [String.raw`\&`, sym("amp", { markup: "&" })],
];

const ALIASES: ReadonlyArray<readonly [string, string]> = [
  [String.raw`\to`, String.raw`\rightarrow`],
  [String.raw`\gets`, String.raw`\leftarrow`],
  [String.raw`\ne`, String.raw`\neq`],
  [String.raw`\le`, String.raw`\leq`],
  [String.raw`\ge`, String.raw`\geq`],
  [String.raw`\lnot`, String.raw`\neg`],
  [String.raw`\owns`, String.raw`\ni`],
  [String.raw`\lbrace`, String.raw`\{`],
  [String.raw`\rbrace`, String.raw`\}`],
  [String.raw`\Vert`, String.raw`\|`],
  [String.raw`\vert`, "|"],
  [String.raw`\dots`, String.raw`\ldots`],
  [String.raw`\colon`, ":"],
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
