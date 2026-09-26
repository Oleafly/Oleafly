const ACCENT_MARKS: Readonly<Record<string, string>> = {
  "`": "\u0300",
  "'": "\u0301",
  "^": "\u0302",
  "~": "\u0303",
  "=": "\u0304",
  u: "\u0306",
  ".": "\u0307",
  '"': "\u0308",
  r: "\u030A",
  H: "\u030B",
  v: "\u030C",
  d: "\u0323",
  c: "\u0327",
  k: "\u0328",
  b: "\u0331",
};

const LETTER_MACROS: Readonly<Record<string, string>> = {
  ss: "ß",
  SS: "SS",
  ae: "æ",
  AE: "Æ",
  oe: "œ",
  OE: "Œ",
  aa: "å",
  AA: "Å",
  dh: "ð",
  DH: "Ð",
  th: "þ",
  TH: "Þ",
  dj: "đ",
  DJ: "Đ",
  ng: "ŋ",
  NG: "Ŋ",
  o: "ø",
  O: "Ø",
  l: "ł",
  L: "Ł",
  i: "ı",
  j: "ȷ",
};

const UNDECOMPOSED_LETTERS: Readonly<Record<string, string>> = {
  ß: "ss",
  ẞ: "SS",
  æ: "ae",
  Æ: "AE",
  œ: "oe",
  Œ: "OE",
  ø: "o",
  Ø: "O",
  ł: "l",
  Ł: "L",
  đ: "d",
  Đ: "D",
  ð: "d",
  Ð: "D",
  þ: "th",
  Þ: "Th",
  ı: "i",
  ȷ: "j",
  ŋ: "ng",
  Ŋ: "Ng",
};

const ACCENT_BASE = String.raw`\\[ij](?![\p{L}@])|\p{L}`;

const SYMBOL_ACCENT = new RegExp(
  String.raw`(?<!\\)\\([\x60'^~=."])\s*(?:\{\s*(${ACCENT_BASE})\s*\}|(${ACCENT_BASE}))`,
  "gu",
);

const LETTER_ACCENT = new RegExp(
  String.raw`(?<!\\)\\([uvHrdcbk])(?:\s*\{\s*(${ACCENT_BASE})\s*\}|\s+(${ACCENT_BASE}))`,
  "gu",
);

const LETTER_MACRO = new RegExp(
  String.raw`(?<!\\)\\(${Object.keys(LETTER_MACROS).join("|")})(?![\p{L}@])(?:\s*\{\s*\}|[ \t]*)`,
  "gu",
);

function accented(
  accent: string,
  braced: string | undefined,
  bare: string | undefined,
): string {
  const base = braced ?? bare ?? "";
  const letter = base.startsWith("\\") ? base.slice(1) : base;
  return `${letter}${ACCENT_MARKS[accent] ?? ""}`.normalize("NFC");
}

export function decodeLatexAccents(text: string): string {
  if (!text.includes("\\")) return text;
  return text
    .replace(SYMBOL_ACCENT, (_whole, accent: string, braced?: string, bare?: string) =>
      accented(accent, braced, bare),
    )
    .replace(LETTER_ACCENT, (_whole, accent: string, braced?: string, bare?: string) =>
      accented(accent, braced, bare),
    )
    .replace(LETTER_MACRO, (_whole, name: string) => LETTER_MACROS[name] ?? "");
}

export function foldLatinDiacritics(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/(\p{Script=Latin})\p{M}+/gu, "$1")
    .normalize("NFC")
    .replace(/[ßẞæÆœŒøØłŁđĐðÐþÞıȷŋŊ]/gu, (letter) => UNDECOMPOSED_LETTERS[letter] ?? letter);
}
