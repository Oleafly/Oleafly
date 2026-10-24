/**
 * Source text the way it reads in the PDF, with a map back to source offsets.
 *
 * Words are matched between the PDF and the source in both sync directions.
 * The PDF shows "café" where the source may say `caf\'e`, and composed
 * characters where the source has a base letter and a combining mark.
 */

/** `[source offset, rendered offset]` pairs, both increasing. */
export type OffsetPairs = [number, number][];

export interface RenderedText {
  text: string;
  /** Null when `text` is the source unchanged. */
  offsets: OffsetPairs | null;
}

/** The source offset of an offset into `rendered.text`. */
export function sourceOffset(rendered: RenderedText, index: number, roundUp: boolean): number {
  return rendered.offsets ? originalOffset(rendered.offsets, index, roundUp) : index;
}

const COMPOSES_WITH_PREVIOUS = /[\p{M}ᅠ-ᇿힰ-퟿]/u;

/** NFC, keeping a map back to the original offsets. */
export function normalizedSegments(text: string): RenderedText & { offsets: OffsetPairs } {
  const offsets: OffsetPairs = [[0, 0]];
  let normalized = "";
  let start = 0;
  let offset = 0;
  for (const character of text) {
    if (offset > start && !COMPOSES_WITH_PREVIOUS.test(character)) {
      normalized += text.slice(start, offset).normalize("NFC");
      offsets.push([offset, normalized.length]);
      start = offset;
    }
    offset += character.length;
  }
  normalized += text.slice(start).normalize("NFC");
  offsets.push([offset, normalized.length]);
  return { text: normalized, offsets };
}

/** The source offset of a rendered offset, rounding into or out of a character. */
export function originalOffset(offsets: OffsetPairs, index: number, roundUp: boolean): number {
  let low = 0;
  let high = offsets.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (roundUp ? offsets[middle][1] >= index : offsets[middle][1] > index) high = middle;
    else low = middle + 1;
  }
  if (roundUp) return (offsets[low] ?? (offsets.at(-1) as [number, number]))[0];
  return low > 0 ? offsets[low - 1][0] : 0;
}

const ACCENTS: Record<string, string> = {
  "'": "́",
  "`": "̀",
  '"': "̈",
  "^": "̂",
  "~": "̃",
  "=": "̄",
  ".": "̇",
  u: "̆",
  v: "̌",
  H: "̋",
  c: "̧",
  k: "̨",
  r: "̊",
  d: "̣",
  b: "̱",
};
const LETTERS: Record<string, string> = {
  ss: "ß",
  ae: "æ",
  AE: "Æ",
  oe: "œ",
  OE: "Œ",
  aa: "å",
  AA: "Å",
  o: "ø",
  O: "Ø",
  l: "ł",
  L: "Ł",
  i: "ı",
  j: "ȷ",
};
// \'e  \'{e}  \"{\i}  \c{c}  \v s  \ss  \o{}. Letter macros and \i, \j are
// control words, so TeX drops one space after them: `Bj\o rn` reads "Bjørn".
const ACCENTED = String.raw`(?<accent>['\`"^~=.])\s*(?:\{\s*(?<braced>\\[ij]|[A-Za-z])\s*\}|(?<dotless>\\[ij]) ?|(?<bare>[A-Za-z]))`;
const NAMED_ACCENT = String.raw`(?<named>[uvHckrdb])(?:\s*\{\s*(?<namedBraced>\\[ij]|[A-Za-z])\s*\}|\s+(?<namedBare>[A-Za-z]))`;
const LETTER_MACRO = String.raw`(?<letter>ss|ae|AE|oe|OE|aa|AA|[oOlL])(?![A-Za-z])(?:\{\}| )?`;
const TEX_LETTER = new RegExp(String.raw`\\(?:${ACCENTED}|${NAMED_ACCENT}|${LETTER_MACRO})`, "g");
const HAS_TEX_LETTER = /\\(?:['`"^~=.]|[uvHckrdb][\s{]|(?:ss|ae|AE|oe|OE|aa|AA|[oOlL])(?![A-Za-z]))/;

// An accent on \i or \j sits on the dotless letter; the reader sees i, j.
const DOTLESS_BASES: Readonly<Record<string, string>> = { [String.raw`\i`]: "i", [String.raw`\j`]: "j" };

function baseLetter(base: string): string {
  return DOTLESS_BASES[base] ?? base;
}

/**
 * `text` with TeX accent and letter macros spelled as the letters they make
 * (`r\'esum\'e` reads "résumé"), NFC normalised, with offsets back to `text`.
 * Text without them comes back through `normalizedSegments` alone.
 */
export function renderedTex(text: string): RenderedText {
  if (!HAS_TEX_LETTER.test(text)) {
    return text.normalize("NFC") === text ? { text, offsets: null } : normalizedSegments(text);
  }
  const offsets: OffsetPairs = [[0, 0]];
  let rendered = "";
  let last = 0;
  const appendPlain = (end: number) => {
    if (end <= last) return;
    const plain = normalizedSegments(text.slice(last, end));
    for (const [from, to] of plain.offsets.slice(1)) offsets.push([last + from, rendered.length + to]);
    rendered += plain.text;
  };
  for (const match of text.matchAll(TEX_LETTER)) {
    const whole = match[0];
    const { accent, braced, dotless, bare, named, namedBraced, namedBare, letter } = match.groups ?? {};
    let piece: string;
    if (accent) piece = (baseLetter(braced ?? dotless ?? bare) + ACCENTS[accent]).normalize("NFC");
    else if (named) piece = (baseLetter(namedBraced ?? namedBare) + ACCENTS[named]).normalize("NFC");
    else piece = LETTERS[letter];
    appendPlain(match.index);
    rendered += piece;
    last = match.index + whole.length;
    offsets.push([last, rendered.length]);
  }
  appendPlain(text.length);
  return { text: rendered, offsets };
}
