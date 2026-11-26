import { syntaxTree } from "@codemirror/language";
import type { EditorState, Line } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import { isBackslashEscaped } from "@oleafly/latex";
import type { ResolvedPlace, SnippetLanguage } from "@oleafly/snippets";
import { inLatexIgnoredRegion, latexMaskedSlice, mathContextInRange } from "../latex-lexical";
import { typstContextAt } from "../typst-editing";

export const PARAGRAPH_SCAN_LIMIT = 16 * 1024;

const BLANK_LINE_PROBE = 256;
const ARGUMENTS_SKIPPED = 4;
const COMMAND_LETTER = /[A-Za-z@]/;
const SPACE = /\s/;
const BLANK = /^\s*$/;

const NO_FIRE_COMMANDS: ReadonlySet<string> = new Set([
  "label",
  "tag",
  "ref",
  "eqref",
  "cref",
  "Cref",
  "autoref",
  "begin",
  "end",
  "url",
  "href",
  "path",
  "texttt",
  "verb",
]);

const TEXT_IN_MATH_COMMANDS: ReadonlySet<string> = new Set([
  "mathrm",
  "mathsf",
  "mathtt",
  "mathit",
  "mathbf",
  "mathnormal",
  "mbox",
  "operatorname",
  "intertext",
]);

const MARKDOWN_CODE_NODES: ReadonlySet<string> = new Set(["FencedCode", "CodeBlock", "InlineCode", "CodeText"]);

const LANGUAGE_SLOT: Readonly<Record<SnippetLanguage, number>> = {
  latex: 0,
  typst: 1,
  markdown: 2,
  bibtex: 3,
  notes: 4,
};

const placeCache = new WeakMap<EditorState, Map<number, ResolvedPlace | null>>();

interface OpenGroup {
  at: number;
  command: string | null;
}

function blankLine(line: Line): boolean {
  return line.length === 0 || (line.length <= BLANK_LINE_PROBE && BLANK.test(line.text));
}

export function paragraphStart(state: EditorState, pos: number): number | null {
  const doc = state.doc;
  let line = doc.lineAt(pos);
  if (blankLine(line)) return line.from;
  for (;;) {
    if (pos - line.from > PARAGRAPH_SCAN_LIMIT) return null;
    if (line.number === 1) return 0;
    const previous = doc.line(line.number - 1);
    if (blankLine(previous)) return line.from;
    line = previous;
  }
}

function groupStartBefore(text: string, close: number, opening: string, closing: string): number | null {
  let depth = 0;
  for (let index = close; index >= 0; index -= 1) {
    const character = text[index];
    if ((character !== opening && character !== closing) || isBackslashEscaped(text, index)) continue;
    if (character === closing) depth += 1;
    else {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return null;
}

function skipSpaceBefore(text: string, end: number): number {
  let cursor = end;
  while (cursor > 0 && SPACE.test(text[cursor - 1])) cursor -= 1;
  return cursor;
}

function commandBefore(text: string, open: number): string | null {
  let cursor = open;
  for (let skipped = 0; skipped < ARGUMENTS_SKIPPED; skipped += 1) {
    cursor = skipSpaceBefore(text, cursor);
    const closing = text[cursor - 1];
    if (closing !== "}" && closing !== "]") break;
    const start = groupStartBefore(text, cursor - 1, closing === "}" ? "{" : "[", closing);
    if (start === null) return null;
    cursor = start;
  }
  cursor = skipSpaceBefore(text, cursor);
  if (text[cursor - 1] === "*") cursor -= 1;
  let start = cursor;
  while (start > 0 && COMMAND_LETTER.test(text[start - 1])) start -= 1;
  if (start === cursor || text[start - 1] !== "\\" || isBackslashEscaped(text, start - 1)) return null;
  return text.slice(start, cursor);
}

function openGroups(text: string): OpenGroup[] {
  const groups: OpenGroup[] = [];
  let depth = 0;
  for (let index = text.length - 1; index >= 0; index -= 1) {
    const character = text[index];
    if ((character !== "{" && character !== "}") || isBackslashEscaped(text, index)) continue;
    if (character === "}") depth += 1;
    else if (depth > 0) depth -= 1;
    else groups.push({ at: index, command: commandBefore(text, index) });
  }
  return groups;
}

function noFireCommand(command: string): boolean {
  return NO_FIRE_COMMANDS.has(command) || command.toLowerCase().includes("cite");
}

function textInMathCommand(command: string): boolean {
  return command.startsWith("text") || TEXT_IN_MATH_COMMANDS.has(command);
}

function latexPlace(state: EditorState, pos: number): ResolvedPlace | null {
  if (inLatexIgnoredRegion(state, pos)) return null;
  const from = paragraphStart(state, pos);
  if (from === null) return null;
  const text = latexMaskedSlice(state, from, pos);
  const groups = openGroups(text);
  if (groups.some((group) => group.command !== null && noFireCommand(group.command))) return null;
  const math = mathContextInRange(state, from, pos, text);
  if (math.from === null) return "text";
  const opened = math.from - from + math.width;
  if (groups.some((group) => group.at >= opened && group.command !== null && textInMathCommand(group.command))) {
    return "text";
  }
  return (math.delimiter === "$" && math.width === 1) || math.delimiter === "\\(" ? "inline-math" : "display-math";
}

function typstEquationStart(state: EditorState, pos: number): number | null {
  for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, -1); node; node = node.parent) {
    if (node.name === "Equation") return node.from;
  }
  const from = Math.max(0, pos - PARAGRAPH_SCAN_LIMIT);
  const text = state.sliceDoc(from, pos);
  for (let index = text.length - 1; index >= 0; index -= 1) {
    if (text[index] === "$" && !isBackslashEscaped(text, index)) return from + index;
  }
  return null;
}

function typstPlace(state: EditorState, pos: number): ResolvedPlace | null {
  switch (typstContextAt(state, pos)) {
    case "markup":
      return "text";
    case "code":
      return "code";
    case "math": {
      const opener = typstEquationStart(state, pos);
      const after = opener === null ? "" : state.sliceDoc(opener + 1, opener + 2);
      return SPACE.test(after) ? "display-math" : "inline-math";
    }
    default:
      return null;
  }
}

function markdownPlace(state: EditorState, pos: number): ResolvedPlace {
  for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, -1); node; node = node.parent) {
    if (MARKDOWN_CODE_NODES.has(node.name)) return "code";
    if (node.name === "PandocMath") {
      return state.sliceDoc(node.from, node.from + 2) === "$$" ? "display-math" : "inline-math";
    }
  }
  return "text";
}

function resolvePlace(state: EditorState, pos: number, language: SnippetLanguage): ResolvedPlace | null {
  switch (language) {
    case "latex":
      return latexPlace(state, pos);
    case "typst":
      return typstPlace(state, pos);
    case "markdown":
      return markdownPlace(state, pos);
    default:
      return "text";
  }
}

export function snippetPlaceAt(state: EditorState, pos: number, language: SnippetLanguage): ResolvedPlace | null {
  const at = Math.max(0, Math.min(pos, state.doc.length));
  const key = at * 5 + LANGUAGE_SLOT[language];
  let cache = placeCache.get(state);
  if (cache?.has(key)) return cache.get(key) ?? null;
  const place = resolvePlace(state, at, language);
  if (!cache) {
    cache = new Map();
    placeCache.set(state, cache);
  }
  cache.set(key, place);
  return place;
}
