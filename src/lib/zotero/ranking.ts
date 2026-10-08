export interface RankableCitation {
  readonly key: string;
  readonly authors: readonly string[];
  readonly title: string;
  readonly year?: string;
}

const SPECIAL_LETTERS: Readonly<Record<string, string>> = {
  ß: "ss",
  æ: "ae",
  Æ: "ae",
  œ: "oe",
  Œ: "oe",
  ø: "o",
  Ø: "o",
  đ: "d",
  Đ: "d",
  ł: "l",
  Ł: "l",
  þ: "th",
  Þ: "th",
  ı: "i",
};

const SPECIAL_PATTERN = /[ßæÆœŒøØđĐłŁþÞı]/g;
const MARKS = /\p{M}+/gu;
const WIDE = /[ᄀ-ᇿ⺀-鿿ꥠ-꥿가-퟿豈-﫿]/u;

export function foldText(text: string): string {
  return text
    .replace(SPECIAL_PATTERN, (letter) => SPECIAL_LETTERS[letter] ?? letter)
    .normalize("NFKD")
    .replace(MARKS, "")
    .toLocaleLowerCase("en-US");
}

function tokens(text: string): string[] {
  return foldText(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

export function queryTerms(query: string): { terms: string[]; compact: string } {
  const folded = foldText(query.trim().replace(/^@+/, ""));
  return {
    terms: folded.split(/[^\p{L}\p{N}]+/u).filter(Boolean),
    compact: folded.replace(/\s+/g, ""),
  };
}

function termScore(
  term: string,
  key: string,
  families: readonly string[],
  words: readonly string[],
  year: string | undefined,
  wide: boolean,
): number {
  let best = 0;
  const numeric = /^\d+$/.test(term);
  if (numeric && term.length === 4 && year === term) best = 300;
  else if (numeric && term.length >= 2 && year?.startsWith(term)) best = 90;
  families.forEach((family, index) => {
    const first = index === 0;
    let score = 0;
    if (family === term) score = first ? 560 : 460;
    else if (family.startsWith(term)) score = first ? 450 : 350;
    else if (wide && family.includes(term)) score = 200;
    best = Math.max(best, score);
  });
  if (key.startsWith(term)) best = Math.max(best, 500);
  else if ([...term].length >= 3 && key.includes(term)) best = Math.max(best, 120);
  for (const word of words) {
    let score = 0;
    if (word === term) score = 180;
    else if (word.startsWith(term)) score = 150;
    else if (wide && word.includes(term)) score = 110;
    best = Math.max(best, score);
  }
  return best;
}

export interface PreparedCitation {
  readonly key: string;
  readonly families: readonly string[];
  readonly words: readonly string[];
  readonly year?: string;
  readonly wide: boolean;
}

export function prepareCitation(candidate: RankableCitation): PreparedCitation {
  return {
    key: foldText(candidate.key),
    families: candidate.authors.flatMap(tokens),
    words: tokens(candidate.title),
    year: candidate.year,
    wide: WIDE.test(candidate.title) || candidate.authors.some((author) => WIDE.test(author)),
  };
}

export function scorePrepared(prepared: PreparedCitation, query: string): number | null {
  const { terms, compact } = queryTerms(query);
  let total = 0;
  if (compact) {
    if (prepared.key === compact) total += 2_000;
    else if ([...compact].length >= 2 && prepared.key.startsWith(compact)) total += 800;
  }
  for (const term of terms) {
    const score = termScore(term, prepared.key, prepared.families, prepared.words, prepared.year, prepared.wide);
    if (score === 0) return null;
    total += score;
  }
  return total;
}

export function scoreCitation(candidate: RankableCitation, query: string): number | null {
  return scorePrepared(prepareCitation(candidate), query);
}

export function scoreLabel(label: string, query: string): number | null {
  return scoreCitation({ key: label, authors: [], title: label }, query);
}

export function familyNames(author: string | undefined): string[] {
  if (!author) return [];
  return author
    .split(/\s+and\s+/i)
    .map((name) => {
      const trimmed = name.replace(/[{}]/g, "").trim();
      if (trimmed.includes(",")) return trimmed.split(",")[0].trim();
      return trimmed.split(/\s+/).at(-1) ?? trimmed;
    })
    .filter(Boolean);
}
