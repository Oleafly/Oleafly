/**
 * Semantic LaTeX delimiter registry.
 *
 * A single pair of tables — sizes crossed with glyphs — is the one source of
 * truth for typed auto-pairing, completion, closer overtyping and backspace
 * cleanup, so every consumer agrees on which opener matches which closer.
 *
 * Everything here operates on plain strings rather than editor state, which
 * keeps the registry free of CodeMirror imports and directly testable.
 */

export type LatexDelimiterRole = "open" | "close" | "middle";

export interface LatexDelimiterSize {
  /** Control word introducing the opening delimiter, e.g. `left`. */
  readonly open: string;
  /** Control word introducing the closing delimiter, e.g. `right`. */
  readonly close: string;
  /** Control word introducing an interior separator, or null when none. */
  readonly middle: string | null;
  /** Whether `.` is meaningful here, as in `\left. ... \right)`. */
  readonly nullDelimiters: boolean;
}

export interface LatexDelimiterGlyph {
  /** Opening glyph as written after a size command, e.g. `(` or `\langle`. */
  readonly open: string;
  /** Closing glyph that matches `open`, e.g. `)` or `\rangle`. */
  readonly close: string;
  /**
   * Character whose insertion auto-pairs this glyph, or null when the glyph is
   * a control word and only completion can offer it.
   */
  readonly trigger: string | null;
  /** Whether `trigger` must follow a backslash, as `{` does in `\{`. */
  readonly escaped: boolean;
  /** Whether the glyph also pairs without a size command. */
  readonly standalone: boolean;
  /** Whether the glyph reads as an interior separator after `\middle`. */
  readonly separator: boolean;
}

export const LATEX_DELIMITER_SIZES: readonly LatexDelimiterSize[] = [
  { open: "left", close: "right", middle: "middle", nullDelimiters: true },
  { open: "bigl", close: "bigr", middle: "bigm", nullDelimiters: false },
  { open: "Bigl", close: "Bigr", middle: "Bigm", nullDelimiters: false },
  { open: "biggl", close: "biggr", middle: "biggm", nullDelimiters: false },
  { open: "Biggl", close: "Biggr", middle: "Biggm", nullDelimiters: false },
  { open: "big", close: "big", middle: null, nullDelimiters: false },
  { open: "Big", close: "Big", middle: null, nullDelimiters: false },
  { open: "bigg", close: "bigg", middle: null, nullDelimiters: false },
  { open: "Bigg", close: "Bigg", middle: null, nullDelimiters: false },
];

function glyph(
  open: string,
  close: string,
  extra: Partial<Omit<LatexDelimiterGlyph, "open" | "close">> = {},
): LatexDelimiterGlyph {
  return {
    open,
    close,
    trigger: extra.trigger ?? null,
    escaped: extra.escaped ?? false,
    standalone: extra.standalone ?? false,
    separator: extra.separator ?? false,
  };
}

export const LATEX_DELIMITER_GLYPHS: readonly LatexDelimiterGlyph[] = [
  glyph("(", ")", { trigger: "(" }),
  glyph("[", "]", { trigger: "[" }),
  glyph(String.raw`\{`, String.raw`\}`, { trigger: "{", escaped: true }),
  glyph("<", ">", { trigger: "<" }),
  glyph("|", "|", { trigger: "|", separator: true }),
  glyph(String.raw`\|`, String.raw`\|`, {
    trigger: "|",
    escaped: true,
    separator: true,
  }),
  glyph(String.raw`\langle`, String.raw`\rangle`, { standalone: true }),
  glyph(String.raw`\lvert`, String.raw`\rvert`, { standalone: true }),
  glyph(String.raw`\lVert`, String.raw`\rVert`, { standalone: true }),
  glyph(String.raw`\vert`, String.raw`\vert`, { separator: true }),
  glyph(String.raw`\Vert`, String.raw`\Vert`, { separator: true }),
  glyph(String.raw`\lfloor`, String.raw`\rfloor`, { standalone: true }),
  glyph(String.raw`\lceil`, String.raw`\rceil`, { standalone: true }),
  glyph(String.raw`\lbrace`, String.raw`\rbrace`, { standalone: true }),
  glyph(String.raw`\lbrack`, String.raw`\rbrack`, { standalone: true }),
  glyph(String.raw`\lgroup`, String.raw`\rgroup`, { standalone: true }),
  glyph(String.raw`\lmoustache`, String.raw`\rmoustache`, { standalone: true }),
  glyph(String.raw`\ulcorner`, String.raw`\urcorner`, { standalone: true }),
  glyph(String.raw`\llcorner`, String.raw`\lrcorner`, { standalone: true }),
  glyph("/", "/", { separator: true }),
  glyph(String.raw`\backslash`, String.raw`\backslash`, { separator: true }),
];

const NULL_GLYPH = ".";

interface SizeRole {
  readonly size: LatexDelimiterSize;
  readonly role: LatexDelimiterRole;
}

const SIZE_BY_COMMAND: ReadonlyMap<string, SizeRole> = (() => {
  const table = new Map<string, SizeRole>();
  for (const size of LATEX_DELIMITER_SIZES) {
    table.set(size.open, { size, role: "open" });
    if (!table.has(size.close)) table.set(size.close, { size, role: "close" });
    if (size.middle) table.set(size.middle, { size, role: "middle" });
  }
  return table;
})();

/** Whether the backslash starting at `index` is itself escaped. */
function backslashIsEscaped(text: string, index: number): boolean {
  let run = 0;
  while (run < index && text[index - 1 - run] === "\\") run += 1;
  return run % 2 === 1;
}

export interface LatexDelimiterPrefixMatch {
  readonly size: LatexDelimiterSize;
  readonly role: LatexDelimiterRole;
  /** The matched control word, e.g. `left`. */
  readonly command: string;
  /** Characters the match consumes, counting a trailing backslash. */
  readonly length: number;
  /** Whether the match ends in the backslash that starts an escaped glyph. */
  readonly escapedSlash: boolean;
}

const PREFIX_BEFORE = /\\([A-Za-z]+)(\\?)$/u;

/**
 * Reads the size command immediately before the cursor. `text` is the document
 * slice ending at the cursor; a trailing backslash is reported separately so
 * callers can tell `\left` from `\left\`.
 */
export function latexDelimiterPrefixBefore(
  text: string,
): LatexDelimiterPrefixMatch | null {
  const match = PREFIX_BEFORE.exec(text);
  if (!match) return null;
  const entry = SIZE_BY_COMMAND.get(match[1]);
  if (!entry) return null;
  if (backslashIsEscaped(text, match.index)) return null;
  return {
    size: entry.size,
    role: entry.role,
    command: match[1],
    length: match[0].length,
    escapedSlash: match[2] === "\\",
  };
}

/** The glyph a typed character opens, honouring whether a backslash precedes it. */
export function latexDelimiterGlyphForTrigger(
  character: string,
  escaped: boolean,
): LatexDelimiterGlyph | null {
  return (
    LATEX_DELIMITER_GLYPHS.find(
      (entry) => entry.trigger === character && entry.escaped === escaped,
    ) ?? null
  );
}

/** The glyph a typed character closes, for overtyping an auto-inserted closer. */
export function latexDelimiterGlyphForClosingTrigger(
  character: string,
): LatexDelimiterGlyph | null {
  return (
    LATEX_DELIMITER_GLYPHS.find(
      (entry) =>
        !entry.escaped && entry.trigger !== null && entry.close === character,
    ) ?? null
  );
}

export function latexDelimiterOpening(
  size: LatexDelimiterSize,
  entry: LatexDelimiterGlyph,
): string {
  return `\\${size.open}${entry.open}`;
}

export function latexDelimiterClosing(
  size: LatexDelimiterSize,
  entry: LatexDelimiterGlyph,
): string {
  return `\\${size.close}${entry.close}`;
}

/**
 * Length of the sized closer starting `text`, for the given glyph. Used to
 * step the cursor over a closer the editor inserted rather than duplicating it.
 */
export function latexDelimiterCloserAt(
  text: string,
  entry: LatexDelimiterGlyph,
): number | null {
  for (const size of LATEX_DELIMITER_SIZES) {
    const closer = latexDelimiterClosing(size, entry);
    if (text.startsWith(closer)) return closer.length;
  }
  return null;
}

export interface LatexEmptyDelimiterPair {
  readonly open: number;
  readonly close: number;
}

/**
 * Measures an empty semantic pair straddling the cursor, so backspacing the
 * opener can take its closer with it. `before` ends at the cursor and `after`
 * starts there.
 */
function straddlesCursor(
  before: string,
  after: string,
  open: string,
  close: string,
): boolean {
  return (
    before.endsWith(open) &&
    after.startsWith(close) &&
    !backslashIsEscaped(before, before.length - open.length)
  );
}

export function latexEmptyDelimiterPairAt(
  before: string,
  after: string,
): LatexEmptyDelimiterPair | null {
  for (const size of LATEX_DELIMITER_SIZES) {
    for (const entry of LATEX_DELIMITER_GLYPHS) {
      const open = latexDelimiterOpening(size, entry);
      const close = latexDelimiterClosing(size, entry);
      if (straddlesCursor(before, after, open, close)) {
        return { open: open.length, close: close.length };
      }
    }
  }
  for (const entry of LATEX_DELIMITER_GLYPHS) {
    if (
      entry.standalone &&
      straddlesCursor(before, after, entry.open, entry.close)
    ) {
      return { open: entry.open.length, close: entry.close.length };
    }
  }
  return null;
}

/**
 * A completion the registry contributes. `template` uses the CodeMirror
 * snippet grammar; a null template means the label inserts verbatim, which is
 * how separators and bare closers stay free of a partner they must not have.
 */
export interface LatexDelimiterCompletionSpec {
  readonly label: string;
  readonly detail: string;
  readonly template: string | null;
}

const HOLE = "${1}";

const ELLIPSIS = " ... ";

/**
 * CodeMirror's snippet grammar reads `\{` and `\}` as escaped braces and drops
 * the backslash, so a LaTeX brace delimiter has to arrive doubled to survive
 * parsing. Labels and details stay unescaped: they are read, not inserted.
 */
export function latexSnippetLiteral(text: string): string {
  return text.replace(/\\([{}])/gu, String.raw`\\$1`);
}

function pairDetail(opening: string, closing: string): string {
  return `${opening}${ELLIPSIS}${closing}`;
}

function openingSpec(
  size: LatexDelimiterSize,
  entry: LatexDelimiterGlyph,
): LatexDelimiterCompletionSpec {
  const opening = latexDelimiterOpening(size, entry);
  const closing = latexDelimiterClosing(size, entry);
  return {
    label: opening,
    detail: pairDetail(opening, closing),
    template: latexSnippetLiteral(`${opening}${HOLE}${closing}`),
  };
}

function closingSpec(
  size: LatexDelimiterSize,
  entry: LatexDelimiterGlyph,
): LatexDelimiterCompletionSpec {
  return {
    label: latexDelimiterClosing(size, entry),
    detail: pairDetail(
      latexDelimiterOpening(size, entry),
      latexDelimiterClosing(size, entry),
    ),
    template: null,
  };
}

function separatorSpec(
  size: LatexDelimiterSize,
  entry: LatexDelimiterGlyph,
): LatexDelimiterCompletionSpec | null {
  if (!size.middle || !entry.separator) return null;
  const separator = `\\${size.middle}${entry.open}`;
  return {
    label: separator,
    detail:
      `${latexDelimiterOpening(size, entry)}${ELLIPSIS}${separator}` +
      `${ELLIPSIS}${latexDelimiterClosing(size, entry)}`,
    template: null,
  };
}

function nullDelimiterSpecs(
  size: LatexDelimiterSize,
): LatexDelimiterCompletionSpec[] {
  if (!size.nullDelimiters) return [];
  const opening = `\\${size.open}${NULL_GLYPH}`;
  const closing = `\\${size.close}${NULL_GLYPH}`;
  return [
    {
      label: opening,
      detail: pairDetail(opening, closing),
      template: latexSnippetLiteral(`${opening}${HOLE}${closing}`),
    },
    { label: closing, detail: pairDetail(opening, closing), template: null },
  ];
}

function standaloneSpecs(): LatexDelimiterCompletionSpec[] {
  const specs: LatexDelimiterCompletionSpec[] = [];
  for (const entry of LATEX_DELIMITER_GLYPHS) {
    if (!entry.open.startsWith("\\")) continue;
    specs.push(
      entry.standalone
        ? {
            label: entry.open,
            detail: pairDetail(entry.open, entry.close),
            template: latexSnippetLiteral(`${entry.open}${HOLE}${entry.close}`),
          }
        : { label: entry.open, detail: entry.open, template: null },
    );
    if (entry.close !== entry.open && entry.close.startsWith("\\")) {
      specs.push({
        label: entry.close,
        detail: pairDetail(entry.open, entry.close),
        template: null,
      });
    }
  }
  return specs;
}

function bareSizeSpecs(): LatexDelimiterCompletionSpec[] {
  const specs: LatexDelimiterCompletionSpec[] = [];
  for (const size of LATEX_DELIMITER_SIZES) {
    const opening = `\\${size.open}`;
    const closing = `\\${size.close}`;
    specs.push({
      label: opening,
      detail: pairDetail(`${opening}(`, `${closing})`),
      template: null,
    });
    if (closing !== opening) {
      specs.push({
        label: closing,
        detail: pairDetail(`${opening}(`, `${closing})`),
        template: null,
      });
    }
    if (size.middle) {
      specs.push({
        label: `\\${size.middle}`,
        detail:
          `${opening}(${ELLIPSIS}\\${size.middle}|` +
          `${ELLIPSIS}${closing})`,
        template: null,
      });
    }
  }
  return specs;
}

/** Every delimiter completion for a size command, by role. */
export function latexDelimiterFamilySpecs(
  match: Pick<LatexDelimiterPrefixMatch, "size" | "role">,
): LatexDelimiterCompletionSpec[] {
  const { size, role } = match;
  if (role === "middle") {
    return LATEX_DELIMITER_GLYPHS.map((entry) =>
      separatorSpec(size, entry),
    ).filter((spec): spec is LatexDelimiterCompletionSpec => spec !== null);
  }
  const build = role === "open" ? openingSpec : closingSpec;
  const specs = LATEX_DELIMITER_GLYPHS.map((entry) => build(size, entry));
  const nulls = nullDelimiterSpecs(size);
  return [
    ...specs,
    ...(role === "open" ? nulls.slice(0, 1) : nulls.slice(1)),
  ];
}

let allSpecs: LatexDelimiterCompletionSpec[] | null = null;

/**
 * The whole registry as completions, for the dropdown a user reaches by typing
 * a command prefix such as `\lef`. Built once; the tables never change.
 */
export function latexDelimiterCompletionSpecs(): readonly LatexDelimiterCompletionSpec[] {
  allSpecs ??= (() => {
    const specs: LatexDelimiterCompletionSpec[] = [];
    for (const size of LATEX_DELIMITER_SIZES) {
      for (const role of ["open", "close", "middle"] as const) {
        specs.push(...latexDelimiterFamilySpecs({ size, role }));
      }
    }
    specs.push(...standaloneSpecs(), ...bareSizeSpecs());
    const seen = new Set<string>();
    return specs.filter((spec) => {
      if (seen.has(spec.label)) return false;
      seen.add(spec.label);
      return true;
    });
  })();
  return allSpecs;
}

/**
 * Math and definition commands with deterministic argument shapes. Labels
 * carry the shape the way the generated corpus does, so the two lists read
 * alike in one dropdown; the corpus wins on any label it also supplies.
 */
export function latexMathCommandSpecs(): readonly LatexDelimiterCompletionSpec[] {
  mathSpecs ??= MATH_COMMAND_SPECS.map((spec) => ({
    ...spec,
    template: spec.template === null ? null : latexSnippetLiteral(spec.template),
  }));
  return mathSpecs;
}

let mathSpecs: LatexDelimiterCompletionSpec[] | null = null;

const MATH_COMMAND_SPECS: readonly LatexDelimiterCompletionSpec[] = [
  { label: String.raw`\dfrac{}{}`, detail: String.raw`\dfrac{num}{den}`, template: "\\dfrac{${1}}{${2}}" },
  { label: String.raw`\tfrac{}{}`, detail: String.raw`\tfrac{num}{den}`, template: "\\tfrac{${1}}{${2}}" },
  { label: String.raw`\binom{}{}`, detail: String.raw`\binom{n}{k}`, template: "\\binom{${1}}{${2}}" },
  { label: String.raw`\dbinom{}{}`, detail: String.raw`\dbinom{n}{k}`, template: "\\dbinom{${1}}{${2}}" },
  { label: String.raw`\tbinom{}{}`, detail: String.raw`\tbinom{n}{k}`, template: "\\tbinom{${1}}{${2}}" },
  {
    label: String.raw`\genfrac{}{}{}{}{}{}`,
    detail: String.raw`\genfrac{left}{right}{thickness}{style}{num}{den}`,
    template:
      "\\genfrac{${1:left}}{${2:right}}{${3:thickness}}" +
      "{${4:style}}{${5:num}}{${6:den}}",
  },
  {
    label: String.raw`\substack{}`,
    detail: String.raw`\substack{first \\ second}`,
    template: "\\substack{${1:first} \\\\ ${2:second}}",
  },
  { label: String.raw`\overset{}{}`, detail: String.raw`\overset{above}{base}`, template: "\\overset{${1:above}}{${2:base}}" },
  { label: String.raw`\underset{}{}`, detail: String.raw`\underset{below}{base}`, template: "\\underset{${1:below}}{${2:base}}" },
  {
    label: String.raw`\DeclareMathOperator{}{}`,
    detail: String.raw`\DeclareMathOperator{\cmd}{name}`,
    template: "\\DeclareMathOperator{${1:\\cmd}}{${2:name}}",
  },
  {
    label: String.raw`\DeclareMathOperator*{}{}`,
    detail: String.raw`\DeclareMathOperator*{\cmd}{name}`,
    template: "\\DeclareMathOperator*{${1:\\cmd}}{${2:name}}",
  },
  {
    label: String.raw`\DeclarePairedDelimiter{}{}{}`,
    detail: String.raw`\DeclarePairedDelimiter{\cmd}{left}{right}`,
    template:
      "\\DeclarePairedDelimiter{${1:\\cmd}}{${2:\\lvert}}{${3:\\rvert}}",
  },
  {
    label: String.raw`\providecommand{}{}`,
    detail: String.raw`\providecommand{\cmd}{definition}`,
    template: "\\providecommand{${1:\\cmd}}{${2:definition}}",
  },
  {
    label: String.raw`\providecommand{}[]{}`,
    detail: String.raw`\providecommand{\cmd}[args]{definition}`,
    template: "\\providecommand{${1:\\cmd}}[${2:args}]{${3:definition}}",
  },
  {
    label: String.raw`\NewDocumentCommand{}{}{}`,
    detail: String.raw`\NewDocumentCommand{\cmd}{argument spec}{definition}`,
    template: "\\NewDocumentCommand{${1:\\cmd}}{${2:m}}{${3:definition}}",
  },
  {
    label: String.raw`\RenewDocumentCommand{}{}{}`,
    detail: String.raw`\RenewDocumentCommand{\cmd}{argument spec}{definition}`,
    template: "\\RenewDocumentCommand{${1:\\cmd}}{${2:m}}{${3:definition}}",
  },
  {
    label: String.raw`\DeclareDocumentCommand{}{}{}`,
    detail: String.raw`\DeclareDocumentCommand{\cmd}{argument spec}{definition}`,
    template: "\\DeclareDocumentCommand{${1:\\cmd}}{${2:m}}{${3:definition}}",
  },
  {
    label: String.raw`\NewDocumentEnvironment{}{}{}{}`,
    detail: String.raw`\NewDocumentEnvironment{name}{argument spec}{begin}{end}`,
    template:
      "\\NewDocumentEnvironment{${1:name}}{${2:m}}{${3:begin}}{${4:end}}",
  },
  {
    label: String.raw`\DeclareDocumentEnvironment{}{}{}{}`,
    detail: String.raw`\DeclareDocumentEnvironment{name}{argument spec}{begin}{end}`,
    template:
      "\\DeclareDocumentEnvironment{${1:name}}{${2:m}}{${3:begin}}{${4:end}}",
  },
];
