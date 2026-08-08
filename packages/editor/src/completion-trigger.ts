import type {
  CompletionContext,
  CompletionSource,
} from "@codemirror/autocomplete";
import type { EditorState } from "@codemirror/state";

/**
 * Completion recognition only needs the syntax immediately before the caret.
 * Keeping this window fixed prevents a long line or document from turning an
 * ordinary keystroke into an O(document-size) allocation.
 */
export const COMPLETION_CONTEXT_LIMIT = 2_048;

type CompletionSyntax =
  | "latex"
  | "markdown"
  | "typst"
  | "bibtex"
  | "generic";

const LATEX_PATH = /\.(?:tex|latex|ltx|sty|cls)$/i;
const MARKDOWN_PATH = /\.(?:md|markdown)$/i;
const TYPST_PATH = /\.typ$/i;
const BIBTEX_PATH = /\.bib$/i;

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

function syntaxForPath(path: string | null): CompletionSyntax {
  if (path && LATEX_PATH.test(path)) return "latex";
  if (path && MARKDOWN_PATH.test(path)) return "markdown";
  if (path && TYPST_PATH.test(path)) return "typst";
  if (path && BIBTEX_PATH.test(path)) return "bibtex";
  return "generic";
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

/** True when the caret is inside an argument belonging to a LaTeX command. */
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
    if (
      /\\[A-Za-z@]+\*?(?:\s*(?:\[[^\]]*\]|\{[^{}]*\}))*\s*$/u.test(
        commandPrefix,
      )
    ) {
      return true;
    }
  }
  return false;
}

function latexTriggered(before: string): boolean {
  if (
    LATEX_COMMAND.test(before) ||
    LATEX_SLASH_COMMAND.test(before) ||
    LATEX_AT_SHORTCUT.test(before)
  ) {
    return true;
  }
  // Avoid delimiter stacks for the overwhelmingly common prose-only window.
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

/**
 * Cheap, allocation-bounded recognition of completion syntax at the caret.
 * `generic` is used by the standalone ghost extension, which has no filename.
 */
export function isCompletionLexicallyTriggered(
  state: EditorState,
  pos: number,
  path: string | null = null,
): boolean {
  const before = boundedCompletionContext(state, pos);
  return isCompletionTextLexicallyTriggered(before, path);
}

export function isCompletionTextLexicallyTriggered(
  before: string,
  path: string | null = null,
): boolean {
  switch (syntaxForPath(path)) {
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
  path: string | null,
): boolean {
  return (
    context.explicit ||
    isCompletionLexicallyTriggered(context.state, context.pos, path)
  );
}

/**
 * Protect host-provided sources at the editor boundary. Some sources need a
 * full source snapshot once they know a completion is possible; the wrapper
 * ensures they are never asked for that snapshot on ordinary prose typing.
 */
export function gateCompletionSource(
  source: CompletionSource,
  path: string | null,
): CompletionSource {
  return (context) =>
    shouldRunCompletionSource(context, path) ? source(context) : null;
}
