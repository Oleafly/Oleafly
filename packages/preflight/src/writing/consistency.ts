import { message } from "../messages";
import type { FileEdits, Finding, FindingFix, TextEdit } from "../types";
import type { ProjectWritingContext, ProjectWritingFile, ProjectWritingRule } from "./index";
import type { MacroText } from "./macros";
import { commentFree, isProse, proseView, type ProseView } from "./prose";
import { macroReplacement, writingFingerprint, writingFinding } from "./rules";

const NAME_VARIANTS = "writing-name-variants";
const SYMBOL_REDEFINED = "writing-symbol-redefined";
const MAX_MEANING_WORDS = 10;

interface ViewedFile {
  readonly path: string;
  readonly view: ProseView;
  readonly source: string;
}

const INCLUDE = /\\(?:input|include|subfile)\s*\{([^{}]+)\}/g;

function documentOrder(files: readonly ProjectWritingFile[], mainFile: string): ProjectWritingFile[] {
  const byPath = new Map(files.map((file) => [file.path, file]));
  const base = mainFile.slice(0, mainFile.lastIndexOf("/") + 1);
  const visited = new Set<string>();
  const ordered: ProjectWritingFile[] = [];
  const visit = (path: string | undefined) => {
    const file = path === undefined ? undefined : byPath.get(path);
    if (!file || visited.has(file.path)) return;
    visited.add(file.path);
    ordered.push(file);
    for (const match of commentFree(file.content).matchAll(INCLUDE)) {
      const name = match[1].trim().replace(/^\.\//, "");
      visit([`${base}${name}`, `${base}${name}.tex`, name, `${name}.tex`].find((candidate) => byPath.has(candidate)));
    }
  };
  visit(mainFile);
  for (const file of files) visit(file.path);
  return ordered;
}

const LATEX_DOCUMENT = /\.(?:tex|ltx)$/i;

function viewedFiles(files: readonly ProjectWritingFile[], mainFile: string): ViewedFile[] {
  return documentOrder(files.filter((file) => LATEX_DOCUMENT.test(file.path)), mainFile).map((file) => ({
    path: file.path,
    view: proseView(file.content),
    source: commentFree(file.content),
  }));
}

const TOKEN = /(?<![A-Za-z0-9\\@_-])[A-Za-z0-9]+(?:(?:-|\\?_)[A-Za-z0-9]+)*/g;
const JOIN = /-|\\?_/;
const LOWERCASE_TAIL = /(?:-|\\?_)[a-z]+$/;
const ROMAN = /^M{0,3}(?:CM|CD|D?C{0,3})(?:XC|XL|L?X{0,3})(?:IX|IV|V?I{0,3})$/;
const ORDINARY_PART = /^(?:[a-z0-9]+|[A-Z][a-z0-9]*)$/;
const RESERVED_NAMES: ReadonlySet<string> = new Set([
  "TeX", "LaTeX", "LaTeXe", "Large", "LARGE", "Huge", "HUGE", "Box", "Join", "Diamond", "Gamma", "Delta", "Theta",
  "Lambda", "Sigma", "Upsilon", "Phi", "Psi", "Omega", "Vert", "Roman", "Alph",
]);

interface Occurrence {
  readonly file: ViewedFile;
  readonly from: number;
  readonly to: number;
  readonly text: string;
}

interface Spelling {
  readonly key: string;
  readonly surfaces: Map<string, number>;
  count: number;
}

function distinctive(text: string): boolean {
  return (text.match(/[A-Z]/g)?.length ?? 0) >= 2 || /\d/.test(text);
}

function nameLike(name: string): boolean {
  if (!/[A-Za-z]/.test(name) || /^[A-Z]{2}$/.test(name) || ROMAN.test(name)) return false;
  return distinctive(name) || JOIN.test(name);
}

function withoutLowercaseTail(token: string): string {
  let name = token;
  for (let cut = name.search(LOWERCASE_TAIL); cut > 0 && distinctive(name.slice(0, cut)); cut = name.search(LOWERCASE_TAIL)) {
    name = name.slice(0, cut);
  }
  return name;
}

function spellingKey(name: string): string {
  return name.split(JOIN).every((part) => ORDINARY_PART.test(part)) ? name.toLowerCase() : name;
}

function nameOccurrences(files: readonly ViewedFile[]): Map<string, Occurrence[]> {
  const groups = new Map<string, Occurrence[]>();
  for (const file of files) {
    for (const match of file.view.prose.matchAll(TOKEN)) {
      const text = withoutLowercaseTail(match[0]);
      if (!nameLike(text)) continue;
      const key = text.toLowerCase().replace(/[-_\\\s]/g, "");
      const group = groups.get(key) ?? [];
      group.push({ file, from: match.index, to: match.index + text.length, text });
      groups.set(key, group);
    }
  }
  return groups;
}

function spellings(occurrences: readonly Occurrence[]): Spelling[] {
  const byKey = new Map<string, Spelling>();
  for (const { text } of occurrences) {
    const key = spellingKey(text);
    const spelling = byKey.get(key) ?? { key, surfaces: new Map<string, number>(), count: 0 };
    spelling.count += 1;
    spelling.surfaces.set(text, (spelling.surfaces.get(text) ?? 0) + 1);
    byKey.set(key, spelling);
  }
  return [...byKey.values()].sort((left, right) => right.count - left.count);
}

function written(spelling: Spelling): string {
  return [...spelling.surfaces].reduce((best, entry) => (entry[1] > best[1] ? entry : best))[0];
}

function controlWords(files: readonly ProjectWritingFile[], macros: readonly MacroText[]): Set<string> {
  const names = new Set(macros.map((macro) => macro.name));
  for (const file of files) for (const match of file.content.matchAll(/\\([A-Za-z]+)/g)) names.add(match[1]);
  return names;
}

function macroName(text: string, taken: ReadonlySet<string>): string {
  const base = (text.match(/[A-Za-z]+/g) ?? []).map((part) => part[0].toUpperCase() + part.slice(1)).join("");
  let name = base.length >= 3 ? base : `${base}Name`;
  while (taken.has(name) || RESERVED_NAMES.has(name)) name += "Name";
  return name;
}

function definitionEdit(file: ViewedFile, macro: MacroText): TextEdit {
  const line = `\\newcommand{\\${macro.name}}{${macro.text}}`;
  const begin = /\\begin\s*\{document\}/.exec(file.source);
  if (!begin) return { from: 0, to: 0, insert: `${line}\n` };
  const lineStart = file.source.lastIndexOf("\n", begin.index - 1) + 1;
  return file.source.slice(lineStart, begin.index).trim() === ""
    ? { from: lineStart, to: lineStart, insert: `${line}\n` }
    : { from: begin.index, to: begin.index, insert: `\n${line}\n` };
}

function macroFix(occurrences: readonly Occurrence[], anchor: Occurrence, main: ViewedFile, macro: MacroText, define: boolean): FindingFix {
  const edits = new Map<string, TextEdit[]>();
  for (const occurrence of occurrences) {
    const list = edits.get(occurrence.file.path) ?? [];
    list.push({ from: occurrence.from, to: occurrence.to, insert: macroReplacement(macro, occurrence.file.view.text[occurrence.to]) });
    edits.set(occurrence.file.path, list);
  }
  if (define) {
    const definition = definitionEdit(main, macro);
    const list = edits.get(main.path) ?? [];
    const clash = list.find((edit) => edit.from === definition.from);
    if (clash) clash.insert = definition.insert + clash.insert;
    else edits.set(main.path, [...list, definition]);
  }
  const sorted = (path: string) => [...(edits.get(path) ?? [])].sort((left, right) => left.from - right.from);
  const otherFiles: FileEdits[] = [...edits.keys()]
    .filter((path) => path !== anchor.file.path)
    .map((file) => ({ file, edits: sorted(file) }));
  return {
    label: define ? message("fixes.makeMacro") : message("fixes.useMacro", { macro: `\\${macro.name}` }),
    edits: sorted(anchor.file.path),
    ...(otherFiles.length > 0 ? { otherFiles } : {}),
  };
}

function nameVariantFindings(files: readonly ProjectWritingFile[], context: ProjectWritingContext): Finding[] {
  const viewed = viewedFiles(files, context.mainFile);
  const main = viewed.find((file) => file.path === context.mainFile) ?? viewed[0];
  const taken = controlWords(files, context.macros);
  const out: Finding[] = [];
  for (const [key, occurrences] of nameOccurrences(viewed)) {
    const ordered = spellings(occurrences);
    const anchor = occurrences.find((occurrence) => spellingKey(occurrence.text) !== ordered[0].key);
    if (ordered.length < 2 || !anchor) continue;
    const texts = ordered.map(written);
    const existing = texts.map((text) => context.macros.find((macro) => macro.text === text)).find((macro) => macro !== undefined);
    const macro: MacroText = existing ?? { name: macroName(texts[0], taken), text: texts[0], spacing: "plain" };
    taken.add(macro.name);
    out.push({
      ...writingFinding(NAME_VARIANTS, anchor.file.view, anchor.from, anchor.to, {
        fix: macroFix(occurrences, anchor, main, macro, existing === undefined),
        detail: message("rules.writing-name-variants.detail", {
          spellings: ordered.map((spelling, index) => `${texts[index]} ${spelling.count}`).join(", "),
        }),
        fingerprint: writingFingerprint(NAME_VARIANTS, key),
      }),
      file: anchor.file.path,
    });
  }
  return out;
}

const INLINE_MATH = String.raw`(?:(?<!\\)\$([^$]+)\$|\\\(([\s\S]+?)\\\))`;
const DEFINITION_PATTERNS = [
  new RegExp(String.raw`\b[Ll]et\s+${INLINE_MATH}\s+(?:be|denote)\s+`, "g"),
  new RegExp(
    String.raw`${INLINE_MATH}\s+(?:denotes|represents|stands\s+for|refers\s+to|is\s+defined\s+as|is(?=\s+(?:the|a|an|our|its|their)\s))\s*`,
    "g",
  ),
];
const MEANING_TOKEN =
  /(?<math>(?<!\\)\$[^$]+\$|\\\([\s\S]*?\\\))|(?<word>[A-Za-z0-9][A-Za-z0-9'-]*)|\\(?:emph|textit|textbf|textsc|textrm|textnormal|text)\s*\{|[{}]|[ \t~]+|\n(?![ \t]*\n)/y;
const TRAILING_WORDS: ReadonlySet<string> = new Set([
  "a", "an", "the", "and", "or", "but", "while", "whereas", "where", "which", "that", "with", "of", "for", "in", "on", "at", "to", "by", "from",
]);
const STOP_WORDS: ReadonlySet<string> = new Set([
  ...TRAILING_WORDS, "our", "its", "their", "this", "these", "those", "each", "is", "are", "be", "as", "all", "any", "some", "given", "we", "it",
]);

interface Candidate {
  readonly from: number;
  readonly start: number;
  readonly math: string;
}

interface Definition {
  readonly file: ViewedFile;
  readonly from: number;
  readonly to: number;
  readonly math: string;
  readonly symbol: string;
  readonly meaning: string;
  readonly words: readonly string[];
}

export interface NotationEntry {
  readonly symbol: string;
  readonly meaning: string;
}

function normalizeMath(body: string): string {
  return body
    .replace(/\s+/g, " ")
    .trim()
    .replace(/([_^])\{ ?([A-Za-z0-9]) ?\}/g, "$1$2")
    .replace(/(\\[A-Za-z]+) (?=[A-Za-z])| /g, (_space, word?: string) => (word ? `${word} ` : ""));
}

function symbolKey(math: string): string {
  return math.split(/=|:|\\(?:in|colon|subseteq|subset|sim)(?![A-Za-z])/)[0].trim();
}

function candidates(file: ViewedFile): Candidate[] {
  const out: Candidate[] = [];
  for (const pattern of DEFINITION_PATTERNS) {
    for (const match of file.source.matchAll(pattern)) {
      const body = match[1] ?? match[2];
      const from = match.index + match[0].search(/(?<!\\)\$|\\\(/);
      const to = from + body.length + (match[1] === undefined ? 4 : 2);
      const start = match.index + match[0].length;
      if (from < file.view.bodyStart || file.view.prose.slice(from, to).trim() !== "") continue;
      if (!isProse(file.view, match.index, from) || !isProse(file.view, to, start)) continue;
      out.push({ from, start, math: normalizeMath(body) });
    }
  }
  return out.sort((left, right) => left.from - right.from);
}

function meaningAt(source: string, from: number, until: number): { words: string[]; to: number } {
  const words: string[] = [];
  const ends: number[] = [];
  MEANING_TOKEN.lastIndex = from;
  for (
    let match = MEANING_TOKEN.exec(source);
    match && match.index < until && words.length < MAX_MEANING_WORDS;
    match = MEANING_TOKEN.exec(source)
  ) {
    const { math, word } = match.groups ?? {};
    if (math !== undefined) words.push(`$${normalizeMath(math.startsWith("$") ? math.slice(1, -1) : math.slice(2, -2))}$`);
    else if (word !== undefined) words.push(word);
    else continue;
    ends.push(MEANING_TOKEN.lastIndex);
  }
  while (words.length > 0 && TRAILING_WORDS.has(words[words.length - 1].toLowerCase())) {
    words.pop();
    ends.pop();
  }
  return { words, to: ends[ends.length - 1] ?? from };
}

function comparable(words: readonly string[]): string[] {
  return words
    .map((word) => (word.startsWith("$") ? word : word.toLowerCase()))
    .filter((word) => !STOP_WORDS.has(word))
    .map((word) => (word.length > 3 && /[^s]s$/.test(word) ? word.slice(0, -1) : word));
}

function sameMeaning(left: readonly string[], right: readonly string[]): boolean {
  const [short, long] = left.length <= right.length ? [left, right] : [right, left];
  return short.every((word, index) => long[index] === word);
}

function definitions(files: readonly ViewedFile[]): Definition[] {
  const out: Definition[] = [];
  for (const file of files) {
    const found = candidates(file);
    found.forEach((candidate, index) => {
      const symbol = symbolKey(candidate.math);
      const meaning = meaningAt(file.source, candidate.start, found[index + 1]?.from ?? file.source.length);
      const words = comparable(meaning.words);
      if (!symbol || words.length === 0) return;
      out.push({ file, from: candidate.from, to: meaning.to, math: candidate.math, symbol, meaning: meaning.words.join(" "), words });
    });
  }
  return out;
}

function symbolRedefinedFindings(files: readonly ProjectWritingFile[], context: ProjectWritingContext): Finding[] {
  const seen = new Map<string, Definition[]>();
  const out: Finding[] = [];
  for (const definition of definitions(viewedFiles(files, context.mainFile))) {
    const earlier = seen.get(definition.symbol) ?? [];
    seen.set(definition.symbol, [...earlier, definition]);
    if (earlier.length === 0 || earlier.some((other) => sameMeaning(other.words, definition.words))) continue;
    out.push({
      ...writingFinding(SYMBOL_REDEFINED, definition.file.view, definition.from, definition.to, {
        detail: message("rules.writing-symbol-redefined.detail", {
          symbol: `$${definition.symbol}$`,
          first: earlier[0].meaning,
          second: definition.meaning,
          file: earlier[0].file.path,
        }),
        fingerprint: writingFingerprint(SYMBOL_REDEFINED, `${definition.symbol} ${definition.words.join(" ")}`),
      }),
      file: definition.file.path,
    });
  }
  return out;
}

export function notationEntries(files: readonly ProjectWritingFile[], mainFile: string): NotationEntry[] {
  const entries = new Map<string, NotationEntry>();
  for (const definition of definitions(viewedFiles(files, mainFile))) {
    if (!entries.has(definition.symbol)) entries.set(definition.symbol, { symbol: definition.math, meaning: definition.meaning });
  }
  return [...entries.values()];
}

export const CONSISTENCY_WRITING_RULES: readonly ProjectWritingRule[] = [
  { id: NAME_VARIANTS, run: nameVariantFindings },
  { id: SYMBOL_REDEFINED, run: symbolRedefinedFindings },
];
