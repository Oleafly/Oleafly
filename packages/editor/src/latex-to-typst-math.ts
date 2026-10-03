export interface LatexToTypstOptions {
  typstVersion?: string | null;
}

export interface LatexToTypstResult {
  typst: string;
  unsupported: string[];
}

export interface LatexMathSpan {
  from: number;
  to: number;
  body: string;
  display: boolean;
}

type AtomKind = "word" | "open" | "close" | "fence" | "sep" | "op" | "break" | "align" | "group";

interface Atom {
  code: string;
  kind: AtomKind;
  space: boolean;
  simple: boolean;
  forceSpace?: boolean;
  children?: Atom[];
}

const GREEK: Record<string, string> = {
  alpha: "alpha",
  beta: "beta",
  gamma: "gamma",
  delta: "delta",
  epsilon: "epsilon.alt",
  varepsilon: "epsilon",
  zeta: "zeta",
  eta: "eta",
  theta: "theta",
  vartheta: "theta.alt",
  iota: "iota",
  kappa: "kappa",
  varkappa: "kappa.alt",
  lambda: "lambda",
  mu: "mu",
  nu: "nu",
  xi: "xi",
  omicron: "omicron",
  pi: "pi",
  varpi: "pi.alt",
  rho: "rho",
  varrho: "rho.alt",
  sigma: "sigma",
  varsigma: "sigma.alt",
  tau: "tau",
  upsilon: "upsilon",
  phi: "phi.alt",
  varphi: "phi",
  chi: "chi",
  psi: "psi",
  omega: "omega",
  digamma: "digamma",
  Gamma: "Gamma",
  Delta: "Delta",
  Theta: "Theta",
  Lambda: "Lambda",
  Xi: "Xi",
  Pi: "Pi",
  Sigma: "Sigma",
  Upsilon: "Upsilon",
  Phi: "Phi",
  Psi: "Psi",
  Omega: "Omega",
  varGamma: "Gamma",
  varDelta: "Delta",
  varTheta: "Theta",
  varLambda: "Lambda",
  varXi: "Xi",
  varPi: "Pi",
  varSigma: "Sigma",
  varUpsilon: "Upsilon",
  varPhi: "Phi",
  varPsi: "Psi",
  varOmega: "Omega",
};

const OPERATORS = new Set([
  "arccos",
  "arcsin",
  "arctan",
  "arg",
  "cos",
  "cosh",
  "cot",
  "coth",
  "csc",
  "deg",
  "det",
  "dim",
  "exp",
  "gcd",
  "hom",
  "inf",
  "ker",
  "lg",
  "lim",
  "liminf",
  "limsup",
  "ln",
  "log",
  "max",
  "min",
  "Pr",
  "sec",
  "sin",
  "sinh",
  "sup",
  "tan",
  "tanh",
]);

const OPERATOR_ALIASES: Record<string, string> = {
  varlimsup: "limsup",
  varliminf: "liminf",
  injlim: "lim",
  projlim: "lim",
  bmod: "mod",
};

const SYMBOLS: Record<string, string> = {
  leq: "<=",
  le: "<=",
  geq: ">=",
  ge: ">=",
  neq: "!=",
  ne: "!=",
  leqslant: "lt.eq.slant",
  geqslant: "gt.eq.slant",
  nleq: "lt.eq.not",
  ngeq: "gt.eq.not",
  lesssim: "lt.tilde",
  gtrsim: "gt.tilde",
  ll: "<<",
  gg: ">>",
  lll: "<<<",
  ggg: ">>>",
  approx: "approx",
  approxeq: "approx.eq",
  sim: "tilde.op",
  nsim: "tilde.not",
  simeq: "tilde.eq",
  cong: "tilde.equiv",
  equiv: "equiv",
  propto: "prop",
  doteq: "eq.dot",
  triangleq: "eq.delta",
  coloneqq: ":=",
  coloneq: ":=",
  eqqcolon: "=:",
  prec: "prec",
  succ: "succ",
  preceq: "prec.eq",
  succeq: "succ.eq",
  asymp: "≍",
  bowtie: "⋈",
  smile: "smile",
  frown: "frown",
  in: "in",
  ni: "in.rev",
  notin: "in.not",
  subset: "subset",
  supset: "supset",
  subseteq: "subset.eq",
  supseteq: "supset.eq",
  subsetneq: "subset.neq",
  supsetneq: "supset.neq",
  nsubseteq: "subset.eq.not",
  sqsubset: "⊏",
  sqsupset: "⊐",
  sqsubseteq: "subset.eq.sq",
  sqsupseteq: "supset.eq.sq",
  cup: "union",
  cap: "∩",
  sqcup: "union.sq",
  sqcap: "⊓",
  uplus: "union.plus",
  setminus: "without",
  smallsetminus: "without",
  emptyset: "emptyset",
  varnothing: "nothing",
  pm: "plus.minus",
  mp: "minus.plus",
  times: "times",
  div: "div",
  cdot: "dot.op",
  cdotp: "dot.c",
  ast: "ast",
  star: "star",
  circ: "circle.small",
  bullet: "bullet",
  oplus: "⊕",
  ominus: "⊖",
  otimes: "⊗",
  oslash: "⊘",
  odot: "⊙",
  bigcirc: "◯",
  wedge: "and",
  land: "and",
  vee: "or",
  lor: "or",
  neg: "not",
  lnot: "not",
  wr: "wreath",
  amalg: "⨿",
  dagger: "dagger",
  dag: "dagger",
  ddagger: "dagger.double",
  ddag: "dagger.double",
  diamond: "diamond.small",
  Diamond: "diamond.stroked",
  lhd: "⊲",
  rhd: "⊳",
  unlhd: "⊴",
  unrhd: "⊵",
  triangleleft: "◁",
  triangleright: "▷",
  cdots: "dots.c",
  ldots: "dots.h",
  dots: "dots.h",
  dotsc: "dots.h",
  dotso: "dots.h",
  dotsb: "dots.c",
  dotsm: "dots.c",
  dotsi: "dots.c",
  vdots: "dots.v",
  ddots: "dots.down",
  iddots: "dots.up",
  adots: "dots.up",
  infty: "infinity",
  partial: "partial",
  nabla: "nabla",
  forall: "forall",
  exists: "exists",
  nexists: "exists.not",
  to: "->",
  rightarrow: "->",
  leftarrow: "<-",
  gets: "<-",
  leftrightarrow: "<->",
  Rightarrow: "=>",
  Leftarrow: "arrow.l.double",
  Leftrightarrow: "<=>",
  iff: "<==>",
  implies: "==>",
  impliedby: "<==",
  longrightarrow: "-->",
  longleftarrow: "<--",
  longleftrightarrow: "<-->",
  Longrightarrow: "==>",
  Longleftarrow: "<==",
  Longleftrightarrow: "<==>",
  mapsto: "|->",
  longmapsto: "arrow.r.long.bar",
  uparrow: "arrow.t",
  downarrow: "arrow.b",
  updownarrow: "arrow.t.b",
  Uparrow: "arrow.t.double",
  Downarrow: "arrow.b.double",
  Updownarrow: "arrow.t.b.double",
  nearrow: "arrow.tr",
  searrow: "arrow.br",
  swarrow: "arrow.bl",
  nwarrow: "arrow.tl",
  hookrightarrow: "arrow.r.hook",
  hookleftarrow: "arrow.l.hook",
  rightharpoonup: "harpoon.rt",
  leftharpoonup: "harpoon.lt",
  rightleftharpoons: "harpoons.rtlb",
  twoheadrightarrow: "arrow.r.twohead",
  rightsquigarrow: "arrow.r.squiggly",
  leadsto: "arrow.r.squiggly",
  perp: "perp",
  parallel: "parallel",
  nparallel: "parallel.not",
  mid: "divides",
  nmid: "divides.not",
  prime: "prime",
  backprime: "prime.rev",
  ell: "ell",
  hbar: "ℏ",
  hslash: "ℏ",
  imath: "dotless.i",
  jmath: "dotless.j",
  Re: "Re",
  Im: "Im",
  aleph: "aleph",
  beth: "beth",
  gimel: "gimel",
  daleth: "daleth",
  wp: "℘",
  eth: "ð",
  mho: "℧",
  angle: "angle",
  measuredangle: "angle.arc",
  degree: "degree",
  surd: "√",
  sum: "sum",
  prod: "product",
  coprod: "product.co",
  int: "integral",
  iint: "integral.double",
  iiint: "integral.triple",
  iiiint: "integral.quad",
  oint: "integral.cont",
  oiint: "integral.surf",
  bigcup: "union.big",
  bigcap: "⋂",
  bigsqcup: "union.sq.big",
  bigvee: "or.big",
  bigwedge: "and.big",
  bigoplus: "⨁",
  bigotimes: "⨂",
  bigodot: "⨀",
  biguplus: "union.plus.big",
  vdash: "tack.r",
  dashv: "tack.l",
  models: "⊨",
  vDash: "⊨",
  top: "top",
  bot: "bot",
  triangle: "triangle.stroked.t",
  square: "square.stroked",
  Box: "square.stroked",
  blacksquare: "square.filled",
  checkmark: "checkmark",
  S: "section",
  P: "pilcrow",
  copyright: "copyright",
  pounds: "pound",
  colon: "colon",
  clubsuit: "suit.club",
  diamondsuit: "suit.diamond",
  heartsuit: "suit.heart",
  spadesuit: "suit.spade",
  flat: "flat",
  natural: "natural",
  sharp: "sharp",
  complement: "complement",
  backslash: "backslash",
  quad: "quad",
  qquad: "wide",
  enspace: "space.en",
  thinspace: "thin",
  medspace: "med",
  thickspace: "thick",
};

const SPACING = new Set(["thin", "med", "thick", "quad", "wide", "space.en", "space", "space.nobreak"]);

const NEGATIONS: Record<string, string> = {
  "=": "!=",
  "<": "lt.not",
  ">": "gt.not",
  in: "in.not",
  ni: "in.rev.not",
  subset: "subset.not",
  supset: "supset.not",
  subseteq: "subset.eq.not",
  equiv: "equiv.not",
  sim: "tilde.not",
  le: "lt.eq.not",
  leq: "lt.eq.not",
  ge: "gt.eq.not",
  geq: "gt.eq.not",
  mid: "divides.not",
  exists: "exists.not",
  parallel: "parallel.not",
};

const ACCENTS: Record<string, string> = {
  hat: "hat",
  widehat: "hat",
  check: "caron",
  widecheck: "caron",
  tilde: "tilde",
  widetilde: "tilde",
  acute: "acute",
  grave: "grave",
  dot: "dot",
  ddot: "dot.double",
  dddot: "dot.triple",
  ddddot: "dot.quad",
  breve: "breve",
  bar: "macron",
  vec: "arrow",
  overrightarrow: "arrow",
  overleftarrow: "arrow.l",
  overleftrightarrow: "arrow.l.r",
  mathring: "circle",
  overline: "overline",
  widebar: "overline",
  underline: "underline",
  overparen: "overparen",
  underparen: "underparen",
  overbracket: "overbracket",
  underbracket: "underbracket",
};

const FONTS: Record<string, string> = {
  mathbb: "bb",
  mathcal: "cal",
  mathfrak: "frak",
  mathscr: "scr",
  mathit: "italic",
  mathrm: "upright",
  mathsf: "sans",
  mathtt: "mono",
  boldsymbol: "bold",
  bm: "bold",
  pmb: "bold",
  mathbfit: "bold",
};

const TEXT_STYLES: Record<string, string | null> = {
  text: null,
  textrm: null,
  textnormal: null,
  textup: null,
  textmd: null,
  mbox: null,
  hbox: null,
  textsf: "sans",
  texttt: "mono",
  textit: "italic",
  textsl: "italic",
  emph: "italic",
  textbf: "bold",
};

const STYLE_SWITCHES: Record<string, string> = {
  displaystyle: "display",
  textstyle: "inline",
  scriptstyle: "script",
  scriptscriptstyle: "sscript",
};

const IGNORED = new Set([
  "label",
  "tag",
  "nonumber",
  "notag",
  "hline",
  "toprule",
  "midrule",
  "bottomrule",
  "cline",
  "mathstrut",
  "strut",
  "nolimits",
  "limits",
  "relax",
  "allowbreak",
  "nobreak",
  "negthinspace",
  "negmedspace",
  "negthickspace",
]);

const IGNORED_WITH_ARGUMENT = new Set(["label", "tag", "cline", "vspace"]);

const SIZED_DELIMITERS = new Set([
  "big",
  "Big",
  "bigg",
  "Bigg",
  "bigl",
  "Bigl",
  "biggl",
  "Biggl",
  "bigr",
  "Bigr",
  "biggr",
  "Biggr",
  "bigm",
  "Bigm",
  "biggm",
  "Biggm",
]);

const DELIMITER_COMMANDS: Record<string, { code: string; kind: AtomKind }> = {
  "{": { code: "{", kind: "open" },
  "}": { code: "}", kind: "close" },
  lbrace: { code: "{", kind: "open" },
  rbrace: { code: "}", kind: "close" },
  lbrack: { code: "[", kind: "open" },
  rbrack: { code: "]", kind: "close" },
  langle: { code: "⟨", kind: "open" },
  rangle: { code: "⟩", kind: "close" },
  lfloor: { code: "⌊", kind: "open" },
  rfloor: { code: "⌋", kind: "close" },
  lceil: { code: "⌈", kind: "open" },
  rceil: { code: "⌉", kind: "close" },
  lvert: { code: "|", kind: "open" },
  rvert: { code: "|", kind: "close" },
  lVert: { code: "‖", kind: "open" },
  rVert: { code: "‖", kind: "close" },
  vert: { code: "|", kind: "fence" },
  Vert: { code: "‖", kind: "fence" },
  "|": { code: "‖", kind: "fence" },
};

const MATRIX_DELIMITERS: Record<string, string> = {
  matrix: "#none",
  smallmatrix: "#none",
  array: "#none",
  pmatrix: "",
  psmallmatrix: "",
  bmatrix: `"["`,
  bsmallmatrix: `"["`,
  Bmatrix: `"{"`,
  Bsmallmatrix: `"{"`,
  vmatrix: `"|"`,
  vsmallmatrix: `"|"`,
  Vmatrix: `"‖"`,
  Vsmallmatrix: `"‖"`,
};

const CASES_ENVIRONMENTS = new Set(["cases", "dcases", "cases*", "dcases*", "numcases"]);
const REVERSED_CASES = new Set(["rcases", "drcases", "rcases*"]);
const ROW_ENVIRONMENTS = new Set([
  "aligned",
  "align",
  "align*",
  "alignat",
  "alignat*",
  "alignedat",
  "flalign",
  "flalign*",
  "split",
  "gather",
  "gather*",
  "gathered",
  "multline",
  "multline*",
  "eqnarray",
  "eqnarray*",
  "equation",
  "equation*",
  "displaymath",
  "math",
  "subequations",
]);
const ENVIRONMENTS_WITH_ARGUMENT = new Set(["alignat", "alignat*", "alignedat", "array", "subarray"]);

const TYPST_COLORS: Record<string, string> = {
  black: "black",
  gray: "gray",
  grey: "gray",
  darkgray: "gray",
  lightgray: "silver",
  silver: "silver",
  white: "white",
  navy: "navy",
  blue: "blue",
  cyan: "aqua",
  aqua: "aqua",
  teal: "teal",
  purple: "purple",
  violet: "purple",
  magenta: "fuchsia",
  fuchsia: "fuchsia",
  maroon: "maroon",
  red: "red",
  orange: "orange",
  yellow: "yellow",
  olive: "olive",
  green: "green",
  lime: "lime",
};

const SAFE_BEFORE_PAREN = new Set([
  ...Object.values(GREEK),
  ...OPERATORS,
  "mod",
  "infinity",
  "partial",
  "nabla",
  "ell",
  "Re",
  "Im",
]);

const OPENERS = new Set(["(", "[", "{", "⟨", "⌊", "⌈"]);
const CLOSERS = new Set([")", "]", "}", "⟩", "⌋", "⌉"]);
const ESCAPABLE_DELIMITERS = new Set(["(", ")", "[", "]", "{", "}"]);
const OPERATOR_CHARACTERS = "-<>=!:|~*+.";
const SIMPLE_OPERATORS = new Set(["+", "-", "*", "!", "=", "?", ":"]);
const WORD_CHARACTER = /[\p{L}\p{N}]/u;
const TRAILING_IDENTIFIER = /(?:^|[^\p{L}\p{N}.])([\p{L}][\p{L}\p{N}.]*)$/u;

function word(code: string, simple = true): Atom {
  return { code, kind: "word", space: false, simple };
}

function atomOf(code: string, kind: AtomKind): Atom {
  return { code, kind, space: false, simple: kind === "word" || (kind === "op" && SIMPLE_OPERATORS.has(code)) };
}

function lookup<T>(table: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.hasOwn(table, key) ? table[key] : undefined;
}

function isTypstVersionBefore(version: string | null | undefined, minor: number): boolean {
  const match = /^(\d+)\.(\d+)/u.exec(version ?? "");
  if (!match) return false;
  const major = Number(match[1]);
  return major === 0 && Number(match[2]) < minor;
}

function typstString(text: string): string {
  return `"${text.replace(/\\/gu, "\\\\").replace(/"/gu, String.raw`\"`)}"`;
}

function plainText(raw: string): string {
  return raw
    .replace(/\\textbackslash\b\s*/gu, "\\")
    .replace(/\\([%&_$#{}])/gu, "$1")
    .replace(/\\[,;:! ]/gu, " ")
    .replace(/~/gu, " ")
    .replace(/---/gu, "—")
    .replace(/--/gu, "–")
    .replace(/\\[A-Za-z]+\*?\s*/gu, "")
    .replace(/[{}]/gu, "");
}

function lastCharacter(code: string): string {
  return code.at(-1) ?? "";
}

function needsSpace(previous: Atom, next: Atom): boolean {
  if (previous.forceSpace || next.forceSpace) return true;
  if (next.kind === "close" || next.kind === "sep") return false;
  if (previous.kind === "open") return false;
  const before = lastCharacter(previous.code);
  const after = next.code[0] ?? "";
  if (WORD_CHARACTER.test(before) && WORD_CHARACTER.test(after)) return true;
  if (after === "(" || after === "[") {
    const identifier = TRAILING_IDENTIFIER.exec(previous.code)?.[1];
    if (identifier && identifier.length > 1 && !SAFE_BEFORE_PAREN.has(identifier)) return true;
  }
  if (before === ")" && /\p{L}/u.test(after)) return true;
  if (OPERATOR_CHARACTERS.includes(before) && OPERATOR_CHARACTERS.includes(after)) return true;
  if ((before === "[" && after === "|") || (before === "|" && after === "]")) return true;
  return next.space;
}

function joinAtoms(atoms: readonly Atom[]): string {
  let out = "";
  atoms.forEach((atom, index) => {
    if (index > 0 && needsSpace(atoms[index - 1], atom)) out += " ";
    out += atom.code;
  });
  return out.trim();
}

function balancedAtoms(atoms: readonly Atom[], escapeSeparators: boolean): Atom[] {
  const result = atoms.map((atom) => ({ ...atom }));
  const stack: number[] = [];
  result.forEach((atom, index) => {
    if (atom.kind === "open" || OPENERS.has(atom.code)) {
      if (OPENERS.has(atom.code)) stack.push(index);
      return;
    }
    if (CLOSERS.has(atom.code) && (atom.kind === "close" || atom.kind === "word")) {
      if (stack.length > 0) stack.pop();
      else if (ESCAPABLE_DELIMITERS.has(atom.code)) atom.code = `\\${atom.code}`;
      return;
    }
    if (escapeSeparators && stack.length === 0 && (atom.code === "," || atom.code === ";")) {
      atom.code = `\\${atom.code}`;
    }
  });
  for (const index of stack) {
    const atom = result[index];
    if (ESCAPABLE_DELIMITERS.has(atom.code)) atom.code = `\\${atom.code}`;
  }
  return result;
}

function joinArgument(atoms: readonly Atom[]): string {
  return joinAtoms(balancedAtoms(atoms, true));
}

function call(name: string, args: readonly (readonly Atom[])[], named: readonly string[] = []): Atom {
  const parts = [...named, ...args.map((arg) => joinArgument(arg) || `""`)];
  return word(`${name}(${parts.join(", ")})`);
}

function scriptArgument(atoms: readonly Atom[]): string {
  if (atoms.length === 1 && atoms[0].simple) return atoms[0].code;
  return `(${joinAtoms(balancedAtoms(atoms, false))})`;
}

interface Token {
  type: "command" | "char" | "number" | "end";
  value: string;
  from: number;
  to: number;
}

class LatexMathParser {
  private position = 0;
  readonly unsupported = new Set<string>();

  constructor(
    private readonly source: string,
    private readonly options: LatexToTypstOptions,
  ) {}

  parseAll(): Atom[] {
    const atoms: Atom[] = [];
    while (this.position < this.source.length) {
      atoms.push(...this.parseSequence(() => false));
      const token = this.peek();
      if (token.type === "end") break;
      this.position = token.to;
    }
    return atoms;
  }

  private skipSpace(): boolean {
    let skipped = false;
    while (this.position < this.source.length) {
      const character = this.source[this.position];
      if (/\s/u.test(character)) {
        this.position++;
        skipped = true;
      } else if (character === "%") {
        const newline = this.source.indexOf("\n", this.position);
        this.position = newline < 0 ? this.source.length : newline + 1;
        skipped = true;
      } else {
        break;
      }
    }
    return skipped;
  }

  private peek(): Token {
    const from = this.position;
    const source = this.source;
    if (from >= source.length) return { type: "end", value: "", from, to: from };
    const character = source[from];
    if (character === "\\") {
      const letters = /^[A-Za-z]+/u.exec(source.slice(from + 1));
      if (letters) {
        return { type: "command", value: letters[0], from, to: from + 1 + letters[0].length };
      }
      const next = source[from + 1];
      if (next === undefined) return { type: "char", value: "\\", from, to: from + 1 };
      return { type: "command", value: next, from, to: from + 2 };
    }
    if (/\d/u.test(character)) {
      const number = /^\d+(?:\.\d+)?/u.exec(source.slice(from)) as RegExpExecArray;
      return { type: "number", value: number[0], from, to: from + number[0].length };
    }
    const codePoint = source.codePointAt(from) ?? 0;
    const value = String.fromCodePoint(codePoint);
    return { type: "char", value, from, to: from + value.length };
  }

  private next(): Token {
    const token = this.peek();
    this.position = token.to;
    return token;
  }

  private isStop(token: Token, stop: (token: Token) => boolean): boolean {
    return token.type === "end" || stop(token);
  }

  private parseSequence(stop: (token: Token) => boolean): Atom[] {
    const atoms: Atom[] = [];
    for (;;) {
      const space = this.skipSpace();
      const token = this.peek();
      if (this.isStop(token, stop)) break;
      if (token.type === "char" && token.value === "}") {
        this.position = token.to;
        continue;
      }
      if (token.type === "command" && (token.value === "right" || token.value === "end")) {
        this.position = token.to;
        if (token.value === "end") this.readRawGroup();
        else this.readDelimiter();
        continue;
      }
      if (token.type === "command" && lookup(STYLE_SWITCHES, token.value)) {
        this.position = token.to;
        const rest = this.parseSequence(stop);
        if (rest.length > 0) {
          const styled = call(STYLE_SWITCHES[token.value] as string, [rest]);
          styled.space = space;
          atoms.push(styled);
        }
        break;
      }
      let atom: Atom | null;
      if (token.type === "char" && (token.value === "^" || token.value === "_")) {
        atom = word(`""`);
      } else {
        atom = this.parsePrimary();
      }
      if (!atom) continue;
      atom = this.parseScripts(atom);
      if (atom.kind === "group") {
        const children = atom.children ?? [];
        if (children.length > 0) children[0] = { ...children[0], space: space || children[0].space };
        atoms.push(...children);
        continue;
      }
      atom.space = atom.space || space;
      atoms.push(atom);
    }
    return atoms;
  }

  private parseGroupBody(): Atom[] {
    const atoms = this.parseSequence((token) => token.type === "char" && token.value === "}");
    const close = this.peek();
    if (close.type === "char" && close.value === "}") this.position = close.to;
    return atoms;
  }

  private parseArgument(): Atom[] {
    this.skipSpace();
    const token = this.peek();
    if (token.type === "end") return [];
    if (token.type === "char" && token.value === "{") {
      this.position = token.to;
      return this.parseGroupBody();
    }
    if (token.type === "number" && token.value.length > 1) {
      this.position = token.from + 1;
      return [word(token.value[0])];
    }
    const atom = this.parsePrimary();
    if (!atom) return [];
    return atom.kind === "group" ? (atom.children ?? []) : [atom];
  }

  private readRawGroup(): string {
    this.skipSpace();
    const token = this.peek();
    if (token.type === "end") return "";
    if (!(token.type === "char" && token.value === "{")) {
      this.position = token.to;
      return this.source.slice(token.from, token.to);
    }
    let depth = 0;
    for (let cursor = token.from; cursor < this.source.length; cursor++) {
      const character = this.source[cursor];
      if (character === "\\") {
        cursor++;
        continue;
      }
      if (character === "{") depth++;
      if (character === "}" && --depth === 0) {
        this.position = cursor + 1;
        return this.source.slice(token.from + 1, cursor);
      }
    }
    this.position = this.source.length;
    return this.source.slice(token.from + 1);
  }

  private readOptional(): string | null {
    this.skipSpace();
    if (this.source[this.position] !== "[") return null;
    let depth = 0;
    let braces = 0;
    for (let cursor = this.position; cursor < this.source.length; cursor++) {
      const character = this.source[cursor];
      if (character === "\\") {
        cursor++;
        continue;
      }
      if (character === "{") braces++;
      if (character === "}") braces--;
      if (braces > 0) continue;
      if (character === "[") depth++;
      if (character === "]" && --depth === 0) {
        const content = this.source.slice(this.position + 1, cursor);
        this.position = cursor + 1;
        return content;
      }
    }
    return null;
  }

  private subParse(source: string): Atom[] {
    const parser = new LatexMathParser(source, this.options);
    const atoms = parser.parseAll();
    for (const name of parser.unsupported) this.unsupported.add(name);
    return atoms;
  }

  private parseScripts(base: Atom): Atom {
    let primes = 0;
    let sub: Atom[] | null = null;
    let sup: Atom[] | null = null;
    let current = base;
    for (;;) {
      const save = this.position;
      this.skipSpace();
      const token = this.peek();
      if (token.type === "command" && (token.value === "limits" || token.value === "nolimits")) {
        this.position = token.to;
        current = call(token.value === "limits" ? "limits" : "scripts", [[current]]);
        continue;
      }
      if (token.type === "char" && token.value === "'") {
        this.position = token.to;
        primes++;
        continue;
      }
      if (token.type === "char" && (token.value === "^" || token.value === "_")) {
        this.position = token.to;
        const argument = this.parseScriptArgument();
        if (token.value === "_") sub = argument;
        else if (argument.length === 1 && argument[0].code === "prime") primes++;
        else sup = argument;
        continue;
      }
      this.position = save;
      break;
    }
    if (!sub && !sup && primes === 0 && current === base) return base;
    if (current.kind === "group") {
      const children = current.children ?? [];
      const last = children.at(-1) ?? word(`""`);
      const attached = this.attach(last, primes, sub, sup);
      return { ...current, children: [...children.slice(0, -1), attached] };
    }
    return this.attach(current, primes, sub, sup);
  }

  private attach(base: Atom, primes: number, sub: Atom[] | null, sup: Atom[] | null): Atom {
    let code = base.code + "'".repeat(primes);
    if (sub) code += `_${scriptArgument(sub)}`;
    if (sup) code += `^${scriptArgument(sup)}`;
    return { code, kind: "word", space: base.space, simple: false };
  }

  private parseScriptArgument(): Atom[] {
    this.skipSpace();
    const token = this.peek();
    if (token.type === "char" && token.value === "{") {
      this.position = token.to;
      return this.parseGroupBody();
    }
    if (token.type === "number" && token.value.length > 1) {
      this.position = token.from + 1;
      return [word(token.value[0])];
    }
    const atom = this.parsePrimary();
    if (!atom) return [];
    return atom.kind === "group" ? (atom.children ?? []) : [atom];
  }

  private parsePrimary(): Atom | null {
    const token = this.next();
    if (token.type === "number") return word(token.value);
    if (token.type === "command") return this.parseCommand(token.value);
    if (token.type === "end") return null;
    return this.parseCharacter(token.value);
  }

  private parseCharacter(character: string): Atom | null {
    switch (character) {
      case "{":
        return { code: "", kind: "group", space: false, simple: false, children: this.parseGroupBody() };
      case "(":
      case "[":
        return atomOf(character, "open");
      case ")":
      case "]":
        return atomOf(character, "close");
      case "|":
        return atomOf("|", "fence");
      case ",":
      case ";":
        return atomOf(character, "sep");
      case "&":
        return { ...atomOf("&", "align"), forceSpace: true };
      case "~":
        return { ...word("space.nobreak"), forceSpace: true };
      case "/":
        return atomOf(String.raw`\/`, "op");
      case '"':
        return word(String.raw`\"`);
      case "#":
      case "$":
      case "@":
        return word(`\\${character}`);
      case "<":
      case ">":
        return { ...atomOf(character, "op"), forceSpace: true };
      case "'":
        return word("'");
      case "\\":
        return null;
      default:
        if (/\p{L}/u.test(character)) return word(character);
        if (OPERATOR_CHARACTERS.includes(character) || "?:".includes(character)) {
          return atomOf(character, "op");
        }
        return word(character);
    }
  }

  private parseCommand(name: string): Atom | null {
    if (name === "\\") {
      this.readOptional();
      return { ...atomOf("\\", "break"), forceSpace: true };
    }
    if (name === "right") {
      this.readDelimiter();
      return null;
    }
    const symbol = this.symbolFor(name);
    if (symbol) return symbol;
    const delimiter = lookup(DELIMITER_COMMANDS, name);
    if (delimiter) return atomOf(delimiter.code, delimiter.kind);
    const escaped = this.escapedCharacter(name);
    if (escaped) return escaped;
    const accent = lookup(ACCENTS, name);
    if (accent) return call(accent, [this.parseArgument()]);
    if (lookup(FONTS, name)) return this.font(name);
    if (Object.hasOwn(TEXT_STYLES, name)) return this.text(this.readRawGroup(), TEXT_STYLES[name]);
    if (IGNORED.has(name)) {
      if (IGNORED_WITH_ARGUMENT.has(name)) {
        this.readOptional();
        this.readRawGroup();
      }
      return null;
    }
    if (SIZED_DELIMITERS.has(name)) return this.sizedDelimiter();
    return this.structuralCommand(name);
  }

  private symbolFor(name: string): Atom | null {
    const greek = lookup(GREEK, name);
    if (greek) return word(greek);
    if (OPERATORS.has(name)) return word(name);
    const alias = lookup(OPERATOR_ALIASES, name);
    if (alias) return word(alias);
    const symbol = lookup(SYMBOLS, name);
    if (!symbol) return null;
    if (SPACING.has(symbol)) return { ...word(symbol), forceSpace: true };
    if (symbol === "partial" && isTypstVersionBefore(this.options.typstVersion, 12)) return word("diff");
    if (/^[<>=!:|-]/u.test(symbol)) return { ...atomOf(symbol, "op"), simple: true };
    return word(symbol);
  }

  private escapedCharacter(name: string): Atom | null {
    switch (name) {
      case ",":
        return { ...word("thin"), forceSpace: true };
      case ":":
      case ">":
        return { ...word("med"), forceSpace: true };
      case ";":
        return { ...word("thick"), forceSpace: true };
      case " ":
        return { ...word("space"), forceSpace: true };
      case "!":
      case "/":
      case "-":
        return { code: "", kind: "group", space: false, simple: false, children: [] };
      case "%":
        return word("%");
      case "&":
      case "#":
      case "$":
      case "_":
        return word(`\\${name}`);
      default:
        return null;
    }
  }

  private font(name: string): Atom {
    const argument = this.parseArgument();
    const letters = argument.every((atom) => /^\p{L}$/u.test(atom.code)) && argument.length > 1;
    const content = letters ? [word(typstString(argument.map((atom) => atom.code).join("")))] : argument;
    const font = lookup(FONTS, name) ?? "upright";
    const typstName = font === "scr" && isTypstVersionBefore(this.options.typstVersion, 13) ? "cal" : font;
    return call(typstName, [content]);
  }

  private text(raw: string, style: string | null): Atom | null {
    const atoms: Atom[] = [];
    const parts = raw.split(/(?<!\\)\$/u);
    parts.forEach((part, index) => {
      if (index % 2 === 1) {
        const math = this.subParse(part);
        if (math.length > 0) math[0] = { ...math[0], space: true };
        atoms.push(...math);
        return;
      }
      const text = plainText(part);
      if (text) atoms.push({ ...word(typstString(text)), space: index > 0 });
    });
    if (atoms.length === 0) return null;
    if (style) return call(style, [atoms]);
    if (atoms.length === 1) return atoms[0];
    return { code: "", kind: "group", space: false, simple: false, children: atoms };
  }

  private sizedDelimiter(): Atom | null {
    this.skipSpace();
    const token = this.next();
    if (token.type === "end") return null;
    if (token.type === "command") {
      const delimiter = lookup(DELIMITER_COMMANDS, token.value);
      return delimiter ? atomOf(delimiter.code, delimiter.kind) : this.parseCommand(token.value);
    }
    if (token.value === ".") return null;
    return this.parseCharacter(token.value);
  }

  private readDelimiter(): string {
    this.skipSpace();
    const token = this.next();
    if (token.type === "end") return "";
    if (token.type === "command") {
      return lookup(DELIMITER_COMMANDS, token.value)?.code ?? lookup(SYMBOLS, token.value) ?? "";
    }
    if (token.value === ".") return "";
    if (token.value === "<") return "⟨";
    if (token.value === ">") return "⟩";
    if (token.value === "/") return String.raw`\/`;
    return token.value;
  }

  private leftRight(): Atom {
    const open = this.readDelimiter();
    const body = this.parseSequence((token) => token.type === "command" && token.value === "right");
    const right = this.peek();
    let close = "";
    if (right.type === "command" && right.value === "right") {
      this.position = right.to;
      close = this.readDelimiter();
    }
    if (open === "|" && close === "|") return call("abs", [body]);
    if (open === "‖" && close === "‖") return call("norm", [body]);
    if (OPENERS.has(open) && CLOSERS.has(close)) {
      return word(`${open}${joinAtoms(body)}${close}`);
    }
    const escape = (delimiter: string) => (ESCAPABLE_DELIMITERS.has(delimiter) ? `\\${delimiter}` : delimiter);
    const inner = joinArgument(body);
    if (!open) return word(`lr(${inner}${close ? ` ${escape(close)}` : ""})`);
    if (!close) return word(`lr(${escape(open)}${inner ? ` ${inner}` : ""})`);
    return word(`lr(${escape(open)}${inner}${escape(close)})`);
  }

  private structuralCommand(name: string): Atom | null {
    switch (name) {
      case "frac":
      case "dfrac":
      case "tfrac":
      case "cfrac":
        return call("frac", [this.parseArgument(), this.parseArgument()]);
      case "binom":
      case "dbinom":
      case "tbinom":
        return call("binom", [this.parseArgument(), this.parseArgument()]);
      case "sqrt": {
        const index = this.readOptional();
        const radicand = this.parseArgument();
        return index === null ? call("sqrt", [radicand]) : call("root", [this.subParse(index), radicand]);
      }
      case "left":
        return this.leftRight();
      case "middle": {
        const delimiter = this.readDelimiter();
        return delimiter ? word(`mid(${delimiter})`) : null;
      }
      case "begin":
        return this.environment(plainText(this.readRawGroup()).trim());
      case "mathbf":
        return call("bold", [[this.font("mathrm")]]);
      case "operatorname":
        return this.operatorName();
      case "mathop":
        return call("op", [this.parseArgument()]);
      case "overset":
      case "stackrel":
      case "underset": {
        const script = this.parseArgument();
        const base = call("limits", [this.parseArgument()]);
        return { ...base, code: `${base.code}${name === "underset" ? "_" : "^"}${scriptArgument(script)}`, simple: false };
      }
      case "overbrace":
      case "underbrace":
        return this.brace(name);
      case "xrightarrow":
      case "xleftarrow": {
        this.readOptional();
        const label = this.parseArgument();
        const arrow = call("limits", [[atomOf(name === "xrightarrow" ? "-->" : "<--", "op")]]);
        return { ...arrow, code: `${arrow.code}^${scriptArgument(label)}`, simple: false };
      }
      case "cancel":
        return call("cancel", [this.parseArgument()]);
      case "bcancel":
        return call("cancel", [this.parseArgument()], ["inverted: #true"]);
      case "xcancel":
        return call("cancel", [this.parseArgument()], ["cross: #true"]);
      case "boxed":
        return word(`#box(stroke: 0.5pt, inset: 2pt, $${joinAtoms(this.parseArgument())}$)`);
      case "phantom":
      case "hphantom":
      case "vphantom":
        return word(`#hide($${joinAtoms(this.parseArgument())}$)`);
      case "smash":
      case "mathclap":
      case "mathllap":
      case "mathrlap":
      case "substack":
      case "mathnormal":
        this.readOptional();
        return { code: "", kind: "group", space: false, simple: false, children: this.parseArgument() };
      case "pmod":
        return { ...word(`quad (mod ${joinAtoms(this.parseArgument())})`, false), forceSpace: true };
      case "pod":
        return word(`(${joinAtoms(this.parseArgument())})`);
      case "mod":
        return { code: "", kind: "group", space: false, simple: false, children: [word("mod"), ...this.parseArgument()] };
      case "not":
        return this.negation();
      case "hspace":
      case "hspace*": {
        const length = this.readRawGroup().trim();
        return /^-?\d*\.?\d+(?:pt|em|mm|cm|in)$/u.test(length) ? { ...word(`#h(${length})`), forceSpace: true } : null;
      }
      case "hfill":
        return { ...word("#h(1fr)"), forceSpace: true };
      case "textcolor":
      case "color":
        return this.color(name);
      default:
        return this.unknown(name);
    }
  }

  private operatorName(): Atom {
    let limits = false;
    if (this.source[this.position] === "*") {
      this.position++;
      limits = true;
    }
    const name = plainText(this.readRawGroup()).replace(/\s+/gu, " ").trim();
    return word(limits ? `op(${typstString(name)}, limits: #true)` : `op(${typstString(name)})`);
  }

  private brace(name: string): Atom {
    const body = this.parseArgument();
    const save = this.position;
    this.skipSpace();
    const token = this.peek();
    const expected = name === "overbrace" ? "^" : "_";
    if (token.type === "char" && token.value === expected) {
      this.position = token.to;
      return call(name, [body, this.parseScriptArgument()]);
    }
    this.position = save;
    return call(name, [body]);
  }

  private negation(): Atom | null {
    this.skipSpace();
    const token = this.next();
    if (token.type === "end") return null;
    const key = token.value;
    const negated = lookup(NEGATIONS, key);
    if (negated) return negated === "!=" ? atomOf(negated, "op") : word(negated);
    const atom = token.type === "command" ? this.parseCommand(key) : this.parseCharacter(key);
    return atom ? call("cancel", [[atom]]) : null;
  }

  private color(name: string): Atom | null {
    const color = lookup(TYPST_COLORS, plainText(this.readRawGroup()).trim().toLowerCase());
    if (name === "color") {
      const rest = this.parseSequence((token) => token.type === "char" && token.value === "}");
      return color
        ? word(`#text(fill: ${color}, $${joinAtoms(rest)}$)`)
        : { code: "", kind: "group", space: false, simple: false, children: rest };
    }
    const body = this.parseArgument();
    if (!color) return { code: "", kind: "group", space: false, simple: false, children: body };
    return word(`#text(fill: ${color}, $${joinAtoms(body)}$)`);
  }

  private unknown(name: string): Atom | null {
    this.unsupported.add(`\\${name}`);
    if (name === "ce" || name === "pu" || name === "si" || name === "SI" || name === "unit" || name === "qty") {
      const raw = [this.readRawGroup()];
      if (name === "SI" || name === "qty") raw.push(this.readRawGroup());
      const text = plainText(raw.join(" ")).trim();
      return text ? word(typstString(text)) : null;
    }
    if (!/^[A-Za-z]+$/u.test(name)) return null;
    return word(name);
  }

  private environment(name: string): Atom | null {
    if (ENVIRONMENTS_WITH_ARGUMENT.has(name)) {
      this.readOptional();
      this.readRawGroup();
    } else {
      this.readOptional();
    }
    const rows = this.environmentRows(name);
    const delimiter = lookup(MATRIX_DELIMITERS, name);
    if (delimiter !== undefined) {
      const body = rows.map((row) => row.map((cell) => joinArgument(cell)).join(", ")).join("; ");
      const parts = [delimiter ? `delim: ${delimiter}` : "", body].filter(Boolean);
      return word(`mat(${parts.join(", ")})`);
    }
    if (CASES_ENVIRONMENTS.has(name) || REVERSED_CASES.has(name)) {
      const body = rows.map((row) => joinArgument(alignedRow(row, "& quad")));
      const named = REVERSED_CASES.has(name) ? ["reverse: #true"] : [];
      return word(`cases(${[...named, ...body].join(", ")})`);
    }
    if (!ROW_ENVIRONMENTS.has(name)) this.unsupported.add(String.raw`\begin{${name}}`);
    const lines = rows.map((row) => joinAtoms(alignedRow(row))).filter(Boolean);
    return { code: lines.join(" \\\n"), kind: "word", space: false, simple: false };
  }

  private environmentRows(name: string): Atom[][][] {
    const rows: Atom[][][] = [];
    let cells: Atom[][] = [];
    const stop = (token: Token) =>
      (token.type === "char" && token.value === "&") ||
      (token.type === "command" && (token.value === "\\" || token.value === "end" || token.value === "cr"));
    for (;;) {
      const cell = this.parseSequence(stop);
      cells.push(cell);
      const token = this.peek();
      if (token.type === "end") {
        rows.push(cells);
        break;
      }
      this.position = token.to;
      if (token.type === "char") continue;
      if (token.value === "end") {
        const closing = plainText(this.readRawGroup()).trim();
        rows.push(cells);
        if (closing === name || !closing) break;
        continue;
      }
      if (this.source[this.position] === "*") this.position++;
      this.readOptional();
      rows.push(cells);
      cells = [];
    }
    while (rows.length > 0 && rows.at(-1)?.every((cell) => cell.length === 0)) rows.pop();
    return rows;
  }
}

function alignedRow(cells: readonly Atom[][], alignment = "&"): Atom[] {
  const atoms: Atom[] = [];
  cells.forEach((cell, index) => {
    if (index > 0) atoms.push({ ...atomOf(alignment, "align"), space: true });
    cell.forEach((atom, position) => {
      const hugs = alignment === "&" && /^[=<>+\-]/u.test(atom.code);
      atoms.push(position === 0 && index > 0 ? { ...atom, space: !hugs } : atom);
    });
  });
  return atoms.map((atom) => (atom.kind === "align" ? { ...atom, forceSpace: false } : atom));
}

export function convertLatexMath(latex: string, options: LatexToTypstOptions = {}): LatexToTypstResult {
  const parser = new LatexMathParser(latex, options);
  let typst = "";
  try {
    typst = joinAtoms(parser.parseAll());
  } catch {
    typst = "";
  }
  return { typst, unsupported: [...parser.unsupported] };
}

export function latexMathToTypst(latex: string, options: LatexToTypstOptions = {}): string {
  return convertLatexMath(latex, options).typst;
}

const MATH_ENVIRONMENT = /^\\begin\{(equation|align|gather|multline|eqnarray|displaymath|flalign|alignat|math)(\*?)\}/u;

function isEscapedAt(text: string, index: number): boolean {
  let slashes = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === "\\"; cursor--) slashes++;
  return slashes % 2 === 1;
}

function closingIndex(text: string, from: number, close: string): number {
  let cursor = from;
  while (cursor < text.length) {
    const found = text.indexOf(close, cursor);
    if (found < 0) return -1;
    if (!isEscapedAt(text, found) && (close !== "$" || text[found + 1] !== "$")) return found;
    cursor = found + 1;
  }
  return -1;
}

function spanAt(text: string, index: number): LatexMathSpan | null {
  if (isEscapedAt(text, index)) return null;
  const environment = MATH_ENVIRONMENT.exec(text.slice(index));
  if (environment) {
    const closing = `\\end{${environment[1]}${environment[2]}}`;
    const end = text.indexOf(closing, index + environment[0].length);
    if (end < 0) return null;
    return {
      from: index,
      to: end + closing.length,
      body: text.slice(index, end + closing.length),
      display: true,
    };
  }
  const openers: ReadonlyArray<readonly [string, string, boolean]> = [
    ["$$", "$$", true],
    ["$", "$", false],
    [String.raw`\[`, String.raw`\]`, true],
    [String.raw`\(`, String.raw`\)`, false],
  ];
  for (const [open, close, display] of openers) {
    if (!text.startsWith(open, index)) continue;
    const bodyFrom = index + open.length;
    const end = closingIndex(text, bodyFrom, close);
    if (end < 0 || end === bodyFrom) return null;
    return { from: index, to: end + close.length, body: text.slice(bodyFrom, end), display };
  }
  return null;
}

export function findLatexMathSpans(text: string): LatexMathSpan[] {
  const spans: LatexMathSpan[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const character = text[cursor];
    if (character === "$" || character === "\\") {
      const span = spanAt(text, cursor);
      if (span) {
        spans.push(span);
        cursor = span.to;
        continue;
      }
      if (character === "\\") cursor++;
    }
    cursor++;
  }
  return spans;
}

export function typstMathFromLatexSpan(span: LatexMathSpan, options: LatexToTypstOptions = {}): string | null {
  const typst = latexMathToTypst(span.body, options);
  if (!typst) return null;
  return span.display ? `$ ${typst} $` : `$${typst}$`;
}

export function convertLatexMathInText(
  text: string,
  options: LatexToTypstOptions = {},
): { text: string; count: number } {
  let out = "";
  let last = 0;
  let count = 0;
  for (const span of findLatexMathSpans(text)) {
    const converted = typstMathFromLatexSpan(span, options);
    if (converted === null) continue;
    out += text.slice(last, span.from) + converted;
    last = span.to;
    count++;
  }
  return { text: out + text.slice(last), count };
}
