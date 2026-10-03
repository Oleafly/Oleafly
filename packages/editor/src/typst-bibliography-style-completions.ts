import type { Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import {
  typstBibliographyStyleDetailKey,
  typstBibliographyStyles,
  typstStyleArgumentAt,
  typstStyleVersion,
  type TypstStyleUsage,
} from "./bibliography-styles";
import { createCompletionRequestGuard } from "./completion-request";
import { guardCompletionForSource } from "./latex";
import { editorMessage } from "./messages";

const TYPST_STYLE_CONTEXT_LIMIT = 4_000;
const PROJECT_STYLE_BOOST = 2;

export function typstBibliographyStyleCompletions(context: CompletionContext): CompletionResult | null {
  const before = context.state.sliceDoc(Math.max(0, context.pos - TYPST_STYLE_CONTEXT_LIMIT), context.pos);
  const argument = typstStyleArgumentAt(before);
  if (!argument) return null;
  const usage: TypstStyleUsage = argument.callee === "cite" ? "cite" : "bibliography";
  const guard = createCompletionRequestGuard(context);
  return {
    from: context.pos - argument.query.length,
    validFor: /^[\p{L}\p{N}./_-]*$/u,
    options: typstBibliographyStyles(typstStyleVersion(), usage).map((style) =>
      guardCompletionForSource(guard, {
        label: style.name,
        type: "constant",
        detail: editorMessage(typstBibliographyStyleDetailKey(style)),
        boost: style.project ? PROJECT_STYLE_BOOST : 0,
      } satisfies Completion),
    ),
  };
}
