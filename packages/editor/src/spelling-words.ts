export interface SpellingWordSpan {
  from: number;
  to: number;
}

export interface SpellingWord extends SpellingWordSpan {
  word: string;
  compound?: SpellingWordSpan & { word: string };
}

const UNSEGMENTED_SCRIPTS = String.raw`\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}\p{sc=Thai}\p{sc=Lao}\p{sc=Khmer}\p{sc=Myanmar}\p{sc=Tibetan}`;
const LETTER = String.raw`(?:(?![${UNSEGMENTED_SCRIPTS}])\p{L})`;
const RUN = String.raw`${LETTER}(?:${LETTER}|\p{M})*`;
const JOINER = String.raw`(?:['’ʼ׳״·\u00AD\u200C\u200D]+|"(?=\p{sc=Hebrew}))`;
const WORD = String.raw`${RUN}(?:${JOINER}${RUN})*`;
const HYPHEN = String.raw`[-\u2010]`;

const WORD_PATTERN = new RegExp(WORD, "gu");
const COMPOUND_PATTERN = new RegExp(
  String.raw`${WORD}(?:${HYPHEN}${WORD})*`,
  "gu",
);

export function spellingWordSpans(masked: string): SpellingWord[] {
  const output: SpellingWord[] = [];
  for (const compound of masked.matchAll(COMPOUND_PATTERN)) {
    const start = compound.index ?? 0;
    const text = compound[0];
    const parts = [...text.matchAll(WORD_PATTERN)];
    if (parts.length === 1) {
      output.push({ from: start, to: start + text.length, word: text });
      continue;
    }
    const whole = { from: start, to: start + text.length, word: text };
    for (const part of parts) {
      const from = start + (part.index ?? 0);
      output.push({
        from,
        to: from + part[0].length,
        word: part[0],
        compound: whole,
      });
    }
  }
  return output;
}

export function spellingWordRanges(
  masked: string,
  source: string,
): SpellingWord[] {
  return spellingWordSpans(masked).map((span) => ({
    from: span.from,
    to: span.to,
    word: source.slice(span.from, span.to),
    ...(span.compound
      ? {
          compound: {
            from: span.compound.from,
            to: span.compound.to,
            word: source.slice(span.compound.from, span.compound.to),
          },
        }
      : {}),
  }));
}

export function mapSpellingWords(
  words: readonly SpellingWord[],
  map: readonly number[],
  source: string,
): SpellingWord[] {
  const locate = (span: SpellingWordSpan) => {
    const from = map[span.from];
    const to = (map[span.to - 1] ?? from) + 1;
    return { from, to, word: source.slice(from, to) };
  };
  return words.map((word) => ({
    ...locate(word),
    ...(word.compound ? { compound: locate(word.compound) } : {}),
  }));
}

export function spellingLookupForms(word: string): string[] {
  const normalized = word.normalize("NFC").replace(/\u00AD/gu, "");
  const ascii = normalized
    .replace(/[’ʼ׳]/gu, "'")
    .replace(/״/gu, '"');
  return ascii === normalized ? [normalized] : [normalized, ascii];
}

export function restoreApostrophes(original: string, suggestion: string): string {
  const typographic = /[’ʼ]/u.exec(original)?.[0];
  if (!typographic || original.includes("'")) return suggestion;
  return suggestion.replace(/'/gu, typographic);
}
