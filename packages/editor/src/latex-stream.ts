import type { StreamParser, StringStream } from "@codemirror/language";
import { stex } from "@codemirror/legacy-modes/mode/stex";
import { tags as t } from "@lezer/highlight";
import { syntaxTags } from "./syntax-colors";

type CommandRole = "heading" | "structure" | "reference" | "environment" | "formatting" | "link";

const roleEntries = (role: CommandRole, names: readonly string[]): [string, CommandRole][] =>
  names.map((name) => [name, role]);

const COMMAND_ROLES: ReadonlyMap<string, CommandRole> = new Map([
  ...roleEntries("heading", [
    "part",
    "chapter",
    "section",
    "subsection",
    "subsubsection",
    "paragraph",
    "subparagraph",
  ]),
  ...roleEntries("structure", ["documentclass", "usepackage", "RequirePackage"]),
  ...roleEntries("reference", [
    "cite",
    "citep",
    "citet",
    "citealp",
    "citealt",
    "citeauthor",
    "citeyear",
    "citeyearpar",
    "nocite",
    "parencite",
    "Parencite",
    "textcite",
    "Textcite",
    "autocite",
    "Autocite",
    "footcite",
    "smartcite",
    "supercite",
    "fullcite",
    "ref",
    "eqref",
    "pageref",
    "autoref",
    "cref",
    "Cref",
    "nameref",
    "vref",
    "label",
    "bibitem",
  ]),
  ...roleEntries("environment", ["begin", "end"]),
  ...roleEntries("link", ["href", "url"]),
  ...roleEntries("formatting", [
    "textbf",
    "textit",
    "emph",
    "underline",
    "textsc",
    "texttt",
    "textsf",
    "textmd",
    "textrm",
    "textup",
    "textsl",
    "textsuperscript",
    "textsubscript",
    "sout",
    "uline",
  ]),
]);

const MATH_ENVIRONMENTS: ReadonlySet<string> = new Set(
  ["equation", "align", "alignat", "flalign", "gather", "multline", "eqnarray", "dmath"].flatMap(
    (name) => [name, `${name}*`],
  ).concat(["displaymath", "math"]),
);

const COMMAND = /^\\[a-zA-Z@\xc0-῿⁠-￿]+$/;

interface LatexStreamState {
  inner: unknown;
  role: CommandRole | null;
  command: string;
  depth: number;
  argument: string;
  math: boolean;
  mathEnvironment: string | null;
}

const inner = stex as StreamParser<unknown>;

function closeArgument(state: LatexStreamState): void {
  const name = state.argument.trim();
  if (state.command === "begin" && MATH_ENVIRONMENTS.has(name)) state.mathEnvironment = name;
  else if (state.command === "end" && name === state.mathEnvironment) state.mathEnvironment = null;
  state.argument = "";
}

function commandToken(name: string, state: LatexStreamState, inMath: boolean): string {
  const role = COMMAND_ROLES.get(name) ?? null;
  if (!(state.role && state.depth > 0)) {
    state.role = role;
    state.command = name;
    state.depth = 0;
    state.argument = "";
  }
  if (role === null || role === "link") return inMath ? "math" : "tag";
  return role;
}

function bracketToken(text: string, state: LatexStreamState, inMath: boolean): string {
  if (state.role) {
    if (text === "{" || text === "[") state.depth += 1;
    else if (state.depth > 0) {
      state.depth -= 1;
      if (state.depth === 0) closeArgument(state);
    }
    return state.math ? "math" : "bracket";
  }
  return inMath ? "math" : "bracket";
}

function argumentToken(text: string, style: string | null, state: LatexStreamState, inMath: boolean): string | null {
  if (state.command === "begin" || state.command === "end") state.argument += text;
  if (state.math) return "math";
  if (state.role === "formatting") return inMath ? "math" : style;
  if (style === "atom" && state.role === "structure" && /^\d/.test(text)) return style;
  if (style === null || style === "atom") return state.role;
  return style;
}

function plainToken(text: string, style: string | null, inMath: boolean): string | null {
  if (inMath) return "math";
  if (style === "tag") return "operator";
  if (style === null && (text === "~" || text === "&")) return "operator";
  return style;
}

export const latexStreamParser: StreamParser<LatexStreamState> = {
  name: "stex",
  startState: (indentUnit) => ({
    inner: inner.startState?.(indentUnit),
    role: null,
    command: "",
    depth: 0,
    argument: "",
    math: false,
    mathEnvironment: null,
  }),
  copyState: (state) => ({ ...state, inner: inner.copyState?.(state.inner) ?? state.inner }),
  blankLine: (state, indentUnit) => {
    inner.blankLine?.(state.inner, indentUnit);
    state.math = false;
    state.role = null;
    state.depth = 0;
  },
  token(stream: StringStream, state: LatexStreamState): string | null {
    const style = inner.token(stream, state.inner);
    const text = stream.current();
    if (style === "comment") return style;
    if (style === "keyword") {
      state.math = !state.math;
      return "math";
    }
    const inMath = state.math || state.mathEnvironment !== null;
    if (style === "tag" && COMMAND.test(text)) return commandToken(text.slice(1), state, inMath);
    if (style === "bracket") return bracketToken(text, state, inMath);
    if (state.role && state.depth > 0) return argumentToken(text, style, state, inMath);
    if (state.role && text === "*") return state.role;
    if (state.role && text.trim()) state.role = null;
    if (!inMath && style === null && text.length > 1 && (text[0] === "~" || text[0] === "&")) {
      stream.backUp(text.length - 1);
      return "operator";
    }
    return plainToken(text, style, inMath);
  },
  tokenTable: {
    heading: t.heading,
    structure: t.moduleKeyword,
    reference: syntaxTags.reference,
    environment: syntaxTags.environment,
    formatting: syntaxTags.formatting,
    math: syntaxTags.math,
    link: t.link,
  },
};
