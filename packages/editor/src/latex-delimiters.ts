export type LatexDelimiterRole = "open" | "close" | "middle";

export interface LatexDelimiterSize {
  readonly open: string;
  readonly close: string;
  readonly middle: string | null;
  readonly nullDelimiters: boolean;
}

export interface LatexDelimiterGlyph {
  readonly open: string;
  readonly close: string;
  readonly trigger: string | null;
  readonly escaped: boolean;
  readonly standalone: boolean;
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

function symmetric(name: string): LatexDelimiterGlyph {
  return glyph(name, name, { separator: true });
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
  glyph(String.raw`\lfloor`, String.raw`\rfloor`, { standalone: true }),
  glyph(String.raw`\lceil`, String.raw`\rceil`, { standalone: true }),
  glyph(String.raw`\lbrace`, String.raw`\rbrace`, { standalone: true }),
  glyph(String.raw`\lbrack`, String.raw`\rbrack`, { standalone: true }),
  glyph(String.raw`\lgroup`, String.raw`\rgroup`, { standalone: true }),
  glyph(String.raw`\lmoustache`, String.raw`\rmoustache`, { standalone: true }),
  glyph(String.raw`\ulcorner`, String.raw`\urcorner`, { standalone: true }),
  glyph(String.raw`\llcorner`, String.raw`\lrcorner`, { standalone: true }),
  symmetric(String.raw`\vert`),
  symmetric(String.raw`\Vert`),
  symmetric("/"),
  symmetric(String.raw`\backslash`),
  symmetric(String.raw`\uparrow`),
  symmetric(String.raw`\downarrow`),
  symmetric(String.raw`\updownarrow`),
  symmetric(String.raw`\Uparrow`),
  symmetric(String.raw`\Downarrow`),
  symmetric(String.raw`\Updownarrow`),
  symmetric(String.raw`\arrowvert`),
  symmetric(String.raw`\Arrowvert`),
  symmetric(String.raw`\bracevert`),
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

const GLYPH_BY_OPEN: ReadonlyMap<string, LatexDelimiterGlyph> = new Map(
  LATEX_DELIMITER_GLYPHS.map((entry) => [entry.open, entry]),
);

const GLYPH_BY_CLOSE: ReadonlyMap<string, LatexDelimiterGlyph> = new Map(
  LATEX_DELIMITER_GLYPHS.filter((entry) => entry.open !== entry.close).map(
    (entry) => [entry.close, entry],
  ),
);

const RUN_LIMIT = 64;

function backslashIsEscaped(text: string, index: number): boolean {
  let run = 0;
  while (run < index && text[index - 1 - run] === "\\") run += 1;
  return run % 2 === 1;
}

export interface LatexDelimiterPrefixMatch {
  readonly size: LatexDelimiterSize;
  readonly role: LatexDelimiterRole;
  readonly command: string;
  readonly length: number;
  readonly escapedSlash: boolean;
}

const PREFIX_BEFORE = /\\([A-Za-z]+)[ \t]*(\\?)$/u;

export function latexDelimiterPrefixBefore(
  text: string,
): LatexDelimiterPrefixMatch | null {
  const match = PREFIX_BEFORE.exec(text);
  if (!match) return null;
  const entry = SIZE_BY_COMMAND.get(match[1]);
  if (!entry || backslashIsEscaped(text, match.index)) return null;
  return {
    size: entry.size,
    role: entry.role,
    command: match[1],
    length: match[0].length,
    escapedSlash: match[2] === "\\",
  };
}

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

const CLOSING_WORDS: ReadonlySet<string> = new Set(
  LATEX_DELIMITER_GLYPHS.flatMap((entry) =>
    /^\\[A-Za-z]+$/u.test(entry.close) ? [entry.close.slice(1)] : [],
  ),
);

const CLOSES_AHEAD = /^\\(?:([A-Za-z]+)|[\])}|\\])/u;

export function latexDelimiterClosesAhead(after: string): boolean {
  const match = CLOSES_AHEAD.exec(after);
  if (!match) return false;
  const word = match[1];
  if (word === undefined) return true;
  const entry = SIZE_BY_COMMAND.get(word);
  if (entry) return entry.role !== "open" || entry.size.open === entry.size.close;
  return CLOSING_WORDS.has(word);
}

export function latexDelimiterTakesPartner(
  size: LatexDelimiterSize,
  entry: LatexDelimiterGlyph,
): boolean {
  return size.open !== size.close || entry.open !== entry.close;
}

export interface LatexDelimiterCloser {
  readonly command: string;
  readonly glyph: string;
}

export function latexDelimiterCloserText(closer: LatexDelimiterCloser): string {
  return closer.command ? `\\${closer.command}${closer.glyph}` : closer.glyph;
}

export function latexDelimiterCloserFor(
  size: LatexDelimiterSize,
  entry: LatexDelimiterGlyph,
): LatexDelimiterCloser {
  return { command: size.close, glyph: entry.close };
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
  return latexDelimiterCloserText(latexDelimiterCloserFor(size, entry));
}

const ESCAPED_GLYPH = /^\\[^A-Za-z]$/u;

function endsWithUnescaped(text: string, suffix: string): boolean {
  if (!text.endsWith(suffix)) return false;
  const start = text.length - suffix.length;
  return !suffix.startsWith("\\") || !backslashIsEscaped(text, start);
}

function glyphAt(body: string, index: number, glyph: string): boolean {
  if (backslashIsEscaped(body, index)) return false;
  if (!/^\\[A-Za-z]+$/u.test(glyph)) return true;
  const next = body[index + glyph.length];
  return next === undefined || !/[A-Za-z]/u.test(next);
}

function countGlyph(body: string, glyph: string): number {
  let count = 0;
  for (
    let index = body.indexOf(glyph);
    index >= 0;
    index = body.indexOf(glyph, index + 1)
  ) {
    if (glyphAt(body, index, glyph)) count += 1;
  }
  return count;
}

export function latexDelimiterUnclosedInside(
  body: string,
  closer: LatexDelimiterCloser,
): boolean {
  const entry = GLYPH_BY_CLOSE.get(closer.glyph);
  if (!entry) return false;
  return countGlyph(body, entry.open) > countGlyph(body, entry.close);
}

function spelledConsumption(
  before: string,
  typed: string,
  closer: LatexDelimiterCloser,
  prefix: LatexDelimiterPrefixMatch,
): number | null {
  const spelled = before
    .slice(before.length - prefix.length)
    .replace(/[ \t]+/gu, "");
  const matches =
    prefix.command === closer.command &&
    spelled + typed === latexDelimiterCloserText(closer);
  return matches ? prefix.length : null;
}

function glyphForms(closer: LatexDelimiterCloser): string[] {
  const forms = [latexDelimiterCloserText(closer), closer.glyph];
  if (ESCAPED_GLYPH.test(closer.glyph)) forms.push(closer.glyph.slice(1));
  return forms;
}

function bareConsumption(before: string, closer: LatexDelimiterCloser): number | null {
  const literalEscape =
    !ESCAPED_GLYPH.test(closer.glyph) &&
    backslashIsEscaped(before, before.length);
  return literalEscape ? null : 0;
}

function glyphConsumption(
  before: string,
  body: string,
  closer: LatexDelimiterCloser,
): number | null {
  const text = latexDelimiterCloserText(closer);
  for (const form of glyphForms(closer)) {
    if (form !== text && latexDelimiterUnclosedInside(body, closer)) return null;
    const spelled = form.slice(0, -1);
    if (spelled.length === 0) return bareConsumption(before, closer);
    if (endsWithUnescaped(before, spelled)) return spelled.length;
  }
  return null;
}

export function latexDelimiterCloserConsumption(
  body: string,
  typed: string,
  closer: LatexDelimiterCloser,
): number | null {
  if (typed.length !== 1 || !latexDelimiterCloserText(closer).endsWith(typed)) {
    return null;
  }
  const before = body.length > RUN_LIMIT ? body.slice(-RUN_LIMIT) : body;
  const prefix = latexDelimiterPrefixBefore(before);
  return prefix
    ? spelledConsumption(before, typed, closer, prefix)
    : glyphConsumption(before, body, closer);
}

export interface LatexEmptyDelimiterPair {
  readonly opener: number;
  readonly closer: number;
}

const OPENER_BEFORE =
  /\\([A-Za-z]+)[ \t]*(\\[A-Za-z]+|\\[^A-Za-z\s]|[^A-Za-z\s\\])$/u;

const STANDALONE_BEFORE = /\\[A-Za-z]+$/u;

function sizedClosing(size: LatexDelimiterSize, open: string): string | null {
  if (open === NULL_GLYPH) {
    return size.nullDelimiters ? `\\${size.close}${NULL_GLYPH}` : null;
  }
  const entry = GLYPH_BY_OPEN.get(open);
  if (!entry || !latexDelimiterTakesPartner(size, entry)) return null;
  return latexDelimiterClosing(size, entry);
}

export function latexEmptyDelimiterPairAt(
  before: string,
  after: string,
): LatexEmptyDelimiterPair | null {
  const sized = OPENER_BEFORE.exec(before);
  if (sized && !backslashIsEscaped(before, sized.index)) {
    const entry = SIZE_BY_COMMAND.get(sized[1]);
    const closing =
      entry?.role === "open" ? sizedClosing(entry.size, sized[2]) : null;
    if (closing && after.startsWith(closing)) {
      return { opener: sized[0].length, closer: closing.length };
    }
  }
  const standalone = STANDALONE_BEFORE.exec(before);
  if (standalone && !backslashIsEscaped(before, standalone.index)) {
    const entry = GLYPH_BY_OPEN.get(standalone[0]);
    if (entry?.standalone && after.startsWith(entry.close)) {
      return { opener: entry.open.length, closer: entry.close.length };
    }
  }
  return null;
}

export type LatexDelimiterCompletionSpec =
  | {
      readonly kind: "pair";
      readonly label: string;
      readonly detail: string;
      readonly closer: LatexDelimiterCloser;
    }
  | {
      readonly kind: "closer";
      readonly label: string;
      readonly detail: string;
      readonly closer: LatexDelimiterCloser;
    }
  | { readonly kind: "plain"; readonly label: string; readonly detail: string };

const ELLIPSIS = " ... ";

export function latexSnippetLiteral(text: string): string {
  return text.replace(/\\([{}])/gu, String.raw`\\$1`);
}

function pairDetail(opening: string, closing: string): string {
  return `${opening}${ELLIPSIS}${closing}`;
}

function pairSpec(
  opening: string,
  closer: LatexDelimiterCloser,
): LatexDelimiterCompletionSpec {
  return {
    kind: "pair",
    label: opening,
    detail: pairDetail(opening, latexDelimiterCloserText(closer)),
    closer,
  };
}

function closerSpec(
  opening: string,
  closer: LatexDelimiterCloser,
): LatexDelimiterCompletionSpec {
  const closing = latexDelimiterCloserText(closer);
  return { kind: "closer", label: closing, detail: pairDetail(opening, closing), closer };
}

function plainSpec(label: string, detail: string): LatexDelimiterCompletionSpec {
  return { kind: "plain", label, detail };
}

function openingSpec(
  size: LatexDelimiterSize,
  entry: LatexDelimiterGlyph,
): LatexDelimiterCompletionSpec {
  const opening = latexDelimiterOpening(size, entry);
  return latexDelimiterTakesPartner(size, entry)
    ? pairSpec(opening, latexDelimiterCloserFor(size, entry))
    : plainSpec(opening, opening);
}

function closingSpec(
  size: LatexDelimiterSize,
  entry: LatexDelimiterGlyph,
): LatexDelimiterCompletionSpec {
  return closerSpec(
    latexDelimiterOpening(size, entry),
    latexDelimiterCloserFor(size, entry),
  );
}

function separatorSpec(
  size: LatexDelimiterSize,
  entry: LatexDelimiterGlyph,
): LatexDelimiterCompletionSpec | null {
  if (!size.middle || !entry.separator) return null;
  const separator = `\\${size.middle}${entry.open}`;
  return plainSpec(
    separator,
    `${latexDelimiterOpening(size, entry)}${ELLIPSIS}${separator}` +
      `${ELLIPSIS}${latexDelimiterClosing(size, entry)}`,
  );
}

function nullDelimiterSpec(
  size: LatexDelimiterSize,
  role: "open" | "close",
): LatexDelimiterCompletionSpec {
  const opening = `\\${size.open}${NULL_GLYPH}`;
  const closer = { command: size.close, glyph: NULL_GLYPH };
  return role === "open" ? pairSpec(opening, closer) : closerSpec(opening, closer);
}

export function latexDelimiterFamilySpecs(
  match: Pick<LatexDelimiterPrefixMatch, "size" | "role">,
): LatexDelimiterCompletionSpec[] {
  const { size, role } = match;
  if (role === "middle") {
    return LATEX_DELIMITER_GLYPHS.flatMap(
      (entry) => separatorSpec(size, entry) ?? [],
    );
  }
  const build = role === "open" ? openingSpec : closingSpec;
  const specs = LATEX_DELIMITER_GLYPHS.map((entry) => build(size, entry));
  if (size.nullDelimiters) specs.push(nullDelimiterSpec(size, role));
  return specs;
}

function standaloneSpecs(): LatexDelimiterCompletionSpec[] {
  return LATEX_DELIMITER_GLYPHS.filter((entry) => entry.standalone).flatMap(
    (entry) => {
      const closer = { command: "", glyph: entry.close };
      return [pairSpec(entry.open, closer), closerSpec(entry.open, closer)];
    },
  );
}

function bareSizeSpecs(): LatexDelimiterCompletionSpec[] {
  return LATEX_DELIMITER_SIZES.flatMap((size) => {
    const opening = `\\${size.open}`;
    const closing = `\\${size.close}`;
    const detail = pairDetail(`${opening}(`, `${closing})`);
    const specs = [plainSpec(opening, detail)];
    if (closing !== opening) specs.push(plainSpec(closing, detail));
    if (size.middle) {
      specs.push(
        plainSpec(
          `\\${size.middle}`,
          `${opening}(${ELLIPSIS}\\${size.middle}|${ELLIPSIS}${closing})`,
        ),
      );
    }
    return specs;
  });
}

function uniqueByLabel(
  specs: readonly LatexDelimiterCompletionSpec[],
): LatexDelimiterCompletionSpec[] {
  const seen = new Set<string>();
  return specs.filter((spec) => {
    if (seen.has(spec.label)) return false;
    seen.add(spec.label);
    return true;
  });
}

const ROLES: readonly LatexDelimiterRole[] = ["open", "close", "middle"];

export const LATEX_DELIMITER_COMPLETIONS: readonly LatexDelimiterCompletionSpec[] =
  uniqueByLabel([
    ...LATEX_DELIMITER_SIZES.flatMap((size) =>
      ROLES.flatMap((role) => latexDelimiterFamilySpecs({ size, role })),
    ),
    ...standaloneSpecs(),
    ...bareSizeSpecs(),
  ]);
