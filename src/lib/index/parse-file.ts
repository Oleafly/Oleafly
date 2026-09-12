import type { FileSymbols, Sym, SymKind } from "./types";
import { parseTypstFile } from "./parse-typst";
import { parseMarkdownFile } from "./parse-markdown";

// `macrouse` uses are NOT resolved here; they need the project-wide macro set,
// which buildIndex adds in a second pass.

const SECTION_LEVEL: Record<string, number> = {
  part: 0,
  chapter: 1,
  section: 2,
  subsection: 3,
  subsubsection: 4,
  paragraph: 5,
  subparagraph: 6,
};

type SymSpan = {
  readonly from: number;
  readonly to: number;
  readonly nameFrom: number;
  readonly nameTo: number;
};

type SymSink = {
  readonly path: string;
  readonly text: string;
  readonly defs: Sym[];
  readonly uses: Sym[];
  readonly lineAt: (offset: number) => number;
};

export function maskComments(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      for (let i = 0; i < line.length; i++) {
        if (line[i] !== "%") continue;
        let b = 0;
        for (let j = i - 1; j >= 0 && line[j] === "\\"; j--) b++;
        if (b % 2 === 0) return line.slice(0, i) + " ".repeat(line.length - i);
      }
      return line;
    })
    .join("\n");
}

function matchBrace(text: string, openIdx: number): number {
  let depth = 0;
  for (let i = openIdx; i < text.length; i++) {
    const c = text[i];
    if (c === "\\") {
      i++;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function dirname(p: string): string {
  const i = p.lastIndexOf("/");
  return i >= 0 ? p.slice(0, i) : "";
}

function lastSegmentHasExtension(
  path: string,
  separators: readonly string[],
): boolean {
  let segmentStart = 0;
  for (const separator of separators) {
    segmentStart = Math.max(segmentStart, path.lastIndexOf(separator) + 1);
  }
  const dot = path.indexOf(".", segmentStart);
  return dot >= 0 && dot < path.length - 1;
}

function joinInput(dir: string, rel: string): string {
  let r = rel.replace(/^\.\//, "").trim();
  if (r.startsWith("/")) r = r.slice(1);
  const resolved = dir ? `${dir}/${r}` : r;
  return lastSegmentHasExtension(resolved, ["/", "\\"])
    ? resolved
    : `${resolved}.tex`;
}

// Precompute line starts for O(log n) line lookup.
function lineIndex(text: string): (offset: number) => number {
  const lineStarts: number[] = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") lineStarts.push(i + 1);
  return (offset: number): number => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
}

function pushSym(
  sink: SymSink,
  arr: Sym[],
  kind: SymKind,
  name: string,
  span: SymSpan,
  extra?: Partial<Sym>,
): void {
  arr.push({
    kind,
    name,
    file: sink.path,
    line: sink.lineAt(span.from),
    ...span,
    ...extra,
  });
}

function spanFromMatch(
  index: number,
  whole: string,
  nameFrom: number,
  nameLength: number,
): SymSpan {
  return {
    from: index,
    to: index + whole.length,
    nameFrom,
    nameTo: nameFrom + nameLength,
  };
}

function collectBibEntries(sink: SymSink): void {
  const re = /@(\w+)\s*\{\s*([^,\s}]+)/g;
  for (const m of sink.text.matchAll(re)) {
    const type = m[1].toLowerCase();
    if (type === "comment" || type === "string" || type === "preamble") continue;
    const key = m[2];
    const keyStart = m.index + m[0].lastIndexOf(key);
    pushSym(
      sink,
      sink.defs,
      "bibentry",
      key,
      spanFromMatch(m.index, m[0], keyStart, key.length),
    );
  }
}

// Sectioning. Match up to the opening brace, then brace-match so titles with
// nested braces (e.g. `\section{Intro to \texttt{x}}`) are captured whole.
function collectSections(sink: SymSink): void {
  const { text } = sink;
  const sec = /\\(part|chapter|section|subsection|subsubsection|paragraph|subparagraph)\*?\s*\{/g;
  for (let m = sec.exec(text); m; m = sec.exec(text)) {
    const open = m.index + m[0].length - 1;
    const close = matchBrace(text, open);
    if (close < 0) continue;
    const inner = text.slice(open + 1, close);
    const nameStart = open + 1;
    pushSym(
      sink,
      sink.defs,
      "section",
      inner.trim(),
      {
        from: m.index,
        to: close + 1,
        nameFrom: nameStart,
        nameTo: nameStart + inner.length,
      },
      { level: SECTION_LEVEL[m[1]] },
    );
    sec.lastIndex = close + 1; // resume scanning after this section's title
  }
}

function collectLabels(sink: SymSink): void {
  const label = /\\label\s*\{([^}]*)\}/g;
  for (const m of sink.text.matchAll(label)) {
    const start = m.index + m[0].lastIndexOf("{") + 1;
    pushSym(
      sink,
      sink.defs,
      "label",
      m[1].trim(),
      spanFromMatch(m.index, m[0], start, m[1].length),
    );
  }
}

// Macros: \newcommand / \renewcommand / \providecommand (braced or bare).
const MACRO_PATTERNS: readonly RegExp[] = [
  /\\(?:newcommand|renewcommand|providecommand)\*?\s*(?:\{\s*)?\\([a-zA-Z@]+)/g,
  /\\def\s*\\([a-zA-Z@]+)/g,
  /\\DeclareMathOperator\*?\s*\{\s*\\([a-zA-Z@]+)/g,
];

function collectMacroDefinitions(sink: SymSink): void {
  for (const re of MACRO_PATTERNS) {
    for (const m of sink.text.matchAll(re)) {
      const nameStart = m.index + m[0].lastIndexOf(`\\${m[1]}`) + 1;
      pushSym(
        sink,
        sink.defs,
        "macro",
        m[1],
        spanFromMatch(m.index, m[0], nameStart, m[1].length),
      );
    }
  }
}

// \bibitem is treated as an inline bib entry.
const BRACE_DEFINITIONS: readonly [RegExp, SymKind][] = [
  [/\\newtheorem\*?\s*\{([^}]*)\}/g, "theorem"],
  [/\\(?:newenvironment|renewenvironment)\s*\{([^}]*)\}/g, "environment"],
  [/\\newglossaryentry\s*\{([^}]*)\}/g, "glossary"],
  [/\\newacronym\s*(?:\[[^\]]*\]\s*)?\{([^}]*)\}/g, "glossary"],
  [/\\bibitem\s*(?:\[[^\]]*\]\s*)?\{([^}]*)\}/g, "bibentry"],
];

function collectBraceDefinitions(sink: SymSink): void {
  for (const [re, kind] of BRACE_DEFINITIONS) {
    for (const m of sink.text.matchAll(re)) {
      const start = m.index + m[0].lastIndexOf("{") + 1;
      pushSym(
        sink,
        sink.defs,
        kind,
        m[1].trim(),
        spanFromMatch(m.index, m[0], start, m[1].length),
      );
    }
  }
}

// Multi-key commands: \ref-family and \cite-family. One use per key.
function pushKeys(
  sink: SymSink,
  whole: string,
  wholeIdx: number,
  group: string,
  kind: SymKind,
): void {
  const keyBase = wholeIdx + whole.lastIndexOf("{") + 1;
  const partRe = /[^,]+/g;
  for (const pm of group.matchAll(partRe)) {
    const seg = pm[0];
    const key = seg.trim();
    if (!key || key === "*") continue;
    const lead = seg.length - seg.trimStart().length;
    const nameFrom = keyBase + pm.index + lead;
    pushSym(
      sink,
      sink.uses,
      kind,
      key,
      spanFromMatch(wholeIdx, whole, nameFrom, key.length),
    );
  }
}

const KEY_USE_PATTERNS: readonly [RegExp, SymKind][] = [
  [
    /\\(?:ref|eqref|autoref|cref|Cref|cpageref|pageref|vref|Vref|labelcref|nameref|namecref|fref|sref|labelref)\*?\s*\{([^}]*)\}/g,
    "ref",
  ],
  [
    /\\(?:cite|citep|citet|citeauthor|citeyear|citealt|parencite|textcite|autocite|nocite)\*?\s*(?:\[[^\]]*\]\s*)?\{([^}]*)\}/g,
    "cite",
  ],
];

function collectKeyUses(sink: SymSink): void {
  for (const [re, kind] of KEY_USE_PATTERNS) {
    for (const m of sink.text.matchAll(re)) {
      pushKeys(sink, m[0], m.index, m[1], kind);
    }
  }
}

const BRACE_USE_PATTERNS: readonly [RegExp, SymKind][] = [
  [
    /\\(?:gls|Gls|GLS|glspl|Glspl|acrshort|acrlong|acrfull|acs|acl|ac)\s*\{([^}]*)\}/g,
    "glossaryuse",
  ],
  [/\\begin\s*\{([^}]*)\}/g, "envuse"],
];

function collectBraceUses(sink: SymSink): void {
  for (const [re, kind] of BRACE_USE_PATTERNS) {
    for (const m of sink.text.matchAll(re)) {
      const start = m.index + m[0].lastIndexOf("{") + 1;
      pushSym(
        sink,
        sink.uses,
        kind,
        m[1].trim(),
        spanFromMatch(m.index, m[0], start, m[1].length),
      );
    }
  }
}

function collectInputEdges(sink: SymSink, dir: string): void {
  const input = /\\(?:input|include)\s*\{([^}]*)\}/g;
  for (const m of sink.text.matchAll(input)) {
    const start = m.index + m[0].lastIndexOf("{") + 1;
    const raw = m[1].trim();
    pushSym(
      sink,
      sink.uses,
      "inputedge",
      raw,
      spanFromMatch(m.index, m[0], start, m[1].length),
      { target: joinInput(dir, raw) },
    );
  }
}

export function parseFile(path: string, rawText: string): FileSymbols {
  if (path.toLowerCase().endsWith(".typ")) return parseTypstFile(path, rawText);
  if (/\.(?:md|markdown)$/i.test(path)) return parseMarkdownFile(path, rawText);
  const text = maskComments(rawText);
  const defs: Sym[] = [];
  const uses: Sym[] = [];
  const sink: SymSink = { path, text, defs, uses, lineAt: lineIndex(text) };

  if (path.endsWith(".bib")) {
    collectBibEntries(sink);
    return { file: path, defs, uses };
  }

  collectSections(sink);
  collectLabels(sink);
  collectMacroDefinitions(sink);
  collectBraceDefinitions(sink);
  collectKeyUses(sink);
  collectBraceUses(sink);
  collectInputEdges(sink, dirname(path));

  return { file: path, defs, uses };
}
