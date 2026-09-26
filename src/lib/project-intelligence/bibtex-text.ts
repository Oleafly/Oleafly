const SYMBOL_ACCENTS: Readonly<Record<string, string>> = {
  "'": "́",
  "`": "̀",
  "^": "̂",
  '"': "̈",
  "~": "̃",
  "=": "̄",
  ".": "̇",
};

const WORD_ACCENTS: Readonly<Record<string, string>> = {
  u: "̆",
  v: "̌",
  H: "̋",
  c: "̧",
  k: "̨",
  r: "̊",
  d: "̣",
  b: "̱",
};

const LETTER_MACROS: Readonly<Record<string, string>> = {
  ss: "ß",
  o: "ø",
  O: "Ø",
  l: "ł",
  L: "Ł",
  ae: "æ",
  AE: "Æ",
  oe: "œ",
  OE: "Œ",
  aa: "å",
  AA: "Å",
  i: "ı",
  j: "ȷ",
};

const ESCAPED_CHARACTERS = new Set(["&", "%", "$", "#", "_", "{", "}", " "]);

const SEARCH_LETTERS: Readonly<Record<string, string>> = {
  ß: "ss",
  ø: "o",
  Ø: "o",
  ł: "l",
  Ł: "l",
  đ: "d",
  Đ: "d",
  æ: "ae",
  Æ: "ae",
  œ: "oe",
  Œ: "oe",
  ı: "i",
  ȷ: "j",
};

interface Decoded {
  text: string;
  end: number;
}

function isAsciiLetter(character: string | undefined): boolean {
  return character !== undefined && /^[A-Za-z]$/.test(character);
}

function skipSpaces(value: string, index: number): number {
  let cursor = index;
  while (cursor < value.length && /\s/.test(value[cursor])) cursor++;
  return cursor;
}

function readWord(value: string, index: number): string {
  let cursor = index;
  while (isAsciiLetter(value[cursor])) cursor++;
  return value.slice(index, cursor);
}

function closingBrace(value: string, open: number): number {
  let depth = 0;
  for (let index = open; index < value.length; index++) {
    if (value[index] === "\\") {
      index++;
      continue;
    }
    if (value[index] === "{") depth++;
    else if (value[index] === "}") {
      depth--;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function withAccent(base: string, mark: string): string {
  const [first = "", ...rest] = [...base];
  const letter = first === "ı" ? "i" : first === "ȷ" ? "j" : first;
  return `${letter}${mark}${rest.join("")}`;
}

function accentArgument(value: string, index: number, mark: string): Decoded {
  const start = skipSpaces(value, index);
  const character = value[start];
  if (character === undefined) return { text: mark, end: start };
  if (character === "{") {
    const close = closingBrace(value, start);
    if (close < 0) return { text: mark, end: start };
    const inner = decodeBibtexText(value.slice(start + 1, close));
    return { text: inner ? withAccent(inner, mark) : mark, end: close + 1 };
  }
  if (character === "\\") {
    const decoded = decodeMacro(value, start);
    return { text: withAccent(decoded.text, mark), end: decoded.end };
  }
  const codePoint = String.fromCodePoint(value.codePointAt(start) ?? 0);
  return {
    text: withAccent(codePoint, mark),
    end: start + codePoint.length,
  };
}

function decodeMacro(value: string, index: number): Decoded {
  const next = value[index + 1];
  if (next === undefined) return { text: "\\", end: index + 1 };
  const symbolAccent = SYMBOL_ACCENTS[next];
  if (symbolAccent) return accentArgument(value, index + 2, symbolAccent);
  if (ESCAPED_CHARACTERS.has(next)) return { text: next, end: index + 2 };
  if (!isAsciiLetter(next)) {
    return { text: value.slice(index, index + 2), end: index + 2 };
  }
  const word = readWord(value, index + 1);
  const afterWord = index + 1 + word.length;
  const wordAccent = WORD_ACCENTS[word];
  if (wordAccent) return accentArgument(value, afterWord, wordAccent);
  const letter = LETTER_MACROS[word];
  if (letter) return { text: letter, end: skipSpaces(value, afterWord) };
  if (value[afterWord] === "{") {
    const close = closingBrace(value, afterWord);
    if (close >= 0) {
      return { text: value.slice(index, close + 1), end: close + 1 };
    }
  }
  return { text: value.slice(index, afterWord), end: afterWord };
}

function decodeBibtexText(value: string): string {
  let text = "";
  let index = 0;
  while (index < value.length) {
    const character = value[index];
    if (character === "$") {
      const close = value.indexOf("$", index + 1);
      const end = close < 0 ? value.length : close + 1;
      text += value.slice(index, end);
      index = end;
    } else if (character === "{" || character === "}") {
      index++;
    } else if (character === "\\") {
      const decoded = decodeMacro(value, index);
      text += decoded.text;
      index = decoded.end;
    } else {
      text += character;
      index++;
    }
  }
  return text;
}

export function bibtexTextToUnicode(value: string): string {
  return decodeBibtexText(value).normalize("NFC").replace(/\s+/gu, " ").trim();
}

export function searchFold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/[ßøØłŁđĐæÆœŒıȷ]/gu, (letter) => SEARCH_LETTERS[letter] ?? letter)
    .normalize("NFC")
    .toLowerCase();
}
