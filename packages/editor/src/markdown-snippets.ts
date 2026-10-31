import {
  snippet,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import { createCompletionRequestGuard } from "./completion-request";
import { boundedCompletionContext } from "./completion-trigger";
import { guardCompletionForSource } from "./latex";
import { editorMessage, type EditorMessageKey } from "./messages";

export interface MarkdownSnippet {
  readonly label: string;
  readonly detail: EditorMessageKey;
  readonly template: string;
}

export const MARKDOWN_SNIPPETS: readonly MarkdownSnippet[] = [
  {
    label: "/table",
    detail: "markdown.snippet.table",
    template: "| ${1:Column 1} | ${2:Column 2} |\n| --- | --- |\n| ${3} | ${4} |",
  },
  { label: "/equation", detail: "markdown.snippet.equation", template: "$$\n${1}\n$$" },
];

const SLASH_COMMAND = /(?:^|\s)(\/[A-Za-z]*)$/u;
const LITERAL_NODES = new Set(["FencedCode", "CodeBlock", "InlineCode", "PandocMath", "HTMLBlock", "CommentBlock"]);

function inLiteral(state: EditorState, pos: number): boolean {
  for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, 1); node; node = node.parent) {
    if (LITERAL_NODES.has(node.name)) return true;
  }
  return false;
}

export function markdownSlashCompletions(
  context: CompletionContext,
): CompletionResult | null {
  const match = SLASH_COMMAND.exec(boundedCompletionContext(context.state, context.pos));
  if (!match) return null;
  const from = context.pos - match[1].length;
  if (inLiteral(context.state, from)) return null;
  const guard = createCompletionRequestGuard(context);
  return {
    from,
    options: MARKDOWN_SNIPPETS.map((entry) =>
      guardCompletionForSource(guard, {
        label: entry.label,
        type: "snippet",
        detail: editorMessage(entry.detail),
        apply: snippet(entry.template),
      } satisfies Completion),
    ),
  };
}
