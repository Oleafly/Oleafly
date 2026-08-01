import {
  closeCompletion,
  snippet,
  type Completion,
  type CompletionSource,
} from "@codemirror/autocomplete";
import {
  completionRequestIsCurrent,
  createCompletionRequestGuard,
  scanMathExpressions,
  type CompletionRequestGuard,
} from "@oleafly/editor";
import type { EditorView } from "@codemirror/view";
import {
  loadAtSuggestions,
  type AtSuggestion,
} from "@oleafly/latex-intelligence";

// `@`-shortcut math snippets (`@a` → \alpha, `@/` → \frac),
// vendored into public/latex-intelligence/at-suggestions.json. The source is
// synchronous, so the corpus is cached here like src/lib/latex-corpus.ts:
// completions return null until the background load resolves.

/** Characters scanned on each side of the cursor when detecting math. */
const MATH_WINDOW = 2048;

/** The `@`-token being completed, anchored at the cursor. */
const AT_TOKEN = /@[A-Za-z()[\]{}|<>+\-*=.]*$/;

/**
 * True when `pos` sits strictly inside the body of a math expression
 * ($...$, \(...\), \[...\], $$...$$). Only a ±2 KB window around `pos` is
 * scanned, so an expression whose opening delimiter lies outside the window
 * is not recognized.
 */
export function isMathContext(text: string, pos: number): boolean {
  const from = Math.max(0, Math.min(pos, text.length) - MATH_WINDOW);
  const to = Math.min(text.length, pos + MATH_WINDOW);
  const local = pos - from;
  for (const expression of scanMathExpressions(text.slice(from, to), {
    format: "latex",
  })) {
    if (expression.bodyFrom > local) break;
    if (local >= expression.bodyFrom && local <= expression.bodyTo) return true;
  }
  return false;
}

let cachedSuggestions: AtSuggestion[] | null = null;
let cachedOptions: Completion[] | null = null;
let loadRequested = false;

/** Kick off the lazy corpus load; the sync cache fills when it resolves. */
export function warmAtSuggestions(): void {
  if (loadRequested) return;
  loadRequested = true;
  void loadAtSuggestions().then((value) => {
    cachedSuggestions = value;
  });
}

/** Test seam: seed (or clear, with null) the sync suggestion cache. */
export function setAtSuggestionsForTest(value: AtSuggestion[] | null): void {
  cachedSuggestions = value;
  cachedOptions = null;
  loadRequested = value !== null;
}

function baseOptions(suggestions: AtSuggestion[]): Completion[] {
  cachedOptions ??= suggestions.map((suggestion) => ({
    label: suggestion.trigger,
    type: "keyword",
    ...(suggestion.detail === undefined ? {} : { detail: suggestion.detail }),
    apply: snippet(suggestion.replacement),
  }));
  return cachedOptions;
}

// Mirrors guardCompletionForSource in packages/editor/src/latex.ts (not
// exported to the app): a completion applied after the document moved on
// closes the popup instead of splicing text at a stale position.
function guardOption(
  guard: CompletionRequestGuard,
  option: Completion,
): Completion {
  const originalApply = option.apply;
  return {
    ...option,
    apply: (view: EditorView, completion: Completion, from: number, to: number) => {
      if (!completionRequestIsCurrent(guard, view.state)) {
        closeCompletion(view);
        return;
      }
      // Every base option's apply is snippet(replacement), so it is a function.
      if (typeof originalApply === "function") {
        originalApply(view, completion, from, to);
      }
    },
  };
}

/**
 * Math-only `@` shortcut completions. Applying an option replaces the whole
 * `@`-token with the shortcut's snippet.
 */
export const atSuggestionCompletion: CompletionSource = (context) => {
  const token = context.matchBefore(AT_TOKEN);
  if (!token) return null;
  if (!isMathContext(context.state.doc.toString(), context.pos)) return null;
  const suggestions = cachedSuggestions;
  if (!suggestions) {
    warmAtSuggestions();
    return null;
  }
  const guard = createCompletionRequestGuard(context);
  return {
    from: token.from,
    options: baseOptions(suggestions).map((option) =>
      guardOption(guard, option),
    ),
  };
};
