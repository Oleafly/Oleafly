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

function blankRun(chars: string[], a: number, b: number): void {
  for (let k = a; k < b; k++) if (chars[k] !== "\n") chars[k] = " ";
}

function matchGroup(chars: string[], open: number): number {
  const o = chars[open];
  const close = o === "{" ? "}" : "]";
  let depth = 0;
  for (let k = open; k < chars.length; k++) {
    const ch = chars[k];
    if (ch === "\\") {
      k++; // skip the escaped character
      continue;
    }
    if (ch === o) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return k + 1;
    }
  }
  return chars.length;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

export function maskLatex(text: string): string {
  const chars = text.split("");
  const n = chars.length;
  let i = 0;
  let inComment = false;
  let math = 0; // 0 none | 1 $ | 2 $$ | 3 \( | 4 \[

  // URLs and email addresses can appear without \url/\href. Blank them before
  // parsing so URL punctuation cannot be mistaken for comments or commands.
  for (const pattern of [
    /(?:https?:\/\/|www\.)[^\s<>{}\\]+/giu,
    /\b[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}\b/giu,
  ]) {
    for (const match of text.matchAll(pattern)) {
      if (match.index !== undefined) {
        blankRun(chars, match.index, match.index + match[0].length);
      }
    }
  }

  const skipInlineSpace = (k: number): number => {
    while (k < n && (chars[k] === " " || chars[k] === "\t")) k++;
    return k;
  };

  // Consume the argument groups following a command name at `k`. In "all" mode
  // every argument is blanked; in "first" mode only the first is blanked and the
  // rest are left for normal prose scanning. Returns the new index.
  const consumeArgs = (k: number, mode: "all" | "first"): number => {
    if (chars[k] === "*") {
      blankRun(chars, k, k + 1);
      k++;
    }
    let blanked = 0;
    for (;;) {
      const s = skipInlineSpace(k);
      const ch = chars[s];
      if (ch !== "{" && ch !== "[") break;
      if (mode === "first" && blanked >= 1) break;
      const end = matchGroup(chars, s);
      blankRun(chars, s, end);
      blanked++;
      k = end;
    }
    return k;
  };

  const consumeOpaquePrefix = (k: number, name: string): number => {
    if (chars[k] === "*") {
      blankRun(chars, k, k + 1);
      k++;
    }
    // \hyperref[key]{visible prose}: the first group, regardless of bracket
    // type, is the only opaque prefix.
    if (name === "hyperref") {
      const start = skipInlineSpace(k);
      if (chars[start] !== "{" && chars[start] !== "[") return k;
      const end = matchGroup(chars, start);
      blankRun(chars, start, end);
      return end;
    }
    // Color/href commands may have leading optional configuration. Blank all
    // option groups plus the command-specific number of identifier/URL braces,
    // then leave the displayed prose argument intact.
    const braces = OPAQUE_BRACE_PREFIX_COUNTS.get(name) ?? 1;
    let consumedBraces = 0;
    for (;;) {
      const start = skipInlineSpace(k);
      if (chars[start] === "[") {
        const end = matchGroup(chars, start);
        blankRun(chars, start, end);
        k = end;
        continue;
      }
      if (chars[start] === "{" && consumedBraces < braces) {
        const end = matchGroup(chars, start);
        blankRun(chars, start, end);
        consumedBraces++;
        k = end;
        continue;
      }
      return k;
    }
  };

  while (i < n) {
    const c = chars[i];
    const next = chars[i + 1] ?? "";

    if (c === "\n") {
      inComment = false;
      if (math === 1) math = 0; // inline $…$ doesn't cross lines
      i++;
      continue;
    }
    if (inComment) {
      blankRun(chars, i, i + 1);
      i++;
      continue;
    }
    if (c === "%") {
      inComment = true;
      blankRun(chars, i, i + 1);
      i++;
      continue;
    }

    if (math) {
      if (c === "\\" && (next === ")" || next === "]")) {
        blankRun(chars, i, i + 2);
        math = 0;
        i += 2;
        continue;
      }
      if (c === "$") {
        if (math === 2 && next === "$") {
          blankRun(chars, i, i + 2);
          math = 0;
          i += 2;
          continue;
        }
        if (math === 1) {
          blankRun(chars, i, i + 1);
          math = 0;
          i++;
          continue;
        }
      }
      blankRun(chars, i, i + 1);
      i++;
      continue;
    }

    if (c === "\\") {
      // Math openers.
      if (next === "(" || next === "[") {
        blankRun(chars, i, i + 2);
        math = next === "(" ? 3 : 4;
        i += 2;
        continue;
      }
      // Line break `\\`, optionally carrying a `[length]` spacing argument.
      if (next === "\\") {
        blankRun(chars, i, i + 2);
        let k = skipInlineSpace(i + 2);
        if (chars[k] === "[") {
          const end = matchGroup(chars, k);
          blankRun(chars, k, end);
          k = end;
        }
        i = k;
        continue;
      }
      // Any other escaped non-letter (`\%`, `\&`, `\{`, `\$`, …).
      if (!/[a-zA-Z@]/.test(next)) {
        blankRun(chars, i, i + 2);
        i += 2;
        continue;
      }
      // A command `\name`.
      let j = i + 1;
      while (j < n && /[a-zA-Z@]/.test(chars[j])) j++;
      const name = text.slice(i + 1, j);

      // Inline verbatim/code commands use an arbitrary delimiter and their
      // payload is never prose. The starred/optional/language arguments are
      // included in the same opaque run.
      if (
        name === "verb" ||
        name === "Verb" ||
        name === "lstinline" ||
        name === "mintinline"
      ) {
        let k = j;
        if (chars[k] === "*") k++;
        k = skipInlineSpace(k);
        if (chars[k] === "[") k = matchGroup(chars, k);
        k = skipInlineSpace(k);
        if (name === "mintinline" && chars[k] === "{") {
          k = matchGroup(chars, k);
          k = skipInlineSpace(k);
        }
        if (chars[k] === "{") {
          k = matchGroup(chars, k);
        } else {
          const delimiter = chars[k];
          if (delimiter && delimiter !== "\n") {
            k++;
            while (k < n && chars[k] !== "\n") {
              if (chars[k] === delimiter && chars[k - 1] !== "\\") {
                k++;
                break;
              }
              k++;
            }
          }
        }
        blankRun(chars, i, k);
        i = Math.max(k, j);
        continue;
      }

      if (name === "begin") {
        const s = skipInlineSpace(j);
        if (chars[s] === "{") {
          const end = matchGroup(chars, s);
          const env = text.slice(s + 1, end - 1).trim().replace(/\*$/, "");
          if (OPAQUE_ENVS.has(env)) {
            const envEnd = findEnvEnd(text, end, env);
            blankRun(chars, i, envEnd);
            i = envEnd;
            continue;
          }
          // Non-opaque env: blank `\begin` + `{name}` (+ spec args like tabular's),
          // keep the body prose.
          blankRun(chars, i, j);
          i = consumeArgs(j, "all");
          continue;
        }
        blankRun(chars, i, j);
        i = j;
        continue;
      }
      if (name === "end") {
        blankRun(chars, i, j);
        i = consumeArgs(j, "all");
        continue;
      }

      // Blank the command token itself.
      blankRun(chars, i, j);
      if (
        OPAQUE_ARG_CMDS.has(name) ||
        /(?:^cite|cites?$)/iu.test(name)
      ) {
        i = consumeArgs(j, "all");
        continue;
      }
      if (FIRST_ARG_OPAQUE_CMDS.has(name)) {
        i = consumeOpaquePrefix(j, name);
        continue;
      }
      // Default: keep the (prose) arguments. Braces get blanked below; the text
      // between them survives so section titles, \textbf{…}, custom macros, etc.
      // are still checked.
      i = j;
      continue;
    }

    if (c === "$") {
      if (next === "$") {
        blankRun(chars, i, i + 2);
        math = 2;
        i += 2;
      } else {
        blankRun(chars, i, i + 1);
        math = 1;
        i++;
      }
      continue;
    }

    if (LATEX_SPECIAL.has(c)) {
      blankRun(chars, i, i + 1);
      i++;
      continue;
    }
    i++;
  }

  return chars.join("");
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
