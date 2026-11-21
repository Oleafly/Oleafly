import { matchingBrace } from "@oleafly/latex";
import { maskComments } from "../mask";

export const DISPLAY_MATH_ENVIRONMENTS: ReadonlySet<string> = new Set([
  "equation",
  "equation*",
  "align",
  "align*",
  "gather",
  "gather*",
  "multline",
  "multline*",
  "flalign",
  "flalign*",
  "alignat",
  "alignat*",
  "eqnarray",
  "eqnarray*",
  "displaymath",
  "math",
]);

export const OPAQUE_ENVIRONMENTS: ReadonlySet<string> = new Set([
  "verbatim",
  "verbatim*",
  "Verbatim",
  "lstlisting",
  "minted",
  "comment",
  "tikzpicture",
  "pgfpicture",
  "filecontents",
  "filecontents*",
  "algorithmic",
]);

const ARGUMENT_LIMITS: Readonly<Record<string, number>> = {
  label: 1,
  ref: 1,
  eqref: 1,
  autoref: 1,
  cref: 1,
  Cref: 1,
  pageref: 1,
  vref: 1,
  cite: 2,
  citep: 2,
  citet: 2,
  citealt: 2,
  citealp: 2,
  citeauthor: 2,
  citeyear: 2,
  nocite: 1,
  usepackage: 2,
  RequirePackage: 2,
  documentclass: 2,
  includegraphics: 2,
  input: 1,
  include: 1,
  url: 1,
  href: 1,
  bibliography: 1,
  bibliographystyle: 1,
  newcommand: 3,
  renewcommand: 3,
  providecommand: 3,
  DeclareRobustCommand: 3,
  newenvironment: 4,
  begin: 3,
  end: 1,
  setlength: 2,
  addtolength: 2,
  hspace: 1,
  vspace: 1,
  color: 1,
  textcolor: 1,
  colorbox: 1,
  definecolor: 3,
  graphicspath: 1,
  hypersetup: 1,
  captionsetup: 2,
  resizebox: 2,
  scalebox: 1,
  setcounter: 2,
  newtheorem: 3,
  crefname: 3,
  Crefname: 3,
  multicolumn: 2,
  multirow: 2,
  makebox: 2,
  raisebox: 2,
  rule: 3,
  cmidrule: 2,
  bibitem: 2,
  thispagestyle: 1,
  pagestyle: 1,
};

export interface ProseView {
  readonly text: string;
  readonly prose: string;
  readonly bodyStart: number;
}

function blank(chars: string[], from: number, to: number): void {
  const end = Math.min(chars.length, to);
  for (let index = Math.max(0, from); index < end; index += 1) {
    if (chars[index] !== "\n") chars[index] = " ";
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function environmentEnd(text: string, name: string, from: number): number {
  const pattern = new RegExp(`\\\\end\\s*\\{${escapeRegExp(name)}\\}`, "g");
  pattern.lastIndex = from;
  const match = pattern.exec(text);
  return match ? match.index + match[0].length : -1;
}

const OPTIONAL_ARGUMENT_LIMIT = 1000;

export function closingBracket(text: string, open: number): number {
  let depth = 0;
  const stop = Math.min(text.length, open + OPTIONAL_ARGUMENT_LIMIT);
  for (let index = open + 1; index < stop; index += 1) {
    const character = text[index];
    if (character === "\\") {
      index += 1;
      continue;
    }
    if (character === "{") depth += 1;
    else if (character === "}") depth -= 1;
    else if (character === "]" && depth === 0) return index;
    else if (character === "\n" && text[index + 1] === "\n") return -1;
  }
  return -1;
}

function escaped(text: string, index: number): boolean {
  let slashes = 0;
  for (let at = index - 1; at >= 0 && text[at] === "\\"; at -= 1) slashes += 1;
  return slashes % 2 === 1;
}

function maskDelimited(chars: string[], source: string, opener: string, closer: string): void {
  for (let open = source.indexOf(opener); open >= 0; ) {
    if (escaped(source, open)) {
      open = source.indexOf(opener, open + 1);
      continue;
    }
    const close = source.indexOf(closer, open + opener.length);
    if (close < 0) return;
    blank(chars, open, close + closer.length);
    open = source.indexOf(opener, close + closer.length);
  }
}

function maskInlineMath(chars: string[], source: string): void {
  let open = -1;
  for (let index = 0; index < chars.length; index += 1) {
    if (chars[index] !== "$" || escaped(source, index)) continue;
    if (open < 0) {
      open = index;
      continue;
    }
    blank(chars, open, index + 1);
    open = -1;
  }
}

function maskCommandArguments(chars: string[], source: string): void {
  const command = /\\([A-Za-z]+)\*?/g;
  for (let match = command.exec(source); match; match = command.exec(source)) {
    const limit = ARGUMENT_LIMITS[match[1]];
    if (limit === undefined) continue;
    let at = match.index + match[0].length;
    for (let taken = 0; taken < limit + 1 && at < source.length; ) {
      let next = at;
      while (source[next] === " " || source[next] === "\t") next += 1;
      const character = source[next];
      if (character !== "{" && character !== "[") break;
      const close = character === "{" ? matchingBrace(source, next) : closingBracket(source, next);
      if (close < 0) break;
      blank(chars, next, close + 1);
      at = close + 1;
      if (character === "{") taken += 1;
    }
    command.lastIndex = Math.max(command.lastIndex, at);
  }
}

export function proseView(text: string): ProseView {
  const source = maskComments(text);
  const chars = source.split("");
  let bodyStart = 0;
  const begin = /\\begin\s*\{document\}/.exec(source);
  if (begin) {
    bodyStart = begin.index + begin[0].length;
    blank(chars, 0, bodyStart);
  }
  const environment = /\\begin\s*\{([A-Za-z]+\*?)\}/g;
  for (let match = environment.exec(source); match; match = environment.exec(source)) {
    const name = match[1];
    if (!DISPLAY_MATH_ENVIRONMENTS.has(name) && !OPAQUE_ENVIRONMENTS.has(name)) continue;
    const end = environmentEnd(source, name, match.index + match[0].length);
    const to = end < 0 ? source.length : end;
    blank(chars, match.index, to);
    environment.lastIndex = to;
  }
  maskDelimited(chars, source, "$$", "$$");
  maskDelimited(chars, source, "\\[", "\\]");
  maskDelimited(chars, source, "\\(", "\\)");
  maskInlineMath(chars, source);
  maskCommandArguments(chars, source);
  return { text, prose: chars.join(""), bodyStart };
}

export function isProse(view: ProseView, from: number, to: number): boolean {
  return from >= view.bodyStart && view.prose.slice(from, to) === view.text.slice(from, to);
}

export function commentFree(text: string): string {
  return maskComments(text);
}

export { escapeRegExp };
