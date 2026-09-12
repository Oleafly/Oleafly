// ---------------------------------------------------------------------------
// LaTeX masking: the single source of truth for both the Hunspell spellchecker
// and the Harper spelling/grammar checker. It produces a SAME-LENGTH copy of
// the source where everything that isn't prose is replaced with spaces
// (newlines kept), so offsets in the masked copy map 1:1 back onto the document.
// Getting this right is what keeps equations, code, citation keys, package
// names, and file paths out of the checkers and stops false positives.
//
// `latex-mask.test.ts`.
// ---------------------------------------------------------------------------

export interface Range {
  from: number;
  to: number;
  word: string;
}

// Environments whose entire body is non-prose (math, code, diagrams). Everything
// between \begin{env} and \end{env} is blanked. Starred variants are matched by
// stripping a trailing "*".
const OPAQUE_ENVS = new Set([
  "math", "displaymath", "equation", "align", "gather", "multline", "eqnarray",
  "alignat", "flalign", "gathered", "aligned", "split", "cases", "array",
  "verbatim", "Verbatim", "lstlisting", "minted", "alltt", "tikzpicture",
  "comment", "luacode", "pycode", "python", "asy", "filecontents",
]);

// Commands whose arguments are identifiers, keys, paths, or URLs (never prose).
// Every [optional] and {brace} argument that directly follows is blanked.
const OPAQUE_ARG_CMDS = new Set([
  "label", "ref", "eqref", "pageref", "autoref", "cref", "Cref", "vref", "nameref",
  "cite", "citep", "citet", "citeauthor", "citeyear", "citealt", "nocite",
  "usepackage", "RequirePackage", "documentclass", "includegraphics",
  "input", "include", "includeonly", "bibliography", "bibliographystyle",
  "lstinputlisting", "inputminted",
  "addbibresource", "printbibliography", "url", "path", "email", "hypersetup", "geometry",
  "usetikzlibrary", "setlength", "setlist", "titleformat", "titlespacing",
  "pagenumbering", "pagestyle", "thispagestyle", "newcommand", "renewcommand",
  "providecommand", "newenvironment", "def", "definecolor", "graphicspath",
  "usetheme", "IEEEkeywords",
  "SI", "SIrange", "qty", "qtyrange", "num", "numrange", "unit", "ang",
  "ce", "ch", "chemfig",
  "gls", "Gls", "glspl", "Glspl", "acrshort", "Acrshort", "acrlong",
  "Acrlong", "acrfull", "Acrfull", "index",
  // Spacing/length commands whose arguments are dimensions ("2pt", "0.5in").
  "vspace", "hspace", "vskip", "hskip", "addvspace", "addtolength",
  // Preamble metadata is not body prose. Names, affiliations, dates, and PDF
  // metadata frequently contain proper nouns or machine-oriented values that
  // should not produce document-body spelling and grammar diagnostics.
  "title", "subtitle", "author", "date", "subject", "keywords",
  "institute", "affiliation",
]);

const INLINE_ARG_CMDS = new Set([
  "ref", "eqref", "pageref", "autoref", "cref", "Cref", "vref", "nameref",
  "cite", "citep", "citet", "citeauthor", "citeyear", "citealt",
  "url", "path", "email",
  "SI", "SIrange", "qty", "qtyrange", "num", "numrange", "unit", "ang",
  "ce", "ch", "chemfig",
  "gls", "Gls", "glspl", "Glspl", "acrshort", "Acrshort", "acrlong",
  "Acrlong", "acrfull", "Acrfull",
]);

const CITE_LIKE = /(?:^cite|cites?$)/iu;

// Commands whose FIRST argument is opaque but the rest is prose, e.g.
// \textcolor{red}{text}, \hyperref[key]{text}, \href{url}{shown prose}.
const FIRST_ARG_OPAQUE_CMDS = new Set([
  "textcolor", "colorbox", "fcolorbox", "hyperref", "href",
]);
const OPAQUE_BRACE_PREFIX_COUNTS = new Map<string, number>([
  ["textcolor", 1],
  ["colorbox", 1],
  ["fcolorbox", 2],
  ["href", 1],
]);

const LATEX_SPECIAL = new Set(["{", "}", "[", "]", "~", "&", "#", "^", "_"]);

const VERBATIM_CMDS = new Set(["verb", "Verb", "lstinline", "mintinline"]);

export const PROSE_PLACEHOLDER = "Dummy";
export const PROSE_SHORT_PLACEHOLDER = "X";

export interface MaskSpan {
  from: number;
  to: number;
}

type MaskKind = "block" | "inline";

interface MaskRegion {
  from: number;
  to: number;
  kind: MaskKind;
  blanks: MaskSpan[];
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

function findEnvEnd(text: string, from: number, env: string): number {
  const re = new RegExp(`\\\\(begin|end)\\s*\\{${escapeRe(env)}\\*?\\}`, "g");
  re.lastIndex = from;
  let depth = 1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m[1] === "begin") depth++;
    else if (--depth === 0) return m.index + m[0].length;
  }
  return text.length;
}

function collectLatexRegions(text: string): MaskRegion[] {
  const regions: MaskRegion[] = [];
  const chars = text.split("");
  const n = chars.length;

  const blankSource = (a: number, b: number) => {
    for (let k = a; k < b; k++) if (chars[k] !== "\n") chars[k] = " ";
  };
  const clampSpans = (spans: MaskSpan[]): MaskSpan[] => {
    const output: MaskSpan[] = [];
    for (const span of spans) {
      const from = Math.max(0, Math.min(span.from, n));
      const to = Math.max(from, Math.min(span.to, n));
      if (to > from) output.push({ from, to });
    }
    return output;
  };
  const push = (
    rawFrom: number,
    rawTo: number,
    kind: MaskKind,
    spans?: MaskSpan[],
  ) => {
    const from = Math.max(0, Math.min(rawFrom, n));
    const to = Math.max(from, Math.min(rawTo, n));
    if (to <= from) return;
    regions.push({
      from,
      to,
      kind,
      blanks: spans ? clampSpans(spans) : [{ from, to }],
    });
  };

  for (const pattern of [
    /(?:https?:\/\/|www\.)[^\s<>{}\\]+/giu,
    /\b[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.\p{L}{2,}\b/giu,
  ]) {
    for (const match of text.matchAll(pattern)) {
      if (match.index === undefined) continue;
      const to = match.index + match[0].length;
      push(match.index, to, "inline");
      blankSource(match.index, to);
    }
  }

  const matchGroup = (open: number): number => {
    const o = chars[open];
    const close = o === "{" ? "}" : "]";
    let depth = 0;
    for (let k = open; k < n; k++) {
      const ch = chars[k];
      if (ch === "\\") {
        k++;
        continue;
      }
      if (ch === o) depth++;
      else if (ch === close) {
        depth--;
        if (depth === 0) return k + 1;
      }
    }
    return n;
  };

  const skipInlineSpace = (k: number): number => {
    while (k < n && (chars[k] === " " || chars[k] === "\t")) k++;
    return k;
  };

  const endOfArgs = (k: number): { end: number; spans: MaskSpan[] } => {
    const spans: MaskSpan[] = [];
    if (chars[k] === "*") {
      spans.push({ from: k, to: k + 1 });
      k++;
    }
    for (;;) {
      const s = skipInlineSpace(k);
      const ch = chars[s];
      if (ch !== "{" && ch !== "[") break;
      const end = matchGroup(s);
      spans.push({ from: s, to: end });
      k = end;
    }
    return { end: k, spans };
  };

  const endOfOpaquePrefix = (
    k: number,
    name: string,
  ): { end: number; spans: MaskSpan[] } => {
    const spans: MaskSpan[] = [];
    if (chars[k] === "*") {
      spans.push({ from: k, to: k + 1 });
      k++;
    }
    if (name === "hyperref") {
      const start = skipInlineSpace(k);
      if (chars[start] !== "{" && chars[start] !== "[") {
        return { end: k, spans };
      }
      const end = matchGroup(start);
      spans.push({ from: start, to: end });
      return { end, spans };
    }
    const braces = OPAQUE_BRACE_PREFIX_COUNTS.get(name) ?? 1;
    let consumed = 0;
    for (;;) {
      const start = skipInlineSpace(k);
      if (chars[start] === "[") {
        const end = matchGroup(start);
        spans.push({ from: start, to: end });
        k = end;
        continue;
      }
      if (chars[start] === "{" && consumed < braces) {
        const end = matchGroup(start);
        spans.push({ from: start, to: end });
        consumed++;
        k = end;
        continue;
      }
      return { end: k, spans };
    }
  };

  const endOfLine = (k: number): number => {
    const at = chars.indexOf("\n", k);
    return at === -1 ? n : at;
  };

  const mathCloseAt = (k: number, mode: 1 | 2 | 3 | 4): number | null => {
    const ch = chars[k];
    if (ch === "\n") return mode === 1 ? k : null;
    if (ch === "\\" && (chars[k + 1] === ")" || chars[k + 1] === "]")) {
      return k + 2;
    }
    if (ch === "$") {
      if (mode === 2 && chars[k + 1] === "$") return k + 2;
      if (mode === 1) return k + 1;
    }
    return null;
  };

  const endOfMath = (start: number, mode: 1 | 2 | 3 | 4): number => {
    let k = start;
    while (k < n) {
      const close = mathCloseAt(k, mode);
      if (close !== null) return close;
      k = chars[k] === "%" ? endOfLine(k) : k + 1;
    }
    return n;
  };

  const verbatimDelimitedEnd = (start: number, delimiter: string): number => {
    let k = start + 1;
    while (k < n && chars[k] !== "\n") {
      if (chars[k] === delimiter && chars[k - 1] !== "\\") {
        k++;
        break;
      }
      k++;
    }
    return k;
  };

  const endOfVerbatim = (j: number, name: string): number => {
    let k = j;
    if (chars[k] === "*") k++;
    k = skipInlineSpace(k);
    if (chars[k] === "[") k = matchGroup(k);
    k = skipInlineSpace(k);
    if (name === "mintinline" && chars[k] === "{") {
      k = matchGroup(k);
      k = skipInlineSpace(k);
    }
    if (chars[k] === "{") return matchGroup(k);
    const delimiter = chars[k];
    if (!delimiter || delimiter === "\n") return k;
    return verbatimDelimitedEnd(k, delimiter);
  };

  const beginRegion = (start: number, j: number): number => {
    const s = skipInlineSpace(j);
    if (chars[s] !== "{") {
      push(start, j, "block");
      return j;
    }
    const groupEnd = matchGroup(s);
    const env = text
      .slice(s + 1, groupEnd - 1)
      .trim()
      .replace(/\*$/, "");
    if (OPAQUE_ENVS.has(env)) {
      const envEnd = findEnvEnd(text, groupEnd, env);
      push(start, envEnd, "block");
      return envEnd;
    }
    const args = endOfArgs(j);
    push(start, args.end, "block", [{ from: start, to: j }, ...args.spans]);
    return args.end;
  };

  const namedCommandRegion = (
    start: number,
    j: number,
    name: string,
  ): number => {
    if (VERBATIM_CMDS.has(name)) {
      const k = endOfVerbatim(j, name);
      push(start, k, "inline");
      return Math.max(k, j);
    }
    if (name === "begin") return beginRegion(start, j);
    if (name === "end") {
      const args = endOfArgs(j);
      push(start, args.end, "block", [{ from: start, to: j }, ...args.spans]);
      return args.end;
    }
    const opaqueArgs = OPAQUE_ARG_CMDS.has(name);
    if (opaqueArgs || CITE_LIKE.test(name)) {
      const args = endOfArgs(j);
      const inline =
        INLINE_ARG_CMDS.has(name) ||
        (!opaqueArgs && CITE_LIKE.test(name));
      push(start, args.end, inline ? "inline" : "block", [
        { from: start, to: j },
        ...args.spans,
      ]);
      return args.end;
    }
    if (FIRST_ARG_OPAQUE_CMDS.has(name)) {
      const prefix = endOfOpaquePrefix(j, name);
      push(start, prefix.end, "block", [
        { from: start, to: j },
        ...prefix.spans,
      ]);
      return prefix.end;
    }
    push(start, j, "block");
    return j;
  };

  const backslashRegion = (start: number, next: string): number => {
    if (next === "(" || next === "[") {
      const stop = endOfMath(start + 2, next === "(" ? 3 : 4);
      push(start, stop, next === "(" ? "inline" : "block");
      return stop;
    }
    if (next === "\\") {
      const spans: MaskSpan[] = [{ from: start, to: start + 2 }];
      let k = skipInlineSpace(start + 2);
      if (chars[k] === "[") {
        const end = matchGroup(k);
        spans.push({ from: k, to: end });
        k = end;
      }
      push(start, k, "block", spans);
      return k;
    }
    if (!/[a-zA-Z@]/.test(next)) {
      push(start, start + 2, "block");
      return start + 2;
    }
    let j = start + 1;
    while (j < n && /[a-zA-Z@]/.test(chars[j])) j++;
    return namedCommandRegion(start, j, text.slice(start + 1, j));
  };

  const dollarRegion = (start: number, next: string): number => {
    const mode = next === "$" ? 2 : 1;
    const stop = endOfMath(start + mode, mode);
    push(start, stop, mode === 2 ? "block" : "inline");
    return stop;
  };

  let i = 0;
  while (i < n) {
    const c = chars[i];
    const next = chars[i + 1] ?? "";

    if (c === "\n") {
      i++;
    } else if (c === "%") {
      const stop = endOfLine(i);
      push(i, stop, "block");
      i = stop;
    } else if (c === "\\") {
      i = backslashRegion(i, next);
    } else if (c === "$") {
      i = dollarRegion(i, next);
    } else if (LATEX_SPECIAL.has(c)) {
      push(i, i + 1, "block");
      i++;
    } else {
      i++;
    }
  }

  regions.sort((left, right) => left.from - right.from || right.to - left.to);
  return regions;
}

function blankInto(out: string[], from: number, to: number): void {
  for (let k = from; k < to && k < out.length; k++) {
    if (out[k] !== "\n") out[k] = " ";
  }
}

export function maskLatex(text: string): string {
  const out = text.split("");
  let applied = 0;
  for (const region of collectLatexRegions(text)) {
    if (region.to <= applied) continue;
    for (const span of region.blanks) {
      const from = Math.max(span.from, applied);
      if (span.to > from) blankInto(out, from, span.to);
    }
    applied = region.to;
  }
  return out.join("");
}

export interface ProseMask {
  prose: string;
  masked: MaskSpan[];
}

function blankRegionSpans(
  out: string[],
  blanks: readonly MaskSpan[],
  from: number,
): void {
  for (const span of blanks) {
    const start = Math.max(span.from, from);
    if (span.to > start) blankInto(out, start, span.to);
  }
}

function writeProsePlaceholder(
  out: string[],
  text: string,
  from: number,
  to: number,
): void {
  const span = to - from;
  const placeholder =
    span >= PROSE_PLACEHOLDER.length
      ? PROSE_PLACEHOLDER
      : PROSE_SHORT_PLACEHOLDER;
  const before = from > 0 ? text[from - 1] : " ";
  const after = span === placeholder.length ? (text[to] ?? " ") : " ";
  if (
    span < placeholder.length ||
    /[\p{L}\p{N}]/u.test(before) ||
    /[\p{L}\p{N}]/u.test(after) ||
    text.slice(from, from + placeholder.length).includes("\n")
  ) {
    return;
  }
  for (let k = 0; k < placeholder.length; k++) {
    out[from + k] = placeholder[k];
  }
}

export function maskLatexForProseRegions(text: string): ProseMask {
  const out = text.split("");
  const masked: MaskSpan[] = [];
  let applied = 0;
  for (const region of collectLatexRegions(text)) {
    if (region.to <= applied) continue;
    const from = Math.max(region.from, applied);
    applied = region.to;
    masked.push({ from, to: region.to });
    if (region.kind === "block") {
      blankRegionSpans(out, region.blanks, from);
      continue;
    }
    blankInto(out, from, region.to);
    writeProsePlaceholder(out, text, from, region.to);
  }
  return { prose: out.join(""), masked };
}

export function maskLatexForProse(text: string): string {
  return maskLatexForProseRegions(text).prose;
}

export function intersectsMaskedRegion(
  masked: readonly MaskSpan[],
  from: number,
  to: number,
): boolean {
  let low = 0;
  let high = masked.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const span = masked[middle];
    if (span.to <= from) low = middle + 1;
    else if (span.from >= to) high = middle - 1;
    else return true;
  }
  return false;
}

const TRAILING_PUNCT = new Set([".", ",", ";", ":", "!", "?", ")", "]", "}", "'"]);

// Runs of blanked/whitespace characters collapse to a single space (or nothing
// before closing punctuation), so the linter never sees the large gaps that
// masking leaves behind, since those gaps otherwise trigger whitespace/formatting
// and sentence-length false positives that map back onto `\commands`. `map[k]`
// is the original document offset of `prose[k]`, so lint spans can be
// translated back.
export function maskToProse(text: string): { prose: string; map: number[] } {
  const masked = maskLatex(text);
  let prose = "";
  const map: number[] = [];
  let pending = false;
  for (let i = 0; i < masked.length; i++) {
    const c = masked[i];
    if (c === " " || c === "\n" || c === "\t" || c === "\r") {
      if (prose.length > 0) pending = true; // defer; drop leading whitespace
      continue;
    }
    if (pending) {
      pending = false;
      if (!TRAILING_PUNCT.has(c)) {
        prose += " ";
        map.push(i);
      }
    }
    prose += c;
    map.push(i);
  }
  return { prose, map };
}

export function spellcheckRanges(text: string): Range[] {
  const masked = maskLatex(text);
  const out: Range[] = [];
  const re = /[A-Za-z][A-Za-z']*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(masked))) {
    const from = m.index;
    const to = from + m[0].length;
    out.push({ from, to, word: text.slice(from, to) });
  }
  return out;
}
