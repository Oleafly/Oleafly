import type {
  CompletionContext,
  CompletionSource,
} from "@codemirror/autocomplete";
import type { EditorState } from "@codemirror/state";

export const COMPLETION_CONTEXT_LIMIT = 2_048;

export type CompletionSyntax =
  | "latex"
  | "markdown"
  | "typst"
  | "bibtex"
  | "generic";

const LATEX_COMMAND = /\\[A-Za-z@]*$/u;
const LATEX_SLASH_COMMAND = /\/[A-Za-z]*$/u;
const LATEX_AT_SHORTCUT = /@[A-Za-z()[\]{}|<>+\-*=.]*$/u;
const MARKDOWN_ANCHOR = /\]\(#[\p{L}\p{N}_:.+/-]*$/u;
const AT_REFERENCE = /(?:^|[\s[(;,])@[\p{L}\p{N}_:.+/-]*$/u;
const TYPST_CITATION =
  /#cite\s*\([\s\S]{0,500}(?:<|label\s*\(\s*"|")[\p{L}\p{N}_:.+/-]*$/u;
const TYPST_REFERENCE =
  /#(?:ref|link)\(\s*<[\p{L}\p{N}_:.+/-]*$/u;
const BIBTEX_REFERENCE =
  /(?:crossref|xref|xdata|related|entryset)\s*=\s*["{]\s*[\p{L}\p{N}_:.+/-]*$/iu;

export function boundedCompletionContext(
  state: EditorState,
  pos: number,
  limit = COMPLETION_CONTEXT_LIMIT,
): string {
  const safePos = Math.max(0, Math.min(pos, state.doc.length));
  const safeLimit = Math.max(0, limit);
  return state.sliceDoc(Math.max(0, safePos - safeLimit), safePos);
}

function lastUnclosedDelimiter(
  text: string,
  open: "{" | "[",
  close: "}" | "]",
): number {
  const openers: number[] = [];
  let precedingBackslashes = 0;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (character === "\\") {
      precedingBackslashes++;
      continue;
    }
    const escaped = precedingBackslashes % 2 === 1;
    precedingBackslashes = 0;
    if (escaped) continue;
    if (character === open) openers.push(index);
    else if (character === close) openers.pop();
  }
  return openers.at(-1) ?? -1;
}

function hasOpenLatexArgument(before: string): boolean {
  for (const [open, close] of [
    ["{", "}"],
    ["[", "]"],
  ] as const) {
    const opener = lastUnclosedDelimiter(before, open, close);
    if (opener < 0) continue;
    const commandPrefix = before.slice(
      Math.max(0, opener - 1_000),
      opener,
    );
    if (hasLatexCommandPrefix(commandPrefix)) return true;
  }
  return false;
}

function hasLatexCommandPrefix(text: string): boolean {
  let cursor = trimWhitespaceBackward(text, text.length);
  while (cursor > 0 && (text[cursor - 1] === "]" || text[cursor - 1] === "}")) {
    const close = text[cursor - 1];
    const open = close === "]" ? "[" : "{";
    let depth = 1;
    cursor--;
    while (cursor > 0 && depth > 0) {
      cursor--;
      if (text[cursor] === close) depth++;
      else if (text[cursor] === open) depth--;
    }
    if (depth !== 0) return false;
    cursor = trimWhitespaceBackward(text, cursor);
  }
  if (cursor > 0 && text[cursor - 1] === "*") cursor--;
  const commandEnd = cursor;
  while (cursor > 0 && isLatexCommandCharacter(text[cursor - 1])) cursor--;
  return commandEnd > cursor && cursor > 0 && text[cursor - 1] === "\\";
}

function trimWhitespaceBackward(text: string, cursor: number): number {
  while (cursor > 0 && /\s/u.test(text[cursor - 1])) cursor--;
  return cursor;
}

function isLatexCommandCharacter(character: string): boolean {
  return character === "@" ||
    (character >= "A" && character <= "Z") ||
    (character >= "a" && character <= "z");
}

function latexTriggered(before: string): boolean {
  if (
    LATEX_COMMAND.test(before) ||
    LATEX_SLASH_COMMAND.test(before) ||
    LATEX_AT_SHORTCUT.test(before)
  ) {
    return true;
  }
  return before.includes("\\") && hasOpenLatexArgument(before);
}

function markdownTriggered(before: string): boolean {
  return MARKDOWN_ANCHOR.test(before) || AT_REFERENCE.test(before);
}

function typstTriggered(before: string): boolean {
  return (
    AT_REFERENCE.test(before) ||
    TYPST_CITATION.test(before) ||
    TYPST_REFERENCE.test(before)
  );
}

function bibtexTriggered(before: string): boolean {
  return BIBTEX_REFERENCE.test(before);
}

export function isCompletionLexicallyTriggered(
  state: EditorState,
  pos: number,
  syntax: CompletionSyntax = "generic",
): boolean {
  const before = boundedCompletionContext(state, pos);
  return isCompletionTextLexicallyTriggered(before, syntax);
}

export function isCompletionTextLexicallyTriggered(
  before: string,
  syntax: CompletionSyntax = "generic",
): boolean {
  switch (syntax) {
    case "latex":
      return latexTriggered(before);
    case "markdown":
      return markdownTriggered(before);
    case "typst":
      return typstTriggered(before);
    case "bibtex":
      return bibtexTriggered(before);
    case "generic":
      return (
        latexTriggered(before) ||
        markdownTriggered(before) ||
        typstTriggered(before) ||
        bibtexTriggered(before)
      );
  }
}

export function shouldRunCompletionSource(
  context: CompletionContext,
  syntax: CompletionSyntax,
): boolean {
  return (
    context.explicit ||
    isCompletionLexicallyTriggered(context.state, context.pos, syntax)
  );
}

export function gateCompletionSource(
  source: CompletionSource,
  syntax: CompletionSyntax,
): CompletionSource {
  return (context) =>
    shouldRunCompletionSource(context, syntax) ? source(context) : null;
}
