export interface MarkdownRange {
  from: number;
  to: number;
  word: string;
}

const TRAILING_PUNCT = new Set([".", ",", ":", "!", "?", ")", "]", "}", "'"]);

function blank(chars: string[], from: number, to: number) {
  for (let i = from; i < to; i++) if (chars[i] !== "\n") chars[i] = " ";
}

export function maskMarkdown(text: string): string {
  const chars = text.split("");
  const lines = text.split(/(?<=\n)/);
  let offset = 0;
  let fence: { char: string; length: number } | null = null;
  for (const line of lines) {
    const marker = line.match(/^[ \t]{0,3}(`{3,}|~{3,})/);
    if (fence) {
      blank(chars, offset, offset + line.length);
      if (marker && marker[1][0] === fence.char && marker[1].length >= fence.length) fence = null;
    } else if (marker) {
      fence = { char: marker[1][0], length: marker[1].length };
      blank(chars, offset, offset + line.length);
    }
    offset += line.length;
  }

  const masked = chars.join("");
  for (const match of masked.matchAll(/(`+)(?!`)([^\n]*?)\1/g)) blank(chars, match.index!, match.index! + match[0].length);
  for (const match of chars.join("").matchAll(/!?\[[^\]\n]*\]\((?:\\.|[^)\n])*\)/g)) {
    const open = match[0].lastIndexOf("(");
    blank(chars, match.index! + open, match.index! + match[0].length);
  }
  for (const match of chars.join("").matchAll(/(?:https?:\/\/|www\.)[^\s<>()]+/gi)) blank(chars, match.index!, match.index! + match[0].length);
  for (const match of chars.join("").matchAll(/\$\$(?:.|\n)*?\$\$|(?<!\\)\$(?!\s)(?:\\.|[^$\n])+?(?<!\s)\$/g)) blank(chars, match.index!, match.index! + match[0].length);
  return chars.join("");
}

export function markdownToProse(text: string): { prose: string; map: number[] } {
  const masked = maskMarkdown(text);
  let prose = "";
  const map: number[] = [];
  let pending = false;
  for (let i = 0; i < masked.length; i++) {
    const char = masked[i];
    if (/\s/.test(char)) {
      if (prose.length > 0) pending = true;
      continue;
    }
    if (pending) {
      pending = false;
      if (!TRAILING_PUNCT.has(char)) {
        prose += " ";
        map.push(i);
      }
    }
    prose += char;
    map.push(i);
  }
  return { prose, map };
}

export function markdownSpellcheckRanges(text: string): MarkdownRange[] {
  const masked = maskMarkdown(text);
  const ranges: MarkdownRange[] = [];
  for (const match of masked.matchAll(/[A-Za-z][A-Za-z']*/g)) {
    ranges.push({ from: match.index!, to: match.index! + match[0].length, word: match[0] });
  }
  return ranges;
}
